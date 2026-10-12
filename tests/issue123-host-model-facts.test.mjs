import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SettingsForms } from '@deepseek-ai/dsh-settings'
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
import { resolveRouteModelFacts, routeModelOverride, serializeDshMessages } from '../lib/dsh-responses.js'
import { resolveGrokResponsesRouteConfig, resolveResponsesRouteConfig } from '../lib/route.js'
import { providerDynamicHeaders, providerSessionHeaders } from '../lib/provider-headers.js'
import { resolveCatalogModel } from '../lib/model-catalog.js'

// Issue #123, real path. A provider profile in the shape of the Product Owner's desktop profile names a catalog
// vendor (`openai`, `xai`) without `api`: it sets only baseURL, apiKeyEnv and a `models` list whose entries carry
// contextWindow / maxTokens / input. DSH resolves such a model from its own catalog (the profile's `api` is
// optional), but LCX used to read the protocol only from its frozen Pi 0.86 allowlist, so gpt-6-sol / gpt-6-luna
// failed every turn with NO_ADAPTER. Everything below runs the real dsh-llm, dsh-llm-pi-ai, settings, session,
// tools, agent and agent-loop classes with the LCX plugin installed on that context; only the network is captured.

const baseURL = 'https://fixture.invalid/v1'
const names = body => (body.tools ?? []).map(entry => entry.name ?? entry.type)

function sse(text) {
  const output = [{ type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }]
  const events = [{ type: 'response.completed', response: { id: 'resp_fixture', model: 'fixture', status: 'completed', output, usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 } } } }]
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
}

const entry = (id, extra = {}) => ({ id, name: id, contextWindow: 272000, maxTokens: 128000, input: ['text', 'image'], ...extra })

/** The Product Owner's desktop shape: catalog vendor names, baseURL + apiKeyEnv + models, no `api` anywhere. */
const desktopProfiles = () => ({
  openai: { apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL, models: [entry('gpt-6-astra'), entry('gpt-6-luna'), entry('gpt-6-sol'), entry('gpt-5.6-sol')] },
  xai: { apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL: 'https://fixture.invalid/xai', models: [entry('grok-4.6', { contextWindow: 500000, maxTokens: 500000 }), entry('grok-4.7', { contextWindow: 500000, maxTokens: 500000 })] },
})

async function harness(root, profiles, settings = {}, prepare = undefined) {
  const ctx = new Context()
  ctx.plugin(Llm)
  const piFiber = ctx.plugin(PiAi, { providers: structuredClone(profiles) })
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

  // The settings view LCX reads is the real SettingsForms projection of the real dsh-llm-pi-ai Config.
  const settingsCtx = new Context()
  settingsCtx.provide('loader', { await: () => Promise.resolve() }, true)
  settingsCtx.provide('profileContext', { home: 'unused' }, true)
  const raw = { providers: structuredClone(profiles) }
  const piEntry = { options: { id: 'llm-pi-ai', config: raw }, fiber: { uid: 1, state: 2, runtime: { Config: PiAi.Config }, config: piFiber.config, ctx: settingsCtx } }
  settingsCtx.provide('configEditor', {
    configuration: () => [{ entry: piEntry, inherited: {}, override: raw }],
    entries: () => [piEntry],
    async edit() { throw new Error('read-only fixture') },
  }, true)
  const forms = new SettingsForms(settingsCtx)

  const handlers = new Map()
  const warnings = []
  const overrides = {
    logger: { info() {}, debug() {}, warn(message) { warnings.push(String(message)) }, error() {} },
    settings: { describe: () => forms.describe(), configure: () => () => {} },
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
  prepare?.(ctx)
  apply(host, configInput)
  // The prewarm asks DSH asynchronously; in a real host plugin start precedes every agent by far more than this.
  if (prepare) await new Promise(done => setTimeout(done, 100))
  const setting = (key, value) => {
    updateVolatile(configInput[key], Config({ [key]: value })[key])
    handlers.get('loader/volatile-update')()
  }
  // DSH's live configuration path: the loader updates the plugin's volatile config in place and announces it.
  const setProviders = next => {
    updateVolatile(piFiber.config.providers, PiAi.Config({ providers: structuredClone(next) }).providers)
    ctx.emit('loader/volatile-update')
  }
  return { ctx, setting, warnings, forms, setProviders }
}

async function withHarness(profiles, settings, run, prepare = undefined) {
  const root = await mkdtemp(resolve('.i123-'))
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init.body)), headers: Object.fromEntries(new Headers(init.headers)) })
    return sse('reply')
  }
  try {
    const h = await harness(root, profiles, settings, prepare)
    let counter = 0
    const turn = async (provider, model, text = 'hello') => {
      const handle = await h.ctx.agents.create({ sessionId: SessionId(`i123-${provider}-${model}-${counter += 1}`), meta: { cwd: root }, agentOptions: { provider, model } })
      try {
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
        await handle.agent.whenIdle()
      } finally { await handle.dispose() }
      return requests.at(-1)
    }
    /** One long-lived agent: tool changes between its turns are real mid-session changes. */
    const open = async (provider, model) => {
      const handle = await h.ctx.agents.create({ sessionId: SessionId(`i123-open-${provider}-${model}-${counter += 1}`), meta: { cwd: root }, agentOptions: { provider, model } })
      const ask = async text => {
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
        await handle.agent.whenIdle()
        return requests.at(-1)
      }
      return { ask, dispose: () => handle.dispose() }
    }
    return await run({ ...h, requests, turn, open, root })
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
}

