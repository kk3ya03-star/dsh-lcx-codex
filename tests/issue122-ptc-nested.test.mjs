import test from 'node:test'
import assert from 'node:assert/strict'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import { Session } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { auxiliaryUsageOf } from '../lib/search-accounting.js'
import { runAgent, runCode, hostedResponse, hostedUsage } from './issue122-ptc-fixture.mjs'
import { createAssembly } from './issue122-conversation-fixture.mjs'

// Issue 122 item 1: DSH 0.2.1 records a tool called from inside `run_code` (programmatic tool calling) as
// `tool/ptc-dispatch`, carrying the nested tool's `name`, `subCallId`, `rootCallId` and presentation `meta`,
// and never as `tool/result`. LCX's usage projection, turn usage and search-media node only read `tool/result`,
// so a search made from code recorded no usage and showed no media.
//
// Everything below runs DSH's real tool registry, `run_code` transport, nested dispatch scheduler, Agent loop,
// session, usage projection and Conversation assembler; only the script runtime behind `ctx.ptcRuntime` is an
// in-process stand-in (the real one spawns a sandboxed Node process), see issue122-ptc-fixture.mjs.

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const IMAGE = { image_url: 'https://img.example/nested.jpg', source_website_url: 'https://source.example/page', caption: 'Nested' }
const SEARCH = "const r = await tools.websearch_gpt_advanced({ query: 'q' }); return r.content"

