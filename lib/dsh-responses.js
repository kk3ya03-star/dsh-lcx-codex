import { offloadRequestImagesWithPolicy } from '@deepseek-ai/dsh-llm'
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

function textOf(blocks) {
  return (Array.isArray(blocks) ? blocks : []).filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('')
}

function hasImage(blocks) {
  return (Array.isArray(blocks) ? blocks : []).some((block) => block?.type === 'image' || (block?.type === 'tool-result' && hasImage(block.content)))
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
  return { type: 'input_image', image_url: imageUrl }
}

async function toolResultOutput(block, ctx, options, imageMap) {
  if (!hasImage(block?.content)) return textOf(block?.content) || '(no output)'
  const parts = []
  let pending = ''
  const flush = () => { if (pending) parts.push({ type: 'input_text', text: pending }); pending = '' }
  for (const part of block.content ?? []) {
    if (part?.type === 'text') pending += part.text
    else if (part?.type === 'image') { flush(); parts.push(await imagePart(part, ctx, options, imageMap)) }
    else if (part?.type === 'tool-result') {
      const nested = await toolResultOutput(part, ctx, options, imageMap)
      if (typeof nested === 'string') pending += nested === '(no output)' ? '' : nested
      else { flush(); parts.push(...nested) }
    }
  }
  flush()
  return parts.some((part) => part.type === 'input_image') ? parts : parts.map((part) => part.text ?? '').join('') || '(no output)'
}

async function messageItems(message, ctx, options, imageMap) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  const items = []
  if (message?.role === 'assistant') {
    const text = textOf(blocks)
    if (text) items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
    for (const call of blocks.filter((block) => block?.type === 'tool-call')) {
      items.push({
        type: 'function_call',
        call_id: String(call.id),
        name: String(call.name),
        arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
      })
    }
    return items
  }
  if (message?.role !== 'user') return items

  const ordinary = blocks.filter((block) => block?.type === 'text' || block?.type === 'image')
  if (ordinary.length > 0) {
    const content = []
    let pending = ''
    const flush = () => { if (pending) content.push({ type: 'input_text', text: pending }); pending = '' }
    for (const block of ordinary) {
      if (block.type === 'text') pending += block.text
      else { flush(); content.push(await imagePart(block, ctx, options, imageMap)) }
    }
    flush()
    if (content.length > 0) items.push({ type: 'message', role: 'user', content })
  }
  for (const result of blocks.filter((block) => block?.type === 'tool-result')) {
    items.push({
      type: 'function_call_output',
      call_id: String(result.toolCallId),
      output: await toolResultOutput(result, ctx, options, imageMap),
    })
  }
  return items
}

export async function serializeDshMessages(messages, ctx, options = {}) {
  const imageMap = new Map()
  const input = []
  const normalized = {
    imageSupport: options.imageSupport ?? 'unknown',
    signal: options.signal,
    maxRequestImageBytes: Number.isSafeInteger(options.maxRequestImageBytes) && options.maxRequestImageBytes > 0
      ? options.maxRequestImageBytes
      : DEFAULT_MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: Number.isSafeInteger(options.requestImagePixelBudget) && options.requestImagePixelBudget > 0
      ? options.requestImagePixelBudget
      : DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: Number.isSafeInteger(options.requestImageMaxBytes) && options.requestImageMaxBytes > 0
      ? options.requestImageMaxBytes
      : DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  }
  const projected = offloadRequestImagesWithPolicy(messages ?? [], {
    representation: 'base64',
    maxBytes: normalized.maxRequestImageBytes,
    byteQuantum: 1,
    byteLength: ref => Math.min(ref.bytes, normalized.requestImageMaxBytes),
  })
  for (const message of projected) {
    if (message?.role === 'system') continue
    input.push(...await messageItems(message, ctx, normalized, imageMap))
  }
  return { input, imageMap }
}

export function responsesTools(tools) {
  if (tools === undefined) return undefined
  if (!Array.isArray(tools)) throw error('LCX Responses tools must be an array', 'LCX_COMPACT_INVALID_TOOLS')
  return tools.map((tool) => {
    if (!isObject(tool) || typeof tool.name !== 'string' || !tool.name) throw error('LCX Responses tool has no name', 'LCX_COMPACT_INVALID_TOOLS')
    return {
      type: 'function',
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : '',
      parameters: isObject(tool.parameters) ? structuredClone(tool.parameters) : { type: 'object', properties: {} },
      strict: false,
    }
  })
}

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
    if (item?.type === 'message' && Array.isArray(item.content)) return { ...structuredClone(item), content: mapImageParts(item.content, persist) }
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
    if (item?.type === 'message' && Array.isArray(item.content)) {
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
