export type SearchMediaItem = {
  readonly kind: "image" | "video" | "page";
  readonly url: string;
  readonly poster?: string;
  readonly previewUrl?: string;
  readonly sourceUrl?: string;
  readonly caption?: string;
  readonly structured?: true;
};

export const SEARCH_MEDIA_LIMIT = 60;

const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|gif|avif)$/i;
const VIDEO_EXTENSION = /\.(?:mp4|webm|ogv)$/i;
const URL_TOKEN = /https?:\/\/[^\s<>"'`，。；：！？、“”‘’（）【】《》]+/gi;
const REFERENCE_DEFINITION = /^ {0,3}\[([^\]\r\n]+)\]:[ \t]*(?:<([^>\s]+)>|(\S+))(?:[ \t]+.*)?$/gm;
const REFERENCE_IMAGE = /!\[([^\]\r\n]*)\](?:\s*\[([^\]\r\n]*)\])?/g;
const REFERENCE_LINK = /(^|[^!])\[([^\]\r\n]+)\]\s*\[([^\]\r\n]*)\]/g;

function stripFencedCode(text: string): string {
  const lines = text.split(/(?<=\n)/);
  let fence: { marker: string; length: number } | null = null;
  return lines
    .map((line) => {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)/);
      if (fence === null) {
        if (/^(?: {4}|\t)/.test(line)) return line.replace(/[^\r\n]/g, " ");
        if (match === null) return line;
        fence = { marker: match[1][0], length: match[1].length };
        return line.replace(/[^\r\n]/g, " ");
      }
      const closes =
        match !== null &&
        match[1][0] === fence.marker &&
        match[1].length >= fence.length &&
        match[2].trim() === "";
      if (closes) fence = null;
      return line.replace(/[^\r\n]/g, " ");
    })
    .join("");
}

function stripInlineCode(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; ) {
    if (text[index] !== "`") {
      result += text[index++];
      continue;
    }
    let end = index;
    while (text[end] === "`") end += 1;
    const marker = text.slice(index, end);
    const close = text.indexOf(marker, end);
    if (close === -1) {
      result += marker;
      index = end;
      continue;
    }
    result += " ".repeat(close + marker.length - index);
    index = close + marker.length;
  }
  return result;
}

function stripHtml(text: string): string {
  return text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(https?:\/\/[^<>\s]+)>/gi, "$1")
    .replace(/<[^>]*>/g, " ");
}

function destination(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">", 1);
    return end === -1 ? null : trimmed.slice(1, end);
  }
  const match = trimmed.match(/^(?:\\.|\S)+/);
  return match?.[0]?.replace(/\\([()[\]])/g, "$1") ?? null;
}

function eraseInlineImages(
  text: string,
  onDestination: (value: string) => void,
): string {
  const chars = text.split("");
  for (let index = 0; index < text.length - 2; index += 1) {
    if (text[index] !== "!" || text[index + 1] !== "[") continue;
    let labelEnd = index + 2;
    for (; labelEnd < text.length; labelEnd += 1) {
      if (text[labelEnd] === "\\") labelEnd += 1;
      else if (text[labelEnd] === "]") break;
    }
    if (labelEnd >= text.length) continue;
    let open = labelEnd + 1;
    while (text[open] === " " || text[open] === "\t") open += 1;
    if (text[open] !== "(") continue;
    let depth = 1;
    let close = open + 1;
    for (; close < text.length && depth > 0; close += 1) {
      if (text[close] === "\\") close += 1;
      else if (text[close] === "(") depth += 1;
      else if (text[close] === ")") depth -= 1;
    }
    if (depth !== 0) continue;
    const value = destination(text.slice(open + 1, close - 1));
    if (value !== null) onDestination(value);
    for (let offset = index; offset < close; offset += 1) chars[offset] = " ";
    index = close - 1;
  }
  return chars.join("");
}

function collectInlineLinkDestinations(
  text: string,
  onDestination: (value: string) => void,
): string {
  const chars = text.split("");
  for (let index = 0; index < text.length - 1; index += 1) {
    if (text[index] !== "[" || text[index - 1] === "!") continue;
    let labelEnd = index + 1;
    for (; labelEnd < text.length; labelEnd += 1) {
      if (text[labelEnd] === "\\") labelEnd += 1;
      else if (text[labelEnd] === "]") break;
    }
    if (labelEnd >= text.length) continue;
    let open = labelEnd + 1;
    while (text[open] === " " || text[open] === "\t") open += 1;
    if (text[open] !== "(") continue;
    let depth = 1;
    let close = open + 1;
    for (; close < text.length && depth > 0; close += 1) {
      if (text[close] === "\\") close += 1;
      else if (text[close] === "(") depth += 1;
      else if (text[close] === ")") depth -= 1;
    }
    if (depth !== 0) continue;
    const value = destination(text.slice(open + 1, close - 1));
    if (value !== null) onDestination(value);
    for (let offset = index; offset < close; offset += 1) chars[offset] = " ";
    index = close - 1;
  }
  return chars.join("");
}

function trimUrlToken(value: string): string {
  let result = value;
  const pairs: readonly [string, string][] = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ];
  let changed = true;
  while (changed && result.length > 0) {
    changed = false;
    const last = result.at(-1) ?? "";
    if (".,;:!".includes(last)) {
      result = result.slice(0, -1);
      changed = true;
      continue;
    }
    for (const [open, close] of pairs) {
      if (last !== close) continue;
      const opens = result.split(open).length - 1;
      const closes = result.split(close).length - 1;
      if (closes > opens) {
        result = result.slice(0, -1);
        changed = true;
      }
      break;
    }
  }
  return result;
}

function isPublicIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return true;
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) return false;
  const [a, b] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPublicHostname(value: string): boolean {
  const hostname = value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home")
  )
    return false;
  if (hostname.includes(":")) {
    const compact = hostname.replace(/^0+/, "");
    return !(
      compact === "" ||
      compact === "::" ||
      compact === "::1" ||
      compact.startsWith("fc") ||
      compact.startsWith("fd") ||
      /^fe[89ab]/.test(compact) ||
      compact.startsWith("ff") ||
      compact.startsWith("2001:db8:") ||
      compact.startsWith("::ffff:")
    );
  }
  if (!isPublicIpv4(hostname)) return false;
  if (/^\d+(?:\.\d+){3}$/.test(hostname)) return true;
  return hostname.includes(".");
}

function publicHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(trimUrlToken(value));
  } catch {
    return null;
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !isPublicHostname(parsed.hostname)
  )
    return null;
  return parsed;
}

function mediaItem(value: string): SearchMediaItem | null {
  const parsed = publicHttpUrl(value);
  if (parsed === null) return null;
  const imageCdn = parsed.protocol === 'https:' && ['images.unsplash.com','plus.unsplash.com','images.pexels.com'].includes(parsed.hostname) && !/\.(svg|html?|js)$/i.test(parsed.pathname);
  const kind = IMAGE_EXTENSION.test(parsed.pathname) || imageCdn
    ? "image"
    : VIDEO_EXTENSION.test(parsed.pathname)
      ? "video"
      : null;
  return kind === null ? null : { kind, url: parsed.href };
}

function referenceLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type StructuredMediaTool = "web_search" | "websearch_gpt_advanced";

/** Narrow LCX-owned tool-private media metadata without reading model-visible output. */
export function structuredSearchMedia(
  meta: unknown,
  expectedTool: StructuredMediaTool,
): readonly SearchMediaItem[] {
  if (!record(meta) || !record(meta.lcxHostedMedia)) return [];
  const owned = meta.lcxHostedMedia;
  if (owned.version !== 1 || owned.tool !== expectedTool || !Array.isArray(owned.candidates)) return [];
  const result: SearchMediaItem[] = [];
  const seen = new Set<string>();
  for (const candidate of owned.candidates) {
    if (!record(candidate) || candidate.structured !== true ||
        (candidate.kind !== "image" && candidate.kind !== "video")) continue;
    const url = publicHttpUrl(candidate.url);
    if (!url || seen.has(url.href)) continue;
    const previewUrl = publicHttpUrl(candidate.previewUrl);
    const sourceUrl = publicHttpUrl(candidate.sourceUrl);
    const poster = publicHttpUrl(candidate.poster);
    seen.add(url.href);
    result.push({
      kind: candidate.kind,
      url: url.href,
      ...(previewUrl ? { previewUrl: previewUrl.href } : {}),
      ...(sourceUrl ? { sourceUrl: sourceUrl.href } : {}),
      ...(poster ? { poster: poster.href } : {}),
      ...(typeof candidate.caption === "string" && candidate.caption.trim()
        ? { caption: candidate.caption.trim().slice(0, 500) }
        : {}),
      structured: true,
    });
    if (result.length === SEARCH_MEDIA_LIMIT) break;
  }
  return result;
}

export function mergeSearchMedia(
  structured: readonly SearchMediaItem[],
  fallback: readonly SearchMediaItem[],
): readonly SearchMediaItem[] {
  const result: SearchMediaItem[] = [];
  const seen = new Set<string>();
  for (const item of [...structured, ...fallback]) {
    const key = `${item.kind}\u0000${item.kind === "video" ? item.url : item.url.replace(/#.*$/, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length === SEARCH_MEDIA_LIMIT) break;
  }
  return result;
}

/** Extract bounded remote media linked by visible assistant prose. */
export function extractSearchMedia(text: string): readonly SearchMediaItem[] {
  let visible = stripHtml(stripInlineCode(stripFencedCode(text)));
  const definitions = new Map<string, string>();
  visible.replace(REFERENCE_DEFINITION, (_match, label: string, angle: string, bare: string) => {
    definitions.set(referenceLabel(label), angle ?? bare);
    return _match;
  });

  const nativeImages = new Set<string>();
  const addNativeImage = (value: string) => {
    const item = mediaItem(value);
    if (item?.kind === "image") nativeImages.add(new URL(item.url).href.replace(/#.*$/, ""));
  };
  visible = eraseInlineImages(visible, addNativeImage);
  visible = visible.replace(
    REFERENCE_IMAGE,
    (_match, alt: string, explicit: string | undefined) => {
      const value = definitions.get(referenceLabel(explicit === undefined || explicit === "" ? alt : explicit));
      if (value !== undefined) addNativeImage(value);
      return " ".repeat(_match.length);
    },
  );

  const candidates: string[] = [];
  visible = collectInlineLinkDestinations(
    visible,
    (value) => candidates.push(value),
  );
  visible.replace(
    REFERENCE_LINK,
    (_match, prefix: string, label: string, explicit: string) => {
      const value = definitions.get(referenceLabel(explicit === "" ? label : explicit));
      if (value !== undefined) candidates.push(value);
      return _match;
    },
  );
  visible = visible.replace(REFERENCE_DEFINITION, " ");
  for (const match of visible.matchAll(URL_TOKEN)) candidates.push(match[0]);

  const result: SearchMediaItem[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const item = mediaItem(candidate);
    if (item === null) continue;
    const key = item.kind === 'video' ? item.url : item.url.replace(/#.*$/, "");
    if (nativeImages.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length === SEARCH_MEDIA_LIMIT) break;
  }
  return result;
}
