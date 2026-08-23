import { createHash } from 'node:crypto'
import { JsonStore } from './json-store.js'

const VERSION = 1
const CLASSIFICATIONS = new Set(['native', 'command-capable', 'emulated-search-only', 'unsupported', 'unknown'])
const ACTION_STATES = new Set(['supported', 'unsupported', 'unknown'])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validRecord(record) {
  return isRecord(record) && CLASSIFICATIONS.has(record.classification) &&
    isRecord(record.actions) && Object.values(record.actions).every((value) => ACTION_STATES.has(value)) &&
    typeof record.probedAt === 'string' && !Number.isNaN(Date.parse(record.probedAt)) &&
    typeof record.schemaFingerprint === 'string' && record.schemaFingerprint.length > 0 &&
    (record.provenance === undefined || ['trusted-native', 'unavailable'].includes(record.provenance)) &&
    (record.classification !== 'native' || record.provenance === 'trusted-native')
}

function validData(data) {
  return data?.version === VERSION && isRecord(data.capabilities) &&
    Object.entries(data.capabilities).every(([key, value]) => /^[a-f0-9]{64}$/u.test(key) && validRecord(value))
}

export function alphaCapabilityFingerprint(config) {
  const rawBaseURL = String(config.baseURL ?? '').replace(/\/+$/u, '')
  let baseURL = rawBaseURL
  try {
    const url = new URL(rawBaseURL)
    url.hash = ''
    baseURL = url.toString().replace(/\/+$/u, '')
  } catch {}
  const canonical = {
    baseURL,
    provider: String(config.provider ?? ''),
    model: String(config.model ?? ''),
    profile: String(config.profile ?? ''),
    group: String(config.group ?? ''),
    schemaFingerprint: String(config.schemaFingerprint ?? ''),
  }
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}

export function alphaCapabilityUsable(record) {
  return record?.classification === 'native' || record?.classification === 'command-capable'
}

export class AlphaCapabilityStore {
  constructor(file) {
    this.store = new JsonStore(
      file,
      () => ({ version: VERSION, capabilities: {} }),
      validData,
      'LCX_ALPHA_CAPABILITY_STORE_CORRUPT',
    )
  }

  get(fingerprint) {
    this.store.refresh()
    const value = this.store.data.capabilities[fingerprint]
    return value === undefined ? undefined : structuredClone(value)
  }

  put(fingerprint, record) {
    if (!/^[a-f0-9]{64}$/u.test(String(fingerprint)) || !validRecord(record)) {
      const error = new Error('Invalid Alpha capability record')
      error.code = 'LCX_ALPHA_CAPABILITY_INVALID'
      throw error
    }
    this.store.update((current) => ({
      version: VERSION,
      capabilities: { ...current.capabilities, [fingerprint]: structuredClone(record) },
    }))
  }
}
