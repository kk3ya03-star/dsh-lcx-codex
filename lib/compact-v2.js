import { consumeSse, fetchSseWithRetry } from './transport.js'
import { responsesTools } from './dsh-responses.js'

export const REMOTE_COMPACTION_V2_FEATURE = 'remote_compaction_v2'

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function fail(message, code = 'LCX_COMPACT_INVALID_RESPONSE') { const e = new Error(message); e.code = code; return e }
function safeMachineField(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 96) return undefined
  return /^[A-Za-z0-9_.:\[\]-]+$/u.test(value) ? value : undefined
}

export function mergeFeatureHeader(headers = {}) {
  const result = { ...headers }
  const key = Object.keys(result).find((name) => name.toLowerCase() === 'x-codex-beta-features')
  const values = String(key ? result[key] ?? '' : '').split(',').map((x) => x.trim()).filter(Boolean)
  if (!values.includes(REMOTE_COMPACTION_V2_FEATURE)) values.push(REMOTE_COMPACTION_V2_FEATURE)
  result[key ?? 'x-codex-beta-features'] = values.join(',')
  return result
}

export function responsesGenerationEnvelope({ reasoningEffort, temperature, maxTokens } = {}) {
  const result = {}
  if (reasoningEffort !== undefined && reasoningEffort !== 'off') {
    result.reasoning = { effort: String(reasoningEffort), summary: 'auto' }
    result.include = ['reasoning.encrypted_content']
  }
  if (temperature !== undefined) {
    if (!Number.isFinite(temperature)) throw fail('Responses temperature must be finite', 'LCX_COMPACT_INVALID_INPUT')
    result.temperature = Number(temperature)
  }
  if (maxTokens !== undefined) {
    if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw fail('Responses maxTokens must be a positive safe integer', 'LCX_COMPACT_INVALID_INPUT')
    result.max_output_tokens = Math.max(16, maxTokens)
  }
  return result
}

export function buildNativeCompactionBody({ model, input, instructions, tools, promptCacheKey, promptCacheRetention, reasoningEffort, temperature, maxTokens }) {
  if (!Array.isArray(input)) throw fail('native compaction input must be an array', 'LCX_COMPACT_INVALID_INPUT')
  if (input.some((item) => item?.type === 'compaction_trigger')) throw fail('native compaction input already contains compaction_trigger', 'LCX_COMPACT_DUPLICATE_TRIGGER')
  const nativeTools = responsesTools(tools)
  return {
    model,
    input: [...structuredClone(input), { type: 'compaction_trigger' }],
    stream: true,
    store: false,
    tool_choice: 'auto',
    parallel_tool_calls: true,
    ...(instructions !== undefined ? { instructions } : {}),
    ...(nativeTools !== undefined ? { tools: nativeTools } : {}),
    ...(promptCacheKey ? { prompt_cache_key: String(promptCacheKey) } : {}),
    ...(promptCacheRetention ? { prompt_cache_retention: String(promptCacheRetention) } : {}),
    ...responsesGenerationEnvelope({ reasoningEffort, temperature, maxTokens }),
  }
}

function usageFrom(raw) {
  if (!isObject(raw)) return undefined
  const inputTotal = Number(raw.input_tokens ?? 0)
  const output = Number(raw.output_tokens ?? 0)
  const details = raw.input_tokens_details ?? raw.input_token_details ?? raw.prompt_tokens_details ?? {}
  const cacheRead = Number(details.cached_tokens ?? 0)
  const cacheWrite = Number(details.cache_write_tokens ?? 0)
  const result = {
    inputTokens: Math.max(0, Number.isFinite(inputTotal) ? inputTotal - (Number.isFinite(cacheRead) ? cacheRead : 0) - (Number.isFinite(cacheWrite) ? cacheWrite : 0) : 0),
    outputTokens: Number.isFinite(output) && output > 0 ? output : 0,
  }
  if (Number.isFinite(cacheRead) && cacheRead > 0) result.cacheReadTokens = cacheRead
  if (Number.isFinite(cacheWrite) && cacheWrite > 0) result.cacheWriteTokens = cacheWrite
  const reasoning = Number(raw.output_tokens_details?.reasoning_tokens ?? raw.output_token_details?.reasoning_tokens ?? 0)
  if (Number.isFinite(reasoning) && reasoning > 0) result.reasoningTokens = reasoning
  return Object.values(result).some((v) => Number(v) > 0) ? result : undefined
}

