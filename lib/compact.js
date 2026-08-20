import { createHash } from 'node:crypto'
import { offloadDshRequestImages, resolveDshImage, serializeDshResponsesInput } from './dsh-pi-responses.js'

const UNSUPPORTED_CHECKPOINT_PATTERN = /\[dsh-lcx-codex-checkpoint:[0-9a-f-]{36}\]/iu
const PORTABLE_CHECKPOINT_PATTERN = /\[dsh-lcx-codex-v3-checkpoint:([0-9a-f-]{36})\]/giu
const PORTABLE_HISTORY_TOKEN_BUDGET = 20_000
export const PORTABLE_HISTORY_BYTE_BUDGET = 2 * 1024 * 1024
const UNSUPPORTED_IMAGE_PLACEHOLDER = '[image omitted because the target model does not support image input]'

export function portableCheckpointIds(text) {
  return [...String(text ?? '').matchAll(PORTABLE_CHECKPOINT_PATTERN)].map((match) => match[1].toLowerCase())
}

export function textOfContent(content) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

export function textOfMessage(message) {
  return textOfContent(message?.content)
}

function toolResultText(block) {
  return textOfContent(block?.content) || '(no output)'
}

function unsupportedPortableContentError(type) {
  const error = new Error(`LCX Compact cannot safely portable-replay message content type: ${String(type)}`)
  error.code = 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT'
  return error
}

function compactImageError(message, code, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause })
  error.code = code
  return error
}

function containsImage(content) {
  return (Array.isArray(content) ? content : []).some((block) =>
    block?.type === 'image' || (block?.type === 'tool-result' && containsImage(block.content)))
}

export function inputImageCount(input) {
  return (input ?? []).reduce((count, item) => {
    const content = item?.type === 'message' ? item.content : item?.type === 'function_call_output' ? item.output : undefined
    return count + (Array.isArray(content)
      ? content.filter((part) => part?.type === 'input_image' || part?.type === 'dsh_image_attachment').length
      : 0)
  }, 0)
}

async function inputImagePart(block, options = {}) {
  const image = await resolveDshImage(block, options)
  return { type: 'input_image', image_url: `data:${image.mimeType};base64,${image.data}` }
}

function assertSupportedBlocks(blocks, { allowImage }) {
  const supported = new Set(['text', 'tool-call', 'tool-result', 'reasoning', ...(allowImage ? ['image'] : [])])
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!supported.has(block?.type)) throw unsupportedPortableContentError(block?.type)
    if (block.type === 'tool-result') assertSupportedBlocks(block.content, { allowImage })
  }
}

async function toolResultOutputWithImages(block, options) {
  const parts = []
  let text = ''
  const flushText = () => {
    if (text) parts.push({ type: 'input_text', text })
    text = ''
  }
  for (const part of block?.content ?? []) {
    if (part?.type === 'text') text += part.text
    else if (part?.type === 'image') {
      flushText()
      parts.push(await inputImagePart(part, options))
    } else if (part?.type === 'tool-result') {
      const nested = await toolResultOutputWithImages(part, options)
      if (typeof nested === 'string') text += nested === '(no output)' ? '' : nested
      else {
        flushText()
        parts.push(...nested)
      }
    }
  }
  flushText()
  return parts.some((part) => part.type === 'input_image') ? parts : parts.map((part) => part.text).join('') || '(no output)'
}

