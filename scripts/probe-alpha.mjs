import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  ALPHA_SCHEMA_FINGERPRINT,
  buildAlphaSearchBody,
  normalizeAlphaSearchArgs,
  parseAlphaSearchResponse,
  probeAlphaCapabilities,
} from '../lib/web-search-alpha.js'
import { AlphaCapabilityStore, alphaCapabilityFingerprint } from '../lib/web-search-capability.js'
import { fetchJsonWithRetry } from '../lib/transport.js'

function required(name, value) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

function apiKey() {
  const file = String(process.env.LCX_API_KEY_FILE ?? '').trim()
  if (file) return required('LCX_API_KEY_FILE content', readFileSync(file, 'utf8'))
  return required('LCX_API_KEY or LCX_API_KEY_FILE', process.env.LCX_API_KEY)
}

const key = apiKey()
const baseURL = String(process.env.LCX_BASE_URL ?? 'https://api.lcxbot.com/v1').replace(/\/+$/u, '')
const model = required('LCX_MODEL', process.env.LCX_MODEL)
const provider = String(process.env.LCX_PROVIDER ?? 'lcx')
const profile = String(process.env.LCX_ALPHA_PROFILE ?? '')
const group = String(process.env.LCX_ALPHA_GROUP ?? '')
const sessionId = `dsh-lcx-codex-alpha-probe-${Date.now()}`
const timeoutMs = Number(process.env.LCX_E2E_TIMEOUT_MS ?? 120000)
const capabilityPath = String(process.env.LCX_ALPHA_CAPABILITY_PATH ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'lcx-codex', 'web-alpha-capabilities.json'))
const trustedNativeProvenance = process.env.LCX_ALPHA_TRUSTED_NATIVE === '1'
const clickProbeRef = String(process.env.LCX_ALPHA_CLICK_PROBE_REF ?? 'https://en.wikipedia.org/wiki/OpenAI').trim()
const screenshotProbeRef = String(process.env.LCX_ALPHA_SCREENSHOT_PROBE_REF ?? 'https://arxiv.org/pdf/1706.03762').trim()

const invoke = async (input) => {
  const args = normalizeAlphaSearchArgs(input)
  const requestId = randomUUID()
  const response = await fetchJsonWithRetry(
    `${baseURL}/alpha/search`,
    buildAlphaSearchBody(args, model, sessionId, true),
    {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'x-client-request-id': requestId,
      'session-id': sessionId,
    },
    AbortSignal.timeout(timeoutMs),
    timeoutMs,
    { maxAttempts: 1, maxResponseBytes: 4 * 1024 * 1024 },
  )
  return parseAlphaSearchResponse(response, { action: args.action, capability: 'unknown', requestId })
}

const actionProbes = process.env.LCX_ALPHA_PROBE_STRUCTURED === '1' ? {
  image_query: { query: 'OpenAI logo' },
  finance: { ticker: 'AAPL', assetType: 'equity', market: 'USA' },
  weather: { location: 'United States, California, San Francisco', duration: 1 },
  sports: { fn: 'schedule', league: 'nba', numberOfGames: 1 },
  time: { utcOffset: '+00:00' },
} : {}

const record = await probeAlphaCapabilities({
  invoke,
  schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
  trustedNativeProvenance,
  actionProbes,
  clickProbeRef,
  screenshotProbeRef,
})
const fingerprint = alphaCapabilityFingerprint({ baseURL, provider, model, profile, group, schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT })
new AlphaCapabilityStore(capabilityPath).put(fingerprint, record)

const endpoint = new URL(baseURL)
process.stdout.write(`${JSON.stringify({
  endpoint: endpoint.host,
  provider,
  model,
  profile,
  group,
  fingerprint: fingerprint.slice(0, 12),
  classification: record.classification,
  provenance: record.provenance,
  actions: record.actions,
  probedAt: record.probedAt,
  capabilityPath,
}, null, 2)}\n`)
