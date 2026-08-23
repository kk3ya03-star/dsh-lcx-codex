import { offloadRequestImagesWithPolicy } from '@deepseek-ai/dsh-llm'
import { convertResponsesMessages, convertResponsesTools } from '@earendil-works/pi-ai/api/openai-responses-shared'
import { createGrammarToolInputProperties } from '@earendil-works/pi-ai/api/constrained-sampling'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024
export { DEFAULT_MAX_REQUEST_IMAGE_BYTES, DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET, DEFAULT_REQUEST_IMAGE_MAX_BYTES }

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }

function error(message, code) {
  const value = new Error(message)
  value.code = code
  return value
}

export async function resolveModelImageSupport(ctx, route, signal) {
  const llm = ctx?.get?.('llm') ?? ctx?.llm
  if (typeof llm?.resolveModelInfo !== 'function') return 'unknown'
  try {
    const info = await llm.resolveModelInfo(route.provider, route.model, signal)
    const modalities = info?.inputModalities
    if (!Array.isArray(modalities)) return 'unknown'
    return modalities.includes('image') ? 'supported' : 'unsupported'
  } catch {
    return 'unknown'
  }
}

function attachmentResolver(ctx, options) {
  const attachments = ctx?.get?.('attachments') ?? ctx?.attachments
  return async (block, signal) => {
    if (typeof attachments?.readImageRequest !== 'function') {
      throw error('LCX requires the DSH 0.1.1-rc.2 request-image attachment API', 'LCX_COMPACT_IMAGE_API_UNAVAILABLE')
    }
    const request = await attachments.readImageRequest(block?.attachment, {
      maxPixels: options.requestImagePixelBudget,
      maxBytes: options.requestImageMaxBytes,
    }, signal)
    const data = request?.data
    const mediaType = request?.mediaType ?? block?.attachment?.mediaType
    if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data)) throw error('DSH attachment returned no request-image bytes', 'LCX_COMPACT_IMAGE_UNAVAILABLE')
    if (typeof mediaType !== 'string' || !mediaType.startsWith('image/')) throw error('DSH attachment returned an invalid request-image media type', 'LCX_COMPACT_IMAGE_UNAVAILABLE')
    return { data: Buffer.from(data), mediaType, ref: request?.attachment ?? block.attachment }
  }
}

async function imagePart(block, ctx, options, imageMap) {
  if (options.imageSupport === 'unsupported') return { type: 'input_text', text: '[image omitted because the target model does not support image input]' }
  const image = await attachmentResolver(ctx, options)(block, options.signal)
  const encodedBytes = Math.ceil(image.data.byteLength / 3) * 4
  if (encodedBytes > options.maxRequestImageBytes) throw error('one image exceeds the configured LCX request image bound', 'LCX_COMPACT_IMAGE_TOO_LARGE')
  const imageUrl = `data:${image.mediaType};base64,${image.data.toString('base64')}`
  imageMap.set(imageUrl, structuredClone(image.ref))
  return { type: 'input_image', detail: 'auto', image_url: imageUrl }
}

async function piImagePart(block, ctx, options, imageMap) {
  if (options.imageSupport === 'unsupported') return { type: 'text', text: '[image omitted because the target model does not support image input]' }
  const image = await attachmentResolver(ctx, options)(block, options.signal)
  const encodedBytes = Math.ceil(image.data.byteLength / 3) * 4
  if (encodedBytes > options.maxRequestImageBytes) throw error('one image exceeds the configured LCX request image bound', 'LCX_COMPACT_IMAGE_TOO_LARGE')
  const data = image.data.toString('base64')
  imageMap.set(`data:${image.mediaType};base64,${data}`, structuredClone(image.ref))
  return { type: 'image', data, mimeType: image.mediaType }
}

