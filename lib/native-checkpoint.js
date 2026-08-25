// @ts-check

import { baseURLFingerprint, routeCompatible } from './route.js'
import { persistNativeImageReferences } from './dsh-responses.js'
import { estimateBudgetItem, portableBudgetError, portableTokenCeiling } from './token-budget.js'

/** @typedef {Record<string, unknown>} UnknownRecord */
/** @typedef {{ type: 'compaction', encrypted_content: string }} CompactionItem */
/** @typedef {{ role: 'developer' | 'user' | 'system', content?: string | unknown[] }} RetainedClientItem */
/** @typedef {{ type: string } | RetainedClientItem} NativeOutputItem */
/** @typedef {{ provider: string, model: string, baseURL: string, sessionId: string }} RouteIdentity */
/** @typedef {{ type?: string, text?: string, id?: unknown, name?: unknown, toolCallId?: unknown, content?: DshContentBlock[] }} DshContentBlock */
/** @typedef {{ kind?: string, plugin?: string, compactionId?: string }} DshMessageSource */
/** @typedef {{ role?: string, content?: DshContentBlock[], source?: DshMessageSource }} DshMessage */
/**
 * @typedef {DshMessage & {
 *   compactionId?: string,
 *   rawOutput?: unknown[],
 *   shadowedSeqs?: number[],
 *   message?: DshMessage
 * }} SessionEventData
 */
/** @typedef {{ type: string, seq?: number, data?: SessionEventData }} SessionEvent */
/** @typedef {{ type: 'compaction/summary', seq?: number, data: SessionEventData & { compactionId: string, rawOutput?: unknown[], shadowedSeqs?: number[] } }} CompactionSummaryEvent */
/** @typedef {{ id?: string, events?: SessionEvent[], deriveEventMessage?: (event: SessionEvent) => DshMessage | null | undefined }} NativeSession */
/** @typedef {{ tokenBudget?: number, assistantTokenReserve?: number, assistantPerMessageTokenCap?: number }} RetentionOptions */
/** @typedef {{ item: unknown, index: number }} IndexedItem */
/** @typedef {{ index: number, item: unknown, tokens: number }} SelectedItem */
/** @typedef {{ selected: SelectedItem[], used: number }} Selection */
/** @typedef {{ items: unknown[], clientCount: number, assistantCount: number, estimatedTokens: number, clientEstimatedTokens: number, assistantEstimatedTokens: number }} RetentionPlan */
/**
 * @typedef {object} NativeCheckpointBase
 * @property {string} compactionId
 * @property {string} provider
 * @property {string} model
 * @property {string} baseURLFingerprint
 * @property {string} sourceSessionId
 * @property {NativeOutputItem[]} nativeOutput
 * @property {CompactionItem} [nativeCompaction]
 * @property {number} [retainedInputCount]
 * @property {number} [retainedClientCount]
 * @property {number} [retainedAssistantCount]
 * @property {number} [retainedEstimatedTokens]
 * @property {number} [createdAt]
 */
/** @typedef {NativeCheckpointBase & { type: 'lcx-native-compaction-v5', version: 5, retentionPolicy?: 'conversation-fidelity-v1' }} NativeCheckpointV5 */
/** @typedef {NativeCheckpointBase & { type: 'lcx-native-compaction-v4', version: 4 }} NativeCheckpointV4 */
/** @typedef {NativeCheckpointV5 | NativeCheckpointV4} NativeCheckpointBlock */
/**
 * Minimal validated candidate shape. DSH rawOutput is unknown until the existing
 * version, field, count, and compaction validation below has completed.
 * @typedef {object} NativeCheckpointCandidate
 * @property {typeof NATIVE_BLOCK_TYPE | typeof LEGACY_V4_BLOCK_TYPE} type
 * @property {typeof NATIVE_BLOCK_VERSION | typeof LEGACY_V4_BLOCK_VERSION} version
 * @property {unknown} [compactionId]
 * @property {unknown} [nativeOutput]
 * @property {unknown} [provider]
 * @property {unknown} [model]
 * @property {unknown} [baseURLFingerprint]
 * @property {unknown} [sourceSessionId]
 * @property {unknown} [retainedInputCount]
 * @property {unknown} [retainedClientCount]
 * @property {unknown} [retainedAssistantCount]
 */
/** @typedef {{ compaction: CompactionItem }} NativeCompactionResult */
/** @typedef {{ session: NativeSession, route: RouteIdentity, result: NativeCompactionResult, input?: unknown[], imageMap?: unknown, retentionOptions?: RetentionOptions }} CreateCheckpointOptions */
/** @typedef {Error & { code?: string }} LcxError */