function validateOutput(output) {
  if (!Array.isArray(output) || output.length === 0) throw fail('native compaction output is empty')
  const compactions = output.filter((item) => isObject(item) && item.type === 'compaction')
  if (compactions.length !== 1) throw fail(`native compaction must return exactly one compaction item, got ${compactions.length}`)
  const compact = compactions[0]
  if (typeof compact.encrypted_content !== 'string' || compact.encrypted_content.length === 0) throw fail('native compaction item has no encrypted_content')
  const calls = new Set()
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
  return { output: structuredClone(output), compaction: structuredClone(compact) }
}

export async function parseNativeCompactionSse(response, options = {}) {
  const byIndex = new Map()
  const byId = new Map()
  let terminal
  const mergeItem = (event) => {
    if (!isObject(event?.item)) return
    const index = Number.isInteger(event.output_index) ? event.output_index : undefined
    const id = typeof event.item.id === 'string' ? event.item.id : typeof event.item_id === 'string' ? event.item_id : undefined
    let record = (index !== undefined ? byIndex.get(index) : undefined) ?? (id ? byId.get(id) : undefined)
    if (!record) record = {}
    const encrypted = record.encrypted_content
    Object.assign(record, structuredClone(event.item))
    if (typeof record.encrypted_content !== 'string' && typeof encrypted === 'string') record.encrypted_content = encrypted
    if (index !== undefined) byIndex.set(index, record)
    if (id) byId.set(id, record)
  }
  await consumeSse(response, (event) => {
    if (!isObject(event)) return
    if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete') {
      const upstream = event.type === 'response.failed' ? event.response?.error : event.error
      const providerCode = safeMachineField(upstream?.code)
      const providerType = safeMachineField(upstream?.type)
      const providerParam = safeMachineField(upstream?.param)
      const diagnostics = [
        providerCode ? `providerCode=${providerCode}` : '',
        providerType ? `providerType=${providerType}` : '',
        providerParam ? `providerParam=${providerParam}` : '',
      ].filter(Boolean).join(' ')
      const e = fail(`native compaction ended with ${event.type}${diagnostics ? ` ${diagnostics}` : ''}`, 'LCX_COMPACT_UPSTREAM_ERROR')
      if (Number.isInteger(upstream?.status ?? event.error?.status)) e.status = upstream?.status ?? event.error?.status
      if (providerCode) e.providerCode = providerCode
      if (providerType) e.providerType = providerType
      if (providerParam) e.providerParam = providerParam
      throw e
    }
    if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') mergeItem(event)
    if (event.type === 'response.completed') terminal = event.response
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

export async function requestNativeCompaction({ baseURL, model, input, instructions, tools, promptCacheKey, promptCacheRetention, reasoningEffort, temperature, maxTokens, idempotencyKey, headers, signal, timeoutMs, maxAttempts, maxResponseBytes }) {
  const body = buildNativeCompactionBody({ model, input, instructions, tools, promptCacheKey, promptCacheRetention, reasoningEffort, temperature, maxTokens })
  const requestHeaders = mergeFeatureHeader({ ...headers, ...(idempotencyKey ? { 'idempotency-key': String(idempotencyKey) } : {}) })
  return fetchSseWithRetry(`${String(baseURL).replace(/\/+$/u, '')}/responses`, body, requestHeaders, signal, timeoutMs, {
    maxAttempts,
    maxResponseBytes,
    consume: (response, consumeOptions) => parseNativeCompactionSse(response, { signal: consumeOptions.requestSignal ?? signal, maxResponseBytes }),
  })
}
