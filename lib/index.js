import z from '@deepseek-ai/schemastery'
import { attributionHeaders, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { clampOpenAIPromptCacheKey } from '@earendil-works/pi-ai/api/openai-prompt-cache'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CheckpointV3Store, CHECKPOINT_V3_VERSION } from './checkpoint-store-v3.js'
import {
  baseURLFingerprint,
  buildNativeReplacementHistory,
  buildPortableHistory,
  assertCheckpointRoute,
  buildPortableResponsesInput,
  buildPortableResponsesInputWithImages,
  hasPortableCheckpoint,
  hydrateNativeImageReferences,
  inputImageCount,
  checkpointNativeReplacementHistory,
  latestPortableMarker,
  normalizeCompactionResponse,
  persistNativeImageReferences,
  routeFingerprint,
  textOfMessage,
} from './compact.js'
import { DEFAULT_MAX_REQUEST_IMAGE_BYTES, resolveModelImageSupport } from './dsh-pi-responses.js'
import { abortIfNeeded, fetchJsonWithRetry, fetchSse } from './transport.js'
import { mergeFeatureHeader, requestNativeCompaction, responsesTools } from './compact-v2.js'
import {
  HOSTED_SEARCH_OUTPUT,
  HOSTED_SEARCH_PARAMETERS,
  buildHostedSearchBody,
  normalizeHostedSearchArgs,
  parseHostedSearchResponse,
  renderHostedSearchResult,
} from './web-search-hosted.js'
import {
  ALPHA_SCHEMA_FINGERPRINT,
  ALPHA_SEARCH_OUTPUT,
  ALPHA_SEARCH_PARAMETERS,
  buildAlphaSearchBody,
  normalizeAlphaSearchArgs,
  parseAlphaSearchResponse,
  renderAlphaSearchResult,
} from './web-search-alpha.js'
import { AlphaCapabilityStore, alphaCapabilityFingerprint, alphaCapabilityUsable } from './web-search-capability.js'
import { AlphaRefStore } from './web-search-ref-store.js'
import { createSessionGenerationTracker } from './session-lease.js'

const name = 'lcx-codex'
const inject = ['llm', 'web', 'credentials', 'settings', 'tools']
const WEB_SEARCH_TOOL_NAME = 'websearch_gpt'
const ALPHA_SEARCH_TOOL_NAME = 'websearch_alpha'
const COMPACTION_DIRECTIVE = 'You are now acting as a compaction engine'
const SETTINGS_NAMESPACE = 'lcx-codex'
const checkpointReplayOptions = new WeakSet()
const PORTABLE_REPLAY_TEXT_MAX_CHARS = 32_000
const PORTABLE_REPLAY_TOTAL_MAX_CHARS = 80_000
const PORTABLE_REPLAY_TOTAL_MAX_BYTES = 2 * 1024 * 1024
const V3_CHECKPOINT_MARKER_PATTERN = /\[dsh-lcx-codex-v3-checkpoint:[0-9a-f-]{36}\]/giu
const CHECKPOINT_REPLAY_UNAVAILABLE_CODE = 'LCX_CHECKPOINT_REPLAY_UNAVAILABLE'
const UNSUPPORTED_IMAGE_PLACEHOLDER = '[image omitted because the target model does not support image input]'

const Config = z.object({
  provider: z.string().default('lcx'),
  baseURL: z.string().default('https://api.lcxbot.com/v1'),
  apiKeyEnv: z.string().default('LCX_API_KEY'),
  model: z.string().default('gpt-5.6-sol'),
  compactTransport: z.string().default('native-v2'),
  checkpointPath: z.string().default(''),
  alphaCapabilityPath: z.string().default(''),
  alphaRefPath: z.string().default(''),
  alphaProfile: z.string().default(''),
  alphaGroup: z.string().default(''),
  alphaMaxOutputTokens: z.number().default(2500),
  webSearchProvider: z.string().default('lcx-responses'),
  webMaxResults: z.number().default(8),
  timeoutMs: z.number().default(300000),
  maxResponseBytes: z.number().default(4 * 1024 * 1024),
  maxAttempts: z.number().default(3),
  maxRequestImageBytes: z.number().default(DEFAULT_MAX_REQUEST_IMAGE_BYTES),
})

const SettingsSchema = z.object({
  enabled: z.boolean().default(false),
  webSearch: z.boolean().default(false),
  alphaSearch: z.boolean().default(false),
  remoteCompaction: z.boolean().default(false),
  fallbackToBasicCompaction: z.boolean().default(true),
  provider: z.string().default('lcx'),
  baseURL: z.string().default('https://api.lcxbot.com/v1'),
  apiKeyEnv: z.string().default('LCX_API_KEY'),
  model: z.string().default('gpt-5.6-sol'),
  compactTransport: z.string().default('native-v2'),
})

function webError(message, code, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause })
  error.name = 'WebError'
  error.code = code
  return error
}

function defaultCheckpointPath() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'lcx-codex', 'checkpoints-v3.json')
}

function defaultAlphaCapabilityPath() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'lcx-codex', 'web-alpha-capabilities.json')
}

function defaultAlphaRefPath() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'lcx-codex', 'web-alpha-refs.json')
}

function portableCheckpointPath(checkpointPath) {
  const value = String(checkpointPath)
  if (/-v3\.json$/iu.test(value)) return value
  return /\.json$/iu.test(value) ? value.replace(/\.json$/iu, '-v3.json') : `${value}-v3.json`
}

const COMPACT_TRANSPORT_UNSUPPORTED_CODE = 'LCX_COMPACT_TRANSPORT_UNSUPPORTED'
const COMPACT_TRANSPORT_INVALID_CODE = 'LCX_COMPACT_TRANSPORT_INVALID'

function normalizeCompactTransport(value) {
  const normalized = String(value ?? 'native-v2').trim().toLowerCase()
  if (normalized === 'legacy') {
    const error = new Error('Legacy compact transport is unsupported; only native-v2 is available')
    error.code = COMPACT_TRANSPORT_UNSUPPORTED_CODE
    throw error
  }
  if (normalized !== 'native-v2') {
    const error = new Error(`Unsupported compact transport: ${String(value)}`)
    error.code = COMPACT_TRANSPORT_INVALID_CODE
    throw error
  }
  return normalized
}

function normalizeConfig(input = {}) {
  const cacheRetention = ['none', 'short', 'long'].includes(input.cacheRetention) ? input.cacheRetention : 'short'
  return {
    provider: input.provider || 'lcx',
    baseURL: String(input.baseURL || 'https://api.lcxbot.com/v1').replace(/\/+$/u, ''),
    apiKeyEnv: input.apiKeyEnv || 'LCX_API_KEY',
    model: input.model || 'gpt-5.6-sol',
    compactTransport: normalizeCompactTransport(input.compactTransport),
    headers: input.headers && typeof input.headers === 'object' ? { ...input.headers } : {},
    cacheRetention,
    supportsLongCacheRetention: input.supportsLongCacheRetention !== false,
    checkpointPath: input.checkpointPath || defaultCheckpointPath(),
    portableCheckpointPath: input.portableCheckpointPath || portableCheckpointPath(input.checkpointPath || defaultCheckpointPath()),
    alphaCapabilityPath: input.alphaCapabilityPath || defaultAlphaCapabilityPath(),
    alphaRefPath: input.alphaRefPath || defaultAlphaRefPath(),
    alphaProfile: String(input.alphaProfile ?? ''),
    alphaGroup: String(input.alphaGroup ?? ''),
    alphaMaxOutputTokens: Number.isInteger(input.alphaMaxOutputTokens) && input.alphaMaxOutputTokens > 0 ? Math.min(input.alphaMaxOutputTokens, 32_000) : 2500,
    webSearchProvider: input.webSearchProvider || 'lcx-responses',
    webMaxResults: Number.isInteger(input.webMaxResults) && input.webMaxResults > 0 ? input.webMaxResults : 8,
    timeoutMs: Number.isInteger(input.timeoutMs) && input.timeoutMs > 0 ? input.timeoutMs : 300000,
    maxResponseBytes: Number.isInteger(input.maxResponseBytes) && input.maxResponseBytes > 0 ? input.maxResponseBytes : 4 * 1024 * 1024,
    maxAttempts: Number.isInteger(input.maxAttempts) && input.maxAttempts > 0 ? Math.min(input.maxAttempts, 6) : 3,
    maxRequestImageBytes: Number.isSafeInteger(input.maxRequestImageBytes) && input.maxRequestImageBytes > 0 ? input.maxRequestImageBytes : DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  }
}

function isGptModel(model) {
  return /(^|[^a-z])gpt(?:[^a-z]|$)/iu.test(String(model ?? ''))
}

function settingsValue(ctx, namespace) {
  const settings = ctx?.get?.('settings') ?? ctx?.settings
  return settings?.get?.(settingsNamespace(namespace))
}

