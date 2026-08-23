import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { symbols as cordisSymbols } from '@deepseek-ai/cordis'
import { fetchJsonWithRetry } from './transport.js'
import {
  authenticatedHeaders,
  currentRoute,
  generationControlsFromHeader,
  generationControlsFromSession,
  promptCacheKey,
  promptCacheRetention,
  promptCacheSessionId,
  resolveResponsesRouteConfig,
  routeFingerprint,
  updateRequestHeaderCache,
} from './route.js'
import {
  DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  hydrateNativeImageReferences,
  resolveModelImageSupport,
  serializeDshMessages,
} from './dsh-responses.js'
import { requestNativeCompaction } from './compact-v2.js'
import { requestNativeReplay } from './responses-replay.js'
import {
  checkpointStateForMessage,
  compactCheckpointId,
  createNativeCheckpointBlock,
  legacyCheckpointId,
  nativeCheckpointChunks,
  portableMessagesForCheckpoint,
  retainedConversationInput,
  shadowedMessagesForCheckpoint,
  rewriteCheckpointsPortable,
  stateRouteCompatible,
} from './native-checkpoint.js'
import { legacyRouteCompatible, legacyV3Id, loadLegacyRecord } from './legacy-v3.js'
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
import { ServiceMutex } from './service-mutex.js'

export const name = 'lcx-codex'
export const inject = ['llm', 'web', 'sessions']
const SETTINGS_NS = settingsNamespace('lcx-codex')
const ADVANCED_HOSTED_TOOL = 'websearch_gpt_advanced'
const ALPHA_TOOL = 'websearch_alpha'
const COMPACTION_DIRECTIVE = 'You are now acting as a compaction engine'
const bypassReplayOptions = new WeakSet()
const hostedSearchRouteContext = new AsyncLocalStorage()

function dshHome() { return process.env.DSH_HOME ?? join(homedir(), '.dsh') }
function defaultLegacyCheckpointPath() { return join(dshHome(), 'storages', 'lcx-codex', 'checkpoints-v3.json') }
function defaultAlphaCapabilityPath() { return join(dshHome(), 'storages', 'lcx-codex', 'web-alpha-capabilities.json') }
function defaultAlphaRefPath() { return join(dshHome(), 'storages', 'lcx-codex', 'web-alpha-refs.json') }

export const Config = z.object({
  provider: z.string().default('lcx'),
  baseURL: z.string().default('https://api.lcxbot.com/v1'),
  apiKeyEnv: z.string().default('LCX_API_KEY'),
  model: z.string().default('gpt-5.6-sol'),
  legacyCheckpointPath: z.string().default(''),
  checkpointPath: z.string().default(''),
  alphaCapabilityPath: z.string().default(''),
  alphaRefPath: z.string().default(''),
  alphaProfile: z.string().default(''),
  alphaGroup: z.string().default(''),
  alphaMaxOutputTokens: z.number().default(2500),
  webSearchProvider: z.string().default('lcx-responses'),
  webMaxResults: z.number().default(8),
  timeoutMs: z.number().default(300000),
  maxResponseBytes: z.number().default(8 * 1024 * 1024),
  maxAttempts: z.number().default(3),
  maxRequestImageBytes: z.number().default(DEFAULT_MAX_REQUEST_IMAGE_BYTES),
  requestImagePixelBudget: z.number().default(DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET),
  requestImageMaxBytes: z.number().default(DEFAULT_REQUEST_IMAGE_MAX_BYTES),
  portableReplayMaxChars: z.number().default(80_000),
  nativeRetentionTokenBudget: z.number().default(64_000),
  assistantRetentionTokenReserve: z.number().default(24_000),
  assistantRetentionPerMessageTokenCap: z.number().default(3_000),
  webSearchTimeoutMs: z.number().default(240_000),
  autoCompactionThresholdPercent: z.number().default(90),
  emergencyPruneThresholdPercent: z.number().default(95),
})

const SettingsSchema = z.object({
  enabled: z.boolean().default(false),
  webSearch: z.boolean().default(false),
  advancedHostedSearch: z.boolean().default(false),
  alphaSearch: z.boolean().default(false),
  remoteCompaction: z.boolean().default(false),
  fallbackToBasicCompaction: z.boolean().default(true),
  autoCompaction: z.boolean().default(true),
  webSearchTimeoutSeconds: z.number().default(240),
  autoCompactionThresholdPercent: z.number().default(90),
  emergencyPruneThresholdPercent: z.number().default(95),
  provider: z.string().default('lcx'),
  baseURL: z.string().default('https://api.lcxbot.com/v1'),
  apiKeyEnv: z.string().default('LCX_API_KEY'),
  model: z.string().default('gpt-5.6-sol'),
})