function parseArguments(value) {
  if (typeof value !== 'string') return value && typeof value === 'object' ? structuredClone(value) : {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
}

function invalidReplay(message) { return error(`invalid pi-ai replay state: ${message}`, 'LCX_COMPACT_INVALID_REPLAY_STATE') }
function unsupportedContent(type) { return error(`LCX Compact cannot safely serialize DSH message content type: ${String(type)}`, 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT') }
function replayBlockType(type) { if (type === 'text') return 'text'; if (type === 'reasoning') return 'reasoning'; if (type === 'tool-call') return 'tool-call'; return undefined }

export function readDshPiReplayState(value) {
  if (!isObject(value)) throw invalidReplay('expected a replay envelope')
  const response = value.response
  if (!isObject(response)) throw invalidReplay('expected a response object')
  if (response.kind !== 'pi-ai') throw invalidReplay('unknown state kind')
  if (response.version !== 2) throw invalidReplay(`unsupported version ${String(response.version)}`)
  for (const key of ['api', 'provider', 'model']) if (typeof response[key] !== 'string' || response[key].length === 0) throw invalidReplay(`${key} must be a non-empty string`)
  if (!['stop', 'length', 'toolUse', 'error', 'aborted'].includes(response.stopReason)) throw invalidReplay('unknown stopReason')
  if (response.responseModel !== undefined && typeof response.responseModel !== 'string') throw invalidReplay('responseModel must be a string')
  if (response.responseId !== undefined && typeof response.responseId !== 'string') throw invalidReplay('responseId must be a string')
  if (!Array.isArray(value.blocks)) throw invalidReplay('blocks must be an array')
  for (const [index, block] of value.blocks.entries()) {
    if (!isObject(block)) throw invalidReplay(`block ${index} must be an object`)
    if (!['text', 'reasoning', 'tool-call'].includes(block.type)) throw invalidReplay(`block ${index} has an unknown type`)
    for (const signature of ['textSignature', 'thinkingSignature', 'thoughtSignature']) if (block[signature] !== undefined && typeof block[signature] !== 'string') throw invalidReplay(`block ${index} ${signature} must be a string`)
    if (block.redacted !== undefined && typeof block.redacted !== 'boolean') throw invalidReplay(`block ${index} redacted must be boolean`)
  }
  return { response, blocks: value.blocks }
}

function foreignAssistant(message) {
  const source = message?.source?.kind === 'model' ? message.source : undefined
  const content = []
  for (const block of message?.content ?? []) {
    if (block?.type === 'text') content.push({ type: 'text', text: String(block.text ?? '') })
    else if (block?.type === 'reasoning') content.push({ type: 'thinking', thinking: String(block.text ?? '') })
    else if (block?.type === 'tool-call') content.push({ type: 'toolCall', id: String(block.id), name: String(block.name), arguments: parseArguments(block.arguments) })
    else if (block?.type === 'image') throw unsupportedContent('assistant image')
    else throw unsupportedContent(block?.type)
  }
  return { role: 'assistant', content, api: 'dsh-foreign', provider: source?.provider ?? 'dsh-foreign', model: source?.model ?? 'dsh-foreign', usage: emptyUsage(), stopReason: content.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop', timestamp: 0 }
}

function replayedAssistant(message, source) {
  const state = readDshPiReplayState(source.replayState)
  if (state.response.provider !== source.provider) throw invalidReplay('provider does not match assistant source')
  if (state.response.model !== source.model) throw invalidReplay('model does not match assistant source')
  if (state.blocks.length !== (message?.content ?? []).length) throw invalidReplay('block count does not match assistant content')
  const content = (message.content ?? []).map((block, index) => {
    const replay = state.blocks[index]
    if (replayBlockType(block?.type) !== replay?.type) throw invalidReplay(`block ${index} does not match assistant content`)
    if (block.type === 'text') return { type: 'text', text: String(block.text ?? ''), ...(replay.textSignature === undefined ? {} : { textSignature: replay.textSignature }) }
    if (block.type === 'reasoning') return { type: 'thinking', thinking: String(block.text ?? ''), ...(replay.thinkingSignature === undefined ? {} : { thinkingSignature: replay.thinkingSignature }), ...(replay.redacted === undefined ? {} : { redacted: replay.redacted }) }
    return { type: 'toolCall', id: String(block.id), name: String(block.name), arguments: parseArguments(block.arguments), ...(replay.thoughtSignature === undefined ? {} : { thoughtSignature: replay.thoughtSignature }) }
  })
  return { role: 'assistant', content, api: state.response.api, provider: state.response.provider, model: state.response.model, ...(state.response.responseModel === undefined ? {} : { responseModel: state.response.responseModel }), ...(state.response.responseId === undefined ? {} : { responseId: state.response.responseId }), usage: emptyUsage(), stopReason: state.response.stopReason, timestamp: 0 }
}

function toPiAssistant(message, onReplayDegrade) {
  const source = message?.source
  if (source?.kind !== 'model' || source.replayState === undefined) return foreignAssistant(message)
  try { return replayedAssistant(message, source) }
  catch (cause) {
    if (cause?.code !== 'LCX_COMPACT_INVALID_REPLAY_STATE') throw cause
    onReplayDegrade?.(cause.message)
    return foreignAssistant(message)
  }
}

async function piToolContent(blocks, ctx, options, imageMap) {
  const content = []
  for (const block of blocks ?? []) {
    if (block?.type === 'text') content.push({ type: 'text', text: String(block.text ?? '') })
    else if (block?.type === 'image') content.push(await piImagePart(block, ctx, options, imageMap))
    else if (block?.type === 'tool-result') content.push(...await piToolContent(block.content, ctx, options, imageMap))
  }
  return content.length > 0 ? content : [{ type: 'text', text: '(no output)' }]
}

async function dshToPiMessages(messages, ctx, options, imageMap) {
  const result = []
  for (const message of messages ?? []) {
    if (message?.role === 'system') continue
    if (message?.role === 'assistant') { result.push(toPiAssistant(message, options.onReplayDegrade)); continue }
    if (message?.role !== 'user') continue
    const ordinary = (message.content ?? []).filter((block) => block?.type === 'text' || block?.type === 'image')
    if (ordinary.length > 0) {
      const content = []
      for (const block of ordinary) content.push(block.type === 'text' ? { type: 'text', text: String(block.text ?? '') } : await piImagePart(block, ctx, options, imageMap))
      if (content.length > 0) result.push({ role: 'user', content, timestamp: 0 })
    }
    for (const block of (message.content ?? []).filter((value) => value?.type === 'tool-result')) result.push({ role: 'toolResult', toolCallId: String(block.toolCallId), toolName: String(block.toolName ?? block.name ?? 'unknown'), content: await piToolContent(block.content, ctx, options, imageMap), addedToolNames: block.addedToolNames ?? message.addedToolNames ?? [], isError: block.isError === true, timestamp: 0 })
  }
  return result
}

function builtinResponsesModel(provider, modelId) {
  try { return getBuiltinModels(String(provider ?? '')).find((model) => model?.id === modelId && model?.api === 'openai-responses') }
  catch { return undefined }
}

function piModel(options) {
  const route = options.route ?? {}
  const explicit = options.model && typeof options.model === 'object' ? options.model : undefined
  const provider = String(explicit?.provider ?? route.provider ?? 'dsh-lcx-codex')
  const id = String(explicit?.id ?? route.model ?? 'unknown')
  const builtin = builtinResponsesModel(provider, id)
  const compat = { ...(builtin?.compat ?? {}), ...(options.responsesCompat ?? {}), ...(explicit?.compat ?? {}) }
  const input = options.imageSupport === 'supported' ? ['text', 'image'] : options.imageSupport === 'unsupported' ? ['text'] : (explicit?.input ?? builtin?.input ?? ['text'])
  return {
    ...(builtin ?? {}), ...(explicit ?? {}), id, name: String(explicit?.name ?? builtin?.name ?? id), api: 'openai-responses', provider,
    baseUrl: String(explicit?.baseUrl ?? route.baseURL ?? builtin?.baseUrl ?? ''), reasoning: typeof explicit?.reasoning === 'boolean' ? explicit.reasoning : (builtin?.reasoning ?? true), input,
    cost: explicit?.cost ?? builtin?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: Number(explicit?.contextWindow ?? builtin?.contextWindow) > 0 ? Number(explicit?.contextWindow ?? builtin?.contextWindow) : 262144,
    maxTokens: Number(explicit?.maxTokens ?? builtin?.maxTokens) > 0 ? Number(explicit?.maxTokens ?? builtin?.maxTokens) : 32768,
    ...(Object.keys(compat).length > 0 ? { compat } : {}),
  }
}

function splitDeferredTools(context, enabled) {
  const unique = new Map()
  for (const tool of context.tools ?? []) if (tool?.name) unique.set(tool.name, tool)
  if (!enabled) return { immediate: [...unique.values()], deferred: new Map() }
  const deferredNames = new Set(); const usedNames = new Set()
  for (const message of context.messages ?? []) {
    if (message.role === 'assistant') {
      for (const block of message.content ?? []) if (block.type === 'toolCall') usedNames.add(block.name)
    } else if (message.role === 'toolResult') {
      for (const name of message.addedToolNames ?? []) if (!usedNames.has(name)) deferredNames.add(name)
    }
  }
  const immediate = []; const deferred = new Map()
  for (const [name, tool] of unique) { if (deferredNames.has(name)) deferred.set(name, tool); else immediate.push(tool) }
  return { immediate, deferred }
}

export async function serializeDshMessages(messages, ctx, options = {}) {
  const imageMap = new Map()
  const normalized = {
    imageSupport: options.imageSupport ?? 'unknown', signal: options.signal, route: options.route ?? {}, model: options.model, responsesCompat: options.responsesCompat,
    systemPrompt: typeof options.systemPrompt === 'string' ? options.systemPrompt : undefined, includeSystemPrompt: options.includeSystemPrompt === true, onReplayDegrade: options.onReplayDegrade,
    maxRequestImageBytes: Number.isSafeInteger(options.maxRequestImageBytes) && options.maxRequestImageBytes > 0 ? options.maxRequestImageBytes : DEFAULT_MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: Number.isSafeInteger(options.requestImagePixelBudget) && options.requestImagePixelBudget > 0 ? options.requestImagePixelBudget : DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: Number.isSafeInteger(options.requestImageMaxBytes) && options.requestImageMaxBytes > 0 ? options.requestImageMaxBytes : DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  }
  const projected = offloadRequestImagesWithPolicy(messages ?? [], { representation: 'base64', maxBytes: normalized.maxRequestImageBytes, byteQuantum: 1, byteLength: ref => Math.min(ref.bytes, normalized.requestImageMaxBytes) })
  const model = piModel(normalized)
  const context = { systemPrompt: normalized.systemPrompt, messages: await dshToPiMessages(projected, ctx, normalized, imageMap), tools: options.tools ?? [] }
  const supportsStrictMode = model.compat?.supportsStrictMode ?? false
  const supportsOpenAIGrammarTools = model.compat?.supportsOpenAIGrammarTools ?? false
  const supportsToolSearch = model.compat?.supportsToolSearch ?? false
  const grammarToolInputProperties = createGrammarToolInputProperties(context.tools, supportsOpenAIGrammarTools)
  const placement = splitDeferredTools(context, supportsToolSearch)
  const toolOptions = { supportsStrictMode, supportsOpenAIGrammarTools }
  const input = convertResponsesMessages(model, context, new Set(['openai', 'openai-codex', 'opencode']), {
    includeSystemPrompt: normalized.includeSystemPrompt, grammarToolInputProperties, deferredTools: placement.deferred, toolOptions,
  })
  const tools = options.tools === undefined ? undefined : convertResponsesTools(placement.immediate, toolOptions)
  return { input, imageMap, tools }
}

export function responsesTools(tools) {
  if (tools === undefined) return undefined
  if (!Array.isArray(tools)) throw error('LCX Responses tools must be an array', 'LCX_COMPACT_INVALID_TOOLS')
  if (tools.every((tool) => isObject(tool) && typeof tool.type === 'string')) return structuredClone(tools)
  for (const tool of tools) if (!isObject(tool) || typeof tool.name !== 'string' || !tool.name) throw error('LCX Responses tool has no name', 'LCX_COMPACT_INVALID_TOOLS')
  return convertResponsesTools(tools, { supportsStrictMode: false, supportsOpenAIGrammarTools: false })
}

function isResponsesMessageItem(item) { return isObject(item) && typeof item.role === 'string' && (item.type === undefined || item.type === 'message') }

function mapImageParts(value, mapper) {
  if (!Array.isArray(value)) return value
  return value.map((part) => {
    if (part?.type === 'input_image' || part?.type === 'dsh_image_attachment') return mapper(part)
    if (part?.type === 'function_call_output' && Array.isArray(part.output)) return { ...structuredClone(part), output: mapImageParts(part.output, mapper) }
    return structuredClone(part)
  })
}

export function persistNativeImageReferences(output, imageMap) {
  const map = imageMap instanceof Map ? imageMap : new Map()
  const persist = (part) => {
    if (part.type !== 'input_image' || typeof part.image_url !== 'string') throw error('native compact returned an invalid image item', 'LCX_COMPACT_INVALID_RESPONSE')
    const ref = map.get(part.image_url)
    if (!ref) throw error('native compact returned an untracked image item', 'LCX_COMPACT_INVALID_RESPONSE')
    return { type: 'dsh_image_attachment', attachment: structuredClone(ref) }
  }
  return (output ?? []).map((item) => {
    if (isResponsesMessageItem(item) && Array.isArray(item.content)) return { ...structuredClone(item), content: mapImageParts(item.content, persist) }
    if (item?.type === 'function_call_output' && Array.isArray(item.output)) return { ...structuredClone(item), output: mapImageParts(item.output, persist) }
    return structuredClone(item)
  })
}

async function hydratePart(part, ctx, options) {
  if (part?.type !== 'dsh_image_attachment') return structuredClone(part)
  if (options.imageSupport === 'unsupported') return { type: 'input_text', text: '[image omitted because the target model does not support image input]' }
  const block = { type: 'image', attachment: part.attachment }
  const map = options.imageMap instanceof Map ? options.imageMap : new Map()
  return imagePart(block, ctx, options, map)
}

export async function hydrateNativeImageReferences(output, ctx, options = {}) {
  const normalized = {
    imageSupport: options.imageSupport ?? 'unknown',
    signal: options.signal,
    maxRequestImageBytes: options.maxRequestImageBytes ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: options.requestImagePixelBudget ?? DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: options.requestImageMaxBytes ?? DEFAULT_REQUEST_IMAGE_MAX_BYTES,
    imageMap: options.imageMap,
  }
  const result = []
  for (const item of output ?? []) {
    if (isResponsesMessageItem(item) && Array.isArray(item.content)) {
      const content = []
      for (const part of item.content) content.push(await hydratePart(part, ctx, normalized))
      result.push({ ...structuredClone(item), content })
    } else if (item?.type === 'function_call_output' && Array.isArray(item.output)) {
      const value = []
      for (const part of item.output) value.push(await hydratePart(part, ctx, normalized))
      result.push({ ...structuredClone(item), output: value })
    } else result.push(structuredClone(item))
  }
  return result
}
