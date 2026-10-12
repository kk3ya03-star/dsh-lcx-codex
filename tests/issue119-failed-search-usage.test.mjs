import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Llm, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import QuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import Projections from '@deepseek-ai/dsh-session-projection'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import apply from '../lib/index.js'
import { auxiliaryUsageOf } from '../lib/search-accounting.js'
import { pluginConfig, providerContext } from './provider-context-fixture.mjs'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionStore from '@deepseek-ai/dsh-session'
import Registry from '@deepseek-ai/dsh-session-projection'
import { applyWebSearchTool } from '@deepseek-ai/dsh-tool-web'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { installFailedAuxiliaryUsage, recordHostedUsage, withAuxiliaryUsage } from '../lib/auxiliary-usage.js'
import { installSearchUsage } from '../lib/search-usage.js'

// Issue 119 item 6: a Hosted search whose response was billed but then failed to parse threw away the
// collected usage, so the billed tokens never reached the session's search usage. DSH builds a failed tool
// result from the thrown error alone (no `meta`); the only seam that may author `meta` on a failure is the
// around-dispatch `tools/execute` wrapper. These tests use the real DSH ToolRuntime, the real
// dsh-tool-web `web_search` (multi-query) and the real session projection.

const usage = (n) => ({ usage: { input_tokens: 100 + n, output_tokens: 10, total_tokens: 110 + n, input_tokens_details: { cached_tokens: 40 } } })

async function runtime(t) {
  const ctx = new Context()
  const fibers = [await ctx.plugin(SystemPrompt), await ctx.plugin(ToolRuntime)]
  fibers.push(await ctx.plugin(installFailedAuxiliaryUsage))
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  return ctx
}
const run = (ctx, name, args = {}) => ctx.tools.execute({ toolCallId: ToolCallId(`call-${name}`), name, arguments: args, signal: new AbortController().signal })

const plain = (execute) => withAuxiliaryUsage({
  name: 'fixture', description: 'fixture', parameters: { type: 'object' },
  output: { schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, render: () => [{ type: 'text', text: 'ok' }], presentationMeta: () => ({ kind: 'web' }) },
  execute,
})

test('billed usage survives a tool body that throws', async (t) => {
  const ctx = await runtime(t)
  ctx.tools.register(plain(async () => {
    recordHostedUsage(usage(0), 'req-1', 'relay', 'gpt-test')
    throw new Error('Hosted Search response was incomplete')
  }))
  const result = await run(ctx, 'fixture')
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /incomplete/u)
  assert.deepEqual(result.meta.auxiliaryUsage, [{
    requestId: 'req-1', provider: 'relay', model: 'gpt-test',
    usage: { inputTokens: 60, outputTokens: 10, totalTokens: 110, cacheReadTokens: 40, cacheWriteTokens: 0 },
  }])
})

test('a failure that billed nothing stays a plain error without meta', async (t) => {
  const ctx = await runtime(t)
  ctx.tools.register(plain(async () => { throw new Error('route unavailable') }))
  const result = await run(ctx, 'fixture')
  assert.equal(result.isError, true)
  assert.equal(result.meta, undefined)
})

test('a successful call is unchanged', async (t) => {
  const ctx = await runtime(t)
  ctx.tools.register(plain(async () => { recordHostedUsage(usage(0), 'req-ok', 'relay', 'gpt-test'); return { text: 'x' } }))
  const result = await run(ctx, 'fixture')
  assert.equal(result.isError, false)
  assert.equal(result.meta.auxiliaryUsage.length, 1)
})

test('multi-query web_search: the first failure rejects the whole call, and every settled query is still billed', async (t) => {
  const ctx = await runtime(t)
  let definition
  const calls = []
  const composition = {
    web: {
      async search({ query }) {
        calls.push(query)
        // Both queries reach the provider and are billed; the second one's response cannot be parsed.
        recordHostedUsage(usage(calls.length), `req-${query}`, 'relay', 'gpt-test')
        if (query === 'beta') throw Object.assign(new Error('Hosted Search response was incomplete'), { code: 'WEB_RESPONSE_INCOMPLETE' })
        return { content: 'alpha answer', sources: [{ url: 'https://a.example/' }], truncated: false }
      },
    },
    tools: { register(candidate) { definition = candidate; return () => {} } },
    systemPrompt: { getSectionOrder: () => 0, section: () => () => {} },
  }
  applyWebSearchTool(composition, 5, 5, 60000, false)
  ctx.tools.register(withAuxiliaryUsage(definition))
  const result = await run(ctx, 'web_search', { queries: ['alpha', 'beta'] })
  assert.equal(result.isError, true, 'DSH rejects the whole call')
  assert.deepEqual(result.meta.auxiliaryUsage.map((record) => record.requestId).sort(), ['req-alpha', 'req-beta'])
})

