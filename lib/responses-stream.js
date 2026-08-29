// @ts-check

import { processResponsesStream } from '@earendil-works/pi-ai/api/openai-responses-shared'
import { fetchSseWithRetry } from './transport.js'

/** @typedef {Record<string, unknown>} UnknownRecord */
/** @typedef {import('openai/resources/responses/responses.js').ResponseStreamEvent} ResponseStreamEvent */
/** @typedef {{ message: string, code: string, status?: number, requestId?: string, providerRetryAfterMs?: number }} ManagedFailure */
/** @typedef {Error & { code?: string, status?: number, requestId?: string, providerRetryAfterMs?: number, cause?: unknown }} LcxError */

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
}

/** @param {unknown} value @returns {value is UnknownRecord} */
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }

class PiEventQueue {
  constructor() {
    /** @type {unknown[]} */
    this.queue = []
    /** @type {Array<(value: IteratorResult<unknown>) => void>} */
    this.waiting = []
    this.done = false
  }
  /** @param {unknown} event */
  push(event) {
    if (this.done) return
    const waiter = this.waiting.shift()
    if (waiter) waiter({ value: event, done: false })
    else this.queue.push(event)
  }
  end() {
    this.done = true
    while (this.waiting.length > 0) this.waiting.shift()?.({ value: undefined, done: true })
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.queue.length > 0) yield this.queue.shift()
      else if (this.done) return
      else {
        const result = await new Promise((resolve) => this.waiting.push(resolve))
        if (result.done) return
        yield result.value
      }
    }
  }
}

/** @param {unknown} raw */
function safeStatus(raw) { return Number.isInteger(raw) && Number(raw) >= 100 && Number(raw) <= 599 ? Number(raw) : undefined }

/** @param {unknown} raw */
function safeRequestId(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 160) return undefined
  return /^[A-Za-z0-9._:\/-]+$/u.test(raw) ? raw : undefined
}

/** @param {unknown} error */
function errorFacts(error) {
  const seen = new Set()
  const codes = []
  const texts = []
  let status
  let requestId
  let providerRetryAfterMs
  let current = error
  for (let depth = 0; depth < 8 && (current instanceof Error || isObject(current)) && !seen.has(current); depth += 1) {
    seen.add(current)
    const value = /** @type {LcxError} */ (current)
    if (status === undefined) status = safeStatus(value.status)
    if (requestId === undefined) requestId = safeRequestId(value.requestId)
    if (providerRetryAfterMs === undefined && Number.isFinite(value.providerRetryAfterMs) && Number(value.providerRetryAfterMs) > 0) providerRetryAfterMs = Number(value.providerRetryAfterMs)
    if (typeof value.code === 'string' && value.code) codes.push(value.code)
    if (typeof value.message === 'string' && value.message) texts.push(value.message)
    current = value.cause
  }
  return { status, requestId, providerRetryAfterMs, codes, text: texts.join(' | ') }
}

/**
 * Provider bodies/messages are deliberately not surfaced. Only a stable class and safe facts leave the wire boundary.
 * @param {unknown} error
 * @param {AbortSignal} [signal]
 */
