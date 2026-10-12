import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset, buildForkSeed } from '@deepseek-ai/dsh-session'
import Llm from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import Sessions from '@deepseek-ai/dsh-session'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import QuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Compaction from '@deepseek-ai/dsh-compaction-basic'
import { serializeDshMessages } from '../lib/dsh-responses.js'
import { loadHostSource, loadSource } from './wp2-source.mjs'
import { queryContext } from './session-query-fixture.mjs'

// Issue #115 (I-09 / I-10). DSH 0.2.1-alpha.2 declares systemPromptUpdate "in-history" and toolUpdate
// "addition-only" for catalog GPT routes. These tests drive the real DSH agent loop, session, llm and
// llm-pi-ai adapter (no hand-written stand-ins for those classes) and assert on the final Responses
// request body LCX would POST.

const baseURL = 'https://fixture.invalid/v1'
const routeConfig = { baseURL, portableReplayMaxChars: 200000 }
const tool = (name, extra = {}) => ({ name, description: `${name} tool`, parameters: { type: 'object', properties: {}, additionalProperties: false }, ...extra })
const textOf = item => typeof item.content === 'string' ? item.content : (item.content ?? []).map(part => part.text ?? '').join('')
const wire = input => input.map(item => [item.role ?? item.type, textOf(item)])
const instructionTexts = (input, role) => input.filter(item => item.role === role).map(textOf)

const [checkpoint] = await Promise.all([loadHostSource('native-checkpoint')])
const toolCallOn = { remaining: 0 }

const loadIndexInternals = () => loadSource('index', 'serializeNativeAware, managedResponsesStream')

async function harness(root, index) {
  const ctx = new Context()
  ctx.plugin(Llm)
  ctx.plugin(PiAi, {
    providers: {
      openai: {},
      // llm-pi-ai refuses to let a profile set supportsMidConvoSystemMessages: only catalog vendor names can be in-history.
      lcxplain: { api: 'openai-responses', baseURL, models: [{ id: 'gpt-5.6-sol', name: 'custom plain' }] },
    },
  })
  ctx.plugin(Sessions)
  ctx.plugin(Jsonl, { root: resolve(root, 'sessions') })
  ctx.plugin(QuerySqlite, { path: ':memory:', openAt: 'never' })
  ctx.plugin(Projections)
  ctx.plugin(SystemPrompt)
  ctx.plugin(Tools)
  ctx.plugin(Agents)
  ctx.plugin(AgentLoop)
  ctx.plugin(TokenMeter)
  ctx.plugin(Compaction, { auto: false })
  await new Promise(done => setTimeout(done, 800))
  const raw = []
  ctx.on('llm/stream', (options, next) => {
    raw.push(options)
    if (options.purpose === 'compaction') {
      return (async function* () {
        const route = { provider: options.provider, model: options.model, baseURL, sessionId: String(options.sessionId) }
        const prepared = await index.serializeNativeAware(options.messages, route, routeConfig, ctx, { tools: [...(options.tools ?? [])] })
        const session = ctx.sessions.get(SessionId(String(options.sessionId)))
        const result = { compaction: { type: 'compaction', encrypted_content: 'FAKE-OPAQUE-PLACEHOLDER' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
        const block = await checkpoint.createNativeCheckpointBlock({ ctx, session, route, result, input: prepared.input, ephemeralPreludeItemCount: prepared.ephemeralPreludeItemCount, supersededItemIndices: prepared.supersededInstructionItems, imageMap: prepared.imageMap, retentionOptions: {} })
        yield* checkpoint.nativeCheckpointChunks(block, result.usage)
      })()
    }
    if (toolCallOn.remaining > 0 && options.messages.at(-1)?.role !== 'tool') {
      toolCallOn.remaining -= 1
      return (async function* () {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: 'call_probe|fc_probe', name: 'probe_tool', argumentsDelta: '{}' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_probe|fc_probe', name: 'probe_tool', arguments: '{}' } }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      })()
    }
    return (async function* () {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'reply' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'reply' } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  })
  const state = { prompt: 'PROMPT-V1', tools: [] }
  ctx.systemPrompt.section({ name: 'issue115-probe', order: 5, text: () => state.prompt })
  ctx.systemPrompt.tools(() => ({ schemas: state.tools.map(schema => structuredClone(schema)) }))
  ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-only' }) }, true)
  return { ctx, raw, state }
}

async function withHarness(run) {
  const root = await mkdtemp(resolve('.i115-'))
  const originalFetch = globalThis.fetch
  const bodies = []
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)))
    return new Response('', { status: 500 })
  }
  try {
    const index = await loadIndexInternals()
    return await run({ root, index, bodies, ...(await harness(root, index)) })
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
}

async function startAgent(ctx, root, id, provider, model) {
  const handle = await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: root }, agentOptions: { provider, model } })
  const ask = async text => {
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    return handle.agent.session
  }
  return { handle, ask }
}

