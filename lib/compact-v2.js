import { normalizeCompactionResponse } from './compact.js'
import { fetchSseWithRetry } from './transport.js'

const REMOTE_COMPACTION_V2_FEATURE = 'remote_compaction_v2'
const DEFAULT_MAX_SSE_BYTES = 8 * 1024 * 1024

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function protocolError(message, code = 'LCX_COMPACT_INVALID_SSE') {
  const error = new Error(message)
  error.code = code
  return error
}

function outputItemIdentity(event) {
  const outputIndex = Number.isInteger(event?.output_index) && event.output_index >= 0
    ? `index:${event.output_index}`
    : undefined
  const itemIds = [event?.item?.id, event?.item_id]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .map((value) => `id:${value}`)
  const uniqueItemIds = [...new Set(itemIds)]
  if (uniqueItemIds.length > 1) {
    throw protocolError('Native compaction SSE event contains conflicting item identities')
  }
  return { outputIndex, itemId: uniqueItemIds[0] }
}

function mergeOutputItem(event, items, recordsByIndex, recordsById) {
  if (!isObject(event?.item)) return
  const { outputIndex, itemId } = outputItemIdentity(event)
  const mappedRecords = new Set()
  if (outputIndex && recordsByIndex.has(outputIndex)) mappedRecords.add(recordsByIndex.get(outputIndex))
  if (itemId && recordsById.has(itemId)) mappedRecords.add(recordsById.get(itemId))
  if (mappedRecords.size > 1) {
    throw protocolError('Native compaction SSE event maps output_index and item id to different items')
  }

  let record = mappedRecords.values().next().value
  if (!record && event.type === 'response.output_item.done') {
    const pending = items.filter((candidate) => !candidate.done &&
      (!candidate.item.type || !event.item.type || candidate.item.type === event.item.type))
    if (pending.length === 1) record = pending[0]
    else if (pending.length > 1) {
      throw protocolError('Native compaction SSE output item has ambiguous aliases')
    }
  }
  if (!record) {
    record = { item: {}, outputIndex: undefined, itemId: undefined, done: false }
    items.push(record)
  }

  if (outputIndex && record.outputIndex && outputIndex !== record.outputIndex) {
    throw protocolError('Native compaction SSE output_index changed for one item')
  }
  if (itemId && record.itemId && itemId !== record.itemId) {
    throw protocolError('Native compaction SSE item id changed for one item')
  }
  if (outputIndex && recordsByIndex.has(outputIndex) && recordsByIndex.get(outputIndex) !== record) {
    throw protocolError('Native compaction SSE output_index is reused by different items')
  }
  if (itemId && recordsById.has(itemId) && recordsById.get(itemId) !== record) {
    throw protocolError('Native compaction SSE item id is reused by different items')
  }

  const previousEncryptedContent = typeof record.item.encrypted_content === 'string' && record.item.encrypted_content.length > 0
    ? record.item.encrypted_content
    : undefined
  Object.assign(record.item, structuredClone(event.item))
  if ((!record.item.encrypted_content || typeof record.item.encrypted_content !== 'string') && previousEncryptedContent) {
    record.item.encrypted_content = previousEncryptedContent
  }
  if (outputIndex) {
    record.outputIndex = outputIndex
    recordsByIndex.set(outputIndex, record)
  }
  if (itemId) {
    record.itemId = itemId
    recordsById.set(itemId, record)
  }
  if (event.type === 'response.output_item.done') record.done = true
}

function validCompletedOutput(output) {
  if (!Array.isArray(output)) return false
  try {
    normalizeCompactionResponse({ object: 'response.compaction', output })
    return true
  } catch {
    return false
  }
}

