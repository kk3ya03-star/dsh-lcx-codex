const RESULT_SEPARATOR_PATTERN = /(?:\r?\n)?-{80}(?:\r?\n)?/gu;
const CITATION_PATTERN = /cite([^]+)/gu;
const PAGE_LINE_PATTERN = /^L(\d+)(?:@P(\d+)(?:-(\d+))?)?:\s?(.*)$/u;
const EMBEDDED_PAGE_LINE_PATTERN = / (?=L\d+(?:@P\d+(?:-\d+)?)?:)/gu;
const TITLE_URL_PATTERN = /^(.*?)\s*\((https?:\/\/[^)]+)\)\s*$/u;

export interface WebRunLink {
  id: number;
  label: string;
  domain?: string;
  url?: string;
}

export interface WebRunLine {
  text: string;
  heading?: number;
  line?: number;
  page?: number;
  pageEnd?: number;
}

export interface WebRunBlock {
  title?: string;
  url?: string;
  references: string[];
  links: WebRunLink[];
  metadata: string[];
  lines: WebRunLine[];
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

function pushLink(target: WebRunLink[], payload: string): boolean {
  const [idValue, labelValue, domainValue] = payload.split("†");
  if (!/^\d+$/u.test(idValue ?? "") || !labelValue) return false;
  const id = Number(idValue);
  if (!Number.isSafeInteger(id)) return false;
  const label = labelValue.trim().slice(0, 500);
  const domain = domainValue?.trim().slice(0, 253);
  if (!label) return false;
  const existing = target.find((link) => link.id === id);
  if (!existing) target.push({ id, label, ...(domain ? { domain } : {}) });
  else if (!existing.domain && domain) existing.domain = domain;
  return true;
}

function cleanCitations(value: string, references: string[], links: WebRunLink[]): string {
  return String(value ?? "")
    .replace(CITATION_PATTERN, (_match, payload: string) => {
      if (/^turn[\w-]+$/u.test(payload)) {
        pushUnique(references, payload);
        return "";
      }
      if (pushLink(links, payload)) return payload.split("†")[1] ?? "";
      const separator = payload.indexOf("†");
      return separator < 0 ? payload : payload.slice(separator + 1);
    })
    .trim();
}

function metadataParts(value: string): string[] {
  return value
    .replace(/^\[wordlim:\s*(\d+)\]\s*/u, "$1-word excerpt; ")
    .split(/;\s*/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const contentType = part.match(/^Content type:\s*(.+)$/u);
      if (contentType)
        return contentType[1] === "text/html"
          ? "HTML"
          : contentType[1] === "application/pdf"
            ? "PDF"
            : contentType[1];
      const totalLines = part.match(/^Total lines:\s*(\d+)$/u);
      if (totalLines) return `${totalLines[1]} lines`;
      const pages = part.match(/^Number of pages:\s*(\d+)$/u);
      if (pages) return `${pages[1]} pages`;
      return part;
    });
}

function isMetadata(value: string): boolean {
  return (
    value.startsWith("[wordlim:") ||
    /^(?:Published|Crawled|Content type|Source|Total lines|Number of pages):/u.test(value)
  );
}

