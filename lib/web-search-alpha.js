import { createHash } from 'node:crypto'
import { outputDomains, outputLineRange, outputLinks, outputPdfRefs, parseWebRunOutput } from './web-run-output.js'

export const ALPHA_ACTIONS = ['search_query', 'image_query', 'open', 'find', 'click', 'screenshot', 'finance', 'weather', 'sports', 'time']
const LEAGUES = ['nba', 'wnba', 'nfl', 'nhl', 'mlb', 'epl', 'ncaamb', 'ncaawb', 'ipl']
const ASSET_TYPES = ['equity', 'fund', 'crypto', 'index']
const RESPONSE_LENGTHS = ['short', 'medium', 'long']

export const ALPHA_SEARCH_PARAMETERS = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ALPHA_ACTIONS },
    query: { type: 'string' },
    domains: { type: 'array', items: { type: 'string' } },
    recency: { type: 'integer' },
    refId: { type: 'string' },
    lineNumber: { type: 'integer' },
    linkId: { type: 'integer' },
    pattern: { type: 'string' },
    pageNumber: { type: 'integer' },
    ticker: { type: 'string' },
    assetType: { type: 'string', enum: ASSET_TYPES },
    market: { type: 'string' },
    location: { type: 'string' },
    start: { type: 'string' },
    duration: { type: 'integer' },
    fn: { type: 'string', enum: ['schedule', 'standings'] },
    league: { type: 'string', enum: LEAGUES },
    team: { type: 'string' },
    opponent: { type: 'string' },
    dateFrom: { type: 'string' },
    dateTo: { type: 'string' },
    numberOfGames: { type: 'integer' },
    locale: { type: 'string' },
    utcOffset: { type: 'string' },
    responseLength: { type: 'string', enum: RESPONSE_LENGTHS },
  },
  required: ['action'],
  additionalProperties: false,
}

export const ALPHA_SEARCH_OUTPUT = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['alpha'] },
    action: { type: 'string' },
    capability: { type: 'string' },
    emulation: { type: 'string', enum: ['native', 'unknown'] },
    content: { type: 'string' },
    results: { type: 'array', items: { type: 'object' } },
    refs: { type: 'array', items: { type: 'string' } },
    sources: { type: 'array', items: { type: 'object' } },
    citations: { type: 'array', items: { type: 'object' } },
    outputBlocks: { type: 'array', items: { type: 'object' } },
    links: { type: 'array', items: { type: 'object' } },
    pdfRefs: { type: 'array', items: { type: 'string' } },
    domains: { type: 'array', items: { type: 'string' } },
    lineRange: { type: 'object' },
    requestId: { type: 'string' },
    responseId: { type: 'string' },
    retrievedAt: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['mode', 'action', 'capability', 'emulation', 'content', 'results', 'refs', 'sources', 'citations', 'outputBlocks', 'links', 'pdfRefs', 'domains', 'requestId', 'retrievedAt', 'warnings'],
  additionalProperties: false,
}

export const ALPHA_SCHEMA_FINGERPRINT = createHash('sha256').update(JSON.stringify(ALPHA_SEARCH_PARAMETERS), 'utf8').digest('hex')

function failure(message, code = 'WEB_INVALID_REQUEST') {
  const error = new Error(message)
  error.code = code
  return error
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value, field, max = 1000) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > max) throw failure(`websearch_alpha.${field} is invalid`)
  return value.trim()
}

function integer(value, field, minimum = 0, maximum = 10_000) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw failure(`websearch_alpha.${field} is invalid`)
  return value
}

function optionalText(args, result, field, wireField = field, max = 1000) {
  if (args[field] !== undefined) result[wireField] = text(args[field], field, max)
}

function date(value, field) {
  const normalized = text(value, field, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) throw failure(`websearch_alpha.${field} must use YYYY-MM-DD`)
  return normalized
}

function domains(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw failure('websearch_alpha.domains is invalid')
  const result = value.map((item) => {
    const domain = text(item, 'domains', 253).toLowerCase()
    if (domain.includes('/') || domain.includes(':') || !domain.includes('.')) throw failure('websearch_alpha.domains contains an invalid domain')
    return domain
  })
  if (new Set(result).size !== result.length) throw failure('websearch_alpha.domains contains duplicates')
  return result
}

const FIELDS = {
  search_query: ['query', 'domains', 'recency'],
  image_query: ['query', 'domains', 'recency'],
  open: ['refId', 'lineNumber'],
  find: ['refId', 'pattern'],
  click: ['refId', 'linkId'],
  screenshot: ['refId', 'pageNumber'],
  finance: ['ticker', 'assetType', 'market'],
  weather: ['location', 'start', 'duration'],
  sports: ['fn', 'league', 'team', 'opponent', 'dateFrom', 'dateTo', 'numberOfGames', 'locale'],
  time: ['utcOffset'],
}