function resolveResponsesRouteConfig(ctx, options, fallbackConfig) {
  if (!isGptModel(options.model)) return undefined
  const provider = String(options.provider ?? '')
  const section = settingsValue(ctx, 'llm-pi-ai')
  const profile = section?.providers?.[provider]
  if (profile === undefined) {
    if (provider !== fallbackConfig.provider) return undefined
    return normalizeConfig({ ...fallbackConfig, provider, model: options.model })
  }
  if (profile.api !== 'openai-responses') return undefined
  const baseURL = profile.baseURL ?? (provider === fallbackConfig.provider ? fallbackConfig.baseURL : undefined)
  const apiKeyEnv = profile.apiKeyEnv ?? (provider === fallbackConfig.provider ? fallbackConfig.apiKeyEnv : undefined)
  if (!baseURL || !apiKeyEnv) return undefined
  return normalizeConfig({
    ...fallbackConfig,
    provider,
    baseURL,
    apiKeyEnv,
    headers: profile.headers ?? fallbackConfig.headers,
    cacheRetention: profile.cacheRetention ?? fallbackConfig.cacheRetention,
    supportsLongCacheRetention: profile.compat?.supportsLongCacheRetention ?? fallbackConfig.supportsLongCacheRetention,
    model: options.model,
    compactTransport: profile.compactTransport ?? fallbackConfig.compactTransport,
    timeoutMs: profile.timeoutMs ?? fallbackConfig.timeoutMs,
    maxRequestImageBytes: profile.maxRequestImageBytes ?? fallbackConfig.maxRequestImageBytes,
    maxAttempts: retryAttempts(profile.retryPolicy, fallbackConfig.maxAttempts),
  })
}

function retryAttempts(policy, fallback) {
  if (!policy || typeof policy !== 'object') return fallback
  try {
    const resolved = resolveRetryPolicy(policy, 'llm-pi-ai provider retryPolicy')
    if (resolved.mode === 'normal' && Number.isSafeInteger(resolved.maxRetries)) return Math.min(resolved.maxRetries + 1, 6)
  } catch {
    return fallback
  }
  return fallback
}

function nativeRouteError(options) {
  const error = new Error(`【GPT 专属原生远程压缩】当前路由不满足 GPT + openai-responses 条件：${String(options.provider)}/${String(options.model)}`)
  error.code = 'LCX_CHECKPOINT_ROUTE_MISMATCH'
  return error
}

function ambientApiKey(config) {
  const key = String(process.env[config.apiKeyEnv] ?? '').trim()
  if (!key) throw new Error(`DSH provider credential is unavailable: ${config.apiKeyEnv}`)
  return key
}

async function resolveApiKey(ctx, config) {
  const credentials = ctx?.get?.('credentials') ?? ctx?.credentials
  if (credentials?.resolve) {
    const resolved = await credentials.resolve(config.apiKeyEnv)
    if (typeof resolved?.value === 'string' && resolved.value.length > 0) return resolved.value
  }
  return ambientApiKey(config)
}

function attachmentImageResolver(ctx) {
  const attachments = ctx?.get?.('attachments') ?? ctx?.attachments
  return async (block, signal) => {
    if (!attachments?.readImage) {
      const error = new Error('LCX Compact image input requires the DSH attachment service')
      error.code = 'LCX_COMPACT_IMAGE_UNAVAILABLE'
      throw error
    }
    try {
      const stored = await attachments.readImage(block?.attachment, signal)
      return { data: stored?.data, mediaType: stored?.ref?.mediaType ?? block?.attachment?.mediaType }
    } catch (error) {
      const wrapped = new Error('LCX Compact failed to read image attachment', { cause: error })
      wrapped.code = 'LCX_COMPACT_IMAGE_UNAVAILABLE'
      throw wrapped
    }
  }
}

function usageFrom(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined
  seen.add(value)
  if (Number.isFinite(value.input_tokens) || Number.isFinite(value.output_tokens)) {
    const totalInputTokens = Number(value.input_tokens ?? 0)
    const outputTokens = Number(value.output_tokens ?? 0)
    const cachedValue = Number(value.input_tokens_details?.cached_tokens ?? value.input_token_details?.cached_tokens ?? value.prompt_tokens_details?.cached_tokens ?? 0)
    const cacheWriteValue = Number(value.input_tokens_details?.cache_write_tokens ?? value.input_token_details?.cache_write_tokens ?? value.prompt_tokens_details?.cache_write_tokens ?? 0)
    const cacheReadTokens = Number.isFinite(cachedValue) && cachedValue > 0 ? cachedValue : 0
    const cacheWriteTokens = Number.isFinite(cacheWriteValue) && cacheWriteValue > 0 ? cacheWriteValue : 0
    const inputTokens = Number.isFinite(totalInputTokens)
      ? Math.max(0, totalInputTokens - cacheReadTokens - cacheWriteTokens)
      : 0
    const normalizedOutputTokens = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0
    const reasoningValue = Number(value.output_token_details?.reasoning_tokens ?? 0)
    if (inputTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0 && normalizedOutputTokens <= 0) return undefined
    const usage = { inputTokens, outputTokens: normalizedOutputTokens }
    if (cacheReadTokens > 0) usage.cacheReadTokens = cacheReadTokens
    if (cacheWriteTokens > 0) usage.cacheWriteTokens = cacheWriteTokens
    if (Number.isFinite(reasoningValue) && reasoningValue > 0) usage.reasoningTokens = reasoningValue
    return usage
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = usageFrom(item, seen)
      if (found) return found
    }
  } else {
    for (const item of Object.values(value)) {
      const found = usageFrom(item, seen)
      if (found) return found
    }
  }
  return undefined
}

function responseTextParts(item) {
  return (Array.isArray(item?.content) ? item.content : [])
    .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
}

function responseReasoningText(item) {
  const textOf = (parts) => (Array.isArray(parts) ? parts : [])
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text)
    .filter((text) => text.length > 0)
    .join('\n\n')
  return textOf(item?.summary) || textOf(item?.content)
}

async function authenticatedHeaders(ctx, config, sessionId, clientRequestId) {
  return {
    ...config.headers,
    ...attributionHeaders(),
    authorization: `Bearer ${await resolveApiKey(ctx, config)}`,
    ...(clientRequestId === null ? {} : { 'x-client-request-id': clientRequestId ?? (sessionId ? String(sessionId) : randomUUID()) }),
    ...(sessionId ? { 'session-id': String(sessionId) } : {}),
  }
}

const REMOTE_COMPACTION_ERROR_CODES = new Set([
  'LCX_HTTP_RETRYABLE',
  'LCX_TIMEOUT',
  'LCX_RETRY_EXHAUSTED',
])
const TRANSIENT_NETWORK_ERROR_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'])

function hasRemoteCompactionErrorCode(error) {
  const seen = new Set()
  let current = error
  while (current && !seen.has(current)) {
    seen.add(current)
    const statusRetryable = Number.isInteger(current.status) && (current.status === 429 || (current.status >= 500 && current.status <= 599))
    if (current instanceof TypeError || current.name === 'TypeError' || statusRetryable || current.retryable === true || REMOTE_COMPACTION_ERROR_CODES.has(current.code) || TRANSIENT_NETWORK_ERROR_CODES.has(current.code)) return true
    current = current.cause
  }
  return false
}

function markRemoteCompactionRequestError(error) {
  const failure = error instanceof Error ? error : new Error(String(error))
  failure.remoteCompactionRequest = hasRemoteCompactionErrorCode(failure)
  return failure
}

function currentRoute(options, config) {
  return {
    provider: String(options.provider ?? config.provider ?? ''),
    model: String(options.model ?? config.model ?? ''),
    baseURL: config.baseURL,
    sessionId: options.sessionId ? String(options.sessionId) : '',
  }
}

function sessionAncestry(ctx, sessionId) {
  const id = typeof sessionId === 'string' ? sessionId : ''
  const sessions = ctx?.get?.('sessions') ?? ctx?.sessions
  if (!id || !sessions?.get) return []
  const ancestors = []
  const seen = new Set([id])
  let current = sessions.get(id)
  while (current && ancestors.length < 32) {
    const parent = current.header?.parentSession
    if (typeof parent !== 'string' || parent.length === 0 || seen.has(parent)) break
    ancestors.push(parent)
    seen.add(parent)
    current = sessions.get(parent)
  }
  return ancestors
}

function routeWithSessionAncestry(ctx, route) {
  return { ...route, ancestorSessionIds: sessionAncestry(ctx, route.sessionId) }
}

function promptCacheSessionId(route, config) {
  if (config?.cacheRetention === 'none') return undefined
  return route?.sessionId ? String(route.sessionId) : undefined
}

function promptCacheKey(route, config) {
  const sessionId = promptCacheSessionId(route, config)
  return sessionId ? clampOpenAIPromptCacheKey(sessionId) : undefined
}

function promptCacheRetention(config) {
  return config?.cacheRetention === 'long' && config.supportsLongCacheRetention !== false ? '24h' : undefined
}

function promptCacheHeaders(ctx, config, route) {
  const sessionId = promptCacheSessionId(route, config)
  return authenticatedHeaders(ctx, config, sessionId, sessionId === undefined ? null : undefined)
}

async function requestRemoteCompaction(options, input, config, signal, ctx, route, preflightHeaders) {
  try {
    const headers = preflightHeaders ?? await promptCacheHeaders(ctx, config, route)
    return await requestNativeCompaction({
      baseURL: config.baseURL,
      model: options.model,
      input,
      instructions: options.system,
      promptCacheKey: promptCacheKey(route, config),
      promptCacheRetention: promptCacheRetention(config),
      idempotencyKey: randomUUID(),
      tools: options.tools,
      headers,
      signal,
      timeoutMs: config.timeoutMs,
      maxAttempts: config.maxAttempts,
      maxResponseBytes: config.maxResponseBytes,
    })
  } catch (error) {
    throw markRemoteCompactionRequestError(error)
  }
}

function portableSummaryText(model, usage) {
  const input = Number.isFinite(usage?.inputTokens) ? usage.inputTokens : undefined
  const output = Number.isFinite(usage?.outputTokens) ? usage.outputTokens : undefined
  const usageText = input === undefined || output === undefined ? 'usage：未知' : `usage：${input}/${output} tokens`
  return `LCX 压缩完成 · Native V2 · v3 已保存 · 模型：${String(model)} · ${usageText}`
}

