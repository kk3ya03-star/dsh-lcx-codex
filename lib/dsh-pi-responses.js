import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared'
import { offloadRequestImages } from '@deepseek-ai/dsh-llm'

export const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const RESPONSES_TOOL_CALL_PROVIDERS = new Set(['openai', 'openai-codex', 'opencode'])

function compactError(message, code, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause })
  error.code = code
  return error
}

function invalidReplay(message) {
  return compactError(`invalid pi-ai replay state: ${message}`, 'LCX_COMPACT_INVALID_REPLAY_STATE')
}

function unsupportedContent(type) {
  return compactError(
    `LCX Compact cannot safely serialize DSH message content type: ${String(type)}`,
    'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT',
  )
}

function parseArguments(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    // Match the DSH pi-ai adapter: malformed model arguments replay as an empty object.
  }
  return {}
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
}

function replayBlockType(type) {
  if (type === 'text') return 'text'
  if (type === 'reasoning') return 'reasoning'
  if (type === 'tool-call') return 'tool-call'
  return undefined
}

export function readDshPiReplayState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidReplay('expected a replay envelope')
  const response = value.response
  if (response === null || typeof response !== 'object' || Array.isArray(response)) throw invalidReplay('expected a response object')
  if (response.kind !== 'pi-ai') throw invalidReplay('unknown state kind')
  if (response.version !== 2) throw invalidReplay(`unsupported version ${String(response.version)}`)
  for (const key of ['api', 'provider', 'model']) {
    if (typeof response[key] !== 'string' || response[key].length === 0) throw invalidReplay(`${key} must be a non-empty string`)
  }
  if (!['stop', 'length', 'toolUse', 'error', 'aborted'].includes(response.stopReason)) throw invalidReplay('unknown stopReason')
  if (response.responseModel !== undefined && typeof response.responseModel !== 'string') throw invalidReplay('responseModel must be a string')
  if (response.responseId !== undefined && typeof response.responseId !== 'string') throw invalidReplay('responseId must be a string')
  if (!Array.isArray(value.blocks)) throw invalidReplay('blocks must be an array')
  for (const [index, block] of value.blocks.entries()) {
    if (block === null || typeof block !== 'object' || Array.isArray(block)) throw invalidReplay(`block ${index} must be an object`)
    if (!['text', 'reasoning', 'tool-call'].includes(block.type)) throw invalidReplay(`block ${index} has an unknown type`)
    for (const signature of ['textSignature', 'thinkingSignature', 'thoughtSignature']) {
      if (block[signature] !== undefined && typeof block[signature] !== 'string') {
        throw invalidReplay(`block ${index} ${signature} must be a string`)
      }
    }
    if (block.redacted !== undefined && typeof block.redacted !== 'boolean') throw invalidReplay(`block ${index} redacted must be boolean`)
  }
  return { response, blocks: value.blocks }
}

function foreignAssistant(message) {
  const source = message?.source?.kind === 'model' ? message.source : undefined
  const content = []
  for (const block of message.content ?? []) {
    if (block?.type === 'text') content.push({ type: 'text', text: block.text })
    else if (block?.type === 'reasoning') content.push({ type: 'thinking', thinking: block.text })
    else if (block?.type === 'tool-call') {
      content.push({ type: 'toolCall', id: String(block.id), name: String(block.name), arguments: parseArguments(block.arguments) })
    } else if (block?.type === 'image') {
      throw unsupportedContent('assistant image')
    } else {
      throw unsupportedContent(block?.type)
    }
  }
  return {
    role: 'assistant',
    content,
    api: 'dsh-foreign',
    provider: source?.provider ?? 'dsh-foreign',
    model: source?.model ?? 'dsh-foreign',
    usage: emptyUsage(),
    stopReason: content.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: 0,
  }
}

function replayedAssistant(message, source) {
  const state = readDshPiReplayState(source.replayState)
  if (state.response.provider !== source.provider) throw invalidReplay('provider does not match assistant source')
  if (state.response.model !== source.model) throw invalidReplay('model does not match assistant source')
  if (state.blocks.length !== message.content.length) throw invalidReplay('block count does not match assistant content')
  const content = message.content.map((block, index) => {
    const replay = state.blocks[index]
    if (replayBlockType(block?.type) !== replay?.type) throw invalidReplay(`block ${index} does not match assistant content`)
    if (block.type === 'text') {
      return { type: 'text', text: block.text, ...(replay.textSignature === undefined ? {} : { textSignature: replay.textSignature }) }
    }
    if (block.type === 'reasoning') {
      return {
        type: 'thinking',
        thinking: block.text,
        ...(replay.thinkingSignature === undefined ? {} : { thinkingSignature: replay.thinkingSignature }),
        ...(replay.redacted === undefined ? {} : { redacted: replay.redacted }),
      }
    }
    return {
      type: 'toolCall',
      id: String(block.id),
      name: String(block.name),
      arguments: parseArguments(block.arguments),
      ...(replay.thoughtSignature === undefined ? {} : { thoughtSignature: replay.thoughtSignature }),
    }
  })
  return {
    role: 'assistant',
    content,
    api: state.response.api,
    provider: state.response.provider,
    model: state.response.model,
    ...(state.response.responseModel === undefined ? {} : { responseModel: state.response.responseModel }),
    ...(state.response.responseId === undefined ? {} : { responseId: state.response.responseId }),
    usage: emptyUsage(),
    stopReason: state.response.stopReason,
    timestamp: 0,
  }
}

