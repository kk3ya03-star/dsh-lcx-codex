import test from 'node:test'
import assert from 'node:assert/strict'
import apply from '../lib/index.js'

const gptProfile = {
  api: 'openai-responses',
  baseURL: 'https://gateway.example/v1',
  apiKeyEnv: 'GPT_FIXTURE_KEY',
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function nativeWebSearchDefinition() {
  return {
    name: 'web_search',
    description: 'Native custom-limit search',
    parameters: {
      type: 'object',
      properties: {
        queries: { type: 'array', items: { type: 'string' }, description: 'Custom native limit contract' },
      },
      required: ['queries'],
    },
    output: {
      schema: { type: 'object' },
      render: () => [{ type: 'text', text: 'native rendering' }],
    },
    timeoutMs: 60_000,
    async execute(args, exec) {
      return { owner: 'native', args, signal: exec.signal }
    },
  }
}

function modelScopeHarness(settings = {}, config = {}) {
  const handlers = new Map()
  const effects = []
  const nativeSearch = nativeWebSearchDefinition()
  const inherited = new Map([
    ['web_search', nativeSearch],
    ['web_fetch', { name: 'web_fetch' }],
  ])
  const settingsEntry = {
    enabled: true,
    webSearch: true,
    advancedHostedSearch: true,
    alphaSearch: false,
    grokNativeWebSearch: false,
    grokNativeXSearch: false,
    ...settings,
  }
  let onChange
  let providerWrites = 0
  const web = {}
  Object.defineProperty(web, 'searchProviderId', {
    configurable: true,
    get: () => 'native-provider',
    set: () => { providerWrites += 1 },
  })
  web.registerSearchProvider = () => { throw new Error('must not register a global search provider') }
  const ctx = {
    logger: { info() {}, warn() {} },
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 262_144 } }) },
    sessions: {},
    credentials: { resolve: async () => ({ value: 'synthetic-test-key' }) },
    attachments: {},
    fs: {},
    web,
    tools: { register() { throw new Error('must not register a global tool') } },
    settings: {
      get: () => ({ providers: { fixture: gptProfile } }),
      installSection(_owner, _namespace, _schema, _entry, hooks) {
        hooks.setSource(() => settingsEntry)
        onChange = hooks.onChange
        onChange()
      },
    },
    get(name) { return this[name] },
    inject() {},
    on(name, handler) { handlers.set(name, handler) },
    effect(setup) { effects.push(setup()) },
  }
  apply(ctx, { maxAttempts: 1, webMaxResults: 3, ...config })

  function agent(provider, model, id) {
    let requestConfig = { provider, model }
    const local = new Map()
    const tools = {
      get(name) { return local.get(name) ?? inherited.get(name) },
      register(definition) {
        if (local.has(definition.name)) throw new Error(`duplicate scoped tool ${definition.name}`)
        local.set(definition.name, definition)
        return () => {
          if (local.get(definition.name) === definition) local.delete(definition.name)
        }
      },
    }
    const session = { id, requestHeader: () => ({ config: requestConfig }) }
    const value = {
      options: { provider, model },
      session,
      ctx: { get: name => name === 'tools' ? tools : undefined },
    }
    return {
      value, session, local, tools,
      select(nextProvider, nextModel) { requestConfig = { provider: nextProvider, model: nextModel } },
    }
  }

  return {
    ctx, handlers, nativeSearch, settingsEntry,
    providerWrites: () => providerWrites,
    refresh: () => onChange(),
    agent,
    async dispose() {
      for (const cleanup of effects.reverse()) if (typeof cleanup === 'function') await cleanup()
    },
  }
}

function announce(harness, agent) {
  harness.handlers.get('agent/created')({ agent: agent.value })
}

function requestHeader(harness, agent) {
  harness.handlers.get('session/event')(agent.session, { type: 'request/header' })
}