test('the failed result folds into the session search usage projection', async (t) => {
  const ctx = await runtime(t)
  const fibers = [await ctx.plugin(SessionStore), await ctx.plugin(Registry), await ctx.plugin(installSearchUsage)]
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  ctx.tools.register(withAuxiliaryUsage({
    name: 'web_search', description: 'search', parameters: { type: 'object' },
    output: { schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, render: () => [{ type: 'text', text: 'ok' }], presentationMeta: () => ({ kind: 'web' }) },
    async execute() {
      recordHostedUsage(usage(0), 'req-proj', 'relay', 'gpt-test')
      throw new Error('Hosted Search response was incomplete')
    },
  }))
  const result = await run(ctx, 'web_search')
  const session = ctx.sessions.create()
  session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('call-web_search'), name: 'web_search', arguments: '{}' })
  session.append('tool/result', {
    turn: 1, step: 1, meta: result.meta,
    message: createToolResultMessage({ callId: ToolCallId('call-web_search'), content: result.content, isError: true }),
  }, { surfaceOp: 'append' })
  const state = ctx.sessionProjections.stateOf(session, 'lcxSearchUsage')
  assert.deepEqual(state.auxiliary, { uncachedInputTokens: 60, outputTokens: 10, cacheReadTokens: 40, cacheWriteTokens: 0 })
})

class FixtureAdapter extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 200000 } } }
  async *stream() { yield { type: 'finish', reason: { kind: 'stop' } } }
}

test('plugin wiring: a real Agent whose Hosted search was billed and then failed persists the usage on the failed tool/result', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'lcx-119-search-'))
  const ctx = new Context()
  let handle
  t.after(async () => { await handle?.dispose(); await rm(root, { recursive: true, force: true }) })
  ctx.plugin(Llm)
  ctx.plugin(Sessions)
  ctx.plugin(Jsonl, { root: resolve(root, 'sessions') })
  ctx.plugin(QuerySqlite, { path: ':memory:', openAt: 'never' })
  ctx.plugin(Projections)
  ctx.plugin(SystemPrompt)
  ctx.plugin(Tools)
  ctx.plugin(Agents)
  ctx.plugin(AgentLoop)
  await new Promise((done) => setTimeout(done, 500))
  ctx.llm.registerAdapter(['fixture'], new FixtureAdapter())
  const baseURL = 'https://fixture.invalid/v1'
  const profiles = providerContext({ fixture: { api: 'openai-responses', baseURL, apiKeyEnv: 'FIXTURE_KEY' } })
  const pluginCtx = {
    llm: profiles.llm, sessions: ctx.sessions, tools: ctx.tools,
    settings: { ...profiles.settings, configure: () => () => {} },
    web: {}, credentials: { resolve: async () => ({ value: 'fixture-only' }) }, attachments: {}, fs: {},
    logger: { info() {}, warn() {} },
    get(name) { return this[name] },
    on: ctx.on.bind(ctx), effect() {}, inject() {},
  }
  apply(pluginCtx, pluginConfig({ enabled: true, webSearch: true, advancedHostedSearch: true }))
  // The provider answers 200 with a billed but incomplete response, so parsing throws after the usage was recorded.
  const usageBody = { input_tokens: 5000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 300, total_tokens: 5300 }
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ id: 'resp_1', status: 'incomplete', usage: usageBody, output: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
  let calls = 0
  ctx.on('llm/stream', () => {
    calls += 1
    const first = calls === 1
    return (async function* () {
      if (first) {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: 'call_search', name: 'websearch_gpt_advanced', argumentsDelta: '{"query":"q"}' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_search', name: 'websearch_gpt_advanced', arguments: '{"query":"q"}' } }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  }, { prepend: true })
  handle = await ctx.agents.create({ sessionId: SessionId('i119-search'), meta: { cwd: root }, agentOptions: { provider: 'fixture', model: 'gpt-search' } })
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'search please' }], source: { kind: 'user' } }))
  await handle.agent.whenIdle()
  const events = handle.agent.session.snapshotEvents()
  const result = events.find((event) => event.type === 'tool/result')
  assert.ok(result, 'the search call produced a tool/result')
  assert.equal(result.data.message.isError, true)
  const records = auxiliaryUsageOf(result, 'websearch_gpt_advanced')
  assert.equal(records.length, 1)
  assert.deepEqual(records[0].usage, { inputTokens: 5000, outputTokens: 300, totalTokens: 5300, cacheReadTokens: 0, cacheWriteTokens: 0 })
})