async function messageInputItemsWithImages(message, options = {}) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  if (!containsImage(blocks)) return messageInputItems(message, options)
  if (message?.role !== 'user') {
    throw compactImageError('LCX Compact only supports image attachments in user messages or tool results', 'LCX_COMPACT_IMAGE_UNSUPPORTED')
  }
  if (options.strict) assertSupportedBlocks(blocks, { allowImage: true })
  const content = []
  let pendingText = ''
  const flushText = () => {
    if (pendingText) content.push({ type: 'input_text', text: pendingText })
    pendingText = ''
  }
  for (const block of blocks) {
    if (block?.type === 'text') pendingText += block.text
    else if (block?.type === 'image') {
      flushText()
      content.push(await inputImagePart(block, options))
    }
  }
  flushText()
  const items = []
  if (content.length > 0) items.push({ type: 'message', role: 'user', content })
  for (const call of blocks.filter((block) => block?.type === 'tool-call')) {
    items.push({
      type: 'function_call',
      call_id: String(call.id),
      name: String(call.name),
      arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
    })
  }
  for (const result of blocks.filter((block) => block?.type === 'tool-result')) {
    items.push({
      type: 'function_call_output',
      call_id: String(result.toolCallId),
      output: containsImage(result.content) ? await toolResultOutputWithImages(result, options) : toolResultText(result),
    })
  }
  return items
}

export async function normalInputWithImages(messages, options = {}) {
  const input = []
  for (const message of messages ?? []) {
    if (message?.role === 'system') continue
    input.push(...await messageInputItemsWithImages(message, options))
  }
  return input
}

function mapImageContent(value, mapper) {
  if (!Array.isArray(value)) return value
  return value.map((part) => {
    if (part?.type === 'input_image' || part?.type === 'dsh_image_attachment') return mapper(part)
    return part?.type === 'function_call_output' && Array.isArray(part.output)
      ? { ...part, output: mapImageContent(part.output, mapper) }
      : structuredClone(part)
  })
}

export function persistNativeImageReferences(output, references) {
  const referenceMap = references instanceof Map ? references : new Map()
  const persistPart = (part) => {
    if (part.type !== 'input_image' || typeof part.image_url !== 'string') {
      throw compactImageError('LCX Compact response contains an invalid image item', 'LCX_COMPACT_INVALID_RESPONSE')
    }
    const attachment = referenceMap.get(part.image_url)
    if (!attachment) {
      throw compactImageError('LCX Compact response contains an untracked image item', 'LCX_COMPACT_INVALID_RESPONSE')
    }
    return { type: 'dsh_image_attachment', attachment: structuredClone(attachment) }
  }
  return (output ?? []).map((item) => {
    if (item?.type === 'message' && Array.isArray(item.content)) {
      return { ...structuredClone(item), content: mapImageContent(item.content, persistPart) }
    }
    if (item?.type === 'function_call_output' && Array.isArray(item.output)) {
      return { ...structuredClone(item), output: mapImageContent(item.output, persistPart) }
    }
    return structuredClone(item)
  })
}

async function hydrateImageContent(content, options) {
  const hydrated = []
  for (const part of content ?? []) {
    if (part?.type === 'dsh_image_attachment') {
      hydrated.push(await inputImagePart({ type: 'image', attachment: part.attachment }, options))
    } else {
      hydrated.push(structuredClone(part))
    }
  }
  return hydrated
}

export async function hydrateNativeImageReferences(output, options = {}) {
  const hydrated = []
  for (const item of output ?? []) {
    if (item?.type === 'message' && Array.isArray(item.content)) {
      hydrated.push({ ...structuredClone(item), content: await hydrateImageContent(item.content, options) })
    } else if (item?.type === 'function_call_output' && Array.isArray(item.output)) {
      hydrated.push({ ...structuredClone(item), output: await hydrateImageContent(item.output, options) })
    } else {
      hydrated.push(structuredClone(item))
    }
  }
  return hydrated
}

function messageInputItems(message, { strict = false } = {}) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  if (strict) assertSupportedBlocks(blocks, { allowImage: false })
  const text = textOfContent(blocks)
  const calls = blocks.filter((block) => block?.type === 'tool-call')
  const results = blocks.filter((block) => block?.type === 'tool-result')
  const items = []

  if (message?.role === 'assistant') {
    if (text) items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
    for (const call of calls) {
      items.push({
        type: 'function_call',
        call_id: String(call.id),
        name: String(call.name),
        arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
      })
    }
    return items
  }

  if (text) items.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] })
  for (const result of results) {
    items.push({
      type: 'function_call_output',
      call_id: String(result.toolCallId),
      output: toolResultText(result),
    })
  }
  return items
}

