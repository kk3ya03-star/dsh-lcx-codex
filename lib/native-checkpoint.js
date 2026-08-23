import { baseURLFingerprint, routeCompatible } from './route.js'
import { persistNativeImageReferences } from './dsh-responses.js'

export const NATIVE_BLOCK_TYPE = 'lcx-native-compaction-v5'
export const NATIVE_BLOCK_VERSION = 5
export const LEGACY_V4_BLOCK_TYPE = 'lcx-native-compaction-v4'
export const LEGACY_V4_BLOCK_VERSION = 4
const LEGACY_V3_PATTERN = /\[dsh-lcx-codex-v3-checkpoint:([0-9a-f-]{36})\]/iu

export const RETAINED_MESSAGE_TOKEN_BUDGET = 64_000
export const ASSISTANT_RETENTION_TOKEN_RESERVE = 24_000
export const ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP = 3_000

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function textOf(message) { return (message?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('') }
function estimatedItemTokens(item) { try { return Math.max(1, Math.ceil(JSON.stringify(item).length / 4)) } catch { return RETAINED_MESSAGE_TOKEN_BUDGET + 1 } }
function isRetainedClientItem(item) { return isObject(item) && (item.type === undefined || item.type === 'message') && ['user', 'developer', 'system'].includes(String(item.role ?? '')) }
function assistantTextParts(item) { if (!isObject(item) || item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) return []; return item.content.filter((part) => part?.type === 'output_text' && typeof part.text === 'string' && part.text.length > 0) }
function isRetainedAssistantItem(item) { return assistantTextParts(item).length > 0 }
function assistantText(item) { return assistantTextParts(item).map((part) => part.text).join('') }

function truncateVisibleAssistantItem(item, maxTokens = ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP) {
  const text = assistantText(item); if (!text) return undefined
  const maxChars = Math.max(256, maxTokens * 4); let retained = text
  if (text.length > maxChars) { const marker = '\n…[LCX retained answer truncated]…\n'; const available = Math.max(0, maxChars - marker.length); const head = Math.floor(available * 0.72); const tail = available - head; retained = `${text.slice(0, head)}${marker}${text.slice(Math.max(head, text.length - tail))}` }
  return { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: retained }] }
}

function selectNewest(candidates, budget, transform = (value) => structuredClone(value.item)) {
  const selected = []; let used = 0
  for (let index = candidates.length - 1; index >= 0; index -= 1) { const candidate = candidates[index]; const item = transform(candidate); if (!item) continue; const tokens = estimatedItemTokens(item); if (tokens > budget || used + tokens > budget) continue; selected.push({ index: candidate.index, item, tokens }); used += tokens }
  return { selected, used }
}

export function retainedCompactionInput(input, options = {}) {
  const budget = Number.isSafeInteger(options.tokenBudget) && options.tokenBudget > 0 ? options.tokenBudget : RETAINED_MESSAGE_TOKEN_BUDGET
  const candidates = (input ?? []).map((item, index) => ({ item, index })).filter(({ item }) => isRetainedClientItem(item))
  return selectNewest(candidates, budget).selected.sort((a, b) => a.index - b.index).map(({ item }) => item)
}

