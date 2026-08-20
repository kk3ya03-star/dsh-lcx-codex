import { outputDomains, outputLineRange, parseWebRunOutput } from './web-run-output.js'

export const HOSTED_SEARCH_PARAMETERS = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search the web for the requested topic. Include date or freshness requirements in the query when needed.',
    },
    searchContextSize: { type: 'string', enum: ['low', 'medium', 'high'] },
    allowedDomains: { type: 'array', items: { type: 'string' } },
    blockedDomains: { type: 'array', items: { type: 'string' } },
    userLocation: {
      type: 'object',
      properties: {
        country: { type: 'string' },
        city: { type: 'string' },
        region: { type: 'string' },
        timezone: { type: 'string' },
      },
      additionalProperties: false,
    },
    externalWebAccess: { type: 'boolean' },
    returnTokenBudget: { type: 'string', enum: ['default', 'unlimited'] },
    searchContentTypes: {
      type: 'array',
      items: { type: 'string', enum: ['text', 'image'] },
    },
    imageSettings: {
      type: 'object',
      properties: {
        maxResults: { type: 'integer' },
        caption: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  required: ['query'],
  additionalProperties: false,
}

export const HOSTED_SEARCH_OUTPUT = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['hosted'] },
    action: { type: 'string' },
    emulation: { type: 'string', enum: ['native'] },
    content: { type: 'string' },
    sources: { type: 'array', items: { type: 'object' } },
    citations: { type: 'array', items: { type: 'object' } },
    images: { type: 'array', items: { type: 'object' } },
    warnings: { type: 'array', items: { type: 'string' } },
    outputBlocks: { type: 'array', items: { type: 'object' } },
    domains: { type: 'array', items: { type: 'string' } },
    lineRange: { type: 'object' },
    requestId: { type: 'string' },
    responseId: { type: 'string' },
    retrievedAt: { type: 'string' },
    truncated: { type: 'boolean' },
  },
  required: ['mode', 'action', 'emulation', 'content', 'sources', 'citations', 'images', 'warnings', 'requestId', 'retrievedAt', 'truncated'],
  additionalProperties: false,
}

function failure(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

export function normalizeHostedSearchArgs(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw failure('websearch_gpt arguments must be an object', 'WEB_INVALID_REQUEST')
  if (typeof args.query !== 'string' || args.query.trim().length === 0) throw failure('websearch_gpt.query must be a non-empty string', 'WEB_INVALID_REQUEST')
  const known = new Set([
    'query',
    'searchContextSize',
    'allowedDomains',
    'blockedDomains',
    'userLocation',
    'externalWebAccess',
    'returnTokenBudget',
    'searchContentTypes',
    'imageSettings',
  ])
  if (Object.keys(args).some((key) => !known.has(key))) throw failure('websearch_gpt received an unknown field', 'WEB_INVALID_REQUEST')
  const normalized = { query: args.query.trim() }
  if (normalized.query.length > 16_000) throw failure('websearch_gpt.query is too long', 'WEB_INVALID_REQUEST')
  if (args.searchContextSize !== undefined) {
    if (!['low', 'medium', 'high'].includes(args.searchContextSize)) throw failure('websearch_gpt.searchContextSize is invalid', 'WEB_INVALID_REQUEST')
    normalized.searchContextSize = args.searchContextSize
  }
  const allowedDomains = normalizeDomains(args.allowedDomains, 'allowedDomains')
  const blockedDomains = normalizeDomains(args.blockedDomains, 'blockedDomains')
  if (allowedDomains) normalized.allowedDomains = allowedDomains
  if (blockedDomains) normalized.blockedDomains = blockedDomains
  if (allowedDomains && blockedDomains) {
    const blocked = new Set(blockedDomains)
    if (allowedDomains.some((domain) => blocked.has(domain))) throw failure('websearch_gpt domain filters conflict', 'WEB_INVALID_REQUEST')
  }
  if (args.userLocation !== undefined) normalized.userLocation = normalizeUserLocation(args.userLocation)
  if (args.externalWebAccess !== undefined) {
    if (typeof args.externalWebAccess !== 'boolean') throw failure('websearch_gpt.externalWebAccess must be boolean', 'WEB_INVALID_REQUEST')
    normalized.externalWebAccess = args.externalWebAccess
  }
  if (args.returnTokenBudget !== undefined) {
    if (!['default', 'unlimited'].includes(args.returnTokenBudget)) throw failure('websearch_gpt.returnTokenBudget is invalid', 'WEB_INVALID_REQUEST')
    normalized.returnTokenBudget = args.returnTokenBudget
  }
  if (args.searchContentTypes !== undefined) normalized.searchContentTypes = normalizeContentTypes(args.searchContentTypes)
  if (args.imageSettings !== undefined) {
    if (!normalized.searchContentTypes?.includes('image')) throw failure('websearch_gpt.imageSettings requires image search content', 'WEB_INVALID_REQUEST')
    normalized.imageSettings = normalizeImageSettings(args.imageSettings)
  }
  return normalized
}

function normalizeDomains(value, field) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw failure(`websearch_gpt.${field} must contain 1 to 100 domains`, 'WEB_INVALID_REQUEST')
  const domains = value.map((item) => {
    if (typeof item !== 'string') throw failure(`websearch_gpt.${field} contains an invalid domain`, 'WEB_INVALID_REQUEST')
    const domain = item.trim().toLowerCase()
    if (domain.length === 0 || domain.length > 253 || domain.includes('/') || domain.includes(':') || domain.endsWith('.')) {
      throw failure(`websearch_gpt.${field} contains an invalid domain`, 'WEB_INVALID_REQUEST')
    }
    const labels = domain.split('.')
    if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) {
      throw failure(`websearch_gpt.${field} contains an invalid domain`, 'WEB_INVALID_REQUEST')
    }
    return domain
  })
  if (new Set(domains).size !== domains.length) throw failure(`websearch_gpt.${field} contains duplicate domains`, 'WEB_INVALID_REQUEST')
  return domains
}

