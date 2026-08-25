import { symbols as cordisSymbols } from '@deepseek-ai/cordis'

export function agentSessionId(agent) { return String(agent?.session?.id ?? '') }

export function readAgentRouteState(agent) {
  return {
    requestConfig: agent?.session?.requestHeader?.()?.config,
    options: agent?.options,
    sessionId: agentSessionId(agent),
  }
}

export function sessionsService(ctx) { return ctx?.get?.('sessions') ?? ctx?.sessions }
export function sessionFor(ctx, sessionId) { return sessionId ? sessionsService(ctx)?.get?.(sessionId) : undefined }

export function readWebSearchProvider(ctx) {
  try { return Reflect.get(ctx?.web, 'searchProviderId') } catch { return undefined }
}

export function writeWebSearchProvider(ctx, providerId) {
  if (!ctx?.web) return false
  try {
    if (!Reflect.set(ctx.web, 'searchProviderId', providerId)) return false
    return Reflect.get(ctx.web, 'searchProviderId') === providerId
  } catch { return false }
}

export function contextService(ctx, name) { return ctx?.get?.(name) ?? ctx?.[name] }

export function resolveContextService(ctx, name) {
  try { return contextService(ctx, name) } catch { return undefined }
}

export function resolveScopedService(agent, name) { return resolveContextService(agent?.ctx, name) }

export function resolveAgentService(ctx, agent, name) {
  const agentPresets = resolveContextService(ctx, 'agentPresets')
  try {
    const service = agentPresets?.serviceFor?.(agent, name)
    if (service !== undefined) return service
  } catch {}
  return resolveScopedService(agent, name)
}

export function concreteService(value) {
  try { return value?.[cordisSymbols.original] ?? value } catch { return value }
}

export function compactionPatchCandidate(value, records) {
  const compaction = concreteService(value)
  if (!compaction || typeof compaction.compactIfNeeded !== 'function' || records.has(compaction)) return undefined
  return { compaction, original: compaction.compactIfNeeded }
}

export function installCompactionPatch(records, record) {
  try { record.compaction.compactIfNeeded = record.wrapper } catch { return false }
  records.set(record.compaction, record)
  return true
}

export function restoreCompactionPatches(records, entries = [...records.values()]) {
  for (const record of entries) if (record.compaction?.compactIfNeeded === record.wrapper) {
    try { record.compaction.compactIfNeeded = record.original } catch {}
  }
  records.clear()
}

export function toolResultPrunerState(value) {
  const pruner = concreteService(value)
  const original = pruner?.pruneSession
  return { pruner, original }
}

export function patchToolResultPruner(state, replacement) {
  if (!state?.pruner || typeof state.original !== 'function') return undefined
  state.pruner.pruneSession = replacement
  return { ...state, replacement }
}

export function restoreToolResultPruner(record) {
  if (record?.pruner?.pruneSession === record.replacement) {
    try { record.pruner.pruneSession = record.original } catch {}
  }
}

export function compactionConfigState(service) { return { service, original: service?.config } }

export function patchCompactionConfig(state, createConfig) {
  if (!state?.original || !state.service || !Object.prototype.hasOwnProperty.call(state.service, 'config')) return undefined
  try {
    const installed = createConfig(state.original)
    state.service.config = installed
    return { ...state, installed }
  } catch { return undefined }
}

export function restoreCompactionConfig(record) {
  if (record?.service?.config === record.installed) {
    try { record.service.config = record.original } catch {}
  }
}

export function patchVisibleWebSearchTimeout(agent, getTimeoutMs, patchedDefinitions) {
  const tools = resolveScopedService(agent, 'tools')
  const definition = tools?.get?.('web_search', agent)
  if (!definition || typeof definition !== 'object') return
  if (!patchedDefinitions.has(definition)) patchedDefinitions.set(definition, definition.timeoutMs)
  const timeoutMs = getTimeoutMs()
  const target = timeoutMs === undefined ? patchedDefinitions.get(definition) : timeoutMs
  try { definition.timeoutMs = target } catch {}
}

export function refreshVisibleWebSearchTimeouts(patchedDefinitions, timeoutMs) {
  for (const [definition, original] of patchedDefinitions.entries()) {
    try { definition.timeoutMs = timeoutMs === undefined ? original : timeoutMs } catch {}
  }
}

export function restoreVisibleWebSearchTimeouts(patchedDefinitions) {
  for (const [definition, original] of patchedDefinitions.entries()) {
    try { if (original === undefined) delete definition.timeoutMs; else definition.timeoutMs = original } catch {}
  }
  patchedDefinitions.clear()
}