function checkpointReplaySource(checkpointId) {
  return {
    kind: 'plugin',
    plugin: 'dsh-lcx-codex',
    purpose: 'checkpoint-recall',
    ...(checkpointId ? { checkpointId } : {}),
  }
}

function stripCheckpointMarker(text) {
  return String(text).replace(V3_CHECKPOINT_MARKER_PATTERN, '').trim()
}

function replayBudget() {
  return {
    chars: PORTABLE_REPLAY_TOTAL_MAX_CHARS,
    bytes: PORTABLE_REPLAY_TOTAL_MAX_BYTES,
  }
}

function boundedReplayText(value, budget) {
  if (typeof value !== 'string') return undefined
  const normalized = stripCheckpointMarker(value)
  if (!normalized || budget.chars <= 0 || budget.bytes <= 0) return undefined
  let text = normalized.slice(0, Math.min(PORTABLE_REPLAY_TEXT_MAX_CHARS, budget.chars))
  while (text.length > 0 && Buffer.byteLength(text, 'utf8') > budget.bytes) text = text.slice(0, -1)
  if (!text) return undefined
  budget.chars -= text.length
  budget.bytes -= Buffer.byteLength(text, 'utf8')
  return text
}

function exactReplayText(value, budget) {
  if (typeof value !== 'string' || value.length === 0 || value.length > PORTABLE_REPLAY_TEXT_MAX_CHARS) return undefined
  const byteLength = Buffer.byteLength(value, 'utf8')
  if (value.length > budget.chars || byteLength > budget.bytes) return undefined
  budget.chars -= value.length
  budget.bytes -= byteLength
  return value
}

function isPortableReplayItem(item) {
  return item !== null && typeof item === 'object' && !Array.isArray(item) &&
    typeof item.type === 'string' && !item.type.startsWith('response.') &&
    item.type !== 'compaction' && item.type !== 'context_compaction' && item.type !== 'compaction_trigger' &&
    !Object.prototype.hasOwnProperty.call(item, 'encrypted_content')
}

function portableReplayUnsupportedContentError(type) {
  const error = new Error(`LCX checkpoint portable replay cannot represent Responses item type: ${String(type)}`)
  error.code = 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT'
  return error
}

function safePortableCall(item) {
  if (!isPortableReplayItem(item) || item.type !== 'function_call') return undefined
  if (typeof item.call_id !== 'string' || item.call_id.length === 0 || item.call_id.length > 256) return undefined
  if (typeof item.name !== 'string' || item.name.trim().length === 0 || item.name.length > 256) return undefined
  if (typeof item.arguments !== 'string' || item.arguments.length === 0 || item.arguments.length > PORTABLE_REPLAY_TEXT_MAX_CHARS) return undefined
  try {
    JSON.parse(item.arguments)
  } catch {
    return undefined
  }
  return { callId: item.call_id, name: item.name, arguments: item.arguments }
}

function safePortableOutput(item) {
  if (!isPortableReplayItem(item) || item.type !== 'function_call_output') return undefined
  if (typeof item.call_id !== 'string' || item.call_id.length === 0 || item.call_id.length > 256) return undefined
  let outputParts
  if (typeof item.output === 'string') {
    outputParts = [{ type: 'input_text', text: item.output }]
  } else if (Array.isArray(item.output)) {
    for (const part of item.output) {
      if (part === null || typeof part !== 'object' || Array.isArray(part) ||
        (part.type !== 'dsh_image_attachment' &&
          ((part.type !== 'input_text' && part.type !== 'output_text') || typeof part.text !== 'string'))) {
        throw portableReplayUnsupportedContentError(part?.type)
      }
    }
    outputParts = item.output
  } else {
    return undefined
  }
  const textLength = outputParts.reduce((sum, part) => sum + (typeof part.text === 'string' ? part.text.length : 0), 0)
  if (textLength > PORTABLE_REPLAY_TEXT_MAX_CHARS) return undefined
  return { callId: item.call_id, outputParts }
}

function portableImageCapabilityError() {
  const error = new Error('LCX Compact cannot determine whether the target model accepts checkpoint images')
  error.code = 'LCX_COMPACT_IMAGE_CAPABILITY_UNKNOWN'
  return error
}

function portableImageBlock(part, imageSupport) {
  if (!part?.attachment || typeof part.attachment !== 'object' || Array.isArray(part.attachment)) {
    throw portableReplayUnsupportedContentError('image')
  }
  if (imageSupport === 'unknown') throw portableImageCapabilityError()
  return imageSupport === 'supported'
    ? { type: 'image', attachment: structuredClone(part.attachment) }
    : { type: 'text', text: UNSUPPORTED_IMAGE_PLACEHOLDER }
}

function dshBlocksContainImage(blocks) {
  return (blocks ?? []).some((block) => block?.type === 'image' ||
    (block?.type === 'tool-result' && dshBlocksContainImage(block.content)))
}

function dshMessagesContainImage(messages) {
  return (messages ?? []).some((message) => dshBlocksContainImage(message?.content))
}

function portableContentBlocks(parts, expectedTypes, budget, imageSupport) {
  const content = []
  let pendingText = ''
  const flushText = () => {
    if (!pendingText) return
    const text = boundedReplayText(pendingText, budget)
    if (text !== undefined) content.push({ type: 'text', text })
    pendingText = ''
  }
  for (const part of parts ?? []) {
    if (expectedTypes.has(part?.type) && typeof part.text === 'string') {
      pendingText += part.text
      continue
    }
    if (part?.type === 'dsh_image_attachment' && part.attachment) {
      flushText()
      content.push(portableImageBlock(part, imageSupport))
      continue
    }
    throw portableReplayUnsupportedContentError(part?.type)
  }
  flushText()
  return content
}

function portableTextMessage(item, budget, checkpointId, imageSupport) {
  if (!isPortableReplayItem(item) || item.type !== 'message' || (item.role !== 'user' && item.role !== 'assistant')) return undefined
  const expectedType = item.role === 'assistant' ? 'output_text' : 'input_text'
  const parts = Array.isArray(item.content) ? item.content : []
  const content = portableContentBlocks(parts, new Set([expectedType]), budget, imageSupport)
  if (content.length === 0) return undefined
  return {
    id: randomUUID(),
    role: item.role,
    content,
    source: checkpointReplaySource(checkpointId),
  }
}

function cloneReplayBlock(block, imageSupport) {
  const supported = new Set(['text', 'tool-call', 'tool-result', 'reasoning', 'image'])
  if (!supported.has(block?.type)) throw portableReplayUnsupportedContentError(block?.type)
  if (block.type === 'reasoning') return undefined
  if (block.type === 'image') return portableImageBlock({ attachment: block.attachment }, imageSupport)
  if (block.type === 'tool-result') {
    return {
      ...structuredClone(block),
      content: (block.content ?? []).map((part) => cloneReplayBlock(part, imageSupport)).filter(Boolean),
    }
  }
  return structuredClone(block)
}

function cloneReplayTail(messages, imageSupport = 'unknown') {
  const projected = []
  for (const message of messages ?? []) {
    if (message === null || typeof message !== 'object' || Array.isArray(message) ||
      typeof message.role !== 'string' || !Array.isArray(message.content)) continue
    const content = []
    for (const block of message.content) {
      const cloned = cloneReplayBlock(block, imageSupport)
      if (cloned) content.push(cloned)
    }
    if (content.length === 0) continue
    projected.push({ ...structuredClone(message), content })
  }
  return projected
}

function portableResponsesToMessages(input, options = {}) {
  const budget = options.budget ?? replayBudget()
  const checkpointId = options.checkpointId
  const imageSupport = options.imageSupport ?? 'unknown'
  const items = Array.isArray(input) ? input : []
  for (const item of items) {
    if (!isPortableReplayItem(item)) continue
    if (item.type === 'message') {
      const expectedType = item.role === 'assistant' ? 'output_text' : item.role === 'user' ? 'input_text' : undefined
      if (!expectedType || !Array.isArray(item.content) || item.content.some((part) =>
        part?.type !== expectedType && part?.type !== 'dsh_image_attachment')) {
        throw portableReplayUnsupportedContentError(item.type)
      }
    } else if (item.type !== 'function_call' && item.type !== 'function_call_output') {
      throw portableReplayUnsupportedContentError(item.type)
    }
  }
  const calls = new Map()
  const outputs = new Map()
  for (let index = 0; index < items.length; index += 1) {
    const call = safePortableCall(items[index])
    const output = safePortableOutput(items[index])
    if (call) calls.set(call.callId, [...(calls.get(call.callId) ?? []), { ...call, index }])
    if (output) outputs.set(output.callId, [...(outputs.get(output.callId) ?? []), { ...output, index }])
  }
  const pairs = new Map()
  for (const [callId, callItems] of calls) {
    const outputItems = outputs.get(callId)
    if (callItems.length === 1 && outputItems?.length === 1 && callItems[0].index < outputItems[0].index) {
      pairs.set(callId, { call: callItems[0], output: outputItems[0] })
    }
  }

  const messages = []
  const reservedPairs = new Map()
  for (const item of items) {
    const textMessage = portableTextMessage(item, budget, checkpointId, imageSupport)
    if (textMessage) {
      messages.push(textMessage)
      continue
    }
    const call = safePortableCall(item)
    const pair = call ? pairs.get(call.callId) : undefined
    if (pair) {
      const before = { ...budget }
      const argumentsText = exactReplayText(pair.call.arguments, budget)
      let outputContent = portableContentBlocks(
        pair.output.outputParts,
        new Set(['input_text', 'output_text']),
        budget,
        imageSupport,
      )
      if (outputContent.length === 0) {
        const emptyOutput = exactReplayText('(no output)', budget)
        outputContent = emptyOutput ? [{ type: 'text', text: emptyOutput }] : []
      }
      if (!argumentsText || outputContent.length === 0) {
        budget.chars = before.chars
        budget.bytes = before.bytes
        continue
      }
      reservedPairs.set(call.callId, outputContent)
      messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: [{ type: 'tool-call', id: call.callId, name: call.name, arguments: argumentsText }],
        source: checkpointReplaySource(checkpointId),
      })
      continue
    }
    const output = safePortableOutput(item)
    const outputContent = output ? reservedPairs.get(output.callId) : undefined
    if (output && outputContent !== undefined) {
      messages.push({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'tool-result', toolCallId: output.callId, content: outputContent }],
        source: checkpointReplaySource(checkpointId),
      })
      reservedPairs.delete(output.callId)
    }
  }
  return messages
}

