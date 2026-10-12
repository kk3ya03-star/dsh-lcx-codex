import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
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
import { resolveResponsesRouteConfig } from '../lib/route.js'

// Issue #120: native addition-only tool updates on GPT Responses routes. Everything below runs the real DSH
// agent loop, session, llm runtime and the real llm-pi-ai catalog adapter (which declares
// `toolUpdate: addition-only` for gpt-5.6-sol), and asserts on the Responses request body LCX would POST.

const baseURL = 'https://fixture.invalid/v1'
const ANCHORED = { supportsAdditionalTools: true, supportsToolSearch: true }
const routeConfig = { baseURL, portableReplayMaxChars: 200000, responsesCompat: ANCHORED }
const tool = (name, extra = {}) => ({ name, description: `${name} tool`, parameters: { type: 'object', properties: {}, additionalProperties: false }, ...extra })
const textOf = item => typeof item.content === 'string' ? item.content : (item.content ?? []).map(part => part.text ?? '').join('')
const kind = item => item.type === 'additional_tools' ? 'additional_tools' : (item.role ?? item.type)
const additions = body => body.input.filter(item => item.type === 'additional_tools')
const addedNames = body => additions(body).flatMap(item => item.tools.map(entry => entry.name))
/** Every tool the model can call: the request `tools` plus everything declared by history additions. */
const visible = body => [...(body.tools ?? []).map(entry => entry.name), ...addedNames(body)].sort()

const [checkpoint] = await Promise.all([loadHostSource('native-checkpoint')])

const loadIndexInternals = () => loadSource('index', 'serializeNativeAware, managedResponsesStream, remoteCompactionStream')