export function normalInput(messages, options = {}) {
  const input = []
  for (const message of messages ?? []) {
    if (message?.role === 'system') continue
    input.push(...messageInputItems(message, options))
  }
  return input
}

export function routeFingerprint(route) {
  // Keep the final empty slot for compatibility with v3 fingerprints already
  // written before the nonexistent GenerateOptions.branchId field was removed.
  const value = [route?.provider ?? '', route?.model ?? '', route?.baseURL ?? '', route?.sessionId ?? '', ''].join('\u001f')
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function checkpointRouteMismatchDimensions(record, route) {
  const dimensions = []
  if (record.provider !== String(route?.provider ?? '')) dimensions.push('provider')
  if (record.model !== String(route?.model ?? '')) dimensions.push('model')
  if ((record.sessionId ?? '') !== String(route?.sessionId ?? '')) dimensions.push('session')
  if (dimensions.length === 0) dimensions.push('base URL or route configuration')
  return dimensions
}

export function assertCheckpointRoute(record, route) {
  const expected = routeFingerprint(route)
  const semanticMismatch = record.modelKey !== `${record.provider}:${record.model}` ||
    record.provider !== String(route?.provider ?? '') ||
    record.model !== String(route?.model ?? '')
  if (semanticMismatch || record.routeFingerprint !== expected) {
    const dimensions = checkpointRouteMismatchDimensions(record, route)
    const guidance = dimensions.includes('session')
      ? 'Resume the original DSH session or start a new session without this checkpoint marker.'
      : 'Use the original provider/model/base URL or create a new checkpoint.'
    const error = new Error(`LCX checkpoint route mismatch (${dimensions.join(', ')}): checkpoint=${record.routeFingerprint ?? 'missing'} current=${expected}. ${guidance}`)
    error.code = 'LCX_CHECKPOINT_ROUTE_MISMATCH'
    throw error
  }
}

function assertNoUnsupportedCheckpointMarker(messages) {
  for (const message of messages ?? []) {
    if (message?.role !== 'user') continue
    if (!UNSUPPORTED_CHECKPOINT_PATTERN.test(textOfMessage(message))) continue
    const error = new Error('LCX checkpoint v2 markers are unsupported; use a v3 checkpoint')
    error.code = 'LCX_CHECKPOINT_V2_UNSUPPORTED'
    throw error
  }
}

export function baseURLFingerprint(baseURL) {
  return createHash('sha256').update(String(baseURL ?? '').replace(/\/+$/u, ''), 'utf8').digest('hex')
}

export function latestPortableMarker(messages) {
  assertNoUnsupportedCheckpointMarker(messages)
  let found
  for (let index = 0; index < (messages?.length ?? 0); index += 1) {
    if (messages[index]?.role !== 'user') continue
    const ids = portableCheckpointIds(textOfMessage(messages[index]))
    if (ids.length > 1) {
      const error = new Error('LCX message contains multiple v3 checkpoint markers')
      error.code = 'LCX_CHECKPOINT_V3_CORRUPT'
      throw error
    }
    if (ids.length === 1) found = { id: ids[0], index }
  }
  return found
}

export function hasPortableCheckpoint(messages) {
  return latestPortableMarker(messages) !== undefined
}

export function buildPortableHistory(input, options = {}) {
  const tokenBudget = options.tokenBudget ?? PORTABLE_HISTORY_TOKEN_BUDGET
  const byteBudget = options.byteBudget ?? PORTABLE_HISTORY_BYTE_BUDGET
  let remainingChars = tokenBudget * 4
  let remainingBytes = byteBudget
  const candidates = []
  for (const item of input ?? []) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    if (typeof item.type !== 'string') continue
    if (item.type === 'compaction' || item.type === 'context_compaction' || item.type === 'compaction_trigger') continue
    if (item.type.startsWith('response.')) continue
    if (Object.prototype.hasOwnProperty.call(item, 'encrypted_content')) continue
    let candidate = item
    if (item.type === 'message') {
      const expectedType = item.role === 'assistant' ? 'output_text' : item.role === 'user' ? 'input_text' : undefined
      const parts = Array.isArray(item.content) ? item.content : []
      const imageParts = parts.filter((part) => part?.type === 'input_image')
      if (imageParts.length > 0) {
        if (!options.omitInputImages) throw unsupportedPortableContentError('input_image')
        candidate = { ...item, content: parts.filter((part) => part?.type === expectedType) }
        if (candidate.content.length === 0) continue
      }
      if (!expectedType || !Array.isArray(candidate.content) || candidate.content.some((part) =>
        !isObject(part) || (part.type !== 'dsh_image_attachment' &&
          (part.type !== expectedType || typeof part.text !== 'string')))) {
        throw unsupportedPortableContentError(item.type)
      }
    } else if (item.type === 'function_call_output' && Array.isArray(item.output)) {
      const imageParts = item.output.filter((part) => part?.type === 'input_image')
      if (imageParts.length > 0) {
        if (!options.omitInputImages) throw unsupportedPortableContentError('input_image')
        candidate = { ...item, output: item.output.filter((part) => part?.type !== 'input_image') }
      }
      if (candidate.output.some((part) => !isObject(part) ||
        (part.type !== 'dsh_image_attachment' &&
          (!['input_text', 'output_text'].includes(part.type) || typeof part.text !== 'string')))) {
        throw unsupportedPortableContentError('function_call_output')
      }
    } else if (item.type !== 'function_call' && item.type !== 'function_call_output') {
      throw unsupportedPortableContentError(item.type)
    }
    candidates.push(candidate)
  }
  const callsById = new Map()
  const outputsById = new Map()
  for (let index = 0; index < candidates.length; index += 1) {
    const item = candidates[index]
    if (item.type === 'function_call' && typeof item.call_id === 'string' && item.call_id.length > 0 &&
      typeof item.name === 'string' && item.name.length > 0 && typeof item.arguments === 'string') {
      const indexes = callsById.get(item.call_id) ?? []
      indexes.push(index)
      callsById.set(item.call_id, indexes)
    }
    if (item.type === 'function_call_output' && typeof item.call_id === 'string' && item.call_id.length > 0 &&
      Object.prototype.hasOwnProperty.call(item, 'output')) {
      const indexes = outputsById.get(item.call_id) ?? []
      indexes.push(index)
      outputsById.set(item.call_id, indexes)
    }
  }

  const pairedIndexes = new Set()
  const units = []
  for (const [callId, callIndexes] of callsById) {
    const outputIndexes = outputsById.get(callId)
    if (callIndexes.length !== 1 || outputIndexes?.length !== 1) continue
    const callIndex = callIndexes[0]
    const outputIndex = outputIndexes[0]
    if (callIndex >= outputIndex) continue
    const indexes = [callIndex, outputIndex]
    for (const index of indexes) pairedIndexes.add(index)
    units.push({ indexes, items: indexes.map((index) => candidates[index]) })
  }
  for (let index = 0; index < candidates.length; index += 1) {
    const item = candidates[index]
    if (pairedIndexes.has(index)) continue
    if (item.type === 'function_call' || item.type === 'function_call_output') continue
    units.push({ indexes: [index], items: [item] })
  }
  units.sort((left, right) => left.indexes[0] - right.indexes[0])

  const retainedUnits = []
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index]
    let unitBytes = 0
    let unitChars = 0
    for (const item of unit.items) {
      const serialized = JSON.stringify(item)
      unitBytes += Buffer.byteLength(serialized, 'utf8')
      unitChars += serialized.length
    }
    if (unitBytes > remainingBytes || unitChars > remainingChars) continue
    retainedUnits.push(unit)
    remainingBytes -= unitBytes
    remainingChars -= unitChars
    if (remainingBytes <= 128 || remainingChars <= 32) break
  }

  return retainedUnits
    .flatMap((unit) => unit.indexes.map((index, itemIndex) => ({ index, item: structuredClone(unit.items[itemIndex]) })))
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.item)
}