/**
 * A host newer than the bundled Pi catalog. DSH 0.2.1-alpha.2 runs on the same Pi (1.1.0) that LCX bundles, so no
 * real model is known to the host and not to LCX; this stands in for a later DSH whose own catalog is ahead. It
 * patches the registered dsh-llm-pi-ai adapter, so every public lookup (`listModels`, `resolveModelInfo`,
 * `prepareCall`, which the agent loop calls) answers the way DSH would for a model it serves.
 */
function simulateNewerHost(ctx, ids, isServed = () => true, provider = 'openai', { listDelayMs = 0 } = {}) {
  const adapter = ctx.llm.adapters.get(provider).adapter
  const lookups = []
  const info = (route, model) => ({ provider: route, id: model, name: model, inputModalities: ['text', 'image'], context: { contextWindow: 272000 }, systemPromptUpdate: 'in-history', toolUpdate: 'addition-only' })
  const serves = model => ids.includes(model) && isServed()
  const original = { resolveModel: adapter.resolveModel.bind(adapter), prepareCall: adapter.prepareCall.bind(adapter), listModels: adapter.listModels.bind(adapter) }
  adapter.resolveModel = async (route, model, signal) => {
    lookups.push(`${route}/${model}`)
    return serves(model) ? info(route, model) : original.resolveModel(route, model, signal)
  }
  adapter.prepareCall = async (route, model, signal) => serves(model)
    ? { model: info(route, model), stream: () => { throw new Error('the real adapter must not be dispatched: LCX owns the request') } }
    : original.prepareCall(route, model, signal)
  adapter.listModels = async route => {
    if (listDelayMs > 0) await new Promise(done => setTimeout(done, listDelayMs))
    const base = await original.listModels(route)
    return isServed() ? [...base, ...ids.map(id => ({ provider: route, id, name: id, inputModalities: ['text', 'image'] }))] : base
  }
  return lookups
}

const hi = model => ({ provider: 'openai', model, messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }] })

async function collect(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

test('the desktop-shaped profile has no api anywhere, and DSH itself resolves the models', async () => {
  await withHarness(desktopProfiles(), {}, async ({ ctx, forms }) => {
    const projected = forms.describe().find(row => row.ns === 'llm-pi-ai').value.providers
    assert.equal(projected.openai.api, undefined)
    assert.equal(projected.xai.api, undefined)
    for (const model of ['gpt-6-sol', 'gpt-6-luna', 'gpt-6-astra']) {
      const info = await ctx.llm.resolveModelInfo('openai', model)
      assert.equal(info.context.contextWindow, 272000, `${model}: DSH resolves the profile model`)
    }
  })
})

for (const model of ['gpt-6-sol', 'gpt-6-luna']) {
  test(`${model} on a profile without api: LCX owns the turn and sends a Responses request`, async () => {
    await withHarness(desktopProfiles(), {}, async ({ turn, requests }) => {
      const request = await turn('openai', model)
      assert.equal(requests.length, 1, 'one request reached the network')
      assert.equal(request.url, `${baseURL}/responses`)
      assert.equal(request.body.model, model)
      assert.equal(request.body.stream, true)
      assert.ok(Array.isArray(request.body.input) && request.body.input.length > 0)
      assert.ok(names(request.body).includes('web_search'), 'LCX registered its search tool, so LCX built this request')
      // The compat of a catalog GPT-6 model (strict tools, grammar tools) is read from the catalog, not the profile.
      // The wire reasoning map is the catalog descriptor's: gpt-6-sol / gpt-6-luna spell "off" as none.
      assert.deepEqual(request.body.reasoning, { effort: 'none' })
    })
  })
}

test('addition-only tool updates follow the host on a model outside the frozen LCX catalog, with a profile that sets no compat', async () => {
  await withHarness(desktopProfiles(), {}, async ({ ctx, setting, open, requests, warnings }) => {
    const info = await ctx.llm.resolveModelInfo('openai', 'gpt-6-sol')
    assert.equal(info.toolUpdate, 'addition-only')
    const session = await open('openai', 'gpt-6-sol')
    try {
      const first = await session.ask('one')
      setting('advancedHostedSearch', true)
      const second = await session.ask('two')
      assert.equal(requests.length, 2)
      assert.equal(JSON.stringify(second.body.tools), JSON.stringify(first.body.tools), 'request tools stay anchored')
      const added = second.body.input.filter(item => item.type === 'additional_tools').flatMap(item => item.tools.map(tool => tool.name))
      assert.deepEqual(added, ['websearch_gpt_advanced'])
      assert.deepEqual(warnings, [])
    } finally { await session.dispose() }
  })
})

test('models the frozen catalog already knew behave as before', async () => {
  await withHarness(desktopProfiles(), {}, async ({ turn, requests }) => {
    for (const model of ['gpt-6-astra', 'gpt-5.6-sol']) {
      const request = await turn('openai', model)
      assert.equal(request.url, `${baseURL}/responses`, model)
      assert.equal(request.body.model, model)
    }
    assert.equal(requests.length, 2)
  })
})

test('an explicitly configured api is still respected', async () => {
  const profiles = desktopProfiles()
  // Responses stated explicitly: same wire, the profile wins over the catalog.
  profiles.openai.api = 'openai-responses'
  profiles.openai.baseURL = 'https://fixture.invalid/explicit'
  await withHarness(profiles, {}, async ({ turn }) => {
    const request = await turn('openai', 'gpt-6-sol')
    assert.equal(request.url, 'https://fixture.invalid/explicit/responses')
  })
  // A non-Responses api is respected too: LCX does not send a Responses request on it (LCX owns every GPT turn
  // while enabled, so the turn fails closed instead of reaching the network).
  const completions = desktopProfiles()
  completions.openai.api = 'openai-completions'
  await withHarness(completions, {}, async ({ ctx, requests }) => {
    const chunks = await collect(ctx.llm.stream({ provider: 'openai', model: 'gpt-6-sol', messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }] }))
    assert.equal(requests.length, 0)
    assert.equal(chunks.at(-1).reason.failure.code, 'NO_ADAPTER')
  })
  // Without api the catalog entry of gpt-6-astra leaves `off` unmapped (null): no default reasoning object is sent.
  await withHarness(desktopProfiles(), {}, async ({ turn }) => {
    assert.equal((await turn('openai', 'gpt-6-astra')).body.reasoning, undefined)
  })
})