export function retainedConversationPlan(input, options = {}) {
  const totalBudget = Number.isSafeInteger(options.tokenBudget) && options.tokenBudget > 0 ? options.tokenBudget : RETAINED_MESSAGE_TOKEN_BUDGET
  const assistantReserve = Math.min(totalBudget, Number.isSafeInteger(options.assistantTokenReserve) && options.assistantTokenReserve >= 0 ? options.assistantTokenReserve : ASSISTANT_RETENTION_TOKEN_RESERVE)
  const perMessageCap = Number.isSafeInteger(options.assistantPerMessageTokenCap) && options.assistantPerMessageTokenCap > 0 ? options.assistantPerMessageTokenCap : ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP
  const indexed = (input ?? []).map((item, index) => ({ item, index }))
  const assistant = selectNewest(indexed.filter(({ item }) => isRetainedAssistantItem(item)), assistantReserve, ({ item }) => truncateVisibleAssistantItem(item, perMessageCap))
  const remaining = Math.max(0, totalBudget - assistant.used)
  const client = selectNewest(indexed.filter(({ item }) => isRetainedClientItem(item)), remaining)
  const selected = [...client.selected, ...assistant.selected].sort((a, b) => a.index - b.index)
  return { items: selected.map(({ item }) => item), clientCount: client.selected.length, assistantCount: assistant.selected.length, estimatedTokens: client.used + assistant.used, clientEstimatedTokens: client.used, assistantEstimatedTokens: assistant.used }
}
export function retainedConversationInput(input, options = {}) { return retainedConversationPlan(input, options).items }
export function hasRetainedCompactionInput(items) { return (items ?? []).some((item) => isRetainedClientItem(item) || isRetainedAssistantItem(item)) }
export function compactCheckpointId(message) { const source = message?.source; return source?.kind === 'plugin' && source?.plugin === 'compact' && typeof source.compactionId === 'string' && source.compactionId ? source.compactionId : undefined }
export function legacyCheckpointId(message) { return textOf(message).match(LEGACY_V3_PATTERN)?.[1]?.toLowerCase() }
export function activeCompactionId(session) { if (!session?.events) return undefined; const ended = new Set(); for (let index = session.events.length - 1; index >= 0; index -= 1) { const event = session.events[index]; if (event.type === 'compaction/end' && event.data?.compactionId) ended.add(event.data.compactionId); if (event.type === 'compaction/start' && event.data?.compactionId && !ended.has(event.data.compactionId)) return event.data.compactionId } return undefined }

export function createNativeCheckpointBlock({ session, route, result, input = [], imageMap, retentionOptions = {} }) {
  const compactionId = activeCompactionId(session)
  if (!compactionId) { const error = new Error('Native compaction could not correlate the active DSH compaction transaction'); error.code = 'LCX_COMPACTION_ID_UNAVAILABLE'; throw error }
  const retention = retainedConversationPlan(input, retentionOptions)
  const nativeOutput = persistNativeImageReferences([...retention.items, structuredClone(result.compaction)], imageMap)
  return { type: NATIVE_BLOCK_TYPE, version: NATIVE_BLOCK_VERSION, retentionPolicy: 'conversation-fidelity-v1', compactionId, provider: route.provider, model: route.model, baseURLFingerprint: baseURLFingerprint(route.baseURL), sourceSessionId: route.sessionId, nativeOutput, nativeCompaction: structuredClone(result.compaction), retainedInputCount: retention.items.length, retainedClientCount: retention.clientCount, retainedAssistantCount: retention.assistantCount, retainedEstimatedTokens: retention.estimatedTokens, createdAt: Date.now() }
}

export function nativeCheckpointChunks(block, usage) {
  const text = 'LCX Native V2 checkpoint saved in the DSH session log.'
  return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'block-start', index: 1, blockType: NATIVE_BLOCK_TYPE }, { type: 'block-end', index: 1, block: structuredClone(block) }, ...(usage ? [{ type: 'usage', usage: structuredClone(usage) }] : []), { type: 'finish', reason: { kind: 'stop' } }]
}

