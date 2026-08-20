const RESULT_SEPARATOR_PATTERN = /(?:\r?\n)?-{80}(?:\r?\n)?/gu
const CITATION_PATTERN = /cite([^]+)/gu
const PAGE_LINE_PATTERN = /^L(\d+)(?:@P(\d+)(?:-(\d+))?)?:\s?(.*)$/u
const EMBEDDED_PAGE_LINE_PATTERN = / (?=L\d+(?:@P\d+(?:-\d+)?)?:)/gu
const TITLE_URL_PATTERN = /^(.*?)\s*\((https?:\/\/[^)]+)\)\s*$/u

function pushUnique(target, value) {
  if (!target.includes(value)) target.push(value)
}

function pushLink(target, payload) {
  const [idValue, labelValue, domainValue] = payload.split('†')
  if (!/^\d+$/u.test(idValue ?? '') || !labelValue) return false
  const id = Number(idValue)
  if (!Number.isSafeInteger(id)) return false
  const label = labelValue.trim().slice(0, 500)
  const domain = domainValue?.trim().slice(0, 253)
  if (!label) return false
  const existing = target.find((link) => link.id === id)
  if (!existing) target.push({ id, label, ...(domain ? { domain } : {}) })
  else if (!existing.domain && domain) existing.domain = domain
  return true
}

function cleanCitations(value, references, links) {
  return String(value ?? '').replace(CITATION_PATTERN, (_match, payload) => {
    if (/^turn[\w-]+$/u.test(payload)) {
      pushUnique(references, payload)
      return ''
    }
    if (pushLink(links, payload)) return payload.split('†')[1]
    const separator = payload.indexOf('†')
    return separator < 0 ? payload : payload.slice(separator + 1)
  }).trim()
}

function metadataParts(value) {
  return value
    .replace(/^\[wordlim:\s*(\d+)\]\s*/u, '$1-word excerpt; ')
    .split(/;\s*/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const contentType = part.match(/^Content type:\s*(.+)$/u)
      if (contentType) return contentType[1] === 'text/html' ? 'HTML' : contentType[1] === 'application/pdf' ? 'PDF' : contentType[1]
      const totalLines = part.match(/^Total lines:\s*(\d+)$/u)
      if (totalLines) return `${totalLines[1]} lines`
      const pages = part.match(/^Number of pages:\s*(\d+)$/u)
      if (pages) return `${pages[1]} pages`
      return part
    })
}

function isMetadata(value) {
  return value.startsWith('[wordlim:') || /^(?:Published|Crawled|Content type|Source|Total lines|Number of pages):/u.test(value)
}

function parseLine(value, references, links) {
  const clean = cleanCitations(value, references, links)
  const pageLine = clean.match(PAGE_LINE_PATTERN)
  if (pageLine) {
    const text = pageLine[4] ?? ''
    const heading = text.match(/^(#{1,6})\s+(.+)$/u)
    return {
      line: Number(pageLine[1]),
      ...(pageLine[2] === undefined ? {} : { page: Number(pageLine[2]) }),
      ...(pageLine[3] === undefined ? {} : { pageEnd: Number(pageLine[3]) }),
      text: heading?.[2] ?? text,
      ...(heading ? { heading: heading[1].length } : {}),
    }
  }
  const heading = clean.match(/^(#{1,6})\s+(.+)$/u)
  return heading ? { text: heading[2], heading: heading[1].length } : { text: clean }
}

function parseBlock(value) {
  const references = []
  const links = []
  const rawLines = String(value ?? '')
    .replace(EMBEDDED_PAGE_LINE_PATTERN, '\n')
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
  while (rawLines[0]?.trim() === '') rawLines.shift()
  while (rawLines.at(-1)?.trim() === '') rawLines.pop()
  if (rawLines.length === 0) return undefined

  const firstLine = cleanCitations(rawLines[0], references, links)
  const header = firstLine.match(TITLE_URL_PATTERN)
  const titleOnly = firstLine.match(/^(.+?)\s*\(\)\s*$/u)
  let title = header?.[1]?.trim() || titleOnly?.[1]?.trim() || undefined
  const url = header?.[2]
  let bodyStart = header || titleOnly ? 1 : 0
  if (!header && /^\s*\([^)]*\)\s*$/u.test(firstLine)) bodyStart = 1

  const metadata = []
  while (bodyStart < rawLines.length) {
    const clean = cleanCitations(rawLines[bodyStart], references, links)
    if (!isMetadata(clean)) break
    metadata.push(...metadataParts(clean))
    bodyStart += 1
  }
  const lines = rawLines.slice(bodyStart).map((line) => parseLine(line, references, links))
  if (!title && url) {
    try { title = new URL(url).hostname } catch { title = url }
  }
  return {
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
    references,
    links,
    metadata,
    lines,
  }
}

export function parseWebRunOutput(output) {
  if (typeof output !== 'string' || output.length === 0) return []
  return output.split(RESULT_SEPARATOR_PATTERN).map(parseBlock).filter(Boolean)
}

export function outputLineRange(blocks) {
  const numbers = (blocks ?? []).flatMap((block) => (block.lines ?? []).flatMap((line) => line.line === undefined ? [] : [line.line]))
  if (numbers.length === 0) return undefined
  return { first: Math.min(...numbers), last: Math.max(...numbers) }
}

export function outputDomains(blocks) {
  const domains = []
  for (const block of blocks ?? []) {
    if (!block.url) continue
    try { pushUnique(domains, new URL(block.url).hostname) } catch { /* ignore malformed source URLs */ }
  }
  return domains
}

export function outputLinks(blocks) {
  const links = []
  for (const block of blocks ?? []) {
    for (const link of block.links ?? []) {
      if (!links.some((value) => value.id === link.id)) links.push({ ...link })
    }
  }
  return links
}

export function outputPdfRefs(blocks) {
  const refs = []
  for (const block of blocks ?? []) {
    if (!(block.metadata ?? []).includes('PDF')) continue
    for (const ref of block.references ?? []) pushUnique(refs, ref)
  }
  return refs
}

export function blockPlainText(block) {
  return (block?.lines ?? []).map((line) => line.text).filter(Boolean).join(' ')
}