async function harness(root, index) {
  const ctx = new Context()
  ctx.plugin(Llm)
  ctx.plugin(PiAi, {
    providers: {
      openai: {},
      // llm-pi-ai refuses to let a profile set supportsMidConvoSystemMessages: a custom-named route never declares toolUpdate.
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
        const prepared = await index.serializeNativeAware(options.messages, route, routeConfig, ctx, { tools: [...(options.tools ?? [])], toolSurface: { history: options.toolHistory } })
        compactionInputs.push(prepared)
        const session = ctx.sessions.get(SessionId(String(options.sessionId)))
        const result = { compaction: { type: 'compaction', encrypted_content: 'FAKE-OPAQUE-PLACEHOLDER' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
        const block = await checkpoint.createNativeCheckpointBlock({ ctx, session, route, result, input: prepared.input, ephemeralPreludeItemCount: prepared.ephemeralPreludeItemCount, supersededItemIndices: prepared.supersededInstructionItems, imageMap: prepared.imageMap, retentionOptions: {} })
        yield* checkpoint.nativeCheckpointChunks(block, result.usage)
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
  const compactionInputs = []
  const state = { prompt: 'PROMPT-V1', tools: [] }
  ctx.systemPrompt.section({ name: 'issue120-probe', order: 5, text: () => state.prompt })
  ctx.systemPrompt.tools(() => ({ schemas: state.tools.map(schema => structuredClone(schema)) }))
  ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-only' }) }, true)
  return { ctx, raw, state, compactionInputs }
}

async function withHarness(run) {
  const root = await mkdtemp(resolve('.i120-'))
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

test('addition: request tools stay anchored to the initial set and later tools appear as additional_tools in history order', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i120-add', 'openai', 'gpt-5.6-sol')
    const info = await ctx.llm.resolveModelInfo('openai', 'gpt-5.6-sol')
    assert.equal(info.toolUpdate, 'addition-only', 'the real host adapter declares addition-only for the catalog route')
    const posted = []
    state.tools = [tool('tool_a')]
    await ask('one')
    posted.push(await postedBody(index, bodies, raw.at(-1), routeConfig, ctx))
    state.tools = [tool('tool_a'), tool('tool_b')]
    await ask('two')
    posted.push(await postedBody(index, bodies, raw.at(-1), routeConfig, ctx))
    state.tools = [tool('tool_a'), tool('tool_b'), tool('tool_c', { deferLoading: true })]
    await ask('three')
    const request = raw.at(-1)
    assert.ok(request.messages.some(message => message.role === 'developer' && message.content.some(block => block.type === 'tool-addition')), 'host really produced developer tool-addition messages')
    assert.ok(request.tools.some(schema => schema.deferLoading === true), 'host really produced a deferLoading declaration')
    posted.push(await postedBody(index, bodies, request, routeConfig, ctx))

    const toolsWire = posted.map(body => JSON.stringify(body.tools))
    assert.deepEqual(posted[0].tools.map(entry => entry.name), ['tool_a'])
    assert.equal(new Set(toolsWire).size, 1, 'request tools are byte-identical on every request')
    assert.deepEqual(addedNames(posted[0]), [])
    assert.deepEqual(addedNames(posted[1]), ['tool_b'])
    assert.deepEqual(addedNames(posted[2]), ['tool_b', 'tool_c'], 'deferLoading tool is declared by its addition, never at the top level')
    for (const body of posted) {
      const serialized = JSON.stringify(body)
      assert.doesNotMatch(serialized, /deferLoading|defer_loading|tool-addition|tool-removal|tool_search/u)
      assert.equal(body.input.filter(item => item.type === undefined && item.role === 'developer').length, 1, 'no developer instruction item other than the head')
    }
    assert.deepEqual(posted[2].input.map(kind), ['developer', 'user', 'assistant', 'user', 'additional_tools', 'assistant', 'user', 'additional_tools'], 'additions sit at their history position after the turn that introduced the tool')
    // Byte stability: each earlier request is an exact prefix of the next one, so the cached prefix survives every addition.
    for (let index2 = 1; index2 < posted.length; index2 += 1) {
      const previous = posted[index2 - 1].input
      assert.deepEqual(posted[index2].input.slice(0, previous.length).map(item => JSON.stringify(item)), previous.map(item => JSON.stringify(item)), `request ${index2 + 1} extends request ${index2} byte for byte`)
    }
    assert.deepEqual(visible(posted[2]), ['tool_a', 'tool_b', 'tool_c'], 'the model can call exactly the active tool set')
    const added = additions(posted[1])[0]
    assert.equal(added.role, 'developer')
    assert.equal(added.tools[0].type, 'function')
    assert.equal(added.tools[0].name, 'tool_b')
    await handle.dispose()
  })
})

test('removal and redefinition fall back to host semantics without errors: the visible tools always equal the active tools', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i120-remove', 'openai', 'gpt-5.6-sol')
    const step = async (text, tools) => {
      state.tools = tools
      await ask(text)
      const body = await postedBody(index, bodies, raw.at(-1), routeConfig, ctx)
      assert.deepEqual(visible(body), tools.map(entry => entry.name).sort(), `visible tools after "${text}"`)
      assert.doesNotMatch(JSON.stringify(body), /deferLoading|defer_loading|tool-addition|tool-removal/u)
      return body
    }
    const base = await step('one', [tool('tool_a'), tool('tool_b')])
    const added = await step('two', [tool('tool_a'), tool('tool_b'), tool('tool_c')])
    assert.deepEqual(added.tools.map(entry => entry.name), ['tool_a', 'tool_b'])
    assert.deepEqual(addedNames(added), ['tool_c'])
    assert.deepEqual(base.tools.map(entry => entry.name), ['tool_a', 'tool_b'])
    // Removing an initial tool shrinks the anchored list once; the earlier addition stays in history.
    const removed = await step('three', [tool('tool_a'), tool('tool_c')])
    assert.deepEqual(removed.tools.map(entry => entry.name), ['tool_a'])
    assert.deepEqual(addedNames(removed), ['tool_c'])
    // The shrunk list is the new stable anchor.
    const again = await step('four', [tool('tool_a'), tool('tool_c'), tool('tool_d')])
    assert.equal(JSON.stringify(again.tools), JSON.stringify(removed.tools))
    assert.deepEqual(addedNames(again), ['tool_c', 'tool_d'])
    // Redefining a tool under the same name starts a new declaration series: the complete current list, no additions.
    const redefined = await step('five', [tool('tool_a', { description: 'changed definition' }), tool('tool_c'), tool('tool_d')])
    assert.deepEqual(redefined.tools.map(entry => entry.name), ['tool_a', 'tool_c', 'tool_d'])
    assert.deepEqual(addedNames(redefined), [])
    // Additions work again on top of the new baseline.
    const after = await step('six', [tool('tool_a', { description: 'changed definition' }), tool('tool_c'), tool('tool_d'), tool('tool_e')])
    assert.equal(JSON.stringify(after.tools), JSON.stringify(redefined.tools))
    assert.deepEqual(addedNames(after), ['tool_e'])
    await handle.dispose()
  })
})