export function normalizeAlphaSearchArgs(args) {
  if (!isRecord(args) || !ALPHA_ACTIONS.includes(args.action)) throw failure('websearch_alpha.action is invalid')
  const allowed = new Set(['action', 'responseLength', ...FIELDS[args.action]])
  if (Object.keys(args).some((key) => !allowed.has(key))) throw failure(`websearch_alpha.${args.action} received an unrelated field`)
  const result = { action: args.action }
  if (args.responseLength !== undefined) {
    if (!RESPONSE_LENGTHS.includes(args.responseLength)) throw failure('websearch_alpha.responseLength is invalid')
    result.responseLength = args.responseLength
  }
  switch (args.action) {
    case 'search_query':
    case 'image_query':
      result.query = text(args.query, 'query', 16_000)
      if (args.domains !== undefined) result.domains = domains(args.domains)
      if (args.recency !== undefined) result.recency = integer(args.recency, 'recency', 0, 3650)
      break
    case 'open':
      result.refId = text(args.refId, 'refId')
      if (args.lineNumber !== undefined) result.lineNumber = integer(args.lineNumber, 'lineNumber')
      break
    case 'find':
      result.refId = text(args.refId, 'refId')
      result.pattern = text(args.pattern, 'pattern')
      break
    case 'click':
      result.refId = text(args.refId, 'refId')
      result.linkId = integer(args.linkId, 'linkId')
      break
    case 'screenshot':
      result.refId = text(args.refId, 'refId')
      result.pageNumber = integer(args.pageNumber, 'pageNumber')
      break
    case 'finance':
      result.ticker = text(args.ticker, 'ticker', 40)
      if (!ASSET_TYPES.includes(args.assetType)) throw failure('websearch_alpha.assetType is invalid')
      result.assetType = args.assetType
      optionalText(args, result, 'market', 'market', 20)
      break
    case 'weather':
      result.location = text(args.location, 'location', 500)
      if (args.start !== undefined) result.start = date(args.start, 'start')
      if (args.duration !== undefined) result.duration = integer(args.duration, 'duration', 1, 14)
      break
    case 'sports':
      if (!['schedule', 'standings'].includes(args.fn)) throw failure('websearch_alpha.fn is invalid')
      if (!LEAGUES.includes(args.league)) throw failure('websearch_alpha.league is invalid')
      result.fn = args.fn
      result.league = args.league
      for (const field of ['team', 'opponent', 'locale']) optionalText(args, result, field, field, 100)
      if (args.dateFrom !== undefined) result.dateFrom = date(args.dateFrom, 'dateFrom')
      if (args.dateTo !== undefined) result.dateTo = date(args.dateTo, 'dateTo')
      if (args.numberOfGames !== undefined) result.numberOfGames = integer(args.numberOfGames, 'numberOfGames', 1, 100)
      break
    case 'time':
      result.utcOffset = text(args.utcOffset, 'utcOffset', 6)
      if (!/^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$/u.test(result.utcOffset)) throw failure('websearch_alpha.utcOffset is invalid')
      break
  }
  return result
}

export function alphaActionCommand(args) {
  let value
  switch (args.action) {
    case 'search_query':
    case 'image_query':
      value = { q: args.query, ...(args.recency !== undefined ? { recency: args.recency } : {}), ...(args.domains ? { domains: args.domains } : {}) }
      break
    case 'open': value = { ref_id: args.refId, ...(args.lineNumber !== undefined ? { lineno: args.lineNumber } : {}) }; break
    case 'find': value = { ref_id: args.refId, pattern: args.pattern }; break
    case 'click': value = { ref_id: args.refId, id: args.linkId }; break
    case 'screenshot': value = { ref_id: args.refId, pageno: args.pageNumber }; break
    case 'finance': value = { ticker: args.ticker, type: args.assetType, ...(args.market ? { market: args.market } : {}) }; break
    case 'weather': value = { location: args.location, ...(args.start ? { start: args.start } : {}), ...(args.duration !== undefined ? { duration: args.duration } : {}) }; break
    case 'sports':
      value = {
        tool: 'sports',
        fn: args.fn,
        league: args.league,
        ...(args.team ? { team: args.team } : {}),
        ...(args.opponent ? { opponent: args.opponent } : {}),
        ...(args.dateFrom ? { date_from: args.dateFrom } : {}),
        ...(args.dateTo ? { date_to: args.dateTo } : {}),
        ...(args.numberOfGames !== undefined ? { num_games: args.numberOfGames } : {}),
        ...(args.locale ? { locale: args.locale } : {}),
      }
      break
    case 'time': value = { utc_offset: args.utcOffset }; break
    default: throw failure('websearch_alpha.action is invalid')
  }
  return { [args.action]: [value], ...(args.responseLength ? { response_length: args.responseLength } : {}) }
}