async function postedBody(index, bodies, request, config = routeConfig, ctx) {
  const before = bodies.length
  for await (const _chunk of index.managedResponsesStream({ ...request, signal: AbortSignal.timeout(5000) }, config, ctx)) void _chunk
  assert.equal(bodies.length, before + 1, 'LCX reached its Responses transport exactly once')
  return bodies.at(-1)
}

test('catalog GPT route: mid-session system prompt updates reach the Responses request in place with developer role', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i115-catalog', 'openai', 'gpt-5.6-sol')
    const info = await ctx.llm.resolveModelInfo('openai', 'gpt-5.6-sol')
    assert.equal(info.systemPromptUpdate, 'in-history', 'the real host adapter declares in-history for the catalog route')
    await ask('turn one')
    state.prompt = 'PROMPT-V2'
    await ask('turn two')
    state.prompt = 'PROMPT-V3'
    await ask('turn three')
    const request = raw.at(-1)
    assert.deepEqual(request.messages.filter(m => m.role === 'system').length, 3, 'agent loop recorded three full system messages')
    const body = await postedBody(index, bodies, request, routeConfig, ctx)
    const items = wire(body.input)
    const kinds = body.input.map(item => item.role ?? item.type)
    assert.deepEqual(kinds, ['developer', 'user', 'assistant', 'developer', 'user', 'assistant', 'developer', 'user'], 'updates sit at their history position, in order')
    const developers = instructionTexts(body.input, 'developer')
    assert.match(developers[0], /PROMPT-V1$/u)
    assert.match(developers[1], /PROMPT-V2$/u)
    assert.match(developers[2], /PROMPT-V3$/u)
    assert.equal(items.filter(([role, text]) => role === 'user' && /PROMPT-V/u.test(text)).length, 0, 'no system update is demoted to user text')
    assert.deepEqual(items.filter(([role]) => role === 'user').map(([, text]) => text), ['turn one', 'turn two', 'turn three'])
    assert.equal(instructionTexts(body.input, 'system').length, 0)
    await handle.dispose()
  })
})

test('catalog route with a non-developer instruction role compat renders updates as system items', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i115-system-role', 'openai', 'gpt-5.6-sol')
    await ask('turn one')
    state.prompt = 'PROMPT-V2'
    await ask('turn two')
    const request = raw.at(-1)
    const reasoning = await postedBody(index, bodies, request, routeConfig, ctx)
    assert.deepEqual(instructionTexts(reasoning.input, 'developer').map(text => text.slice(-9)), ['PROMPT-V1', 'PROMPT-V2'])
    const plain = await postedBody(index, bodies, request, { ...routeConfig, responsesCompat: { supportsDeveloperRole: false } }, ctx)
    assert.deepEqual(plain.input.map(item => item.role ?? item.type), ['system', 'user', 'assistant', 'system', 'user'])
    assert.deepEqual(instructionTexts(plain.input, 'system').map(text => text.slice(-9)), ['PROMPT-V1', 'PROMPT-V2'])
    assert.equal(instructionTexts(plain.input, 'developer').length, 0)
    await handle.dispose()
  })
})