test('a custom-named route with an explicit api is unaffected', async () => {
  const profiles = { lcx: { api: 'openai-responses', apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL, models: [entry('gpt-6-sol'), entry('gpt-5.6-sol')] } }
  await withHarness(profiles, {}, async ({ turn }) => {
    for (const model of ['gpt-6-sol', 'gpt-5.6-sol']) {
      const request = await turn('lcx', model)
      assert.equal(request.url, `${baseURL}/responses`, model)
      assert.equal(request.body.model, model)
    }
  })
})

test('a model the profile declares but DSH\'s catalog lacks takes the provider\'s shared protocol, like DSH', async () => {
  const profiles = desktopProfiles()
  profiles.openai.models.push(entry('gpt-9-preview'))
  await withHarness(profiles, {}, async ({ ctx, turn }) => {
    const info = await ctx.llm.resolveModelInfo('openai', 'gpt-9-preview')
    assert.equal(info.context.contextWindow, 272000, 'DSH serves the declared model')
    const request = await turn('openai', 'gpt-9-preview')
    assert.equal(request.url, `${baseURL}/responses`)
    assert.equal(request.body.model, 'gpt-9-preview')
  })
})

test('gpt-6.1-sol is a bundled catalog model and follows the tool-update mode the host declares', async () => {
  const profiles = desktopProfiles()
  profiles.openai.models.push(entry('gpt-6.1-sol'))
  await withHarness(profiles, {}, async ({ ctx, setting, open, requests, warnings }) => {
    const info = await ctx.llm.resolveModelInfo('openai', 'gpt-6.1-sol')
    // Host Pi 1.1.0 and the bundled Pi 1.1.0 catalog both describe the model.
    assert.equal(info.toolUpdate, 'addition-only')
    assert.equal(info.systemPromptUpdate, 'in-history')
    const session = await open('openai', 'gpt-6.1-sol')
    try {
      const first = await session.ask('one')
      assert.equal(first.url, `${baseURL}/responses`)
      assert.equal(first.body.model, 'gpt-6.1-sol')
      setting('advancedHostedSearch', true)
      const second = await session.ask('two')
      assert.equal(JSON.stringify(second.body.tools), JSON.stringify(first.body.tools), 'request tools stay anchored on the host declaration')
      assert.deepEqual(second.body.input.filter(item => item.type === 'additional_tools').flatMap(item => item.tools.map(tool => tool.name)), ['websearch_gpt_advanced'])
      assert.equal(requests.length, 2)
      assert.deepEqual(warnings, [])
    } finally { await session.dispose() }
  })
})

test('a model that a models list leaves out is answered by DSH itself (UNKNOWN_MODEL), not by an LCX failure', async () => {
  await withHarness(desktopProfiles(), {}, async ({ ctx, requests }) => {
    const chunks = await collect(ctx.llm.stream({
      provider: 'openai',
      model: 'gpt-9-unlisted',
      messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }],
    }))
    assert.equal(requests.length, 0, 'nothing was sent')
    const finish = chunks.at(-1)
    assert.equal(finish.type, 'finish')
    assert.equal(finish.reason.kind, 'error')
    assert.equal(finish.reason.failure.code, 'UNKNOWN_MODEL', 'DSH reports its own error')
    assert.match(finish.reason.failure.message, /no configured model/u)
  })
})