test('rollback switch, routes without compat and custom-named routes keep the complete tool list on every request', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i120-full', 'openai', 'gpt-5.6-sol')
    state.tools = [tool('tool_a')]
    await ask('one')
    state.tools = [tool('tool_a'), tool('tool_b'), tool('tool_c', { deferLoading: true })]
    await ask('two')
    const request = raw.at(-1)
    // Contrast: the same request on the default policy is anchored (the switch below is what changes it).
    const anchored = await postedBody(index, bodies, request, routeConfig, ctx)
    assert.deepEqual(anchored.tools.map(entry => entry.name), ['tool_a'])
    assert.deepEqual(addedNames(anchored), ['tool_b', 'tool_c'])
    for (const [label, config] of [
      ['toolUpdates=full', { ...routeConfig, toolUpdates: 'full' }],
      ['explicit compat opt-out of both declaration kinds', { baseURL, portableReplayMaxChars: 200000, responsesCompat: { supportsAdditionalTools: false, supportsToolSearch: false } }],
      ['explicit opt-out of additional_tools without tool_search', { baseURL, portableReplayMaxChars: 200000, responsesCompat: { supportsAdditionalTools: false } }],
    ]) {
      const body = await postedBody(index, bodies, request, config, ctx)
      assert.deepEqual(body.tools.map(entry => entry.name), ['tool_a', 'tool_b', 'tool_c'], label)
      assert.doesNotMatch(JSON.stringify(body), /deferLoading|defer_loading|tool-addition|additional_tools|tool_search/u, label)
    }
    // Without the DSH tool history the host cannot vouch for the updates: full list.
    const noHistory = await postedBody(index, bodies, { ...request, toolHistory: undefined }, routeConfig, ctx)
    assert.deepEqual(noHistory.tools.map(entry => entry.name), ['tool_a', 'tool_b', 'tool_c'])
    assert.equal(additions(noHistory).length, 0)
    await handle.dispose()

    // A custom-named route has no toolUpdate: DSH itself starts a series per change and LCX sends the full list.
    const plain = await startAgent(ctx, root, 'i120-plain', 'lcxplain', 'gpt-5.6-sol')
    assert.equal((await ctx.llm.resolveModelInfo('lcxplain', 'gpt-5.6-sol')).toolUpdate, undefined)
    state.tools = [tool('tool_a')]
    await plain.ask('one')
    state.tools = [tool('tool_a'), tool('tool_b')]
    await plain.ask('two')
    const body = await postedBody(index, bodies, raw.at(-1), routeConfig, ctx)
    assert.deepEqual(body.tools.map(entry => entry.name), ['tool_a', 'tool_b'])
    assert.equal(additions(body).length, 0)
    await plain.handle.dispose()
  })
})

test('a route that supports only tool_search declares additions as tool_search call/output', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i120-search', 'openai', 'gpt-5.6-sol')
    state.tools = [tool('tool_a')]
    await ask('one')
    state.tools = [tool('tool_a'), tool('tool_b')]
    await ask('two')
    const config = { ...routeConfig, responsesCompat: { supportsAdditionalTools: false, supportsToolSearch: true } }
    const body = await postedBody(index, bodies, raw.at(-1), config, ctx)
    assert.deepEqual(body.tools.map(entry => entry.name), ['tool_a'])
    const call = body.input.find(item => item.type === 'tool_search_call')
    const output = body.input.find(item => item.type === 'tool_search_output')
    assert.ok(call && output, 'tool_search call and output are present')
    assert.equal(call.call_id, output.call_id)
    assert.deepEqual(output.tools.map(entry => [entry.name, entry.defer_loading]), [['tool_b', true]])
    assert.equal(additions(body).length, 0)
    await handle.dispose()
  })
})

