// @ts-check

import { clampOpenAIPromptCacheKey } from '@earendil-works/pi-ai/api/openai-prompt-cache'
import { responsesTools } from './dsh-responses.js'

const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16

/** @typedef {'none' | 'short' | 'long'} CacheRetention */
/** @typedef {Record<string, unknown>} UnknownRecord */
/**
 * @typedef {object} ResponsesCompat
 * @property {boolean} [supportsLongCacheRetention]
 * @property {boolean} [supportsExplicitPromptCacheMode]
 */
/**
 * @typedef {object} PiResponsesModel
 * @property {string} id
 * @property {string} provider
 * @property {boolean} [reasoning]
 * @property {Record<string, string | null>} [thinkingLevelMap]
 * @property {ResponsesCompat} [compat]
 */
/**
 * @typedef {object} GenerationControls
 * @property {unknown} [reasoningEffort]
 * @property {unknown} [temperature]
 * @property {unknown} [maxTokens]
 */
/**
 * @typedef {object} BuildResponsesBodyOptions
 * @property {PiResponsesModel | string} model
 * @property {unknown[]} input
 * @property {string} [instructions]
 * @property {unknown} [tools]
 * @property {string} [sessionId]
 * @property {string} [promptCacheKey]
 * @property {string} [promptCacheRetention]
 * @property {CacheRetention} [cacheRetention]
 * @property {unknown} [reasoningEffort]
 * @property {unknown} [temperature]
 * @property {unknown} [maxTokens]
 * @property {UnknownRecord} [samplingParams]
 */

/** @param {unknown} value */
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }

/** @param {PiResponsesModel | string} model */
function modelId(model) { return typeof model === 'string' ? model : model.id }

/** @param {PiResponsesModel | string} model */
function modelRecord(model) {
  return typeof model === 'string'
    ? /** @type {PiResponsesModel} */ ({ id: model, provider: 'lcx', reasoning: true })
    : model
}

/** @param {unknown} value */
function normalizeCacheRetention(value) {
  return /** @type {CacheRetention} */ (['none', 'short', 'long'].includes(String(value)) ? value : 'short')
}

/**
 * Pi-parity generation controls for OpenAI Responses.
 * @param {GenerationControls & { model?: PiResponsesModel | string, includeDefaultReasoning?: boolean }} [controls]
 */
export function responsesGenerationEnvelope({ model = 'unknown', reasoningEffort, temperature, maxTokens, includeDefaultReasoning = false } = {}) {
  const descriptor = modelRecord(model)
  /** @type {UnknownRecord} */
  const result = {}
  if (descriptor.reasoning !== false) {
    if (reasoningEffort !== undefined && reasoningEffort !== 'off') {
      const requested = String(reasoningEffort)
      const wire = descriptor.thinkingLevelMap?.[requested] ?? requested
      if (wire !== null) {
        result.reasoning = { effort: wire, summary: 'auto' }
        result.include = ['reasoning.encrypted_content']
      }
    } else if (includeDefaultReasoning && descriptor.provider !== 'github-copilot' && descriptor.thinkingLevelMap?.off !== null) {
      result.reasoning = { effort: descriptor.thinkingLevelMap?.off ?? 'none' }
    }
  }
  if (temperature !== undefined) {
    if (!Number.isFinite(temperature)) throw Object.assign(new Error('Responses temperature must be finite'), { code: 'LCX_RESPONSES_INVALID_INPUT' })
    result.temperature = Number(temperature)
  }
  if (maxTokens !== undefined) {
    if (!Number.isSafeInteger(maxTokens) || Number(maxTokens) <= 0) throw Object.assign(new Error('Responses maxTokens must be a positive safe integer'), { code: 'LCX_RESPONSES_INVALID_INPUT' })
    result.max_output_tokens = Math.max(OPENAI_RESPONSES_MIN_OUTPUT_TOKENS, Number(maxTokens))
  }
  return result
}

/**
 * Build the shared LCX-owned request envelope while retaining Pi 0.84 Responses semantics.
 * Production LCX ordinary/compact/replay construction places the DSH system prompt in canonical input.
 * `instructions` remains accepted only for the exported low-level helper's backward-compatible callers.
 * @param {BuildResponsesBodyOptions} options
 */
export function buildResponsesBody({ model, input, instructions, tools, sessionId, promptCacheKey, promptCacheRetention, cacheRetention, reasoningEffort, temperature, maxTokens, samplingParams }) {
  if (!Array.isArray(input)) throw Object.assign(new Error('Responses input must be an array'), { code: 'LCX_RESPONSES_INVALID_INPUT' })
  const descriptor = modelRecord(model)
  const retention = normalizeCacheRetention(cacheRetention)
  const compat = descriptor.compat ?? {}
  const cacheKey = retention === 'none'
    ? undefined
    : promptCacheKey ?? clampOpenAIPromptCacheKey(sessionId)
  const longRetention = promptCacheRetention ?? (retention === 'long' && compat.supportsLongCacheRetention !== false ? '24h' : undefined)
  // Pi's flag is route/model proof that prompt_cache_options is accepted; no mode keeps implicit caching.
  const currentCache = retention === 'short' && compat.supportsExplicitPromptCacheMode === true
  const explicitCache = retention === 'none' && compat.supportsExplicitPromptCacheMode === true
  const promptCacheOptions = currentCache ? { ttl: '30m' } : explicitCache ? { mode: 'explicit' } : undefined
  const nativeTools = responsesTools(tools)
  /** @type {UnknownRecord} */
  const body = {
    model: modelId(model),
    input: structuredClone(input),
    stream: true,
    store: false,
    ...(instructions === undefined ? {} : { instructions }),
    ...(nativeTools !== undefined && nativeTools.length > 0 ? { tools: nativeTools } : {}),
    ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
    ...(longRetention ? { prompt_cache_retention: longRetention } : {}),
    ...(promptCacheOptions ? { prompt_cache_options: promptCacheOptions } : {}),
    ...responsesGenerationEnvelope({ model: descriptor, reasoningEffort, temperature, maxTokens, includeDefaultReasoning: true }),
  }
  if (isObject(samplingParams)) Object.assign(body, structuredClone(samplingParams))
  return body
}

/**
 * Compact is the standard request plus the one opaque-history transition patch.
 * @param {BuildResponsesBodyOptions} options
 */
export function buildCompactionResponsesBody(options) {
  const body = /** @type {UnknownRecord & { input: unknown[] }} */ (buildResponsesBody(options))
  if (body.input.some((item) => /** @type {UnknownRecord | undefined} */ (item)?.type === 'compaction_trigger')) {
    throw Object.assign(new Error('native compaction input already contains compaction_trigger'), { code: 'LCX_COMPACT_DUPLICATE_TRIGGER' })
  }
  body.input = [...body.input, { type: 'compaction_trigger' }]
  // Remote Compaction V2 has historically required these explicit controls.
  body.tool_choice = 'auto'
  body.parallel_tool_calls = true
  return body
}
