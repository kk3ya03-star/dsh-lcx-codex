"use strict";
(() => {
  // src/client/search-media.ts
  var SEARCH_MEDIA_LIMIT = 60;
  var VIDEO_EXTENSION = /\.(?:mp4|webm|ogv)$/i;
  var IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|gif|avif)$/i;
  var IMAGE_CDN_HOSTS = /* @__PURE__ */ new Set(["images.unsplash.com", "plus.unsplash.com", "images.pexels.com"]);
  var URL_TOKEN = /https?:\/\/[^\s<>"'`，。；：！？、“”‘’（）【】《》]+/gi;
  var REFERENCE_DEFINITION = /^ {0,3}\[([^\]\r\n]+)\]:[ \t]*(?:<([^>\s]+)>|(\S+))(?:[ \t]+.*)?$/gm;
  var REFERENCE_IMAGE = /!\[([^\]\r\n]*)\](?:\s*\[([^\]\r\n]*)\])?/g;
  var REFERENCE_LINK = /(^|[^!])\[([^\]\r\n]+)\]\s*\[([^\]\r\n]*)\]/g;
  function stripFencedCode(text) {
    const lines = text.split(/(?<=\n)/);
    let fence = null;
    return lines.map((line) => {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)/);
      if (fence === null) {
        if (/^(?: {4}|\t)/.test(line)) return line.replace(/[^\r\n]/g, " ");
        if (match === null) return line;
        fence = { marker: match[1][0], length: match[1].length };
        return line.replace(/[^\r\n]/g, " ");
      }
      const closes = match !== null && match[1][0] === fence.marker && match[1].length >= fence.length && match[2].trim() === "";
      if (closes) fence = null;
      return line.replace(/[^\r\n]/g, " ");
    }).join("");
  }
  function stripInlineCode(text) {
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
  function stripHtml(text) {
    return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<(https?:\/\/[^<>\s]+)>/gi, "$1").replace(/<[^>]*>/g, " ");
  }
  function destination(value) {
    const trimmed = value.trim();
    if (trimmed.startsWith("<")) {
      const end = trimmed.indexOf(">", 1);
      return end === -1 ? null : trimmed.slice(1, end);
    }
    const match = trimmed.match(/^(?:\\.|\S)+/);
    return match?.[0]?.replace(/\\([()[\]])/g, "$1") ?? null;
  }
  function eraseInlineImages(text, onDestination) {
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
      while (text[open] === " " || text[open] === "	") open += 1;
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
  function collectInlineLinkDestinations(text, onDestination) {
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
      while (text[open] === " " || text[open] === "	") open += 1;
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
  function trimUrlToken(value) {
    let result = value;
    const pairs = [
      ["(", ")"],
      ["[", "]"],
      ["{", "}"]
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
  function isPublicIpv4(hostname) {
    const parts = hostname.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return true;
    const octets = parts.map(Number);
    if (octets.some((part) => part > 255)) return false;
    const [a, b] = octets;
    return !(a === 0 || a === 10 || a === 127 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 0 || a === 192 && b === 168 || a === 198 && (b === 18 || b === 19) || a >= 224);
  }
  function isPublicHostname(value) {
    const hostname = value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".lan") || hostname.endsWith(".home"))
      return false;
    if (hostname.includes(":")) {
      const compact = hostname.replace(/^0+/, "");
      return !(compact === "" || compact === "::" || compact === "::1" || compact.startsWith("fc") || compact.startsWith("fd") || /^fe[89ab]/.test(compact) || compact.startsWith("ff") || compact.startsWith("2001:db8:") || compact.startsWith("::ffff:"));
    }
    if (!isPublicIpv4(hostname)) return false;
    if (/^\d+(?:\.\d+){3}$/.test(hostname)) return true;
    return hostname.includes(".");
  }
  function publicHttpUrl(value) {
    if (typeof value !== "string") return null;
    let parsed;
    try {
      parsed = new URL(trimUrlToken(value));
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || !isPublicHostname(parsed.hostname))
      return null;
    return parsed;
  }
  function proseMediaItem(value) {
    const parsed = publicHttpUrl(value);
    if (parsed === null) return null;
    if (VIDEO_EXTENSION.test(parsed.pathname)) return { kind: "video", url: parsed.href };
    if (IMAGE_EXTENSION.test(parsed.pathname) || parsed.protocol === "https:" && IMAGE_CDN_HOSTS.has(parsed.hostname) && !/\.(?:svg|html?|js)$/i.test(parsed.pathname))
      return { kind: "image", url: parsed.href };
    return null;
  }
  function referenceLabel(value) {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
  }
  function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function structuredSearchMedia(meta, expectedTool) {
    if (!record(meta) || !record(meta.lcxHostedMedia)) return [];
    const owned = meta.lcxHostedMedia;
    if (owned.version !== 1 || owned.tool !== expectedTool || !Array.isArray(owned.candidates)) return [];
    const result = [];
    const seen = /* @__PURE__ */ new Set();
    for (const candidate of owned.candidates) {
      if (!record(candidate) || candidate.structured !== true || candidate.kind !== "image" && candidate.kind !== "video") continue;
      const url = publicHttpUrl(candidate.url);
      if (!url || seen.has(url.href)) continue;
      const previewUrl = publicHttpUrl(candidate.previewUrl);
      const sourceUrl = publicHttpUrl(candidate.sourceUrl);
      const poster = publicHttpUrl(candidate.poster);
      seen.add(url.href);
      result.push({
        kind: candidate.kind,
        url: url.href,
        ...previewUrl ? { previewUrl: previewUrl.href } : {},
        ...sourceUrl ? { sourceUrl: sourceUrl.href } : {},
        ...poster ? { poster: poster.href } : {},
        ...typeof candidate.caption === "string" && candidate.caption.trim() ? { caption: candidate.caption.trim().slice(0, 500) } : {},
        structured: true
      });
      if (result.length === SEARCH_MEDIA_LIMIT) break;
    }
    return result;
  }
  function mergeSearchMedia(structured, fallback) {
    const result = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of [...structured, ...fallback]) {
      const key = `${item.kind}\0${item.kind === "video" ? item.url : item.url.replace(/#.*$/, "")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
      if (result.length === SEARCH_MEDIA_LIMIT) break;
    }
    return result;
  }
  function extractDirectMediaLinks(text) {
    let visible = stripHtml(stripInlineCode(stripFencedCode(text)));
    const definitions = /* @__PURE__ */ new Map();
    visible.replace(REFERENCE_DEFINITION, (_match, label, angle, bare) => {
      definitions.set(referenceLabel(label), angle ?? bare);
      return _match;
    });
    const nativeImages = /* @__PURE__ */ new Set();
    const addNative = (value) => {
      const parsed = publicHttpUrl(value);
      if (parsed) nativeImages.add(parsed.href.replace(/#.*$/, ""));
    };
    visible = eraseInlineImages(visible, addNative);
    visible = visible.replace(REFERENCE_IMAGE, (_match, alt, explicit) => {
      const value = definitions.get(referenceLabel(explicit === void 0 || explicit === "" ? alt : explicit));
      if (value !== void 0) addNative(value);
      return " ".repeat(_match.length);
    });
    const candidates = [];
    visible = collectInlineLinkDestinations(
      visible,
      (value) => candidates.push(value)
    );
    visible.replace(
      REFERENCE_LINK,
      (_match, _prefix, label, explicit) => {
        const value = definitions.get(referenceLabel(explicit === "" ? label : explicit));
        if (value !== void 0) candidates.push(value);
        return _match;
      }
    );
    visible = visible.replace(REFERENCE_DEFINITION, " ");
    for (const match of visible.matchAll(URL_TOKEN)) candidates.push(match[0]);
    const result = [];
    const seen = /* @__PURE__ */ new Set();
    for (const candidate of candidates) {
      const item = proseMediaItem(candidate);
      if (item === null) continue;
      const key = item.kind === "video" ? item.url : item.url.replace(/#.*$/, "");
      if (seen.has(key) || item.kind === "image" && nativeImages.has(key)) continue;
      seen.add(key);
      result.push(item);
      if (result.length === SEARCH_MEDIA_LIMIT) break;
    }
    return result;
  }

  // src/client/inline-media.ts
  var inlineMediaCss = `
[data-chat-flow-kind="lcx-search-media"]{display:none!important}
.lcx-media{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;min-width:0;max-width:100%;margin:16px 0 4px;font-family:var(--dsw-font-family,inherit);color:var(--dsw-alias-label-primary,inherit)}
.lcx-media *{box-sizing:border-box}
.lcx-media[hidden]{display:none}
.lcx-media-rail{position:relative;min-width:0;--lcx-h:136px}
.lcx-media-rail[data-count="1"]{--lcx-h:220px}
.lcx-media-rail[data-count="2"]{--lcx-h:176px}
.lcx-media-track{--lcx-fade-l:0px;--lcx-fade-r:0px;display:flex;gap:8px;margin:0;padding:0;list-style:none;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x proximity;scroll-behavior:smooth;scrollbar-width:none;overscroll-behavior-x:contain;-webkit-mask-image:linear-gradient(to right,transparent 0,#000 var(--lcx-fade-l),#000 calc(100% - var(--lcx-fade-r)),transparent 100%);mask-image:linear-gradient(to right,transparent 0,#000 var(--lcx-fade-l),#000 calc(100% - var(--lcx-fade-r)),transparent 100%)}
.lcx-media-track::-webkit-scrollbar{display:none}
.lcx-media-rail[data-more-left] .lcx-media-track{--lcx-fade-l:40px}
.lcx-media-rail[data-more-right] .lcx-media-track{--lcx-fade-r:40px}
.lcx-media-tile{position:relative;flex:none;height:var(--lcx-h);aspect-ratio:var(--lcx-ar,4/3);max-width:100%;margin:0;padding:0;scroll-snap-align:start;border-radius:var(--dsw-radius-md,12px);overflow:hidden;background:var(--dsw-alias-bg-skeleton,#0000000a)}
.lcx-media-tile::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2,#0000001a);pointer-events:none}
.lcx-media-tile[data-state="loading"]{background:linear-gradient(100deg,var(--dsw-alias-bg-skeleton,#0000000a) 30%,var(--dsw-alias-interactive-bg-hover,#2631480f) 50%,var(--dsw-alias-bg-skeleton,#0000000a) 70%) 0 0/300% 100%;animation:lcx-media-shimmer 1.4s ease-in-out infinite}
@keyframes lcx-media-shimmer{from{background-position:100% 0}to{background-position:0 0}}
.lcx-media-open{position:absolute;inset:0;display:block;width:100%;height:100%;margin:0;padding:0;border:0;border-radius:inherit;background:none;color:inherit;font:inherit;cursor:zoom-in}
.lcx-media-open:disabled{cursor:default}
.lcx-media-open img{display:block;width:100%;height:100%;max-width:none;margin:0;padding:0;border:0;border-radius:0;object-fit:cover;opacity:0;transition:opacity .25s ease,transform .45s cubic-bezier(.2,.7,.2,1)}
.lcx-media-tile[data-state="loaded"] .lcx-media-open img{opacity:1}
.lcx-media-tile[data-fit="contain"] .lcx-media-open img{object-fit:contain}
.lcx-media-tile[data-state="loaded"]:hover .lcx-media-open img{transform:scale(1.04)}
.lcx-media-fail{position:absolute;inset:0;display:grid;place-items:center;color:var(--dsw-alias-label-tertiary,#8a93a6)}
.lcx-media-fail svg{width:22px;height:22px}
.lcx-media-chip{position:absolute;left:6px;bottom:6px;z-index:1;max-width:calc(100% - 12px);overflow:hidden;padding:2px 8px;border-radius:var(--dsw-radius-xs,6px);background:#00000073;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#fff;font-size:11px;line-height:16px;font-weight:500;white-space:nowrap;text-overflow:ellipsis;text-decoration:none;opacity:0;transform:translateY(3px);transition:opacity .18s ease,transform .18s ease}
a.lcx-media-chip:hover{text-decoration:underline;text-underline-offset:2px}
.lcx-media-tile:hover .lcx-media-chip,.lcx-media-tile:focus-within .lcx-media-chip,.lcx-media-tile[data-state="failed"] .lcx-media-chip{opacity:1;transform:none}
.lcx-media-tile[data-state="failed"] .lcx-media-chip{background:transparent;-webkit-backdrop-filter:none;backdrop-filter:none;color:var(--dsw-alias-label-tertiary,#8a93a6)}
.lcx-media-nav{position:absolute;top:50%;z-index:2;display:grid;place-items:center;width:32px;height:32px;margin-top:-16px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 0 0 .5px var(--dsw-alias-border-l3,#0000001f),0 2px 10px #00000021;color:var(--dsw-alias-label-primary,#1f2430);cursor:pointer;opacity:0;transition:opacity .15s ease}
.lcx-media-nav[hidden]{display:none}
.lcx-media-nav[data-dir="prev"]{left:8px}
.lcx-media-nav[data-dir="next"]{right:8px}
.lcx-media-nav svg{width:16px;height:16px}
.lcx-media-rail:hover .lcx-media-nav,.lcx-media-nav:focus-visible{opacity:1}
.lcx-media-videos{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,210px),1fr));gap:8px;min-width:0}
.lcx-media-video{display:flex;align-items:center;gap:10px;width:100%;min-width:0;margin:0;padding:6px 12px 6px 6px;border:0;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .15s ease}
.lcx-media-video:hover{background:var(--dsw-alias-interactive-bg-active,#26314817)}
.lcx-media-play{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:999px;background:var(--dsw-alias-label-primary,#1f2430);color:var(--dsw-alias-label-primary-foreground,#fff);transition:transform .15s ease}
.lcx-media-video:hover .lcx-media-play{transform:scale(1.06)}
.lcx-media-play svg{width:16px;height:16px;margin-left:2px}
.lcx-media-video-text{display:flex;flex-direction:column;min-width:0}
.lcx-media-video-title{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:13px;line-height:19px;font-weight:500;color:var(--dsw-alias-label-primary,inherit)}
.lcx-media-video-sub{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8a93a6)}
.lcx-media-player{grid-column:1/-1;position:relative;width:min(100%,640px);aspect-ratio:16/9;border-radius:var(--dsw-radius-md,12px);overflow:hidden;background:#000}
.lcx-media-player video{display:block;width:100%;height:100%;max-width:none;margin:0;border:0;object-fit:contain;background:#000}
.lcx-media-player-close{position:absolute;top:8px;right:8px;z-index:1;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:999px;background:#00000080;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#fff;cursor:pointer}
.lcx-media-player-close svg,.lcx-media-close svg{width:14px;height:14px}
.lcx-media-player-fail{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:16px;color:#ffffffd9;font-size:13px;line-height:20px;text-align:center}
.lcx-media-player-fail a{color:#fff;text-decoration:underline;text-underline-offset:3px}
.lcx-media-open:focus-visible,.lcx-media-chip:focus-visible,.lcx-media-nav:focus-visible,.lcx-media-video:focus-visible,.lcx-media-player-close:focus-visible,.lcx-media-close:focus-visible,.lcx-media-dialog a:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-link,#416de0));outline-offset:2px}
.lcx-media-open:focus-visible{outline-offset:-2px}
.lcx-media-dialog{position:fixed;inset:0;box-sizing:border-box;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:48px;border:0;overflow:hidden;background:var(--dsw-alias-bg-mask-1,#0009);-webkit-backdrop-filter:var(--dsw-mask-blur,blur(8px));backdrop-filter:var(--dsw-mask-blur,blur(8px));color:var(--dsw-alias-label-primary,inherit);font-family:var(--dsw-font-family,inherit)}
.lcx-media-dialog[open]{display:grid;place-items:center}
.lcx-media-dialog::backdrop{background:transparent}
.lcx-media-dialog-body{display:flex;flex-direction:column;align-items:center;gap:12px;min-width:0;max-width:min(100%,1600px);max-height:100%}
.lcx-media-dialog img{display:block;max-width:100%;max-height:calc(100vh - 150px);width:auto;height:auto;object-fit:contain;border-radius:var(--dsw-radius-md,12px);box-shadow:var(--dsw-elevation-prominent,0 10px 40px #0005)}
.lcx-media-dialog-fail{display:grid;place-items:center;min-width:min(320px,100%);min-height:160px;padding:24px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#5a6478);font-size:13px;line-height:20px}
.lcx-media-dialog-bar{display:flex;align-items:center;gap:14px;max-width:100%;padding:6px 16px;border-radius:999px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 0 0 .5px var(--dsw-alias-border-l3,#0000001f);font-size:12px;line-height:20px}
.lcx-media-dialog-caption{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary,#5a6478)}
.lcx-media-dialog-bar a{flex:none;color:var(--dsw-alias-link,#416de0);text-decoration:none}
.lcx-media-dialog-bar a:hover{text-decoration:underline;text-underline-offset:3px}
.lcx-media-close{position:fixed;top:20px;right:20px;z-index:1;display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 0 0 .5px var(--dsw-alias-border-l3,#0000001f);color:var(--dsw-alias-label-primary,#1f2430);cursor:pointer}
@media(max-width:520px){.lcx-media-rail{--lcx-h:112px}.lcx-media-rail[data-count="1"]{--lcx-h:184px}.lcx-media-rail[data-count="2"]{--lcx-h:136px}.lcx-media-dialog{padding:16px}.lcx-media-close{top:12px;right:12px}}
@media(hover:none){.lcx-media-chip{opacity:1;transform:none}.lcx-media-nav{display:none}}
@media(prefers-reduced-motion:reduce){.lcx-media-track{scroll-behavior:auto}.lcx-media-tile[data-state="loading"]{animation:none}.lcx-media-open img,.lcx-media-chip,.lcx-media-nav,.lcx-media-video,.lcx-media-play{transition:none}.lcx-media-tile[data-state="loaded"]:hover .lcx-media-open img{transform:none}}
`;
  var nativeMarkdownImageCss = `
[data-chat-flow-kind="assistant-step"] p>button:has(>img:only-child){display:block;width:fit-content;max-width:100%;margin:4px 0 8px}
`;
  var ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 3.5l9 9m0-9l-9 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var ICON_BROKEN = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 16l4.5-4.5 3 3 2.5-2.5 7 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/></svg>';
  var ICON_PREV = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var TILE_ASPECT_MIN = 0.5;
  var TILE_ASPECT_MAX = 2.2;
  var imageKey = (url) => url.replace(/#.*$/, "");
  var hostOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };
  var fileNameOf = (url) => {
    try {
      const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "");
      return name || hostOf(url);
    } catch {
      return url;
    }
  };
  function railImages(items) {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const item of [...items.filter((value) => value.structured === true), ...items.filter((value) => value.structured !== true)]) {
      if (item.kind !== "image") continue;
      const key = imageKey(item.url);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }
  function videoItems(items) {
    const groups = /* @__PURE__ */ new Map();
    for (const item of items) {
      if (item.kind !== "video") continue;
      const url = new URL(item.url);
      const identity = JSON.stringify([url.origin, url.pathname.replace(/\.(mp4|webm|ogv)$/i, ""), url.search, url.hash]);
      const group = groups.get(identity) ?? [];
      if (!group.some((value) => value.url === item.url)) group.push(item);
      groups.set(identity, group);
    }
    const priority = (url) => ({ mp4: 0, webm: 1, ogv: 2 })[new URL(url).pathname.split(".").at(-1).toLowerCase()] ?? 3;
    return [...groups.values()].map((group) => {
      group.sort((a, b) => priority(a.url) - priority(b.url));
      return { ...group[0], sources: group.map((value) => value.url) };
    });
  }
  var activeDialogByDocument = /* @__PURE__ */ new WeakMap();
  function inlineMediaAnswer(marker) {
    const row = marker.closest('[data-chat-flow-kind="lcx-search-media"]');
    const ElementClass = marker.ownerDocument.defaultView?.HTMLElement;
    if (!ElementClass || !row || !row.dataset.chatTurn) return null;
    const group = row.closest("[data-chat-group-key][data-step-process]");
    const column = group?.parentElement;
    if (!group || !(column instanceof ElementClass) || !column.hasAttribute("data-chat-flow") || group.dataset.chatTurn !== row.dataset.chatTurn) return null;
    let answer = null;
    for (const child of column.children) {
      if (child === group) break;
      if (child instanceof ElementClass && child.dataset.chatFlowKind === "assistant-step" && child.dataset.chatGroupPart === "response" && child.dataset.chatTurn === row.dataset.chatTurn) {
        answer = child;
      }
    }
    return answer;
  }
  function installInlineMedia(marker, items, labels, host = {}) {
    const resolvedAnswer = inlineMediaAnswer(marker);
    const images = railImages(items), videos = videoItems(items);
    if (!resolvedAnswer || images.length === 0 && videos.length === 0) return () => {
    };
    const answer = resolvedAnswer;
    const doc = marker.ownerDocument;
    const win = doc.defaultView;
    const cleanups = [];
    let disposed = false;
    let frame = 0;
    let ownedClose;
    const token = Math.random().toString(36).slice(2);
    answer.dataset.lcxMediaOwner = token;
    for (const stale of [...answer.children]) if (stale.classList.contains("lcx-media")) stale.remove();
    const root = doc.createElement("div");
    root.className = "lcx-media";
    root.dataset.lcxMedia = "";
    function openDialog(item, trigger, description) {
      activeDialogByDocument.get(doc)?.();
      const dialog = doc.createElement("dialog");
      dialog.className = "lcx-media-dialog";
      dialog.setAttribute("aria-label", labels.imageDialog);
      dialog.dataset.kind = "image";
      const body = doc.createElement("div");
      body.className = "lcx-media-dialog-body";
      const close = doc.createElement("button");
      close.type = "button";
      close.className = "lcx-media-close";
      close.innerHTML = ICON_CLOSE;
      close.setAttribute("aria-label", labels.close);
      const bar = doc.createElement("div");
      bar.className = "lcx-media-dialog-bar";
      const caption = doc.createElement("span");
      caption.className = "lcx-media-dialog-caption";
      caption.textContent = description;
      caption.title = description;
      const source = doc.createElement("a");
      source.href = item.sourceUrl ?? item.url;
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      source.textContent = labels.source;
      bar.append(caption, source);
      let media;
      let closed = false;
      const image = doc.createElement("img");
      image.alt = description;
      image.referrerPolicy = "no-referrer";
      image.src = item.url;
      image.onerror = () => {
        if (closed) return;
        const fail = doc.createElement("div");
        fail.className = "lcx-media-dialog-fail";
        fail.textContent = labels.failed;
        media.onerror = null;
        media.replaceWith(fail);
        media = fail;
      };
      media = image;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        close.onclick = null;
        dialog.oncancel = null;
        dialog.onclick = null;
        dialog.onkeydown = null;
        media.onerror = null;
        dialog.remove();
        if (activeDialogByDocument.get(doc) === cleanup) activeDialogByDocument.delete(doc);
        if (ownedClose === cleanup) ownedClose = void 0;
        if (trigger.isConnected) trigger.focus({ preventScroll: true });
      };
      ownedClose = cleanup;
      activeDialogByDocument.set(doc, cleanup);
      close.onclick = cleanup;
      dialog.oncancel = (event) => {
        event.preventDefault();
        cleanup();
      };
      dialog.onclick = (event) => {
        if (event.target === dialog) cleanup();
      };
      dialog.onkeydown = (event) => {
        if (event.key !== "Tab") return;
        const focusable = [...dialog.querySelectorAll("button:not([disabled]),a[href]")];
        if (focusable.length === 0) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        const active = doc.activeElement;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      };
      body.append(media, bar);
      dialog.append(body, close);
      doc.body.append(dialog);
      dialog.showModal();
      close.focus();
    }
    function openImage(item, trigger, description) {
      activeDialogByDocument.get(doc)?.();
      if (host.openImage) {
        let closed = false;
        let dispose = null;
        const cleanup = () => {
          if (closed) return;
          closed = true;
          dispose?.();
          if (activeDialogByDocument.get(doc) === cleanup) activeDialogByDocument.delete(doc);
          if (ownedClose === cleanup) ownedClose = void 0;
          if (trigger.isConnected) trigger.focus({ preventScroll: true });
        };
        dispose = host.openImage({ src: item.url, alt: description, labels: { dialog: labels.imageDialog, close: labels.close }, onClose: cleanup });
        if (dispose) {
          ownedClose = cleanup;
          activeDialogByDocument.set(doc, cleanup);
          return;
        }
        closed = true;
      }
      openDialog(item, trigger, description);
    }
    if (images.length) {
      const rail = doc.createElement("div");
      rail.className = "lcx-media-rail";
      rail.dataset.count = String(Math.min(images.length, 3));
      const track = doc.createElement("ul");
      track.className = "lcx-media-track";
      track.setAttribute("role", "list");
      track.setAttribute("aria-label", `${labels.heading} \xB7 ${images.length}`);
      const makeNav = (dir) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "lcx-media-nav";
        button.dataset.dir = dir;
        button.hidden = true;
        button.tabIndex = -1;
        button.setAttribute("aria-label", dir === "prev" ? labels.previous : labels.next);
        button.innerHTML = dir === "prev" ? ICON_PREV : ICON_NEXT;
        button.onclick = () => track.scrollBy({ left: (dir === "prev" ? -1 : 1) * Math.max(160, track.clientWidth * 0.8), behavior: "smooth" });
        cleanups.push(() => {
          button.onclick = null;
        });
        return button;
      };
      const prev = makeNav("prev"), next = makeNav("next");
      const updateEdges = () => {
        if (disposed) return;
        const max = track.scrollWidth - track.clientWidth;
        const left = track.scrollLeft > 2, right = max - track.scrollLeft > 2;
        rail.toggleAttribute("data-more-left", left);
        rail.toggleAttribute("data-more-right", right);
        prev.hidden = !left;
        next.hidden = !right;
      };
      track.addEventListener("scroll", updateEdges, { passive: true });
      cleanups.push(() => track.removeEventListener("scroll", updateEdges));
      const Resize = win?.ResizeObserver;
      if (Resize) {
        const resize = new Resize(updateEdges);
        resize.observe(track);
        cleanups.push(() => resize.disconnect());
      }
      for (const item of images) {
        const domain = hostOf(item.sourceUrl ?? item.url);
        const description = item.caption ?? domain;
        const tile = doc.createElement("li");
        tile.className = "lcx-media-tile";
        tile.dataset.state = "loading";
        tile.dataset.url = item.url;
        const open = doc.createElement("button");
        open.type = "button";
        open.className = "lcx-media-open";
        open.setAttribute("aria-label", `${labels.image} \xB7 ${description}`);
        if (item.caption) open.title = item.caption;
        const image = doc.createElement("img");
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.draggable = false;
        open.append(image);
        let source = item.previewUrl ?? item.url;
        image.onload = () => {
          if (tile.dataset.state !== "loading") return;
          const ratio = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 0;
          if (ratio) tile.style.setProperty("--lcx-ar", String(Math.min(TILE_ASPECT_MAX, Math.max(TILE_ASPECT_MIN, ratio))));
          if (ratio && (ratio > TILE_ASPECT_MAX || ratio < TILE_ASPECT_MIN)) tile.dataset.fit = "contain";
          tile.dataset.state = "loaded";
          updateEdges();
        };
        image.onerror = () => {
          if (source !== item.url) {
            source = item.url;
            image.src = source;
            return;
          }
          image.onload = null;
          image.onerror = null;
          image.remove();
          if (item.structured !== true) {
            open.onclick = null;
            open.onfocus = null;
            tile.remove();
            rail.dataset.count = String(Math.min(track.children.length, 3));
            if (track.children.length === 0) {
              rail.remove();
              if (!root.querySelector(".lcx-media-videos")) root.hidden = true;
            }
            updateEdges();
            return;
          }
          tile.dataset.state = "failed";
          open.disabled = true;
          open.onclick = null;
          open.setAttribute("aria-label", `${labels.failed} \xB7 ${description}`);
          open.title = labels.failed;
          const fail = doc.createElement("span");
          fail.className = "lcx-media-fail";
          fail.innerHTML = ICON_BROKEN;
          open.append(fail);
        };
        image.src = source;
        open.onclick = () => openImage(item, open, description);
        open.onfocus = () => tile.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        const chip = item.sourceUrl ? doc.createElement("a") : doc.createElement("span");
        chip.className = "lcx-media-chip";
        chip.textContent = domain;
        chip.title = item.caption ? `${item.caption} \xB7 ${domain}` : domain;
        if (item.sourceUrl) {
          const anchor = chip;
          anchor.href = item.sourceUrl;
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
        }
        tile.append(open, chip);
        track.append(tile);
        cleanups.push(() => {
          open.onclick = null;
          open.onfocus = null;
          image.onload = null;
          image.onerror = null;
        });
      }
      rail.append(track, prev, next);
      root.append(rail);
    }
    if (videos.length) {
      const section = doc.createElement("div");
      section.className = "lcx-media-videos";
      for (const item of videos) {
        const name = fileNameOf(item.url);
        const format = item.sources.map((value) => /\.(mp4|webm|ogv)$/i.exec(new URL(value).pathname)?.[1]).filter(Boolean).join(" / ").toUpperCase();
        const card = doc.createElement("button");
        card.type = "button";
        card.className = "lcx-media-video";
        card.dataset.url = item.url;
        card.setAttribute("aria-label", `${labels.video} \xB7 ${name}`);
        const play = doc.createElement("span");
        play.className = "lcx-media-play";
        play.setAttribute("aria-hidden", "true");
        play.innerHTML = ICON_PLAY;
        const text = doc.createElement("span");
        text.className = "lcx-media-video-text";
        const title = doc.createElement("span");
        title.className = "lcx-media-video-title";
        title.textContent = name;
        title.title = item.url;
        const sub = doc.createElement("span");
        sub.className = "lcx-media-video-sub";
        sub.textContent = [hostOf(item.url), format].filter(Boolean).join(" \xB7 ");
        text.append(title, sub);
        card.append(play, text);
        let collapse;
        card.onclick = () => {
          const player = doc.createElement("div");
          player.className = "lcx-media-player";
          player.setAttribute("role", "group");
          player.setAttribute("aria-label", `${labels.dialog} \xB7 ${name}`);
          const video = doc.createElement("video");
          video.controls = true;
          video.playsInline = true;
          video.preload = "none";
          const poster = item.previewUrl ?? item.poster;
          if (poster) video.poster = poster;
          const close = doc.createElement("button");
          close.type = "button";
          close.className = "lcx-media-player-close";
          close.innerHTML = ICON_CLOSE;
          close.setAttribute("aria-label", labels.close);
          let sourceIndex = 0;
          let closed = false;
          video.onerror = () => {
            if (closed) return;
            if (sourceIndex + 1 < item.sources.length) {
              sourceIndex += 1;
              video.src = item.sources[sourceIndex];
              video.load();
              void video.play().catch(() => {
              });
              return;
            }
            video.onerror = null;
            video.pause();
            video.removeAttribute("src");
            video.load();
            video.remove();
            const fail = doc.createElement("div");
            fail.className = "lcx-media-player-fail";
            const message = doc.createElement("span");
            message.textContent = labels.videoFailed;
            const link = doc.createElement("a");
            link.href = item.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = labels.source;
            fail.append(message, link);
            player.append(fail);
          };
          collapse = (refocus = true) => {
            if (closed) return;
            closed = true;
            video.onerror = null;
            close.onclick = null;
            player.onkeydown = null;
            video.pause();
            video.removeAttribute("src");
            video.load();
            player.replaceWith(card);
            collapse = void 0;
            if (refocus && card.isConnected) card.focus({ preventScroll: true });
          };
          close.onclick = () => collapse?.();
          player.onkeydown = (event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              collapse?.();
            }
          };
          video.src = item.url;
          player.append(video, close);
          card.replaceWith(player);
          video.focus({ preventScroll: true });
          void video.play().catch(() => {
          });
        };
        section.append(card);
        cleanups.push(() => {
          collapse?.(false);
          card.onclick = null;
        });
      }
      root.append(section);
    }
    answer.append(root);
    const keepAttached = () => {
      frame = 0;
      if (disposed) return;
      if (answer.dataset.lcxMediaOwner !== token) {
        root.remove();
        return;
      }
      if (root.parentElement !== answer || answer.lastElementChild !== root) answer.append(root);
    };
    const observer = new MutationObserver(() => {
      if (!disposed && !frame) frame = requestAnimationFrame(keepAttached);
    });
    observer.observe(answer, { childList: true });
    return () => {
      if (disposed) return;
      observer.disconnect();
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      ownedClose?.();
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
      disposed = true;
      if (answer.dataset.lcxMediaOwner === token) delete answer.dataset.lcxMediaOwner;
      root.remove();
    };
  }

  // src/search-accounting.ts
  var object = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  var count = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  var isSearchTool = (name) => name === "web_search" || name === "websearch_gpt_advanced";
  function auxiliaryUsageOf(event, toolName) {
    if (!object(event) || event.type !== "tool/result" || !object(event.data?.meta)) return [];
    if (!isSearchTool(toolName)) return [];
    const raw = event.data.meta.auxiliaryUsage;
    if (!Array.isArray(raw)) return [];
    const ids = /* @__PURE__ */ new Set(), result = [];
    for (const item of raw) {
      if (!object(item) || typeof item.requestId !== "string" || !item.requestId || typeof item.provider !== "string" || !item.provider || typeof item.model !== "string" || !item.model || !object(item.usage) || ids.has(item.requestId)) continue;
      const u = item.usage;
      if (![u.inputTokens, u.outputTokens, u.totalTokens, u.cacheReadTokens, u.cacheWriteTokens].every(count) || u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens !== u.totalTokens) continue;
      ids.add(item.requestId);
      result.push(item);
    }
    return result;
  }

  // src/client/search-usage-ui.ts
  var searchUsageDefinition = {
    kind: "lcx-search-usage",
    match(event) {
      if (event.type === "turn/start") return { id: String(event.data.turn), role: "start" };
      if (event.type === "turn/end" || event.type === "tool/result" || event.type === "tool/call") return { id: String(event.data.turn), role: "update" };
      return null;
    },
    start(_context, match) {
      if (match.event.type !== "turn/start") throw new Error("LCX billing requires a complete turn");
      return { turn: match.event.data.turn, records: [], pending: {}, complete: false };
    },
    update(context, match) {
      const event = match.event, state = context.state, pending = { ...state.pending };
      if (event.type === "tool/call" && isSearchTool(event.data.name)) pending[event.data.callId] = event.data.name;
      const callId = event.type === "tool/result" ? event.data.message.source.callId : void 0;
      const extra = auxiliaryUsageOf(event, callId ? pending[callId] : void 0);
      if (callId) delete pending[callId];
      return { ...state, pending, records: [...state.records, ...extra], complete: event.type === "turn/end" };
    },
    publication: (match) => match.event.type === "turn/end" ? "immediate" : "none",
    buildLocationData(context, scope) {
      const s = context.state;
      return scope === "turn" && s?.complete ? { kind: "turn", turn: s.turn, key: "lcx-search-usage", value: s.records } : null;
    }
  };
  function tokenCount(value) {
    return String(value);
  }
  function recordsTotal(records) {
    let total = 0;
    for (const record2 of records) {
      const value = record2.usage.totalTokens;
      if (!Number.isSafeInteger(value) || value < 0) continue;
      total += value;
      if (!Number.isSafeInteger(total)) return 0;
    }
    return total;
  }
  function bucketsTotal(value) {
    if (!object(value)) return 0;
    let total = 0;
    for (const key of ["uncachedInputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]) {
      const count2 = value[key];
      if (!Number.isSafeInteger(count2) || count2 < 0) return 0;
      total += count2;
      if (!Number.isSafeInteger(total)) return 0;
    }
    return total;
  }
  function usageView(createElement, scope, total, t) {
    if (total <= 0) return null;
    const label = t?.(scope === "turn" ? "usageTurn" : "usageSession") ?? "Search usage";
    return createElement("span", {
      className: `lcx-search-usage lcx-search-usage-${scope}`,
      "data-lcx-search-usage": scope,
      title: `${label}: ${tokenCount(total)}`
    }, `${label}: ${tokenCount(total)}`);
  }
  function TurnTailUsage({ turn, t }, createElement) {
    if (!createElement) return null;
    return usageView(createElement, "turn", recordsTotal(turn.data.get("lcx-search-usage") ?? []), t);
  }
  function SessionUsage({ useProjection, t }, createElement) {
    if (!createElement) return null;
    const extra = useProjection("lcxSearchUsage");
    const auxiliary = object(extra) ? extra.auxiliary : void 0;
    return usageView(createElement, "session", bucketsTotal(auxiliary), t);
  }
  function installUsageSlots(slots, createElement) {
    const registrations = [
      [
        { name: "conversation.chat.turnTail", id: "lcx-search-usage-turn", order: 0, locale: "lcx-codex" },
        (props) => TurnTailUsage(props, createElement)
      ],
      [
        { name: "conversation.composer.dock", id: "lcx-search-usage-session", order: 10, locale: "lcx-codex" },
        (props) => SessionUsage(props, createElement)
      ]
    ];
    const cleanups = [];
    for (const [name, component] of registrations) {
      try {
        const effect = slots.inject(name.name, () => {
          const dispose = slots.register(name, component);
          return typeof dispose === "function" ? dispose : void 0;
        });
        if (typeof effect === "function") cleanups.push(effect);
      } catch {
      }
    }
    return () => {
      for (const dispose of cleanups.reverse()) dispose();
    };
  }

  // src/client/index.tsx
  var SEARCH_MEDIA_KIND = "lcx-search-media";
  window.__ModuleLoader__.load({
    id: "dsh-lcx-codex",
    factory: (require2) => {
      const module = { exports: {} };
      const exports = module.exports;
      const React = require2("react");
      const { createSnapshotStore } = require2(
        "@deepseek-ai/dsh-client-store"
      );
      const NAMESPACE = "lcx-codex";
      const mediaStore = createSnapshotStore(
        { enabled: false }
      );
      const FIELDS = [
        "enabled",
        "webSearch",
        "advancedHostedSearch",
        "alphaSearch",
        "grokNativeWebSearch",
        "grokNativeXSearch",
        "searchMediaPreview"
      ];
      const DEFAULTS = Object.fromEntries(
        FIELDS.map((field) => [field, false])
      );
      const css = `.lcx-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;list-style:none}.lcx-head{width:100%;display:flex;justify-content:space-between;padding:14px 16px;border:0;background:transparent;color:inherit}.lcx-body{border-top:1px solid var(--dsw-alias-border-l2);padding:12px 16px}.lcx-row{display:flex;gap:9px;padding:8px 0}.lcx-row small,.lcx-help{display:block;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}.lcx-group{border-top:1px solid var(--dsw-alias-border-l2);margin-top:10px;padding-top:14px}.lcx-group strong{font-size:14px}.lcx-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}.lcx-foot button{padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit}.lcx-search-usage{display:inline-flex;align-items:center;gap:4px;margin:2px 0;color:var(--dsw-alias-label-tertiary);font:12px/18px system-ui}.lcx-search-usage-session{padding:0 4px}.lcx-search-usage-turn{padding:0 6px}` + inlineMediaCss + nativeMarkdownImageCss;
      function mountCss() {
        if (typeof document === "undefined") return () => {
        };
        if (document.querySelector('style[data-plugin-css="dsh-lcx-codex"]'))
          return () => {
          };
        const tag = document.createElement("style");
        tag.dataset.pluginCss = "dsh-lcx-codex";
        tag.textContent = css;
        document.head.appendChild(tag);
        return () => tag.remove();
      }
      const copy = {
        zh: {
          title: "Responses / Codex \u80FD\u529B",
          summary: "GPT Responses route \u4E0E\u641C\u7D22\u80FD\u529B",
          desc: "LCX \u8DDF\u968F DSH \u5F53\u524D\u4F1A\u8BDD\u9009\u62E9\u7684 GPT Responses route\uFF1B\u6A21\u578B\u3001endpoint \u548C credential \u7EE7\u7EED\u53EA\u7531 DSH \u7BA1\u7406\u3002",
          enabled: "\u542F\u7528 LCX\uFF08\u63A5\u7BA1\u5F53\u524D GPT Responses \u4F1A\u8BDD\uFF09",
          enabledHelp: "\u6B64\u5F00\u5173\u4EC5\u63A5\u7BA1 GPT Responses \u4F1A\u8BDD\uFF1BGrok \u539F\u751F\u641C\u7D22\u7531\u4E0B\u65B9\u72EC\u7ACB\u5F00\u5173\u63A7\u5236\uFF0C\u5176\u4ED6\u975E GPT \u6A21\u578B\u7EE7\u7EED\u4F7F\u7528 DSH \u539F\u751F\u8DEF\u5F84\u3002",
          web: "\u4F7F\u7528 GPT Hosted Search \u4F5C\u4E3A DSH web_search \u540E\u7AEF",
          webHelp: "\u4E0D\u4F1A\u65B0\u589E\u7B2C\u4E8C\u4E2A\u666E\u901A\u641C\u7D22\u5DE5\u5177\uFF1B\u666E\u901A web_search \u81EA\u52A8\u8DDF\u968F\u5F53\u524D Agent \u7684 GPT Responses route\u3002",
          advanced: "\u542F\u7528\u9AD8\u7EA7 Hosted \u5DE5\u5177\uFF08websearch_gpt_advanced\uFF09",
          advancedHelp: "\u53EA\u5728\u9700\u8981\u57DF\u540D\u8FC7\u6EE4\u3001\u4F4D\u7F6E\u3001search context\u3001\u56FE\u7247\u7B49\u539F\u751F Hosted \u53C2\u6570\u65F6\u4F7F\u7528\uFF1B\u9ED8\u8BA4\u5173\u95ED\u4EE5\u4FDD\u6301\u5DE5\u5177 schema \u7A33\u5B9A\u3002",
          alpha: "\u542F\u7528 Alpha command\uFF08websearch_alpha\uFF09",
          alphaHelp: "\u4EC5 capability probe \u5BF9\u5F53\u524D route/schema \u9A8C\u8BC1\u901A\u8FC7\u540E\u624D\u771F\u6B63\u6CE8\u518C\u3002",
          mediaPreview: "\u641C\u7D22\u5A92\u4F53\u9884\u89C8",
          mediaPreviewHelp: "\u5728\u56DE\u7B54\u4E0B\u65B9\u663E\u793A\u641C\u7D22\u8FD4\u56DE\u7684\u56FE\u7247\u3001\u56DE\u7B54\u91CC\u7684\u56FE\u7247\u76F4\u94FE\uFF0C\u4EE5\u53CA\u53EF\u76F4\u63A5\u64AD\u653E\u7684\u89C6\u9891\u76F4\u94FE\uFF1B\u70B9\u51FB\u653E\u5927\u6216\u64AD\u653E\u3002\u56DE\u7B54\u6B63\u6587\u91CC\u7684 Markdown \u56FE\u7247\u7531 DSH \u539F\u751F\u6E32\u67D3\uFF0C\u666E\u901A\u7F51\u9875\u94FE\u63A5\u4FDD\u6301\u4E3A\u94FE\u63A5\u3002\u6B64\u8BBE\u7F6E\u53EA\u6539\u53D8\u754C\u9762\u663E\u793A\u3002",
          mediaTitle: "\u89C6\u9891\u9884\u89C8",
          mediaImagePreview: "\u56FE\u7247\u9884\u89C8",
          mediaPlay: "\u64AD\u653E\u89C6\u9891",
          mediaEnlarge: "\u653E\u5927\u56FE\u7247",
          mediaClose: "\u5173\u95ED\u9884\u89C8",
          mediaHeading: "\u641C\u7D22\u56FE\u7247",
          mediaPrevious: "\u4E0A\u4E00\u7EC4\u56FE\u7247",
          mediaNext: "\u4E0B\u4E00\u7EC4\u56FE\u7247",
          mediaFailed: "\u56FE\u7247\u52A0\u8F7D\u5931\u8D25",
          mediaVideoFailed: "\u89C6\u9891\u65E0\u6CD5\u64AD\u653E",
          mediaOpen: "\u6253\u5F00\u539F\u59CB\u5A92\u4F53",
          usageTurn: "\u672C\u8F6E\u641C\u7D22\u7528\u91CF",
          usageSession: "\u641C\u7D22\u7528\u91CF",
          grokTitle: "Grok \u539F\u751F\u641C\u7D22",
          grokDesc: "\u4F7F\u7528 DSH \u5F53\u524D\u9009\u62E9\u7684 Grok \u6A21\u578B\u53CA\u5176\u670D\u52A1\u914D\u7F6E\uFF1B\u4E0E GPT \u529F\u80FD\u5F00\u5173\u72EC\u7ACB\u3002\u5F00\u542F\u4EFB\u4E00\u641C\u7D22\u540E\uFF0CGrok \u4EC5\u4F7F\u7528\u539F\u751F\u641C\u7D22\uFF0C\u7F51\u9875\u8BFB\u53D6\u548C\u5176\u4ED6\u5DE5\u5177\u4ECD\u53EF\u7528\u3002",
          grokWeb: "\u542F\u7528\u539F\u751F Web Search",
          grokWebHelp: "\u4F7F\u7528 Grok \u7684\u539F\u751F\u7F51\u9875\u641C\u7D22\u3002",
          grokX: "\u542F\u7528\u539F\u751F X Search",
          grokXHelp: "\u4F7F\u7528 Grok \u7684\u539F\u751F X \u641C\u7D22\uFF1B\u5355\u72EC\u5F00\u542F\u4E5F\u4E0D\u4F1A\u4F7F\u7528 DSH \u641C\u7D22\u3002",
          save: "\u4FDD\u5B58",
          discard: "\u653E\u5F03\u4FEE\u6539",
          saving: "\u4FDD\u5B58\u4E2D\u2026",
          saveError: "\u672A\u80FD\u786E\u8BA4\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u3002\u4FEE\u6539\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u91CD\u8BD5\u6216\u653E\u5F03\u4FEE\u6539\u4EE5\u67E5\u770B\u5F53\u524D\u8BBE\u7F6E\u3002"
        },
        en: {
          title: "Responses / Codex capabilities",
          summary: "GPT Responses route and search capabilities",
          desc: "LCX follows the GPT Responses route selected by the current DSH session. Model, endpoint and credentials remain DSH-owned.",
          enabled: "Enable LCX (own current GPT Responses conversation)",
          enabledHelp: "Applies only to GPT Responses conversations. Grok native search is controlled independently below; other non-GPT models continue through DSH normally.",
          web: "Use GPT Hosted Search as DSH web_search backend",
          webHelp: "Keeps DSH web_search as the single ordinary search tool and follows the active Agent GPT Responses route.",
          advanced: "Enable advanced Hosted tool (websearch_gpt_advanced)",
          advancedHelp: "Only for native Hosted controls such as domains, location, context size and image search; off by default for stable tool schemas.",
          alpha: "Enable Alpha command (websearch_alpha)",
          alphaHelp: "Registered only after a matching capability probe.",
          mediaPreview: "Search media previews",
          mediaPreviewHelp: "Show images returned by search, direct image links in the answer and directly playable video links below the answer; click to enlarge or play. Markdown images in the answer are rendered natively by DSH, and ordinary page links stay links. This setting changes presentation only.",
          mediaTitle: "Video preview",
          mediaImagePreview: "Image preview",
          mediaPlay: "Play video",
          mediaEnlarge: "Enlarge image",
          mediaClose: "Close preview",
          mediaHeading: "Search images",
          mediaPrevious: "Previous images",
          mediaNext: "Next images",
          mediaFailed: "Image failed to load",
          mediaVideoFailed: "Video cannot be played",
          mediaOpen: "Open original media",
          usageTurn: "Turn search usage",
          usageSession: "Search usage",
          grokTitle: "Grok native search",
          grokDesc: "Uses the Grok model and provider profile currently selected in DSH, independently of the GPT switch. When either search is enabled, Grok uses native search while page reading and other tools remain available.",
          grokWeb: "Enable native Web Search",
          grokWebHelp: "Use Grok's native web search.",
          grokX: "Enable native X Search",
          grokXHelp: "Use Grok's native X search. Enabling it alone also avoids DSH search.",
          save: "Save",
          discard: "Discard",
          saving: "Saving\u2026",
          saveError: "Could not confirm settings were saved. Changes are kept; retry or discard to view current settings."
        }
      };
      function valueFrom(snapshot) {
        const value = snapshot.value ?? {};
        return {
          ...DEFAULTS,
          ...Object.fromEntries(
            FIELDS.map((field) => [field, Boolean(value[field])])
          )
        };
      }
      const hostedMediaTool = (value) => value === "web_search" || value === "websearch_gpt_advanced";
      const searchMediaDefinition = {
        kind: SEARCH_MEDIA_KIND,
        target: "chat",
        match(event) {
          if (event.type === "turn/start")
            return { id: String(event.data.turn), role: "start" };
          if (event.type === "tool/result" || event.type === "tool/call")
            return { id: String(event.data.turn), role: "update" };
          if (event.type !== "assistant/message" || event.surfaceOp !== "append" || event.data.interrupted === true)
            return null;
          const source = event.data.message.source;
          if (source.kind !== "model" || !/^(?:gpt|grok)/i.test(source.model))
            return null;
          return { id: String(event.data.turn), role: "update" };
        },
        start(_context, match) {
          if (match.event.type !== "turn/start")
            throw new Error("search media state requires turn/start");
          return {
            anchorSeq: 0,
            location: match.location,
            items: [],
            structuredItems: [],
            provider: "",
            model: "",
            pending: {},
            ready: false
          };
        },
        update(context, match) {
          if (match.event.type === "tool/call") {
            if (!hostedMediaTool(match.event.data.name)) return context.state;
            return {
              ...context.state,
              pending: {
                ...context.state.pending,
                [match.event.data.callId]: match.event.data.name
              }
            };
          }
          if (match.event.type === "tool/result") {
            const callId = match.event.data.message.source.callId;
            const tool = context.state.pending[callId];
            if (tool === void 0) return context.state;
            const pending = { ...context.state.pending };
            delete pending[callId];
            return {
              ...context.state,
              pending,
              structuredItems: mergeSearchMedia(
                context.state.structuredItems,
                structuredSearchMedia(match.event.data.meta, tool)
              )
            };
          }
          if (match.event.type !== "assistant/message") return context.state;
          const message = match.event.data.message;
          const source = message.source;
          if (source.kind !== "model") return context.state;
          const text = message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
          return {
            ...context.state,
            anchorSeq: match.event.seq,
            location: match.location,
            // Ownership (Issue #102): structured provider candidates + direct image/video file links
            // from the answer text. Markdown images belong to DSH and are never duplicated.
            items: mergeSearchMedia(
              context.state.structuredItems,
              extractDirectMediaLinks(text)
            ),
            provider: source.provider,
            model: source.model,
            ready: true
          };
        },
        publication: (match) => match.event.type === "assistant/message" ? "immediate" : "none",
        buildViewNode(context) {
          const state = context.state;
          if (state === void 0 || !state.ready || state.items.length === 0) return null;
          const node = {
            key: context.key,
            kind: SEARCH_MEDIA_KIND,
            id: context.id,
            target: "chat",
            anchorSeq: state.anchorSeq,
            location: state.location,
            visibility: "visible",
            data: {
              items: state.items,
              provider: state.provider,
              model: state.model
            }
          };
          return node;
        }
      };
      class Controller {
        scope;
        draft;
        dirty;
        saving;
        saveError;
        store;
        stop;
        saveEpoch;
        constructor(scope) {
          this.scope = scope;
          this.draft = null;
          this.dirty = false;
          this.saving = false;
          this.saveError = false;
          this.saveEpoch = 0;
          this.store = createSnapshotStore(this.projection());
          mediaStore.set({ enabled: this.value().searchMediaPreview });
          this.stop = scope.subscribe(() => {
            if (!this.dirty) this.draft = null;
            this.publish();
          });
        }
        snapshot() {
          return this.scope.getSnapshot();
        }
        value() {
          return valueFrom(this.snapshot());
        }
        draftValue() {
          return { ...this.value(), ...this.draft ?? {} };
        }
        projection() {
          const s = this.snapshot(), value = this.draftValue(), fields = Object.fromEntries(
            FIELDS.map((field) => [field, { value: Boolean(value[field]) }])
          );
          return {
            available: s.status === "ready",
            writable: s.writable,
            dirty: this.dirty,
            saving: this.saving,
            saveError: this.saveError,
            ...fields
          };
        }
        publish() {
          mediaStore.set({ enabled: this.value().searchMediaPreview });
          this.store.set(this.projection());
        }
        edit(field, value) {
          if (!FIELDS.includes(field) || this.saving || !this.snapshot().writable) return;
          this.draft = {
            ...this.draft,
            [field]: Boolean(value)
          };
          if (this.value()[field] === Boolean(value)) delete this.draft[field];
          this.dirty = Object.keys(this.draft).length > 0;
          this.saveError = false;
          this.publish();
        }
        discard() {
          if (this.saving) return;
          this.draft = null;
          this.dirty = false;
          this.saveError = false;
          this.publish();
        }
        leavePage() {
          this.saveEpoch += 1;
          this.draft = null;
          this.dirty = false;
          this.saving = false;
          this.saveError = false;
          this.publish();
        }
        async save() {
          if (!this.dirty || this.saving || !this.snapshot().writable || this.snapshot().status !== "ready") return;
          const next = this.draftValue(), prev = this.value();
          const fields = FIELDS.filter((field) => next[field] !== prev[field]);
          const saveEpoch = ++this.saveEpoch;
          this.saving = true;
          this.saveError = false;
          this.publish();
          try {
            if (fields.length) {
              await this.scope.mutate(fields.map((field) => ({
                op: "set",
                path: [field],
                value: next[field]
              })));
              if (saveEpoch !== this.saveEpoch) return;
              if (this.snapshot().status !== "ready" || fields.some((field) => this.value()[field] !== next[field]))
                throw new Error("Settings mutation was not confirmed");
            }
            if (saveEpoch !== this.saveEpoch) return;
            this.draft = null;
            this.dirty = false;
          } catch {
            if (saveEpoch === this.saveEpoch) this.saveError = true;
          } finally {
            if (saveEpoch === this.saveEpoch) {
              this.saving = false;
              this.publish();
            }
          }
        }
        inject() {
          return {
            hooks: {
              lcxCard: this.store,
              mediaPreview: mediaStore
            },
            setMediaPreview: (value) => this.edit("searchMediaPreview", value),
            edit: (field, value) => this.edit(field, value),
            save: () => void this.save(),
            discard: () => this.discard(),
            leavePage: () => this.leavePage()
          };
        }
      }
      function Row({
        id,
        label,
        help,
        checked,
        disabled,
        onChange
      }) {
        return React.createElement(
          "div",
          { className: "lcx-row" },
          React.createElement("input", {
            id,
            type: "checkbox",
            checked,
            disabled,
            onChange: (event) => onChange(event.target.checked)
          }),
          React.createElement(
            "label",
            { htmlFor: id },
            label,
            React.createElement("small", null, help)
          )
        );
      }
      function Card(props) {
        const t = props.t, s = props.useLcxCard((state) => state), [open, setOpen] = React.useState(false);
        React.useEffect(
          () => props.view === "page" ? () => props.leavePage() : void 0,
          [props.view, props.leavePage]
        );
        if (!s.available) return null;
        if (props.view === "summary")
          return React.createElement("span", { className: "lcx-summary" }, t("summary"));
        const disabled = !s.writable || s.saving;
        return React.createElement(
          "li",
          { className: "lcx-card" },
          React.createElement(
            "button",
            {
              className: "lcx-head",
              type: "button",
              onClick: () => setOpen(!open)
            },
            React.createElement("strong", null, t("title")),
            React.createElement("span", null, open ? "\u2303" : "\u2304")
          ),
          open ? React.createElement(
            "div",
            { className: "lcx-body" },
            React.createElement("p", { className: "lcx-help" }, t("desc")),
            React.createElement(Row, {
              id: "lcx-media-preview",
              label: t("mediaPreview"),
              help: t("mediaPreviewHelp"),
              checked: s.searchMediaPreview.value,
              disabled,
              onChange: props.setMediaPreview
            }),
            React.createElement(Row, {
              id: "lcx-enabled",
              label: t("enabled"),
              help: t("enabledHelp"),
              checked: s.enabled.value,
              disabled,
              onChange: (value) => props.edit("enabled", value)
            }),
            React.createElement(Row, {
              id: "lcx-web",
              label: t("web"),
              help: t("webHelp"),
              checked: s.webSearch.value,
              disabled: disabled || !s.enabled.value,
              onChange: (value) => props.edit("webSearch", value)
            }),
            React.createElement(Row, {
              id: "lcx-advanced",
              label: t("advanced"),
              help: t("advancedHelp"),
              checked: s.advancedHostedSearch.value,
              disabled: disabled || !s.enabled.value || !s.webSearch.value,
              onChange: (value) => props.edit("advancedHostedSearch", value)
            }),
            React.createElement(Row, {
              id: "lcx-alpha",
              label: t("alpha"),
              help: t("alphaHelp"),
              checked: s.alphaSearch.value,
              disabled: disabled || !s.enabled.value,
              onChange: (value) => props.edit("alphaSearch", value)
            }),
            React.createElement(
              "section",
              { className: "lcx-group" },
              React.createElement("strong", null, t("grokTitle")),
              React.createElement("p", { className: "lcx-help" }, t("grokDesc")),
              React.createElement(Row, {
                id: "lcx-grok-web",
                label: t("grokWeb"),
                help: t("grokWebHelp"),
                checked: s.grokNativeWebSearch.value,
                disabled,
                onChange: (value) => props.edit("grokNativeWebSearch", value)
              }),
              React.createElement(Row, {
                id: "lcx-grok-x",
                label: t("grokX"),
                help: t("grokXHelp"),
                checked: s.grokNativeXSearch.value,
                disabled,
                onChange: (value) => props.edit("grokNativeXSearch", value)
              })
            ),
            React.createElement(
              "p",
              { role: "alert", hidden: !s.saveError },
              s.saveError ? t("saveError") : ""
            ),
            React.createElement(
              "div",
              { className: "lcx-foot" },
              React.createElement(
                "button",
                { disabled: !s.dirty || disabled, onClick: props.discard },
                t("discard")
              ),
              React.createElement(
                "button",
                { disabled: !s.dirty || disabled, onClick: props.save },
                s.saving ? t("saving") : t("save")
              )
            )
          ) : null
        );
      }
      const lightboxHost = {
        openImage({ src, alt, labels, onClose }) {
          try {
            const primitives = require2("@deepseek-ai/dsh-client-ui-primitives");
            const reactDom = require2("react-dom/client");
            if (typeof primitives?.ImageLightbox !== "function" || typeof reactDom?.createRoot !== "function") return null;
            const container = document.createElement("div");
            container.dataset.lcxMediaLightbox = "";
            document.body.appendChild(container);
            const root = reactDom.createRoot(container);
            root.render(React.createElement(primitives.ImageLightbox, { src, alt, labels, onClose }));
            let done = false;
            return () => {
              if (done) return;
              done = true;
              queueMicrotask(() => {
                root.unmount();
                container.remove();
              });
            };
          } catch {
            return null;
          }
        }
      };
      function InlineMedia({ node, t }) {
        const [marker, setMarker] = React.useState(null);
        React.useEffect(() => {
          if (!marker) return;
          const labels = { image: t("mediaEnlarge"), video: t("mediaPlay"), close: t("mediaClose"), source: t("mediaOpen"), failed: t("mediaFailed"), videoFailed: t("mediaVideoFailed"), heading: t("mediaHeading"), previous: t("mediaPrevious"), next: t("mediaNext"), dialog: t("mediaTitle"), imageDialog: t("mediaImagePreview") };
          return installInlineMedia(marker, node.data.items, labels, lightboxHost);
        }, [marker, node.data.items, t]);
        return React.createElement("span", { ref: setMarker, "aria-hidden": true });
      }
      function MediaNode(props) {
        const enabled = props.useMediaPreview((state) => state?.enabled === true);
        return enabled ? React.createElement(InlineMedia, { node: props.node, t: props.t }) : null;
      }
      const inject = ["slots", "locale", "configForms", "uiConversation"];
      function apply(ctx) {
        const slots = ctx.slots ?? ctx.get("slots"), svc = ctx.configForms ?? ctx.get("configForms"), locale = ctx.locale ?? ctx.get("locale"), uiConversation = ctx.uiConversation ?? ctx.get("uiConversation");
        if (!slots || !svc || !locale || !uiConversation) return;
        ctx.effect(() => uiConversation.events.register(searchUsageDefinition), "lcx search billing data");
        ctx.effect(() => installUsageSlots(slots, React.createElement), "lcx search billing slots");
        ctx.effect(mountCss, "lcx-codex styles");
        for (const language of ["zh", "en"])
          ctx.effect(() => locale.register(NAMESPACE, language, copy[language]), `lcx-codex ${language} dictionary`);
        ctx.effect(
          () => uiConversation.events.register(searchMediaDefinition),
          "lcx-codex search media definition"
        );
        const installSlot = (name, label, register) => ctx.effect(() => {
          const cleanup = slots.inject(name, register);
          return () => {
            if (typeof cleanup === "function") cleanup();
          };
        }, label);
        const controller = new Controller(svc.get(NAMESPACE));
        installSlot(
          "plugins.bundle.config",
          "lcx-codex plugin configuration",
          () => slots.register(
            {
              name: "plugins.bundle.config",
              key: "dsh-lcx-codex",
              locale: NAMESPACE,
              inject: () => controller.inject()
            },
            Card
          )
        );
        installSlot(
          "conversation.chat.node",
          "lcx-codex media slot",
          () => slots.register(
            {
              name: "conversation.chat.node",
              key: SEARCH_MEDIA_KIND,
              locale: NAMESPACE,
              inject: () => ({ hooks: { mediaPreview: mediaStore } })
            },
            MediaNode
          )
        );
        ctx.effect(() => () => controller.stop(), "lcx-codex settings card");
      }
      exports.apply = apply;
      exports.inject = inject;
      return module.exports;
    }
  });
})();
