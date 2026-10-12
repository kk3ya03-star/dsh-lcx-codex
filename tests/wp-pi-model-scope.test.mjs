import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SettingsForms } from '@deepseek-ai/dsh-settings'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { Config as PiConfig } from '@deepseek-ai/dsh-llm-pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { serializeDshMessages } from '../lib/dsh-responses.js'
import { buildResponsesBody } from '../lib/responses-request.js'
import { resolveCatalogModel } from '../lib/model-catalog.js'
import { loadHostSource } from './wp2-source.mjs'

const route = await loadHostSource('route')
// The six providers whose catalogs LCX bundles (Pi 1.1.0, the Pi of DSH 0.2.1-alpha.2). A credential-only profile
// (no `api`) owns exactly the GPT / Grok Responses models those catalogs ship: DSH serves nothing else without the
// profile naming it. The pinned set below is the exact computed result, so a catalog change fails here and is reviewed.
const OWNED_PAIRS = {
  'cloudflare-ai-gateway': [
    'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
    'gpt-5.1', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4-pro', 'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.6-luna',
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol',
  ],
  'github-copilot': [
    'gpt-5-mini', 'gpt-5.3-codex', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.5', 'gpt-5.6-luna',
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'grok-4.5', 'grok-4.6',
    'grok-4.7',
  ],
  openai: [
    'gpt-4', 'gpt-4-turbo', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-2024-05-13',
    'gpt-4o-2024-08-06', 'gpt-4o-2024-11-20', 'gpt-4o-mini', 'gpt-5', 'gpt-5-chat-latest', 'gpt-5-mini', 'gpt-5-nano',
    'gpt-5-pro', 'gpt-5.1', 'gpt-5.2', 'gpt-5.2-chat-latest', 'gpt-5.2-pro', 'gpt-5.3-chat-latest', 'gpt-5.3-codex',
    'gpt-5.3-codex-spark', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4-pro', 'gpt-5.5', 'gpt-5.5-pro',
    'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol',
    'gpt-daybreak-blue-latest', 'gpt-daybreak-red-latest', 'gpt-realtime-2.1',
  ],
  opencode: [
    'gpt-5', 'gpt-5-codex', 'gpt-5-nano', 'gpt-5.1', 'gpt-5.1-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini',
    'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.3-codex', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4-pro', 'gpt-5.5',
    'gpt-5.5-pro', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol',
    'gpt-6.1-sol', 'grok-4.5', 'grok-4.6', 'grok-4.7', 'grok-build-0.1',
  ],
  'opencode-go': [
    'gpt-5.6-luna', 'gpt-6-luna', 'grok-4.6', 'grok-4.7',
  ],
  xai: [
    'grok-4.3', 'grok-4.5', 'grok-4.6', 'grok-4.7',
  ],
}
const bundledProviders = Object.keys(OWNED_PAIRS)
const ownedPair = (provider, model) => OWNED_PAIRS[provider]?.includes(model) ?? false
const providers = ['openai', 'xai', 'github-copilot', 'lcx', 'relay']
const models = [
  'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-astra',
  'gpt-6-sol', 'gpt-6-luna', 'grok-4.6', 'grok-4.7',
]
const policy = {
  supportsLongCacheRetention: true,
  supportsExplicitPromptCacheMode: true,
  cacheRetention: 'long',
}