test('routes without in-history keep DSH head replacement and legacy mapping (regression)', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    for (const [provider, model] of [['openai', 'gpt-5.2'], ['lcxplain', 'gpt-5.6-sol']]) {
      const info = await ctx.llm.resolveModelInfo(provider, model)
      assert.equal(info.systemPromptUpdate, undefined, `${provider}/${model} does not declare in-history`)
      state.prompt = 'PROMPT-V1'
      const { handle, ask } = await startAgent(ctx, root, `i115-legacy-${provider}`, provider, model)
      await ask('turn one')
      state.prompt = 'PROMPT-V2'
      await ask('turn two')
      const request = raw.at(-1)
      assert.equal(request.messages.filter(m => m.role === 'system').length, 1, 'DSH rewrote the single head instead of appending')
      const body = await postedBody(index, bodies, request, routeConfig, ctx)
      // Issue 119: the instruction role follows the model's reasoning capability as DSH resolves it. The catalog
      // reasoning model renders developer; the custom-named route declares no reasoningEfforts, so DSH resolves it
      // as non-reasoning and its single head keeps the plain system role.
      const instructionRole = provider === 'openai' ? 'developer' : 'system'
      assert.deepEqual(body.input.map(item => item.role ?? item.type), [instructionRole, 'user', 'assistant', 'user'])
      assert.match(instructionTexts(body.input, instructionRole)[0], /PROMPT-V2$/u)
      await handle.dispose()
    }
  })
})

test('updates after a native checkpoint survive; superseded prompt snapshots are dropped from retained items and from migrated history', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i115-batches', 'openai', 'gpt-5.6-sol')
    await ask('turn one '.repeat(500))
    state.prompt = 'PROMPT-V2'
    await ask('turn two '.repeat(500))
    state.prompt = 'PROMPT-V3'
    await ask('turn three '.repeat(500))
    assert.ok(await ctx.compaction.compactNow(handle.agent, new AbortController().signal), 'real DSH compaction wrote a native checkpoint')
    // The first request after compaction starts a new series: DSH re-renders the head instead of appending.
    state.prompt = 'PROMPT-V4'
    await ask('turn four')
    state.prompt = 'PROMPT-V5'
    await ask('turn five')
    const request = raw.at(-1)
    const messages = request.messages
    assert.deepEqual(messages.map(message => message.role), ['system', 'user', 'assistant', 'user', 'assistant', 'system', 'user'])
    assert.ok(messages[1].content.some(block => /checkpoint/iu.test(String(block.text ?? ''))), 'the checkpoint message follows the head')
    const body = await postedBody(index, bodies, request, routeConfig, ctx)
    const kinds = body.input.map(item => item.role ?? item.type)
    assert.ok(kinds.includes('compaction'), 'native replay item is present')
    assert.deepEqual(kinds.filter(kind => kind === 'developer').length, 2, 'head plus the one post-checkpoint update')
    const developers = instructionTexts(body.input, 'developer')
    assert.match(developers[0], /PROMPT-V4$/u, 'the re-rendered head leads')
    assert.match(developers[1], /PROMPT-V5$/u)
    const tail = body.input.slice(-2)
    assert.deepEqual(wire(tail).map(([role]) => role), ['developer', 'user'], 'the update sits immediately before its user turn')
    assert.equal(textOf(tail[1]), 'turn five')
    const stale = body.input.filter(item => /PROMPT-V[123]/u.test(JSON.stringify(item)))
    assert.deepEqual(stale, [], 'superseded prompt snapshots are retained neither as developer/system nor as user text')
    assert.ok(wire(body.input).some(([role, text]) => role === 'user' && text.startsWith('turn one')), 'ordinary user history is still retained')

    // Portable route migration replays the shadowed history without its superseded system snapshots; the
    // current head and the post-checkpoint update keep instruction authority.
    const migrated = await index.serializeNativeAware(messages, { provider: 'openai', model: 'gpt-5.5', baseURL, sessionId: String(request.sessionId) }, routeConfig, ctx, { tools: [] })
    assert.deepEqual(instructionTexts(migrated.input, 'developer').map(text => text.slice(-9)), ['PROMPT-V4', 'PROMPT-V5'])
    assert.doesNotMatch(JSON.stringify(migrated.input), /PROMPT-V[123]/u, 'shadowed prompt snapshots are not replayed in any role or text form')
    assert.equal(migrated.input.some(item => item.type === 'compaction'), false, 'no parent opaque state on migration')
    await handle.dispose()
  })
})