function parseLine(value: string, references: string[], links: WebRunLink[]): WebRunLine {
  const clean = cleanCitations(value, references, links);
  const pageLine = clean.match(PAGE_LINE_PATTERN);
  if (pageLine) {
    const text = pageLine[4] ?? "";
    const heading = text.match(/^(#{1,6})\s+(.+)$/u);
    return {
      line: Number(pageLine[1]),
      ...(pageLine[2] === undefined ? {} : { page: Number(pageLine[2]) }),
      ...(pageLine[3] === undefined ? {} : { pageEnd: Number(pageLine[3]) }),
      text: heading?.[2] ?? text,
      ...(heading ? { heading: heading[1].length } : {}),
    };
  }
  const heading = clean.match(/^(#{1,6})\s+(.+)$/u);
  return heading ? { text: heading[2], heading: heading[1].length } : { text: clean };
}

function parseBlock(value: string): WebRunBlock | undefined {
  const references: string[] = [];
  const links: WebRunLink[] = [];
  const rawLines = value
    .replace(EMBEDDED_PAGE_LINE_PATTERN, "\n")
    .split(/\r?\n/u)
    .map((line) => line.trimEnd());
  while (rawLines[0]?.trim() === "") rawLines.shift();
  while (rawLines.at(-1)?.trim() === "") rawLines.pop();
  if (!rawLines.length) return undefined;
  const firstLine = cleanCitations(rawLines[0], references, links);
  const header = firstLine.match(TITLE_URL_PATTERN);
  const titleOnly = firstLine.match(/^(.+?)\s*\(\)\s*$/u);
  let title = header?.[1]?.trim() || titleOnly?.[1]?.trim() || undefined;
  const url = header?.[2];
  let bodyStart = header || titleOnly ? 1 : 0;
  if (!header && /^\s*\([^)]*\)\s*$/u.test(firstLine)) bodyStart = 1;
  const metadata: string[] = [];
  while (bodyStart < rawLines.length) {
    const clean = cleanCitations(rawLines[bodyStart], references, links);
    if (!isMetadata(clean)) break;
    metadata.push(...metadataParts(clean));
    bodyStart += 1;
  }
  const lines = rawLines.slice(bodyStart).map((line) => parseLine(line, references, links));
  if (!title && url) {
    try {
      title = new URL(url).hostname;
    } catch {
      title = url;
    }
  }
  return { ...(title ? { title } : {}), ...(url ? { url } : {}), references, links, metadata, lines };
}

export function parseWebRunOutput(output: string): WebRunBlock[] {
  return typeof output === "string" && output
    ? output.split(RESULT_SEPARATOR_PATTERN).map(parseBlock).filter((block): block is WebRunBlock => block !== undefined)
    : [];
}

export function outputLineRange(blocks: WebRunBlock[]): { first: number; last: number } | undefined {
  const numbers = blocks.flatMap((block) => block.lines.flatMap((line) => line.line === undefined ? [] : [line.line]));
  return numbers.length ? { first: Math.min(...numbers), last: Math.max(...numbers) } : undefined;
}

export function outputDomains(blocks: WebRunBlock[]): string[] {
  const domains: string[] = [];
  for (const block of blocks) if (block.url) {
    try { pushUnique(domains, new URL(block.url).hostname); } catch {}
  }
  return domains;
}

export function outputLinks(blocks: WebRunBlock[]): WebRunLink[] {
  const links: WebRunLink[] = [];
  for (const block of blocks) for (const link of block.links) {
    if (!links.some((value) => value.id === link.id)) links.push({ ...link });
  }
  return links;
}

export function mergeWebRunLinks(base: WebRunLink[], extra: WebRunLink[]): WebRunLink[] {
  const links: WebRunLink[] = [];
  for (const link of [...base, ...extra]) {
    if (!Number.isSafeInteger(link.id) || !link.label) continue;
    const existing = links.find((value) => value.id === link.id);
    if (!existing) {
      links.push({
        id: link.id,
        label: link.label,
        ...(link.domain ? { domain: link.domain } : {}),
        ...(link.url ? { url: link.url } : {}),
      });
      continue;
    }
    if (!existing.domain && link.domain) existing.domain = link.domain;
    if (!existing.url && link.url) existing.url = link.url;
  }
  return links;
}

export function outputPdfRefs(blocks: WebRunBlock[]): string[] {
  const refs: string[] = [];
  for (const block of blocks) {
    if (!block.metadata.includes("PDF")) continue;
    for (const ref of block.references) pushUnique(refs, ref);
  }
  return refs;
}

export function blockPlainText(block: Pick<WebRunBlock, "lines">): string {
  return block.lines.map((line) => line.text).filter(Boolean).join(" ");
}