export function managedFailure(error, signal) {
  const facts = errorFacts(error)
  const sourceCodes = new Set(facts.codes)
  const text = facts.text
  let code = 'RESPONSES_ERROR'
  if (signal?.aborted || sourceCodes.has('LCX_ABORTED') || /\babort(?:ed)?\b/iu.test(text)) code = 'ABORTED'
  else if (sourceCodes.has('LCX_RESPONSES_UNSUPPORTED_OPTION')) code = 'UNSUPPORTED_OPTION'
  else if (sourceCodes.has('LCX_RESPONSES_ROUTE_UNAVAILABLE') || sourceCodes.has('LCX_RESPONSES_MODEL_UNAVAILABLE')) code = 'NO_ADAPTER'
  else if (facts.status === 401 || facts.status === 403 || sourceCodes.has('AUTH') || sourceCodes.has('LCX_CREDENTIAL_UNAVAILABLE')) code = 'AUTH'
  else if (facts.status === 408) code = 'TIMEOUT'
  else if (facts.status === 409 || facts.status === 425) code = 'TRANSPORT'
  else if (facts.status === 429 || /rate.?limit|quota exceeded/iu.test(text)) code = 'RATE_LIMIT'
  else if (facts.status !== undefined && facts.status >= 500) code = 'SERVER'
  else if (/context (?:window|length)|maximum context|too many tokens/iu.test(text) || [...sourceCodes].some((value) => /context.*(?:window|length|exceed)/iu.test(value))) code = 'CONTEXT_WINDOW_EXCEEDED'
  else if (facts.status === 400 || facts.status === 404 || facts.status === 413 || facts.status === 422 || sourceCodes.has('LCX_RESPONSES_INVALID_INPUT') || /invalid.?request|payload too large|length limit exceeded/iu.test(text)) code = 'INVALID_REQUEST'
  else if (sourceCodes.has('LCX_RESPONSE_TOO_LARGE')) code = 'INVALID_REQUEST'
  else if (sourceCodes.has('LCX_INVALID_SSE') || /stream ended before|without a terminal|malformed.*sse/iu.test(text)) code = 'TRANSPORT'
  else if (/time(?:d)?\s*out|timeout/iu.test(text) || sourceCodes.has('TimeoutError')) code = 'TIMEOUT'
  else if (error instanceof TypeError || /\bnetwork|connection|socket|fetch|ECONN|EAI_AGAIN|terminated|premature close\b/iu.test(text)) code = 'TRANSPORT'
  const messages = /** @type {Record<string, string>} */ ({
    ABORTED: 'Responses request was aborted',
    AUTH: 'Responses request was rejected by authentication',
    UNSUPPORTED_OPTION: 'LCX Responses does not support this request option',
    NO_ADAPTER: 'LCX could not resolve the selected Responses route',
    RATE_LIMIT: 'Responses provider rate limit was reached',
    SERVER: 'Responses provider returned a server failure',
    INVALID_REQUEST: 'Responses provider rejected the request',
    CONTEXT_WINDOW_EXCEEDED: 'Responses request exceeded the model context window',
    TIMEOUT: 'Responses request timed out',
    TRANSPORT: 'Responses transport failed',
    RESPONSES_ERROR: 'Responses request failed',
  })
  return {
    message: messages[code] ?? messages.RESPONSES_ERROR,
    code,
    ...(facts.status === undefined ? {} : { status: facts.status }),
    ...(facts.requestId === undefined ? {} : { requestId: facts.requestId }),
    ...(facts.providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs: facts.providerRetryAfterMs }),
  }
}

/** @param {unknown} error @param {AbortSignal} [signal] */
export function managedFailureChunk(error, signal) {
  const failure = managedFailure(error, signal)
  return { type: 'finish', reason: failure.code === 'ABORTED' ? { kind: 'aborted', failure } : { kind: 'error', failure } }
}

/**
 * Minimal JSON SSE reader. LCX owns the exact HTTP wire; Pi owns event semantics after this boundary.
 * @param {Response} response
 * @param {{ signal?: AbortSignal, maxResponseBytes?: number }} [options]
 */
async function* responseEvents(response, options = {}) {
  if (!response?.body) throw Object.assign(new Error('Responses stream returned no body'), { code: 'LCX_INVALID_SSE', status: response?.status })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const maxBytes = options.maxResponseBytes ?? 8 * 1024 * 1024
  let bytes = 0
  let pending = ''
  /** @type {string[]} */
  let dataLines = []
  const decode = () => {
    if (dataLines.length === 0) return undefined
    const data = dataLines.join('\n')
    dataLines = []
    if (data === '[DONE]') return undefined
    try { return JSON.parse(data) }
    catch (cause) { throw Object.assign(new Error('Responses stream contained malformed SSE JSON', { cause }), { code: 'LCX_INVALID_SSE' }) }
  }
  try {
    while (true) {
      if (options.signal?.aborted) throw options.signal.reason ?? Object.assign(new Error('request aborted'), { code: 'LCX_ABORTED' })
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) throw Object.assign(new Error(`Responses SSE exceeds ${maxBytes} bytes`), { code: 'LCX_RESPONSE_TOO_LARGE' })
      pending += decoder.decode(value, { stream: true })
      let newline
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/u, '')
        pending = pending.slice(newline + 1)
        if (line === '') {
          const event = decode()
          if (event !== undefined) yield event
        } else if (!line.startsWith(':') && line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /u, ''))
        }
      }
    }
    pending += decoder.decode()
    if (pending.startsWith('data:')) dataLines.push(pending.slice(5).replace(/^ /u, ''))
    const event = decode()
    if (event !== undefined) yield event
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

