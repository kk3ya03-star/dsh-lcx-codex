import { fetchSseWithRetry } from './transport.js'
import { mergeFeatureHeader } from './compact-v2.js'
import { responsesTools } from './dsh-responses.js'

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function fail(message, code = 'LCX_RESPONSES_UPSTREAM_ERROR') { const e = new Error(message); e.code = code; return e }

function usageFrom(raw) {
  if (!isObject(raw)) return undefined
  const inputTotal = Number(raw.input_tokens ?? 0)
  const output = Number(raw.output_tokens ?? 0)
  const details = raw.input_tokens_details ?? raw.input_token_details ?? raw.prompt_tokens_details ?? {}
  const cacheRead = Number(details.cached_tokens ?? 0)
  const cacheWrite = Number(details.cache_write_tokens ?? 0)
  const usage = {
    inputTokens: Math.max(0, Number.isFinite(inputTotal) ? inputTotal - (Number.isFinite(cacheRead) ? cacheRead : 0) - (Number.isFinite(cacheWrite) ? cacheWrite : 0) : 0),
    outputTokens: Number.isFinite(output) && output > 0 ? output : 0,
  }
  if (Number.isFinite(cacheRead) && cacheRead > 0) usage.cacheReadTokens = cacheRead
  if (Number.isFinite(cacheWrite) && cacheWrite > 0) usage.cacheWriteTokens = cacheWrite
  const reasoning = Number(raw.output_tokens_details?.reasoning_tokens ?? raw.output_token_details?.reasoning_tokens ?? 0)
  if (Number.isFinite(reasoning) && reasoning > 0) usage.reasoningTokens = reasoning
  return usage
}

async function* sseEvents(response, options = {}) {
  if (!response?.body) throw fail('Responses replay returned no SSE body', 'LCX_INVALID_SSE')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let dataLines = []
  let bytes = 0
  const maxBytes = options.maxResponseBytes ?? 8 * 1024 * 1024
  const decodeEvent = () => {
    if (dataLines.length === 0) return undefined
    const data = dataLines.join('\n')
    dataLines = []
    if (data === '[DONE]') return undefined
    try { return JSON.parse(data) } catch (cause) { throw fail(`malformed Responses SSE JSON: ${cause}`, 'LCX_INVALID_SSE') }
  }
  try {
    while (true) {
      if (options.signal?.aborted) throw options.signal.reason ?? fail('request aborted', 'LCX_ABORTED')
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) throw fail(`Responses SSE exceeds ${maxBytes} bytes`, 'LCX_RESPONSE_TOO_LARGE')
      pending += decoder.decode(value, { stream: true })
      let newline
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/u, '')
        pending = pending.slice(newline + 1)
        if (line === '') {
          const event = decodeEvent()
          if (event) yield event
        } else if (!line.startsWith(':') && line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /u, ''))
      }
    }
    pending += decoder.decode()
    if (pending.startsWith('data:')) dataLines.push(pending.slice(5).replace(/^ /u, ''))
    const event = decodeEvent()
    if (event) yield event
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function streamError(event) {
  const message = event?.error?.message ?? event?.response?.error?.message ?? `Responses stream ended with ${String(event?.type)}`
  const e = fail(message)
  if (Number.isInteger(event?.error?.status)) e.status = event.error.status
  return e
}

export function replayBody({ model, input, system, tools, promptCacheKey }) {
  return {
    model,
    input: structuredClone(input),
    stream: true,
    store: false,
    ...(system !== undefined ? { instructions: system } : {}),
    ...(tools !== undefined ? { tools: responsesTools(tools) } : {}),
    ...(promptCacheKey ? { prompt_cache_key: String(promptCacheKey) } : {}),
  }
}