function fixture(shape, selectedProfiles) {
  const ctx = new Context()
  ctx.provide('loader', { await: () => Promise.resolve() }, true)
  ctx.provide('profileContext', { home: 'unused' }, true)
  const profiles = selectedProfiles ?? Object.fromEntries(providers.map(provider => [provider, shape === 'explicit'
    ? { api: 'openai-responses', baseURL: 'https://fixture.invalid/v1', apiKeyEnv: 'SYNTHETIC_KEY' }
    : { apiKeyEnv: 'SYNTHETIC_KEY' }]))
  const raw = { providers: profiles }
  const entry = {
    options: { id: 'llm-pi-ai', config: raw },
    fiber: { uid: 1, state: 2, runtime: { Config: PiConfig }, config: PiConfig(raw), ctx },
  }
  ctx.provide('configEditor', {
    configuration: () => [{ entry, inherited: {}, override: raw }],
    entries: () => [entry],
    async edit() { throw new Error('read-only route fixture') },
  }, true)
  const settings = new SettingsForms(ctx)
  const llm = new LlmRuntime(ctx)
  llm.registerConfigurableProviders(Object.keys(profiles).map(provider => ({
    provider, displayName: provider, settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', provider],
  })))
  return { settings, llm }
}

/** What a profile with or without `api` is expected to own for a provider/model pair. */
function expectedCell(shape, provider, model) {
  // An explicit Responses profile routes by model prefix; a credential-only one needs the catalog to ship the pair.
  const responses = shape === 'explicit' || ownedPair(provider, model)
  const gpt = model.startsWith('gpt-') && responses
  const grok = model.startsWith('grok') && responses
  return {
    gpt, grok,
    request: gpt ? 'managed-gpt' : grok ? 'grok-native' : model.startsWith('gpt-') ? 'fail-closed' : 'passthrough',
    compaction: gpt ? 'native-v2' : model.startsWith('gpt-') ? 'fail-closed' : 'passthrough',
  }
}

test('Decision 8 matrix: ownership follows the bundled catalog for credential-only profiles and the model prefix for explicit ones', () => {
  let cells = 0
  for (const shape of ['omitted', 'explicit']) {
    const context = fixture(shape)
    const projected = context.settings.describe().find(row => row.ns === 'llm-pi-ai').value.providers
    for (const provider of providers) {
      assert.equal(projected[provider].api, shape === 'explicit' ? 'openai-responses' : undefined)
      for (const model of models) {
        const expected = expectedCell(shape, provider, model)
        const options = { provider, model }
        const gpt = route.resolveResponsesRouteConfig(context, options, policy)
        const grok = route.resolveGrokResponsesRouteConfig(context, options, policy)
        const actual = {
          gpt: Boolean(gpt), grok: Boolean(grok),
          request: gpt ? 'managed-gpt' : grok ? 'grok-native' : model.startsWith('gpt-') ? 'fail-closed' : 'passthrough',
          compaction: gpt ? 'native-v2' : model.startsWith('gpt-') ? 'fail-closed' : 'passthrough',
        }
        assert.deepEqual(actual, expected, `${shape} ${provider}/${model}`)
        cells += 1
      }
    }
  }
  assert.equal(cells, 80)
})