function portableReplayRouteError(record, route) {
  const dimensions = []
  if (record.provider !== String(route.provider ?? '')) dimensions.push('provider')
  if (record.baseURLFingerprint !== baseURLFingerprint(route.baseURL)) dimensions.push('endpoint')
  const sessionId = String(route.sessionId ?? '')
  const sameSessionLineage = !sessionId || record.lineageId === sessionId ||
    (Array.isArray(route.ancestorSessionIds) && route.ancestorSessionIds.includes(record.lineageId))
  if (!sameSessionLineage) dimensions.push('session')
  const error = new Error(`LCX v3 checkpoint cannot migrate; route mismatch dimensions: ${(dimensions.length > 0 ? dimensions : ['route']).join(', ')}`)
  error.code = 'LCX_CHECKPOINT_ROUTE_MISMATCH'
  return error
}

function buildPortableReplayMessages(messages, store, route, options = {}) {
  const marker = latestPortableMarker(messages)
  if (!marker) return cloneReplayTail(messages)
  const record = store?.get?.(marker.id)
  if (!record) {
    const error = new Error(`LCX v3 checkpoint ${marker.id} is missing from ${store?.file ?? 'checkpoint store'}`)
    error.code = 'LCX_CHECKPOINT_V3_CORRUPT'
    throw error
  }
  const exactRoute = Boolean(route.sessionId) && record.routeFingerprint === routeFingerprint(route)
  const sessionId = String(route.sessionId ?? '')
  const sameSessionLineage = !sessionId || record.lineageId === sessionId ||
    (Array.isArray(route.ancestorSessionIds) && route.ancestorSessionIds.includes(record.lineageId))
  const portableRoute = record.provider === String(route.provider ?? '') &&
    record.baseURLFingerprint === baseURLFingerprint(route.baseURL) &&
    sameSessionLineage
  if (!exactRoute && !portableRoute) throw portableReplayRouteError(record, route)
  const portableImages = Number(record.portableImageCount ?? 0)
  const durableImages = inputImageCount(record.portableHistory)
  if (portableImages > durableImages) {
    throw portableReplayUnsupportedContentError('image')
  }
  const imageSupport = options.imageSupport ?? 'unknown'
  const budget = replayBudget()
  const summary = boundedReplayText(record.portableSummary, budget)
  const recalled = []
  if (summary) recalled.push({
    id: randomUUID(),
    role: 'assistant',
    content: [{ type: 'text', text: summary }],
    source: checkpointReplaySource(marker.id),
  })
  recalled.push(...portableResponsesToMessages(record.portableHistory, { budget, checkpointId: marker.id, imageSupport }))
  recalled.push(...cloneReplayTail((messages ?? []).slice(marker.index + 1), imageSupport))
  return recalled
}

function checkpointReplayUnavailableError() {
  const error = new Error('LCX checkpoint replay requires the public DSH ctx.llm.stream API')
  error.code = CHECKPOINT_REPLAY_UNAVAILABLE_CODE
  return error
}

function checkpointReplayRecord(messages, store) {
  const marker = latestPortableMarker(messages)
  if (!marker) return undefined
  const record = store?.get?.(marker.id)
  if (!record) {
    const error = new Error(`LCX v3 checkpoint ${marker.id} is missing from ${store?.file ?? 'checkpoint store'}`)
    error.code = 'LCX_CHECKPOINT_V3_CORRUPT'
    throw error
  }
  return { marker, record }
}

function nativeReplayBody(options, route, config, nativeOutput, tailInput) {
  return {
    model: options.model,
    input: [...structuredClone(nativeOutput), ...structuredClone(tailInput)],
    stream: true,
    store: false,
    ...(options.tools !== undefined ? { tools: responsesTools(options.tools) } : {}),
    ...(options.system !== undefined ? { instructions: options.system } : {}),
    ...(promptCacheKey(route, config) ? { prompt_cache_key: promptCacheKey(route, config) } : {}),
    ...(promptCacheRetention(config) ? { prompt_cache_retention: promptCacheRetention(config) } : {}),
  }
}

async function* nativeCheckpointReplayStream(options, config, portableStore, ctx, record, marker) {
  const route = routeWithSessionAncestry(ctx, currentRoute(options, config))
  assertCheckpointRoute(record, route)
  const llm = ctx?.llm ?? ctx?.get?.('llm')
  const imageSupport = typeof llm?.resolveModelInfo === 'function'
    ? await resolveModelImageSupport(llm, route, options.signal)
    : 'supported'
  const imageOptions = { resolveImage: attachmentImageResolver(ctx), imageSupport, signal: options.signal, maxRequestImageBytes: config.maxRequestImageBytes }
  const nativeOutput = await hydrateNativeImageReferences(checkpointNativeReplacementHistory(record), imageOptions)
  const tailInput = await buildPortableResponsesInputWithImages(
    (options.messages ?? []).slice(marker.index + 1),
    portableStore,
    route,
    imageOptions,
  )
  const replaySignals = replayEffectiveSignal(options.signal, config.timeoutMs)
  try {
    const response = await fetchSse(
      `${config.baseURL}/responses`,
      nativeReplayBody(options, route, config, nativeOutput, tailInput),
      mergeFeatureHeader(await promptCacheHeaders(ctx, config, route)),
      replaySignals.signal,
      config.timeoutMs + 1000,
      { maxResponseBytes: config.maxResponseBytes },
    )
    yield* responsesSseChunks(response, {
      signal: replaySignals.signal,
      requestSignal: options.signal,
      timeoutSignal: replaySignals.timeoutSignal,
      timeoutMs: config.timeoutMs,
      maxResponseBytes: config.maxResponseBytes,
    })
  } catch (error) {
    if (replaySignals.timeoutSignal.aborted && !options.signal?.aborted) {
      throw replayTimeoutError(config.timeoutMs, error)
    }
    throw error
  }
}

async function* textChunks(text, usage) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  if (usage) yield { type: 'usage', usage }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

function isCompactionDirective(message) {
  return textOfMessage(message).includes(COMPACTION_DIRECTIVE)
}

function diagnosticEndpoint(baseURL) {
  try {
    const url = new URL(`${String(baseURL).replace(/\/+$/u, '')}/responses`)
    return `${url.origin}${url.pathname}`
  } catch {
    return 'invalid'
  }
}

function logCompactionDiagnostic(ctx, options, config, error, phase) {
  const failure = failureOf(error)
  const status = failure.status === undefined ? '' : ` status=${failure.status}`
  const detail = `dsh-lcx-codex compaction ${phase}: code=${failure.code}${status} provider=${String(options.provider ?? config.provider)} model=${String(options.model ?? config.model)} transport=${config.compactTransport} endpoint=${diagnosticEndpoint(config.baseURL)} inputItems=${Array.isArray(options.messages) ? options.messages.length : 0}`
  try {
    if (typeof ctx?.logger?.error === 'function') ctx.logger.error(detail)
    else if (typeof console?.error === 'function') console.error(detail)
  } catch {
    // Diagnostics must never change compaction behavior.
  }
}

async function prepareRemoteCompaction(options, config, portableStore, ctx, sessionTracker) {
  const last = options.messages?.[options.messages.length - 1]
  const history = last && isCompactionDirective(last) ? options.messages.slice(0, -1) : options.messages
  const route = currentRoute(options, config)
  const lease = sessionTracker?.capture(route.sessionId)
  lease?.assert('request-start')
  const headers = await promptCacheHeaders(ctx, config, route)
  responsesTools(options.tools)
  const llm = ctx?.llm ?? ctx?.get?.('llm')
  const imageSupport = typeof llm?.resolveModelInfo === 'function'
    ? await resolveModelImageSupport(llm, route, options.signal)
    : 'supported'
  const imageReferences = new Map()
  const input = await buildPortableResponsesInputWithImages(history, portableStore, route, {
    resolveImage: attachmentImageResolver(ctx),
    imageSupport,
    signal: options.signal,
    maxRequestImageBytes: config.maxRequestImageBytes,
    onImageResolved: ({ imageUrl, attachment }) => imageReferences.set(imageUrl, attachment),
  })
  lease?.assert('preflight')
  return { history, route, lease, input, imageReferences, headers }
}