test('routes whose compat opts out of additional_tools/tool_search keep the full-list fallback: no developer registry, no deferLoading', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i115-tools', 'openai', 'gpt-5.6-sol')
    const info = await ctx.llm.resolveModelInfo('openai', 'gpt-5.6-sol')
    assert.equal(info.toolUpdate, 'addition-only')
    state.tools = [tool('tool_a')]
    await ask('one')
    state.tools = [tool('tool_a'), tool('tool_b')]
    await ask('two')
    state.tools = [tool('tool_a'), tool('tool_b'), tool('tool_c', { deferLoading: true })]
    await ask('three')
    const request = raw.at(-1)
    assert.ok(request.messages.some(message => message.role === 'developer' && message.content.some(block => block.type === 'tool-addition')), 'host really produced developer tool-addition messages')
    assert.ok(request.tools.some(schema => schema.deferLoading === true), 'host really produced a deferLoading declaration')
    const body = await postedBody(index, bodies, request, { ...routeConfig, responsesCompat: { supportsAdditionalTools: false, supportsToolSearch: false } }, ctx)
    const serialized = JSON.stringify(body)
    assert.doesNotMatch(serialized, /deferLoading|defer_loading|tool-addition|tool-removal|additional_tools|tool_search/u)
    assert.equal(body.input.some(item => item.role === 'developer' && /tool/iu.test(textOf(item)) && !/PROMPT-V/u.test(textOf(item)) && !/DeepSeek/u.test(textOf(item))), false)
    assert.deepEqual(body.tools.map(entry => entry.name), ['tool_a', 'tool_b', 'tool_c'], 'tools equal the complete current set')
    assert.equal(body.input.filter(item => item.role === 'developer').length, 1, 'only the head instruction, no tool registry message')
    await handle.dispose()
  })
})