function portableCheckpointMismatchDimensions(record, route) {
  if (!record || !route) return ['route']
  const dimensions = []
  if (record.provider !== String(route.provider ?? '')) dimensions.push('provider')
  if (record.baseURLFingerprint !== baseURLFingerprint(route.baseURL)) dimensions.push('endpoint')
  const sessionId = String(route.sessionId ?? '')
  const sameSessionLineage = !sessionId || record.lineageId === sessionId ||
    (Array.isArray(route.ancestorSessionIds) && route.ancestorSessionIds.includes(record.lineageId))
  if (!sameSessionLineage) dimensions.push('session')
  return dimensions.length > 0 ? dimensions : ['route']
}

export function portableCheckpointState(record, route) {
  if (!record || !route) return 'route-mismatch'
  const currentSessionId = String(route.sessionId ?? '')
  const hasSessionIdentity = currentSessionId.length > 0
  const sameLineage = record.lineageId === currentSessionId ||
    (Array.isArray(route.ancestorSessionIds) && route.ancestorSessionIds.includes(record.lineageId))
  const sameProvider = record.provider === String(route.provider ?? '')
  const sameBaseURL = record.baseURLFingerprint === baseURLFingerprint(route.baseURL)
  if (hasSessionIdentity && sameLineage && record.routeFingerprint === routeFingerprint(route)) return 'native-compatible'
  if (sameProvider && sameBaseURL && (!hasSessionIdentity || sameLineage)) return 'portable-migratable'
  return 'route-mismatch'
}