function mergeUsage(...values) {
  const keys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
  const merged = {}
  for (const key of keys) {
    const total = values.reduce((sum, value) => sum + (Number.isFinite(value?.[key]) ? value[key] : 0), 0)
    if (total > 0) merged[key] = total
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function readableSummaryText(text, model, usage) {
  const summary = stripCheckpointMarker(String(text ?? '')).trim().slice(0, 16 * 1024)
  return summary || portableSummaryText(model, usage)
}

function portableMarkerTextWithSummary(id, model, usage, summary) {
  const summaryText = stripCheckpointMarker(String(summary ?? '')).trim().slice(0, 16 * 1024)
  const status = portableSummaryText(model, usage)
  return `${summaryText ? `${summaryText}\n` : ''}${status}\n[dsh-lcx-codex-v3-checkpoint:${id}]`
}

async function commitRemoteCompaction(prepared, result, portableStore, config, summary, usage) {
  const { history, route, lease, input, imageReferences } = prepared
  lease?.assert('commit')
  const replacementHistory = buildNativeReplacementHistory(input, result.compaction)
  const persistedNativeOutput = persistNativeImageReferences(replacementHistory, imageReferences)
  const persistedPortableInput = persistNativeImageReferences(input, imageReferences)
  const id = randomUUID()
  const parent = latestPortableMarker(history)
  const portableImageCount = inputImageCount(input)
  const portableSummary = readableSummaryText(summary, route.model, usage)
  portableStore.put(id, {
    version: CHECKPOINT_V3_VERSION,
    checkpointId: id,
    ...(parent ? { parentCheckpointId: parent.id } : {}),
    lineageId: route.sessionId || `${route.provider}:${route.baseURL}`,
    sourceSessionId: route.sessionId || `${route.provider}:${route.baseURL}`,
    provider: route.provider,
    model: route.model,
    modelKey: `${route.provider}:${route.model}`,
    transport: config.compactTransport,
    baseURLFingerprint: baseURLFingerprint(route.baseURL),
    routeFingerprint: routeFingerprint(route),
    nativeOutput: persistedNativeOutput,
    nativeCompaction: result.compaction,
    portableHistory: buildPortableHistory(persistedPortableInput),
    ...(portableImageCount > 0 ? { portableImageCount } : {}),
    portableSummary,
    createdAt: Date.now(),
    usage,
  })
  return { id, route, usage, text: portableMarkerTextWithSummary(id, route.model, usage, summary) }
}

async function* remoteCompactionStream(options, config, portableStore, ctx, sessionTracker) {
  try {
    const prepared = await prepareRemoteCompaction(options, config, portableStore, ctx, sessionTracker)
    const result = await requestRemoteCompaction(options, prepared.input, config, options.signal, ctx, prepared.route, prepared.headers)
    const committed = await commitRemoteCompaction(prepared, result, portableStore, config, undefined, result.usage)
    yield* textChunks(committed.text, committed.usage)
  } catch (error) {
    logCompactionDiagnostic(ctx, options, config, error, 'failed')
    throw error
  }
}

async function collectLocalCompaction(next) {
  const chunks = []
  const stream = await next()
  for await (const chunk of stream) chunks.push(chunk)
  const text = chunks.filter((chunk) => chunk?.type === 'text-delta' && typeof chunk.text === 'string').map((chunk) => chunk.text).join('')
  const usage = chunks.find((chunk) => chunk?.type === 'usage')?.usage
  return { chunks, text, usage }
}

async function* parallelCompactionStream(options, config, portableStore, ctx, sessionTracker, next, diagnostic) {
  let prepared
  try {
    prepared = await prepareRemoteCompaction(options, config, portableStore, ctx, sessionTracker)
  } catch (error) {
    logCompactionDiagnostic(ctx, options, config, error, 'failed')
    throw error
  }
  const localPromise = collectLocalCompaction(next)
  const remotePromise = requestRemoteCompaction(options, prepared.input, config, options.signal, ctx, prepared.route, prepared.headers)
    .then((result) => ({ result }), (error) => ({ error }))
  const [localOutcome, remoteOutcome] = await Promise.allSettled([localPromise, remotePromise])
  if (remoteOutcome.status === 'fulfilled' && remoteOutcome.value.result) {
    const local = localOutcome.status === 'fulfilled' ? localOutcome.value : { text: '', usage: undefined }
    const usage = mergeUsage(remoteOutcome.value.result.usage, local.usage)
    try {
      const committed = await commitRemoteCompaction(prepared, remoteOutcome.value.result, portableStore, config, local.text, usage)
      yield* textChunks(committed.text, committed.usage)
      return
    } catch (error) {
      logCompactionDiagnostic(ctx, options, config, error, 'failed')
      throw error
    }
  }
  const remoteError = remoteOutcome.status === 'fulfilled' ? remoteOutcome.value.error : remoteOutcome.reason
  if (options.signal?.aborted || remoteError?.remoteCompactionRequest !== true) throw remoteError
  diagnostic?.(remoteError, 'failed')
  diagnostic?.(remoteError, 'fallback')
  if (localOutcome.status !== 'fulfilled') throw localOutcome.reason
  for (const chunk of localOutcome.value.chunks) yield chunk
}

function replaySseError(message, code = 'LCX_RESPONSES_UPSTREAM_ERROR') {
  const error = new Error(message)
  error.code = code
  return error
}

function replayTimeoutError(timeoutMs, cause) {
  const error = replaySseError(`LCX Responses replay timed out after ${timeoutMs} ms`, 'LCX_TIMEOUT')
  if (cause !== undefined) error.cause = cause
  return error
}

function replayAbortError(options, cause) {
  if (options.timeoutSignal?.aborted && !options.requestSignal?.aborted) {
    return replayTimeoutError(options.timeoutMs, cause)
  }
  return cause ?? options.signal?.reason ?? new Error('request aborted')
}

function replayEffectiveSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return {
    timeoutSignal,
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  }
}

function replaySseEvent(dataLines) {
  if (dataLines.length === 0) return undefined
  const data = dataLines.join('\n')
  if (data === '[DONE]') return undefined
  try {
    const parsed = JSON.parse(data)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('event is not an object')
    return parsed
  } catch (error) {
    throw replaySseError(`LCX Responses replay returned malformed SSE JSON: ${String(error)}`, 'LCX_INVALID_SSE')
  }
}

function replayOutputIndex(event, item) {
  const value = event?.output_index ?? item?.output_index
  return Number.isInteger(value) ? value : undefined
}

function replayItemId(event, item) {
  const value = event?.item_id ?? item?.id
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function replayItemKey(event, item) {
  const outputIndex = replayOutputIndex(event, item)
  if (outputIndex !== undefined) return `output:${outputIndex}`
  const itemId = replayItemId(event, item)
  return itemId ? `item:${itemId}` : undefined
}

function replayKind(type) {
  if (type === 'function_call' || type === 'response.function_call' || type === 'tool-call') return 'tool-call'
  if (type === 'reasoning') return 'reasoning'
  return 'text'
}

function replayItemText(item, kind) {
  if (kind === 'reasoning') return responseReasoningText(item)
  return responseTextParts(item).join('')
}

function replayEnsureOpen(state) {
  if (state.open) return []
  state.open = true
  state.started = true
  return [{ type: 'block-start', index: state.index, blockType: state.kind }]
}

function replayClose(state, finalText) {
  const chunks = []
  if (!state.open) {
    if (!state.started && typeof finalText === 'string' && finalText.length > 0) chunks.push(...replayEnsureOpen(state))
    else return []
  }
  if (typeof finalText === 'string' && (state.text.length === 0 || finalText.length >= state.text.length)) state.text = finalText
  state.open = false
  state.closed = true
  return [...chunks, {
    type: 'block-end',
    index: state.index,
    block: state.kind === 'tool-call'
      ? { type: 'tool-call', id: state.id, name: state.name, arguments: state.arguments }
      : { type: state.kind, text: state.text },
  }]
}

function replayCloseItem(state, item) {
  const kind = replayKind(item?.type ?? state.kind)
  state.kind = kind
  if (kind === 'tool-call') {
    if (typeof item?.call_id === 'string' && item.call_id.length > 0) state.id = item.call_id
    if (!state.id) state.id = randomUUID()
    state.name = String(item?.name ?? state.name ?? '')
    const finalArguments = typeof item?.arguments === 'string' ? item.arguments : undefined
    const chunks = []
    if (!state.started && (state.name || finalArguments)) {
      chunks.push(...replayEnsureOpen(state))
      if (finalArguments) {
        state.arguments = finalArguments
        chunks.push({ type: 'tool-call-delta', index: state.index, id: state.id, name: state.name, argumentsDelta: finalArguments })
      }
    } else if (finalArguments && state.arguments.length === 0) {
      state.arguments = finalArguments
    }
    chunks.push(...replayClose(state))
    return chunks
  }
  const finalText = replayItemText(item, kind)
  const chunks = []
  if (!state.started && finalText) {
    chunks.push(...replayEnsureOpen(state))
    state.text = finalText
    chunks.push({ type: kind === 'reasoning' ? 'reasoning-delta' : 'text-delta', index: state.index, text: finalText })
  }
  chunks.push(...replayClose(state, finalText))
  return chunks
}

async function* responsesSseChunks(response, options = {}) {
  if (!response?.body) throw replaySseError('LCX Responses replay response did not include an SSE body', 'LCX_INVALID_SSE')
  const maxBytes = options.maxResponseBytes ?? 8 * 1024 * 1024
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const states = new Map()
  let nextIndex = 0
  let pending = ''
  let dataLines = []
  let bytes = 0
  let sawCompleted = false
  let hasToolCall = false
  let completedResponse
  const cancel = () => { reader.cancel(options.signal?.reason).catch(() => undefined) }
  options.signal?.addEventListener('abort', cancel, { once: true })

  const stateFor = (event, item, kindHint) => {
    const outputIndex = replayOutputIndex(event, item)
    const itemId = replayItemId(event, item)
    const kind = kindHint ?? replayKind(item?.type)
    const key = replayItemKey(event, item)
    let state = key ? states.get(key) : undefined
    if (!state) {
      state = [...states.values()].find((candidate) =>
        !candidate.closed &&
        ((outputIndex !== undefined && candidate.outputIndex === outputIndex) ||
          (itemId !== undefined && candidate.itemId === itemId) ||
          (outputIndex === undefined && itemId === undefined && candidate.kind === kind)))
    }
    if (!state) {
      state = {
        index: nextIndex++,
        kind,
        open: false,
        closed: false,
        started: false,
        text: '',
        arguments: '',
        id: undefined,
        itemId: undefined,
        outputIndex: undefined,
        name: '',
      }
      states.set(key ?? `anonymous:${state.index}`, state)
    }
    if (outputIndex !== undefined) state.outputIndex = outputIndex
    if (itemId !== undefined) state.itemId = itemId
    if (item?.type) state.kind = replayKind(item.type)
    if (typeof event?.call_id === 'string' && event.call_id.length > 0) state.id = event.call_id
    if (typeof item?.call_id === 'string' && item.call_id.length > 0) state.id = item.call_id
    if (item?.name) state.name = String(item.name)
    return state
  }

  const stateForCompleted = (item, outputIndex, consumed) => {
    const kind = replayKind(item?.type)
    const itemId = replayItemId(undefined, item)
    let state = [...states.values()].find((candidate) =>
      !consumed.has(candidate) &&
      ((outputIndex !== undefined && candidate.outputIndex === outputIndex) ||
        (itemId !== undefined && candidate.itemId === itemId)))
    if (!state && itemId === undefined) {
      state = [...states.values()].find((candidate) => !consumed.has(candidate) && candidate.kind === kind)
    }
    if (!state) state = stateFor({ output_index: outputIndex }, item, kind)
    consumed.add(state)
    return state
  }

  const eventChunks = (event) => {
    if (event?.type === 'error' || event?.type === 'response.failed' || event?.type === 'response.incomplete' || event?.type === 'response.error') {
      const message = event.error?.message ?? event.response?.error?.message ?? `LCX Responses replay upstream error (${String(event.type)})`
      throw replaySseError(message)
    }
    if (event?.type === 'response.output_item.added') {
      const item = event.item
      const state = stateFor(event, item)
      if (item?.type === 'function_call') hasToolCall = true
      return []
    }
    if (event?.type === 'response.output_text.delta') {
      const state = stateFor(event, undefined, 'text')
      const delta = typeof event.delta === 'string' ? event.delta : ''
      if (!delta) return []
      const chunks = replayEnsureOpen(state)
      state.text += delta
      chunks.push({ type: 'text-delta', index: state.index, text: delta })
      return chunks
    }
    if (event?.type === 'response.output_text.done') {
      const state = stateFor(event, undefined, 'text')
      return replayClose(state, typeof event.text === 'string' ? event.text : undefined)
    }
    if (event?.type === 'response.function_call_arguments.delta') {
      const state = stateFor(event, undefined, 'tool-call')
      state.kind = 'tool-call'
      if (typeof event.call_id === 'string' && event.call_id.length > 0) state.id = event.call_id
      if (!state.id) state.id = randomUUID()
      if (typeof event.name === 'string') state.name = event.name
      const delta = typeof event.delta === 'string' ? event.delta : ''
      if (!delta) return []
      hasToolCall = true
      const chunks = replayEnsureOpen(state)
      state.arguments += delta
      chunks.push({ type: 'tool-call-delta', index: state.index, id: state.id, name: state.name, argumentsDelta: delta })
      return chunks
    }
    if (event?.type === 'response.function_call_arguments.done') {
      const state = stateFor(event, undefined, 'tool-call')
      state.kind = 'tool-call'
      hasToolCall = true
      if (typeof event.call_id === 'string' && event.call_id.length > 0) state.id = event.call_id
      if (!state.id) state.id = randomUUID()
      if (typeof event.name === 'string') state.name = event.name
      const chunks = []
      const finalArguments = typeof event.arguments === 'string' ? event.arguments : ''
      if (!state.started && (state.name || finalArguments)) {
        chunks.push(...replayEnsureOpen(state))
        if (finalArguments) {
          state.arguments = finalArguments
          chunks.push({ type: 'tool-call-delta', index: state.index, id: state.id, name: state.name, argumentsDelta: finalArguments })
        }
      } else if (finalArguments && state.arguments.length === 0) {
        state.arguments = finalArguments
      }
      chunks.push(...replayClose(state))
      return chunks
    }
    if (event?.type === 'response.output_item.done') {
      const state = stateFor(event, event.item)
      if (event.item?.type === 'function_call' || state.kind === 'tool-call') hasToolCall = true
      if (state.kind === 'text') {
        const finalText = replayItemText(event.item, 'text')
        if (finalText && [...states.values()].some((candidate) =>
          candidate !== state && candidate.closed && candidate.kind === 'text' && candidate.text === finalText)) return []
      }
      return replayCloseItem(state, event.item)
    }
    if (event?.type === 'response.completed') {
      sawCompleted = true
      completedResponse = event.response && typeof event.response === 'object' ? event.response : {}
      const chunks = []
      const completedStates = new Set()
      if (Array.isArray(completedResponse.output)) {
        for (let outputIndex = 0; outputIndex < completedResponse.output.length; outputIndex += 1) {
          const item = completedResponse.output[outputIndex]
          if (item?.type === 'function_call') hasToolCall = true
          const completedText = replayItemText(item, 'text')
          if (completedText && [...states.values()].some((candidate) =>
            candidate.closed && candidate.kind === 'text' && candidate.text === completedText)) {
            continue
          }
          const state = stateForCompleted(item, outputIndex, completedStates)
          // A provider may emit output_text.done/output_item.done before the
          // authoritative response.completed event. The completed event closes
          // the response, but must not create a second visible DSH block for an
          // item that has already been closed on the stream.
          if (state.closed) continue
          // Some gateways change output indexes or omit item ids between
          // streaming events and response.completed. If the completed text
          // exactly matches an already closed text state, it is the same
          // visible item and must not be projected a second time.
          chunks.push(...replayCloseItem(state, item))
        }
      }
      for (const state of states.values()) {
        if (!completedStates.has(state)) chunks.push(...replayClose(state))
      }
      const usage = usageFrom(completedResponse)
      if (usage) chunks.push({ type: 'usage', usage })
      chunks.push({ type: 'finish', reason: { kind: hasToolCall ? 'tool-calls' : 'stop' } })
      return chunks
    }
    if (event?.type === 'response.reasoning_summary_text.delta' || event?.type === 'response.reasoning_text.delta' || event?.type === 'response.reasoning.delta') {
      const state = stateFor(event, undefined, 'reasoning')
      state.kind = 'reasoning'
      const delta = typeof event.delta === 'string' ? event.delta : ''
      if (!delta) return []
      const chunks = replayEnsureOpen(state)
      state.text += delta
      chunks.push({ type: 'reasoning-delta', index: state.index, text: delta })
      return chunks
    }
    if (event?.type === 'response.reasoning_summary_text.done' || event?.type === 'response.reasoning_text.done' || event?.type === 'response.reasoning.done') {
      const state = stateFor(event, undefined, 'reasoning')
      state.kind = 'reasoning'
      return replayClose(state, typeof event.text === 'string' ? event.text : undefined)
    }
    return []
  }

  const dispatch = () => {
    const event = replaySseEvent(dataLines)
    dataLines = []
    return event ? eventChunks(event) : []
  }

  try {
    while (true) {
      if (options.signal?.aborted) throw replayAbortError(options)
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > maxBytes) throw replaySseError(`LCX Responses replay SSE response exceeds ${maxBytes} bytes`, 'LCX_RESPONSE_TOO_LARGE')
      pending += decoder.decode(result.value, { stream: true })
      let newline
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/u, '')
        pending = pending.slice(newline + 1)
        if (line === '') {
          for (const chunk of dispatch()) yield chunk
        } else if (!line.startsWith(':')) {
          if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /u, ''))
        }
      }
    }
    pending += decoder.decode()
    if (pending.length > 0) {
      const line = pending.replace(/\r$/u, '')
      if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /u, ''))
    }
    for (const chunk of dispatch()) yield chunk
  } catch (error) {
    throw replayAbortError(options, error)
  } finally {
    options.signal?.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => undefined)
  }
  if (!sawCompleted && options.timeoutSignal?.aborted && !options.requestSignal?.aborted) {
    throw replayTimeoutError(options.timeoutMs)
  }
  if (!sawCompleted) throw replaySseError('LCX Responses replay SSE ended without response.completed', 'LCX_INCOMPLETE_SSE')
  if (!completedResponse) throw replaySseError('LCX Responses replay did not return a completed response', 'LCX_INCOMPLETE_SSE')
}