function toPiAssistant(message, onReplayDegrade) {
  const source = message?.source
  if (source?.kind !== 'model' || source.replayState === undefined) return foreignAssistant(message)
  try {
    return replayedAssistant(message, source)
  } catch (error) {
    if (error?.code !== 'LCX_COMPACT_INVALID_REPLAY_STATE') throw error
    onReplayDegrade?.(error.message)
    return foreignAssistant(message)
  }
}

function hasImageBlocks(blocks) {
  return (blocks ?? []).some((block) => block?.type === 'image' || (block?.type === 'tool-result' && hasImageBlocks(block.content)))
}

export async function resolveDshImage(block, options = {}) {
  if (typeof options.resolveImage !== 'function') {
    throw compactError('LCX Compact cannot resolve image attachment without the DSH attachment service', 'LCX_COMPACT_IMAGE_UNAVAILABLE')
  }
  let stored
  try {
    stored = await options.resolveImage(block, options.signal)
  } catch (error) {
    if (error?.code?.startsWith?.('LCX_COMPACT_IMAGE_')) throw error
    throw compactError('LCX Compact failed to read image attachment', 'LCX_COMPACT_IMAGE_UNAVAILABLE', error)
  }
  const data = stored?.data
  const mediaType = String(stored?.mediaType ?? stored?.ref?.mediaType ?? block?.attachment?.mediaType ?? '').toLowerCase()
  const bytes = data?.byteLength ?? data?.length
  if (!SUPPORTED_IMAGE_MEDIA_TYPES.has(mediaType)) {
    throw compactError(`LCX Compact does not support image media type: ${mediaType || 'missing'}`, 'LCX_COMPACT_IMAGE_UNSUPPORTED')
  }
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw compactError('LCX Compact received empty or invalid image attachment data', 'LCX_COMPACT_IMAGE_UNAVAILABLE')
  }
  const base64 = Buffer.from(data).toString('base64')
  const maxBytes = options.maxRequestImageBytes ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES
  if (base64.length > maxBytes) {
    throw compactError(`LCX Compact image attachment exceeds the ${maxBytes}-byte base64 payload limit`, 'LCX_COMPACT_IMAGE_TOO_LARGE')
  }
  const imageUrl = `data:${mediaType};base64,${base64}`
  options.onImageResolved?.({ imageUrl, attachment: structuredClone(stored?.ref ?? block.attachment) })
  return { type: 'image', data: base64, mimeType: mediaType }
}

async function piUserContent(blocks, options) {
  const content = []
  for (const block of blocks ?? []) {
    if (block?.type === 'text') {
      if (block.text.length > 0) content.push({ type: 'text', text: block.text })
    } else if (block?.type === 'reasoning') {
      continue
    } else if (block?.type === 'image') {
      if (options.imageSupport === 'unsupported') {
        content.push({ type: 'image', data: '', mimeType: block?.attachment?.mediaType ?? 'image/png' })
      } else {
        content.push(await resolveDshImage(block, options))
      }
    } else if (block?.type === 'tool-result') {
      const nested = await piUserContent(block.content, options)
      if (typeof nested === 'string') {
        if (nested.length > 0) content.push({ type: 'text', text: nested })
      } else {
        content.push(...nested)
      }
    } else {
      throw unsupportedContent(block?.type)
    }
  }
  if (content.every((block) => block.type === 'text')) return content.map((block) => block.text).join('')
  return content
}