test('Decision 8 matrix: owned pairs take the bundled catalog descriptor, all others the defaults and tool wire', async () => {
  const schema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }
  const tool = { name: 'lookup', description: 'fixture tool', parameters: schema, constrainedSampling: { type: 'json_schema', strict: 'prefer' } }
  let catalogBacked = 0
  let defaulted = 0
  for (const shape of ['omitted', 'explicit']) {
    const context = fixture(shape)
    for (const provider of providers) for (const model of models) {
      const cell = expectedCell(shape, provider, model)
      if (!cell.gpt && !cell.grok) continue
      const label = `${shape} ${provider}/${model}`
      const resolved = cell.gpt
        ? route.resolveResponsesRouteConfig(context, { provider, model }, policy)
        : route.resolveGrokResponsesRouteConfig(context, { provider, model }, policy)
      // The descriptor is the provider's own bundled Pi catalog entry whenever one exists.
      const catalog = getBuiltinModels(provider).find(entry => entry.id === model && entry.api === 'openai-responses')
      const expectedCompat = { ...catalog?.compat, ...resolved.responsesCompat }
      const expectedDescriptor = {
        contextWindow: catalog?.contextWindow ?? 262144,
        maxTokens: catalog?.maxTokens ?? 32768,
        compat: Object.keys(expectedCompat).length ? expectedCompat : undefined,
      }
      const serialized = await serializeDshMessages([], undefined, {
        imageSupport: 'unsupported',
        route: { provider, model, baseURL: 'https://fixture.invalid/v1' },
        responsesCompat: resolved.responsesCompat,
        tools: [tool],
      })
      assert.deepEqual({ contextWindow: serialized.model.contextWindow, maxTokens: serialized.model.maxTokens, compat: serialized.model.compat }, expectedDescriptor, label)
      const strict = expectedCompat.supportsStrictMode === true && expectedCompat.supportsOpenAIGrammarTools === true
      const expectedTool = { type: 'function', name: 'lookup', description: 'fixture tool', parameters: schema, ...(strict ? { strict: true } : {}) }
      const body = buildResponsesBody({ model: serialized.model, input: serialized.input, tools: serialized.tools })
      assert.deepEqual(body.tools, [expectedTool], `${label} tool wire`)
      assert.equal(body.tool_choice, undefined, `${label} tool choice`)
      assert.equal(body.parallel_tool_calls, undefined, `${label} parallel tools`)
      assert.deepEqual([...serialized.grammarToolInputProperties], [], `${label} grammar tool fields`)
      assert.equal(serialized.deferredToolsMode, expectedCompat.supportsAdditionalTools === true ? 'additional-tools' : expectedCompat.supportsToolSearch === true ? 'tool-search' : undefined, `${label} dynamic tools`)
      if (catalog) catalogBacked += 1
      else defaulted += 1
    }
  }
  assert.equal(catalogBacked, 32)
  assert.equal(defaulted, 24)
})

test('evidenced capability policy and ordinary routes retain their frozen scope', () => {
  const explicit = fixture('explicit')
  for (const model of ['gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra']) {
    const resolved = route.resolveResponsesRouteConfig(explicit, { provider: 'lcx', model }, policy)
    assert.equal(resolved.cacheRetention, 'long')
    assert.equal(resolved.supportsLongCacheRetention, true)
    assert.equal(resolved.responsesCompat.supportsExplicitPromptCacheMode, true)
  }
  for (const [provider, model] of [['lcx', 'gpt-6-sol'], ['lcx', 'gpt-6-luna'], ['lcx', 'gpt-6-astra'], ['relay', 'gpt-5.6-sol']]) {
    const resolved = route.resolveResponsesRouteConfig(explicit, { provider, model }, policy)
    assert.equal(resolved.cacheRetention, 'short', `${provider}/${model}`)
    assert.equal(resolved.supportsLongCacheRetention, false, `${provider}/${model}`)
    assert.equal(resolved.responsesCompat.supportsExplicitPromptCacheMode, undefined, `${provider}/${model}`)
  }
  const grok = route.resolveGrokResponsesRouteConfig(explicit, { provider: 'xai', model: 'grok-4.6' }, policy)
  assert.deepEqual(Object.fromEntries(Object.entries(grok.modelControls.thinkingLevelMap).filter(([, value]) => value !== null).map(([key]) => [key, true])),
    { low: true, medium: true, high: true, xhigh: true })
  // The provider's own catalog entry describes its models whether or not Pi 0.86 had it (Issue #123) ...
  const newGrok = route.resolveGrokResponsesRouteConfig(explicit, { provider: 'xai', model: 'grok-4.7' }, policy)
  assert.equal(newGrok.modelDefaults.reasoning, true)
  assert.deepEqual(Object.keys(newGrok.modelDefaults.thinkingLevelMap).filter(key => newGrok.modelDefaults.thinkingLevelMap[key] !== null), ['low', 'medium', 'high', 'xhigh'])
  // ... but a catalog entry never lifts into a provider the catalog does not ship.
  const relayGrok = route.resolveGrokResponsesRouteConfig(explicit, { provider: 'relay', model: 'grok-4.7' }, policy)
  assert.equal(relayGrok.modelDefaults, undefined, 'catalog metadata must not lift into an ordinary explicit route')
})