test('GPT tools are agent-scoped while ineligible and disabled models retain native DSH tools', async () => {
  const h = modelScopeHarness()
  const gpt = h.agent('fixture', 'gpt-fixture', 'session-gpt')
  const claude = h.agent('anthropic', 'claude-fixture', 'session-claude')
  const grok = h.agent('xai', 'grok-4.6', 'session-grok')
  announce(h, gpt)
  announce(h, claude)
  announce(h, grok)

  assert.notEqual(gpt.tools.get('web_search'), h.nativeSearch)
  assert.equal(gpt.tools.get('web_search').timeoutMs, 240_000)
  assert.ok(gpt.tools.get('websearch_gpt_advanced'))
  for (const agent of [claude, grok]) {
    assert.equal(agent.tools.get('web_search'), h.nativeSearch)
    assert.equal(agent.tools.get('websearch_gpt_advanced'), undefined)
  }
  assert.equal(h.nativeSearch.timeoutMs, 60_000)
  assert.equal(h.nativeSearch.description, 'Native custom-limit search')
  assert.equal(h.nativeSearch.output.render()[0].text, 'native rendering')
  assert.equal(h.ctx.web.searchProviderId, 'native-provider')
  assert.equal(h.providerWrites(), 0)

  h.settingsEntry.enabled = false
  h.refresh()
  assert.equal(gpt.tools.get('web_search'), h.nativeSearch)
  assert.equal(gpt.tools.get('websearch_gpt_advanced'), undefined)
  assert.equal(h.nativeSearch.timeoutMs, 60_000)
  assert.equal(h.providerWrites(), 0)
  await h.dispose()
})

test('request-header model switches remove and restore GPT-scoped registrations', async () => {
  const h = modelScopeHarness()
  const agent = h.agent('fixture', 'gpt-fixture', 'session-switch')
  announce(h, agent)
  const first = agent.tools.get('web_search')
  assert.notEqual(first, h.nativeSearch)

  agent.select('anthropic', 'claude-fixture')
  requestHeader(h, agent)
  assert.equal(agent.tools.get('web_search'), h.nativeSearch)
  assert.equal(agent.tools.get('websearch_gpt_advanced'), undefined)

  agent.select('fixture', 'gpt-fixture')
  requestHeader(h, agent)
  assert.notEqual(agent.tools.get('web_search'), h.nativeSearch)
  assert.notEqual(agent.tools.get('web_search'), first)
  assert.ok(agent.tools.get('websearch_gpt_advanced'))

  h.handlers.get('session/disposed')(agent.session)
  assert.equal(agent.tools.get('web_search'), h.nativeSearch)
  assert.equal(agent.tools.get('websearch_gpt_advanced'), undefined)
  await h.dispose()
})

test('delayed GPT Hosted search overlaps native search without shared provider or definition mutation', async t => {
  const h = modelScopeHarness()
  const gpt = h.agent('fixture', 'gpt-fixture', 'session-overlap-gpt')
  const other = h.agent('anthropic', 'claude-fixture', 'session-overlap-native')
  announce(h, gpt)
  announce(h, other)
  const gate = deferred()
  const entered = deferred()
  let requestBody
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requestBody = JSON.parse(init.body)
    entered.resolve()
    await gate.promise
    return new Response(JSON.stringify({
      id: 'response-search',
      status: 'completed',
      output_text: 'Scoped GPT answer',
      output: [{
        type: 'web_search_call', status: 'completed',
        action: { type: 'search', sources: [{ url: 'https://example.com/result', title: 'Result' }] },
      }],
    }), { headers: { 'content-type': 'application/json' } })
  })

  const signal = new AbortController().signal
  const gptSearch = gpt.tools.get('web_search')
  const running = gptSearch.execute({ queries: ['scoped query'] }, { agent: gpt.value, signal })
  await entered.promise
  const nativeResult = await other.tools.get('web_search').execute(
    { queries: ['native custom query one', 'native custom query two'] },
    { agent: other.value, signal },
  )
  assert.equal(nativeResult.owner, 'native')
  assert.equal(other.tools.get('web_search'), h.nativeSearch)
  assert.equal(h.nativeSearch.timeoutMs, 60_000)
  assert.equal(h.ctx.web.searchProviderId, 'native-provider')
  assert.equal(h.providerWrites(), 0)

  gate.resolve()
  const result = await running
  assert.equal(requestBody.model, 'gpt-fixture')
  assert.equal(requestBody.input[0].content[0].text, 'scoped query')
  assert.deepEqual(result.sources.map(source => source.url), ['https://example.com/result'])
  const rendered = gptSearch.output.render({ queries: ['scoped query'] }, result)[0].text
  assert.match(rendered, /Scoped GPT answer/u)
  assert.match(rendered, /https:\/\/example\.com\/result/u)
  assert.equal(h.providerWrites(), 0)
  await h.dispose()
})
