// @ts-check

import { consumeSse, fetchSseWithRetry } from './transport.js'
import { buildCompactionResponsesBody, responsesGenerationEnvelope as standardGenerationEnvelope } from './responses-request.js'

/** @typedef {Record<string, unknown>} UnknownRecord */
/** @typedef {Record<string, string>} HeaderMap */
/** @typedef {Error & { code?: string, status?: number, providerCode?: string, providerType?: string, providerParam?: string }} LcxError */
/** @typedef {{ type: 'compaction', encrypted_content: string }} CompactionItem */
/** @typedef {{ type: 'function_call', call_id: string }} FunctionCallItem */
/** @typedef {{ type: 'function_call_output', call_id: string }} FunctionCallOutputItem */
/** @typedef {CompactionItem | FunctionCallItem | FunctionCallOutputItem | { type: string }} ValidatedOutputItem */
/** @typedef {{ inputTokens: number, outputTokens: number, cacheReadTokens?: number, cacheWriteTokens?: number, reasoningTokens?: number }} CanonicalUsage */
/** @typedef {{ reasoningEffort?: unknown, temperature?: unknown, maxTokens?: unknown }} GenerationControls */
/** @typedef {{ reasoning?: { effort: string, summary: 'auto' }, include?: string[], temperature?: number, max_output_tokens?: number }} GenerationEnvelope */
/**
 * @typedef {object} NativeCompactionBodyOptions
 * @property {string} model
 * @property {unknown} [modelDescriptor]
 * @property {unknown[]} input
 * @property {string} [instructions]
 * @property {unknown} [tools]
 * @property {string} [promptCacheKey]
 * @property {string} [promptCacheRetention]
 * @property {'none' | 'short' | 'long'} [cacheRetention]
 * @property {unknown} [reasoningEffort]
 * @property {unknown} [temperature]
 * @property {unknown} [maxTokens]
 */
/**
 * @typedef {object} NativeCompactionBody
 * @property {string} model
 * @property {unknown[]} input
 * @property {true} stream
 * @property {false} store
 * @property {'auto'} tool_choice
 * @property {true} parallel_tool_calls
 * @property {string} [instructions]
 * @property {unknown[]} [tools]
 * @property {string} [prompt_cache_key]
 * @property {string} [prompt_cache_retention]
 * @property {{ mode?: 'explicit', ttl?: '30m' }} [prompt_cache_options]
 * @property {{ effort: string, summary: 'auto' }} [reasoning]
 * @property {string[]} [include]
 * @property {number} [temperature]
 * @property {number} [max_output_tokens]
 */
/**
 * @typedef {NativeCompactionBodyOptions & {
 *   baseURL: string,
 *   idempotencyKey?: string,
 *   headers?: HeaderMap,
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 *   maxAttempts?: number,
 *   maxResponseBytes?: number
 * }} NativeCompactionRequestOptions
 */
/** @typedef {{ signal?: AbortSignal, maxResponseBytes?: number }} SseParseOptions */
/** @typedef {{ object: unknown, id?: string, output: ValidatedOutputItem[], compaction: CompactionItem, usage?: CanonicalUsage }} NativeCompactionResult */

export const REMOTE_COMPACTION_V2_FEATURE = 'remote_compaction_v2'

/**
 * @param {unknown} value
 * @returns {value is UnknownRecord}
 */
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
/**
 * @param {string} message
 * @param {string} [code]
 * @returns {LcxError}
 */
function fail(message, code = 'LCX_COMPACT_INVALID_RESPONSE') {
  /** @type {LcxError} */
  const e = new Error(message)
  e.code = code
  return e
}
/** @param {unknown} value */
function safeMachineField(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 96) return undefined
  return /^[A-Za-z0-9_.:\[\]-]+$/u.test(value) ? value : undefined
}

/**
 * @param {HeaderMap} [headers]
 * @returns {HeaderMap}
 */
export function mergeFeatureHeader(headers = {}) {
  const result = { ...headers }
  const key = Object.keys(result).find((name) => name.toLowerCase() === 'x-codex-beta-features')
  const values = String(key ? result[key] ?? '' : '').split(',').map((x) => x.trim()).filter(Boolean)
  if (!values.includes(REMOTE_COMPACTION_V2_FEATURE)) values.push(REMOTE_COMPACTION_V2_FEATURE)
  result[key ?? 'x-codex-beta-features'] = values.join(',')
  return result
}

/**
 * @param {GenerationControls} [controls]
 * @returns {GenerationEnvelope}
 */
export function responsesGenerationEnvelope(controls = {}) {
  return standardGenerationEnvelope(controls)
}