/** @param {UnknownRecord} item */
function itemKind(item) {
  if (item.type === 'message') return 'text'
  if (item.type === 'reasoning') return 'reasoning'
  if (item.type === 'function_call' || item.type === 'custom_tool_call') return 'tool-call'
  return undefined
}

/** @param {UnknownRecord} item */
function itemIdentity(item) {
  const id = typeof item.id === 'string' && item.id ? item.id : typeof item.call_id === 'string' ? item.call_id : ''
  return id ? `${String(item.type)}:${id}` : undefined
}

/** @param {UnknownRecord} item */
function itemText(item) {
  if (item.type === 'message') return (Array.isArray(item.content) ? item.content : []).map((part) => isObject(part) && (part.type === 'output_text' || part.type === 'refusal') ? String(part.text ?? part.refusal ?? '') : '').join('')
  if (item.type === 'reasoning') {
    const parts = Array.isArray(item.summary) && item.summary.length > 0 ? item.summary : Array.isArray(item.content) ? item.content : []
    return parts.map((part) => isObject(part) ? String(part.text ?? '') : '').join('\n\n')
  }
  if (item.type === 'function_call') return String(item.arguments ?? '')
  if (item.type === 'custom_tool_call') return String(item.input ?? '')
  return ''
}

/** @param {UnknownRecord} item @param {number} index */
function normalizedTerminalItem(item, index) {
  if (item.type === 'message') return { ...structuredClone(item), id: typeof item.id === 'string' && item.id ? item.id : `msg_lcx_${index}`, role: 'assistant', status: item.status ?? 'completed', content: Array.isArray(item.content) ? structuredClone(item.content) : [] }
  if (item.type === 'reasoning') return { ...structuredClone(item), id: typeof item.id === 'string' && item.id ? item.id : `rs_lcx_${index}`, summary: Array.isArray(item.summary) ? structuredClone(item.summary) : [] }
  if (item.type === 'function_call') return { ...structuredClone(item), id: typeof item.id === 'string' && item.id ? item.id : `fc_lcx_${index}`, call_id: typeof item.call_id === 'string' && item.call_id ? item.call_id : `call_lcx_${index}`, name: String(item.name ?? ''), arguments: String(item.arguments ?? '') }
  if (item.type === 'custom_tool_call') return { ...structuredClone(item), id: typeof item.id === 'string' && item.id ? item.id : `ctc_lcx_${index}`, call_id: typeof item.call_id === 'string' && item.call_id ? item.call_id : `call_lcx_${index}`, name: String(item.name ?? ''), input: String(item.input ?? '') }
  return structuredClone(item)
}

/** @param {UnknownRecord} item @param {number} index */
function addedShell(item, index) {
  if (item.type === 'message') return { type: 'message', id: item.id ?? `msg_lcx_${index}`, role: 'assistant', status: 'in_progress', content: [] }
  if (item.type === 'reasoning') return { type: 'reasoning', id: item.id ?? `rs_lcx_${index}`, summary: [] }
  if (item.type === 'function_call') return { type: 'function_call', id: item.id ?? `fc_lcx_${index}`, call_id: item.call_id ?? `call_lcx_${index}`, name: String(item.name ?? ''), arguments: '' }
  return { type: 'custom_tool_call', id: item.id ?? `ctc_lcx_${index}`, call_id: item.call_id ?? `call_lcx_${index}`, name: String(item.name ?? ''), input: '' }
}

/** @param {UnknownRecord} record @param {UnknownRecord} item */
function recordMatches(record, item) {
  if (record.kind !== itemKind(item)) return false
  const recordItem = /** @type {UnknownRecord} */ (record.item)
  if (itemIdentity(recordItem) && itemIdentity(recordItem) === itemIdentity(item)) return true
  const streamed = String(record.text ?? '')
  const terminal = itemText(item)
  return streamed.length > 0 && terminal.length > 0 && (streamed === terminal || streamed.startsWith(terminal) || terminal.startsWith(streamed))
}

