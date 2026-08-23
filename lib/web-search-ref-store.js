import { JsonStore } from './json-store.js'

const VERSION = 1

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validHttpUrl(value) {
  if (value === undefined) return true
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function validData(data) {
  if (data?.version !== VERSION || !isRecord(data.sessions)) return false
  return Object.entries(data.sessions).every(([sessionId, session]) =>
    sessionId.length > 0 && isRecord(session) && typeof session.routeFingerprint === 'string' && session.routeFingerprint.length > 0 &&
    typeof session.updatedAt === 'string' && !Number.isNaN(Date.parse(session.updatedAt)) && isRecord(session.refs) &&
    Object.entries(session.refs).every(([refId, ref]) => refId.length > 0 && isRecord(ref) && ref.refId === refId && validHttpUrl(ref.url)))
}

function unavailable(refId) {
  const error = new Error(`Alpha reference is unavailable in this session and route: ${String(refId)}`)
  error.code = 'LCX_ALPHA_REF_UNAVAILABLE'
  return error
}

export class AlphaRefStore {
  constructor(file) {
    this.store = new JsonStore(
      file,
      () => ({ version: VERSION, sessions: {} }),
      validData,
      'LCX_ALPHA_REF_STORE_CORRUPT',
    )
  }

  record(sessionId, routeFingerprint, refs) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof routeFingerprint !== 'string' || routeFingerprint.length === 0 || !Array.isArray(refs)) {
      throw unavailable('invalid-record')
    }
    this.store.update((current) => {
      const previous = current.sessions[sessionId]
      const previousRefs = previous?.routeFingerprint === routeFingerprint ? previous.refs : {}
      const nextRefs = { ...previousRefs }
      for (const value of refs) {
        if (!isRecord(value) || typeof value.refId !== 'string' || value.refId.length === 0 || !validHttpUrl(value.url)) continue
        nextRefs[value.refId] = { refId: value.refId, ...(value.url ? { url: value.url } : {}) }
      }
      const sessions = {
        ...current.sessions,
        [sessionId]: { routeFingerprint, refs: nextRefs, updatedAt: new Date().toISOString() },
      }
      const ordered = Object.entries(sessions).sort((left, right) => Date.parse(right[1].updatedAt) - Date.parse(left[1].updatedAt)).slice(0, 256)
      return { version: VERSION, sessions: Object.fromEntries(ordered) }
    })
  }

  assertUsable(sessionId, routeFingerprint, refId) {
    this.store.refresh()
    const session = this.store.data.sessions[sessionId]
    const ref = session?.routeFingerprint === routeFingerprint ? session.refs?.[refId] : undefined
    if (!ref) throw unavailable(refId)
    return structuredClone(ref)
  }
}