/**
 * @param {NativeCompactionBodyOptions} options
 * @returns {NativeCompactionBody}
 */
export function buildNativeCompactionBody({ model, modelDescriptor, input, instructions, tools, promptCacheKey, promptCacheRetention, cacheRetention, reasoningEffort, temperature, maxTokens }) {
  return /** @type {NativeCompactionBody} */ (/** @type {unknown} */ (buildCompactionResponsesBody({
    model: /** @type {any} */ (modelDescriptor ?? model),
    input,
    instructions,
    tools,
    promptCacheKey,
    promptCacheRetention,
    cacheRetention: cacheRetention ?? (promptCacheKey ? (promptCacheRetention ? 'long' : 'short') : 'none'),
    reasoningEffort,
    temperature,
    maxTokens,
  })))
}

/**
 * Provider usage stays unknown until the object guard and numeric normalization.
 * @param {unknown} raw
 * @returns {CanonicalUsage | undefined}
 */
function usageFrom(raw) {
  if (!isObject(raw)) return undefined
  const inputTotal = Number(raw.input_tokens ?? 0)
  const output = Number(raw.output_tokens ?? 0)
  const details = /** @type {UnknownRecord} */ (raw.input_tokens_details ?? raw.input_token_details ?? raw.prompt_tokens_details ?? {})
  const cacheRead = Number(details.cached_tokens ?? 0)
  const cacheWrite = Number(details.cache_write_tokens ?? 0)
  /** @type {CanonicalUsage} */
  const result = {
    inputTokens: Math.max(0, Number.isFinite(inputTotal) ? inputTotal - (Number.isFinite(cacheRead) ? cacheRead : 0) - (Number.isFinite(cacheWrite) ? cacheWrite : 0) : 0),
    outputTokens: Number.isFinite(output) && output > 0 ? output : 0,
  }
  if (Number.isFinite(cacheRead) && cacheRead > 0) result.cacheReadTokens = cacheRead
  if (Number.isFinite(cacheWrite) && cacheWrite > 0) result.cacheWriteTokens = cacheWrite
  const reasoning = Number(/** @type {UnknownRecord | undefined} */ (raw.output_tokens_details)?.reasoning_tokens ?? /** @type {UnknownRecord | undefined} */ (raw.output_token_details)?.reasoning_tokens ?? 0)
  if (Number.isFinite(reasoning) && reasoning > 0) result.reasoningTokens = reasoning
  return Object.values(result).some((v) => Number(v) > 0) ? result : undefined
}

/**
 * @param {unknown} output
 * @returns {{ output: ValidatedOutputItem[], compaction: CompactionItem }}
 */
function validateOutput(output) {
  if (!Array.isArray(output) || output.length === 0) throw fail('native compaction output is empty')
  const compactions = output.filter((item) => isObject(item) && item.type === 'compaction')
  if (compactions.length !== 1) throw fail(`native compaction must return exactly one compaction item, got ${compactions.length}`)
  const compact = compactions[0]
  if (typeof compact.encrypted_content !== 'string' || compact.encrypted_content.length === 0) throw fail('native compaction item has no encrypted_content')
  /** @type {Set<string>} */
  const calls = new Set()
  /** @type {Set<string>} */
  const results = new Set()
  for (const item of output) {
    if (!isObject(item) || typeof item.type !== 'string') throw fail('native compaction output contains a malformed item')
    if (item.type === 'function_call') {
      if (typeof item.call_id !== 'string' || !item.call_id || calls.has(item.call_id)) throw fail('native compaction output contains an invalid function_call')
      calls.add(item.call_id)
    } else if (item.type === 'function_call_output') {
      if (typeof item.call_id !== 'string' || !item.call_id || results.has(item.call_id)) throw fail('native compaction output contains an invalid function_call_output')
      results.add(item.call_id)
    }
  }
  for (const id of calls) if (!results.has(id)) throw fail(`native compaction output has orphan function_call ${id}`)
  for (const id of results) if (!calls.has(id)) throw fail(`native compaction output has orphan function_call_output ${id}`)
  return {
    output: /** @type {ValidatedOutputItem[]} */ (structuredClone(output)),
    compaction: /** @type {CompactionItem} */ (structuredClone(compact)),
  }
}

/**
 * Provider SSE events enter as unknown; response.completed remains authoritative.
 * @param {Response} response
 * @param {SseParseOptions} [options]
 * @returns {Promise<NativeCompactionResult>}
 */