test('portable replay (fork) drops superseded prompt snapshots before the budget and keeps ordinary and tool history', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    const bulky = 'plan-mode policy paragraph. '.repeat(700)
    state.tools = [tool('probe_tool')]
    const { handle, ask } = await startAgent(ctx, root, 'i115-fork-parent', 'openai', 'gpt-5.6-sol')
    await ask('turn one '.repeat(300))
    state.prompt = `PROMPT-V2 ${bulky}`
    toolCallOn.remaining = 1
    await ask('turn two uses a tool '.repeat(100))
    state.prompt = `PROMPT-V3 ${bulky}`
    await ask('turn three '.repeat(300))
    assert.ok(await ctx.compaction.compactNow(handle.agent, new AbortController().signal))
    state.prompt = 'PROMPT-V4'
    const parent = await ask('turn four')
    const summary = parent.snapshotEvents().find(event => event.type === 'compaction/summary')
    const shadowed = await checkpoint.shadowedMessagesForCheckpoint(ctx, parent, summary.data.compactionId)
    const snapshots = shadowed.filter(message => message.role === 'system')
    assert.ok(snapshots.length >= 2, 'the shadowed range really holds in-history prompt snapshots')
    const ordinary = shadowed.filter(message => message.role !== 'system')
    assert.ok(ordinary.some(message => message.role === 'tool'), 'shadowed history holds a tool exchange')

    // Budget: sized for the ordinary history only (one bulky snapshot alone exceeds the slack), so any
    // snapshot that reached the budget calculation would evict ordinary history.
    const need = Math.ceil(ordinary.reduce((sum, message) => sum + JSON.stringify(message).length, 0) * 1.6)
    assert.ok(snapshots.every(message => JSON.stringify(message).length > need * 0.4), 'snapshots are bulky relative to the slack')
    const portable = await checkpoint.portableMessagesForCheckpoint(ctx, parent, summary.data.compactionId, { maxChars: need })
    assert.equal(portable.some(message => message.role === 'system'), false)
    assert.equal(portable.length, ordinary.length, 'the whole ordinary history fits the tight budget')

    // A real fork: the child cannot replay the parent's opaque state, so it goes through portable history.
    const events = parent.snapshotEvents()
    const boundary = events.at(-1).seq
    const fork = await ctx.agents.create({
      sessionId: SessionId('i115-fork-child'),
      seed: buildForkSeed(events, boundary),
      inheritedEventCount: SessionLogOffset(boundary + 1),
      meta: { cwd: root, parentSession: parent.id, isSeeded: true },
      agentOptions: { provider: 'openai', model: 'gpt-5.6-sol' },
    })
    fork.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'child turn' }], source: { kind: 'user' } }))
    await fork.agent.whenIdle()
    const request = raw.at(-1)
    assert.equal(String(request.sessionId), 'i115-fork-child')
    const body = await postedBody(index, bodies, request, { ...routeConfig, portableReplayMaxChars: need }, ctx)
    const everything = JSON.stringify(body.input)
    assert.doesNotMatch(everything, /PROMPT-V[123]/u, 'no superseded snapshot in any role or text form')
    assert.equal(body.input.some(item => item.type === 'compaction'), false, 'a fork never receives parent opaque state')
    assert.match(instructionTexts(body.input, 'developer')[0], /PROMPT-V\d$/u, 'the child head is a current prompt')
    const users = wire(body.input).filter(([role]) => role === 'user').map(([, text]) => text)
    assert.ok(users.some(text => text.startsWith('turn one')), 'ordinary history is replayed')
    assert.ok(users.some(text => text.startsWith('turn two uses a tool')))
    assert.ok(users.includes('child turn'))
    const calls = body.input.filter(item => item.type === 'function_call').map(item => item.call_id)
    const outputs = body.input.filter(item => item.type === 'function_call_output').map(item => item.call_id)
    assert.deepEqual(calls, ['call_probe'])
    assert.deepEqual(outputs, ['call_probe'], 'tool history stays paired')
    await fork.dispose()
    await handle.dispose()
  })
})

test('only DSH system-prompt snapshots are dropped; other system-role history keeps its ordinary-context mapping', () => {
  const snapshot = { role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'old prompt' }] }
  const legacy = { role: 'system', source: { kind: 'user' }, content: [{ type: 'text', text: 'legacy context' }] }
  const user = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }
  assert.deepEqual(checkpoint.withoutSupersededPromptSnapshots([snapshot, user, legacy]), [user, legacy])
})

const failingModelInfo = ctx => new Proxy(ctx, {
  get(target, key) {
    if (key !== 'llm') return Reflect.get(target, key)
    return new Proxy(target.llm, { get: (llm, name) => name === 'resolveModelInfo' ? async () => { throw new Error('model info backend unavailable') } : Reflect.get(llm, name) })
  },
})