function failureOf(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    code: typeof error?.code === 'string' ? error.code : 'LCX_CODEX_ERROR',
    ...(Number.isInteger(error?.status) ? { status: error.status } : {}),
  }
}

function guardedStream(factory, signal) {
  return (async function* () {
    try {
      yield* factory()
    } catch (error) {
      const failure = failureOf(error)
      yield {
        type: 'finish',
        reason: signal?.aborted ? { kind: 'aborted', failure } : { kind: 'error', failure },
      }
    }
  })()
}

async function executeHostedSearch(ctx, config, args, signal) {
  abortIfNeeded(signal)
  const normalized = normalizeHostedSearchArgs(args)
  const requestId = randomUUID()
  try {
    const response = await fetchJsonWithRetry(
      `${config.baseURL}/responses`,
      buildHostedSearchBody(normalized, config.model),
      await authenticatedHeaders(ctx, config, undefined, requestId),
      signal,
      config.timeoutMs,
      { maxAttempts: config.maxAttempts, maxResponseBytes: config.maxResponseBytes },
    )
    return parseHostedSearchResponse(response, requestId, config.webMaxResults)
  } catch (error) {
    if (signal?.aborted) throw webError('LCX hosted Web Search aborted', 'LCX_WEB_ABORTED', error)
    if (error?.code === 'LCX_TIMEOUT') throw webError(String(error), 'LCX_WEB_TIMEOUT', error)
    if (error?.code?.startsWith?.('WEB_')) throw error
    throw webError(String(error), 'LCX_WEB_PROVIDER_ERROR', error)
  }
}