// A nonempty models list is authoritative: DSH serves only the listed models and LCX answers before DSH's adapter,
// so claiming a catalog model the list leaves out would send a request DSH itself refuses.
test('a nonempty models list is authoritative even for a model the bundled catalog and the frozen allowlist know', async () => {
  const profiles = { openai: { apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL, models: [entry('gpt-6.1-sol')] }, xai: { apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL, models: [entry('grok-4.6')] } }
  await withHarness(profiles, { grokNativeWebSearch: true }, async ({ ctx, forms, requests }) => {
    let lookups = 0
    const original = ctx.llm.resolveModelInfo.bind(ctx.llm)
    ctx.llm.resolveModelInfo = async (...args) => { lookups += 1; return original(...args) }
    await assert.rejects(original('openai', 'gpt-6-sol'), /no configured model/u, 'DSH refuses the unlisted model')
    for (const model of ['gpt-6-sol', 'gpt-5.6-sol']) {
      const chunks = await collect(ctx.llm.stream({ provider: 'openai', model, messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }] }))
      const failure = chunks.at(-1).reason.failure
      assert.equal(failure.code, 'UNKNOWN_MODEL', model)
      assert.match(failure.message, /no configured model/u, model)
    }
    // Grok follows the same rule: the xai models list leaves grok-4.7 out, DSH answers, LCX sends nothing.
    const grokChunks = await collect(ctx.llm.stream({ provider: 'xai', model: 'grok-4.7', messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }] }))
    assert.equal(grokChunks.at(-1).reason.failure.code, 'UNKNOWN_MODEL')
    assert.equal(requests.length, 0, 'zero network requests')
    assert.equal(lookups, 0, 'no host lookup for a model the profile excludes')
    const routeCtx = { llm: ctx.llm, settings: { describe: () => forms.describe() } }
    assert.equal(resolveResponsesRouteConfig(routeCtx, { provider: 'openai', model: 'gpt-6-sol' }, {}), undefined)
    assert.ok(resolveResponsesRouteConfig(routeCtx, { provider: 'openai', model: 'gpt-6.1-sol' }, {}), 'the listed model resolves')
    assert.equal(resolveGrokResponsesRouteConfig(routeCtx, { provider: 'xai', model: 'grok-4.7' }, {}), undefined)
    assert.ok(resolveGrokResponsesRouteConfig(routeCtx, { provider: 'xai', model: 'grok-4.6' }, {}))
  })
})

// The Technical Lead repro: no `models` list at all.
const bareProfiles = () => ({ openai: { apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL } })

test('gpt-6.1-sol on a bare profile is owned from the first request, with the LCX search tools on that request', async () => {
  await withHarness(bareProfiles(), {}, async ({ ctx, open, requests }) => {
    const info = await ctx.llm.resolveModelInfo('openai', 'gpt-6.1-sol')
    assert.equal(info.toolUpdate, 'addition-only', 'DSH recognizes the model')
    assert.equal(resolveCatalogModel('openai', 'gpt-6.1-sol').source, 'catalog-model', 'the bundled Pi follows the Pi of DSH')
    const session = await open('openai', 'gpt-6.1-sol')
    try {
      const first = await session.ask('first turn')
      assert.equal(requests.length, 1)
      assert.equal(first.url, `${baseURL}/responses`)
      assert.equal(first.body.model, 'gpt-6.1-sol')
      assert.ok(names(first.body).includes('web_search'), 'LCX registered its search tool before the first request')
      assert.deepEqual(first.body.tools.filter(tool => tool.name === 'web_search').map(tool => tool.type), ['function'])
    } finally { await session.dispose() }
  })
})

test('a model only a newer DSH catalog describes is still owned on a bare profile (host-recognition fallback)', async () => {
  await withHarness(bareProfiles(), {}, async ({ ctx, requests }) => {
    const lookups = simulateNewerHost(ctx, ['gpt-9-future'])
    assert.equal(resolveCatalogModel('openai', 'gpt-9-future').source, 'unknown', 'the bundled catalog cannot know it')
    const chunks = await collect(ctx.llm.stream(hi('gpt-9-future')))
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, `${baseURL}/responses`)
    assert.equal(requests[0].body.model, 'gpt-9-future')
    const firstTurnLookups = lookups.length
    // The recognition is remembered: the next request does not need the route lookup again.
    await collect(ctx.llm.stream(hi('gpt-9-future')))
    assert.equal(requests.length, 2)
    assert.ok(lookups.length - firstTurnLookups < firstTurnLookups, 'the second request skips the route lookup')
  })
})

test('DSH is asked at most once for a failing request, and a model DSH also rejects stays NO_ADAPTER', async () => {
  await withHarness(bareProfiles(), {}, async ({ ctx, requests }) => {
    const original = ctx.llm.resolveModelInfo.bind(ctx.llm)
    let lookups = 0
    ctx.llm.resolveModelInfo = async (...args) => { lookups += 1; return original(...args) }
    const chunks = await collect(ctx.llm.stream({
      provider: 'openai',
      model: 'gpt-9-unlisted',
      messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }],
    }))
    assert.equal(requests.length, 0)
    assert.equal(lookups, 1, 'one lookup for the failing request')
    const failure = chunks.at(-1).reason.failure
    assert.equal(failure.code, 'NO_ADAPTER')
    assert.match(failure.message, /add api: openai-responses to the provider profile or select another model/u)
    assert.doesNotMatch(failure.message, /unknown to the catalog|does not recognize/u)
  })
})

test('the xai route resolves grok-4.7 without api and LCX owns its native-search request', async () => {
  await withHarness(desktopProfiles(), { grokNativeWebSearch: true }, async ({ ctx, requests }) => {
    const chunks = await collect(ctx.llm.stream({
      provider: 'xai',
      model: 'grok-4.7',
      messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'search' }] }],
    }))
    assert.equal(chunks.at(-1).type, 'finish')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, 'https://fixture.invalid/xai/responses')
    assert.equal(requests[0].body.model, 'grok-4.7')
    assert.ok(requests[0].body.tools.some(tool => tool.type === 'web_search'), 'the Grok native web_search tool is LCX-owned')
  })
})

