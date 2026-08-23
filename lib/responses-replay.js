import { fetchSseWithRetry } from './transport.js'
import { mergeFeatureHeader, responsesGenerationEnvelope } from './compact-v2.js'
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
  const e = fail(`Responses stream ended with ${String(event?.type)}`)
  if (Number.isInteger(event?.error?.status)) e.status = event.error.status
  return e
}

function textSignature(itemId, phase) {
  if (typeof itemId !== 'string' || itemId.length === 0) return undefined
  const value = { v: 1, id: itemId }
  if (phase === 'commentary' || phase === 'final_answer') value.phase = phase
  return JSON.stringify(value)
}

function replayBlockFor(item, fallbackKind) {
  const kind = item?.kind ?? fallbackKind
  if (kind === 'text') {
    const signature = textSignature(item?.itemId, item?.phase)
    return { type: 'text', ...(signature ? { textSignature: signature } : {}) }
  }
  if (kind === 'reasoning') {
    const signature = isObject(item?.rawItem) ? JSON.stringify(item.rawItem) : undefined
    return { type: 'reasoning', ...(signature ? { thinkingSignature: signature } : {}) }
  }
  return { type: 'tool-call' }
}

function replayStopReason(reason) {
  if (reason?.kind === 'tool-calls') return 'toolUse'
  if (reason?.kind === 'max-tokens') return 'length'
  if (reason?.kind === 'error') return 'error'
  if (reason?.kind === 'aborted') return 'aborted'
  return 'stop'
}
function dshToolCallId(callId, itemId) {
  const call = typeof callId === 'string' && callId.length > 0 ? callId : undefined
  const item = typeof itemId === 'string' && itemId.length > 0 ? itemId : undefined
  if (call && item) return `${call}|${item}`
  return call ?? item ?? ''
}

export function replayBody({ model, input, system, tools, promptCacheKey, promptCacheRetention, reasoningEffort, temperature, maxTokens }) {
  return {
    model,
    input: structuredClone(input),
    stream: true,
    store: false,
    tool_choice: 'auto',
    parallel_tool_calls: true,
    ...(system !== undefined ? { instructions: system } : {}),
    ...(tools !== undefined ? { tools: responsesTools(tools) } : {}),
    ...(promptCacheKey ? { prompt_cache_key: String(promptCacheKey) } : {}),
    ...(promptCacheRetention ? { prompt_cache_retention: String(promptCacheRetention) } : {}),
    ...responsesGenerationEnvelope({ reasoningEffort, temperature, maxTokens }),
  }
}

