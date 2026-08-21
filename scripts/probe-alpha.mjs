import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ALPHA_SCHEMA_FINGERPRINT, buildAlphaSearchBody, normalizeAlphaSearchArgs, parseAlphaSearchResponse, probeAlphaCapabilities } from '../lib/web-search-alpha.js'
import { AlphaCapabilityStore, alphaCapabilityFingerprint } from '../lib/web-search-capability.js'

const baseURL = String(process.env.LCX_BASE_URL ?? 'https://api.lcxbot.com/v1').replace(/\/+$/u, '')
const model = String(process.env.LCX_MODEL ?? '').trim()
const provider = String(process.env.LCX_PROVIDER ?? 'lcx').trim()
const profile = String(process.env.LCX_ALPHA_PROFILE ?? '')
const group = String(process.env.LCX_ALPHA_GROUP ?? '')
const keyFile = String(process.env.LCX_API_KEY_FILE ?? '').trim()
if (!model) throw new Error('Set LCX_MODEL to the exact GPT model id')
if (!keyFile) throw new Error('Set LCX_API_KEY_FILE to a local file containing the bearer key')
const apiKey = readFileSync(keyFile, 'utf8').trim()
if (!apiKey) throw new Error('LCX_API_KEY_FILE is empty')
const storeFile = process.env.LCX_ALPHA_CAPABILITY_PATH ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'lcx-codex', 'web-alpha-capabilities.json')
const sessionId = `lcx-probe-${randomUUID()}`

async function invoke(rawArgs) {
  const args = normalizeAlphaSearchArgs(rawArgs)
  const requestId = randomUUID()
  const response = await fetch(`${baseURL}/alpha/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, 'x-client-request-id': requestId, 'session-id': sessionId },
    body: JSON.stringify(buildAlphaSearchBody(args, model, sessionId, true, 2500)),
  })
  const text = await response.text()
  let body
  try { body = text ? JSON.parse(text) : {} } catch { body = { output: text, results: [] } }
  if (!response.ok) { const e = new Error(body?.error?.message ?? body?.message ?? `HTTP ${response.status}`); e.status = response.status; throw e }
  return parseAlphaSearchResponse(body, { action: args.action, capability: 'command-capable', requestId })
}

const structured = process.env.LCX_ALPHA_PROBE_STRUCTURED === '1'
const actionProbes = structured ? {
  image_query: { query: 'OpenAI logo' }, finance: { ticker: 'MSFT', assetType: 'equity', market: 'USA' }, weather: { location: 'San Francisco, CA' }, sports: { fn: 'standings', league: 'nba' }, time: { utcOffset: '+00:00' },
} : {}
const result = await probeAlphaCapabilities({ invoke, schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT, trustedNativeProvenance: process.env.LCX_ALPHA_TRUST_NATIVE === '1', actionProbes, clickProbeRef: process.env.LCX_ALPHA_CLICK_PROBE_REF, screenshotProbeRef: process.env.LCX_ALPHA_SCREENSHOT_PROBE_REF })
const fingerprint = alphaCapabilityFingerprint({ baseURL, provider, model, profile, group, schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT })
new AlphaCapabilityStore(storeFile).put(fingerprint, result)
console.log(JSON.stringify({ fingerprint, storeFile, classification: result.classification, actions: result.actions, probedAt: result.probedAt, provenance: result.provenance }, null, 2))
