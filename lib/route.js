import { createHash, randomUUID } from 'node:crypto'
import { attributionHeaders, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

export function normalizeBaseURL(value) {
  return String(value ?? '').trim().replace(/\/+$/u, '')
}

export function isGptModel(model) {
  return /(^|[^a-z])gpt(?:[^a-z]|$)/iu.test(String(model ?? ''))
}

export function baseURLFingerprint(baseURL) {
  return createHash('sha256').update(normalizeBaseURL(baseURL), 'utf8').digest('hex')
}

export function routeFingerprint(route, options = {}) {
  const includeSession = options.includeSession !== false
  const fields = [route?.provider ?? '', route?.model ?? '', normalizeBaseURL(route?.baseURL), includeSession ? route?.sessionId ?? '' : '']
  return createHash('sha256').update(fields.join('\u001f'), 'utf8').digest('hex')
}

export function promptCacheKey(route) {
  if (!route?.sessionId) return undefined
  // Stable per conversation + exact upstream route. It deliberately does not
  // include the current checkpoint, so native compaction/replay keep one cache key.
  return `dsh-lcx:${routeFingerprint(route)}`
}

function retryAttempts(policy, fallback = 3) {
  if (!policy || typeof policy !== 'object') return fallback
  try {
    const resolved = resolveRetryPolicy(policy, 'llm-pi-ai provider retryPolicy')
    if (resolved.mode === 'normal' && Number.isSafeInteger(resolved.maxRetries)) return Math.min(resolved.maxRetries + 1, 6)
  } catch { /* keep fallback */ }
  return fallback
}

export function settingsValue(ctx, namespace) {
  const settings = ctx?.get?.('settings') ?? ctx?.settings
  return settings?.get?.(settingsNamespace(namespace))
}

export function resolveResponsesRouteConfig(ctx, options, fallbackConfig) {
  if (!isGptModel(options?.model)) return undefined
  const provider = String(options?.provider ?? '')
  const section = settingsValue(ctx, 'llm-pi-ai')
  const profile = section?.providers?.[provider]
  if (profile === undefined) {
    if (provider !== fallbackConfig.provider) return undefined
    return {
      ...fallbackConfig,
      provider,
      model: String(options.model),
      baseURL: normalizeBaseURL(fallbackConfig.baseURL),
    }
  }
  if (profile.api !== 'openai-responses') return undefined
  const baseURL = profile.baseURL ?? (provider === fallbackConfig.provider ? fallbackConfig.baseURL : undefined)
  const apiKeyEnv = profile.apiKeyEnv ?? (provider === fallbackConfig.provider ? fallbackConfig.apiKeyEnv : undefined)
  if (!baseURL || !apiKeyEnv) return undefined
  return {
    ...fallbackConfig,
    provider,
    model: String(options.model),
    baseURL: normalizeBaseURL(baseURL),
    apiKeyEnv,
    headers: profile.headers && typeof profile.headers === 'object' ? { ...profile.headers } : { ...(fallbackConfig.headers ?? {}) },
    timeoutMs: Number.isInteger(profile.timeoutMs) && profile.timeoutMs > 0 ? profile.timeoutMs : fallbackConfig.timeoutMs,
    maxAttempts: retryAttempts(profile.retryPolicy, fallbackConfig.maxAttempts),
    maxRequestImageBytes: Number.isSafeInteger(profile.maxRequestImageBytes) && profile.maxRequestImageBytes > 0
      ? profile.maxRequestImageBytes
      : fallbackConfig.maxRequestImageBytes,
    requestImagePixelBudget: Number.isSafeInteger(profile.requestImagePixelBudget) && profile.requestImagePixelBudget > 0
      ? profile.requestImagePixelBudget
      : fallbackConfig.requestImagePixelBudget,
    requestImageMaxBytes: Number.isSafeInteger(profile.requestImageMaxBytes) && profile.requestImageMaxBytes > 0
      ? profile.requestImageMaxBytes
      : fallbackConfig.requestImageMaxBytes,
  }
}

export async function resolveApiKey(ctx, config) {
  const credentials = ctx?.get?.('credentials') ?? ctx?.credentials
  if (credentials?.resolve) {
    const resolved = await credentials.resolve(config.apiKeyEnv)
    if (typeof resolved?.value === 'string' && resolved.value.trim()) return resolved.value.trim()
  }
  const ambient = String(process.env[config.apiKeyEnv] ?? '').trim()
  if (ambient) return ambient
  const error = new Error(`DSH provider credential is unavailable: ${config.apiKeyEnv}`)
  error.code = 'LCX_CREDENTIAL_UNAVAILABLE'
  throw error
}

export async function authenticatedHeaders(ctx, config, sessionId, requestId) {
  return {
    ...(config.headers ?? {}),
    ...attributionHeaders(),
    authorization: `Bearer ${await resolveApiKey(ctx, config)}`,
    'x-client-request-id': requestId ?? randomUUID(),
    ...(sessionId ? { 'session-id': String(sessionId) } : {}),
  }
}

export function currentRoute(options, config) {
  return {
    provider: String(options?.provider ?? config.provider ?? ''),
    model: String(options?.model ?? config.model ?? ''),
    baseURL: normalizeBaseURL(config.baseURL),
    sessionId: String(options?.sessionId ?? ''),
  }
}

export function sessionAncestry(ctx, sessionId) {
  if (!sessionId) return []
  const sessions = ctx?.get?.('sessions') ?? ctx?.sessions
  const result = []
  const seen = new Set()
  let current = sessions?.get?.(sessionId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    result.push(String(current.id))
    const parent = current.header?.parentSession
    if (!parent) break
    current = sessions?.get?.(parent)
  }
  return result
}

export function routeCompatible(record, route, ctx) {
  if (!record || ![4, 5].includes(record.version)) return false
  if (record.provider !== route.provider || record.model !== route.model) return false
  if (record.baseURLFingerprint !== baseURLFingerprint(route.baseURL)) return false
  const ancestry = sessionAncestry(ctx, route.sessionId)
  return ancestry.includes(record.sourceSessionId)
}