function portableSummaryItem(summary) {
  if (typeof summary !== 'string' || summary.length === 0) return []
  return [{
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: summary }],
  }]
}

export function buildPortableResponsesInput(messages, store, route) {
  const marker = latestPortableMarker(messages)
  if (!marker) return normalInput(messages, { strict: true })
  const record = store.get(marker.id)
  if (!record) {
    const error = new Error(`LCX v3 checkpoint ${marker.id} is missing from ${store.file}`)
    error.code = 'LCX_CHECKPOINT_V3_CORRUPT'
    throw error
  }
  const state = portableCheckpointState(record, route)
  if (state === 'route-mismatch') {
    const dimensions = portableCheckpointMismatchDimensions(record, route)
    const error = new Error(`LCX v3 checkpoint cannot migrate; route mismatch dimensions: ${dimensions.join(', ')}`)
    error.code = 'LCX_CHECKPOINT_ROUTE_MISMATCH'
    throw error
  }
  const prefix = state === 'native-compatible'
    ? record.nativeOutput
    : [...portableSummaryItem(record.portableSummary), ...buildPortableHistory(record.portableHistory)]
  const tail = normalInput((messages ?? []).slice(marker.index + 1), { strict: true })
  return [...structuredClone(prefix), ...tail]
}

export async function buildPortableResponsesInputWithImages(messages, store, route, options = {}) {
  const marker = latestPortableMarker(messages)
  const imageSupport = options.imageSupport ?? (typeof options.resolveImage === 'function' ? 'supported' : 'unknown')
  const requestMessages = offloadDshRequestImages(messages, options.maxRequestImageBytes)
  if (!marker) return serializeDshResponsesInput(requestMessages, { ...options, imageSupport, route })
  const record = store.get(marker.id)
  if (!record) {
    const error = new Error(`LCX v3 checkpoint ${marker.id} is missing from ${store.file}`)
    error.code = 'LCX_CHECKPOINT_V3_CORRUPT'
    throw error
  }
  const state = portableCheckpointState(record, route)
  if (state === 'route-mismatch') {
    const dimensions = portableCheckpointMismatchDimensions(record, route)
    const error = new Error(`LCX v3 checkpoint cannot migrate; route mismatch dimensions: ${dimensions.join(', ')}`)
    error.code = 'LCX_CHECKPOINT_ROUTE_MISMATCH'
    throw error
  }
  const portableImages = Number(record.portableImageCount ?? inputImageCount(record.portableHistory))
  const durableImages = inputImageCount(record.portableHistory)
  if (state === 'portable-migratable' && portableImages > durableImages) {
    throw compactImageError(`LCX checkpoint portable migration cannot restore ${portableImages} image attachment(s)`, 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT')
  }
  let portableHistory
  if (state === 'portable-migratable') {
    portableHistory = buildPortableHistory(record.portableHistory)
    if (durableImages > 0) {
      if (imageSupport === 'unknown') {
        throw compactImageError('LCX Compact cannot determine whether the target model accepts checkpoint images', 'LCX_COMPACT_IMAGE_CAPABILITY_UNKNOWN')
      }
      portableHistory = imageSupport === 'supported'
        ? await hydrateNativeImageReferences(portableHistory, options)
        : portableHistory.map((item) => {
          const key = item?.type === 'message' ? 'content' : item?.type === 'function_call_output' ? 'output' : undefined
          if (!key || !Array.isArray(item[key])) return structuredClone(item)
          const textType = item.type === 'message' && item.role === 'assistant' ? 'output_text' : 'input_text'
          return {
            ...structuredClone(item),
            [key]: item[key].map((part) => part?.type === 'dsh_image_attachment'
              ? { type: textType, text: UNSUPPORTED_IMAGE_PLACEHOLDER }
              : structuredClone(part)),
          }
        })
    }
  }
  const prefix = state === 'native-compatible'
    ? await hydrateNativeImageReferences(record.nativeOutput, options)
    : [...portableSummaryItem(record.portableSummary), ...portableHistory]
  const tail = state === 'native-compatible'
    ? await serializeDshResponsesInput(requestMessages.slice(marker.index + 1), { ...options, imageSupport, route })
    : await serializeDshResponsesInput(requestMessages.slice(marker.index + 1), { ...options, imageSupport, route })
  return [...prefix, ...tail]
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function compactOutputShape(response) {
  const output = Array.isArray(response?.output) ? response.output : []
  const types = output.slice(0, 20).map((item) => {
    const type = item && typeof item === 'object' && typeof item.type === 'string' ? item.type : typeof item
    return String(type).replace(/[^a-zA-Z0-9._:-]/gu, '').slice(0, 48) || 'unknown'
  })
  return `object=${String(response?.object ?? 'missing')} outputLength=${output.length} outputTypes=[${types.join(',')}]`
}

function invalidOutputItem(message) {
  const error = new Error(`LCX compact response contains an invalid output item: ${message}`)
  error.code = 'LCX_COMPACT_INVALID_RESPONSE'
  return error
}

function validContent(content) {
  return Array.isArray(content) && content.every((part) => isObject(part) && typeof part.type === 'string' &&
    (part.text === undefined || typeof part.text === 'string'))
}

function validateOutputItems(output) {
  const itemIds = new Set()
  const callIds = new Set()
  const outputIds = new Set()
  const calls = new Set()
  const outputs = new Set()
  for (const item of output) {
    if (!isObject(item) || typeof item.type !== 'string' || item.type.length === 0) throw invalidOutputItem('missing type')
    if (item.id !== undefined) {
      if (typeof item.id !== 'string' || item.id.length === 0 || itemIds.has(item.id)) throw invalidOutputItem('duplicate or invalid id')
      itemIds.add(item.id)
    }
    if (item.type === 'compaction_trigger' || item.type === 'context_compaction' || item.type.startsWith('response.')) {
      throw invalidOutputItem(`invalid trigger/type ${item.type}`)
    }
    if (item.type === 'message') {
      if (!['assistant', 'developer', 'system', 'user'].includes(item.role) || !validContent(item.content)) {
        throw invalidOutputItem('message shape')
      }
      continue
    }
    if (item.type === 'function_call') {
      if (typeof item.call_id !== 'string' || item.call_id.length === 0 || callIds.has(item.call_id) ||
        typeof item.name !== 'string' || item.name.length === 0 || typeof item.arguments !== 'string') {
        throw invalidOutputItem('function_call shape')
      }
      callIds.add(item.call_id)
      calls.add(item.call_id)
      continue
    }
    if (item.type === 'function_call_output') {
      if (typeof item.call_id !== 'string' || item.call_id.length === 0 || outputIds.has(item.call_id) ||
        !(typeof item.output === 'string' || Array.isArray(item.output))) {
        throw invalidOutputItem('function_call_output shape')
      }
      outputIds.add(item.call_id)
      outputs.add(item.call_id)
      continue
    }
    if (item.type === 'compaction') {
      if (typeof item.encrypted_content !== 'string' || item.encrypted_content.length === 0) {
        throw invalidOutputItem('compaction encrypted_content')
      }
      continue
    }
    if (item.type === 'reasoning') {
      if (item.encrypted_content !== undefined && typeof item.encrypted_content !== 'string') {
        throw invalidOutputItem('reasoning encrypted_content')
      }
      if (item.content !== undefined && !validContent(item.content)) throw invalidOutputItem('reasoning content')
      if (item.summary !== undefined && !validContent(item.summary)) throw invalidOutputItem('reasoning summary')
      continue
    }
    if (Object.prototype.hasOwnProperty.call(item, 'encrypted_content')) throw invalidOutputItem('encrypted non-compaction item')
  }
  for (const callId of outputs) {
    if (!calls.has(callId)) throw invalidOutputItem(`orphan function_call_output ${callId}`)
  }
  for (const callId of calls) {
    if (!outputs.has(callId)) throw invalidOutputItem(`orphan function_call ${callId}`)
  }
}

export function normalizeCompactionResponse(response) {
  if (response?.error) {
    const error = new Error(response.error.message ?? 'LCX compact request failed')
    error.code = 'LCX_COMPACT_HTTP_ERROR'
    throw error
  }
  if (response?.object !== undefined && !['response.compaction', 'response'].includes(response.object)) {
    const error = new Error(`Unexpected compact response object: ${String(response.object)}`)
    error.code = 'LCX_COMPACT_INVALID_RESPONSE'
    throw error
  }
  if (!Array.isArray(response?.output)) {
    const error = new Error('LCX compact response has no output array')
    error.code = 'LCX_COMPACT_INVALID_RESPONSE'
    throw error
  }
  if (response.output.some((item) => item?.type === 'compaction_trigger')) {
    throw invalidOutputItem('invalid trigger compaction_trigger')
  }
  const compactions = response.output.filter((item) => item?.type === 'compaction')
  if (compactions.length === 0) {
    const error = new Error(`LCX compact response has no compaction item (${compactOutputShape(response)})`)
    error.code = 'LCX_COMPACT_MISSING_ITEM'
    throw error
  }
  if (compactions.length !== 1) {
    const error = new Error(`LCX compact response has ${compactions.length} compaction items`)
    error.code = 'LCX_COMPACT_MULTIPLE_ITEMS'
    throw error
  }
  if (typeof compactions[0].encrypted_content !== 'string' || compactions[0].encrypted_content.length === 0) {
    const error = new Error('LCX compact response has empty encrypted_content')
    error.code = 'LCX_COMPACT_EMPTY_ENCRYPTED_CONTENT'
    throw error
  }
  validateOutputItems(response.output)
  const compaction = compactions[0]
  return {
    output: structuredClone(response.output),
    compaction: structuredClone(compaction),
    responseId: typeof response.id === 'string' ? response.id : undefined,
  }
}
