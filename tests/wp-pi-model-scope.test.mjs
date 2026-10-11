import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { SettingsForms } from '@deepseek-ai/dsh-settings'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { Config as PiConfig } from '@deepseek-ai/dsh-llm-pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { serializeDshMessages } from '../lib/dsh-responses.js'
import { buildResponsesBody } from '../lib/responses-request.js'
import { loadHostSource } from './wp2-source.mjs'

const route = await loadHostSource('route')
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const pi086 = read('../data/pi086-responses-models.json')
// Exact route observations from Issue #90 Step 0(c): data/out-lib086.json
// and data/outmin-lib086.json, reduced in data/step0c-route-086.json.
const probe086 = read('../data/step0c-route-086.json')
const matrix086 = read('../data/model-scope-086-matrix.json')
// Reduced from Issue #90's recorded runtime/pi-catalog/catalog-v0.86.0.json.
const descriptors086 = read('../data/pi086-responses-descriptors.json')
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

test('pinned Pi 0.86 provider/model allowlist is generated without drift', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/generate-pi086-allowlist.mjs', import.meta.url)), '--check'])
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/generate-model-scope-086-matrix.mjs', import.meta.url)), '--check'])
})

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

test('frozen Pi 0.86 probe anchors agree with the provider-keyed baseline', () => {
  const anchors = [
    ['omitted', 'openai', 'gpt-5.6-sol', 'openai gpt-5.6-sol'],
    ['omitted', 'openai', 'gpt-6-astra', 'openai gpt-6-astra'],
    ['omitted', 'openai', 'gpt-6-sol', 'openai gpt-6-sol'],
    ['omitted', 'openai', 'gpt-6-luna', 'openai gpt-6-luna'],
    ['omitted', 'github-copilot', 'gpt-6-sol', 'github-copilot gpt-6-sol'],
    ['omitted', 'xai', 'grok-4.6', 'xai grok-4.6'],
    ['omitted', 'xai', 'grok-4.7', 'xai grok-4.7'],
    ['omitted', 'github-copilot', 'grok-4.7', 'github-copilot grok-4.7'],
    ['explicit', 'lcx', 'gpt-5.6-sol', 'lcx gpt-5.6-sol'],
    ['explicit', 'lcx', 'gpt-6-sol', 'lcx gpt-6-sol'],
    ['explicit', 'xai', 'grok-4.6', 'xai grok-4.6'],
    ['explicit', 'xai', 'grok-4.7', 'xai grok-4.7'],
    ['explicit', 'relay', 'gpt-5.6-sol', 'relay gpt-5.6-sol (non-lcx provider, same id)'],
    ['explicit', 'relay', 'grok-4.7', 'relay grok-4.7 (grok on non-xai)'],
  ]
  for (const [shape, provider, model, label] of anchors) {
    const observed = probe086[shape][label]
    assert.ok(observed, label)
    const expected = matrix086[shape][provider][model]
    assert.deepEqual(observed, { gpt: expected.gpt, grok: expected.grok }, label)
  }
})

// Issue #123: ownership of a credential-only profile follows what DSH resolves, which is its installed Pi
// catalog and no longer Pi 0.86. The frozen 0.86 baseline stays the reference; the only cells that may differ
// are the pairs Pi 0.87.1 ships as Responses models and 0.86 lacked (also listed in the catalog-shape test).
const newSincePi086 = {
  'openai gpt-6-sol': 'gpt', 'openai gpt-6-luna': 'gpt',
  'github-copilot gpt-6-sol': 'gpt', 'github-copilot gpt-6-luna': 'gpt',
  'xai grok-4.7': 'grok', 'github-copilot grok-4.7': 'grok',
}

function expectedCell(shape, provider, model) {
  const cell = matrix086[shape][provider][model]
  const kind = shape === 'omitted' ? newSincePi086[`${provider} ${model}`] : undefined
  if (kind === undefined) return cell
  return {
    gpt: kind === 'gpt', grok: kind === 'grok',
    request: kind === 'gpt' ? 'managed-gpt' : 'grok-native',
    compaction: kind === 'gpt' ? 'native-v2' : 'passthrough',
  }
}

test('Decision 8 matrix: ownership is the frozen 0.86 baseline plus the pairs the Pi 0.87.1 catalog ships', () => {
  let cells = 0
  let expanded = 0
  for (const shape of ['omitted', 'explicit']) {
    const context = fixture(shape)
    const projected = context.settings.describe().find(row => row.ns === 'llm-pi-ai').value.providers
    for (const provider of providers) {
      assert.equal(projected[provider].api, shape === 'explicit' ? 'openai-responses' : undefined)
      for (const model of models) {
        const expected = expectedCell(shape, provider, model)
        if (expected !== matrix086[shape][provider][model]) expanded += 1
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
  assert.equal(expanded, Object.keys(newSincePi086).length)
})

test('Decision 8 matrix: owned pairs take the bundled catalog descriptor, all others the frozen defaults and tool wire', async () => {
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
      const frozen = descriptors086[provider]?.[model]
      assert.equal(Boolean(frozen), pi086[provider]?.includes(model) ?? false, `${label} frozen catalog snapshot`)
      // The descriptor is the provider's own Pi 0.87.1 catalog entry whenever one exists, whether or not 0.86 had it.
      const catalog = getBuiltinModels(provider).find(entry => entry.id === model && entry.api === 'openai-responses')
      if (frozen) assert.ok(catalog, `${label} 0.86-listed pair still exists in current catalog`)
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

test('Pi 0.87.1 catalog shape: the pairs new since Pi 0.86 are owned on credential-only profiles', () => {
  for (const [provider, ids] of Object.entries(pi086)) {
    const now = new Set(getBuiltinModels(provider).filter(model => model.api === 'openai-responses').map(model => model.id))
    for (const id of ids) assert.ok(now.has(id), `${provider}/${id} removed`)
  }
  for (const id of ['gpt-6-sol', 'gpt-6-luna']) assert.ok(getBuiltinModels('openai').some(model => model.id === id))
  assert.ok(getBuiltinModels('xai').some(model => model.id === 'grok-4.7'))
  const newGptGrok = Object.fromEntries(Object.keys(pi086).map(provider => [provider,
    getBuiltinModels(provider).map(model => model.id).filter(id => /^(?:gpt-|grok)/iu.test(id) && !pi086[provider].includes(id)).sort()]))
  assert.deepEqual(newGptGrok, {
    'cloudflare-ai-gateway': [],
    'github-copilot': ['gpt-6-luna', 'gpt-6-sol', 'grok-4.7'],
    openai: ['gpt-6-luna', 'gpt-6-sol'],
    opencode: ['gpt-6-luna', 'gpt-6-sol'],
    'opencode-go': ['grok-4.7'],
    xai: ['grok-4.7'],
  })
  // Issue #123: a credential-only profile follows the catalog DSH resolves from, not the 0.86 snapshot.
  const omitted = fixture('omitted')
  for (const [provider, model] of [['openai', 'gpt-6-sol'], ['github-copilot', 'gpt-6-luna']])
    assert.ok(route.resolveResponsesRouteConfig(omitted, { provider, model }, policy), `${provider}/${model}`)
  assert.ok(route.resolveGrokResponsesRouteConfig(omitted, { provider: 'xai', model: 'grok-4.7' }, policy))
  assert.equal(route.resolveResponsesRouteConfig(omitted, { provider: 'xai', model: 'grok-4.7' }, policy), undefined)
})