function usageFrom(response) {
  const usage = response?.usage
  if (!isObject(usage)) return undefined
  const totalInputTokens = Number(usage.input_tokens ?? 0)
  const outputTokens = Number(usage.output_tokens ?? 0)
  const cacheReadValue = Number(usage.input_tokens_details?.cached_tokens ?? usage.input_token_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0)
  const cacheWriteValue = Number(usage.input_tokens_details?.cache_write_tokens ?? usage.input_token_details?.cache_write_tokens ?? usage.prompt_tokens_details?.cache_write_tokens ?? 0)
  const cacheReadTokens = Number.isFinite(cacheReadValue) && cacheReadValue > 0 ? cacheReadValue : 0
  const cacheWriteTokens = Number.isFinite(cacheWriteValue) && cacheWriteValue > 0 ? cacheWriteValue : 0
  const inputTokens = Number.isFinite(totalInputTokens)
    ? Math.max(0, totalInputTokens - cacheReadTokens - cacheWriteTokens)
    : 0
  const normalizedOutputTokens = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0
  if (![inputTokens, cacheReadTokens, cacheWriteTokens, normalizedOutputTokens].some((value) => value > 0)) return undefined
  return {
    inputTokens,
    outputTokens: normalizedOutputTokens,
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
    ...(Number.isFinite(usage.output_token_details?.reasoning_tokens) && usage.output_token_details.reasoning_tokens > 0
      ? { reasoningTokens: Number(usage.output_token_details.reasoning_tokens) }
      : {}),
  }
}

function validToolDeclaration(tool) {
  if (!isObject(tool)) return false
  if (tool.type === undefined) return typeof tool.name === 'string' && tool.name.length > 0
  if (typeof tool.type !== 'string' || tool.type.length === 0) return false
  if (tool.type === 'function' || tool.type === 'custom') {
    const name = tool.name ?? tool.function?.name
    return typeof name === 'string' && name.length > 0
  }
  return true
}

export function responsesTools(tools) {
  if (tools === undefined) return undefined
  if (!Array.isArray(tools) || !tools.every(validToolDeclaration)) {
    throw protocolError('Native compaction tools contain an invalid declaration', 'LCX_COMPACT_INVALID_TOOLS')
  }
  return tools.map((tool) => {
    if (tool.type !== undefined) return structuredClone(tool)
    return {
      type: 'function',
      ...structuredClone(tool),
      description: typeof tool.description === 'string' ? tool.description : '',
      parameters: tool.parameters && typeof tool.parameters === 'object' ? structuredClone(tool.parameters) : { type: 'object', properties: {} },
      strict: false,
    }
  })
}

export function mergeFeatureHeader(headers) {
  const result = { ...(headers ?? {}) }
  const key = Object.keys(result).find((name) => name.toLowerCase() === 'x-codex-beta-features')
  const existing = key ? String(result[key] ?? '').trim() : ''
  const features = existing.split(',').map((value) => value.trim()).filter(Boolean)
  if (!features.includes(REMOTE_COMPACTION_V2_FEATURE)) features.push(REMOTE_COMPACTION_V2_FEATURE)
  result[key ?? 'x-codex-beta-features'] = features.join(',')
  return result
}

export function buildNativeCompactionBody({ model, input, instructions, promptCacheKey, tools }) {
  if (!Array.isArray(input)) throw protocolError('Native compaction input must be an array', 'LCX_COMPACT_INVALID_INPUT')
  if (input.some((item) => isObject(item) && item.type === 'compaction_trigger')) {
    throw protocolError('Native compaction input already contains compaction_trigger', 'LCX_COMPACT_DUPLICATE_TRIGGER')
  }
  const nativeTools = responsesTools(tools)
  return {
    model,
    input: [...structuredClone(input), { type: 'compaction_trigger' }],
    stream: true,
    store: false,
    ...(nativeTools !== undefined ? { tools: nativeTools } : {}),
    ...(instructions !== undefined ? { instructions: structuredClone(instructions) } : {}),
    ...(promptCacheKey !== undefined && promptCacheKey !== null ? { prompt_cache_key: String(promptCacheKey) } : {}),
  }
}

function parseSseEvent(dataLines) {
  if (dataLines.length === 0) return undefined
  const data = dataLines.join('\n')
  if (data === '[DONE]') return undefined
  try {
    const parsed = JSON.parse(data)
    if (!isObject(parsed)) throw new Error('SSE event is not an object')
    return parsed
  } catch (error) {
    throw protocolError(`Native compaction returned malformed SSE JSON: ${String(error)}`)
  }
}