/**
 * Some compatible gateways omit `response.output_item.added/done`, or terminal output indexes drift
 * when a reasoning item is inserted. Normalize only the missing framing; Pi remains authoritative for item semantics.
 * @param {AsyncIterable<unknown>} source
 * @param {{ responseModel?: string }} [meta]
 */
async function* normalizedResponseEvents(source, meta = {}) {
  const open = new Map()
  const completed = new Set()
  /** @param {number} index @param {UnknownRecord} item */
  const ensure = function* (index, item) {
    let record = open.get(index)
    if (record) return record
    const normalized = normalizedTerminalItem(item, index)
    record = { kind: itemKind(normalized), item: normalized, text: '' }
    open.set(index, record)
    yield { type: 'response.output_item.added', output_index: index, item: addedShell(normalized, index) }
    return record
  }

  for await (const raw of source) {
    if (!isObject(raw)) continue
    const event = /** @type {UnknownRecord} */ (raw)
    const index = Number.isInteger(event.output_index) ? Number(event.output_index) : 0
    if (event.type === 'response.output_item.added' && isObject(event.item)) {
      const item = normalizedTerminalItem(/** @type {UnknownRecord} */ (event.item), index)
      open.set(index, { kind: itemKind(item), item, text: itemText(item) })
      yield { ...event, item }
      continue
    }
    if (event.type === 'response.output_text.delta') {
      let record = open.get(index)
      if (!record) {
        const item = { type: 'message', id: typeof event.item_id === 'string' ? event.item_id : `msg_lcx_${index}` }
        const generated = ensure(index, item)
        let next = generated.next()
        while (!next.done) { yield next.value; next = generated.next() }
        record = next.value
      }
      record.text = String(record.text ?? '') + String(event.delta ?? '')
      yield event
      continue
    }
    if (event.type === 'response.reasoning_summary_text.delta' || event.type === 'response.reasoning_text.delta') {
      let record = open.get(index)
      if (!record) {
        const item = { type: 'reasoning', id: typeof event.item_id === 'string' ? event.item_id : `rs_lcx_${index}` }
        const generated = ensure(index, item)
        let next = generated.next()
        while (!next.done) { yield next.value; next = generated.next() }
        record = next.value
      }
      record.text = String(record.text ?? '') + String(event.delta ?? '')
      yield event
      continue
    }
    if (event.type === 'response.function_call_arguments.delta') {
      let record = open.get(index)
      if (!record) {
        const item = { type: 'function_call', id: typeof event.item_id === 'string' ? event.item_id : `fc_lcx_${index}`, call_id: typeof event.call_id === 'string' ? event.call_id : `call_lcx_${index}`, name: String(event.name ?? '') }
        const generated = ensure(index, item)
        let next = generated.next()
        while (!next.done) { yield next.value; next = generated.next() }
        record = next.value
      }
      record.text = String(record.text ?? '') + String(event.delta ?? '')
      yield event
      continue
    }
    if (event.type === 'response.custom_tool_call_input.delta') {
      let record = open.get(index)
      if (!record) {
        const item = { type: 'custom_tool_call', id: typeof event.item_id === 'string' ? event.item_id : `ctc_lcx_${index}`, call_id: typeof event.call_id === 'string' ? event.call_id : `call_lcx_${index}`, name: String(event.name ?? '') }
        const generated = ensure(index, item)
        let next = generated.next()
        while (!next.done) { yield next.value; next = generated.next() }
        record = next.value
      }
      record.text = String(record.text ?? '') + String(event.delta ?? '')
      yield event
      continue
    }
    if (event.type === 'response.output_item.done' && isObject(event.item)) {
      const item = normalizedTerminalItem(/** @type {UnknownRecord} */ (event.item), index)
      const identity = itemIdentity(item)
      if (identity) completed.add(identity)
      open.delete(index)
      yield { ...event, item }
      continue
    }
    if ((event.type === 'response.completed' || event.type === 'response.incomplete') && isObject(event.response)) {
      const response = /** @type {UnknownRecord} */ (event.response)
      if (typeof response.model === 'string' && response.model.length > 0) meta.responseModel = response.model
      const output = Array.isArray(response.output) ? response.output.map((item, terminalIndex) => isObject(item) ? normalizedTerminalItem(/** @type {UnknownRecord} */ (item), terminalIndex) : item) : []
      const used = new Set()
      for (const [streamIndex, record] of open) {
        let terminalIndex = output.findIndex((item, candidateIndex) => !used.has(candidateIndex) && isObject(item) && candidateIndex === streamIndex && recordMatches(record, /** @type {UnknownRecord} */ (item)))
        if (terminalIndex < 0) terminalIndex = output.findIndex((item, candidateIndex) => !used.has(candidateIndex) && isObject(item) && recordMatches(record, /** @type {UnknownRecord} */ (item)))
        const item = terminalIndex >= 0
          ? /** @type {UnknownRecord} */ (output[terminalIndex])
          : normalizedTerminalItem(/** @type {UnknownRecord} */ (record.item), streamIndex)
        if (terminalIndex >= 0) used.add(terminalIndex)
        yield { type: 'response.output_item.done', output_index: streamIndex, item }
        const identity = itemIdentity(item)
        if (identity) completed.add(identity)
      }
      open.clear()
      for (const [terminalIndex, candidate] of output.entries()) {
        if (!isObject(candidate) || !itemKind(/** @type {UnknownRecord} */ (candidate)) || used.has(terminalIndex)) continue
        const item = /** @type {UnknownRecord} */ (candidate)
        const identity = itemIdentity(item)
        if (identity && completed.has(identity)) continue
        yield { type: 'response.output_item.added', output_index: terminalIndex, item: addedShell(item, terminalIndex) }
        const text = itemText(item)
        if (text) {
          if (item.type === 'message') yield { type: 'response.output_text.delta', output_index: terminalIndex, content_index: 0, item_id: item.id, delta: text }
          else if (item.type === 'reasoning') yield { type: 'response.reasoning_summary_text.delta', output_index: terminalIndex, summary_index: 0, item_id: item.id, delta: text }
          else if (item.type === 'function_call') yield { type: 'response.function_call_arguments.delta', output_index: terminalIndex, item_id: item.id, call_id: item.call_id, name: item.name, delta: text }
          else yield { type: 'response.custom_tool_call_input.delta', output_index: terminalIndex, item_id: item.id, call_id: item.call_id, name: item.name, delta: text }
        }
        yield { type: 'response.output_item.done', output_index: terminalIndex, item }
        if (identity) completed.add(identity)
      }
      yield { ...event, response: { ...response, output } }
      continue
    }
    yield event
  }
}

