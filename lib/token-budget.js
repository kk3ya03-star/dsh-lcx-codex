// @ts-check

/** @typedef {Record<string, unknown>} UnknownRecord */

export const PORTABLE_BUDGET_ERROR_CODE = 'LCX_PORTABLE_BUDGET_EXCEEDED'
const MAX_BUDGET_INPUT_CHARS = 2_000_000
const CONSERVATIVE_IMAGE_TOKEN_COST = 2_048
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const ASCII_WORD = /[A-Za-z0-9]/u
const STRUCTURAL = /[\p{P}\p{S}]/u
const DATA_URI = /^data:[^;,\s]+(?:;[^,\s]*)?;base64,[A-Za-z0-9+/\s]+={0,2}$/u
const ENCODED_TEXT = /^[A-Za-z0-9+/_-]{512,}={0,2}$/u

/** @param {string} value */
function looksEncodedText(value) { return DATA_URI.test(value) || ENCODED_TEXT.test(value) }

/**
 * A small conservative fallback, deliberately not a tokenizer. The baseline
 * preserves legacy /4 while CJK and structural characters cost more.
 * @param {unknown} value
 * @returns {number | undefined}
 */
export function estimateTextTokens(value) {
  if (typeof value !== 'string') return undefined
  if (value.length > MAX_BUDGET_INPUT_CHARS || looksEncodedText(value)) return Math.max(1, value.length)
  let weighted = 0
  let asciiRun = 0
  const flushAscii = () => { if (asciiRun > 0) weighted += Math.ceil(asciiRun / 4); asciiRun = 0 }
  for (const char of value) {
    if (ASCII_WORD.test(char)) { asciiRun += 1; continue }
    flushAscii()
    if (/\s/u.test(char)) continue
    if (CJK.test(char) || STRUCTURAL.test(char)) weighted += 1
    else weighted += Math.ceil(char.length / 2)
  }
  flushAscii()
  return Math.max(1, Math.ceil(value.length / 4), weighted)
}

/**
 * @param {unknown} value
 * @returns {value is UnknownRecord}
 */
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
/**
 * @param {unknown} value
 * @param {Set<object>} [seen]
 * @returns {boolean}
 */
function containsOpaqueValue(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return false
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || seen.has(value)) return true
  seen.add(value)
  return Object.values(value).some((entry) => containsOpaqueValue(entry, seen))
}
/** @param {unknown} value */
function safeJson(value) { try { if (containsOpaqueValue(value)) return undefined; const encoded = JSON.stringify(value); return typeof encoded === 'string' ? encoded : undefined } catch { return undefined } }
/** @param {unknown} value */
function safeScalar(value) { return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined }

/**
 * @param {unknown} content
 * @returns {unknown[] | undefined}
 */
function visibleContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return undefined
  const parts = []
  for (const part of content) {
    if (!isObject(part) || typeof part.type !== 'string') return undefined
    if (['text', 'input_text', 'output_text'].includes(part.type)) {
      if (typeof part.text !== 'string') return undefined
      parts.push({ type: part.type, text: part.text })
      continue
    }
    if (part.type === 'reasoning') {
      if (typeof part.text !== 'string') return undefined
      parts.push({ type: 'reasoning', text: part.text })
      continue
    }
    if (part.type === 'tool-call') {
      const id = safeScalar(part.id); const name = safeScalar(part.name); const argumentsText = safeJson(part.arguments)
      if (id === undefined || name === undefined || argumentsText === undefined) return undefined
      parts.push({ type: 'tool-call', id, name, arguments: argumentsText })
      continue
    }
    if (part.type === 'tool-result') {
      const toolCallId = safeScalar(part.toolCallId); const toolName = safeScalar(part.toolName ?? part.name ?? 'unknown'); const nested = visibleContent(part.content)
      if (toolCallId === undefined || toolName === undefined || nested === undefined) return undefined
      parts.push({ type: 'tool-result', toolCallId, toolName, content: nested })
      continue
    }
    if (['image', 'input_image', 'output_image', 'dsh_image_attachment'].includes(part.type)) {
      parts.push({ type: part.type, image: true })
      continue
    }
    return undefined
  }
  return parts
}

/**
 * Project an item to model-visible fields only. Opaque provider state, raw
 * binary, and replay/session metadata are intentionally excluded.
 * @param {unknown} item
 * @returns {unknown | undefined}
 */
export function modelVisibleBudgetView(item) {
  if (!isObject(item)) return undefined
  if (item.type === 'function_call') {
    const callId = safeScalar(item.call_id); const name = safeScalar(item.name); const argumentsText = safeJson(item.arguments)
    return callId === undefined || name === undefined || argumentsText === undefined ? undefined : { type: 'function_call', call_id: callId, name, arguments: argumentsText }
  }
  if (item.type === 'function_call_output') {
    const callId = safeScalar(item.call_id); const output = typeof item.output === 'string' ? item.output : safeJson(item.output)
    return callId === undefined || output === undefined ? undefined : { type: 'function_call_output', call_id: callId, output }
  }
  if (item.type !== undefined && item.type !== 'message') return undefined
  if (!['developer', 'system', 'user', 'assistant'].includes(String(item.role ?? ''))) return undefined
  const content = visibleContent(item.content)
  return content === undefined ? undefined : { role: String(item.role), content }
}

/**
 * Images have provider/model-dependent costs. Count each known image block with
 * a fixed conservative surcharge without inspecting base64 or attachment data.
 * @param {unknown} value
 * @returns {number}
 */
function imageTokenCost(value) {
  if (Array.isArray(value)) {
    let total = 0
    for (const entry of value) total += imageTokenCost(entry)
    return total
  }
  if (!isObject(value)) return 0
  let total = value.image === true ? CONSERVATIVE_IMAGE_TOKEN_COST : 0
  for (const entry of Object.values(value)) total += imageTokenCost(entry)
  return total
}

/**
 * @param {unknown} item
 * @returns {number | undefined}
 */
export function estimateBudgetItem(item) {
  const view = modelVisibleBudgetView(item)
  if (view === undefined) return undefined
  const encoded = safeJson(view)
  const textCost = estimateTextTokens(encoded)
  return textCost === undefined ? undefined : textCost + imageTokenCost(view)
}

/** @param {unknown} maxChars */
export function portableTokenCeiling(maxChars) {
  return Number.isSafeInteger(maxChars) && /** @type {number} */ (maxChars) > 0 ? Math.ceil(/** @type {number} */ (maxChars) / 4) : undefined
}

/** @param {string} message */
export function portableBudgetError(message) {
  /** @type {Error & { code?: string }} */
  const error = new Error(message)
  error.code = PORTABLE_BUDGET_ERROR_CODE
  return error
}