test('unreadable model info fails closed when history holds an in-history prompt snapshot, and only then', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i115-failclosed', 'openai', 'gpt-5.6-sol')
    await ask('turn one')
    const plain = raw.at(-1)
    state.prompt = 'PROMPT-V2'
    await ask('turn two')
    const withSnapshot = raw.at(-1)
    assert.equal(withSnapshot.messages.filter(message => message.role === 'system').length, 2, 'precondition: a mid-history snapshot exists')
    const broken = failingModelInfo(ctx)

    // Snapshot present: refused with an identifiable error, nothing reaches the transport.
    const before = bodies.length
    const chunks = []
    for await (const chunk of index.managedResponsesStream({ ...withSnapshot, signal: AbortSignal.timeout(5000) }, routeConfig, broken)) chunks.push(chunk)
    assert.equal(bodies.length, before, 'no request was sent')
    const finish = chunks.at(-1)
    assert.equal(finish.reason.kind, 'error')
    assert.equal(finish.reason.failure.code, 'NO_ADAPTER')
    assert.match(finish.reason.failure.message, /model information.*in-history system prompt updates/u)
    await assert.rejects(
      index.serializeNativeAware(withSnapshot.messages, { provider: 'openai', model: 'gpt-5.6-sol', baseURL, sessionId: String(withSnapshot.sessionId) }, routeConfig, broken, { tools: [] }),
      { code: 'LCX_SYSTEM_PROMPT_MODE_UNKNOWN' },
    )

    // No mid-history snapshot: the conservative default is harmless and the request is sent.
    const sent = await postedBody(index, bodies, plain, routeConfig, broken)
    assert.deepEqual(sent.input.map(item => item.role ?? item.type), ['developer', 'user'])
    await handle.dispose()
  })
})

const snapshotMessage = text => ({ role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text }] })
const otherInstruction = text => ({ role: 'system', source: { kind: 'plugin', plugin: 'fixture' }, content: [{ type: 'text', text }] })
const ofKind = (input, role, text) => input.findIndex(item => item.role === role && textOf(item) === text)
const checkpointFixture = id => ({ snapshotEvents: () => [{ seq: 0, type: 'compaction/start', data: { compactionId: id } }] })
const compactionItem = { type: 'compaction', encrypted_content: 'opaque-fixture' }

test('checkpoint retention drops only items traced to DSH prompt snapshots; other instructions stay', async () => {
  await withHarness(async ({ index, ctx }) => {
    const messages = [
      snapshotMessage('HEAD-PROMPT'), usr('u1'), snapshotMessage('SNAPSHOT-OLD'), usr('u2'),
      otherInstruction('OTHER-INSTRUCTION'), usr('u3'),
    ]
    const route = { provider: 'openai', model: 'gpt-5.6-sol', baseURL, sessionId: 'i115-trace' }
    const prepared = await index.serializeNativeAware(messages, route, routeConfig, ctx, { tools: [] })
    const roles = prepared.input.map(item => item.role ?? item.type)
    assert.deepEqual(roles, ['developer', 'user', 'developer', 'user', 'developer', 'user'], 'both system messages render as instruction items')
    const snapshotAt = ofKind(prepared.input, 'developer', 'SNAPSHOT-OLD')
    assert.deepEqual(prepared.supersededInstructionItems, [snapshotAt], 'exactly the snapshot item is traced, by source and not by text')
    assert.equal(prepared.ephemeralPreludeItemCount, 1)

    const session = checkpointFixture('compact-trace')
    const traced = await checkpoint.createNativeCheckpointBlock({
      ctx: queryContext(session), session, route, result: { compaction: compactionItem },
      input: prepared.input, ephemeralPreludeItemCount: prepared.ephemeralPreludeItemCount, supersededItemIndices: prepared.supersededInstructionItems,
    })
    const kept = traced.nativeOutput
    assert.equal(ofKind(kept, 'developer', 'SNAPSHOT-OLD'), -1, 'the superseded snapshot is gone')
    assert.notEqual(ofKind(kept, 'developer', 'OTHER-INSTRUCTION'), -1, 'a genuine instruction item is retained')
    assert.equal(ofKind(kept, 'developer', 'HEAD-PROMPT'), -1, 'the ephemeral prelude is never retained')
    assert.deepEqual(wire(kept).filter(([role]) => role === 'user').map(([, text]) => text), ['u1', 'u2', 'u3'])
    assert.equal(kept.filter(item => item.type === 'compaction').length, 1)

    // Without provenance nothing is dropped (generic retention contract).
    const untraced = await checkpoint.createNativeCheckpointBlock({
      ctx: queryContext(session), session, route, result: { compaction: compactionItem },
      input: prepared.input, ephemeralPreludeItemCount: prepared.ephemeralPreludeItemCount,
    })
    assert.notEqual(ofKind(untraced.nativeOutput, 'developer', 'SNAPSHOT-OLD'), -1)

    // Other legitimate developer/system items that DSH or another plugin may emit survive next to a snapshot.
    const rawInput = [
      { role: 'developer', content: 'PRELUDE' },
      { role: 'developer', content: 'PLUGIN-DEVELOPER-NOTE' },
      { role: 'system', content: 'PLUGIN-SYSTEM-NOTE' },
      { role: 'developer', content: 'SNAPSHOT-ITEM' },
      { role: 'user', content: [{ type: 'input_text', text: 'question' }] },
    ]
    const mixed = await checkpoint.createNativeCheckpointBlock({
      ctx: queryContext(session), session, route, result: { compaction: compactionItem },
      input: rawInput, ephemeralPreludeItemCount: 1, supersededItemIndices: [3],
    })
    assert.deepEqual(mixed.nativeOutput.slice(0, -1).map(item => item.content?.[0]?.text ?? item.content), ['PLUGIN-DEVELOPER-NOTE', 'PLUGIN-SYSTEM-NOTE', 'question'])
    await assert.rejects(checkpoint.createNativeCheckpointBlock({
      ctx: queryContext(session), session, route, result: { compaction: compactionItem },
      input: rawInput, ephemeralPreludeItemCount: 1, supersededItemIndices: [0],
    }), { code: 'LCX_COMPACTION_PRELUDE_PROVENANCE_INVALID' })
  })
})