/** @param {unknown} usage */
function dshUsage(usage) {
  const value = /** @type {UnknownRecord} */ (isObject(usage) ? usage : {})
  return {
    inputTokens: Number(value.input ?? 0),
    outputTokens: Number(value.output ?? 0),
    ...(Number(value.cacheRead ?? 0) > 0 ? { cacheReadTokens: Number(value.cacheRead) } : {}),
    ...(Number(value.cacheWrite ?? 0) > 0 ? { cacheWriteTokens: Number(value.cacheWrite) } : {}),
    ...(Number(value.reasoning ?? 0) > 0 ? { reasoningTokens: Number(value.reasoning) } : {}),
  }
}

/** @param {unknown} value */
function rawArguments(value) {
  try { return JSON.stringify(isObject(value) ? value : {}) }
  catch { return '{}' }
}

/** @param {unknown} message */
function replayState(message) {
  if (!isObject(message)) return undefined
  const content = /** @type {UnknownRecord[]} */ (Array.isArray(message.content) ? message.content.filter(isObject) : [])
  const provider = typeof message.provider === 'string' ? message.provider : undefined
  const model = typeof message.model === 'string' ? message.model : undefined
  const api = typeof message.api === 'string' ? message.api : undefined
  if (!provider || !model || !api) return undefined
  return {
    response: {
      kind: 'pi-ai',
      version: 2,
      api,
      provider,
      model,
      ...(typeof message.responseModel === 'string' ? { responseModel: message.responseModel } : {}),
      ...(typeof message.responseId === 'string' ? { responseId: message.responseId } : {}),
      stopReason: message.stopReason,
    },
    blocks: content.map((block) => {
      if (block?.type === 'text') return { type: 'text', ...(typeof block.textSignature === 'string' ? { textSignature: block.textSignature } : {}) }
      if (block?.type === 'thinking') return { type: 'reasoning', ...(typeof block.thinkingSignature === 'string' ? { thinkingSignature: block.thinkingSignature } : {}), ...(typeof block.redacted === 'boolean' ? { redacted: block.redacted } : {}) }
      return {
        type: 'tool-call',
        ...(typeof block?.thoughtSignature === 'string' ? { thoughtSignature: block.thoughtSignature } : {}),
        ...(typeof block?.namespace === 'string' && block.namespace.length > 0 ? { namespace: block.namespace } : {}),
      }
    }),
  }
}