function actionInput(args) {
  if (args.query) return args.query
  if (args.refId) return `${args.action}: ${args.refId}`
  if (args.ticker) return `${args.action}: ${args.ticker}`
  if (args.location) return `${args.action}: ${args.location}`
  if (args.utcOffset) return `${args.action}: ${args.utcOffset}`
  return `${args.action}: ${args.league ?? ''}`.trim()
}

export function buildAlphaSearchBody(args, model, sessionId, externalWebAccess = true, maxOutputTokens = 2500) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) throw failure('websearch_alpha requires a DSH session', 'LCX_ALPHA_SESSION_REQUIRED')
  return {
    id: sessionId,
    model,
    input: [{ role: 'user', content: [{ type: 'input_text', text: actionInput(args) }] }],
    commands: alphaActionCommand(args),
    settings: { allowed_callers: ['direct'], external_web_access: externalWebAccess },
    max_output_tokens: maxOutputTokens,
  }
}

function httpUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function safeResult(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return undefined
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => safeResult(item, seen)).filter((item) => item !== undefined)
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'encrypted_output' || key === 'encrypted_content') continue
    if (['url', 'source_url', 'source_website_url', 'image_url', 'thumbnail_url'].includes(key)) {
      const url = httpUrl(item)
      if (url) result[key] = url
      continue
    }
    const safe = safeResult(item, seen)
    if (safe !== undefined) result[key] = safe
  }
  return result
}

function responseArtifacts(results) {
  const refs = []
  const refRecords = []
  const sources = []
  const seenRefs = new Set()
  const seenSources = new Set()
  const visit = (value) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    const refId = typeof value.ref_id === 'string' && value.ref_id.length > 0
      ? value.ref_id
      : typeof value.id === 'string' && /^turn[\w-]+$/u.test(value.id) ? value.id : undefined
    const url = httpUrl(value.url ?? value.source_url ?? value.source_website_url)
    if (refId && !seenRefs.has(refId)) {
      seenRefs.add(refId)
      refs.push(refId)
      refRecords.push({ refId, ...(url ? { url } : {}) })
    }
    if (url && !seenSources.has(url)) {
      seenSources.add(url)
      sources.push({
        url,
        ...(typeof value.title === 'string' && value.title ? { title: value.title } : {}),
        ...(typeof value.snippet === 'string' && value.snippet ? { snippet: value.snippet } : {}),
        ...(refId ? { refId } : {}),
      })
    }
    for (const item of Object.values(value)) visit(item)
  }
  visit(results)
  return { refs, refRecords, sources }
}

const ALPHA_ACTION_ERROR_PATTERN = /^\s*(?:Error parsing function call\b|Invalid function_name=|Invalid function call\b)/iu

export function parseAlphaSearchResponse(response, options) {
  if (!isRecord(response) || typeof response.output !== 'string' || (response.results !== undefined && !Array.isArray(response.results))) {
    throw failure('LCX Alpha Web Search returned an invalid response', 'LCX_ALPHA_INVALID_RESPONSE')
  }
  if (ALPHA_ACTION_ERROR_PATTERN.test(response.output)) {
    throw failure('LCX Alpha Web Search could not execute the requested action', 'LCX_ALPHA_ACTION_FAILED')
  }
  const results = safeResult(response.results ?? [])
  const artifacts = responseArtifacts(results)
  const outputBlocks = parseWebRunOutput(response.output)
  for (const refId of outputBlocks.flatMap((block) => block.references ?? [])) {
    if (!artifacts.refs.includes(refId)) artifacts.refs.push(refId)
  }
  const blockSources = outputBlocks.flatMap((block) => block.url ? [{ url: block.url, ...(block.title ? { title: block.title } : {}) }] : [])
  for (const source of blockSources) {
    const canonical = httpUrl(source.url)
    if (canonical && !artifacts.sources.some((item) => httpUrl(item.url) === canonical)) artifacts.sources.push(source)
  }
  return {
    mode: 'alpha',
    action: options.action,
    capability: options.capability,
    emulation: options.capability === 'native' ? 'native' : 'unknown',
    content: response.output,
    results,
    refs: artifacts.refs,
    sources: artifacts.sources,
    citations: artifacts.sources.map((source) => ({ ...source })),
    outputBlocks,
    links: outputLinks(outputBlocks),
    pdfRefs: outputPdfRefs(outputBlocks),
    domains: outputDomains(outputBlocks),
    ...(outputLineRange(outputBlocks) ? { lineRange: outputLineRange(outputBlocks) } : {}),
    requestId: options.requestId,
    ...(typeof response.id === 'string' && response.id ? { responseId: response.id } : {}),
    retrievedAt: options.retrievedAt ?? new Date().toISOString(),
    warnings: options.capability === 'command-capable' ? ['Alpha command behavior is verified, but trusted native backend provenance is unavailable.'] : [],
  }
}