test('the DSH-reported context window overrides the catalog descriptor on the Grok route as it does on GPT', async () => {
  const profiles = desktopProfiles()
  profiles.xai.models = [entry('grok-4.7', { contextWindow: 340000, maxTokens: 64000 })]
  profiles.openai.models = [entry('gpt-6-sol', { contextWindow: 200000 })]
  await withHarness(profiles, {}, async ({ ctx, forms }) => {
    const routeCtx = { llm: ctx.llm, settings: { describe: () => forms.describe() } }
    const model = async (provider, name, grok) => {
      const route = { provider, model: name, baseURL }
      const config = grok
        ? resolveGrokResponsesRouteConfig(routeCtx, route, {})
        : resolveResponsesRouteConfig(routeCtx, route, {})
      assert.ok(config, `${provider}/${name} resolves`)
      const facts = await resolveRouteModelFacts(ctx, route)
      assert.equal(facts.contextWindow, grok ? 340000 : 200000, 'DSH reports the window the profile declares')
      const serialize = override => serializeDshMessages([], ctx, { imageSupport: 'supported', route, ...(override === undefined ? {} : { model: override }) })
      const withoutOverride = (await serialize(undefined)).model.contextWindow
      const withOverride = (await serialize(routeModelOverride(config, facts, grok))).model.contextWindow
      return { withoutOverride, withOverride }
    }
    // Without the override the Pi descriptor's window stands (grok-4.7: 500000; gpt-6-sol: 272000).
    assert.deepEqual(await model('xai', 'grok-4.7', true), { withoutOverride: 500000, withOverride: 340000 })
    assert.deepEqual(await model('openai', 'gpt-6-sol', false), { withoutOverride: 272000, withOverride: 200000 })
    // When DSH cannot resolve the model nothing is overridden.
    assert.equal(routeModelOverride({}, { resolved: false, reasoning: undefined, contextWindow: undefined }, true), undefined)
  })
})

test('a live profile change that stops DSH serving a recognized model stops LCX serving it too', async () => {
  await withHarness(bareProfiles(), {}, async ({ ctx, requests, forms, setProviders }) => {
    const described = () => forms.describe().find(row => row.ns === 'llm-pi-ai').value.providers.openai
    // A newer DSH serves gpt-9-future while the profile is bare and refuses it once a models list excludes it,
    // which is what DSH's real resolver does on a live configuration change.
    simulateNewerHost(ctx, ['gpt-9-future'], () => described().models.length === 0)
    const streamOnce = model => collect(ctx.llm.stream(hi(model)))
    // Bare profile: the host serves the model and LCX follows (this also records the recognition).
    assert.equal((await streamOnce('gpt-9-future')).at(-1).reason.kind, 'stop')
    assert.equal(requests.length, 1)

    // Live change through DSH's own path: the profile now serves only gpt-6-sol.
    setProviders({ openai: { apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL, models: [entry('gpt-6-sol')] } })
    assert.deepEqual(described().models.map(model => model.id), ['gpt-6-sol'], 'LCX reads the live profile')
    // The real DSH now refuses a bundled-catalog model the list omits, and LCX refuses it too ...
    await assert.rejects(ctx.llm.resolveModelInfo('openai', 'gpt-6.1-sol'), /no configured model/u)
    assert.equal((await streamOnce('gpt-6.1-sol')).at(-1).reason.failure.code, 'UNKNOWN_MODEL')
    // ... and so for the recognized model, whose remembered recognition no longer applies.
    assert.equal((await streamOnce('gpt-9-future')).at(-1).reason.failure.code, 'UNKNOWN_MODEL')
    assert.equal(requests.length, 1, 'no request left LCX for the removed models')
    requests.length = 0
    assert.equal((await streamOnce('gpt-6-sol')).at(-1).reason.kind, 'stop', 'the listed model keeps working')
    assert.equal(requests.length, 1)

    // Back to a bare profile: a fresh lookup decides and both models are served again.
    setProviders(bareProfiles())
    assert.deepEqual(described().models, [], 'the schema materializes an absent models list as empty')
    requests.length = 0
    assert.equal((await streamOnce('gpt-9-future')).at(-1).reason.kind, 'stop')
    assert.equal((await streamOnce('gpt-6.1-sol')).at(-1).reason.kind, 'stop')
    assert.equal(requests.length, 2)

    // A models list that names a model keeps it served; one that drops it is authoritative.
    setProviders({ openai: { apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL, models: [entry('gpt-6.1-sol')] } })
    requests.length = 0
    assert.equal((await streamOnce('gpt-6.1-sol')).at(-1).reason.kind, 'stop')
    setProviders({ openai: { apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL, models: [entry('gpt-6-luna')] } })
    requests.length = 0
    assert.equal((await streamOnce('gpt-6.1-sol')).at(-1).reason.failure.code, 'UNKNOWN_MODEL')
    assert.equal(requests.length, 0)
  })
})

