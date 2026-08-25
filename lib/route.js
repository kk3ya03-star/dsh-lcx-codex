// @ts-check

import { createHash, randomUUID } from 'node:crypto'
import { attributionHeaders, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** @typedef {Record<string, string>} HeaderMap */
/** @typedef {Parameters<typeof resolveRetryPolicy>[0]} RetryPolicyConfig */
/** @typedef {'none' | 'short' | 'long'} CacheRetention */
/** @typedef {{ supportsDeveloperRole?: boolean, supportsStrictMode?: boolean, supportsLongCacheRetention?: boolean }} ResponsesCompat */
/** @typedef {{ provider: string, model: string, baseURL: string, sessionId: string }} RouteIdentity */
/** @typedef {{ provider?: unknown, model?: unknown, sessionId?: unknown }} RouteOptions */
/** @typedef {{ id?: unknown, compat?: unknown }} ProviderModelProfile */
/**
 * @typedef {object} ProviderProfile
 * @property {string} [api]
 * @property {string} [baseURL]
 * @property {string} [apiKeyEnv]
 * @property {HeaderMap} [headers]
 * @property {unknown} [cacheRetention]
 * @property {number} [timeoutMs]
 * @property {number} [maxRequestImageBytes]
 * @property {number} [requestImagePixelBudget]
 * @property {number} [requestImageMaxBytes]
 * @property {RetryPolicyConfig} [retryPolicy]
 * @property {unknown} [compat]
 * @property {ProviderModelProfile[]} [models]
 * @property {Record<string, ProviderModelProfile>} [modelOverrides]
 */
/** @typedef {{ providers?: Record<string, ProviderProfile> }} LlmSettingsSection */
/** @typedef {{ get?: (namespace: unknown) => LlmSettingsSection | undefined }} SettingsService */
/** @typedef {{ resolve?: (name: string) => Promise<{ value?: unknown } | undefined> }} CredentialsService */
/** @typedef {{ id: string, header?: { parentSession?: string }, requestHeader?: () => RequestHeader | undefined }} RouteSession */
/** @typedef {{ get?: (id: string) => RouteSession | undefined }} SessionsService */
/**
 * @typedef {object} RouteContext
 * @property {((name: string) => unknown)} [get]
 * @property {SettingsService} [settings]
 * @property {CredentialsService} [credentials]
 * @property {SessionsService} [sessions]
 */
/**
 * Raw fallback values are not a resolved Responses route. cacheRetention is
 * intentionally unknown until resolveResponsesRouteConfig normalizes it.
 * @typedef {object} UnresolvedRouteConfig
 * @property {string} provider
 * @property {string} model
 * @property {string} baseURL
 * @property {string} apiKeyEnv
 * @property {HeaderMap} [headers]
 * @property {unknown} [cacheRetention]
 * @property {unknown} [supportsLongCacheRetention]
 * @property {unknown} [responsesCompat]
 * @property {number} [timeoutMs]
 * @property {number} [maxAttempts]
 * @property {number} [maxRequestImageBytes]
 * @property {number} [requestImagePixelBudget]
 * @property {number} [requestImageMaxBytes]
 */
/**
 * @typedef {UnresolvedRouteConfig & {
 *   api: 'openai-responses',
 *   cacheRetention: CacheRetention,
 *   supportsLongCacheRetention: boolean,
 *   responsesCompat?: ResponsesCompat
 * }} ResolvedResponsesRoute
 */
/** @typedef {{ provider?: unknown, model?: unknown, reasoningEffort?: unknown, temperature?: unknown, maxTokens?: unknown }} RequestHeaderConfig */
/** @typedef {{ config?: RequestHeaderConfig }} RequestHeader */
/** @typedef {{ reasoningEffort?: unknown, temperature?: unknown, maxTokens?: unknown }} GenerationControls */
/** @typedef {{ version: number, provider: unknown, model: unknown, baseURLFingerprint: unknown, sourceSessionId: unknown }} CheckpointRouteRecord */
/** @typedef {Error & { code?: string }} LcxError */

/** @param {unknown} value */
export function normalizeBaseURL(value) {
  return String(value ?? '').trim().replace(/\/+$/u, '')
}

/** @param {unknown} model */
export function isGptModel(model) {
  return /(^|[^a-z])gpt(?:[^a-z]|$)/iu.test(String(model ?? ''))
}

/** @param {unknown} baseURL */
export function baseURLFingerprint(baseURL) {
  return createHash('sha256').update(normalizeBaseURL(baseURL), 'utf8').digest('hex')
}

/**
 * @param {Partial<RouteIdentity> | null | undefined} route
 * @param {{ includeSession?: boolean }} [options]
 */
export function routeFingerprint(route, options = {}) {
  const includeSession = options.includeSession !== false
  const fields = [route?.provider ?? '', route?.model ?? '', normalizeBaseURL(route?.baseURL), includeSession ? route?.sessionId ?? '' : '']
  return createHash('sha256').update(fields.join('\u001f'), 'utf8').digest('hex')
}

/** @param {unknown} value */
function clampPromptCacheKey(value) {
  if (value === undefined) return undefined
  const chars = Array.from(String(value))
  return chars.length <= 64 ? String(value) : chars.slice(0, 64).join('')
}

/**
 * @param {Partial<RouteIdentity> | null | undefined} route
 * @param {Partial<Pick<ResolvedResponsesRoute, 'cacheRetention'>>} [config]
 */
export function promptCacheSessionId(route, config = {}) {
  if (config?.cacheRetention === 'none') return undefined
  return route?.sessionId ? String(route.sessionId) : undefined
}

/**
 * @param {Partial<RouteIdentity> | null | undefined} route
 * @param {Partial<Pick<ResolvedResponsesRoute, 'cacheRetention'>>} [config]
 */
export function promptCacheKey(route, config = {}) {
  return clampPromptCacheKey(promptCacheSessionId(route, config))
}

/** @param {Partial<Pick<ResolvedResponsesRoute, 'cacheRetention' | 'supportsLongCacheRetention'>>} [config] */
export function promptCacheRetention(config = {}) {
  return config?.cacheRetention === 'long' && config?.supportsLongCacheRetention !== false ? '24h' : undefined
}

/**
 * @param {RetryPolicyConfig | null | undefined} policy
 * @param {number} [fallback]
 */
function retryAttempts(policy, fallback = 3) {
  if (!policy || typeof policy !== 'object') return fallback
  try {
    const resolved = resolveRetryPolicy(policy, 'llm-pi-ai provider retryPolicy')
    if (resolved.mode === 'normal' && Number.isSafeInteger(resolved.maxRetries)) return Math.min(resolved.maxRetries + 1, 6)
  } catch { /* keep fallback */ }
  return fallback
}

/**
 * @param {RouteContext | null | undefined} ctx
 * @param {string} namespace
 */
export function settingsValue(ctx, namespace) {
  const settings = /** @type {SettingsService | undefined} */ (ctx?.get?.('settings') ?? ctx?.settings)
  return settings?.get?.(settingsNamespace(namespace))
}

/** @type {Set<keyof ResponsesCompat>} */
const RESPONSES_COMPAT_FIELDS = new Set(['supportsDeveloperRole', 'supportsStrictMode', 'supportsLongCacheRetention'])

/**
 * @param {ResponsesCompat} target
 * @param {unknown} source
 */
function copyResponsesCompat(target, source) {
  if (!source || typeof source !== 'object') return
  for (const field of RESPONSES_COMPAT_FIELDS) if (typeof /** @type {Record<keyof ResponsesCompat, unknown>} */ (source)[field] === 'boolean') target[field] = /** @type {boolean} */ (/** @type {Record<keyof ResponsesCompat, unknown>} */ (source)[field])
}

/**
 * @param {ProviderProfile | null | undefined} profile
 * @param {unknown} modelId
 * @returns {ResponsesCompat | undefined}
 */
function configuredResponsesCompat(profile, modelId) {
  /** @type {ResponsesCompat} */
  const compat = {}
  copyResponsesCompat(compat, profile?.compat)
  const configuredModels = Array.isArray(profile?.models) ? profile.models : []
  const modelEntry = configuredModels.length > 0
    ? configuredModels.find((entry) => String(entry?.id ?? '') === String(modelId))
    : profile?.modelOverrides?.[String(modelId)]
  copyResponsesCompat(compat, modelEntry?.compat)
  return Object.keys(compat).length > 0 ? compat : undefined
}

/**
 * @param {RouteContext | null | undefined} ctx
 * @param {RouteOptions} options
 * @param {UnresolvedRouteConfig} fallbackConfig
 * @returns {ResolvedResponsesRoute | undefined}
 */
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
      cacheRetention: /** @type {CacheRetention} */ (['none', 'short', 'long'].includes(/** @type {string} */ (fallbackConfig.cacheRetention)) ? fallbackConfig.cacheRetention : 'short'),
      supportsLongCacheRetention: fallbackConfig.supportsLongCacheRetention !== false,
      responsesCompat: fallbackConfig.responsesCompat && typeof fallbackConfig.responsesCompat === 'object' ? /** @type {ResponsesCompat} */ ({ ...fallbackConfig.responsesCompat }) : undefined,
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
    cacheRetention: /** @type {CacheRetention} */ (['none', 'short', 'long'].includes(/** @type {string} */ (profile.cacheRetention)) ? profile.cacheRetention : (['none', 'short', 'long'].includes(/** @type {string} */ (fallbackConfig.cacheRetention)) ? fallbackConfig.cacheRetention : 'short')),
    supportsLongCacheRetention: responsesCompat?.supportsLongCacheRetention ?? /** @type {boolean | undefined} */ (fallbackConfig.supportsLongCacheRetention) ?? true,
    responsesCompat,
    timeoutMs: Number.isInteger(profile.timeoutMs) && /** @type {number} */ (profile.timeoutMs) > 0 ? profile.timeoutMs : fallbackConfig.timeoutMs,
    maxAttempts: retryAttempts(profile.retryPolicy, fallbackConfig.maxAttempts),
    maxRequestImageBytes: Number.isSafeInteger(profile.maxRequestImageBytes) && /** @type {number} */ (profile.maxRequestImageBytes) > 0
      ? profile.maxRequestImageBytes
      : fallbackConfig.maxRequestImageBytes,
    requestImagePixelBudget: Number.isSafeInteger(profile.requestImagePixelBudget) && /** @type {number} */ (profile.requestImagePixelBudget) > 0
      ? profile.requestImagePixelBudget
      : fallbackConfig.requestImagePixelBudget,
    requestImageMaxBytes: Number.isSafeInteger(profile.requestImageMaxBytes) && /** @type {number} */ (profile.requestImageMaxBytes) > 0
      ? profile.requestImageMaxBytes
      : fallbackConfig.requestImageMaxBytes,
  }
}