/** @param {unknown} message */
function successfulFinish(message) {
  const value = /** @type {UnknownRecord} */ (isObject(message) ? message : {})
  const stopReason = String(value.stopReason ?? 'stop')
  const content = /** @type {UnknownRecord[]} */ (Array.isArray(value.content) ? value.content.filter(isObject) : [])
  if (stopReason === 'length') return { kind: 'max-tokens' }
  if (stopReason === 'toolUse' || content.some((block) => block?.type === 'toolCall')) return { kind: 'tool-calls' }
  if (stopReason === 'stop' && content.length === 0) return { kind: 'error', failure: { message: 'Responses provider completed without content', code: 'EMPTY_RESPONSE' } }
  return { kind: 'stop' }
}

/**
 * Pi event vocabulary -> DSH StreamChunk. This remains thin and provider-neutral.
 * @param {AsyncIterable<unknown>} events
 * @param {AbortSignal} [signal]
 */
async function* toDshChunks(events, signal) {
  const toolIds = new Map()
  for await (const raw of events) {
    const event = /** @type {UnknownRecord} */ (raw)
    switch (event.type) {
      case 'start': break
      case 'text_start': yield { type: 'block-start', index: Number(event.contentIndex), blockType: 'text' }; break
      case 'text_delta': yield { type: 'text-delta', index: Number(event.contentIndex), text: String(event.delta ?? '') }; break
      case 'text_end': yield { type: 'block-end', index: Number(event.contentIndex), block: { type: 'text', text: String(event.content ?? '') } }; break
      case 'thinking_start': yield { type: 'block-start', index: Number(event.contentIndex), blockType: 'reasoning' }; break
      case 'thinking_delta': yield { type: 'reasoning-delta', index: Number(event.contentIndex), text: String(event.delta ?? '') }; break
      case 'thinking_end': yield { type: 'block-end', index: Number(event.contentIndex), block: { type: 'reasoning', text: String(event.content ?? '') } }; break
      case 'toolcall_start': {
        const partial = /** @type {UnknownRecord | undefined} */ (isObject(event.partial) ? event.partial : undefined)
        const content = Array.isArray(partial?.content) ? partial.content : []
        const block = /** @type {UnknownRecord | undefined} */ (content[Number(event.contentIndex)])
        toolIds.set(Number(event.contentIndex), { id: String(block?.id ?? ''), name: String(block?.name ?? '') })
        yield { type: 'block-start', index: Number(event.contentIndex), blockType: 'tool-call' }
        break
      }
      case 'toolcall_delta': {
        const known = toolIds.get(Number(event.contentIndex)) ?? { id: '', name: '' }
        yield { type: 'tool-call-delta', index: Number(event.contentIndex), id: known.id, ...(known.name ? { name: known.name } : {}), argumentsDelta: String(event.delta ?? '') }
        break
      }
      case 'toolcall_end': {
        const call = /** @type {UnknownRecord} */ (isObject(event.toolCall) ? event.toolCall : {})
        yield { type: 'block-end', index: Number(event.contentIndex), block: { type: 'tool-call', id: String(call.id ?? ''), name: String(call.name ?? ''), arguments: rawArguments(call.arguments) } }
        break
      }
      case 'done': {
        const message = /** @type {UnknownRecord} */ (isObject(event.message) ? event.message : {})
        yield { type: 'usage', usage: dshUsage(message.usage) }
        const reason = successfulFinish(message)
        const replay = reason.kind === 'error' ? undefined : replayState(message)
        yield { type: 'finish', reason, ...(replay === undefined ? {} : { replayState: replay }) }
        return
      }
      case 'error': {
        const message = /** @type {UnknownRecord} */ (isObject(event.error) ? event.error : {})
        yield { type: 'usage', usage: dshUsage(message.usage) }
        const failure = /** @type {ManagedFailure} */ (isObject(message.__lcxFailure) ? message.__lcxFailure : managedFailure(Object.assign(new Error(String(message.errorMessage ?? 'Responses stream failed')), { code: message.stopReason === 'aborted' ? 'LCX_ABORTED' : undefined }), signal))
        yield { type: 'finish', reason: failure.code === 'ABORTED' ? { kind: 'aborted', failure } : { kind: 'error', failure } }
        return
      }
      default: break
    }
  }
  yield managedFailureChunk(Object.assign(new Error('Responses event stream ended without done/error'), { code: 'LCX_INVALID_SSE' }), signal)
}