test('compaction: the request carries additional_tools, the checkpoint keeps none, and the new series starts from the full list', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state, compactionInputs }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i120-compact', 'openai', 'gpt-5.6-sol')
    state.tools = [tool('tool_a')]
    await ask('turn one '.repeat(400))
    state.tools = [tool('tool_a'), tool('tool_b')]
    await ask('turn two '.repeat(400))
    assert.ok(await ctx.compaction.compactNow(handle.agent, new AbortController().signal), 'real DSH compaction wrote a native checkpoint')
    assert.equal(compactionInputs.length, 1)
    const prepared = compactionInputs[0]
    assert.deepEqual(prepared.tools.map(entry => entry.name), ['tool_a'], 'the compaction request keeps the anchored tools')
    assert.deepEqual(addedNames({ input: prepared.input }), ['tool_b'], 'and declares the addition in its input')
    const session = handle.agent.session
    const summary = session.snapshotEvents().find(event => event.type === 'compaction/summary')
    assert.doesNotMatch(JSON.stringify(summary.data.rawOutput), /additional_tools/u, 'the checkpoint retains no tool declaration items')

    state.tools = [tool('tool_a'), tool('tool_b')]
    await ask('turn three')
    const first = await postedBody(index, bodies, raw.at(-1), routeConfig, ctx)
    assert.ok(first.input.some(item => item.type === 'compaction'), 'native replay item is present')
    assert.deepEqual(first.tools.map(entry => entry.name), ['tool_a', 'tool_b'], 'the new series declares every active tool up front')
    assert.equal(additions(first).length, 0)
    state.tools = [tool('tool_a'), tool('tool_b'), tool('tool_c')]
    await ask('turn four')
    const second = await postedBody(index, bodies, raw.at(-1), routeConfig, ctx)
    assert.equal(JSON.stringify(second.tools), JSON.stringify(first.tools))
    assert.deepEqual(addedNames(second), ['tool_c'])
    const previous = first.input.map(item => JSON.stringify(item))
    assert.deepEqual(second.input.slice(0, previous.length).map(item => JSON.stringify(item)), previous, 'post-compaction prefix is byte-stable')

    // Portable route migration replays plain history: no developer updates, the migrated route's own tool surface.
    const migrated = await index.serializeNativeAware(raw.at(-1).messages, { provider: 'openai', model: 'gpt-5.5', baseURL, sessionId: String(raw.at(-1).sessionId) }, routeConfig, ctx, { tools: [...raw.at(-1).tools], toolSurface: { history: raw.at(-1).toolHistory } })
    assert.equal(migrated.input.some(item => item.type === 'compaction'), false, 'no parent opaque state on migration')
    assert.deepEqual(visible({ tools: migrated.tools, input: migrated.input }), ['tool_a', 'tool_b', 'tool_c'])
    await handle.dispose()
  })
})