/**
 * @param {RouteContext | null | undefined} ctx
 * @param {Pick<ResolvedResponsesRoute, 'apiKeyEnv'>} config
 */
export async function resolveApiKey(ctx, config) {
  const credentials = /** @type {CredentialsService | undefined} */ (ctx?.get?.('credentials') ?? ctx?.credentials)
  if (credentials?.resolve) {
    const resolved = await credentials.resolve(config.apiKeyEnv)
    if (typeof resolved?.value === 'string' && resolved.value.trim()) return resolved.value.trim()
  }
  const ambient = String(process.env[config.apiKeyEnv] ?? '').trim()
  if (ambient) return ambient
  /** @type {LcxError} */
  const error = new Error(`DSH provider credential is unavailable: ${config.apiKeyEnv}`)
  error.code = 'LCX_CREDENTIAL_UNAVAILABLE'
  throw error
}

/**
 * @param {HeaderMap | null | undefined} headers
 * @param {string} name
 */
function hasHeader(headers, name) { return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === name.toLowerCase()) }
/** @param {HeaderMap | null | undefined} headers */
function hasExplicitSessionAffinity(headers) { return ['session-id', 'session_id', 'x-session-id'].some((name) => hasHeader(headers, name)) }
/** @param {Partial<ResolvedResponsesRoute> | null | undefined} config */
function sessionAffinityFormat(config) {
  if (config?.api && config.api !== 'openai-responses') return 'none'
  const provider = String(config?.provider ?? '').toLowerCase()
  const baseURL = String(config?.baseURL ?? '').toLowerCase()
  return provider === 'openrouter' || baseURL.includes('openrouter.ai') ? 'openrouter' : 'openai'
}