// A model only a newer DSH catalog describes: tool ownership is decided synchronously while an agent's tools are
// assembled, so the recognition has to be known before the first request. LCX asks DSH ahead of time.
test('a host-only model gets the LCX tools on its first request (recognition is prewarmed at start)', async () => {
  await withHarness(bareProfiles(), {}, async ({ open, requests }) => {
    const session = await open('openai', 'gpt-9-future')
    try {
      const first = await session.ask('first turn')
      assert.equal(first.url, `${baseURL}/responses`)
      assert.equal(first.body.model, 'gpt-9-future')
      assert.ok(names(first.body).includes('web_search'), 'the LCX search tool is on the very first request')
      assert.equal(requests.length, 1)
    } finally { await session.dispose() }
  }, ctx => simulateNewerHost(ctx, ['gpt-9-future']))
})

test('a session created before DSH knows the model gets the LCX tools once the provider configuration changes', async () => {
  await withHarness(bareProfiles(), {}, async ({ ctx, open, requests }) => {
    const session = await open('openai', 'gpt-9-future')
    try {
      // The model is unknown to DSH and to LCX when the session starts: nothing of LCX is registered for it.
      simulateNewerHost(ctx, ['gpt-9-future'])
      ctx.emit('llm/adapters-updated')
      await new Promise(done => setTimeout(done, 150))
      const first = await session.ask('after the host learned the model')
      assert.ok(names(first.body).includes('web_search'), 'tools were resynchronised by the prewarm, before this request')
      assert.equal(requests.length, 1)
    } finally { await session.dispose() }
  })
})

// Catalog providers whose requests Pi's own client decorates: LCX builds the Responses request itself, so it
// has to send what Pi would (model headers, Copilot per-request headers, OpenCode routing header), and to leave
// to DSH the provider whose authentication it cannot reproduce.
const providerProfile = provider => ({ [provider]: { apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL } })

test('github-copilot: the catalog model headers and the Pi Copilot request headers are sent, the profile wins, DSH attribution stays', async () => {
  await withHarness(providerProfile('github-copilot'), {}, async ({ turn, requests }) => {
    const request = await turn('github-copilot', 'gpt-6-sol')
    assert.equal(request.url, `${baseURL}/responses`)
    assert.equal(request.headers['editor-version'], 'vscode/1.107.0')
    assert.equal(request.headers['editor-plugin-version'], 'copilot-chat/0.35.0')
    assert.equal(request.headers['copilot-integration-id'], 'vscode-chat')
    assert.equal(request.headers['x-initiator'], 'user')
    assert.equal(request.headers['openai-intent'], 'conversation-edits')
    assert.equal(request.headers['copilot-vision-request'], undefined)
    // DSH's attribution replaces the catalog User-Agent, as the host adapter's request headers do.
    assert.match(request.headers['user-agent'], /^deepseek-harness\//u)
    assert.match(request.headers.authorization, /^Bearer /u)
    assert.equal(requests.length, 1)
  })
  const profiles = providerProfile('github-copilot')
  profiles['github-copilot'].headers = { 'editor-version': 'profile/9' }
  await withHarness(profiles, {}, async ({ turn }) => {
    const request = await turn('github-copilot', 'gpt-6-sol')
    assert.equal(request.headers['editor-version'], 'profile/9', 'a profile header wins over the catalog, whatever the case')
    assert.equal(request.headers['copilot-integration-id'], 'vscode-chat')
  })
})

test('github-copilot: the Pi helpers decide the initiator and the vision flag from the request history', () => {
  const text = { type: 'text', text: 'x' }
  const image = { type: 'image', attachment: {} }
  assert.deepEqual(providerDynamicHeaders('github-copilot', [{ role: 'user', content: [text] }]), { 'X-Initiator': 'user', 'Openai-Intent': 'conversation-edits' })
  assert.equal(providerDynamicHeaders('github-copilot', [{ role: 'user', content: [text] }, { role: 'assistant', content: [text] }, { role: 'tool', content: [text] }])['X-Initiator'], 'agent')
  assert.equal(providerDynamicHeaders('github-copilot', [{ role: 'user', content: [text, image] }])['Copilot-Vision-Request'], 'true')
  assert.equal(providerDynamicHeaders('github-copilot', [{ role: 'user', content: [text] }, { role: 'tool', content: [image] }])['Copilot-Vision-Request'], 'true')
  assert.deepEqual(providerDynamicHeaders('openai', [{ role: 'user', content: [text] }]), {})
})

test('opencode and opencode-go: the routing header Pi adds is sent with the session id; other providers send none', async () => {
  for (const provider of ['opencode', 'opencode-go']) {
    await withHarness(providerProfile(provider), {}, async ({ turn }) => {
      const request = await turn(provider, provider === 'opencode' ? 'gpt-6-sol' : 'gpt-6-luna')
      assert.match(request.headers['x-opencode-session'], /^i123-/u, provider)
      assert.equal(request.headers.session_id, undefined, 'the no-session affinity format sends no session_id')
      assert.ok(request.headers['x-client-request-id'], provider)
    })
  }
  assert.deepEqual(providerSessionHeaders('opencode', 's1'), { 'x-opencode-session': 's1' })
  assert.deepEqual(providerSessionHeaders('opencode', undefined), {})
  assert.deepEqual(providerSessionHeaders('openai', 's1'), {})
  await withHarness(providerProfile('openai'), {}, async ({ turn }) => {
    const request = await turn('openai', 'gpt-6-sol')
    assert.equal(request.headers['x-opencode-session'], undefined)
    assert.equal(request.headers['editor-version'], undefined)
  })
})

test('the Grok route sends the same provider headers (github-copilot and opencode)', async () => {
  const cases = [
    ['github-copilot', headers => { assert.equal(headers['editor-version'], 'vscode/1.107.0'); assert.equal(headers['x-initiator'], 'user'); assert.match(headers['user-agent'], /^deepseek-harness\//u) }],
    ['opencode', headers => assert.match(headers['x-opencode-session'], /^i123-grok/u)],
  ]
  for (const [provider, check] of cases) {
    await withHarness(providerProfile(provider), { grokNativeWebSearch: true }, async ({ ctx, requests }) => {
      const chunks = await collect(ctx.llm.stream({ provider, model: 'grok-4.7', sessionId: 'i123-grok-session', messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }] }))
      assert.equal(chunks.at(-1).type, 'finish')
      assert.equal(requests.length, 1, provider)
      check(requests[0].headers)
    })
  }
})

test('cloudflare-ai-gateway is left to DSH: the request is made by the host with the gateway authentication, not by LCX', async () => {
  await withHarness(providerProfile('cloudflare-ai-gateway'), {}, async ({ ctx, requests }) => {
    const chunks = await collect(ctx.llm.stream({ provider: 'cloudflare-ai-gateway', model: 'gpt-6-sol', messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }] }))
    assert.equal(chunks.at(-1).type, 'finish')
    assert.notEqual(chunks.at(-1).reason.failure?.code, 'NO_ADAPTER', 'not an LCX failure')
    // The only request is the one DSH's adapter made through Pi: the gateway header, no bearer Authorization, the
    // SDK's own headers. An LCX request would carry `Authorization: Bearer` and no gateway header.
    assert.equal(requests.length, 1)
    assert.equal(requests[0].headers['cf-aig-authorization'], 'Bearer fixture-only')
    assert.equal(requests[0].headers.authorization, undefined)
    assert.ok(requests[0].headers['x-stainless-lang'], 'made by the OpenAI SDK inside Pi')
  })
})