test('restart: a resumed session rebuilds the identical anchored request prefix', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    const first = await startAgent(ctx, root, 'i120-restart', 'openai', 'gpt-5.6-sol')
    state.tools = [tool('tool_a')]
    await first.ask('one')
    state.tools = [tool('tool_a'), tool('tool_b')]
    await first.ask('two')
    const before = await postedBody(index, bodies, raw.at(-1), routeConfig, ctx)
    await ctx.sessions.flush(first.handle.agent.session)
    await first.handle.dispose()
    const reopened = await harness(root, index)
    const resumed = await reopened.ctx.agents.resume({ resumeSessionId: SessionId('i120-restart'), agentOptions: { provider: 'openai', model: 'gpt-5.6-sol' } })
    assert.ok(resumed.agent.session.toolHistory().updates.length > 0, 'DSH rebuilt the tool history from the log')
    reopened.state.tools = [tool('tool_a'), tool('tool_b'), tool('tool_c')]
    resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'three' }], source: { kind: 'user' } }))
    await resumed.agent.whenIdle()
    const after = await postedBody(index, bodies, reopened.raw.at(-1), routeConfig, reopened.ctx)
    assert.equal(JSON.stringify(after.tools), JSON.stringify(before.tools))
    const previous = before.input.map(item => JSON.stringify(item))
    assert.deepEqual(after.input.slice(0, previous.length).map(item => JSON.stringify(item)), previous, 'restored history re-renders byte for byte')
    assert.deepEqual(addedNames(after), ['tool_b', 'tool_c'])
    await resumed.handle?.dispose?.()
  })
})

test('self check: an inconsistent host projection falls back to the full list and clears deferLoading', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i120-selfcheck', 'openai', 'gpt-5.6-sol')
    state.tools = [tool('tool_a')]
    await ask('one')
    state.tools = [tool('tool_a'), tool('tool_b', { deferLoading: true })]
    await ask('two')
    const request = raw.at(-1)
    assert.ok(request.tools.some(schema => schema.deferLoading === true))
    const intact = await postedBody(index, bodies, request, routeConfig, ctx)
    assert.deepEqual(addedNames(intact), ['tool_b'], 'contrast: the consistent request is anchored')
    // Drop the recorded developer message: the history still names an update the messages no longer hold.
    const stripped = { ...request, messages: request.messages.filter(message => message.role !== 'developer') }
    const body = await postedBody(index, bodies, stripped, routeConfig, ctx)
    assert.deepEqual(body.tools.map(entry => entry.name), ['tool_a', 'tool_b'], 'the deferred tool stays callable')
    assert.equal(additions(body).length, 0)
    assert.doesNotMatch(JSON.stringify(body), /deferLoading|defer_loading/u)
    await handle.dispose()
  })
})