export const NATIVE_BLOCK_TYPE = 'lcx-native-compaction-v5'
export const NATIVE_BLOCK_VERSION = 5
export const LEGACY_V4_BLOCK_TYPE = 'lcx-native-compaction-v4'
export const LEGACY_V4_BLOCK_VERSION = 4
const LEGACY_V3_PATTERN = /\[dsh-lcx-codex-v3-checkpoint:([0-9a-f-]{36})\]/iu

export const RETAINED_MESSAGE_TOKEN_BUDGET = 64_000
export const ASSISTANT_RETENTION_TOKEN_RESERVE = 24_000
export const ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP = 3_000

/**
 * @param {unknown} value
 * @returns {value is UnknownRecord}
 */
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
/** @param {DshMessage | null | undefined} message */
function textOf(message) { return (message?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('') }
/** @param {unknown} item */
function estimatedItemTokens(item) { return estimateBudgetItem(item) }
/**
 * @param {unknown} item
 * @returns {item is UnknownRecord}
 */
function isRetainedClientItem(item) { return isObject(item) && (item.type === undefined || item.type === 'message') && ['user', 'developer', 'system'].includes(String(item.role ?? '')) }
/**
 * @param {unknown} item
 * @returns {{ type: 'output_text', text: string }[]}
 */
function assistantTextParts(item) { if (!isObject(item) || item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) return []; return /** @type {{ type: 'output_text', text: string }[]} */ (item.content.filter((part) => /** @type {UnknownRecord | undefined} */ (part)?.type === 'output_text' && typeof /** @type {UnknownRecord} */ (part).text === 'string' && /** @type {string} */ (/** @type {UnknownRecord} */ (part).text).length > 0)) }
/** @param {unknown} item */
function isRetainedAssistantItem(item) { return assistantTextParts(item).length > 0 }
/** @param {unknown} item */
function assistantText(item) { return assistantTextParts(item).map((part) => part.text).join('') }

/**
 * @param {unknown} item
 * @param {number} [maxTokens]
 * @returns {UnknownRecord | undefined}
 */
function truncateVisibleAssistantItem(item, maxTokens = ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP) {
  const text = assistantText(item); if (!text) return undefined
  /** @param {string} retained */
  const candidate = (retained) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: retained }] })
  const full = candidate(text)
  if ((estimatedItemTokens(full) ?? Infinity) <= maxTokens) return full
  const marker = '\n…[LCX retained answer truncated]…\n'
  /** @param {number} count */
  const shortened = (count) => {
    const available = Math.max(0, count - marker.length)
    const head = Math.floor(available * 0.72); const tail = available - head
    return candidate(`${text.slice(0, head)}${marker}${text.slice(Math.max(head, text.length - tail))}`)
  }
  let low = 0; let high = text.length; let best
  while (low <= high) {
    const count = Math.floor((low + high) / 2); const next = shortened(count)
    if ((estimatedItemTokens(next) ?? Infinity) <= maxTokens) { best = next; low = count + 1 } else high = count - 1
  }
  return best
}

/**
 * @param {IndexedItem[]} candidates
 * @param {number} budget
 * @param {(value: IndexedItem) => unknown} [transform]
 * @returns {Selection}
 */
function selectNewest(candidates, budget, transform = (value) => structuredClone(value.item)) {
  /** @type {SelectedItem[]} */
  const selected = []; let used = 0
  for (let index = candidates.length - 1; index >= 0; index -= 1) { const candidate = candidates[index]; const item = transform(candidate); if (!item) continue; const tokens = estimatedItemTokens(item); if (tokens === undefined || tokens > budget || used + tokens > budget) continue; selected.push({ index: candidate.index, item, tokens }); used += tokens }
  return { selected, used }
}

/**
 * @param {unknown[] | null | undefined} input
 * @param {RetentionOptions} [options]
 * @returns {unknown[]}
 */
export function retainedCompactionInput(input, options = {}) {
  const budget = Number.isSafeInteger(options.tokenBudget) && /** @type {number} */ (options.tokenBudget) > 0 ? /** @type {number} */ (options.tokenBudget) : RETAINED_MESSAGE_TOKEN_BUDGET
  const candidates = (input ?? []).map((item, index) => ({ item, index })).filter(({ item }) => isRetainedClientItem(item))
  return selectNewest(candidates, budget).selected.sort((a, b) => a.index - b.index).map(({ item }) => item)
}

/**
 * @param {unknown[] | null | undefined} input
 * @param {RetentionOptions} [options]
 * @returns {RetentionPlan}
 */