// TL re-review 4, item 1: the pre-warm is asynchronous, but tool ownership is decided synchronously, so a request
// right after start must not depend on who wins. Tool registration is optimistic and exact for the undecided case.
test('a host-only model gets the LCX tools on its first request even while DSH\'s model list is still pending', async () => {
  await withHarness(bareProfiles(), { advancedHostedSearch: true }, async ({ open, requests }) => {
    const session = await open('openai', 'gpt-9-future')
    try {
      const started = Date.now()
      const first = await session.ask('right after start')
      assert.ok(Date.now() - started < 1000, 'the request did not wait for the delayed model list')
      assert.equal(first.url, `${baseURL}/responses`)
      assert.equal(first.body.model, 'gpt-9-future')
      const toolNames = names(first.body)
      assert.ok(toolNames.includes('web_search'), 'the LCX search backend is on the first request')
      assert.ok(toolNames.includes('websearch_gpt_advanced') || first.body.input.some(item => item.type === 'additional_tools'), 'and so is the advanced hosted search tool')
      assert.equal(requests.length, 1)
    } finally { await session.dispose() }
  }, ctx => simulateNewerHost(ctx, ['gpt-9-future'], () => true, 'openai', { listDelayMs: 1300 }))
})

test('the undecided case is exact: a model DSH does not serve sends nothing, so no LCX tool reaches a non-LCX request', async () => {
  await withHarness(bareProfiles(), { advancedHostedSearch: true }, async ({ open, requests, warnings }) => {
    const session = await open('openai', 'gpt-9-never')
    try {
      await session.ask('hello').catch(() => undefined)
      assert.equal(requests.length, 0, 'DSH refuses the unknown model before any request')
    } finally { await session.dispose() }
  })
})

test('the optimistic tool decision never covers a provider whose shared protocol is not Responses, an explicit other api, a models list or a host-authenticated provider', () => {
  const route = (profiles, provider, model, assume) => resolveResponsesRouteConfig(
    { llm: { listConfigurableProviders: () => Object.keys(profiles).map(name => ({ provider: name, settingsNs: 'llm-pi-ai', settingsPath: ['providers', name] })) }, settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: profiles } }] } },
    { provider, model }, {}, assume)
  const base = { apiKeyEnv: 'K', baseURL }
  // Undecided on a Responses-only provider: exact only when asked optimistically.
  assert.equal(route({ openai: base }, 'openai', 'gpt-9-future', false), undefined)
  assert.ok(route({ openai: base }, 'openai', 'gpt-9-future', true))
  assert.ok(route({ xai: base }, 'xai', 'gpt-9-future', true))
  // opencode and github-copilot ship models of several protocols: no shared protocol, nothing to assume.
  for (const provider of ['opencode', 'opencode-go', 'github-copilot']) assert.equal(route({ [provider]: base }, provider, 'gpt-9-future', true), undefined, provider)
  // A model the catalog itself lists with another protocol, an explicit other api, a models list that omits it.
  assert.equal(route({ openai: { ...base, api: 'openai-completions' } }, 'openai', 'gpt-9-future', true), undefined)
  assert.equal(route({ openai: { ...base, models: [{ id: 'gpt-6-sol' }] } }, 'openai', 'gpt-9-future', true), undefined)
  assert.equal(route({ 'cloudflare-ai-gateway': base }, 'cloudflare-ai-gateway', 'gpt-9-future', true), undefined)
  // Not a GPT model, no credential, no endpoint.
  assert.equal(route({ openai: base }, 'openai', 'o3-future', true), undefined)
  assert.equal(route({ openai: { baseURL } }, 'openai', 'gpt-9-future', true), undefined)
})