test('serializer contract: developer updates need an anchored in-history route, removals and undeclared tools are rejected', async () => {
  const developer = (...blocks) => ({ id: 'dev-1', role: 'developer', content: blocks, source: { kind: 'tool-registry' } })
  const user = text => ({ id: 'u-1', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
  const common = { route: { provider: 'openai', model: 'gpt-5.6-sol' }, includeSystemPrompt: false, responsesCompat: ANCHORED }
  const tools = [tool('tool_a'), tool('tool_b', { deferLoading: true })]
  const update = developer({ type: 'tool-addition', toolName: 'tool_b' })
  await assert.rejects(serializeDshMessages([update, user('hi')], undefined, { ...common, tools, systemPromptUpdate: 'in-history' }), /developer message/u, 'not anchored')
  await assert.rejects(serializeDshMessages([user('hi')], undefined, { ...common, tools, systemPromptUpdate: 'in-history' }), /deferLoading/u, 'not anchored')
  await assert.rejects(serializeDshMessages([update], undefined, { ...common, tools, toolUpdate: 'addition-only' }), /in-history/u, 'anchoring needs an in-history route')
  await assert.rejects(serializeDshMessages([developer({ type: 'tool-removal', toolName: 'tool_a' })], undefined, { ...common, tools, toolUpdate: 'addition-only', systemPromptUpdate: 'in-history' }), /tool-removal/u)
  await assert.rejects(serializeDshMessages([developer({ type: 'tool-addition', toolName: 'ghost' })], undefined, { ...common, tools, toolUpdate: 'addition-only', systemPromptUpdate: 'in-history' }), /undeclared tool "ghost"/u)
  const ok = await serializeDshMessages([user('hi'), update, user('go')], undefined, { ...common, tools, toolUpdate: 'addition-only', systemPromptUpdate: 'in-history' })
  assert.deepEqual(ok.tools.map(entry => entry.name), ['tool_a'])
  assert.deepEqual(ok.input.map(kind), ['user', 'additional_tools', 'user'])
})

test('plugin wiring: incrementalToolUpdates is on by default, resolves compat from the real route, and an explicit off sends the full list', async () => {
  const { default: apply, Config } = await import('../lib/index.js')
  await withHarness(async ({ root, bodies, ctx, raw, state }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i120-wiring', 'openai', 'gpt-5.6-sol')
    state.tools = [tool('tool_a')]
    await ask('one')
    state.tools = [tool('tool_a'), tool('tool_b')]
    await ask('two')
    const request = raw.at(-1)
    assert.equal(Config.dict.incrementalToolUpdates.meta.volatile, true)
    const profiles = { openai: { api: 'openai-responses', baseURL, apiKeyEnv: 'LCX_FIXTURE_KEY' } }
    const post = async values => {
      const handlers = new Map()
      const host = {
        logger: { info() {}, warn() {} },
        llm: Object.assign(Object.create(ctx.llm), { listConfigurableProviders: () => [{ provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] }] }),
        settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: profiles } }], configure: () => () => {} },
        sessions: ctx.sessions, attachments: ctx.attachments, fs: ctx.fs, web: {}, tools: { register() { throw new Error('unexpected') } },
        credentials: { resolve: async () => ({ value: 'fixture-only' }) },
        get(name) { return this[name] }, inject() {}, on(name, handler) { handlers.set(name, handler) }, effect(setup) { setup() },
      }
      apply(host, Config({ enabled: true, maxAttempts: 1, ...values }))
      const before = bodies.length
      for await (const _chunk of handlers.get('llm/stream')({ ...request, signal: AbortSignal.timeout(5000) }, () => { throw new Error('LCX must own this route') })) void _chunk
      assert.equal(bodies.length, before + 1)
      return bodies.at(-1)
    }
    const byDefault = await post({})
    assert.deepEqual(byDefault.tools.map(entry => entry.name), ['tool_a'], 'default: anchored')
    assert.deepEqual(addedNames(byDefault), ['tool_b'])
    const off = await post({ incrementalToolUpdates: false })
    assert.deepEqual(off.tools.map(entry => entry.name), ['tool_a', 'tool_b'], 'explicit off: complete list')
    assert.equal(additions(off).length, 0)
    await handle.dispose()
  })
})

test('the declaration shape comes from the compat: explicit additional_tools / tool_search anchor, silence sends the complete list (#125)', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i120-silent', 'openai', 'gpt-5.6-sol')
    state.tools = [tool('tool_a')]
    await ask('one')
    state.tools = [tool('tool_a'), tool('tool_b')]
    await ask('two')
    const post = responsesCompat => postedBody(index, bodies, raw.at(-1), { baseURL, portableReplayMaxChars: 200000, responsesCompat }, ctx)
    // Silent about both shapes (nothing the bundled catalog or the profile says): no guess, the complete tool list.
    for (const responsesCompat of [undefined, {}, { supportsStrictMode: true }]) {
      const body = await post(responsesCompat)
      assert.deepEqual(body.tools.map(entry => entry.name), ['tool_a', 'tool_b'], JSON.stringify(responsesCompat))
      assert.equal(additions(body).length, 0, JSON.stringify(responsesCompat))
    }
    // An explicit additional_tools declaration anchors the request tools and adds by additional_tools.
    const additional = await post({ supportsAdditionalTools: true })
    assert.deepEqual(additional.tools.map(entry => entry.name), ['tool_a'])
    assert.deepEqual(addedNames(additional), ['tool_b'])
    // An explicit tool_search declaration selects the tool_search shape.
    const search = await post({ supportsToolSearch: true })
    assert.equal(additions(search).length, 0)
    assert.ok(search.input.some(item => item.type === 'tool_search_output'))
    // Both supported: additional_tools wins, as in Pi.
    const both = await post({ supportsAdditionalTools: true, supportsToolSearch: true })
    assert.deepEqual(addedNames(both), ['tool_b'])
    await handle.dispose()
  })
})