export async function* requestNativeReplay({ baseURL, model, input, system, tools, promptCacheKey, headers, signal, timeoutMs, maxAttempts, maxResponseBytes }) {
  const response = await fetchSseWithRetry(`${String(baseURL).replace(/\/+$/u, '')}/responses`, replayBody({ model, input, system, tools, promptCacheKey }), mergeFeatureHeader(headers), signal, timeoutMs, { maxAttempts, maxResponseBytes })
  const textIndexes = new Map()
  const reasoningIndexes = new Map()
  const callIndexes = new Map()
  let nextIndex = 0
  let terminal
  let finished = false
  const allocate = (map, key, blockType) => {
    if (map.has(key)) return { index: map.get(key), created: false }
    const index = nextIndex++
    map.set(key, index)
    return { index, created: true, blockType }
  }
  for await (const event of sseEvents(response, { signal, maxResponseBytes })) {
    if (!isObject(event)) continue
    if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete') throw streamError(event)
    if (event.type === 'response.output_text.delta') {
      const key = `${event.output_index ?? ''}:${event.content_index ?? ''}`
      const slot = allocate(textIndexes, key, 'text')
      if (slot.created) yield { type: 'block-start', index: slot.index, blockType: 'text' }
      if (typeof event.delta === 'string' && event.delta) yield { type: 'text-delta', index: slot.index, text: event.delta }
      continue
    }
    if (event.type === 'response.reasoning_summary_text.delta' || event.type === 'response.reasoning_text.delta') {
      const key = `${event.output_index ?? ''}:${event.summary_index ?? event.content_index ?? ''}`
      const slot = allocate(reasoningIndexes, key, 'reasoning')
      if (slot.created) yield { type: 'block-start', index: slot.index, blockType: 'reasoning' }
      if (typeof event.delta === 'string' && event.delta) yield { type: 'reasoning-delta', index: slot.index, text: event.delta }
      continue
    }
    if (event.type === 'response.function_call_arguments.delta') {
      const callId = String(event.call_id ?? event.item_id ?? `call-${event.output_index ?? nextIndex}`)
      const slot = allocate(callIndexes, callId, 'tool-call')
      if (slot.created) yield { type: 'block-start', index: slot.index, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: slot.index, id: callId, ...(typeof event.name === 'string' ? { name: event.name } : {}), argumentsDelta: typeof event.delta === 'string' ? event.delta : '' }
      continue
    }
    if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
      const callId = String(event.item.call_id ?? event.item.id ?? `call-${event.output_index ?? nextIndex}`)
      const slot = allocate(callIndexes, callId, 'tool-call')
      if (slot.created) {
        yield { type: 'block-start', index: slot.index, blockType: 'tool-call' }
        if (typeof event.item.name === 'string' || typeof event.item.arguments === 'string') {
          yield { type: 'tool-call-delta', index: slot.index, id: callId, ...(typeof event.item.name === 'string' ? { name: event.item.name } : {}), argumentsDelta: typeof event.item.arguments === 'string' ? event.item.arguments : '' }
        }
      }
      continue
    }
    if (event.type === 'response.completed' || event.type === 'response.done') {
      terminal = event.response
      continue
    }
  }
  if (!isObject(terminal)) throw fail('Responses replay ended without response.completed', 'LCX_RESPONSES_INCOMPLETE')

  // Close all blocks with a best-effort projection from the terminal response.
  const terminalText = new Map()
  const terminalReasoning = new Map()
  const terminalCalls = new Map()
  for (const [outputIndex, item] of (terminal.output ?? []).entries()) {
    if (item?.type === 'message') {
      for (const [contentIndex, part] of (item.content ?? []).entries()) {
        if (part?.type === 'output_text') terminalText.set(`${outputIndex}:${contentIndex}`, String(part.text ?? ''))
      }
    } else if (item?.type === 'reasoning') {
      const parts = Array.isArray(item.summary) && item.summary.length ? item.summary : item.content ?? []
      parts.forEach((part, idx) => { if (typeof part?.text === 'string') terminalReasoning.set(`${outputIndex}:${idx}`, part.text) })
    } else if (item?.type === 'function_call') {
      const callId = String(item.call_id ?? item.id ?? `call-${outputIndex}`)
      terminalCalls.set(callId, item)
    }
  }
  for (const [key, index] of textIndexes) yield { type: 'block-end', index, block: { type: 'text', text: terminalText.get(key) ?? '' } }
  for (const [key, index] of reasoningIndexes) yield { type: 'block-end', index, block: { type: 'reasoning', text: terminalReasoning.get(key) ?? '' } }
  for (const [callId, index] of callIndexes) {
    const item = terminalCalls.get(callId)
    yield { type: 'block-end', index, block: { type: 'tool-call', id: callId, name: String(item?.name ?? ''), arguments: String(item?.arguments ?? '') } }
  }

  // Providers sometimes send no deltas for tiny answers; materialize unseen terminal blocks.
  for (const [key, text] of terminalText) {
    if (textIndexes.has(key)) continue
    const index = nextIndex++
    yield { type: 'block-start', index, blockType: 'text' }
    if (text) yield { type: 'text-delta', index, text }
    yield { type: 'block-end', index, block: { type: 'text', text } }
  }
  for (const [callId, item] of terminalCalls) {
    if (callIndexes.has(callId)) continue
    const index = nextIndex++
    yield { type: 'block-start', index, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index, id: callId, name: String(item.name ?? ''), argumentsDelta: String(item.arguments ?? '') }
    yield { type: 'block-end', index, block: { type: 'tool-call', id: callId, name: String(item.name ?? ''), arguments: String(item.arguments ?? '') } }
  }
  const usage = usageFrom(terminal.usage)
  if (usage) yield { type: 'usage', usage }
  const reason = terminal.status === 'incomplete'
    ? { kind: 'max-tokens' }
    : terminal.error ? { kind: 'error', failure: { message: terminal.error.message ?? 'Responses error', code: 'LCX_RESPONSES_UPSTREAM_ERROR' } }
      : terminalCalls.size > 0 ? { kind: 'tool-calls' } : { kind: 'stop' }
  yield { type: 'finish', reason }
  finished = true
  if (!finished) throw fail('Responses replay did not finish')
}