export function compactionSummaryEvent(session, compactionId) { if (!session?.events || !compactionId) return undefined; for (let index = session.events.length - 1; index >= 0; index -= 1) { const event = session.events[index]; if (event.type === 'compaction/summary' && event.data?.compactionId === compactionId) return event } return undefined }
function nativeBlockFromSummary(event) { const raw = event?.data?.rawOutput ?? []; return raw.find((value) => value?.type === NATIVE_BLOCK_TYPE && value?.version === NATIVE_BLOCK_VERSION) ?? raw.find((value) => value?.type === LEGACY_V4_BLOCK_TYPE && value?.version === LEGACY_V4_BLOCK_VERSION) }
function validateCount(value) { return value === undefined || (Number.isSafeInteger(value) && value >= 0) }
export function stateFromSummaryEvent(event) {
  if (event?.type !== 'compaction/summary') return undefined
  const block = nativeBlockFromSummary(event); if (!isObject(block)) return undefined
  if (block.compactionId !== event.data.compactionId || !Array.isArray(block.nativeOutput) || block.nativeOutput.length === 0) return undefined
  if (typeof block.provider !== 'string' || typeof block.model !== 'string' || typeof block.baseURLFingerprint !== 'string' || typeof block.sourceSessionId !== 'string') return undefined
  if (!validateCount(block.retainedInputCount) || !validateCount(block.retainedClientCount) || !validateCount(block.retainedAssistantCount)) return undefined
  const compactions = block.nativeOutput.filter((item) => item?.type === 'compaction'); if (compactions.length !== 1 || typeof compactions[0]?.encrypted_content !== 'string') return undefined
  const compactionIndex = block.nativeOutput.findIndex((item) => item?.type === 'compaction'); const prefix = compactionIndex >= 0 ? block.nativeOutput.slice(0, compactionIndex) : []
  if (block.version === NATIVE_BLOCK_VERSION) { const clients = prefix.filter(isRetainedClientItem).length; const assistants = prefix.filter(isRetainedAssistantItem).length; const total = clients + assistants; if (block.retainedInputCount !== undefined && block.retainedInputCount !== total) return undefined; if (block.retainedClientCount !== undefined && block.retainedClientCount !== clients) return undefined; if (block.retainedAssistantCount !== undefined && block.retainedAssistantCount !== assistants) return undefined } else { const clients = prefix.filter(isRetainedClientItem).length; if (block.retainedInputCount !== undefined && block.retainedInputCount !== clients) return undefined }
  return structuredClone(block)
}
export function checkpointStateForMessage(session, message) { const id = compactCheckpointId(message); return id ? stateFromSummaryEvent(compactionSummaryEvent(session, id)) : undefined }
export function stateRouteCompatible(state, route, ctx) { return routeCompatible(state, route, ctx) }
function eventMessage(session, seq) { const events = session?.events ?? []; const event = events[seq]?.seq === seq ? events[seq] : events.find((candidate) => candidate?.seq === seq); if (!event) return undefined; if (typeof session.deriveEventMessage === 'function') return session.deriveEventMessage(event) ?? undefined; if (event.type === 'user/message') return event.data; if (event.type === 'assistant/message') return event.data?.message; if (event.type === 'tool/result') return event.data?.message; return undefined }
function estimateChars(message) { try { return JSON.stringify(message).length } catch { return 0 } }
function expandedCheckpointMessages(session, compactionId, visited, depth) { if (depth > 16 || visited.has(compactionId)) return []; visited.add(compactionId); const summary = compactionSummaryEvent(session, compactionId); if (!summary) return []; const result = []; for (const seq of summary.data?.shadowedSeqs ?? []) { const message = eventMessage(session, seq); if (!message) continue; const nested = compactCheckpointId(message); if (nested) result.push(...expandedCheckpointMessages(session, nested, visited, depth + 1)); else result.push(structuredClone(message)) } return result }
export function shadowedMessagesForCheckpoint(session, compactionId) { return expandedCheckpointMessages(session, compactionId, new Set(), 0) }
function groupMessages(messages) { const groups = []; for (let index = 0; index < messages.length; index += 1) { const message = messages[index]; const toolCalls = message?.role === 'assistant' ? (message.content ?? []).filter((b) => b?.type === 'tool-call').map((b) => String(b.id)) : []; if (toolCalls.length === 0) { groups.push([message]); continue } const group = [message]; const pending = new Set(toolCalls); let cursor = index + 1; while (cursor < messages.length && pending.size > 0) { const next = messages[cursor]; const results = next?.role === 'user' ? (next.content ?? []).filter((b) => b?.type === 'tool-result').map((b) => String(b.toolCallId)) : []; if (results.length === 0) break; group.push(next); for (const id of results) pending.delete(id); cursor += 1 } if (pending.size === 0) index = cursor - 1; groups.push(group) } return groups }
export function portableMessagesForCheckpoint(session, compactionId, options = {}) { const maxChars = Number.isSafeInteger(options.maxChars) && options.maxChars > 0 ? options.maxChars : 80_000; const expanded = shadowedMessagesForCheckpoint(session, compactionId); if (expanded.length === 0) return []; const groups = groupMessages(expanded); const kept = []; let chars = 0; for (let index = groups.length - 1; index >= 0; index -= 1) { const group = groups[index]; const size = group.reduce((sum, message) => sum + estimateChars(message), 0); if (kept.length > 0 && chars + size > maxChars) break; kept.unshift(...group); chars += size } return kept }
export function rewriteCheckpointsPortable(messages, session, options = {}) { const rewritten = []; let changed = false; for (const message of messages ?? []) { const id = compactCheckpointId(message); if (!id || !checkpointStateForMessage(session, message)) { rewritten.push(message); continue } const portable = portableMessagesForCheckpoint(session, id, options); if (portable.length === 0) { rewritten.push(message); continue } rewritten.push(...portable); changed = true } return changed ? rewritten : messages }
