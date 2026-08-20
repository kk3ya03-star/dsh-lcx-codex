import test from 'node:test'
import assert from 'node:assert/strict'
import { requestNativeCompaction } from '../lib/compact-v2.js'
import { LcxResponsesSearchProvider } from '../lib/index.js'
import { fetchJsonWithRetry } from '../lib/transport.js'
import { buildHostedSearchBody, normalizeHostedSearchArgs, parseHostedSearchResponse } from '../lib/web-search-hosted.js'
import {
  ALPHA_SCHEMA_FINGERPRINT,
  buildAlphaSearchBody,
  normalizeAlphaSearchArgs,
  parseAlphaSearchResponse,
  probeAlphaCapabilities,
} from '../lib/web-search-alpha.js'

const apiKeyConfigured = String(process.env.LCX_API_KEY ?? '').trim().length > 0
const model = String(process.env.LCX_MODEL ?? '').trim()
const modelConfigured = model.length > 0
const enabled = process.env.RUN_LCX_E2E === '1' && apiKeyConfigured && modelConfigured
const baseURL = String(process.env.LCX_BASE_URL ?? 'https://api.lcxbot.com/v1').replace(/\/+$/u, '')
const timeoutMs = Number(process.env.LCX_E2E_TIMEOUT_MS ?? 120000)
const alphaEnabled = enabled && process.env.RUN_LCX_ALPHA_E2E === '1'

function skipReason() {
  return 'set RUN_LCX_E2E=1, LCX_API_KEY, and the exact backend-tested LCX_MODEL to enable real Sub2API/OAuth checks'
}

test('real hosted Responses Web Search contract', { skip: !enabled && skipReason() }, async () => {
  const provider = new LcxResponsesSearchProvider({
    webSearchProvider: 'lcx-responses',
    baseURL,
    model,
    apiKeyEnv: 'LCX_API_KEY',
    timeoutMs,
    maxResponseBytes: 4 * 1024 * 1024,
    maxAttempts: 2,
    webMaxResults: 8,
  })
  const result = await provider.search({ query: 'OpenAI Responses compact official documentation', maxResults: 3 }, AbortSignal.timeout(timeoutMs))
  assert.ok(result.content.length > 0 || result.sources.length > 0)
  assert.ok(result.sources.every((source) => typeof source.url === 'string'))
})

test('real hosted Responses Web Search structured controls', { skip: !enabled && skipReason() }, async () => {
  const args = normalizeHostedSearchArgs({
    query: 'OpenAI Responses API web search official documentation',
    searchContextSize: 'low',
    allowedDomains: ['platform.openai.com', 'developers.openai.com'],
    userLocation: { country: 'US', timezone: 'America/New_York' },
    externalWebAccess: true,
    returnTokenBudget: 'default',
    searchContentTypes: ['text'],
  })
  const response = await fetchJsonWithRetry(
    `${baseURL}/responses`,
    buildHostedSearchBody(args, model),
    { authorization: `Bearer ${process.env.LCX_API_KEY}` },
    AbortSignal.timeout(timeoutMs),
    timeoutMs,
    { maxAttempts: 1, maxResponseBytes: 4 * 1024 * 1024 },
  )
  const result = parseHostedSearchResponse(response, 'e2e-hosted-fallback')
  assert.equal(result.mode, 'hosted')
  assert.ok(result.sources.every((source) => /^https?:\/\//u.test(source.url)))
})

test('real Alpha capability classification', { skip: !alphaEnabled && 'set RUN_LCX_ALPHA_E2E=1 in addition to the normal LCX e2e variables' }, async () => {
  const sessionId = `dsh-lcx-codex-e2e-alpha-${Date.now()}`
  const invoke = async (input) => {
    const args = normalizeAlphaSearchArgs(input)
    const response = await fetchJsonWithRetry(
      `${baseURL}/alpha/search`,
      buildAlphaSearchBody(args, model, sessionId, true),
      { authorization: `Bearer ${process.env.LCX_API_KEY}`, 'session-id': sessionId },
      AbortSignal.timeout(timeoutMs),
      timeoutMs,
      { maxAttempts: 1, maxResponseBytes: 4 * 1024 * 1024 },
    )
    return parseAlphaSearchResponse(response, { action: args.action, capability: 'unknown', requestId: 'e2e-alpha-fallback' })
  }
  const record = await probeAlphaCapabilities({
    invoke,
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    clickProbeRef: 'https://en.wikipedia.org/wiki/OpenAI',
    screenshotProbeRef: 'https://arxiv.org/pdf/1706.03762',
  })
  assert.ok(['command-capable', 'emulated-search-only', 'unsupported'].includes(record.classification))
  if (record.classification === 'command-capable') {
    assert.equal(record.actions.search_query, 'supported')
    assert.equal(record.actions.open, 'supported')
    assert.equal(record.actions.find, 'supported')
    assert.equal(record.actions.click, 'supported')
    assert.equal(record.actions.screenshot, 'supported')
  }
})

test('real Native V2 Responses compact contract', { skip: !enabled && skipReason() }, async () => {
  const result = await requestNativeCompaction({
    baseURL,
    model,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Return a compact checkpoint for this short test.' }] }],
    promptCacheKey: `dsh-lcx-codex-e2e-${Date.now()}`,
    headers: { authorization: `Bearer ${process.env.LCX_API_KEY}` },
    signal: AbortSignal.timeout(timeoutMs),
    timeoutMs,
    maxAttempts: 1,
    maxResponseBytes: 8 * 1024 * 1024,
  })
  assert.equal(result.compaction.type, 'compaction')
  assert.ok(result.compaction.encrypted_content.length > 0)
  assert.ok(result.output.length >= 1)
})