export async function* requestNativeReplay({ baseURL, provider, model, input, system, tools, promptCacheKey, promptCacheRetention, reasoningEffort, temperature, maxTokens, headers, signal, timeoutMs, maxAttempts, maxResponseBytes }) {
  const response = await fetchSseWithRetry(`${String(baseURL).replace(/\/+$/u, '')}/responses`, replayBody({ model, input, system, tools, promptCacheKey, promptCacheRetention, reasoningEffort, temperature, maxTokens }), mergeFeatureHeader(headers), signal, timeoutMs, { maxAttempts, maxResponseBytes })
  const records = []
  const byStreamIdentity = new Map()
  let nextIndex = 0
  let terminal
  const identity = (kind, itemId, partIndex) => itemId === undefined ? undefined : `${kind}:${String(itemId)}:${partIndex ?? 0}`
  const createRecord = (kind, streamIdentity, outputIndex, partIndex) => {
    const existing = streamIdentity === undefined ? undefined : byStreamIdentity.get(streamIdentity)
    if (existing) return { record: existing, created: false }
    const record = { kind, index: nextIndex++, outputIndex, partIndex, streamIdentity, text: '', arguments: '', name: '', callId: undefined, itemId: undefined, terminal: undefined }
    records.push(record)
    if (streamIdentity !== undefined) byStreamIdentity.set(streamIdentity, record)
    return { record, created: true }
  }
  for await (const event of sseEvents(response, { signal, maxResponseBytes })) {
    if (!isObject(event)) continue
    if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete') throw streamError(event)
    if (event.type === 'response.output_text.delta') {
      const itemId = typeof event.item_id === 'string' ? event.item_id : undefined
      const key = identity('text', itemId, event.content_index)
      const allocated = createRecord('text', key ?? `text:index:${event.output_index ?? ''}:${event.content_index ?? ''}`, event.output_index, event.content_index)
      const record = allocated.record
      if (allocated.created) yield { type: 'block-start', index: record.index, blockType: 'text' }
      if (typeof event.delta === 'string' && event.delta) { record.text += event.delta; yield { type: 'text-delta', index: record.index, text: event.delta } }
      continue
    }
    if (event.type === 'response.reasoning_summary_text.delta' || event.type === 'response.reasoning_text.delta') {
      const itemId = typeof event.item_id === 'string' ? event.item_id : undefined
      const key = identity('reasoning', itemId, event.summary_index ?? event.content_index)
      const allocated = createRecord('reasoning', key ?? `reasoning:index:${event.output_index ?? ''}:${event.summary_index ?? event.content_index ?? ''}`, event.output_index, event.summary_index ?? event.content_index)
      const record = allocated.record
      if (allocated.created) yield { type: 'block-start', index: record.index, blockType: 'reasoning' }
      if (typeof event.delta === 'string' && event.delta) { record.text += event.delta; yield { type: 'reasoning-delta', index: record.index, text: event.delta } }
      continue
    }
    if (event.type === 'response.function_call_arguments.delta') {
      const itemId = typeof event.item_id === 'string' ? event.item_id : undefined
      const callId = typeof event.call_id === 'string' ? event.call_id : itemId ?? `call-${event.output_index ?? nextIndex}`
      const key = identity('tool-call', typeof event.item_id === 'string' ? event.item_id : callId, 0) ?? `tool-call:${callId}`
      const allocated = createRecord('tool-call', key, event.output_index, 0)
      const record = allocated.record
      record.callId = callId
      record.itemId = itemId
      if (typeof event.name === 'string') record.name = event.name
      if (allocated.created) yield { type: 'block-start', index: record.index, blockType: 'tool-call' }
      const delta = typeof event.delta === 'string' ? event.delta : ''
      record.arguments += delta
      yield { type: 'tool-call-delta', index: record.index, id: dshToolCallId(callId, itemId), ...(record.name ? { name: record.name } : {}), argumentsDelta: delta }
      continue
    }
    if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
      const itemId = typeof event.item.id === 'string' ? event.item.id : undefined
      const callId = typeof event.item.call_id === 'string' ? event.item.call_id : itemId ?? `call-${event.output_index ?? nextIndex}`
      const key = identity('tool-call', itemId ?? callId, 0) ?? `tool-call:${callId}`
      const allocated = createRecord('tool-call', key, event.output_index, 0)
      const record = allocated.record
      record.callId = callId
      record.itemId = itemId
      record.name = typeof event.item.name === 'string' ? event.item.name : record.name
      if (allocated.created) {
        yield { type: 'block-start', index: record.index, blockType: 'tool-call' }
        if (typeof event.item.arguments === 'string' && event.item.arguments) { record.arguments = event.item.arguments; yield { type: 'tool-call-delta', index: record.index, id: dshToolCallId(callId, itemId), ...(record.name ? { name: record.name } : {}), argumentsDelta: event.item.arguments } }
      }
      continue
    }
    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const itemId = typeof event.item.id === 'string' ? event.item.id : undefined
      const callId = typeof event.item.call_id === 'string' ? event.item.call_id : itemId ?? `call-${event.output_index ?? nextIndex}`
      const key = identity('tool-call', itemId ?? callId, 0) ?? `tool-call:${callId}`
      const allocated = createRecord('tool-call', key, event.output_index, 0)
      const record = allocated.record
      record.callId = callId
      record.itemId = itemId
      record.name = typeof event.item.name === 'string' ? event.item.name : record.name
      const completedArguments = typeof event.item.arguments === 'string' ? event.item.arguments : record.arguments
      if (allocated.created) {
        yield { type: 'block-start', index: record.index, blockType: 'tool-call' }
        if (completedArguments) yield { type: 'tool-call-delta', index: record.index, id: dshToolCallId(callId, itemId), ...(record.name ? { name: record.name } : {}), argumentsDelta: completedArguments }
      }
      record.arguments = completedArguments
      continue
    }
    if (event.type === 'response.completed') terminal = event.response
  }
  if (!isObject(terminal)) throw fail('Responses replay ended without response.completed', 'LCX_RESPONSES_INCOMPLETE')
  if (terminal.status !== 'completed') throw fail('Responses replay response.completed did not carry completed status', 'LCX_RESPONSES_INCOMPLETE')

  const terminalItems = []
  for (const [outputIndex, item] of (terminal.output ?? []).entries()) {
    if (item?.type === 'message') {
      for (const [contentIndex, part] of (item.content ?? []).entries()) if (part?.type === 'output_text') terminalItems.push({ kind: 'text', outputIndex, partIndex: contentIndex, itemId: item.id, phase: item.phase, text: String(part.text ?? ''), rawItem: item })
    } else if (item?.type === 'reasoning') {
      const parts = Array.isArray(item.summary) && item.summary.length ? item.summary : item.content ?? []
      parts.forEach((part, index) => { if (typeof part?.text === 'string') terminalItems.push({ kind: 'reasoning', outputIndex, partIndex: index, itemId: item.id, text: part.text, rawItem: item }) })
    } else if (item?.type === 'function_call') {
      terminalItems.push({ kind: 'tool-call', outputIndex, partIndex: 0, itemId: item.id, callId: item.call_id, name: String(item.name ?? ''), arguments: String(item.arguments ?? ''), rawItem: item })
    }
  }
  const matched = new Set()
  const matchesRecord = (item) => {
    const stable = identity(item.kind, item.itemId ?? item.callId, item.partIndex)
    if (stable) {
      const exact = records.find((record) => !matched.has(record) && record.kind === item.kind && (record.streamIdentity === stable || (item.kind === 'tool-call' && record.callId === item.callId)))
      if (exact) return exact
    }
    const candidates = records.filter((record) => !matched.has(record) && record.kind === item.kind)
    if (candidates.length === 1) return candidates[0]
    const contentMatches = candidates.filter((record) => item.kind === 'tool-call'
      ? record.callId === item.callId || (item.arguments && record.arguments && (item.arguments.startsWith(record.arguments) || record.arguments.startsWith(item.arguments)))
      : item.text !== undefined && record.text && (item.text === record.text || item.text.startsWith(record.text) || record.text.startsWith(item.text)))
    return contentMatches.length === 1 ? contentMatches[0] : undefined
  }
  for (const item of terminalItems) {
    const record = matchesRecord(item)
    if (!record) continue
    matched.add(record)
    record.terminal = item
  }
  const replayBlocks = []
  for (const record of records) {
    const item = record.terminal
    replayBlocks[record.index] = replayBlockFor(item, record.kind)
    if (record.kind === 'text') yield { type: 'block-end', index: record.index, block: { type: 'text', text: item?.text ?? record.text } }
    else if (record.kind === 'reasoning') yield { type: 'block-end', index: record.index, block: { type: 'reasoning', text: item?.text ?? record.text } }
    else yield { type: 'block-end', index: record.index, block: { type: 'tool-call', id: dshToolCallId(item?.callId ?? record.callId, item?.itemId ?? record.itemId), name: item?.name ?? record.name, arguments: item?.arguments ?? record.arguments } }
  }
  for (const item of terminalItems) {
    const record = records.find((candidate) => candidate.terminal === item)
    if (record) continue
    if (item.kind === 'text' && !item.text) continue
    const index = nextIndex++
    replayBlocks[index] = replayBlockFor(item, item.kind)
    yield { type: 'block-start', index, blockType: item.kind === 'tool-call' ? 'tool-call' : item.kind }
    if (item.kind === 'text' && item.text) yield { type: 'text-delta', index, text: item.text }
    if (item.kind === 'reasoning' && item.text) yield { type: 'reasoning-delta', index, text: item.text }
    if (item.kind === 'tool-call') yield { type: 'tool-call-delta', index, id: dshToolCallId(item.callId, item.itemId), name: item.name, argumentsDelta: item.arguments }
    yield { type: 'block-end', index, block: item.kind === 'text' ? { type: 'text', text: item.text } : item.kind === 'reasoning' ? { type: 'reasoning', text: item.text } : { type: 'tool-call', id: dshToolCallId(item.callId, item.itemId), name: item.name, arguments: item.arguments } }
  }
  const usage = usageFrom(terminal.usage)
  if (usage) yield { type: 'usage', usage }
  const reason = terminal.status === 'incomplete'
    ? { kind: 'max-tokens' }
    : terminal.error ? { kind: 'error', failure: { message: terminal.error.message ?? 'Responses error', code: 'LCX_RESPONSES_UPSTREAM_ERROR' } }
      : terminalItems.some((item) => item.kind === 'tool-call') ? { kind: 'tool-calls' } : { kind: 'stop' }
  const replayState = typeof provider === 'string' && provider.length > 0 && typeof model === 'string' && model.length > 0
    ? {
        response: {
          kind: 'pi-ai', version: 2, api: 'openai-responses', provider, model,
          ...(typeof terminal.model === 'string' && terminal.model.length > 0 ? { responseModel: terminal.model } : {}),
          ...(typeof terminal.id === 'string' && terminal.id.length > 0 ? { responseId: terminal.id } : {}),
          stopReason: replayStopReason(reason),
        },
        blocks: Array.from({ length: nextIndex }, (_, index) => replayBlocks[index] ?? { type: records.find((record) => record.index === index)?.kind ?? 'text' }),
      }
    : undefined
  yield { type: 'finish', reason, ...(replayState ? { replayState } : {}) }
}