/** Hosted answer for the n-th provider request; bills `total` tokens and optionally returns an image. */
function answerWith(plan) {
  let n = 0
  const billed = []
  const handler = async () => {
    const step = plan[n]
    n += 1
    billed.push(step)
    if (step.fail) return json({ id: `resp_${n}`, status: 'incomplete', usage: step.usage, output: [] })
    return json(hostedResponse({ id: `resp_${n}`, usage: step.usage, images: step.image ? [IMAGE] : [] }))
  }
  return { handler, billed }
}
const expectedBuckets = (steps) => steps.reduce((sum, { usage: u }) => ({
  uncachedInputTokens: sum.uncachedInputTokens + u.input_tokens - u.input_tokens_details.cached_tokens,
  outputTokens: sum.outputTokens + u.output_tokens,
  cacheReadTokens: sum.cacheReadTokens + u.input_tokens_details.cached_tokens,
  cacheWriteTokens: 0,
}), { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
const view = (ctx, session) => ctx.sessionProjections.snapshot(session).values.lcxSearchUsage
const state = (ctx, session) => ctx.sessionProjections.stateOf(session, 'lcxSearchUsage')

test('DSH contract: a nested search settles as tool/ptc-dispatch with its own name and meta, never as tool/result', async (t) => {
  const { handler } = answerWith([{ usage: hostedUsage(1000, 50, 400), image: true }])
  const { events } = await runAgent(t, { modelCalls: [[runCode('call_root', SEARCH)], 'done'], fetchHandler: handler })
  const dispatch = events.filter((event) => event.type === 'tool/ptc-dispatch')
  assert.equal(dispatch.length, 1)
  const { data } = dispatch[0]
  assert.equal(data.rootCallId, 'call_root')
  assert.equal(data.parentCallId, 'call_root')
  assert.equal(data.subCallId, 'call_root:ptc:1')
  assert.equal(data.name, 'websearch_gpt_advanced')
  assert.equal(data.isError, false)
  assert.equal(data.turn, undefined, 'the event carries no turn: the Client must resolve it through the root call')
  assert.equal(data.meta.lcxHostedMedia.tool, 'websearch_gpt_advanced')
  assert.equal(data.meta.lcxHostedMedia.candidates[0].url, IMAGE.image_url)
  assert.equal(data.meta.auxiliaryUsage.length, 1)
  // The only tool/result of the turn is the root run_code call; the nested search has none.
  assert.deepEqual(events.filter((event) => event.type === 'tool/result').map((event) => event.data.message.source.callId), ['call_root'])
  assert.equal(events.find((event) => event.type === 'tool/result').data.meta, undefined, 'the root result carries no search meta to double count')
  assert.ok(events.findIndex((event) => event.type === 'tool/call') < events.findIndex((event) => event.type === 'tool/ptc-dispatch'))
})

test('the shared accounting reads a nested settlement by its own name and ignores foreign tools', () => {
  const record = { requestId: 'r', provider: 'p', model: 'm', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 } }
  const nested = (name, meta = { auxiliaryUsage: [record] }) => ({ type: 'tool/ptc-dispatch', data: { rootCallId: 'a', parentCallId: 'a', subCallId: 'a:ptc:1', name, isError: false, content: [], meta } })
  assert.equal(auxiliaryUsageOf(nested('websearch_gpt_advanced')).length, 1)
  assert.equal(auxiliaryUsageOf(nested('web_search')).length, 1)
  assert.equal(auxiliaryUsageOf(nested('bash')).length, 0, 'only LCX-owned search tools contribute billing')
  assert.equal(auxiliaryUsageOf(nested('web_search', null)).length, 0)
  assert.equal(auxiliaryUsageOf({ ...nested('web_search'), type: 'tool/ptc-dispatch-start' }).length, 0, 'a dispatch start settles nothing')
  // A direct result still resolves its name from the pending tool/call.
  const direct = { type: 'tool/result', data: { meta: { auxiliaryUsage: [record] } } }
  assert.equal(auxiliaryUsageOf(direct, 'web_search').length, 1)
  assert.equal(auxiliaryUsageOf(direct, undefined).length, 0)
})

test('a search made from run_code is counted by the session usage projection, exactly once', async (t) => {
  const { handler, billed } = answerWith([{ usage: hostedUsage(1000, 50, 400) }])
  const { ctx, session } = await runAgent(t, { modelCalls: [[runCode('call_root', SEARCH)], 'done'], fetchHandler: handler })
  assert.deepEqual(view(ctx, session).auxiliary, expectedBuckets(billed))
  assert.deepEqual(view(ctx, session).auxiliary, { uncachedInputTokens: 600, outputTokens: 50, cacheReadTokens: 400, cacheWriteTokens: 0 })
  assert.equal(snapshotJsonValue(state(ctx, session)) === undefined, false, 'unit state stays lossless plain JSON')
  assert.equal(snapshotJsonValue(ctx.sessionProjections.checkpoint(session)) === undefined, false)
  // A cold replay of the persisted log folds to the same value (no event is read twice).
  const restored = Session.fromRestore(session.id, [...session.snapshotEvents()], session.header, session.inheritedEventCount, 'shared-frozen')
  assert.deepEqual(view(ctx, restored), view(ctx, session))
})

test('parallel and repeated nested searches, a failure after billing, and a direct search add up with no double count', async (t) => {
  const steps = [
    { usage: hostedUsage(1000, 50, 400) },
    { usage: hostedUsage(2000, 70, 0) },
    { usage: hostedUsage(3000, 90, 1000) },
    { usage: hostedUsage(500, 20, 100), fail: true },
  ]
  const { handler, billed } = answerWith(steps)
  const program = (calls) => `const results = await Promise.allSettled([${calls}]); return results.map((r) => r.status)`
  const search = (q) => `tools.websearch_gpt_advanced({ query: '${q}' })`
  const { ctx, session, handle, events } = await runAgent(t, {
    modelCalls: [[
      runCode('call_a', program(`${search('one')}, ${search('two')}`)),
      runCode('call_b', program(`${search('three')}, ${search('four')}`)),
    ], 'done'],
    fetchHandler: handler,
  })
  const dispatch = events.filter((event) => event.type === 'tool/ptc-dispatch')
  assert.equal(dispatch.length, 4)
  assert.equal(billed.length, 4)
  assert.equal(dispatch.filter((event) => event.data.isError).length, 1, 'the incomplete response failed its call')
  assert.ok(dispatch.every((event) => event.data.meta?.auxiliaryUsage?.length === 1), 'a failure after billing keeps its usage')
  assert.deepEqual(view(ctx, session).auxiliary, expectedBuckets(billed))

  // A model-direct search settles as tool/result: both channels are counted once each.
  const direct = { requestId: 'direct-1', provider: 'relay', model: 'gpt-test', usage: { inputTokens: 40, outputTokens: 10, totalTokens: 90, cacheReadTokens: 40, cacheWriteTokens: 0 } }
  const turn = Math.max(...events.map((event) => event.data?.turn ?? 0))
  session.append('tool/call', { turn, step: 9, callId: ToolCallId('direct'), name: 'web_search', arguments: '{}' })
  session.append('tool/result', {
    turn, step: 9, meta: { auxiliaryUsage: [direct] },
    message: createToolResultMessage({ callId: ToolCallId('direct'), content: [{ type: 'text', text: 'ok' }], isError: false }),
  }, { surfaceOp: 'append' })
  const expected = expectedBuckets(billed)
  assert.deepEqual(view(ctx, session).auxiliary, {
    uncachedInputTokens: expected.uncachedInputTokens + 40, outputTokens: expected.outputTokens + 10,
    cacheReadTokens: expected.cacheReadTokens + 40, cacheWriteTokens: 0,
  })

  // A nested call to a tool LCX does not own never contributes, whatever its meta says.
  session.append('tool/ptc-dispatch', {
    rootCallId: 'call_a', parentCallId: 'call_a', subCallId: 'call_a:ptc:9', name: 'bash', arguments: {}, isError: false, content: [],
    meta: { auxiliaryUsage: [{ ...direct, requestId: 'foreign' }] },
  })
  assert.equal(view(ctx, session).auxiliary.outputTokens, expected.outputTokens + 10)
  assert.equal(snapshotJsonValue(state(ctx, session)) === undefined, false)
  await handle.dispose()
})

test('client: turn usage includes nested searches and never leaks into another turn', async (t) => {
  const steps = [{ usage: hostedUsage(1000, 50, 400) }, { usage: hostedUsage(2000, 70, 0) }]
  const { handler } = answerWith(steps)
  const { session, handle } = await runAgent(t, { modelCalls: [[runCode('call_one', SEARCH)], 'first answer', [runCode('call_two', SEARCH)], 'second answer'], fetchHandler: handler })
  const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }))
  await handle.agent.whenIdle()
  const events = session.snapshotEvents()
  assert.deepEqual(events.filter((event) => event.type === 'turn/start').map((event) => event.data.turn), [1, 2])
  // The assembly runs in a vm realm: copy into this realm before a deep comparison.
  const totals = (records) => Array.from(records, (record) => record.usage.totalTokens)
  for (const how of ['replace', 'append']) {
    const assembly = createAssembly()
    if (how === 'replace') assembly.replace(events)
    else for (const event of events) assembly.append([event])
    assert.deepEqual(totals(assembly.turnUsage(1) ?? []), [1050], `${how}: turn 1`)
    assert.deepEqual(totals(assembly.turnUsage(2) ?? []), [2070], `${how}: turn 2`)
  }
})