function normalizeConfig(input = {}) {
  const legacy = input.legacyCheckpointPath || input.checkpointPath || defaultLegacyCheckpointPath()
  return {
    provider: input.provider || 'lcx',
    baseURL: String(input.baseURL || 'https://api.lcxbot.com/v1').replace(/\/+$/u, ''),
    apiKeyEnv: input.apiKeyEnv || 'LCX_API_KEY',
    model: input.model || 'gpt-5.6-sol',
    headers: input.headers && typeof input.headers === 'object' ? { ...input.headers } : {},
    legacyCheckpointPath: legacy,
    alphaCapabilityPath: input.alphaCapabilityPath || defaultAlphaCapabilityPath(),
    alphaRefPath: input.alphaRefPath || defaultAlphaRefPath(),
    alphaProfile: String(input.alphaProfile ?? ''),
    alphaGroup: String(input.alphaGroup ?? ''),
    alphaMaxOutputTokens: Number.isInteger(input.alphaMaxOutputTokens) && input.alphaMaxOutputTokens > 0 ? Math.min(input.alphaMaxOutputTokens, 32_000) : 2500,
    webSearchProvider: input.webSearchProvider || 'lcx-responses',
    webMaxResults: Number.isInteger(input.webMaxResults) && input.webMaxResults > 0 ? input.webMaxResults : 8,
    timeoutMs: Number.isInteger(input.timeoutMs) && input.timeoutMs > 0 ? input.timeoutMs : 300000,
    maxResponseBytes: Number.isInteger(input.maxResponseBytes) && input.maxResponseBytes > 0 ? input.maxResponseBytes : 8 * 1024 * 1024,
    maxAttempts: Number.isInteger(input.maxAttempts) && input.maxAttempts > 0 ? Math.min(input.maxAttempts, 6) : 3,
    maxRequestImageBytes: Number.isSafeInteger(input.maxRequestImageBytes) && input.maxRequestImageBytes > 0 ? input.maxRequestImageBytes : DEFAULT_MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: Number.isSafeInteger(input.requestImagePixelBudget) && input.requestImagePixelBudget > 0 ? input.requestImagePixelBudget : DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: Number.isSafeInteger(input.requestImageMaxBytes) && input.requestImageMaxBytes > 0 ? input.requestImageMaxBytes : DEFAULT_REQUEST_IMAGE_MAX_BYTES,
    portableReplayMaxChars: Number.isSafeInteger(input.portableReplayMaxChars) && input.portableReplayMaxChars > 0 ? input.portableReplayMaxChars : 80_000,
    nativeRetentionTokenBudget: Number.isSafeInteger(input.nativeRetentionTokenBudget) && input.nativeRetentionTokenBudget > 0 ? input.nativeRetentionTokenBudget : 64_000,
    assistantRetentionTokenReserve: Number.isSafeInteger(input.assistantRetentionTokenReserve) && input.assistantRetentionTokenReserve >= 0 ? input.assistantRetentionTokenReserve : 24_000,
    assistantRetentionPerMessageTokenCap: Number.isSafeInteger(input.assistantRetentionPerMessageTokenCap) && input.assistantRetentionPerMessageTokenCap > 0 ? input.assistantRetentionPerMessageTokenCap : 3_000,
    webSearchTimeoutMs: Number.isSafeInteger(input.webSearchTimeoutMs) && input.webSearchTimeoutMs >= 30_000 ? Math.min(input.webSearchTimeoutMs, 600_000) : 240_000,
    autoCompactionThresholdPercent: Number.isFinite(input.autoCompactionThresholdPercent) ? Math.min(95, Math.max(85, Number(input.autoCompactionThresholdPercent))) : 90,
    emergencyPruneThresholdPercent: Number.isFinite(input.emergencyPruneThresholdPercent) ? Math.min(99, Math.max(90, Number(input.emergencyPruneThresholdPercent))) : 95,
  }
}

function webError(message, code, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause })
  error.name = 'WebError'; error.code = code; return error
}

function activeAgentRoute(exec, fallback) {
  const agent = exec?.agent
  const latest = agent?.session?.requestHeader?.()?.config
  return {
    provider: latest?.provider ?? agent?.options?.provider ?? fallback.provider,
    model: latest?.model ?? agent?.options?.model ?? fallback.model,
    sessionId: String(agent?.session?.id ?? ''),
  }
}

function sessionsService(ctx) { return ctx?.get?.('sessions') ?? ctx?.sessions }
function sessionFor(ctx, sessionId) { return sessionId ? sessionsService(ctx)?.get?.(sessionId) : undefined }

function requestImageOptions(routeConfig, imageSupport, signal, imageMap, extra = {}) {
  return {
    imageSupport, signal, imageMap,
    maxRequestImageBytes: routeConfig.maxRequestImageBytes,
    requestImagePixelBudget: routeConfig.requestImagePixelBudget,
    requestImageMaxBytes: routeConfig.requestImageMaxBytes,
    ...extra,
  }
}

function readWebSearchProvider(ctx) {
  try { return Reflect.get(ctx?.web, 'searchProviderId') } catch { return undefined }
}
function writeWebSearchProvider(ctx, providerId) {
  if (!ctx?.web) return false
  try {
    if (!Reflect.set(ctx.web, 'searchProviderId', providerId)) return false
    return Reflect.get(ctx.web, 'searchProviderId') === providerId
  } catch { return false }
}

async function executeHostedSearch(ctx, routeConfig, args, signal, sessionId = '') {
  const normalized = normalizeHostedSearchArgs(args)
  const requestId = randomUUID()
  const route = currentRoute({ provider: routeConfig.provider, model: routeConfig.model, sessionId }, routeConfig)
  const headers = await authenticatedHeaders(ctx, routeConfig, sessionId, requestId)
  const searchCacheKey = sessionId ? `dsh-lcx-search:${routeFingerprint(route)}` : undefined
  const body = buildHostedSearchBody(normalized, routeConfig.model, { promptCacheKey: searchCacheKey })
  const response = await fetchJsonWithRetry(`${routeConfig.baseURL}/responses`, body, headers, signal, routeConfig.timeoutMs, { maxAttempts: routeConfig.maxAttempts, maxResponseBytes: routeConfig.maxResponseBytes })
  return parseHostedSearchResponse(response, requestId, routeConfig.webMaxResults)
}