function normalizeUserLocation(value) {
  if (!isRecord(value)) throw failure('websearch_gpt.userLocation must be an object', 'WEB_INVALID_REQUEST')
  const known = new Set(['country', 'city', 'region', 'timezone'])
  if (Object.keys(value).some((key) => !known.has(key))) throw failure('websearch_gpt.userLocation contains an unknown field', 'WEB_INVALID_REQUEST')
  const result = {}
  if (value.country !== undefined) {
    if (typeof value.country !== 'string' || !/^[a-z]{2}$/iu.test(value.country.trim())) throw failure('websearch_gpt.userLocation.country must be an ISO alpha-2 code', 'WEB_INVALID_REQUEST')
    result.country = value.country.trim().toUpperCase()
  }
  for (const field of ['city', 'region']) {
    if (value[field] === undefined) continue
    if (typeof value[field] !== 'string' || value[field].trim().length === 0 || value[field].trim().length > 200) throw failure(`websearch_gpt.userLocation.${field} is invalid`, 'WEB_INVALID_REQUEST')
    result[field] = value[field].trim()
  }
  if (value.timezone !== undefined) {
    if (typeof value.timezone !== 'string' || value.timezone.trim().length === 0) throw failure('websearch_gpt.userLocation.timezone is invalid', 'WEB_INVALID_REQUEST')
    const timezone = value.timezone.trim()
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
    } catch {
      throw failure('websearch_gpt.userLocation.timezone must be an IANA timezone', 'WEB_INVALID_REQUEST')
    }
    result.timezone = timezone
  }
  if (Object.keys(result).length === 0) throw failure('websearch_gpt.userLocation must contain a location field', 'WEB_INVALID_REQUEST')
  return result
}

function normalizeContentTypes(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2 || value.some((item) => !['text', 'image'].includes(item))) {
    throw failure('websearch_gpt.searchContentTypes is invalid', 'WEB_INVALID_REQUEST')
  }
  if (new Set(value).size !== value.length) throw failure('websearch_gpt.searchContentTypes contains duplicates', 'WEB_INVALID_REQUEST')
  return [...value]
}

