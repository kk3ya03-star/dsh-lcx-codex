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

function clampPromptCacheKey(value) {
  if (value === undefined) return undefined
  const chars = Array.from(String(value))
  return chars.length <= 64 ? String(value) : chars.slice(0, 64).join('')
}

export function promptCacheSessionId(route, config = {}) {
  if (config?.cacheRetention === 'none') return undefined
  return route?.sessionId ? String(route.sessionId) : undefined
}

export function promptCacheKey(route, config = {}) {
  return clampPromptCacheKey(promptCacheSessionId(route, config))
}

export function promptCacheRetention(config = {}) {
  return config?.cacheRetention === 'long' && config?.supportsLongCacheRetention !== false ? '24h' : undefined
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

const RESPONSES_COMPAT_FIELDS = new Set(['supportsDeveloperRole', 'supportsStrictMode', 'supportsLongCacheRetention'])

function copyResponsesCompat(target, source) {
  if (!source || typeof source !== 'object') return
  for (const field of RESPONSES_COMPAT_FIELDS) if (typeof source[field] === 'boolean') target[field] = source[field]
}

function configuredResponsesCompat(profile, modelId) {
  const compat = {}
  copyResponsesCompat(compat, profile?.compat)
  const configuredModels = Array.isArray(profile?.models) ? profile.models : []
  const modelEntry = configuredModels.length > 0
    ? configuredModels.find((entry) => String(entry?.id ?? '') === String(modelId))
    : profile?.modelOverrides?.[String(modelId)]
  copyResponsesCompat(compat, modelEntry?.compat)
  return Object.keys(compat).length > 0 ? compat : undefined
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
      api: 'openai-responses',
      baseURL: normalizeBaseURL(fallbackConfig.baseURL),
      cacheRetention: ['none', 'short', 'long'].includes(fallbackConfig.cacheRetention) ? fallbackConfig.cacheRetention : 'short',
      supportsLongCacheRetention: fallbackConfig.supportsLongCacheRetention !== false,
      responsesCompat: fallbackConfig.responsesCompat && typeof fallbackConfig.responsesCompat === 'object' ? { ...fallbackConfig.responsesCompat } : undefined,
    }
  }
  if (profile.api !== 'openai-responses') return undefined
  const baseURL = profile.baseURL ?? (provider === fallbackConfig.provider ? fallbackConfig.baseURL : undefined)
  const apiKeyEnv = profile.apiKeyEnv ?? (provider === fallbackConfig.provider ? fallbackConfig.apiKeyEnv : undefined)
  if (!baseURL || !apiKeyEnv) return undefined
  const responsesCompat = configuredResponsesCompat(profile, options.model)
  return {
    ...fallbackConfig,
    provider,
    model: String(options.model),
    api: 'openai-responses',
    baseURL: normalizeBaseURL(baseURL),
    apiKeyEnv,
    headers: profile.headers && typeof profile.headers === 'object' ? { ...profile.headers } : { ...(fallbackConfig.headers ?? {}) },
    cacheRetention: ['none', 'short', 'long'].includes(profile.cacheRetention) ? profile.cacheRetention : (['none', 'short', 'long'].includes(fallbackConfig.cacheRetention) ? fallbackConfig.cacheRetention : 'short'),
    supportsLongCacheRetention: responsesCompat?.supportsLongCacheRetention ?? fallbackConfig.supportsLongCacheRetention ?? true,
    responsesCompat,
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

function hasHeader(headers, name) { return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === name.toLowerCase()) }
function hasExplicitSessionAffinity(headers) { return ['session-id', 'session_id', 'x-session-id'].some((name) => hasHeader(headers, name)) }
function sessionAffinityFormat(config) {
  if (config?.api && config.api !== 'openai-responses') return 'none'
  const provider = String(config?.provider ?? '').toLowerCase()
  const baseURL = String(config?.baseURL ?? '').toLowerCase()
  return provider === 'openrouter' || baseURL.includes('openrouter.ai') ? 'openrouter' : 'openai'
}

export async function authenticatedHeaders(ctx, config, sessionId, requestId) {
  const explicit = { ...(config.headers ?? {}) }
  const headers = {
    ...attributionHeaders(),
    authorization: `Bearer ${await resolveApiKey(ctx, config)}`,
  }
  const sid = sessionId ? String(sessionId) : undefined
  const format = sessionAffinityFormat(config)
  if (sid && !hasExplicitSessionAffinity(explicit)) {
    if (format === 'openai') headers.session_id = sid
    else if (format === 'openrouter') headers['x-session-id'] = sid
  }
  if (requestId !== null && !hasHeader(explicit, 'x-client-request-id')) {
    const correlation = requestId ?? (sid && format === 'openai' ? sid : (!sid ? randomUUID() : undefined))
    if (correlation) headers['x-client-request-id'] = correlation
  }
  return { ...headers, ...explicit }
}

export function currentRoute(options, config) {
  return {
    provider: String(options?.provider ?? config.provider ?? ''),
    model: String(options?.model ?? config.model ?? ''),
    baseURL: normalizeBaseURL(config.baseURL),
    sessionId: String(options?.sessionId ?? ''),
  }
}

export function generationControlsFromHeader(header, route) {
  const config = header?.config
  if (!config || String(config.provider ?? '') !== String(route?.provider ?? '') || String(config.model ?? '') !== String(route?.model ?? '')) return {}
  const controls = {}
  if (config.reasoningEffort !== undefined) controls.reasoningEffort = config.reasoningEffort
  if (config.temperature !== undefined) controls.temperature = config.temperature
  if (config.maxTokens !== undefined) controls.maxTokens = config.maxTokens
  return controls
}

export function generationControlsFromSession(session, route) {
  try { return generationControlsFromHeader(session?.requestHeader?.(), route) }
  catch { return {} }
}

export function updateRequestHeaderCache(cache, session, event) {
  if (!cache?.set || !session?.id) return false
  let header
  if (event?.type === 'request/header') header = event?.data?.header
  else if (event?.type === 'compaction/start') {
    try { header = session.requestHeader?.() } catch { return false }
  }
  if (!header) return false
  cache.set(String(session.id), header)
  return true
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
  // Ancestry authorizes portable migration only. Opaque native output is
  // replayable exclusively by the session that created the checkpoint.
  return record.sourceSessionId === route.sessionId
}