function configuredResponsesRoute(ctx, config) {
  const normalized = normalizeConfig(config)
  return resolveResponsesRouteConfig(ctx, { provider: normalized.provider, model: normalized.model }, normalized)
}

function currentAlphaCapabilityFingerprint(config, model = config.model) {
  return alphaCapabilityFingerprint({
    baseURL: config.baseURL,
    provider: config.provider,
    model,
    profile: config.alphaProfile,
    group: config.alphaGroup,
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
  })
}

function isHttpReference(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function alphaUnavailable(message = 'Alpha Web Search action is unavailable for the verified deployment capability') {
  return webError(message, 'LCX_ALPHA_ACTION_UNAVAILABLE')
}

function activeAgentRoute(agent) {
  const requestContext = agent?.session?.requestContext?.()
  const requestConfig = agent?.session?.requestHeader?.()?.config
  return {
    provider: requestContext?.provider ?? requestConfig?.provider ?? agent?.options?.provider,
    model: requestContext?.model ?? requestConfig?.model ?? agent?.options?.model,
  }
}

async function executeAlphaSearch(ctx, config, capabilityStore, refStore, args, exec) {
  abortIfNeeded(exec?.signal)
  const normalized = normalizeAlphaSearchArgs(args)
  const sessionId = typeof exec?.agent?.id === 'string' ? exec.agent.id : undefined
  if (!sessionId) throw webError('Alpha Web Search requires a live DSH agent session', 'LCX_ALPHA_SESSION_REQUIRED')
  const { provider: agentProvider, model: agentModel } = activeAgentRoute(exec?.agent)
  const routeConfig = resolveResponsesRouteConfig(ctx, {
    provider: agentProvider ?? config.provider,
    model: agentModel ?? config.model,
  }, config)
  if (!routeConfig) throw alphaUnavailable('Alpha Web Search requires an active DSH GPT openai-responses model route')
  const fingerprint = currentAlphaCapabilityFingerprint(routeConfig)
  const capability = capabilityStore.get(fingerprint)
  if (!alphaCapabilityUsable(capability) || capability.schemaFingerprint !== ALPHA_SCHEMA_FINGERPRINT || capability.actions?.[normalized.action] !== 'supported') {
    throw alphaUnavailable()
  }
  if (normalized.refId && !isHttpReference(normalized.refId)) refStore.assertUsable(sessionId, fingerprint, normalized.refId)
  const requestId = randomUUID()
  try {
    const response = await fetchJsonWithRetry(
      `${routeConfig.baseURL}/alpha/search`,
      buildAlphaSearchBody(normalized, routeConfig.model, sessionId, true, routeConfig.alphaMaxOutputTokens),
      await authenticatedHeaders(ctx, routeConfig, sessionId, requestId),
      exec?.signal,
      routeConfig.timeoutMs,
      { maxAttempts: routeConfig.maxAttempts, maxResponseBytes: routeConfig.maxResponseBytes },
    )
    const result = parseAlphaSearchResponse(response, {
      action: normalized.action,
      capability: capability.classification,
      requestId,
    })
    if (result.refs.length > 0) {
      refStore.record(sessionId, fingerprint, result.refs.map((refId) => ({
        refId,
        ...(result.sources.find((source) => source.refId === refId)?.url ? { url: result.sources.find((source) => source.refId === refId).url } : {}),
      })))
    }
    return result
  } catch (error) {
    if (exec?.signal?.aborted) throw webError('LCX Alpha Web Search aborted', 'LCX_ALPHA_ABORTED', error)
    if (error?.code === 'LCX_TIMEOUT') throw webError('LCX Alpha Web Search timed out', 'LCX_ALPHA_TIMEOUT', error)
    if (error?.code?.startsWith?.('WEB_') || error?.code?.startsWith?.('LCX_ALPHA_')) throw error
    if ([404, 405].includes(error?.status) || /channel does not support/iu.test(String(error?.message ?? ''))) throw alphaUnavailable()
    throw webError('LCX Alpha Web Search provider request failed', 'LCX_ALPHA_PROVIDER_ERROR', error)
  }
}

class LcxResponsesSearchProvider {
  constructor(ctxOrConfig, maybeConfig, enabled = () => true) {
    this.ctx = maybeConfig === undefined ? undefined : ctxOrConfig
    this.config = maybeConfig ?? ctxOrConfig
    this.enabled = typeof enabled === 'function' ? enabled : () => true
    this.id = this.config.webSearchProvider
  }

  available() {
    const routeConfig = configuredResponsesRoute(this.ctx, this.config)
    return this.enabled() && Boolean(routeConfig) && URL.canParse(`${routeConfig.baseURL}/responses`)
  }

  async search(request, signal) {
    abortIfNeeded(signal)
    const routeConfig = configuredResponsesRoute(this.ctx, this.config)
    if (!routeConfig) throw webError('Hosted Web Search requires a configured DSH GPT openai-responses model route', 'LCX_WEB_ROUTE_UNAVAILABLE')
    const result = await executeHostedSearch(this.ctx, routeConfig, { query: request.query }, signal)
    const maxResults = Number.isInteger(request.maxResults) && request.maxResults > 0 ? request.maxResults : routeConfig.webMaxResults
    return {
      content: `【Responses Hosted 搜索 · LCX】${result.content ? `\n${result.content}` : ''}`,
      sources: result.sources.slice(0, maxResults),
      truncated: result.sources.length > maxResults || result.truncated,
    }
  }
}

function createWebSearchGptTool(ctx, state, getConfig) {
  return {
    name: WEB_SEARCH_TOOL_NAME,
    description: 'GPT 专属一次性 Responses Hosted Web Search。支持 query、域名过滤、用户位置、搜索上下文、外部 Web 访问、返回预算和图片搜索控制，并返回来源、引用和检索时间；不提供基于当前会话 ref_id 的 open、find、click 或 screenshot 页面操作。',
    parameters: HOSTED_SEARCH_PARAMETERS,
    output: {
      schema: HOSTED_SEARCH_OUTPUT,
      render: (_args, value) => renderHostedSearchResult(value),
      presentationMeta: (_args, value) => ({
        mode: value.mode,
        action: value.action,
        emulation: value.emulation,
        answer: value.content,
        sources: value.sources,
        citations: value.citations,
        images: value.images,
        warnings: value.warnings,
        ...(value.outputBlocks ? { outputBlocks: value.outputBlocks } : {}),
        ...(value.domains ? { domains: value.domains } : {}),
        ...(value.lineRange ? { lineRange: value.lineRange } : {}),
        ...(value.requestId ? { requestId: value.requestId } : {}),
        ...(value.responseId ? { responseId: value.responseId } : {}),
        retrievedAt: value.retrievedAt,
        truncated: value.truncated,
      }),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Responses Hosted 搜索：${typeof args?.query === 'string' ? args.query : ''}`,
      kind: 'search',
      rawInput: JSON.stringify(args ?? {}),
    }),
    async execute(args, exec) {
      if (!state.enabled || !state.webSearch) throw new Error(`${WEB_SEARCH_TOOL_NAME} 未启用，请先在设置中开启 GPT 原生 Web Search`)
      const config = getConfig()
      const { provider, model } = activeAgentRoute(exec?.agent)
      const routeConfig = resolveResponsesRouteConfig(ctx, {
        provider: provider ?? config.provider,
        model: model ?? config.model,
      }, config)
      if (!routeConfig) throw webError('Hosted Web Search requires an active DSH GPT openai-responses model route', 'LCX_WEB_ROUTE_UNAVAILABLE')
      return executeHostedSearch(ctx, routeConfig, args, exec?.signal)
    },
  }
}

function createWebSearchAlphaTool(ctx, getConfig, capabilityStore, refStore) {
  return {
    name: ALPHA_SEARCH_TOOL_NAME,
    description: '独立且有状态的 Alpha Web Search command 工具。一次只执行一个 search_query、image_query、open、find、click、screenshot、finance、weather、sports 或 time action；open、find、click 和 screenshot 使用当前会话已返回的 ref_id。仅在匹配的 capability probe 已验证时注册。',
    parameters: ALPHA_SEARCH_PARAMETERS,
    output: {
      schema: ALPHA_SEARCH_OUTPUT,
      render: (_args, value) => renderAlphaSearchResult(value),
      presentationMeta: (_args, value) => ({
        mode: value.mode,
        action: value.action,
        capability: value.capability,
        emulation: value.emulation,
        answer: value.content,
        sources: value.sources,
        citations: value.citations,
        refs: value.refs,
        links: value.links,
        pdfRefs: value.pdfRefs,
        ...(value.requestId ? { requestId: value.requestId } : {}),
        ...(value.responseId ? { responseId: value.responseId } : {}),
        retrievedAt: value.retrievedAt,
        warnings: value.warnings,
      }),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Alpha Web Search：${typeof args?.action === 'string' ? args.action : ''}`,
      kind: 'search',
      rawInput: JSON.stringify(args ?? {}),
    }),
    execute(args, exec) {
      return executeAlphaSearch(ctx, getConfig(), capabilityStore, refStore, args, exec)
    },
  }
}