function normalizeImageSettings(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => !['maxResults', 'caption'].includes(key))) throw failure('websearch_gpt.imageSettings is invalid', 'WEB_INVALID_REQUEST')
  const result = {}
  if (value.maxResults !== undefined) {
    if (!Number.isInteger(value.maxResults) || value.maxResults < 1 || value.maxResults > 100) throw failure('websearch_gpt.imageSettings.maxResults is invalid', 'WEB_INVALID_REQUEST')
    result.maxResults = value.maxResults
  }
  if (value.caption !== undefined) {
    if (typeof value.caption !== 'boolean') throw failure('websearch_gpt.imageSettings.caption must be boolean', 'WEB_INVALID_REQUEST')
    result.caption = value.caption
  }
  if (Object.keys(result).length === 0) throw failure('websearch_gpt.imageSettings must contain a setting', 'WEB_INVALID_REQUEST')
  return result
}

export function buildHostedSearchBody(args, model) {
  const tool = {
    type: 'web_search',
    ...(args.searchContextSize ? { search_context_size: args.searchContextSize } : {}),
    ...(args.allowedDomains || args.blockedDomains ? {
      filters: {
        ...(args.allowedDomains ? { allowed_domains: args.allowedDomains } : {}),
        ...(args.blockedDomains ? { blocked_domains: args.blockedDomains } : {}),
      },
    } : {}),
    ...(args.userLocation ? { user_location: { type: 'approximate', ...args.userLocation } } : {}),
    ...(args.externalWebAccess !== undefined ? { external_web_access: args.externalWebAccess } : {}),
    ...(args.returnTokenBudget ? { return_token_budget: args.returnTokenBudget } : {}),
    ...(args.searchContentTypes ? { search_content_types: args.searchContentTypes } : {}),
    ...(args.imageSettings ? {
      image_settings: {
        ...(args.imageSettings.maxResults !== undefined ? { max_results: args.imageSettings.maxResults } : {}),
        ...(args.imageSettings.caption !== undefined ? { caption: args.imageSettings.caption } : {}),
      },
    } : {}),
  }
  return {
    model,
    input: [{ role: 'user', content: [{ type: 'input_text', text: args.query }] }],
    tools: [tool],
    tool_choice: 'required',
    include: [
      'web_search_call.action.sources',
      ...(args.searchContentTypes?.includes('image') ? ['web_search_call.results'] : []),
    ],
    stream: false,
    store: false,
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function textFrom(value, seen = new Set()) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || seen.has(value)) return ''
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => textFrom(item, seen)).filter(Boolean).join('\n')
  if (typeof value.text === 'string' && ['output_text', 'text', 'input_text'].includes(value.type)) return value.text
  if (Array.isArray(value.content)) return textFrom(value.content, seen)
  return ''
}

function sourceFrom(value) {
  if (!isRecord(value) || typeof value.url !== 'string' || value.url.trim().length === 0) return undefined
  return {
    url: value.url,
    ...(typeof value.title === 'string' && value.title ? { title: value.title } : {}),
    ...(typeof value.snippet === 'string' && value.snippet ? { snippet: value.snippet } : {}),
    ...(typeof value.publishedAt === 'string' && value.publishedAt ? { publishedAt: value.publishedAt } : {}),
    ...(typeof value.published_at === 'string' && value.published_at ? { publishedAt: value.published_at } : {}),
    ...(typeof value.ref_id === 'string' && value.ref_id ? { refId: value.ref_id } : {}),
    ...(typeof value.domain === 'string' && value.domain ? { domain: value.domain } : {}),
  }
}

function responseArtifacts(response) {
  const sources = []
  const citations = []
  const images = []
  const actions = []
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type === 'web_search_call') {
      actions.push(typeof item.action?.type === 'string' ? item.action.type : 'search')
      if (Array.isArray(item.action?.sources)) {
        for (const value of item.action.sources) {
          const source = sourceFrom(value)
          if (source) sources.push(source)
        }
      }
      for (const value of Array.isArray(item.results) ? item.results : []) {
        const image = imageFrom(value)
        if (image) images.push(image)
      }
    }
    if (item?.type !== 'message') continue
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (part?.type !== 'output_text') continue
      for (const annotation of Array.isArray(part.annotations) ? part.annotations : []) {
        if (annotation?.type !== 'url_citation') continue
        const source = sourceFrom(annotation)
        if (source) {
          citations.push(source)
          sources.push(source)
        }
      }
    }
  }
  return { sources, citations, images, actions }
}

function httpUrl(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return undefined
    return url
  } catch {
    return undefined
  }
}