export async function parseNativeCompactionSse(response, options = {}) {
  if (!response?.body) throw protocolError('Native compaction response did not include an SSE body', 'LCX_INVALID_SSE')
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_SSE_BYTES
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const eventItems = []
  const recordsByIndex = new Map()
  const recordsById = new Map()
  let completedResponse
  let completedOutput
  let pending = ''
  let dataLines = []
  let bytes = 0
  let sawTerminal = false

  const dispatch = () => {
    const event = parseSseEvent(dataLines)
    dataLines = []
    if (!event) return
    if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete') {
      const message = event.error?.message ?? event.response?.error?.message ?? `Native compaction ended with ${String(event.type)}`
      throw protocolError(message, 'LCX_COMPACT_UPSTREAM_ERROR')
    }
    if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
      mergeOutputItem(event, eventItems, recordsByIndex, recordsById)
    }
    if (event.type === 'response.completed') {
      sawTerminal = true
      completedResponse = isObject(event.response) ? event.response : {}
      completedOutput = Array.isArray(completedResponse.output) ? structuredClone(completedResponse.output) : undefined
    }
  }

  try {
    while (true) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('request aborted')
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > maxBytes) throw protocolError(`Native compaction SSE response exceeds ${maxBytes} bytes`, 'LCX_RESPONSE_TOO_LARGE')
      pending += decoder.decode(result.value, { stream: true })
      let newline
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/u, '')
        pending = pending.slice(newline + 1)
        if (line === '') dispatch()
        else if (!line.startsWith(':')) {
          if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /u, ''))
        }
      }
    }
    pending += decoder.decode()
    if (pending.length > 0) {
      const line = pending.replace(/\r$/u, '')
      if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /u, ''))
    }
    dispatch()
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  if (!sawTerminal || !completedResponse) {
    throw protocolError('Native compaction SSE ended without response.completed', 'LCX_COMPACT_INCOMPLETE_SSE')
  }

  if (completedResponse.object !== undefined && !['response.compaction', 'response'].includes(completedResponse.object)) {
    throw protocolError(`Native compaction returned unexpected response object: ${String(completedResponse.object)}`, 'LCX_COMPACT_INVALID_RESPONSE')
  }
  const mergedEventOutput = eventItems.map((record) => record.item)
  const output = validCompletedOutput(completedOutput) ? completedOutput : mergedEventOutput
  const normalized = normalizeCompactionResponse({
    object: completedResponse.object ?? 'response.compaction',
    id: typeof completedResponse.id === 'string' ? completedResponse.id : undefined,
    output,
  })
  return {
    ...normalized,
    usage: usageFrom(completedResponse),
  }
}

export async function requestNativeCompaction({
  baseURL,
  model,
  input,
  instructions,
  promptCacheKey,
  idempotencyKey,
  tools,
  headers,
  signal,
  timeoutMs,
  maxAttempts,
  maxResponseBytes,
}) {
  const body = buildNativeCompactionBody({ model, input, instructions, promptCacheKey, tools })
  const requestHeaders = { ...(headers ?? {}) }
  if (idempotencyKey !== undefined && idempotencyKey !== null && !Object.keys(requestHeaders).some((name) => name.toLowerCase() === 'idempotency-key')) {
    requestHeaders['idempotency-key'] = String(idempotencyKey)
  }
  const featureHeaders = mergeFeatureHeader(requestHeaders)
  return fetchSseWithRetry(
    `${String(baseURL).replace(/\/+$/u, '')}/responses`,
    body,
    featureHeaders,
    signal,
    timeoutMs,
    {
      maxAttempts,
      maxResponseBytes,
      consume: (response, consumeOptions = {}) => parseNativeCompactionSse(response, {
        signal: consumeOptions.requestSignal ?? signal,
        maxResponseBytes,
      }),
    },
  )
}