test('declarationKind: only a stated shape is used, and a silent or declining compat yields none', async () => {
  const { declarationKind } = await import('../lib/tool-surface.js')
  assert.equal(declarationKind(undefined), undefined)
  assert.equal(declarationKind({}), undefined)
  assert.equal(declarationKind({ supportsAdditionalTools: false, supportsToolSearch: false }), undefined)
  assert.equal(declarationKind({ supportsAdditionalTools: true }), 'additional_tools')
  assert.equal(declarationKind({ supportsToolSearch: true }), 'tool_search')
  assert.equal(declarationKind({ supportsAdditionalTools: false, supportsToolSearch: true }), 'tool_search')
  assert.equal(declarationKind({ supportsAdditionalTools: true, supportsToolSearch: true }), 'additional_tools')
})

test('the compat of a route comes from the bundled catalog or the profile; a model neither describes stays silent (#125)', () => {
  const profile = compat => ({ openai: { api: 'openai-responses', baseURL, apiKeyEnv: 'K', models: [{ id: 'gpt-9-unknown', ...(compat === undefined ? {} : { compat }) }] } })
  const context = profiles => ({ llm: { listConfigurableProviders: () => [{ provider: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] }] }, settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: profiles } }] } })
  const resolve = (profiles, model) => resolveResponsesRouteConfig(context(profiles), { provider: 'openai', model }, {}).responsesCompat
  // Catalog-explicit: a Pi 1.1.0 catalog model states both shapes.
  const catalog = resolve({ openai: { api: 'openai-responses', baseURL, apiKeyEnv: 'K' } }, 'gpt-6-sol')
  assert.equal(catalog.supportsAdditionalTools, true)
  assert.equal(catalog.supportsToolSearch, true)
  // Profile-explicit (read from the profile as written; DSH itself does not let a profile set these two).
  assert.equal(resolve(profile({ supportsToolSearch: true }), 'gpt-9-unknown').supportsToolSearch, true)
  assert.equal(resolve(profile({ supportsAdditionalTools: true }), 'gpt-9-unknown').supportsAdditionalTools, true)
  // Unknown: no catalog entry and nothing in the profile.
  const unknown = resolve(profile(), 'gpt-9-unknown')
  assert.equal(unknown.supportsAdditionalTools, undefined)
  assert.equal(unknown.supportsToolSearch, undefined)
})

test('falling back although the host declared addition-only is reported once per session with a fixed reason; deliberate settings are not', async () => {
  await withHarness(async ({ root, index, bodies, ctx, raw, state }) => {
    const { handle, ask } = await startAgent(ctx, root, 'i120-warn', 'openai', 'gpt-5.6-sol')
    state.tools = [tool('tool_a')]
    await ask('one')
    state.tools = [tool('tool_a'), tool('tool_b')]
    await ask('two')
    const warnings = []
    const debugs = []
    const host = new Proxy(ctx, { get: (target, property) => property === 'logger' ? { warn: m => { if (/tool updates/u.test(String(m))) warnings.push(String(m)) }, debug: m => { if (/tool updates/u.test(String(m))) debugs.push(String(m)) }, info() {} } : Reflect.get(target, property) })
    const request = { ...raw.at(-1), toolHistory: undefined }
    for (let round = 0; round < 2; round += 1) await postedBody(index, bodies, request, routeConfig, host)
    assert.equal(warnings.length, 1, 'once per session and reason')
    assert.match(warnings[0], /complete tool list on openai\/gpt-5\.6-sol \(no DSH tool history\)/u)
    assert.doesNotMatch(warnings[0], /fixture-only|authorization|bearer/iu)
    await postedBody(index, bodies, raw.at(-1), { ...routeConfig, responsesCompat: { supportsAdditionalTools: false, supportsToolSearch: false } }, host)
    await postedBody(index, bodies, raw.at(-1), { ...routeConfig, toolUpdates: 'full' }, host)
    assert.equal(warnings.length, 1, 'an explicit compat opt-out and the full switch are deliberate and not warned')
    assert.equal(debugs.length, 1, 'the opt-out is recorded at debug level')
    await handle.dispose()
  })
})