class LcxResponsesSearchProvider {
  constructor(ctx, getConfig, enabled) { this.ctx = ctx; this.getConfig = getConfig; this.enabled = enabled; this.id = getConfig().webSearchProvider }
  available() {
    const config = this.getConfig()
    const route = resolveResponsesRouteConfig(this.ctx, { provider: config.provider, model: config.model }, config)
    return this.enabled() && Boolean(route)
  }
  async search(request, signal) {
    const config = this.getConfig()
    const active = hostedSearchRouteContext.getStore()
    const requested = active ?? { provider: config.provider, model: config.model, sessionId: '' }
    let route = resolveResponsesRouteConfig(this.ctx, requested, config)
    let source = active ? 'active-agent' : 'fallback'
    if (!route && active) {
      route = resolveResponsesRouteConfig(this.ctx, { provider: config.provider, model: config.model }, config)
      source = 'fallback'
    }
    if (!route) throw webError('LCX Hosted Search requires a configured GPT openai-responses route', 'LCX_WEB_ROUTE_UNAVAILABLE')
    const sessionId = String((source === 'active-agent' ? active?.sessionId : '') ?? '')
    this.ctx.logger?.info?.(`[lcx-codex] web_search route: ${route.provider}/${route.model} (${source})`)
    const result = await executeHostedSearch(this.ctx, route, { query: request.query }, signal, sessionId)
    const max = Number.isInteger(request.maxResults) && request.maxResults > 0 ? request.maxResults : route.webMaxResults
    return { content: result.content || undefined, sources: result.sources.slice(0, max), truncated: result.truncated || result.sources.length > max }
  }
}

function createAdvancedHostedTool(ctx, state, getConfig) {
  return {
    name: ADVANCED_HOSTED_TOOL,
    description: 'Advanced GPT Responses Hosted Search. Use DSH web_search for ordinary lookup. Call this only when you need domain allow/block filters, approximate user location, search-context size, image search, external-web-access or return-token-budget controls. It is one-shot and has no open/find/click state.',
    parameters: HOSTED_SEARCH_PARAMETERS,
    output: { schema: HOSTED_SEARCH_OUTPUT, render: (_args, value) => renderHostedSearchResult(value) },
    async execute(args, exec) {
      if (!state.enabled || !state.webSearch || !state.advancedHostedSearch) throw webError(`${ADVANCED_HOSTED_TOOL} is disabled`, 'LCX_WEB_DISABLED')
      const config = getConfig(); const active = activeAgentRoute(exec, config)
      const route = resolveResponsesRouteConfig(ctx, active, config)
      if (!route) throw webError('Advanced Hosted Search requires the active GPT openai-responses route', 'LCX_WEB_ROUTE_UNAVAILABLE')
      return executeHostedSearch(ctx, route, args, exec?.signal, active.sessionId)
    },
  }
}

function alphaCapabilityFor(config, store) {
  const fingerprint = alphaCapabilityFingerprint({ baseURL: config.baseURL, provider: config.provider, model: config.model, profile: config.alphaProfile, group: config.alphaGroup, schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT })
  return { fingerprint, record: store.get(fingerprint) }
}

async function executeAlpha(ctx, routeConfig, capability, refStore, args, exec) {
  const normalized = normalizeAlphaSearchArgs(args)
  const sessionId = String(exec?.agent?.session?.id ?? '')
  if (!sessionId) throw webError('Alpha Search requires a DSH session', 'LCX_ALPHA_SESSION_REQUIRED')
  const routeFp = routeFingerprint({ provider: routeConfig.provider, model: routeConfig.model, baseURL: routeConfig.baseURL, sessionId })
  if (['open','find','click','screenshot'].includes(normalized.action)) refStore.assertUsable(sessionId, routeFp, normalized.refId)
  const requestId = randomUUID(); const headers = await authenticatedHeaders(ctx, routeConfig, sessionId, requestId)
  let response
  try {
    response = await fetchJsonWithRetry(`${routeConfig.baseURL}/alpha/search`, buildAlphaSearchBody(normalized, routeConfig.model, sessionId, true, routeConfig.alphaMaxOutputTokens), headers, exec?.signal, routeConfig.timeoutMs, { maxAttempts: routeConfig.maxAttempts, maxResponseBytes: routeConfig.maxResponseBytes })
  } catch (error) {
    if ([404,405].includes(error?.status) || /channel does not support/iu.test(String(error?.message ?? ''))) throw webError('Alpha Search is not supported by this route', 'LCX_ALPHA_UNAVAILABLE', error)
    throw webError('Alpha Search provider request failed', 'LCX_ALPHA_PROVIDER_ERROR', error)
  }
  const result = parseAlphaSearchResponse(response, { action: normalized.action, capability: capability.classification, requestId })
  refStore.record(sessionId, routeFp, result.refRecords ?? result.refs.map((refId) => ({ refId })))
  delete result.refRecords
  return result
}

function createAlphaTool(ctx, state, getConfig, capabilityStore, refStore) {
  return {
    name: ALPHA_TOOL,
    description: 'Stateful Codex/Alpha web command tool. Use it for search/open/find/click/PDF screenshot and the structured image/finance/weather/sports/time actions. Use DSH web_search for ordinary search, and websearch_gpt_advanced only for Hosted Search controls.',
    parameters: ALPHA_SEARCH_PARAMETERS,
    output: { schema: ALPHA_SEARCH_OUTPUT, render: (_args, value) => renderAlphaSearchResult(value) },
    async execute(args, exec) {
      if (!state.enabled || !state.alphaSearch) throw webError(`${ALPHA_TOOL} is disabled`, 'LCX_ALPHA_DISABLED')
      const config = getConfig(); const active = activeAgentRoute(exec, config); const route = resolveResponsesRouteConfig(ctx, active, config)
      if (!route) throw webError('Alpha Search requires the active GPT openai-responses route', 'LCX_ALPHA_ROUTE_UNAVAILABLE')
      const fingerprint = alphaCapabilityFingerprint({ baseURL: route.baseURL, provider: route.provider, model: route.model, profile: route.alphaProfile, group: route.alphaGroup, schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT })
      const capability = capabilityStore.get(fingerprint)
      if (!alphaCapabilityUsable(capability) || capability?.schemaFingerprint !== ALPHA_SCHEMA_FINGERPRINT) throw webError('Alpha Search capability has not been verified for this exact route/schema', 'LCX_ALPHA_CAPABILITY_UNVERIFIED')
      return executeAlpha(ctx, route, capability, refStore, args, exec)
    },
  }
}