test('snapshot provenance stays exact across batches after a native checkpoint (second compaction)', async () => {
  await withHarness(async ({ root, ctx, state }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i115-two-compactions', 'openai', 'gpt-5.6-sol')
    await ask('turn one '.repeat(500))
    state.prompt = 'PROMPT-V2'
    await ask('turn two '.repeat(500))
    assert.ok(await ctx.compaction.compactNow(handle.agent, new AbortController().signal))
    state.prompt = 'PROMPT-V3'
    await ask('turn three '.repeat(500))
    state.prompt = 'PROMPT-V4'
    await ask('turn four '.repeat(500))
    state.prompt = 'PROMPT-V5'
    const session = await ask('turn five '.repeat(500))
    assert.ok(await ctx.compaction.compactNow(handle.agent, new AbortController().signal))
    const summaries = session.snapshotEvents().filter(event => event.type === 'compaction/summary')
    assert.equal(summaries.length, 2)
    const block = summaries.at(-1).data.rawOutput.find(value => String(value.type).includes('lcx-native-compaction'))
    assert.ok(block, 'second checkpoint block exists')
    assert.doesNotMatch(JSON.stringify(block.nativeOutput), /PROMPT-V[1-5]/u, 'no prompt snapshot survives either compaction')
    assert.ok(wire(block.nativeOutput).some(([role, text]) => role === 'user' && text.startsWith('turn')), 'ordinary history is retained')
    await handle.dispose()
  })
})

test('empty prompt snapshots (blanked DSH nodes) add no marker and no items and never break the request', async () => {
  await withHarness(async ({ index, ctx }) => {
    const empties = [
      { role: 'system', source: { kind: 'system-prompt' }, content: [] },
      { role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: '' }] },
    ]
    const messages = [snapshotMessage('HEAD-PROMPT'), usr('u1'), ...empties, usr('u2'), snapshotMessage('LIVE-UPDATE'), usr('u3'), empties[0]]
    const route = { provider: 'openai', model: 'gpt-5.6-sol', baseURL, sessionId: 'i115-empty' }
    const prepared = await index.serializeNativeAware(messages, route, routeConfig, ctx, { tools: [] })
    assert.deepEqual(wire(prepared.input), [['developer', 'HEAD-PROMPT'], ['user', 'u1'], ['user', 'u2'], ['developer', 'LIVE-UPDATE'], ['user', 'u3']], 'no extra items')
    assert.deepEqual(prepared.supersededInstructionItems, [3], 'only the live snapshot is traced')
    assert.doesNotMatch(JSON.stringify(prepared.input), /lcx-prompt-snapshot|\\u0000/u, 'no marker reaches the wire')
    const onlyEmpty = await serializeDshMessages([usr('a'), ...empties, usr('b')], {}, { model: piModel(), systemPromptUpdate: 'in-history' })
    assert.deepEqual(wire(onlyEmpty.input), [['user', 'a'], ['user', 'b']])
    assert.deepEqual(onlyEmpty.supersededInstructionItems, [])
  })
})

