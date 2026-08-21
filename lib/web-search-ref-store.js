import { randomUUID } from 'node:crypto'
import { JsonStore } from './json-store.js'
function empty() { return { version: 1, refs: {} } }
function validate(value) { return value?.version === 1 && value.refs && typeof value.refs === 'object' && !Array.isArray(value.refs) }
export class RefStore {
  constructor(file) { this.store = new JsonStore(file, empty, validate, 'LCX_ALPHA_REF_STORE_CORRUPT') }
  put({ provider, model, baseURLFingerprint, nativeRef, kind, metadata }) { const id = `wref_${randomUUID()}`; this.store.update((data) => { data.refs[id] = { provider, model, baseURLFingerprint, nativeRef: structuredClone(nativeRef), kind, metadata: structuredClone(metadata ?? {}), createdAt: Date.now() }; return data }); return id }
  get(id) { this.store.refresh(); return this.store.data.refs[id] ? structuredClone(this.store.data.refs[id]) : undefined }
  delete(id) { this.store.update((data) => { delete data.refs[id]; return data }) }
}