/**
 * @param {RouteContext | null | undefined} ctx
 * @param {ResolvedResponsesRoute} config
 * @param {unknown} sessionId
 * @param {string | null | undefined} requestId
 * @returns {Promise<HeaderMap>}
 */
export async function authenticatedHeaders(ctx, config, sessionId, requestId) {
  const explicit = { ...(config.headers ?? {}) }
  /** @type {HeaderMap} */
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

/**
 * @param {RouteOptions | null | undefined} options
 * @param {Pick<UnresolvedRouteConfig, 'provider' | 'model' | 'baseURL'>} config
 * @returns {RouteIdentity}
 */
export function currentRoute(options, config) {
  return {
    provider: String(options?.provider ?? config.provider ?? ''),
    model: String(options?.model ?? config.model ?? ''),
    baseURL: normalizeBaseURL(config.baseURL),
    sessionId: String(options?.sessionId ?? ''),
  }
}

/**
 * @param {RequestHeader | null | undefined} header
 * @param {Partial<RouteIdentity> | null | undefined} route
 * @returns {GenerationControls}
 */
export function generationControlsFromHeader(header, route) {
  const config = header?.config
  if (!config || String(config.provider ?? '') !== String(route?.provider ?? '') || String(config.model ?? '') !== String(route?.model ?? '')) return {}
  /** @type {GenerationControls} */
  const controls = {}
  if (config.reasoningEffort !== undefined) controls.reasoningEffort = config.reasoningEffort
  if (config.temperature !== undefined) controls.temperature = config.temperature
  if (config.maxTokens !== undefined) controls.maxTokens = config.maxTokens
  return controls
}

/**
 * @param {RouteSession | null | undefined} session
 * @param {Partial<RouteIdentity> | null | undefined} route
 * @returns {GenerationControls}
 */
export function generationControlsFromSession(session, route) {
  try { return generationControlsFromHeader(session?.requestHeader?.(), route) }
  catch { return {} }
}

/**
 * @param {{ set?: (key: string, value: RequestHeader) => unknown } | null | undefined} cache
 * @param {RouteSession | null | undefined} session
 * @param {{ type?: string, data?: { header?: RequestHeader } } | null | undefined} event
 */
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

/**
 * @param {RouteContext | null | undefined} ctx
 * @param {string | null | undefined} sessionId
 * @returns {string[]}
 */
export function sessionAncestry(ctx, sessionId) {
  if (!sessionId) return []
  const sessions = /** @type {SessionsService | undefined} */ (ctx?.get?.('sessions') ?? ctx?.sessions)
  const result = []
  /** @type {Set<string>} */
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

/**
 * @param {CheckpointRouteRecord | null | undefined} record
 * @param {RouteIdentity} route
 * @param {unknown} ctx
 */
export function routeCompatible(record, route, ctx) {
  if (!record || ![4, 5].includes(record.version)) return false
  if (record.provider !== route.provider || record.model !== route.model) return false
  if (record.baseURLFingerprint !== baseURLFingerprint(route.baseURL)) return false
  // Ancestry authorizes portable migration only. Opaque native output is
  // replayable exclusively by the session that created the checkpoint.
  return record.sourceSessionId === route.sessionId
}