test('a host-only Grok model is claimed on its first request, with the native-search tools, whatever the pre-warm has done', async () => {
  const profiles = { xai: { apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL: 'https://fixture.invalid/xai' } }
  await withHarness(profiles, { grokNativeWebSearch: true }, async ({ ctx, requests }) => {
    const chunks = await collect(ctx.llm.stream({ provider: 'xai', model: 'grok-9-future', messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'search' }] }] }))
    assert.equal(chunks.at(-1).type, 'finish')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, 'https://fixture.invalid/xai/responses')
    assert.ok(requests[0].body.tools.some(tool => tool.type === 'web_search'), 'the Grok native web_search tool is LCX-owned')
  }, ctx => simulateNewerHost(ctx, ['grok-9-future'], () => true, 'xai', { listDelayMs: 1300 }))
  // DSH does not know the model: DSH answers, LCX sends nothing.
  await withHarness(profiles, { grokNativeWebSearch: true }, async ({ ctx, requests }) => {
    const chunks = await collect(ctx.llm.stream({ provider: 'xai', model: 'grok-9-never', messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'search' }] }] }))
    assert.equal(chunks.at(-1).reason.failure.code, 'UNKNOWN_MODEL')
    assert.equal(requests.length, 0)
  })
})

// TL re-review 4, item 3: the OpenCode routing header is Pi's per-conversation header and carries the CURRENT DSH
// session id, whatever the prompt-cache policy: a subagent's cache key is its root's, its routing header is its own,
// and without cache retention the header is still sent.
function realSession(id, extra) {
  return Session.create(SessionId(id), undefined, { version: 4, id, createdAt: Date.now(), isSeeded: false, ...extra })
}
const SESSION_MESSAGES = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }]

async function withSubagentSessions(profiles, run, settings = {}) {
  await withHarness(profiles, settings, async harness => {
    const sessions = new Map([['i123-root', realSession('i123-root')], ['i123-child', realSession('i123-child', { origin: 'subagent', parentSession: 'i123-root' })]])
    harness.ctx.sessions.get = id => sessions.get(String(id))
    await run(harness)
  })
}

test('opencode: a subagent keeps its root\'s prompt cache key and sends its own session id in the routing header', async () => {
  await withSubagentSessions(providerProfile('opencode'), async ({ ctx, requests }) => {
    await collect(ctx.llm.stream({ provider: 'opencode', model: 'gpt-6-sol', sessionId: 'i123-child', messages: SESSION_MESSAGES }))
    assert.equal(requests.length, 1)
    assert.equal(requests[0].body.prompt_cache_key, 'i123-root', 'the prompt cache belongs to the root session')
    assert.equal(requests[0].headers['x-opencode-session'], 'i123-child', 'the routing header is the current session\'s')
    await collect(ctx.llm.stream({ provider: 'opencode', model: 'gpt-6-sol', sessionId: 'i123-root', messages: SESSION_MESSAGES }))
    assert.equal(requests[1].headers['x-opencode-session'], 'i123-root')
  })
})

test('opencode: without cache retention the routing header is still sent with the current session id', async () => {
  const profiles = providerProfile('opencode')
  profiles.opencode.cacheRetention = 'none'
  await withSubagentSessions(profiles, async ({ ctx, requests }) => {
    await collect(ctx.llm.stream({ provider: 'opencode', model: 'gpt-6-sol', sessionId: 'i123-child', messages: SESSION_MESSAGES }))
    assert.equal(requests.length, 1)
    assert.equal(requests[0].body.prompt_cache_key, undefined, 'no prompt cache key without retention')
    assert.equal(requests[0].headers['x-opencode-session'], 'i123-child')
  })
})

test('opencode: the remote compaction request carries the routing header of the current session too', async () => {
  await withSubagentSessions(providerProfile('opencode'), async ({ ctx, requests }) => {
    // The mocked endpoint answers with an ordinary stream, so the compaction itself fails; the request is what counts.
    await collect(ctx.llm.stream({
      provider: 'opencode',
      model: 'gpt-6-sol',
      sessionId: 'i123-child',
      purpose: 'compaction',
      messages: [...SESSION_MESSAGES, { role: 'user', content: [{ type: 'text', text: 'compact now' }] }],
    })).catch(() => undefined)
    assert.ok(requests.length >= 1, 'LCX sent the compaction request')
    assert.equal(requests[0].headers['x-opencode-session'], 'i123-child')
  })
})

test('opencode Grok route: the routing header is the current session\'s as well, with and without cache retention', async () => {
  for (const cacheRetention of [undefined, 'none']) {
    const profiles = providerProfile('opencode')
    if (cacheRetention) profiles.opencode.cacheRetention = cacheRetention
    await withSubagentSessions(profiles, async ({ ctx, requests }) => {
      await collect(ctx.llm.stream({ provider: 'opencode', model: 'grok-4.7', sessionId: 'i123-child', messages: SESSION_MESSAGES }))
      assert.equal(requests.length, 1)
      assert.equal(requests[0].headers['x-opencode-session'], 'i123-child', String(cacheRetention))
    }, { grokNativeWebSearch: true })
  }
})
