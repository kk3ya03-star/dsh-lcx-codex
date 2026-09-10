import test from 'node:test'
import assert from 'node:assert/strict'
import { grokVisibleFunctionTools, grokWireTools } from '../lib/grok-native-search.js'
import { resolveGrokResponsesRouteConfig, resolveResponsesRouteConfig } from '../lib/route.js'
import { functionTools, xaiProfile } from './grok-fixture.mjs'

const policy = {
  timeoutMs: 300000, maxAttempts: 3, maxRequestImageBytes: 100,
  requestImagePixelBudget: 200, requestImageMaxBytes: 300,
}

function routeContext(providers) {
  return { settings: { get: () => ({ providers }) } }
}

test('Grok tool projection conditionally suppresses local x_search collisions', () => {
  const tools = [
    ...functionTools,
    { name: 'x_search', description: 'Local MCP X search', parameters: { type: 'object', properties: {} } },
  ]
  for (const [state, expected] of [
    [{ web: true, x: false }, ['function:web_fetch', 'function:workspace_read', 'function:x_search', 'web_search']],
    [{ web: false, x: true }, ['function:web_fetch', 'function:workspace_read', 'x_search']],
    [{ web: true, x: true }, ['function:web_fetch', 'function:workspace_read', 'web_search', 'x_search']],
  ]) {
    const visible = grokVisibleFunctionTools(tools, state)
    const serialized = visible.map(tool => ({ type: 'function', name: tool.name }))
    const wire = grokWireTools(serialized, state)
    assert.deepEqual(wire.map(tool => tool.type === 'function' ? `function:${tool.name}` : tool.type), expected)
    assert.equal(wire.filter(tool => tool.type === 'function' && tool.name === 'web_search').length, 0)
    assert.equal(wire.filter(tool => tool.type === 'function' && tool.name === 'x_search').length, state.x ? 0 : 1)
  }
})

test('arbitrary provider and mixed-case custom Grok model resolve from selected DSH profile', () => {
  const profile = {
    ...xaiProfile,
    apiKeyEnv: 'RELAY_FIXTURE_KEY',
    headers: { 'x-route-owner': 'relay' },
    models: [{ id: 'GrOkCustomPreview', reasoningEfforts: { off: null, high: 'relay-high' } }],
  }
  const resolved = resolveGrokResponsesRouteConfig(
    routeContext({ relay: profile }),
    { provider: 'relay', model: 'GrOkCustomPreview' },
    policy,
  )
  assert.equal(resolved.provider, 'relay')
  assert.equal(resolved.model, 'GrOkCustomPreview')
  assert.equal(resolved.baseURL, profile.baseURL)
  assert.equal(resolved.apiKeyEnv, profile.apiKeyEnv)
  assert.deepEqual(resolved.headers, profile.headers)
  assert.equal(resolved.modelDefaults, undefined, 'unknown model needs no Pi catalog entry')
  assert.equal(resolved.modelControls.includeEncryptedReasoning, true)
  assert.equal(resolved.modelControls.thinkingLevelMap.high, 'relay-high')
  assert.equal(Object.hasOwn(resolved.modelControls.thinkingLevelMap, 'off'), false)
  assert.equal(resolved.modelControls.thinkingLevelMap.medium, null)
})

test('same-ID xAI metadata does not cross provider ownership boundaries', () => {
  const profile = {
    api: 'openai-responses', baseURL: 'https://relay.example/v1',
    apiKeyEnv: 'RELAY_KEY', models: [{ id: 'grok-4.6' }],
  }
  const resolved = resolveGrokResponsesRouteConfig(
    routeContext({ thirdParty: profile }),
    { provider: 'thirdParty', model: 'grok-4.6' },
    policy,
  )
  assert.equal(resolved.provider, 'thirdParty')
  assert.equal(resolved.model, 'grok-4.6')
  assert.equal(resolved.baseURL, profile.baseURL)
  assert.equal(resolved.modelDefaults, undefined)
  assert.deepEqual(resolved.modelControls, {
    reasoning: false,
    includeEncryptedReasoning: true,
  })
})