export function retainedConversationPlan(input, options = {}) {
  const totalBudget = Number.isSafeInteger(options.tokenBudget) && /** @type {number} */ (options.tokenBudget) > 0 ? /** @type {number} */ (options.tokenBudget) : RETAINED_MESSAGE_TOKEN_BUDGET
  const assistantReserve = Math.min(totalBudget, Number.isSafeInteger(options.assistantTokenReserve) && /** @type {number} */ (options.assistantTokenReserve) >= 0 ? /** @type {number} */ (options.assistantTokenReserve) : ASSISTANT_RETENTION_TOKEN_RESERVE)
  const perMessageCap = Number.isSafeInteger(options.assistantPerMessageTokenCap) && /** @type {number} */ (options.assistantPerMessageTokenCap) > 0 ? /** @type {number} */ (options.assistantPerMessageTokenCap) : ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP
  const indexed = (input ?? []).map((item, index) => ({ item, index }))
  const assistant = selectNewest(indexed.filter(({ item }) => isRetainedAssistantItem(item)), assistantReserve, ({ item }) => truncateVisibleAssistantItem(item, perMessageCap))
  const remaining = Math.max(0, totalBudget - assistant.used)
  const client = selectNewest(indexed.filter(({ item }) => isRetainedClientItem(item)), remaining)
  const selected = [...client.selected, ...assistant.selected].sort((a, b) => a.index - b.index)
  return { items: selected.map(({ item }) => item), clientCount: client.selected.length, assistantCount: assistant.selected.length, estimatedTokens: client.used + assistant.used, clientEstimatedTokens: client.used, assistantEstimatedTokens: assistant.used }
}
/**
 * @param {unknown[] | null | undefined} input
 * @param {RetentionOptions} [options]
 */
export function retainedConversationInput(input, options = {}) { return retainedConversationPlan(input, options).items }
/** @param {unknown[] | null | undefined} items */
export function hasRetainedCompactionInput(items) { return (items ?? []).some((item) => isRetainedClientItem(item) || isRetainedAssistantItem(item)) }
/** @param {DshMessage | null | undefined} message */
export function compactCheckpointId(message) { const source = message?.source; return source?.kind === 'plugin' && source?.plugin === 'compact' && typeof source.compactionId === 'string' && source.compactionId ? source.compactionId : undefined }
/** @param {DshMessage | null | undefined} message */
export function legacyCheckpointId(message) { return textOf(message).match(LEGACY_V3_PATTERN)?.[1]?.toLowerCase() }
/** @param {NativeSession | null | undefined} session */
export function activeCompactionId(session) { if (!session?.events) return undefined; /** @type {Set<string>} */ const ended = new Set(); for (let index = session.events.length - 1; index >= 0; index -= 1) { const event = session.events[index]; if (event.type === 'compaction/end' && event.data?.compactionId) ended.add(event.data.compactionId); if (event.type === 'compaction/start' && event.data?.compactionId && !ended.has(event.data.compactionId)) return event.data.compactionId } return undefined }

/**
 * @param {CreateCheckpointOptions} options
 * @returns {NativeCheckpointV5}
 */
export function createNativeCheckpointBlock({ session, route, result, input = [], imageMap, retentionOptions = {} }) {
  const compactionId = activeCompactionId(session)
  if (!compactionId) {
    /** @type {LcxError} */
    const error = new Error('Native compaction could not correlate the active DSH compaction transaction')
    error.code = 'LCX_COMPACTION_ID_UNAVAILABLE'
    throw error
  }
  const retention = retainedConversationPlan(input, retentionOptions)
  /** @type {NativeOutputItem[]} */
  const nativeOutput = persistNativeImageReferences([...retention.items, structuredClone(result.compaction)], imageMap)
  return { type: NATIVE_BLOCK_TYPE, version: NATIVE_BLOCK_VERSION, retentionPolicy: 'conversation-fidelity-v1', compactionId, provider: route.provider, model: route.model, baseURLFingerprint: baseURLFingerprint(route.baseURL), sourceSessionId: route.sessionId, nativeOutput, nativeCompaction: structuredClone(result.compaction), retainedInputCount: retention.items.length, retainedClientCount: retention.clientCount, retainedAssistantCount: retention.assistantCount, retainedEstimatedTokens: retention.estimatedTokens, createdAt: Date.now() }
}

/**
 * @param {NativeCheckpointBlock} block
 * @param {unknown} usage
 * @returns {UnknownRecord[]}
 */