export async function parseNativeCompactionSse(response, options = {}) {
  /** @type {Map<number, UnknownRecord>} */
  const byIndex = new Map()
  /** @type {Map<string, UnknownRecord>} */
  const byId = new Map()
  /** @type {UnknownRecord | undefined} */
  let terminal
  /** @param {UnknownRecord} event */
  const mergeItem = (event) => {
    if (!isObject(event?.item)) return
    const index = Number.isInteger(event.output_index) ? /** @type {number} */ (event.output_index) : undefined
    const id = typeof event.item.id === 'string' ? event.item.id : typeof event.item_id === 'string' ? event.item_id : undefined
    let record = (index !== undefined ? byIndex.get(index) : undefined) ?? (id ? byId.get(id) : undefined)
    if (!record) record = {}
    const encrypted = record.encrypted_content
    Object.assign(record, structuredClone(event.item))
    if (typeof record.encrypted_content !== 'string' && typeof encrypted === 'string') record.encrypted_content = encrypted
    if (index !== undefined) byIndex.set(index, record)
    if (id) byId.set(id, record)
  }
  await consumeSse(response, (/** @type {unknown} */ event) => {
    if (!isObject(event)) return
    if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete') {
      const upstream = event.type === 'response.failed' ? /** @type {{ error?: unknown } | undefined} */ (event.response)?.error : event.error
      const providerCode = safeMachineField(/** @type {UnknownRecord | undefined} */ (upstream)?.code)
      const providerType = safeMachineField(/** @type {UnknownRecord | undefined} */ (upstream)?.type)
      const providerParam = safeMachineField(/** @type {UnknownRecord | undefined} */ (upstream)?.param)
      const diagnostics = [
        providerCode ? `providerCode=${providerCode}` : '',
        providerType ? `providerType=${providerType}` : '',
        providerParam ? `providerParam=${providerParam}` : '',
      ].filter(Boolean).join(' ')
      /** @type {LcxError} */
      const e = fail(`native compaction ended with ${event.type}${diagnostics ? ` ${diagnostics}` : ''}`, 'LCX_COMPACT_UPSTREAM_ERROR')
      if (Number.isInteger(/** @type {UnknownRecord | undefined} */ (upstream)?.status ?? /** @type {UnknownRecord | undefined} */ (event.error)?.status)) e.status = /** @type {number} */ (/** @type {UnknownRecord | undefined} */ (upstream)?.status ?? /** @type {UnknownRecord | undefined} */ (event.error)?.status)
      if (providerCode) e.providerCode = providerCode
      if (providerType) e.providerType = providerType
      if (providerParam) e.providerParam = providerParam
      throw e
    }
    if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') mergeItem(event)
    if (event.type === 'response.completed') terminal = /** @type {UnknownRecord} */ (event.response)
  }, options)
  if (!isObject(terminal)) throw fail('native compaction stream ended without response.completed', 'LCX_COMPACT_INCOMPLETE_SSE')
  if (terminal.status !== 'completed') throw fail('native compaction response.completed did not carry completed status', 'LCX_COMPACT_INCOMPLETE_SSE')
  const eventItems = [...new Set([...byIndex.values(), ...byId.values()])]
  const output = Array.isArray(terminal.output) && terminal.output.length > 0 ? terminal.output : eventItems
  const normalized = validateOutput(output)
  return {
    object: terminal.object ?? 'response.compaction',
    ...(typeof terminal.id === 'string' ? { id: terminal.id } : {}),
    ...normalized,
    usage: usageFrom(terminal.usage),
  }
}

/**
 * @param {NativeCompactionRequestOptions} options
 */
export async function requestNativeCompaction({ baseURL, model, modelDescriptor, input, instructions, tools, promptCacheKey, promptCacheRetention, cacheRetention, reasoningEffort, temperature, maxTokens, idempotencyKey, headers, signal, timeoutMs, maxAttempts, maxResponseBytes }) {
  const body = buildNativeCompactionBody({ model, modelDescriptor, input, instructions, tools, promptCacheKey, promptCacheRetention, cacheRetention, reasoningEffort, temperature, maxTokens })
  const requestHeaders = mergeFeatureHeader({ ...headers, ...(idempotencyKey ? { 'idempotency-key': String(idempotencyKey) } : {}) })
  return fetchSseWithRetry(`${String(baseURL).replace(/\/+$/u, '')}/responses`, body, requestHeaders, signal, timeoutMs, {
    maxAttempts,
    maxResponseBytes,
    consume: (/** @type {Response} */ response, /** @type {{ requestSignal?: AbortSignal }} */ consumeOptions) => parseNativeCompactionSse(response, { signal: consumeOptions.requestSignal ?? signal, maxResponseBytes }),
  })
}
