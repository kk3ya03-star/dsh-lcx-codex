import { readFileSync } from 'node:fs'
import { baseURLFingerprint, sessionAncestry } from './route.js'

const PATTERN = /\[dsh-lcx-codex-v3-checkpoint:([0-9a-f-]{36})\]/iu
function textOf(message) { return (message?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('') }
export function legacyV3Id(message) { return textOf(message).match(PATTERN)?.[1]?.toLowerCase() }
export function loadLegacyRecord(file, id) {
  if (!file || !id) return undefined
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const record = parsed?.version === 3 ? parsed.checkpoints?.[id] : undefined
    if (!record || record.version !== 3 || !Array.isArray(record.nativeOutput)) return undefined
    return structuredClone(record)
  } catch { return undefined }
}
export function legacyRouteCompatible(record, route, ctx) {
  if (!record || record.provider !== route.provider || record.model !== route.model) return false
  if (record.baseURLFingerprint !== baseURLFingerprint(route.baseURL)) return false
  return sessionAncestry(ctx, route.sessionId).includes(record.sourceSessionId ?? record.lineageId)
}