function isDshCompactionDirective(message) {
  if (message?.role !== 'user') return false
  if (message?.source?.kind === 'plugin' && message?.source?.plugin === 'dsh-compaction-basic') return true
  const text = (message?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('')
  return text.includes(COMPACTION_DIRECTIVE)
}
function stripCompactionDirective(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return []
  return isDshCompactionDirective(messages.at(-1)) ? messages.slice(0, -1) : messages
}

function mergeMap(target, source) { for (const [key, value] of source ?? []) target.set(key, value) }

async function serializeNativeAware(messages, route, routeConfig, ctx, options = {}) {
  const session = sessionFor(ctx, route.sessionId)
  const imageSupport = await resolveModelImageSupport(ctx, route, options.signal)
  const input = []; const imageMap = new Map(); let nativeTools
  let normal = []
  const serializeOptions = (imageMapOverride, extra = {}) => requestImageOptions(routeConfig, imageSupport, options.signal, imageMapOverride, { route, tools: options.tools, responsesCompat: routeConfig.responsesCompat, ...extra })
  const prelude = await serializeDshMessages([], ctx, serializeOptions(undefined, { systemPrompt: options.system, includeSystemPrompt: true }))
  input.push(...prelude.input); nativeTools = prelude.tools
  const flush = async () => {
    if (!normal.length) return
    const serialized = await serializeDshMessages(normal, ctx, serializeOptions())
    nativeTools = serialized.tools ?? nativeTools
    input.push(...serialized.input); mergeMap(imageMap, serialized.imageMap); normal = []
  }
  for (const message of messages ?? []) {
    const state = session ? checkpointStateForMessage(session, message) : undefined
    if (state) {
      await flush()
      if (stateRouteCompatible(state, route, ctx)) {
        let nativeOutput = state.nativeOutput
        if (state.version === 4) {
          const checkpointId = compactCheckpointId(message)
          const shadowed = shadowedMessagesForCheckpoint(session, checkpointId)
          if (shadowed.length > 0) {
            const serializedShadowed = await serializeDshMessages(shadowed, ctx, serializeOptions())
            const repairedRetained = retainedConversationInput(serializedShadowed.input, {
              tokenBudget: routeConfig.nativeRetentionTokenBudget,
              assistantTokenReserve: routeConfig.assistantRetentionTokenReserve,
              assistantPerMessageTokenCap: routeConfig.assistantRetentionPerMessageTokenCap,
            })
            const opaque = state.nativeCompaction ?? nativeOutput.find((item) => item?.type === 'compaction')
            if (repairedRetained.length > 0 && opaque) {
              nativeOutput = [...repairedRetained, structuredClone(opaque)]
              mergeMap(imageMap, serializedShadowed.imageMap)
            } else if (state.retainedInputCount === undefined) {
              const portable = portableMessagesForCheckpoint(session, checkpointId, { maxChars: routeConfig.portableReplayMaxChars })
              const serializedPortable = await serializeDshMessages(portable, ctx, serializeOptions())
              input.push(...serializedPortable.input); mergeMap(imageMap, serializedPortable.imageMap)
              continue
            }
          } else if (state.retainedInputCount === undefined) {
            const portable = portableMessagesForCheckpoint(session, checkpointId, { maxChars: routeConfig.portableReplayMaxChars })
            const serializedPortable = await serializeDshMessages(portable, ctx, serializeOptions())
            input.push(...serializedPortable.input); mergeMap(imageMap, serializedPortable.imageMap)
            continue
          }
        }
        const hydratedMap = new Map()
        const hydrated = await hydrateNativeImageReferences(nativeOutput, ctx, requestImageOptions(routeConfig, imageSupport, options.signal, hydratedMap))
        input.push(...hydrated); mergeMap(imageMap, hydratedMap)
      } else {
        const portable = portableMessagesForCheckpoint(session, compactCheckpointId(message), { maxChars: routeConfig.portableReplayMaxChars })
        const serialized = await serializeDshMessages(portable, ctx, serializeOptions())
        input.push(...serialized.input); mergeMap(imageMap, serialized.imageMap)
      }
      continue
    }
    const legacyId = legacyV3Id(message)
    if (legacyId) {
      const legacy = loadLegacyRecord(routeConfig.legacyCheckpointPath, legacyId)
      if (legacy) {
        await flush()
        const legacyItems = legacyRouteCompatible(legacy, route, ctx) ? legacy.nativeOutput : (legacy.portableHistory ?? [])
        const hydratedMap = new Map()
        const hydrated = await hydrateNativeImageReferences(legacyItems, ctx, requestImageOptions(routeConfig, imageSupport, options.signal, hydratedMap))
        input.push(...hydrated); mergeMap(imageMap, hydratedMap)
        continue
      }
    }
    normal.push(message)
  }
  await flush()
  return { input, imageMap, imageSupport, tools: nativeTools }
}

function fallbackEligible(error, signal) {
  if (signal?.aborted) return false
  if (error?.name === 'AbortError' || error?.code === 'LCX_ABORTED') return false
  if (error?.name === 'TimeoutError') return true
  return ['LCX_HTTP_RETRYABLE', 'LCX_RETRY_EXHAUSTED'].includes(error?.code)
}

async function* remoteCompactionStream(options, routeConfig, state, ctx, next, requestHeaders) {
  const history = stripCompactionDirective(options.messages)
  const route = currentRoute(options, routeConfig)
  try {
    const prepared = await serializeNativeAware(history, route, routeConfig, ctx, { signal: options.signal, system: options.system, tools: options.tools })
    const cacheSessionId = promptCacheSessionId(route, routeConfig)
    const headers = await authenticatedHeaders(ctx, routeConfig, cacheSessionId, cacheSessionId === undefined ? null : undefined)
    const cachedGeneration = generationControlsFromHeader(requestHeaders?.get(route.sessionId), route)
    const generation = Object.keys(cachedGeneration).length > 0 ? cachedGeneration : generationControlsFromSession(sessionFor(ctx, route.sessionId), route)
    const result = await requestNativeCompaction({
      baseURL: routeConfig.baseURL,
      model: route.model,
      input: prepared.input,
      tools: prepared.tools ?? options.tools,
      promptCacheKey: promptCacheKey(route, routeConfig),
      promptCacheRetention: promptCacheRetention(routeConfig),
      reasoningEffort: generation.reasoningEffort,
      temperature: generation.temperature,
      maxTokens: generation.maxTokens,
      idempotencyKey: randomUUID(),
      headers,
      signal: options.signal,
      timeoutMs: routeConfig.timeoutMs,
      maxAttempts: routeConfig.maxAttempts,
      maxResponseBytes: routeConfig.maxResponseBytes,
    })
    const session = sessionFor(ctx, route.sessionId)
    const block = createNativeCheckpointBlock({
      session, route, result, input: prepared.input, imageMap: prepared.imageMap,
      retentionOptions: {
        tokenBudget: routeConfig.nativeRetentionTokenBudget,
        assistantTokenReserve: routeConfig.assistantRetentionTokenReserve,
        assistantPerMessageTokenCap: routeConfig.assistantRetentionPerMessageTokenCap,
      },
    })
    ctx.logger?.info?.(`[lcx-codex] native V2 compaction succeeded; retained ${block.retainedClientCount ?? 0} client + ${block.retainedAssistantCount ?? 0} assistant-visible item(s) (~${block.retainedEstimatedTokens ?? 0} tokens) with the opaque checkpoint`)
    for (const chunk of nativeCheckpointChunks(block, result.usage)) yield chunk
  } catch (error) {
    const session = sessionFor(ctx, route.sessionId)
    const hasExistingCheckpoint = messagesContainNativeCheckpoint(history, session) || messagesContainLegacyCheckpoint(history)
    const code = error?.code ?? error?.name ?? 'ERROR'
    const status = Number.isInteger(error?.status) ? ` status=${error.status}` : ''
    const requestId = error?.requestId ? ` requestId=${String(error.requestId)}` : ''
    const providerCode = error?.providerCode ? ` providerCode=${error.providerCode}` : ''
    const providerType = error?.providerType ? ` providerType=${error.providerType}` : ''
    const providerParam = error?.providerParam ? ` providerParam=${error.providerParam}` : ''
    ctx.logger?.warn?.(`[lcx-codex] native V2 compaction failed: code=${code}${status}${requestId}${providerCode}${providerType}${providerParam}`)
    if (!state.fallbackToBasicCompaction || hasExistingCheckpoint || !fallbackEligible(error, options.signal)) throw error
    ctx.logger?.info?.('[lcx-codex] falling back to DSH basic compaction after allowlisted first-checkpoint native failure')
    const stream = await next()
    for await (const chunk of stream) yield chunk
  }
}

function routedTargetForAgent(agent, fallback) {
  const latest = agent?.session?.requestHeader?.()?.config
  const provider = latest?.provider ?? agent?.options?.provider ?? fallback.provider
  const model = latest?.model ?? agent?.options?.model ?? fallback.model
  return provider && model ? { provider, model } : undefined
}

function clampPercent(value, fallback, min, max) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function pressurePolicy(state, config) {
  const auto = clampPercent(state.autoCompactionThresholdPercent, config.autoCompactionThresholdPercent, 85, 95)
  const emergencyRaw = clampPercent(state.emergencyPruneThresholdPercent, config.emergencyPruneThresholdPercent, 90, 99)
  const emergency = Math.max(auto + 1, emergencyRaw)
  return { auto, emergency: Math.min(99, emergency) }
}

function adjustedCompactionConfig(config, target, thresholdRatio) {
  if (!config || typeof config !== 'object') return config
  const modelPolicies = Array.isArray(config.modelPolicies)
    ? config.modelPolicies.map((policy) => policy?.provider === target.provider && policy?.model === target.model ? { ...policy, thresholdRatio } : policy)
    : config.modelPolicies
  return { ...config, thresholdRatio, ...(modelPolicies === undefined ? {} : { modelPolicies }) }
}

function resolveContextService(ctx, name) {
  try { return ctx?.get?.(name) ?? ctx?.[name] } catch { return undefined }
}

function resolveScopedService(agent, name) { return resolveContextService(agent?.ctx, name) }

function resolveAgentService(ctx, agent, name) {
  const agentPresets = resolveContextService(ctx, 'agentPresets')
  try {
    const service = agentPresets?.serviceFor?.(agent, name)
    if (service !== undefined) return service
  } catch {}
  return resolveScopedService(agent, name)
}

function concreteService(value) {
  try { return value?.[cordisSymbols.original] ?? value } catch { return value }
}

function combinedAbortSignal(primary, lifecycle) {
  if (!primary) return lifecycle
  if (!lifecycle) return primary
  if (primary === lifecycle) return primary
  return AbortSignal.any([primary, lifecycle])
}

function patchCompactionPressureService(compactionValue, state, getConfig, ctx, records, requestHeaders) {
  const compaction = concreteService(compactionValue)
  if (!compaction || typeof compaction.compactIfNeeded !== 'function' || records.has(compaction)) return false
  const original = compaction.compactIfNeeded
  const record = { compaction, original, wrapper: undefined, mutex: new ServiceMutex(), lifecycle: new AbortController() }
  const wrapper = async function(agentArg, trigger, signal) {
    const activeSignal = combinedAbortSignal(signal, record.lifecycle.signal)
    const callOriginal = () => {
      updateRequestHeaderCache(requestHeaders, agentArg?.session, { type: 'compaction/start' })
      return original.call(this, agentArg, trigger, activeSignal)
    }
    return record.mutex.run(activeSignal, async () => {
      if (trigger !== 'pressure' || !state.enabled || !state.remoteCompaction || !state.autoCompaction) return callOriginal()
      const config = getConfig()
      const target = routedTargetForAgent(agentArg, config)
      if (!target || !resolveResponsesRouteConfig(ctx, target, config)) return callOriginal()
      const tokenMeter = resolveScopedService(agentArg, 'tokenMeter') ?? resolveContextService(this?.ctx, 'tokenMeter')
      const llm = resolveScopedService(agentArg, 'llm') ?? resolveContextService(ctx, 'llm')
      if (!tokenMeter?.measure || !llm?.resolveModelInfo) return callOriginal()
      let contextWindow
      try { contextWindow = (await llm.resolveModelInfo(target.provider, target.model, activeSignal))?.context?.contextWindow } catch { return callOriginal() }
      if (!Number.isFinite(contextWindow) || contextWindow <= 0) return callOriginal()
      const totalTokens = Number(tokenMeter.measure(agentArg.session)?.totalTokens ?? 0)
      const { auto, emergency } = pressurePolicy(state, config)
      const ratioPercent = totalTokens / contextWindow * 100
      if (ratioPercent < auto) return null
      const pruner = concreteService(resolveAgentService(ctx, agentArg, 'toolResultPruner') ?? resolveContextService(this?.ctx, 'toolResultPruner'))
      const originalPrune = pruner?.pruneSession
      const originalConfig = this?.config
      const nativeFirst = ratioPercent < emergency
      const noOpPrune = () => ({ pruned: [], charsRemoved: 0 })
      let installedConfig
      if (nativeFirst && pruner && typeof originalPrune === 'function') pruner.pruneSession = noOpPrune
      if (originalConfig && this && Object.prototype.hasOwnProperty.call(this, 'config')) {
        try { installedConfig = adjustedCompactionConfig(originalConfig, target, auto / 100); this.config = installedConfig } catch {}
      }
      ctx.logger?.info?.(`[lcx-codex] auto pressure ${ratioPercent.toFixed(1)}%: ${nativeFirst ? 'Native V2 first' : 'emergency DSH prune allowed'} (native ${auto}%, emergency ${emergency}%)`)
      try { return await callOriginal() }
      finally {
        if (installedConfig && this?.config === installedConfig) { try { this.config = originalConfig } catch {} }
        if (nativeFirst && pruner?.pruneSession === noOpPrune) { try { pruner.pruneSession = originalPrune } catch {} }
      }
    })
  }
  record.wrapper = wrapper
  try { compaction.compactIfNeeded = wrapper } catch { return false }
  records.set(compaction, record)
  return true
}

function patchCompactionPressureForAgent(agent, state, getConfig, ctx, records, requestHeaders) {
  return patchCompactionPressureService(resolveAgentService(ctx, agent, 'compaction'), state, getConfig, ctx, records, requestHeaders)
}

async function restoreCompactionPressure(records) {
  const reason = new Error('lcx-codex pressure coordination is shutting down')
  const entries = [...records.values()]
  for (const record of entries) {
    if (!record.lifecycle.signal.aborted) record.lifecycle.abort(reason)
  }
  await Promise.allSettled(entries.map((record) => record.mutex.close(reason)))
  for (const record of entries) if (record.compaction?.compactIfNeeded === record.wrapper) { try { record.compaction.compactIfNeeded = record.original } catch {} }
  records.clear()
}

function patchVisibleWebSearchTimeout(agent, state, getConfig, patchedDefinitions) {
  const tools = resolveScopedService(agent, 'tools')
  const definition = tools?.get?.('web_search', agent)
  if (!definition || typeof definition !== 'object') return
  if (!patchedDefinitions.has(definition)) patchedDefinitions.set(definition, definition.timeoutMs)
  const config = getConfig()
  const timeoutMs = Number.isFinite(state.webSearchTimeoutSeconds) ? Math.min(600_000, Math.max(30_000, Math.round(state.webSearchTimeoutSeconds * 1000))) : config.webSearchTimeoutMs
  try { definition.timeoutMs = state.enabled && state.webSearch ? timeoutMs : patchedDefinitions.get(definition) } catch {}
}

function refreshPatchedWebSearchTimeouts(state, getConfig, patchedDefinitions) {
  const config = getConfig()
  const timeoutMs = Number.isFinite(state.webSearchTimeoutSeconds) ? Math.min(600_000, Math.max(30_000, Math.round(state.webSearchTimeoutSeconds * 1000))) : config.webSearchTimeoutMs
  for (const [definition, original] of patchedDefinitions.entries()) { try { definition.timeoutMs = state.enabled && state.webSearch ? timeoutMs : original } catch {} }
}

function restoreWebSearchTimeouts(patchedDefinitions) {
  for (const [definition, original] of patchedDefinitions.entries()) { try { if (original === undefined) delete definition.timeoutMs; else definition.timeoutMs = original } catch {} }
  patchedDefinitions.clear()
}

function messagesContainNativeCheckpoint(messages, session) { return Boolean(session && (messages ?? []).some((message) => checkpointStateForMessage(session, message))) }
function messagesContainLegacyCheckpoint(messages) { return (messages ?? []).some((message) => Boolean(legacyCheckpointId(message))) }

async function* recursiveLlmStream(ctx, options, messages) {
  const llm = ctx?.get?.('llm') ?? ctx?.llm
  if (!llm?.stream) throw Object.assign(new Error('LCX portable replay requires ctx.llm.stream'), { code: 'LCX_CHECKPOINT_REPLAY_UNAVAILABLE' })
  const rewritten = { ...options, messages }
  bypassReplayOptions.add(rewritten)
  const stream = await llm.stream(rewritten)
  for await (const chunk of stream) yield chunk
}

async function* replayCheckpointStream(options, routeConfig, ctx) {
  const route = currentRoute(options, routeConfig)
  const session = sessionFor(ctx, route.sessionId)
  if (!session) throw Object.assign(new Error('Native checkpoint replay requires the live DSH session'), { code: 'LCX_SESSION_UNAVAILABLE' })
  const incompatibleV4 = (options.messages ?? []).some((message) => { const state = checkpointStateForMessage(session, message); return state && !stateRouteCompatible(state, route, ctx) })
  if (incompatibleV4) {
    const portable = rewriteCheckpointsPortable(options.messages, session, { maxChars: routeConfig.portableReplayMaxChars })
    yield* recursiveLlmStream(ctx, options, portable)
    return
  }
  const prepared = await serializeNativeAware(options.messages, route, routeConfig, ctx, { signal: options.signal, system: options.system, tools: options.tools })
  const cacheSessionId = promptCacheSessionId(route, routeConfig)
  const headers = await authenticatedHeaders(ctx, routeConfig, cacheSessionId, cacheSessionId === undefined ? null : undefined)
  yield* requestNativeReplay({ baseURL: routeConfig.baseURL, provider: route.provider, model: route.model, input: prepared.input, tools: prepared.tools ?? options.tools, promptCacheKey: promptCacheKey(route, routeConfig), promptCacheRetention: promptCacheRetention(routeConfig), reasoningEffort: options.reasoningEffort, temperature: options.temperature, maxTokens: options.maxTokens, headers, signal: options.signal, timeoutMs: routeConfig.timeoutMs, maxAttempts: routeConfig.maxAttempts, maxResponseBytes: routeConfig.maxResponseBytes })
}

function installInjected(ctx, configInput = {}) {
  const baseConfig = normalizeConfig(configInput)
  let runtimeConfig = baseConfig
  const state = { enabled: false, webSearch: false, advancedHostedSearch: false, alphaSearch: false, remoteCompaction: false, fallbackToBasicCompaction: true, autoCompaction: true, webSearchTimeoutSeconds: baseConfig.webSearchTimeoutMs / 1000, autoCompactionThresholdPercent: baseConfig.autoCompactionThresholdPercent, emergencyPruneThresholdPercent: baseConfig.emergencyPruneThresholdPercent }
  const originalSearchProvider = readWebSearchProvider(ctx)
  let warnedWebSelection = false
  const provider = new LcxResponsesSearchProvider(ctx, () => runtimeConfig, () => state.enabled && state.webSearch)
  ctx.web.registerSearchProvider(provider)
  const tools = ctx?.get?.('tools') ?? ctx?.tools
  let disposeAdvanced, disposeAlpha
  const capabilityStore = new AlphaCapabilityStore(baseConfig.alphaCapabilityPath)
  const refStore = new AlphaRefStore(baseConfig.alphaRefPath)
  const compactionPatchRecords = new Map()
  const patchedWebSearchDefinitions = new Map()
  const requestHeaders = new Map()
  const seedRequestHeader = (session) => updateRequestHeaderCache(requestHeaders, session, { type: 'compaction/start' })
  for (const session of sessionsService(ctx)?.list?.() ?? []) seedRequestHeader(session)
  ctx.on('session/created', (session) => {
    seedRequestHeader(session)
  }, { global: true })
  ctx.on('session/disposed', (session) => {
    requestHeaders.delete(String(session?.id ?? ''))
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    updateRequestHeaderCache(requestHeaders, session, event)
  }, { global: true })

  const refreshTools = () => {
    if (state.enabled && state.webSearch && state.advancedHostedSearch && !disposeAdvanced && tools?.register) disposeAdvanced = tools.register(createAdvancedHostedTool(ctx, state, () => runtimeConfig))
    if ((!state.enabled || !state.webSearch || !state.advancedHostedSearch) && disposeAdvanced) { disposeAdvanced(); disposeAdvanced = undefined }
    let alphaUsable = false
    if (state.enabled && state.alphaSearch) {
      try { const { record } = alphaCapabilityFor(runtimeConfig, capabilityStore); alphaUsable = alphaCapabilityUsable(record) && record?.schemaFingerprint === ALPHA_SCHEMA_FINGERPRINT } catch (error) { ctx.logger?.warn?.(`[lcx-codex] Alpha capability store unavailable: ${error?.message ?? error}`) }
    }
    if (alphaUsable && !disposeAlpha && tools?.register) disposeAlpha = tools.register(createAlphaTool(ctx, state, () => runtimeConfig, capabilityStore, refStore))
    if (!alphaUsable && disposeAlpha) { disposeAlpha(); disposeAlpha = undefined }
    if (ctx.web) {
      const target = state.enabled && state.webSearch ? runtimeConfig.webSearchProvider : originalSearchProvider
      const selected = writeWebSearchProvider(ctx, target)
      if (!selected && state.enabled && state.webSearch && !warnedWebSelection) {
        warnedWebSelection = true
        ctx.logger?.warn?.('[lcx-codex] DSH web provider selection could not be changed at runtime; websearch_gpt_advanced still works, but DSH web_search may remain on its configured provider. Pin web.searchProvider=lcx-responses in a profile overlay if this DSH version removes the runtime compatibility field.')
      }
    }
  }

  let source = () => ({ ...baseConfig, ...state })
  installSettingsSection(ctx, SETTINGS_NS, SettingsSchema, {
    enabled: false, webSearch: false, advancedHostedSearch: false, alphaSearch: false, remoteCompaction: false, fallbackToBasicCompaction: true, autoCompaction: true,
    webSearchTimeoutSeconds: baseConfig.webSearchTimeoutMs / 1000,
    autoCompactionThresholdPercent: baseConfig.autoCompactionThresholdPercent,
    emergencyPruneThresholdPercent: baseConfig.emergencyPruneThresholdPercent,
    provider: baseConfig.provider, baseURL: baseConfig.baseURL, apiKeyEnv: baseConfig.apiKeyEnv, model: baseConfig.model,
  }, {
    setSource: (current) => { source = current },
    onChange: () => {
      const value = source()
      state.enabled = Boolean(value.enabled); state.webSearch = Boolean(value.webSearch); state.advancedHostedSearch = Boolean(value.advancedHostedSearch); state.alphaSearch = Boolean(value.alphaSearch); state.remoteCompaction = Boolean(value.remoteCompaction)
      state.fallbackToBasicCompaction = value.fallbackToBasicCompaction !== false; state.autoCompaction = value.autoCompaction !== false
      state.webSearchTimeoutSeconds = Number.isFinite(value.webSearchTimeoutSeconds) ? value.webSearchTimeoutSeconds : baseConfig.webSearchTimeoutMs / 1000
      state.autoCompactionThresholdPercent = clampPercent(value.autoCompactionThresholdPercent, baseConfig.autoCompactionThresholdPercent, 85, 95)
      state.emergencyPruneThresholdPercent = clampPercent(value.emergencyPruneThresholdPercent, baseConfig.emergencyPruneThresholdPercent, 90, 99)
      runtimeConfig = normalizeConfig({ ...baseConfig, provider: value.provider ?? baseConfig.provider, baseURL: value.baseURL ?? baseConfig.baseURL, apiKeyEnv: value.apiKeyEnv ?? baseConfig.apiKeyEnv, model: value.model ?? baseConfig.model })
      refreshTools(); refreshPatchedWebSearchTimeouts(state, () => runtimeConfig, patchedWebSearchDefinitions)
    },
  })
  try {
    const value = source()
    Object.assign(state, { enabled: Boolean(value.enabled), webSearch: Boolean(value.webSearch), advancedHostedSearch: Boolean(value.advancedHostedSearch), alphaSearch: Boolean(value.alphaSearch), remoteCompaction: Boolean(value.remoteCompaction), fallbackToBasicCompaction: value.fallbackToBasicCompaction !== false, autoCompaction: value.autoCompaction !== false, webSearchTimeoutSeconds: Number.isFinite(value.webSearchTimeoutSeconds) ? value.webSearchTimeoutSeconds : baseConfig.webSearchTimeoutMs / 1000, autoCompactionThresholdPercent: clampPercent(value.autoCompactionThresholdPercent, baseConfig.autoCompactionThresholdPercent, 85, 95), emergencyPruneThresholdPercent: clampPercent(value.emergencyPruneThresholdPercent, baseConfig.emergencyPruneThresholdPercent, 90, 99) })
    runtimeConfig = normalizeConfig({ ...baseConfig, provider: value.provider ?? baseConfig.provider, baseURL: value.baseURL ?? baseConfig.baseURL, apiKeyEnv: value.apiKeyEnv ?? baseConfig.apiKeyEnv, model: value.model ?? baseConfig.model })
  } catch {}
  refreshTools()
  ctx.inject(['compaction'], compactionCtx => {
    patchCompactionPressureService(resolveContextService(compactionCtx, 'compaction'), state, () => runtimeConfig, ctx, compactionPatchRecords, requestHeaders)
  })

  ctx.on('tools/execute', async (exec, next) => {
    if (!state.enabled || !state.webSearch || exec?.name !== 'web_search') return next()
    const active = activeAgentRoute(exec, runtimeConfig)
    return hostedSearchRouteContext.run(active, () => next())
  })

  ctx.on('agent/created', ({ agent }) => {
    if (!agent) return
    const installed = patchCompactionPressureForAgent(agent, state, () => runtimeConfig, ctx, compactionPatchRecords, requestHeaders)
    if (installed) ctx.logger?.info?.('[lcx-codex] pressure coordination installed through AgentPresets service resolver')
  }, { global: true })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'running' || !agent) return
    const installed = patchCompactionPressureForAgent(agent, state, () => runtimeConfig, ctx, compactionPatchRecords, requestHeaders)
    if (installed) ctx.logger?.info?.('[lcx-codex] pressure coordination installed through AgentPresets service resolver')
    patchVisibleWebSearchTimeout(agent, state, () => runtimeConfig, patchedWebSearchDefinitions)
  }, { global: true })

  ctx.on('llm/stream', (options, next) => {
    if (bypassReplayOptions.delete(options)) return next()
    if (!state.enabled || !state.remoteCompaction || options.purpose === 'session-title') return next()
    const routeConfig = resolveResponsesRouteConfig(ctx, options, runtimeConfig)
    if (options.purpose === 'compaction') {
      if (!routeConfig) return next()
      return remoteCompactionStream(options, routeConfig, state, ctx, next, requestHeaders)
    }
    const session = sessionFor(ctx, String(options.sessionId ?? ''))
    const hasNative = messagesContainNativeCheckpoint(options.messages, session)
    const hasLegacy = messagesContainLegacyCheckpoint(options.messages)
    if (!hasNative && !hasLegacy) return next()
    if (!routeConfig) {
      if (hasNative && session) return recursiveLlmStream(ctx, options, rewriteCheckpointsPortable(options.messages, session, { maxChars: runtimeConfig.portableReplayMaxChars }))
      return next()
    }
    return replayCheckpointStream(options, routeConfig, ctx)
  })

  ctx.effect?.(() => async () => {
    disposeAdvanced?.(); disposeAlpha?.()
    await restoreCompactionPressure(compactionPatchRecords)
    restoreWebSearchTimeouts(patchedWebSearchDefinitions)
    writeWebSearchProvider(ctx, originalSearchProvider)
    requestHeaders.clear()
  }, 'lcx-codex cleanup')
}

export function apply(ctx, configInput = {}) {
  return ctx.inject(['llm', 'web', 'sessions'], injectedCtx => installInjected(injectedCtx, configInput))
}

apply.inject = inject
apply.Config = Config

export default apply
