import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { updateVolatile } from '@deepseek-ai/cosmokit'
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
import apply, { Config } from '../lib/index.js'

// Issue #120, real path. The first live A/B on DSH 0.2.1-alpha.2 sent the full tool list although the host had
// recorded a normal tool-registry addition: the tool arrived through LCX's own settings switch
// (advancedHostedSearch -> syncAgentTools -> agent-scoped register), the route was `openai/gpt-6-sol` with a
// provider profile whose model entry only carries `compat: { supportsStrictMode: true }`, and gpt-6-sol is
// outside LCX's frozen Pi 0.86 catalog, so LCX's own route compat held no additional_tools/tool_search flag.
// Nothing here edits the tool list directly: the LCX plugin is installed on the real DSH context and registers
// the tool through its settings handling; the request body is captured at the transport.

const baseURL = 'https://fixture.invalid/v1'
const additions = body => body.input.filter(item => item.type === 'additional_tools')
const addedNames = body => additions(body).flatMap(item => item.tools.map(entry => entry.name))
const names = body => (body.tools ?? []).map(entry => entry.name)

function sse(text) {
  const output = [{ type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }]
  const events = [{ type: 'response.completed', response: { id: 'resp_fixture', model: 'fixture', status: 'completed', output, usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 } } } }]
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
}

/** The provider profile shape of the real QA home: a catalog vendor name with a model entry carrying only supportsStrictMode. */
const profile = model => ({
  apiKeyEnv: 'LCX_FIXTURE_KEY',
  api: 'openai-responses',
  baseURL,
  models: [{ id: model, name: model, input: ['text', 'image'], compat: { supportsStrictMode: true }, reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } }],
})

async function realPluginHarness(root, model, settings = {}) {
  const profiles = { openai: profile(model) }
  const ctx = new Context()
  ctx.plugin(Llm)
  ctx.plugin(PiAi, { providers: { openai: profiles.openai } })
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
  ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-only' }) }, true)
  const handlers = new Map()
  const warnings = []
  const overrides = {
    logger: { info() {}, debug() {}, warn(message) { warnings.push(String(message)) }, error() {} },
    settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: profiles } }], configure: () => () => {} },
    web: { searchProviderId: 'native', registerSearchProvider: () => () => {} },
  }
  const host = new Proxy(ctx, {
    get(target, property) {
      if (property in overrides) return overrides[property]
      if (property === 'on') return (name, handler, options) => { handlers.set(name, handler); return target.on(name, handler, options) }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const configInput = Config({ enabled: true, webSearch: true, advancedHostedSearch: false, maxAttempts: 1, ...settings })
  apply(host, configInput)
  const setting = (key, value) => {
    updateVolatile(configInput[key], Config({ [key]: value })[key])
    handlers.get('loader/volatile-update')()
  }
  return { ctx, setting, warnings }
}

async function withRealPlugin(model, settings, run) {
  const root = await mkdtemp(resolve('.i120r-'))
  const originalFetch = globalThis.fetch
  const bodies = []
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)))
    return sse('reply')
  }
  try {
    const harness = await realPluginHarness(root, model, settings)
    const handle = await harness.ctx.agents.create({ sessionId: SessionId(`i120r-${model}`), meta: { cwd: root }, agentOptions: { provider: 'openai', model } })
    const ask = async text => {
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      return bodies.at(-1)
    }
    try { return await run({ ...harness, bodies, ask, handle }) } finally { await handle.dispose() }
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
}

for (const model of ['gpt-6-sol', 'gpt-5.6-sol']) {
  test(`real path ${model}: a tool LCX registers from its own settings switch is declared by additional_tools and the request tools stay byte-identical`, async () => {
    await withRealPlugin(model, {}, async ({ ctx, setting, bodies, ask, warnings }) => {
      const info = await ctx.llm.resolveModelInfo('openai', model)
      assert.equal(info.toolUpdate, 'addition-only', 'the real host adapter declares addition-only for the catalog route')
      const one = await ask('turn one')
      const two = await ask('turn two')
      assert.equal(bodies.length, 2, 'LCX owned both requests')
      assert.ok(names(one).includes('web_search'), 'LCX registered its web_search override at agent creation')
      assert.ok(!names(one).includes('websearch_gpt_advanced'))
      assert.equal(JSON.stringify(two.tools), JSON.stringify(one.tools))

      setting('advancedHostedSearch', true)
      const three = await ask('turn three')
      assert.equal(JSON.stringify(three.tools), JSON.stringify(one.tools), 'request tools did not change when LCX registered websearch_gpt_advanced')
      assert.deepEqual(addedNames(three), ['websearch_gpt_advanced'])
      assert.doesNotMatch(JSON.stringify(three), /deferLoading|defer_loading|tool-addition/u)
      const previous = two.input.map(item => JSON.stringify(item))
      assert.deepEqual(three.input.slice(0, previous.length).map(item => JSON.stringify(item)), previous, 'the earlier request is an exact prefix')
      assert.deepEqual(warnings, [], 'no fallback warning on the anchored path')

      // The switch off sends the full list with the new tool at the top level (rollback and A/B control).
      setting('incrementalToolUpdates', false)
      const four = await ask('turn four')
      assert.ok(names(four).includes('websearch_gpt_advanced'))
      assert.equal(additions(four).length, 0)
    })
  })
}

test('with the switch off the same sequence sends the full list and reports nothing', async () => {
  await withRealPlugin('gpt-6-sol', { incrementalToolUpdates: false }, async ({ setting, ask, warnings }) => {
    await ask('one')
    setting('advancedHostedSearch', true)
    const body = await ask('two')
    assert.equal(additions(body).length, 0)
    assert.ok(names(body).includes('websearch_gpt_advanced'))
    assert.deepEqual(warnings, [])
  })
})