function imageFrom(value) {
  if (!isRecord(value) || value.type !== 'image_result') return undefined
  const imageUrl = httpUrl(value.image_url)?.toString()
  if (!imageUrl) return undefined
  const thumbnailUrl = httpUrl(value.thumbnail_url)?.toString()
  const sourceWebsiteUrl = httpUrl(value.source_website_url)?.toString()
  return {
    imageUrl,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(sourceWebsiteUrl ? { sourceWebsiteUrl } : {}),
    ...(typeof value.caption === 'string' && value.caption ? { caption: value.caption } : {}),
  }
}

function canonicalUrl(value) {
  const url = httpUrl(value)
  if (url) {
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$)/iu.test(key)) url.searchParams.delete(key)
    return url.toString()
  }
  return undefined
}

function uniqueByUrl(values) {
  const result = []
  const seen = new Set()
  for (const value of values) {
    const key = canonicalUrl(value.url)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

export function parseHostedSearchResponse(response, requestId, maxResults = 8, retrievedAt = new Date().toISOString()) {
  if (response?.error) {
    const error = failure(response.error.message ?? 'LCX hosted Web Search failed', 'LCX_WEB_PROVIDER_ERROR')
    throw error
  }
  if (response?.status !== 'completed') {
    throw failure(`LCX hosted Web Search returned response status: ${String(response?.status ?? 'missing')}`, 'WEB_RESPONSE_INCOMPLETE')
  }
  const output = typeof response?.output_text === 'string' ? response.output_text : textFrom(response?.output ?? response?.content)
  const outputBlocks = parseWebRunOutput(output)
  const artifacts = responseArtifacts(response)
  if (artifacts.actions.length === 0) throw failure('LCX hosted Web Search completed without executing web_search', 'WEB_SEARCH_NOT_EXECUTED')
  const allSources = [...artifacts.sources]
  for (const block of outputBlocks) {
    if (block.url) allSources.push({ url: block.url, ...(block.title ? { title: block.title } : {}) })
  }
  const sources = uniqueByUrl(allSources)
  const citations = uniqueByUrl(artifacts.citations)
  const limited = sources.slice(0, Math.max(1, maxResults))
  const images = artifacts.images.slice(0, Math.max(1, maxResults))
  if (!output && limited.length === 0 && images.length === 0) throw failure('LCX hosted Web Search returned no text, sources, or images', 'WEB_NO_SOURCES')
  return {
    mode: 'hosted',
    action: artifacts.actions[0],
    emulation: 'native',
    content: output,
    sources: limited,
    citations,
    images,
    warnings: artifacts.actions.length > 1 ? [`Multiple hosted search actions were returned: ${artifacts.actions.join(', ')}`] : [],
    outputBlocks,
    domains: outputDomains(outputBlocks),
    ...(outputLineRange(outputBlocks) ? { lineRange: outputLineRange(outputBlocks) } : {}),
    requestId,
    ...(typeof response?.id === 'string' && response.id ? { responseId: response.id } : {}),
    retrievedAt,
    truncated: sources.length > limited.length || artifacts.images.length > images.length,
  }
}

export function renderHostedSearchResult(value) {
  const parts = []
  if (value.content) parts.push(value.content)
  if (value.sources?.length) {
    parts.push(`来源：\n${value.sources.map((source) => `- [${source.title ?? source.url}](${source.url})${source.publishedAt ? `（${source.publishedAt}）` : ''}${source.snippet ? ` — ${source.snippet}` : ''}`).join('\n')}`)
  }
  if (value.images?.length) {
    parts.push(`图片：\n${value.images.map((image) => `- [${image.caption ?? image.imageUrl}](${image.imageUrl})${image.sourceWebsiteUrl ? `（[来源页面](${image.sourceWebsiteUrl})）` : ''}`).join('\n')}`)
  }
  if (value.warnings?.length) parts.push(value.warnings.map((warning) => `警告：${warning}`).join('\n'))
  if (value.retrievedAt) parts.push(`检索时间：${value.retrievedAt}`)
  if (value.truncated) parts.push('来源已截断；如需更多结果，请缩小查询范围。')
  return [{ type: 'text', text: parts.join('\n\n') || '没有找到结果。' }]
}