test('exact capability predicate, case behavior, and non-Responses profiles match Step 0(c)', () => {
  const context = fixture('explicit', {
    lcx: { api: 'openai-responses', baseURL: 'https://fixture.invalid/v1', apiKeyEnv: 'SYNTHETIC_KEY' },
    relay: { api: 'openai-responses', baseURL: 'https://fixture.invalid/v1', apiKeyEnv: 'SYNTHETIC_KEY' },
    completions: { api: 'openai-completions', baseURL: 'https://fixture.invalid/v1', apiKeyEnv: 'SYNTHETIC_KEY' },
  })
  for (const model of ['gpt-5.6-sol-preview', 'gpt-5.6-astra', 'gpt-6-sol']) {
    const resolved = route.resolveResponsesRouteConfig(context, { provider: 'lcx', model }, policy)
    assert.equal(resolved.cacheRetention, 'short', model)
    assert.equal(resolved.responsesCompat.supportsExplicitPromptCacheMode, undefined, model)
  }
  assert.equal(route.resolveResponsesRouteConfig(context, { provider: 'LCX', model: 'gpt-5.6-sol' }, policy), undefined)
  const upper = route.resolveResponsesRouteConfig(context, { provider: 'lcx', model: 'GPT-5.6-SOL' }, policy)
  assert.equal(upper.cacheRetention, 'long')
  assert.equal(upper.responsesCompat.supportsExplicitPromptCacheMode, undefined)
  assert.equal(route.resolveGrokResponsesRouteConfig(context, { provider: 'relay', model: 'agrok-4.7' }, policy), undefined)
  assert.ok(route.resolveGrokResponsesRouteConfig(context, { provider: 'relay', model: 'grokCustom' }, policy))
  for (const provider of ['completions', 'noprofile']) {
    assert.equal(route.resolveResponsesRouteConfig(context, { provider, model: 'gpt-6-sol' }, policy), undefined)
    assert.equal(route.resolveGrokResponsesRouteConfig(context, { provider, model: 'grok-4.7' }, policy), undefined)
  }
})

test('the catalog fills the endpoint of a model it ships; a model it does not ship needs the profile to declare it', () => {
  const context = fixture('explicit', {
    openai: { api: 'openai-responses', apiKeyEnv: 'SYNTHETIC_KEY' },
    xai: { api: 'openai-responses', apiKeyEnv: 'SYNTHETIC_KEY' },
    declared: { api: 'openai-responses', apiKeyEnv: 'SYNTHETIC_KEY' },
  })
  assert.equal(route.resolveResponsesRouteConfig(context, { provider: 'openai', model: 'gpt-6-astra' }, policy).baseURL, 'https://api.openai.com/v1')
  assert.equal(route.resolveResponsesRouteConfig(context, { provider: 'openai', model: 'gpt-6-sol' }, policy).baseURL, 'https://api.openai.com/v1')
  assert.equal(route.resolveGrokResponsesRouteConfig(context, { provider: 'xai', model: 'grok-4.7' }, policy).baseURL, 'https://api.x.ai/v1')
  // DSH serves no model its catalog does not describe unless the profile lists it, so an unlisted unknown model stays unresolved.
  assert.equal(route.resolveResponsesRouteConfig(context, { provider: 'openai', model: 'gpt-9-unlisted' }, policy), undefined)
  assert.equal(route.resolveGrokResponsesRouteConfig(context, { provider: 'xai', model: 'grok-9-unlisted' }, policy), undefined)
  // A custom-named route has no catalog to fill from.
  assert.equal(route.resolveResponsesRouteConfig(context, { provider: 'declared', model: 'gpt-6-sol' }, policy), undefined)
})