export function nativeCheckpointChunks(block, usage) {
  const text = 'LCX Native V2 checkpoint saved in the DSH session log.'
  return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'block-start', index: 1, blockType: NATIVE_BLOCK_TYPE }, { type: 'block-end', index: 1, block: structuredClone(block) }, ...(usage ? [{ type: 'usage', usage: structuredClone(usage) }] : []), { type: 'finish', reason: { kind: 'stop' } }]
}

/**
 * @param {NativeSession | null | undefined} session
 * @param {string | null | undefined} compactionId
 * @returns {CompactionSummaryEvent | undefined}
 */
export function compactionSummaryEvent(session, compactionId) { if (!session?.events || !compactionId) return undefined; for (let index = session.events.length - 1; index >= 0; index -= 1) { const event = session.events[index]; if (event.type === 'compaction/summary' && event.data?.compactionId === compactionId) return /** @type {CompactionSummaryEvent} */ (event) } return undefined }
/**
 * rawOutput elements remain untrusted until stateFromSummaryEvent validates them.
 * @param {CompactionSummaryEvent | null | undefined} event
 * @returns {NativeCheckpointCandidate | undefined}
 */
function nativeBlockFromSummary(event) { const raw = event?.data?.rawOutput ?? []; return /** @type {NativeCheckpointCandidate | undefined} */ (raw.find((value) => /** @type {UnknownRecord | undefined} */ (value)?.type === NATIVE_BLOCK_TYPE && /** @type {UnknownRecord | undefined} */ (value)?.version === NATIVE_BLOCK_VERSION) ?? raw.find((value) => /** @type {UnknownRecord | undefined} */ (value)?.type === LEGACY_V4_BLOCK_TYPE && /** @type {UnknownRecord | undefined} */ (value)?.version === LEGACY_V4_BLOCK_VERSION)) }
/** @param {unknown} value */
function validateCount(value) { return value === undefined || (Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0) }
/**
 * @param {CompactionSummaryEvent | null | undefined} event
 * @returns {NativeCheckpointBlock | undefined}
 */
export function stateFromSummaryEvent(event) {
  if (event?.type !== 'compaction/summary') return undefined
  const block = nativeBlockFromSummary(event); if (!isObject(block)) return undefined
  if (block.compactionId !== event.data.compactionId || !Array.isArray(block.nativeOutput) || block.nativeOutput.length === 0) return undefined
  if (typeof block.provider !== 'string' || typeof block.model !== 'string' || typeof block.baseURLFingerprint !== 'string' || typeof block.sourceSessionId !== 'string') return undefined
  if (!validateCount(block.retainedInputCount) || !validateCount(block.retainedClientCount) || !validateCount(block.retainedAssistantCount)) return undefined
  const compactions = block.nativeOutput.filter((item) => /** @type {UnknownRecord | undefined} */ (item)?.type === 'compaction'); if (compactions.length !== 1 || typeof /** @type {UnknownRecord | undefined} */ (compactions[0])?.encrypted_content !== 'string') return undefined
  const compactionIndex = block.nativeOutput.findIndex((item) => /** @type {UnknownRecord | undefined} */ (item)?.type === 'compaction'); const prefix = compactionIndex >= 0 ? block.nativeOutput.slice(0, compactionIndex) : []
  if (block.version === NATIVE_BLOCK_VERSION) { const clients = prefix.filter(isRetainedClientItem).length; const assistants = prefix.filter(isRetainedAssistantItem).length; const total = clients + assistants; if (block.retainedInputCount !== undefined && block.retainedInputCount !== total) return undefined; if (block.retainedClientCount !== undefined && block.retainedClientCount !== clients) return undefined; if (block.retainedAssistantCount !== undefined && block.retainedAssistantCount !== assistants) return undefined } else { const clients = prefix.filter(isRetainedClientItem).length; if (block.retainedInputCount !== undefined && block.retainedInputCount !== clients) return undefined }
  return /** @type {NativeCheckpointBlock} */ (structuredClone(block))
}
/**
 * @param {NativeSession} session
 * @param {DshMessage} message
 */
export function checkpointStateForMessage(session, message) { const id = compactCheckpointId(message); return id ? stateFromSummaryEvent(compactionSummaryEvent(session, id)) : undefined }
/**
 * @param {NativeCheckpointBlock} state
 * @param {RouteIdentity} route
 * @param {unknown} ctx
 */
export function stateRouteCompatible(state, route, ctx) { return routeCompatible(state, route, ctx) }
/**
 * @param {NativeSession | null | undefined} session
 * @param {number} seq
 * @returns {DshMessage | undefined}
 */