// --- serializer-level boundaries (final Responses input of the low-level serializer) ---

const piModel = (overrides = {}) => ({
  id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol', api: 'openai-responses', provider: 'lcx', baseUrl: 'https://example.invalid/v1',
  reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 32768, compat: {}, ...overrides,
})
const sys = text => ({ role: 'system', content: [{ type: 'text', text }] })
const usr = text => ({ role: 'user', content: [{ type: 'text', text }] })

test('a serialization batch that starts with a system update never treats it as the leading prompt', async () => {
  const options = { model: piModel(), systemPromptUpdate: 'in-history', includeSystemPrompt: false }
  for (const tools of [undefined, [tool('probe_tool')]]) {
    const batch = await serializeDshMessages([sys('UPDATE-A'), usr('hello'), sys('UPDATE-B'), usr('again')], {}, { ...options, tools })
    assert.deepEqual(wire(batch.input), [['developer', 'UPDATE-A'], ['user', 'hello'], ['developer', 'UPDATE-B'], ['user', 'again']], `tools=${tools?.length ?? 0}`)
  }
  const nonReasoning = await serializeDshMessages([sys('UPDATE-A'), usr('hello')], {}, { ...options, model: piModel({ reasoning: false }) })
  assert.deepEqual(wire(nonReasoning.input), [['system', 'UPDATE-A'], ['user', 'hello']])
  const noDeveloper = await serializeDshMessages([sys('UPDATE-A')], {}, { ...options, model: piModel({ compat: { supportsDeveloperRole: false } }) })
  assert.deepEqual(wire(noDeveloper.input), [['system', 'UPDATE-A']])
})

test('prelude plus independently serialized batches equals one pass; updates are neither merged nor dropped', async () => {
  const options = { model: piModel(), systemPromptUpdate: 'in-history' }
  const prelude = await serializeDshMessages([], {}, { ...options, systemPrompt: 'HEAD', includeSystemPrompt: true })
  const batchOne = await serializeDshMessages([usr('one'), sys('UPDATE-1'), usr('two')], {}, options)
  const batchTwo = await serializeDshMessages([sys('UPDATE-2'), usr('three')], {}, options)
  const whole = await serializeDshMessages([usr('one'), sys('UPDATE-1'), usr('two'), sys('UPDATE-2'), usr('three')], {}, { ...options, systemPrompt: 'HEAD', includeSystemPrompt: true })
  assert.deepEqual([...prelude.input, ...batchOne.input, ...batchTwo.input], whole.input)
  assert.deepEqual(wire(whole.input), [['developer', 'HEAD'], ['user', 'one'], ['developer', 'UPDATE-1'], ['user', 'two'], ['developer', 'UPDATE-2'], ['user', 'three']])
})

test('empty system messages render nothing; legacy modes keep the user mapping', async () => {
  const empty = { role: 'system', content: [] }
  const inHistory = await serializeDshMessages([usr('a'), empty, sys('UPDATE'), usr('b')], {}, { model: piModel(), systemPromptUpdate: 'in-history' })
  assert.deepEqual(wire(inHistory.input), [['user', 'a'], ['developer', 'UPDATE'], ['user', 'b']])
  for (const mode of [undefined, 'something-else']) {
    const legacy = await serializeDshMessages([sys('UPDATE'), usr('b')], {}, { model: piModel(), systemPromptUpdate: mode })
    assert.deepEqual(wire(legacy.input), [['user', 'UPDATE'], ['user', 'b']], String(mode))
  }
})