// Cloudflare AI Gateway authenticates through Pi's own client (account and gateway ids in the endpoint, the key as
// cf-aig-authorization with Authorization removed), which LCX cannot reproduce from one credential reference: DSH
// serves those pairs, LCX does not claim them.
const HOST_AUTH = ['cloudflare-ai-gateway']

test('the owned set: every GPT / Grok Responses pair of the bundled catalogs is owned by a credential-only profile, as a catalog hit, except host-authenticated providers', () => {
  const computed = Object.fromEntries(bundledProviders.map(provider => [provider,
    getBuiltinModels(provider).filter(model => model.api === 'openai-responses' && /^(?:gpt-|grok)/iu.test(model.id)).map(model => model.id).sort()]))
  assert.deepEqual(computed, OWNED_PAIRS)
  assert.equal(Object.values(OWNED_PAIRS).flat().length, 111)
  const context = fixture('omitted', Object.fromEntries(bundledProviders.map(provider => [provider, { apiKeyEnv: 'SYNTHETIC_KEY' }])))
  let owned = 0
  for (const [provider, ids] of Object.entries(OWNED_PAIRS)) for (const model of ids) {
    const pair = `${provider}/${model}`
    const resolved = model.startsWith('gpt-')
      ? route.resolveResponsesRouteConfig(context, { provider, model }, policy)
      : route.resolveGrokResponsesRouteConfig(context, { provider, model }, policy)
    if (HOST_AUTH.includes(provider)) {
      assert.equal(resolved, undefined, `${pair} is left to DSH`)
      assert.equal(route.diagnoseResponsesRoute(context, { provider, model }), 'host-auth', pair)
      continue
    }
    assert.ok(resolved, pair)
    assert.equal(resolved.api, 'openai-responses', pair)
    assert.equal(resolveCatalogModel(provider, model).source, 'catalog-model', pair)
    owned += 1
  }
  assert.equal(owned, 111 - OWNED_PAIRS['cloudflare-ai-gateway'].length)
  // Nothing outside the set is owned: a pair the provider's catalog lacks, a GPT model on a Grok provider, and so on.
  for (const [provider, model] of [['xai', 'gpt-5.6-sol'], ['openai', 'grok-4.7'], ['openai', 'gpt-9-unlisted'], ['xai', 'grok-9-unlisted']]) {
    assert.equal(route.resolveResponsesRouteConfig(context, { provider, model }, policy), undefined, `${provider}/${model}`)
    assert.equal(route.resolveGrokResponsesRouteConfig(context, { provider, model }, policy), undefined, `${provider}/${model}`)
  }
  // gpt-6.1-sol, the model that first exposed the frozen-catalog defect, is described by the bundled catalog.
  const sol61 = resolveCatalogModel('openai', 'gpt-6.1-sol')
  assert.equal(sol61.source, 'catalog-model')
  assert.equal(sol61.descriptor.compat.supportsAdditionalTools, true)
  // An explicit profile does not change who authenticates: the provider is still left to DSH.
  const explicit = fixture('explicit', { 'cloudflare-ai-gateway': { api: 'openai-responses', baseURL: 'https://gw.example/v1', apiKeyEnv: 'K' } })
  assert.equal(route.resolveResponsesRouteConfig(explicit, { provider: 'cloudflare-ai-gateway', model: 'gpt-6-sol' }, policy), undefined)
})

test('Pi 1.1.0 catalog: no bundled Responses model sets sampling parameters, which the LCX body builder does not merge', () => {
  // Pi 1.1.0 merges model.samplingParams / samplingParamsByThinkingLevel into its request. None of the bundled
  // providers uses them today; a catalog that starts to must be reviewed against buildResponsesBody first.
  for (const provider of bundledProviders)
    for (const model of getBuiltinModels(provider))
      assert.ok(model.samplingParams === undefined && model.samplingParamsByThinkingLevel === undefined, `${provider}/${model.id}`)
})