test('client: nested structured media joins the turn node, once, at the final answer', async (t) => {
  const { handler } = answerWith([{ usage: hostedUsage(1000, 50, 0), image: true }, { usage: hostedUsage(900, 40, 0) }])
  const text = 'Here is a photo https://prose.example/photo.jpg'
  const { events } = await runAgent(t, {
    modelCalls: [[runCode('call_a', SEARCH), runCode('call_b', "return await tools.websearch_gpt_advanced({ query: 'second' })")], text],
    fetchHandler: handler,
  })
  const finalAnswer = events.findLast((event) => event.type === 'assistant/message')
  for (const how of ['replace', 'append']) {
    const assembly = createAssembly()
    if (how === 'replace') assembly.replace(events)
    else for (const event of events) assembly.append([event])
    const nodes = assembly.nodes()
    assert.equal(nodes.length, 1, `${how}: exactly one media node per turn, however many run_code calls`)
    const [node] = nodes
    assert.equal(node.anchorSeq, finalAnswer.seq, `${how}: anchored at the final answer`)
    // Same ordering as a direct search: structured candidates in settle order first, then links in text order.
    assert.deepEqual(Array.from(node.data.items, (item) => [item.url, item.structured === true]), [
      [IMAGE.image_url, true],
      ['https://prose.example/photo.jpg', false],
    ], how)
    assert.equal(node.data.items[0].caption, 'Nested')
    assert.equal(node.data.items[0].sourceUrl, IMAGE.source_website_url)
  }
})

test('client: a nested search without images adds no node, and another turn does not inherit media', async (t) => {
  const { handler } = answerWith([{ usage: hostedUsage(1000, 50, 0), image: true }, { usage: hostedUsage(900, 40, 0) }])
  const { session, handle } = await runAgent(t, { modelCalls: [[runCode('call_one', SEARCH)], 'first answer', [runCode('call_two', SEARCH)], 'second answer'], fetchHandler: handler })
  const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }))
  await handle.agent.whenIdle()
  const assembly = createAssembly()
  assembly.replace(session.snapshotEvents())
  const nodes = assembly.nodes()
  assert.deepEqual(nodes.map((node) => node.id), ['1'], 'turn 2 had no images and no links')
  assert.equal(nodes[0].data.items.length, 1)
})

test('client: a nested settlement whose root call was never seen is ignored, not fatal', () => {
  const assembly = createAssembly()
  const meta = { lcxHostedMedia: { version: 1, tool: 'web_search', candidates: [{ kind: 'image', url: 'https://img.example/x.jpg', structured: true }] } }
  assert.doesNotThrow(() => assembly.replace([
    { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } },
    { type: 'tool/ptc-dispatch', seq: 2, time: 0, data: { rootCallId: 'never-called', parentCallId: 'never-called', subCallId: 'never-called:ptc:1', name: 'web_search', arguments: {}, isError: false, content: [], meta } },
    { type: 'turn/end', seq: 3, time: 0, data: { turn: 1, reason: { kind: 'completed' } } },
  ]))
  assert.deepEqual(assembly.nodes(), [])
})