async function dshToPiContext(messages, options) {
  const converted = []
  const toolNames = new Map()
  for (const message of messages ?? []) {
    if (message === null || typeof message !== 'object' || Array.isArray(message) || !Array.isArray(message.content)) {
      throw unsupportedContent('message')
    }
    if (message.role === 'system') {
      if (hasImageBlocks(message.content)) throw unsupportedContent('system image')
      const text = message.content.filter((block) => block?.type === 'text').map((block) => block.text).join('')
      if (message.content.some((block) => block?.type !== 'text' && block?.type !== 'reasoning')) throw unsupportedContent('system block')
      if (text) converted.push({ role: 'user', content: text, timestamp: 0 })
      continue
    }
    if (message.role === 'assistant') {
      const assistant = toPiAssistant(message, options.onReplayDegrade)
      for (const block of assistant.content) {
        if (block.type === 'toolCall') toolNames.set(block.id, block.name)
      }
      converted.push(assistant)
      continue
    }
    if (message.role !== 'user') throw unsupportedContent(`message role ${String(message.role)}`)
    const ordinary = message.content.filter((block) => block?.type !== 'tool-result')
    if (ordinary.some((block) => !['text', 'reasoning', 'image'].includes(block?.type))) throw unsupportedContent(ordinary.find((block) => !['text', 'reasoning', 'image'].includes(block?.type))?.type)
    const content = await piUserContent(ordinary, options)
    const results = message.content.filter((block) => block?.type === 'tool-result')
    if ((typeof content === 'string' ? content.length > 0 : content.length > 0) || results.length === 0) {
      converted.push({ role: 'user', content, timestamp: 0 })
    }
    for (const result of results) {
      const resultContent = await piUserContent(result.content, options)
      converted.push({
        role: 'toolResult',
        toolCallId: String(result.toolCallId),
        toolName: toolNames.get(String(result.toolCallId)) ?? 'unknown',
        content: typeof resultContent === 'string'
          ? [{ type: 'text', text: resultContent || '(no output)' }]
          : resultContent,
        isError: result.isError ?? false,
        timestamp: 0,
      })
    }
  }
  return { messages: converted }
}

export async function resolveModelImageSupport(llm, route, signal) {
  if (typeof llm?.resolveModelInfo !== 'function') return 'unknown'
  try {
    const model = await llm.resolveModelInfo(route.provider, route.model, signal)
    if (!Array.isArray(model?.inputModalities)) return 'unknown'
    return model.inputModalities.includes('image') ? 'supported' : 'unsupported'
  } catch {
    return 'unknown'
  }
}

export async function serializeDshResponsesInput(messages, options = {}) {
  const route = options.route ?? {}
  const imageSupport = options.imageSupport ?? 'unknown'
  if (!['supported', 'unsupported', 'unknown'].includes(imageSupport)) {
    throw compactError(`Invalid LCX Compact image capability: ${String(imageSupport)}`, 'LCX_COMPACT_IMAGE_CAPABILITY_UNKNOWN')
  }
  if (imageSupport === 'unknown' && (messages ?? []).some((message) => hasImageBlocks(message?.content))) {
    throw compactError('LCX Compact cannot determine whether the target model accepts images', 'LCX_COMPACT_IMAGE_CAPABILITY_UNKNOWN')
  }
  const context = await dshToPiContext(messages, { ...options, imageSupport })
  const model = {
    id: String(route.model ?? ''),
    name: String(route.model ?? ''),
    api: 'openai-responses',
    provider: String(route.provider ?? ''),
    baseUrl: String(route.baseURL ?? ''),
    input: imageSupport === 'supported' ? ['text', 'image'] : ['text'],
    reasoning: true,
    contextWindow: 1,
    maxTokens: 1,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  const allowedToolCallProviders = new Set([...RESPONSES_TOOL_CALL_PROVIDERS, model.provider])
  const converted = convertResponsesMessages(model, context, allowedToolCallProviders, { includeSystemPrompt: false })
  // Pi emits user messages in the SDK shorthand `{ role, content }`. DSH's
  // checkpoint/store contract is the explicit Responses item shape, so make
  // that boundary canonical without changing Pi's internal serializer.
  const stripImageDetail = (value) => {
    if (!Array.isArray(value)) return value
    return value.map((part) => {
      if (part?.type === 'input_image') {
        const { detail: _detail, ...withoutDetail } = part
        return withoutDetail
      }
      return part
    })
  }
  return converted.map((item) => {
    if (item?.role === 'user') {
      const content = typeof item.content === 'string'
        ? [{ type: 'input_text', text: item.content }]
        : item.content
      return { ...(item.type === undefined ? { type: 'message' } : {}), role: 'user', content: stripImageDetail(content) }
    }
    if (item?.type === 'function_call_output') return { ...item, output: stripImageDetail(item.output) }
    return item
  })
}

function hasCompleteImageMetadata(messages) {
  const complete = (blocks) => blocks.every((block) => {
    if (block.type === 'image') {
      const bytes = Number(block.attachment?.bytes)
      return Number.isSafeInteger(bytes) && bytes > 0
    }
    return block.type !== 'tool-result' || complete(block.content)
  })
  return messages.every((message) => complete(message.content))
}

export function offloadDshRequestImages(messages, maxRequestImageBytes = DEFAULT_MAX_REQUEST_IMAGE_BYTES) {
  if (!Number.isSafeInteger(maxRequestImageBytes) || maxRequestImageBytes <= 0) {
    throw compactError('LCX Compact maxRequestImageBytes must be a positive integer', 'LCX_COMPACT_IMAGE_LIMIT_INVALID')
  }
  const input = messages ?? []
  return hasCompleteImageMetadata(input)
    ? offloadRequestImages(input, maxRequestImageBytes)
    : input
}