/**
 * Send one LCX-owned OpenAI Responses request. Ordinary and replay use one provider attempt;
 * the DSH agent recovery layer remains the visible retry owner.
 * @param {object} options
 * @param {string} options.baseURL
 * @param {string} options.provider
 * @param {string} options.model
 * @param {UnknownRecord} options.piModel
 * @param {UnknownRecord} options.body
 * @param {Map<string, string>} [options.grammarToolInputProperties]
 * @param {Record<string, string>} [options.headers]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxAttempts]
 * @param {number} [options.maxResponseBytes]
 */
export async function* streamResponsesRequest({ baseURL, provider, model, piModel, body, grammarToolInputProperties, headers, signal, timeoutMs, maxAttempts = 1, maxResponseBytes }) {
  try {
    const response = await fetchSseWithRetry(`${String(baseURL).replace(/\/+$/u, '')}/responses`, body, headers, signal, timeoutMs, { maxAttempts, maxResponseBytes })
    /** @type {import('@earendil-works/pi-ai').AssistantMessage & { __lcxFailure?: ManagedFailure }} */
    const output = {
      role: 'assistant', content: [], api: 'openai-responses', provider, model,
      usage: emptyUsage(), stopReason: 'pending', timestamp: Date.now(),
    }
    const piEvents = new PiEventQueue()
    /** @type {{ responseModel?: string }} */
    const wireMeta = {}
    const parser = (async () => {
      try {
        piEvents.push({ type: 'start', partial: output })
        await processResponsesStream(
          /** @type {AsyncIterable<ResponseStreamEvent>} */ (/** @type {unknown} */ (normalizedResponseEvents(responseEvents(response, { signal, maxResponseBytes }), wireMeta))),
          output,
          /** @type {any} */ (piEvents),
          /** @type {any} */ (piModel),
          { grammarToolInputProperties },
        )
        if (typeof wireMeta.responseModel === 'string' && wireMeta.responseModel.length > 0) output.responseModel = wireMeta.responseModel
        if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('request aborted'), { code: 'LCX_ABORTED' })
        if (output.stopReason === 'pending') throw Object.assign(new Error('Responses stream ended without a stop reason'), { code: 'LCX_INVALID_SSE' })
        if (output.stopReason === 'aborted' || output.stopReason === 'error') throw new Error('Responses stream ended in failure')
        piEvents.push({ type: 'done', reason: /** @type {'stop' | 'length' | 'toolUse' | 'deferred'} */ (output.stopReason), message: output })
        piEvents.end()
      } catch (error) {
        output.stopReason = signal?.aborted ? 'aborted' : 'error'
        output.errorMessage = error instanceof Error ? error.message : 'Responses stream failed'
        output.__lcxFailure = managedFailure(error, signal)
        piEvents.push({ type: 'error', reason: /** @type {'aborted' | 'error'} */ (output.stopReason), error: output })
        piEvents.end()
      }
    })()
    yield* toDshChunks(piEvents, signal)
    await parser
  } catch (error) {
    yield managedFailureChunk(error, signal)
  }
}