test('xAI descriptor fallback never supplies third-party API or endpoint authority', () => {
  const selected = { provider: 'thirdParty', model: 'grok-4.6' }
  for (const profile of [
    { apiKeyEnv: 'RELAY_KEY', models: [{ id: 'grok-4.6' }] },
    { api: 'openai-responses', apiKeyEnv: 'RELAY_KEY' },
    { baseURL: 'https://relay.example/v1', apiKeyEnv: 'RELAY_KEY' },
  ]) {
    assert.equal(
      resolveGrokResponsesRouteConfig(routeContext({ thirdParty: profile }), selected, policy),
      undefined,
    )
  }
})

test('declared reasoning aliases replace optional defaults on an arbitrary provider', () => {
  const profile = {
    ...xaiProfile,
    models: [{ id: 'grok-4.6', reasoningEfforts: { off: null, low: 'gateway-low' } }],
  }
  const resolved = resolveGrokResponsesRouteConfig(
    routeContext({ relay: profile }), { provider: 'relay', model: 'grok-4.6' }, policy,
  )
  assert.equal(resolved.modelControls.thinkingLevelMap.low, 'gateway-low')
  assert.equal(resolved.modelControls.thinkingLevelMap.high, null)
})

test('Grok route freezes profile reasoning and separates request from idle timeout', () => {
  const defaults = resolveGrokResponsesRouteConfig(
    routeContext({ xai: { ...xaiProfile, reasoning: 'medium' } }),
    { provider: 'xai', model: 'grok-4.6' },
    policy,
  )
  assert.equal(defaults.profileReasoning, 'medium')
  assert.equal(defaults.timeoutMs, undefined, 'LCX policy must not become a Grok total deadline')
  assert.equal(defaults.streamIdleTimeoutMs, 300000)

  const explicit = resolveGrokResponsesRouteConfig(
    routeContext({ xai: { ...xaiProfile, timeoutMs: 1234, streamIdleTimeoutMs: 5678 } }),
    { provider: 'xai', model: 'grok-4.6' },
    policy,
  )
  assert.equal(explicit.timeoutMs, 1234)
  assert.equal(explicit.streamIdleTimeoutMs, 5678)
})

test('non-Grok, non-Responses, and incomplete selected profiles do not activate native search', () => {
  const selected = { provider: 'relay', model: 'grokCustom' }
  const resolve = (profile, overrides = {}) => resolveGrokResponsesRouteConfig(
    routeContext({ relay: profile }), { ...selected, ...overrides }, policy,
  )
  assert.equal(resolve(xaiProfile, { model: 'agrok-4.6' }), undefined)
  assert.equal(resolve({ ...xaiProfile, api: 'anthropic-messages' }), undefined)
  assert.equal(resolve({ ...xaiProfile, apiKeyEnv: '' }), undefined)
  assert.equal(resolve({ api: 'openai-responses', apiKeyEnv: 'KEY' }), undefined)
  assert.equal(resolveGrokResponsesRouteConfig(routeContext({}), selected, policy), undefined)
})

test('alpha.2 configurable-provider diagnostics fail closed for GPT and Grok routes', () => {
  const profiles = { relay: { ...xaiProfile, models: [{ id: 'grokCustom' }, { id: 'gpt-custom' }] } }
  const ctx = {
    settings: { get: () => ({ providers: profiles }) },
    llm: { listConfigurableProviders: () => [{
      provider: 'relay', displayName: 'Relay', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'relay'],
      error: 'catalog entry is unusable',
    }] },
  }
  assert.equal(resolveGrokResponsesRouteConfig(ctx, { provider: 'relay', model: 'grokCustom' }, policy), undefined)
  assert.equal(resolveResponsesRouteConfig(ctx, { provider: 'relay', model: 'gpt-custom' }, policy), undefined)
  ctx.llm.listConfigurableProviders = () => [{ provider: 'relay', displayName: 'Relay', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'relay'] }]
  assert.ok(resolveGrokResponsesRouteConfig(ctx, { provider: 'relay', model: 'grokCustom' }, policy))
  assert.ok(resolveResponsesRouteConfig(ctx, { provider: 'relay', model: 'gpt-custom' }, policy))
  ctx.llm.listConfigurableProviders = () => { throw new Error('directory unavailable') }
  assert.equal(resolveResponsesRouteConfig(ctx, { provider: 'relay', model: 'gpt-custom' }, policy), undefined)
})