function eventMessage(session, seq) { const events = session?.events ?? []; const event = events[seq]?.seq === seq ? events[seq] : events.find((candidate) => candidate?.seq === seq); if (!event) return undefined; if (typeof /** @type {NativeSession} */ (session).deriveEventMessage === 'function') return /** @type {(event: SessionEvent) => DshMessage | null | undefined} */ (/** @type {NativeSession} */ (session).deriveEventMessage)(event) ?? undefined; if (event.type === 'user/message') return event.data; if (event.type === 'assistant/message') return event.data?.message; if (event.type === 'tool/result') return event.data?.message; return undefined }
/** @param {DshMessage} message */
function estimateChars(message) { try { const encoded = JSON.stringify(message); return typeof encoded === 'string' ? encoded.length : undefined } catch { return undefined } }
/**
 * @param {NativeSession} session
 * @param {string} compactionId
 * @param {Set<string>} visited
 * @param {number} depth
 * @returns {DshMessage[]}
 */
function expandedCheckpointMessages(session, compactionId, visited, depth) { if (depth > 16 || visited.has(compactionId)) return []; visited.add(compactionId); const summary = compactionSummaryEvent(session, compactionId); if (!summary) return []; const result = []; for (const seq of summary.data?.shadowedSeqs ?? []) { const message = eventMessage(session, seq); if (!message) continue; const nested = compactCheckpointId(message); if (nested) result.push(...expandedCheckpointMessages(session, nested, visited, depth + 1)); else result.push(structuredClone(message)) } return result }
/**
 * @param {NativeSession} session
 * @param {string} compactionId
 * @returns {DshMessage[]}
 */
export function shadowedMessagesForCheckpoint(session, compactionId) { return expandedCheckpointMessages(session, compactionId, /** @type {Set<string>} */ (new Set()), 0) }
/**
 * @param {DshMessage[]} messages
 * @returns {DshMessage[][]}
 */
function groupMessages(messages) { const groups = []; for (let index = 0; index < messages.length; index += 1) { const message = messages[index]; const toolCalls = message?.role === 'assistant' ? (message.content ?? []).filter((b) => b?.type === 'tool-call').map((b) => String(b.id)) : []; if (toolCalls.length === 0) { groups.push([message]); continue } const group = [message]; const pending = new Set(toolCalls); let cursor = index + 1; while (cursor < messages.length && pending.size > 0) { const next = messages[cursor]; const results = next?.role === 'user' ? (next.content ?? []).filter((b) => b?.type === 'tool-result').map((b) => String(b.toolCallId)) : []; if (results.length === 0) break; group.push(next); for (const id of results) pending.delete(id); cursor += 1 } if (pending.size === 0) index = cursor - 1; groups.push(group) } return groups }
/**
 * @param {NativeSession} session
 * @param {string} compactionId
 * @param {{ maxChars?: number }} [options]
 * @returns {DshMessage[]}
 */
export function portableMessagesForCheckpoint(session, compactionId, options = {}) {
  const maxChars = Number.isSafeInteger(options.maxChars) && /** @type {number} */ (options.maxChars) > 0 ? /** @type {number} */ (options.maxChars) : 80_000
  const maxTokens = portableTokenCeiling(maxChars) ?? 1
  const expanded = shadowedMessagesForCheckpoint(session, compactionId); if (expanded.length === 0) return []
  const groups = groupMessages(expanded); const kept = []; let chars = 0; let tokens = 0
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]
    let groupChars = 0; let groupTokens = 0; let budgetable = true
    for (const message of group) {
      const messageChars = estimateChars(message); const messageTokens = estimatedItemTokens(message)
      if (messageChars === undefined || messageTokens === undefined) { budgetable = false; break }
      groupChars += messageChars; groupTokens += messageTokens
    }
    const exceeds = !budgetable || chars + groupChars > maxChars || tokens + groupTokens > maxTokens
    if (exceeds) {
      if (kept.length === 0) throw portableBudgetError('Portable checkpoint newest message group exceeds the configured budget')
      break
    }
    kept.unshift(...group); chars += groupChars; tokens += groupTokens
  }
  return kept
}
/**
 * @param {DshMessage[]} messages
 * @param {NativeSession} session
 * @param {{ maxChars?: number }} [options]
 * @returns {DshMessage[]}
 */
export function rewriteCheckpointsPortable(messages, session, options = {}) { const rewritten = []; let changed = false; for (const message of messages ?? []) { const id = compactCheckpointId(message); if (!id || !checkpointStateForMessage(session, message)) { rewritten.push(message); continue } const portable = portableMessagesForCheckpoint(session, id, options); if (portable.length === 0) { rewritten.push(message); continue } rewritten.push(...portable); changed = true } return changed ? rewritten : messages }
