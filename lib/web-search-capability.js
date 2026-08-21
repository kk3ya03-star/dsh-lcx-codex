import { createHash } from 'node:crypto'
import { JsonStore } from './json-store.js'
import { normalizeBaseURL } from './route.js'
export const ALPHA_CAPABILITY_SCHEMA = 3
function empty() { return { version: 1, entries: {} } }
function validate(value) { return value?.version === 1 && value.entries && typeof value.entries === 'object' && !Array.isArray(value.entries) }
export function capabilityKey({ baseURL, provider, model, toolHash }) { return createHash('sha256').update([normalizeBaseURL(baseURL), provider ?? '', model ?? '', toolHash ?? ''].join('\u001f')).digest('hex') }
export function toolSchemaHash(parameters, outputSchema) { return createHash('sha256').update(JSON.stringify({ parameters, outputSchema })).digest('hex') }
export class CapabilityStore {
  constructor(file) { this.store = new JsonStore(file, empty, validate, 'LCX_ALPHA_CAPABILITY_STORE_CORRUPT') }
  get(route, toolHash) { this.store.refresh(); return this.store.data.entries[capabilityKey({ ...route, toolHash })] }
  set(route, toolHash, result) { this.store.update((data) => { data.entries[capabilityKey({ ...route, toolHash })] = { ...structuredClone(result), schemaVersion: ALPHA_CAPABILITY_SCHEMA, probedAt: Date.now() }; return data }) }
  supported(route, toolHash) { const entry = this.get(route, toolHash); return entry?.schemaVersion === ALPHA_CAPABILITY_SCHEMA && entry.supported === true }
}
