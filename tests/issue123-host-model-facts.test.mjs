import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
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

async function harness(root, profiles, settings = {}) {
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
  apply(host, configInput)
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

async function withHarness(profiles, settings, run) {
  const root = await mkdtemp(resolve('.i123-'))
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init.body)) })
    return sse('reply')
  }
  try {
    const h = await harness(root, profiles, settings)
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

test('gpt-6.1-sol, newer than the bundled Pi 0.87.1, is owned and follows the tool-update mode the host declares', async () => {
  const profiles = desktopProfiles()
  profiles.openai.models.push(entry('gpt-6.1-sol'))
  await withHarness(profiles, {}, async ({ ctx, setting, open, requests, warnings }) => {
    const info = await ctx.llm.resolveModelInfo('openai', 'gpt-6.1-sol')
    // Host Pi 1.1.0 describes the model; LCX's own catalog (Pi 0.87.1) does not know it.
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

test('a model that a models list leaves out is refused as not configured', async () => {
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
    assert.equal(finish.reason.failure.code, 'NO_ADAPTER')
    assert.match(finish.reason.failure.message, /not configured for this provider/u)
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
      assert.equal(failure.code, 'NO_ADAPTER', model)
      assert.match(failure.message, /not configured for this provider/u, model)
    }
    assert.equal(requests.length, 0, 'zero network requests')
    assert.equal(lookups, 0, 'no host lookup for a model the profile excludes')
    const routeCtx = { llm: ctx.llm, settings: { describe: () => forms.describe() } }
    assert.equal(resolveResponsesRouteConfig(routeCtx, { provider: 'openai', model: 'gpt-6-sol' }, {}), undefined)
    assert.ok(resolveResponsesRouteConfig(routeCtx, { provider: 'openai', model: 'gpt-6.1-sol' }, {}), 'the listed model resolves')
    assert.equal(resolveGrokResponsesRouteConfig(routeCtx, { provider: 'xai', model: 'grok-4.7' }, {}), undefined)
    assert.ok(resolveGrokResponsesRouteConfig(routeCtx, { provider: 'xai', model: 'grok-4.6' }, {}))
  })
})

// The Technical Lead repro: no `models` list at all. Host Pi 1.1.0 (this DSH) has gpt-6.1-sol in its own
// catalog and serves it; LCX's bundled Pi 0.87.1 does not know it, and nothing in the profile names it.
const bareProfiles = () => ({ openai: { apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL } })

test('a model only the newer DSH catalog describes is owned on a profile with no models list and no api', async () => {
  await withHarness(bareProfiles(), {}, async ({ ctx, turn, requests, open }) => {
    const info = await ctx.llm.resolveModelInfo('openai', 'gpt-6.1-sol')
    assert.equal(info.toolUpdate, 'addition-only', 'DSH recognizes the model')
    const request = await turn('openai', 'gpt-6.1-sol')
    assert.equal(requests.length, 1)
    assert.equal(request.url, `${baseURL}/responses`)
    assert.equal(request.body.model, 'gpt-6.1-sol')
    // The recognition is remembered: the next turn resolves without asking DSH again for the route.
    const session = await open('openai', 'gpt-6.1-sol')
    try { assert.equal((await session.ask('again')).url, `${baseURL}/responses`) } finally { await session.dispose() }
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
  await withHarness(bareProfiles(), {}, async ({ ctx, turn, requests, forms, setProviders }) => {
    const described = () => forms.describe().find(row => row.ns === 'llm-pi-ai').value.providers.openai
    const streamOnce = () => collect(ctx.llm.stream({
      provider: 'openai',
      model: 'gpt-6.1-sol',
      messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }],
    }))
    // Bare profile: DSH's own catalog serves gpt-6.1-sol and LCX follows (this also records the recognition).
    assert.equal((await turn('openai', 'gpt-6.1-sol')).url, `${baseURL}/responses`)
    assert.equal(requests.length, 1)

    // Live change: the profile now serves only gpt-6-sol. DSH stops resolving gpt-6.1-sol ...
    setProviders({ openai: { apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL, models: [entry('gpt-6-sol')] } })
    assert.deepEqual(described().models.map(model => model.id), ['gpt-6-sol'], 'LCX reads the live profile')
    await assert.rejects(ctx.llm.resolveModelInfo('openai', 'gpt-6.1-sol'), /no configured model/u)
    // ... and so does LCX: no request, NO_ADAPTER.
    const rejected = await streamOnce()
    assert.equal(rejected.at(-1).reason.failure.code, 'NO_ADAPTER')
    assert.equal(requests.length, 1, 'no request left LCX for the removed model')
    // The listed model keeps working.
    assert.equal((await turn('openai', 'gpt-6-sol')).url, `${baseURL}/responses`)
    requests.length = 0

    // Back to a bare profile: DSH serves the model again, a fresh lookup decides and LCX serves it again.
    setProviders(bareProfiles())
    assert.deepEqual(described().models, [], 'the schema materializes an absent models list as empty')
    assert.equal((await turn('openai', 'gpt-6.1-sol')).url, `${baseURL}/responses`)
    assert.equal(requests.length, 1)

    // A models list that still names the model keeps it served; one that drops it is authoritative even for a
    // model LCX recognized earlier.
    setProviders({ openai: { apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL, models: [entry('gpt-6.1-sol')] } })
    assert.equal((await turn('openai', 'gpt-6.1-sol')).body.model, 'gpt-6.1-sol')
    setProviders({ openai: { apiKeyEnv: 'LCX_FIXTURE_KEY', baseURL, models: [entry('gpt-6-luna')] } })
    requests.length = 0
    assert.equal((await streamOnce()).at(-1).reason.failure.code, 'NO_ADAPTER')
    assert.equal(requests.length, 0)
  })
})