function probeFailureState(error) {
  if ([404, 405].includes(error?.status) || error?.code === 'LCX_ALPHA_ACTION_UNAVAILABLE' || /channel does not support|unsupported action|not implemented/iu.test(String(error?.message ?? ''))) {
    return 'unsupported'
  }
  return 'unknown'
}

export async function probeAlphaCapabilities({
  invoke,
  schemaFingerprint,
  trustedNativeProvenance = false,
  actionProbes = {},
  clickProbeRef,
  screenshotProbeRef,
}) {
  const actions = Object.fromEntries(ALPHA_ACTIONS.map((action) => [action, 'unknown']))
  const result = {
    classification: 'unsupported',
    actions,
    probedAt: new Date().toISOString(),
    schemaFingerprint,
    provenance: trustedNativeProvenance ? 'trusted-native' : 'unavailable',
  }
  let search
  try {
    search = await invoke({ action: 'search_query', query: 'OpenAI official documentation', responseLength: 'short' })
    actions.search_query = 'supported'
  } catch (error) {
    actions.search_query = probeFailureState(error)
    result.classification = actions.search_query === 'unsupported' ? 'unsupported' : 'unknown'
    return result
  }
  const searchRef = search?.refs?.[0]
  if (!searchRef) {
    result.classification = 'emulated-search-only'
    for (const action of ['open', 'find', 'click']) actions[action] = 'unsupported'
    return result
  }
  let opened
  try {
    opened = await invoke({ action: 'open', refId: searchRef, responseLength: 'short' })
    actions.open = 'supported'
  } catch (error) {
    actions.open = probeFailureState(error)
    result.classification = actions.open === 'unsupported' ? 'emulated-search-only' : 'unknown'
    return result
  }
  try {
    await invoke({ action: 'find', refId: opened?.refs?.[0] ?? searchRef, pattern: 'OpenAI', responseLength: 'short' })
    actions.find = 'supported'
  } catch (error) {
    actions.find = probeFailureState(error)
  }
  let clickPage = opened
  if (!(clickPage?.links?.length > 0) && clickProbeRef) {
    try {
      clickPage = await invoke({ action: 'open', refId: clickProbeRef, responseLength: 'short' })
    } catch (error) {
      actions.click = probeFailureState(error)
    }
  }
  const clickRef = clickPage?.refs?.[0]
  const linkId = clickPage?.links?.[0]?.id
  if (clickRef && Number.isSafeInteger(linkId)) {
    try {
      await invoke({ action: 'click', refId: clickRef, linkId, responseLength: 'short' })
      actions.click = 'supported'
    } catch (error) {
      actions.click = probeFailureState(error)
    }
  }
  if (actions.find === 'supported' || actions.click === 'supported') {
    result.classification = trustedNativeProvenance ? 'native' : 'command-capable'
  } else if (actions.find === 'unsupported' && actions.click === 'unsupported') {
    result.classification = 'emulated-search-only'
  } else {
    result.classification = 'unknown'
  }
  if (screenshotProbeRef) {
    try {
      const pdf = await invoke({ action: 'open', refId: screenshotProbeRef, responseLength: 'short' })
      const pdfRef = pdf?.pdfRefs?.[0]
      if (pdfRef) {
        await invoke({ action: 'screenshot', refId: pdfRef, pageNumber: 0, responseLength: 'short' })
        actions.screenshot = 'supported'
      }
    } catch (error) {
      actions.screenshot = probeFailureState(error)
    }
  }
  for (const [action, args] of Object.entries(actionProbes)) {
    try {
      await invoke({ action, ...args, responseLength: 'short' })
      actions[action] = 'supported'
    } catch (error) {
      actions[action] = probeFailureState(error)
    }
  }
  return result
}

export function renderAlphaSearchResult(value) {
  const parts = [value.content]
  if (value.sources?.length) parts.push(`来源：\n${value.sources.map((source) => `- [${source.title ?? source.url}](${source.url})`).join('\n')}`)
  if (value.warnings?.length) parts.push(value.warnings.map((warning) => `警告：${warning}`).join('\n'))
  parts.push(`检索时间：${value.retrievedAt}`)
  return [{ type: 'text', text: parts.filter(Boolean).join('\n\n') }]
}
