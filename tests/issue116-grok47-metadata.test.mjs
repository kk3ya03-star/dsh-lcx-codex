import test from 'node:test'
import assert from 'node:assert/strict'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { authenticatedGrokHeaders, resolveGrokResponsesRouteConfig } from '../lib/route.js'
import { providerContext } from './provider-context-fixture.mjs'

// Issue 116: the Grok 4.7 metadata LCX's Grok paths rely on, pinned against the bundled Pi 1.1.0 catalog (the Pi
// of DSH 0.2.1-alpha.2). LCX hardcodes none of it: the route resolves the descriptor from the catalog and the
// context window that sizes the pressure bands comes from DSH (profile, then catalog). The QA route that copied
// grok-4.6's 262144 window for grok-4.7 was a profile choice; the catalog says 500000 for both.

const providers = ['xai', 'opencode', 'opencode-go', 'github-copilot']
const policy = { timeoutMs: 300000, maxAttempts: 3, maxRequestImageBytes: 100, requestImagePixelBudget: 200, requestImageMaxBytes: 300 }
const entry = (provider, id) => getBuiltinModels(provider).find(model => model.id === id)
const supported = descriptor => Object.entries(descriptor.thinkingLevelMap).filter(([, wire]) => wire !== null).map(([level]) => level)

for (const provider of providers) {
  test(`${provider}/grok-4.7 catalog metadata matches what the Grok paths assume`, () => {
    const model = entry(provider, 'grok-4.7')
    assert.ok(model, 'the catalog ships the model')
    // Responses route: LCX only owns openai-responses models.
    assert.equal(model.api, 'openai-responses')
    // Pressure anchoring reads the context window from DSH; the catalog value DSH starts from is 500000 and
    // is identical to grok-4.6's, so a 262144 copy in a QA profile is a configuration, not a catalog fact.
    assert.equal(model.contextWindow, 500000)
    assert.equal(model.contextWindow, entry(provider, 'grok-4.6').contextWindow)
    assert.equal(model.maxTokens, provider === 'github-copilot' ? 128000 : 500000)
    // Reasoning and image input: encrypted reasoning is requested, levels low..xhigh, no off / minimal / max.
    assert.equal(model.reasoning, true)
    assert.deepEqual(model.input, ['text', 'image'])
    assert.deepEqual(supported(model), ['low', 'medium', 'high', 'xhigh'])
    // Compat: no explicit-cache / grammar / tool-search flags; long retention is not offered by xAI.
    for (const flag of ['supportsAdditionalTools', 'supportsToolSearch', 'supportsExplicitPromptCacheMode', 'supportsOpenAIGrammarTools'])
      assert.equal(model.compat?.[flag], undefined, flag)
    assert.notEqual(model.compat?.supportsLongCacheRetention, true)
    assert.deepEqual(model.thinkingLevelMap, entry(provider, 'grok-4.6').thinkingLevelMap, '4.7 reasons exactly like 4.6')
  })

  test(`${provider}/grok-4.7 resolves on the Grok route from the catalog with the catalog descriptor and short cache retention`, async () => {
    const model = entry(provider, 'grok-4.7')
    const ctx = providerContext({ [provider]: { apiKeyEnv: 'K' } })
    const route = resolveGrokResponsesRouteConfig(ctx, { provider, model: 'grok-4.7' }, policy)
    assert.ok(route, 'a credential-only profile owns it')
    assert.equal(route.baseURL, model.baseUrl)
    assert.equal(route.modelDefaults.reasoning, true)
    assert.deepEqual(route.modelDefaults.thinkingLevelMap, model.thinkingLevelMap)
    assert.equal(route.modelControls.includeEncryptedReasoning, true)
    assert.equal(route.cacheRetention, 'short')
    assert.equal(route.supportsLongCacheRetention, false)
    // opencode routes declare the no-session affinity format: a request id, no session header.
    const headers = await authenticatedGrokHeaders({ credentials: { resolve: async () => ({ value: 'key' }) } }, route, 'session-1')
    if (model.compat?.sessionAffinityFormat === 'openai-nosession') {
      assert.equal(headers.session_id, undefined)
      assert.equal(headers['x-client-request-id'], 'session-1')
    } else {
      assert.equal(headers.session_id, 'session-1')
    }
  })
}