function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const portableStore = new CheckpointV3Store(config.portableCheckpointPath)
  const originalSearchProvider = ctx.web.searchProviderId
  const state = {
    enabled: false,
    webSearch: false,
    alphaSearch: false,
    remoteCompaction: false,
    fallbackToBasicCompaction: true,
  }
  let runtimeConfig = config
  const provider = new LcxResponsesSearchProvider(ctx, runtimeConfig, () => state.enabled && state.webSearch)
  ctx.web.registerSearchProvider(provider)
  const tools = ctx.get?.('tools') ?? ctx.tools
  const systemPrompt = ctx.get?.('systemPrompt') ?? ctx.systemPrompt
  const sessionTracker = createSessionGenerationTracker(ctx)
  let disposeHostedTool
  let disposeAlphaTool
  let disposeHostedPrompt
  let disposeAlphaPrompt
  let alphaCapabilityStore
  let alphaRefStore
  let lastAlphaStoreErrorCode

  const alphaStores = () => {
    try {
      alphaCapabilityStore ??= new AlphaCapabilityStore(config.alphaCapabilityPath)
      alphaRefStore ??= new AlphaRefStore(config.alphaRefPath)
      return { capability: alphaCapabilityStore, refs: alphaRefStore }
    } catch (error) {
      const code = String(error?.code ?? 'LCX_ALPHA_STORE_UNAVAILABLE')
      if (code !== lastAlphaStoreErrorCode) ctx.logger?.error?.(`[lcx-codex] alpha-store unavailable code=${code}`)
      lastAlphaStoreErrorCode = code
      alphaCapabilityStore = undefined
      alphaRefStore = undefined
      return undefined
    }
  }

  const syncToolRegistration = () => {
    const hostedEnabled = Boolean(state.enabled && state.webSearch)
    const configuredRoute = configuredResponsesRoute(ctx, runtimeConfig)
    const fingerprint = configuredRoute ? currentAlphaCapabilityFingerprint(configuredRoute) : undefined
    const stores = state.enabled && state.alphaSearch ? alphaStores() : undefined
    let alphaCapability
    try {
      alphaCapability = fingerprint ? stores?.capability.get(fingerprint) : undefined
      if (stores) lastAlphaStoreErrorCode = undefined
    } catch (error) {
      const code = String(error?.code ?? 'LCX_ALPHA_STORE_UNAVAILABLE')
      if (code !== lastAlphaStoreErrorCode) ctx.logger?.error?.(`[lcx-codex] alpha-store unavailable code=${code}`)
      lastAlphaStoreErrorCode = code
    }
    const alphaEnabled = Boolean(stores && alphaCapabilityUsable(alphaCapability) && alphaCapability?.schemaFingerprint === ALPHA_SCHEMA_FINGERPRINT)
    if (hostedEnabled && !disposeHostedTool && tools?.register) disposeHostedTool = tools.register(createWebSearchGptTool(ctx, state, () => runtimeConfig))
    if (!hostedEnabled && disposeHostedTool) {
      disposeHostedTool()
      disposeHostedTool = undefined
    }
    if (alphaEnabled && !disposeAlphaTool && tools?.register) disposeAlphaTool = tools.register(createWebSearchAlphaTool(ctx, () => runtimeConfig, stores.capability, stores.refs))
    if (!alphaEnabled && disposeAlphaTool) {
      disposeAlphaTool()
      disposeAlphaTool = undefined
    }
    if (hostedEnabled && !disposeHostedPrompt && systemPrompt?.section) {
      disposeHostedPrompt = systemPrompt.section({
        name: 'tool:websearch_gpt',
        order: 111,
        text: '使用 websearch_gpt 查询当前或需要来源的问题。该工具走 Responses hosted web_search；最终回答必须引用直接 URL，并区分来源发布时间与检索时间。',
      }) ?? (() => {})
    }
    if (!hostedEnabled && disposeHostedPrompt) {
      disposeHostedPrompt()
      disposeHostedPrompt = undefined
    }
    if (alphaEnabled && !disposeAlphaPrompt && systemPrompt?.section) {
      disposeAlphaPrompt = systemPrompt.section({
        name: 'tool:websearch_alpha',
        order: 112,
        text: 'websearch_alpha 是独立 Alpha command API。一次只调用一个 action；只能对当前 session 已返回的 ref_id 执行 open/find/click/screenshot，最终回答引用直接 URL，不暴露内部 ref_id。',
      }) ?? (() => {})
    }
    if (!alphaEnabled && disposeAlphaPrompt) {
      disposeAlphaPrompt()
      disposeAlphaPrompt = undefined
    }
  }

  const sync = (next) => {
    Object.assign(state, next ?? {})
    runtimeConfig = normalizeConfig({ ...config, ...next })
    provider.config = runtimeConfig
    ctx.web.searchProviderId = state.enabled && state.webSearch ? runtimeConfig.webSearchProvider : originalSearchProvider
    syncToolRegistration()
  }
  const settingsBase = {
    enabled: false,
    webSearch: false,
    alphaSearch: false,
    remoteCompaction: false,
    fallbackToBasicCompaction: true,
    provider: config.provider,
    baseURL: config.baseURL,
    apiKeyEnv: config.apiKeyEnv,
    model: config.model,
    compactTransport: config.compactTransport,
  }
  const attachSettings = (settingsContext) => {
    const settings = settingsContext.settings ?? settingsContext
    if (!settings?.register) return
    const scope = settings.register(settingsNamespace(SETTINGS_NAMESPACE), SettingsSchema, { base: settingsBase })
    sync(scope.get())
    scope.watch(() => sync(scope.get()))
  }
  if (typeof ctx.inject === 'function') ctx.inject(['settings'], attachSettings)
  else attachSettings(ctx.get?.('settings') ?? {})

  ctx.effect?.(() => () => {
    disposeHostedTool?.()
    disposeAlphaTool?.()
    disposeHostedPrompt?.()
    disposeAlphaPrompt?.()
    sessionTracker.dispose()
    ctx.web.searchProviderId = originalSearchProvider
  }, 'lcx-codex: restore web provider selection')
  ctx.on('llm/stream', (options, next) => {
    if (checkpointReplayOptions.delete(options)) return next()
    if (!state.enabled || !state.remoteCompaction) return next()
    if (options.purpose === 'session-title') return next()
    const routeConfig = resolveResponsesRouteConfig(ctx, options, runtimeConfig)
    let portableCheckpoint
    try {
      portableCheckpoint = hasPortableCheckpoint(options.messages)
    } catch (error) {
      return guardedStream(() => { throw error }, options.signal)
    }
    if (portableCheckpoint) {
      if (!routeConfig) return guardedStream(() => { throw nativeRouteError(options) }, options.signal)
      if (options.purpose === 'compaction') {
        const factory = () => remoteCompactionStream(options, routeConfig, portableStore, ctx, sessionTracker)
        return guardedStream(factory, options.signal)
      }
      let replay
      try {
        replay = checkpointReplayRecord(options.messages, portableStore)
      } catch (error) {
        return guardedStream(() => { throw error }, options.signal)
      }
      const route = routeWithSessionAncestry(ctx, currentRoute(options, routeConfig))
      if (options.sessionId && replay?.record.routeFingerprint === routeFingerprint(route)) {
        return guardedStream(
          () => nativeCheckpointReplayStream(options, routeConfig, portableStore, ctx, replay.record, replay.marker),
          options.signal,
        )
      }
      const llm = ctx?.llm ?? ctx?.get?.('llm')
      if (!llm || typeof llm.stream !== 'function') {
        return guardedStream(() => { throw checkpointReplayUnavailableError() }, options.signal)
      }
      return guardedStream(async function* () {
        const markerTail = replay?.marker ? options.messages.slice(replay.marker.index + 1) : []
        const needsImageCapability = Number(replay?.record.portableImageCount ?? 0) > 0 || dshMessagesContainImage(markerTail)
        const imageSupport = needsImageCapability
          ? await resolveModelImageSupport(llm, route, options.signal)
          : 'unknown'
        const rewrittenOptions = {
          ...options,
          messages: buildPortableReplayMessages(options.messages, portableStore, route, { imageSupport }),
        }
        checkpointReplayOptions.add(rewrittenOptions)
        const stream = await llm.stream(rewrittenOptions)
        for await (const chunk of stream) yield chunk
      }, options.signal)
    }
    if (options.purpose === 'compaction') {
      if (!routeConfig) return next()
      const factory = () => remoteCompactionStream(options, routeConfig, portableStore, ctx, sessionTracker)
      const diagnostic = (error, phase) => logCompactionDiagnostic(ctx, options, routeConfig, error, phase)
      return state.fallbackToBasicCompaction
        ? guardedStream(
          () => parallelCompactionStream(options, routeConfig, portableStore, ctx, sessionTracker, next, diagnostic),
          options.signal,
        )
        : guardedStream(factory, options.signal)
    }
    return next()
  }, { global: true, prepend: true })
}

export {
  Config,
  SettingsSchema,
  CheckpointV3Store,
  LcxResponsesSearchProvider,
  apply,
  baseURLFingerprint,
  buildPortableHistory,
  buildPortableReplayMessages,
  buildPortableResponsesInput,
  hasPortableCheckpoint,
  inject,
  name,
  normalizeConfig,
  normalizeCompactionResponse,
  normalizeHostedSearchArgs,
  normalizeAlphaSearchArgs,
  portableResponsesToMessages,
  routeFingerprint,
}
