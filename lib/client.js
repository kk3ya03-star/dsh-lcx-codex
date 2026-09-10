"use strict";
(() => {
  // src/client/search-media.ts
  var SEARCH_MEDIA_LIMIT = 60;
  var IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|gif|avif)$/i;
  var VIDEO_EXTENSION = /\.(?:mp4|webm|ogv)$/i;
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
  function mediaItem(value) {
    const parsed = publicHttpUrl(value);
    if (parsed === null) return null;
    const imageCdn = parsed.protocol === "https:" && ["images.unsplash.com", "plus.unsplash.com", "images.pexels.com"].includes(parsed.hostname) && !/\.(svg|html?|js)$/i.test(parsed.pathname);
    const kind = IMAGE_EXTENSION.test(parsed.pathname) || imageCdn ? "image" : VIDEO_EXTENSION.test(parsed.pathname) ? "video" : null;
    return kind === null ? null : { kind, url: parsed.href };
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
  function extractSearchMedia(text) {
    let visible = stripHtml(stripInlineCode(stripFencedCode(text)));
    const definitions = /* @__PURE__ */ new Map();
    visible.replace(REFERENCE_DEFINITION, (_match, label, angle, bare) => {
      definitions.set(referenceLabel(label), angle ?? bare);
      return _match;
    });
    const nativeImages = /* @__PURE__ */ new Set();
    const addNativeImage = (value) => {
      const item = mediaItem(value);
      if (item?.kind === "image") nativeImages.add(new URL(item.url).href.replace(/#.*$/, ""));
    };
    visible = eraseInlineImages(visible, addNativeImage);
    visible = visible.replace(
      REFERENCE_IMAGE,
      (_match, alt, explicit) => {
        const value = definitions.get(referenceLabel(explicit === void 0 || explicit === "" ? alt : explicit));
        if (value !== void 0) addNativeImage(value);
        return " ".repeat(_match.length);
      }
    );
    const candidates = [];
    visible = collectInlineLinkDestinations(
      visible,
      (value) => candidates.push(value)
    );
    visible.replace(
      REFERENCE_LINK,
      (_match, prefix, label, explicit) => {
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
      const item = mediaItem(candidate);
      if (item === null) continue;
      const key = item.kind === "video" ? item.url : item.url.replace(/#.*$/, "");
      if (nativeImages.has(key) || seen.has(key)) continue;
      seen.add(key);
      result.push(item);
      if (result.length === SEARCH_MEDIA_LIMIT) break;
    }
    return result;
  }

  // src/client/inline-media.ts
  var inlineMediaCss = `
[data-chat-flow-kind="lcx-search-media"]{display:none!important}
.lcx-media-strip{display:flex;align-items:flex-start;flex-wrap:wrap;gap:8px;margin:8px 0 4px;line-height:1}
.lcx-media-strip:empty{display:none}
.lcx-media-strip:not(:has(.lcx-inline-media:not([hidden]))):not(:has(.lcx-media-toggle)){display:none}
.lcx-media-toggle-row{flex:0 0 100%;min-width:0}
.lcx-media-toggle{display:flex;align-items:center;justify-content:flex-start;gap:7px;width:fit-content;max-width:100%;min-width:0;padding:2px 0;border:0;border-radius:3px;background:transparent;color:var(--dsw-alias-label-secondary,#748096);font:12px/20px system-ui;cursor:pointer;text-align:left;transition:color .15s}
.lcx-media-toggle::after{content:'';width:5px;height:5px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-2px) rotate(45deg)}
.lcx-media-toggle[aria-expanded="true"]::after{transform:translateY(1px) rotate(225deg)}
.lcx-media-toggle:hover{color:var(--dsw-alias-link,#416de0);background:transparent}
.lcx-inline-media{display:inline-flex;max-width:100%;line-height:1}
.lcx-inline-media[hidden]{display:none}
.lcx-media-thumb{display:block;position:relative;max-width:100%;padding:0;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#f5f5f5);color:inherit;cursor:zoom-in;box-shadow:0 2px 6px #00000009;transition:box-shadow .15s,transform .15s,background .15s;font-family:inherit}
.lcx-media-thumb:hover{box-shadow:0 3px 12px #00000016;transform:translateY(-1px)}
.lcx-media-thumb img{display:block!important;width:auto!important;height:auto!important;max-width:144px!important;max-height:144px!important;object-fit:contain;margin:0!important;border-radius:0!important}
.lcx-media-thumb:not([data-video])::after{content:'\u2197';position:absolute;right:6px;bottom:6px;display:grid;place-items:center;width:22px;height:22px;border-radius:7px;background:#14212b99;color:white;font:15px/1 system-ui;backdrop-filter:blur(6px);pointer-events:none}
.lcx-media-thumb:focus-visible,.lcx-media-close:focus-visible{outline:2px solid var(--dsw-alias-link,#3478f6);outline-offset:3px}
.lcx-media-thumb[data-video]{cursor:pointer;padding:7px 10px;font-size:12px;font-weight:500;display:flex;align-items:center;gap:8px;line-height:18px;border-radius:10px;color:var(--dsw-alias-link,#416de0);background:color-mix(in srgb,currentColor 7%,transparent);border-color:color-mix(in srgb,currentColor 13%,transparent);box-shadow:none}
.lcx-media-thumb[data-video]:hover{background:color-mix(in srgb,currentColor 12%,transparent);box-shadow:0 2px 6px #00000008}
.lcx-media-play-label{display:flex;align-items:center;gap:7px;white-space:nowrap}
.lcx-media-play-label::before{content:'';width:0;height:0;border-top:4px solid transparent;border-bottom:4px solid transparent;border-left:6px solid currentColor}
.lcx-media-format{font:10px/16px system-ui;letter-spacing:.04em;opacity:.7;border-left:1px solid color-mix(in srgb,currentColor 24%,transparent);padding-left:8px}
.lcx-media-thumb[data-video]:has(img){padding:0}
.lcx-media-thumb[data-video]:has(img) .lcx-media-play-label{position:absolute;inset:0;display:flex;justify-content:center;color:white;background:#0003;font-size:0}
.lcx-media-thumb[data-video]:has(img) .lcx-media-format{display:none}
.lcx-media-dialog{box-sizing:border-box;border:1px solid #ffffff24;border-radius:16px;padding:48px 16px 16px;background:#15171b;color:#fff;max-width:94vw;max-height:92vh;box-shadow:0 20px 80px #0006}
.lcx-media-dialog::backdrop{background:#080b12bb;backdrop-filter:blur(5px)}
.lcx-media-dialog img,.lcx-media-dialog video{display:block;object-fit:contain;max-width:86vw;max-height:74vh;width:auto;height:auto;border-radius:6px;margin:auto}
.lcx-media-dialog video{width:min(800px,86vw)}
.lcx-media-close{position:absolute;right:10px;top:8px;width:32px;height:32px;border:0;border-radius:50%;background:#ffffff14;color:white;font-size:23px;cursor:pointer}
.lcx-media-nav{position:absolute;left:16px;top:8px;display:flex;align-items:center;gap:8px;font:12px/20px system-ui;color:#ddd}
.lcx-media-nav[hidden]{display:none}
.lcx-media-nav button{width:30px;height:30px;border:0;border-radius:9px;background:#ffffff14;color:white;font-size:20px;cursor:pointer}
.lcx-media-nav button:disabled{opacity:.3;cursor:default}
.lcx-media-nav button:focus-visible,.lcx-media-toggle:focus-visible{outline:2px solid #648dfb;outline-offset:2px}
.lcx-media-dialog a{display:block;width:fit-content;margin:12px auto 0;color:#c6d7ff;font:12px/18px system-ui;text-decoration:none}
@media(prefers-reduced-motion:reduce){.lcx-media-thumb{transition:none;transform:none}}
`;
  var VISIBLE_MEDIA_LIMIT = 4;
  var mediaKey = (item) => item.kind === "video" ? item.url : item.url.replace(/#.*$/, "");
  function previewItems(items) {
    const groups = /* @__PURE__ */ new Map();
    for (const item of items) {
      if (item.kind === "page") continue;
      const url = new URL(item.url);
      const identity = item.kind === "video" ? JSON.stringify(["video", url.origin, url.pathname.replace(/\.(mp4|webm|ogv)$/i, ""), url.search, url.hash]) : JSON.stringify(["image", mediaKey(item)]);
      const group = groups.get(identity) ?? [];
      if (!group.some((value) => value.url === item.url)) group.push(item);
      groups.set(identity, group);
    }
    const result = /* @__PURE__ */ new Map();
    const priority = (url) => ({ mp4: 0, webm: 1, ogv: 2 })[new URL(url).pathname.split(".").at(-1).toLowerCase()] ?? 3;
    for (const group of groups.values()) {
      group.sort((a, b) => priority(a.url) - priority(b.url));
      const item = { ...group[0], sources: group.map((value) => value.url) };
      for (const value of group) result.set(mediaKey(value), item);
    }
    return result;
  }
  var activeDialogByDocument = /* @__PURE__ */ new WeakMap();
  function supportsInlineMediaDom(marker) {
    const row = marker.closest('[data-chat-flow-kind="lcx-search-media"]');
    const answer = row?.previousElementSibling;
    const ElementClass = marker.ownerDocument.defaultView?.HTMLElement;
    return Boolean(
      ElementClass && answer instanceof ElementClass && row?.parentElement === answer.parentElement && answer.dataset.chatFlowKind === "assistant-step" && typeof answer.dataset.chatTurn === "string" && answer.dataset.chatTurn !== "" && answer.dataset.chatTurn === row?.dataset.chatTurn
    );
  }
  function installInlineMedia(marker, items, labels) {
    if (items.length === 0 || !supportsInlineMediaDom(marker)) return () => {
    };
    const row = marker.closest('[data-chat-flow-kind="lcx-search-media"]');
    const answer = row.previousElementSibling;
    const doc = marker.ownerDocument;
    const wanted = previewItems(items.filter((item) => item.structured !== true));
    const structured = [...new Set(previewItems(items.filter((item) => item.structured === true)).values())];
    const previews = /* @__PURE__ */ new Map();
    const strips = /* @__PURE__ */ new Map();
    const entries = /* @__PURE__ */ new Map();
    let expanded = false;
    const toggle = doc.createElement("button");
    toggle.type = "button";
    toggle.className = "lcx-media-toggle";
    const toggleRow = doc.createElement("span");
    toggleRow.className = "lcx-media-toggle-row";
    toggleRow.append(toggle);
    toggle.onclick = () => {
      expanded = !expanded;
      updateVisibility();
      toggle.focus({ preventScroll: true });
    };
    const failed = /* @__PURE__ */ new Set();
    let disposed = false;
    let frame = 0;
    let ownedClose;
    function orderedEntries() {
      return [...answer.querySelectorAll(".lcx-inline-media")].flatMap((preview) => {
        const entry = entries.get(preview);
        return entry ? [{ preview, ...entry }] : [];
      });
    }
    function updateVisibility() {
      const all = orderedEntries();
      all.forEach((entry, index) => {
        const hidden = !expanded && index >= VISIBLE_MEDIA_LIMIT;
        if (entry.preview.hidden !== hidden) entry.preview.hidden = hidden;
        if (!hidden) {
          entry.load?.();
          const saved = entries.get(entry.preview);
          if (saved) saved.load = void 0;
        }
      });
      if (all.length <= VISIBLE_MEDIA_LIMIT) {
        toggleRow.remove();
        return;
      }
      const text = expanded ? labels.less : labels.more.replace("{count}", String(all.length - VISIBLE_MEDIA_LIMIT));
      if (toggle.textContent !== text) toggle.textContent = text;
      const aria = String(expanded);
      if (toggle.getAttribute("aria-expanded") !== aria) toggle.setAttribute("aria-expanded", aria);
      const parent = all[expanded ? all.length - 1 : VISIBLE_MEDIA_LIMIT - 1].preview.parentElement;
      if (toggleRow.parentElement !== parent || toggleRow !== parent.lastElementChild) parent.append(toggleRow);
    }
    function removePreview(preview) {
      const strip = preview.parentElement;
      entries.get(preview)?.cleanup();
      entries.delete(preview);
      preview.remove();
      if (strip?.classList.contains("lcx-media-strip") && !strip.childElementCount) {
        strip.remove();
        for (const [block, value] of strips) if (value === strip) strips.delete(block);
      }
    }
    function placePreview(anchor, preview) {
      const block = anchor.closest("p,li,td,th,figcaption");
      const owner = block && answer.contains(block) ? block : anchor;
      let strip = strips.get(owner);
      if (!strip?.isConnected) {
        strip = doc.createElement("span");
        strip.className = "lcx-media-strip";
        if (owner === anchor) anchor.after(strip);
        else owner.append(strip);
        strips.set(owner, strip);
      }
      strip.append(preview);
    }
    function open(item, trigger, fail) {
      activeDialogByDocument.get(doc)?.();
      const dialog = doc.createElement("dialog");
      dialog.className = "lcx-media-dialog";
      dialog.setAttribute("aria-label", item.kind === "image" ? labels.image : labels.video);
      const close = doc.createElement("button");
      close.type = "button";
      close.className = "lcx-media-close";
      close.textContent = "\xD7";
      close.setAttribute("aria-label", labels.close);
      let media = doc.createElement(item.kind === "image" ? "img" : "video");
      if (media instanceof HTMLImageElement) {
        media.alt = trigger.getAttribute("aria-label") ?? labels.image;
        media.referrerPolicy = "no-referrer";
      } else {
        media.controls = true;
        media.playsInline = true;
        media.preload = "none";
      }
      if (media instanceof HTMLVideoElement) media.src = item.url;
      const source = doc.createElement("a");
      source.href = item.sourceUrl ?? item.url;
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      source.textContent = labels.source;
      let closed = false;
      let sourceIndex = 0;
      let previous;
      let next;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        close.onclick = null;
        dialog.oncancel = null;
        dialog.onclick = null;
        dialog.onkeydown = null;
        previous && (previous.onclick = null);
        next && (next.onclick = null);
        media.onload = null;
        media.onerror = null;
        if (media instanceof HTMLVideoElement) {
          media.pause();
          media.removeAttribute("src");
          media.load();
        }
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
        if (event.target === dialog) {
          const rect = dialog.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) cleanup();
        }
      };
      media.onerror = () => {
        if (closed) return;
        if (media instanceof HTMLVideoElement && sourceIndex + 1 < item.sources.length) {
          sourceIndex += 1;
          media.src = item.sources[sourceIndex];
          source.href = item.sources[sourceIndex];
          media.load();
          void media.play().catch(() => {
          });
          return;
        }
        cleanup();
        fail();
      };
      dialog.append(close, media, source);
      doc.body.append(dialog);
      if (item.kind === "image") {
        const nav = doc.createElement("span");
        nav.className = "lcx-media-nav";
        const previousButton = doc.createElement("button"), nextButton = doc.createElement("button"), counter = doc.createElement("span");
        previous = previousButton;
        next = nextButton;
        previousButton.type = nextButton.type = "button";
        previousButton.textContent = "\u2039";
        nextButton.textContent = "\u203A";
        previousButton.setAttribute("aria-label", labels.previous);
        nextButton.setAttribute("aria-label", labels.next);
        counter.setAttribute("aria-live", "polite");
        nav.append(previousButton, counter, nextButton);
        dialog.append(nav);
        let currentKey = mediaKey(item);
        const images = () => orderedEntries().filter((entry) => entry.item.kind === "image");
        const select = (index) => {
          if (closed) return;
          const list = images(), entry = list[index];
          if (!entry) return;
          currentKey = mediaKey(entry.item);
          const image = doc.createElement("img");
          image.alt = entry.button.getAttribute("aria-label") ?? labels.image;
          image.referrerPolicy = "no-referrer";
          image.onerror = () => {
            if (closed || media !== image) return;
            entry.fail();
            const remaining = images();
            if (!remaining.length) {
              cleanup();
              return;
            }
            select(Math.min(index, remaining.length - 1));
          };
          media.onerror = null;
          media.replaceWith(image);
          media = image;
          source.href = entry.item.sourceUrl ?? entry.item.url;
          image.src = entry.item.url;
          counter.textContent = `${index + 1} / ${list.length}`;
          previousButton.disabled = index === 0;
          nextButton.disabled = index === list.length - 1;
          nav.hidden = list.length < 2;
        };
        const move = (offset) => {
          const list = images();
          select(list.findIndex((entry) => mediaKey(entry.item) === currentKey) + offset);
        };
        previousButton.onclick = () => move(-1);
        nextButton.onclick = () => move(1);
        dialog.onkeydown = (event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            move(event.key === "ArrowLeft" ? -1 : 1);
          }
        };
        select(images().findIndex((entry) => mediaKey(entry.item) === mediaKey(item)));
      }
      dialog.showModal();
      close.focus();
      if (media instanceof HTMLVideoElement) void media.play().catch(() => {
      });
    }
    function createPreview(item, description, forget) {
      const key = mediaKey(item);
      if (failed.has(key)) return void 0;
      const preview = doc.createElement("span");
      preview.className = "lcx-inline-media";
      preview.dataset.url = item.url;
      if (item.structured) preview.dataset.structured = "";
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "lcx-media-thumb";
      const label = item.kind === "image" ? labels.image : labels.video;
      button.setAttribute("aria-label", label + " \xB7 " + description);
      let thumbnail;
      const fail = () => {
        failed.add(key);
        removePreview(preview);
        forget?.();
        updateVisibility();
      };
      const cleanup = () => {
        button.onclick = null;
        if (thumbnail) {
          thumbnail.onload = null;
          thumbnail.onerror = null;
        }
        entry.load = void 0;
      };
      const entry = { item, button, fail, cleanup };
      const previewUrl = item.kind === "image" ? item.previewUrl ?? item.url : item.previewUrl ?? item.poster;
      if (previewUrl) {
        const image = doc.createElement("img");
        thumbnail = image;
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        button.append(image);
        button.tabIndex = -1;
        button.style.visibility = "hidden";
        preview.style.height = "1px";
        preview.style.margin = "0";
        const reveal = () => {
          button.tabIndex = 0;
          button.style.visibility = "";
          preview.style.height = "";
          preview.style.margin = "";
        };
        image.onload = reveal;
        image.onerror = item.kind === "image" ? fail : () => {
          image.remove();
          reveal();
        };
        entry.load = () => {
          image.src = previewUrl;
        };
      }
      if (item.kind === "video") {
        button.dataset.video = "";
        const play = doc.createElement("span");
        play.className = "lcx-media-play-label";
        play.textContent = labels.video;
        button.append(play);
        const format = item.sources.map((value) => /\.(mp4|webm|ogv)$/i.exec(new URL(value).pathname)?.[1]).filter(Boolean).join(" / ");
        if (format) {
          const badge = doc.createElement("span");
          badge.className = "lcx-media-format";
          badge.textContent = format.toUpperCase();
          badge.setAttribute("aria-hidden", "true");
          button.append(badge);
        }
      }
      button.onclick = () => open(item, button, fail);
      preview.append(button);
      entries.set(preview, entry);
      return preview;
    }
    for (const item of structured) {
      const preview = createPreview(item, item.caption ?? new URL(item.url).hostname);
      if (!preview) continue;
      let strip = strips.get(answer);
      if (!strip) {
        strip = doc.createElement("span");
        strip.className = "lcx-media-strip";
        answer.append(strip);
        strips.set(answer, strip);
      }
      strip.append(preview);
    }
    const canPreview = (anchor) => !anchor.closest("pre,code,[data-streaming],[data-turn-process-inline],.lcx-inline-media");
    function scan() {
      frame = 0;
      if (disposed) return;
      const candidates = /* @__PURE__ */ new Map();
      const selected = /* @__PURE__ */ new Set();
      for (const anchor of answer.querySelectorAll("a[href]")) {
        if (!canPreview(anchor)) continue;
        let url;
        try {
          url = new URL(anchor.href);
        } catch {
          continue;
        }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
        const baseItem = wanted.get(url.href.replace(/#.*$/, ""));
        const item = wanted.get(url.href) ?? (baseItem?.kind === "image" ? baseItem : void 0);
        if (!item) continue;
        const key = mediaKey(item);
        if (selected.has(key) || failed.has(key)) continue;
        selected.add(key);
        candidates.set(anchor, { item, url });
      }
      for (const [anchor, current] of previews) {
        if (!candidates.has(anchor) || !current.preview.isConnected || current.href !== anchor.href) {
          removePreview(current.preview);
          previews.delete(anchor);
        }
      }
      for (const [anchor, { item, url }] of candidates) {
        if (previews.has(anchor)) continue;
        const preview = createPreview(
          item,
          anchor.textContent?.trim() || url.hostname,
          () => previews.delete(anchor)
        );
        if (!preview) continue;
        placePreview(anchor, preview);
        previews.set(anchor, { preview, href: anchor.href });
      }
      updateVisibility();
    }
    scan();
    const observer = new MutationObserver(() => {
      if (!disposed && !frame) frame = requestAnimationFrame(scan);
    });
    observer.observe(answer, {
      attributes: true,
      attributeFilter: ["data-streaming", "data-turn-process-inline", "href"],
      childList: true,
      subtree: true
    });
    return () => {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      ownedClose?.();
      toggle.onclick = null;
      toggleRow.remove();
      for (const preview of [...entries.keys()]) removePreview(preview);
      previews.clear();
      entries.clear();
      for (const strip of strips.values()) strip.remove();
      strips.clear();
    };
  }

  // src/search-accounting.ts
  var object = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  var count = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  var zeroBuckets = () => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
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
  function addUsage(base, records) {
    if (!records.length) return base;
    const next = { ...base };
    for (const { usage: u } of records) {
      next.uncachedInputTokens += u.inputTokens;
      next.outputTokens += u.outputTokens;
      next.cacheReadTokens += u.cacheReadTokens;
      next.cacheWriteTokens += u.cacheWriteTokens;
    }
    if (!Object.values(next).every(count)) throw new Error("LCX search usage exceeds safe counters");
    return next;
  }
  function mergeBuckets(base, extra) {
    if (!object(base) || Object.values(extra).every((n) => n === 0)) return base;
    const next = { ...base };
    for (const key of Object.keys(extra)) {
      if (count(base[key])) next[key] = base[key] + extra[key];
    }
    return next;
  }
  function addTurnUsage(base, records) {
    if (!object(base) || !records.length || !count(base.totalTokens)) return base;
    const next = mergeBuckets(base, addUsage(zeroBuckets(), records));
    next.totalTokens = base.totalTokens + records.reduce((n, r) => n + r.usage.totalTokens, 0);
    delete next.reasoningTokens;
    if (Array.isArray(base.routes)) {
      const routes = /* @__PURE__ */ new Map();
      for (const r of [...base.routes, ...records]) routes.set(`${r.provider}\0${r.model}`, { provider: r.provider, model: r.model });
      next.routes = [...routes.values()];
    }
    return next;
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
  function installUsageSlots(slots, createElement) {
    const cleanups = [];
    for (const [name, key] of [
      ["conversation.composer.dock", "stats"],
      ["conversation.composer.bar", ""],
      ["conversation.chat.node", "turn-tail"]
    ]) {
      let effect;
      try {
        effect = slots.inject(name, () => {
          let entries;
          try {
            entries = slots.entriesOfSlot(name);
          } catch {
            return;
          }
          if (!Array.isArray(entries) || entries.length === 0) return;
          const candidates = key === "" ? [entries[0]] : entries.filter((e) => e?.options?.id === key || e?.options?.key === key);
          if (candidates.length !== 1) return;
          const base = candidates[0], original = base?.component;
          if (!base || typeof original !== "function" || !base.options || typeof base.options !== "object") return;
          const descriptor = Object.getOwnPropertyDescriptor(base, "component");
          if (descriptor && descriptor.set === void 0 && descriptor.writable === false) return;
          function WithSearchUsage(props) {
            if (key === "turn-tail") {
              const location = props?.node?.location;
              const records = (location?.kind === "turn" || location?.kind === "step") && location.turn?.data?.get ? location.turn.data.get("lcx-search-usage") : void 0;
              if (!records?.length) return createElement(original, props);
              return createElement(original, { ...props, node: { ...props.node, data: { ...props.node.data, tokenUsage: addTurnUsage(props.node.data.tokenUsage, records) } } });
            }
            if (typeof props?.useProjection !== "function") return createElement(original, props);
            const extra = props.useProjection("lcxSearchUsage");
            const breakdown = props.useProjection("contextBreakdown");
            const useProjection = (projection) => {
              const value = props.useProjection(projection);
              if (projection === "tokenUsage" && extra?.auxiliary) return mergeBuckets(value, extra.auxiliary);
              if (projection === "contextPressure" && extra?.aggregateContext && object(breakdown)) {
                const tokens = breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens;
                if (Number.isSafeInteger(tokens) && tokens >= 0 && object(value)) return { ...value, pressureTokens: tokens, projectedTokens: tokens };
              }
              return value;
            };
            return createElement(original, { ...props, useProjection });
          }
          try {
            base.component = WithSearchUsage;
          } catch {
            return;
          }
          if (base.component !== WithSearchUsage) return;
          return () => {
            if (base.component === WithSearchUsage) base.component = original;
          };
        });
      } catch {
        continue;
      }
      if (typeof effect === "function") cleanups.push(effect);
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
      const css = `.lcx-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;list-style:none}.lcx-head{width:100%;display:flex;justify-content:space-between;padding:14px 16px;border:0;background:transparent;color:inherit}.lcx-body{border-top:1px solid var(--dsw-alias-border-l2);padding:12px 16px}.lcx-row{display:flex;gap:9px;padding:8px 0}.lcx-row small,.lcx-help{display:block;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}.lcx-group{border-top:1px solid var(--dsw-alias-border-l2);margin-top:10px;padding-top:14px}.lcx-group strong{font-size:14px}.lcx-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}.lcx-foot button{padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit}` + inlineMediaCss;
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
          mediaPreviewHelp: "\u5728\u56DE\u7B54\u4E0B\u663E\u793A\u53EF\u7528\u7684\u641C\u7D22\u56FE\u7247\u6216\u76F4\u94FE\u9884\u89C8\uFF0C\u70B9\u51FB\u653E\u5927\u6216\u64AD\u653E\uFF1B\u4E0D\u53EF\u9884\u89C8\u65F6\u4FDD\u7559\u539F\u59CB\u56DE\u7B54\u4E0E\u7F51\u9875\u94FE\u63A5\u3002\u6B64\u8BBE\u7F6E\u53EA\u6539\u53D8\u754C\u9762\u663E\u793A\u3002",
          mediaTitle: "\u5A92\u4F53\u9884\u89C8",
          mediaPlay: "\u64AD\u653E\u89C6\u9891",
          mediaEnlarge: "\u653E\u5927\u56FE\u7247",
          mediaClose: "\u5173\u95ED\u9884\u89C8",
          mediaMore: "\u5C55\u5F00\u5176\u4F59 {count} \u9879",
          mediaLess: "\u6536\u8D77\u9884\u89C8",
          mediaPrevious: "\u4E0A\u4E00\u5F20",
          mediaNext: "\u4E0B\u4E00\u5F20",
          mediaResolve: "\u52A0\u8F7D\u7D20\u6750\u9884\u89C8",
          mediaLoading: "\u6B63\u5728\u83B7\u53D6\u5A92\u4F53\u2026",
          mediaUnavailable: "\u6682\u4E0D\u80FD\u9884\u89C8",
          mediaAll: "\u5168\u90E8",
          mediaImages: "\u56FE\u7247",
          mediaVideos: "\u89C6\u9891",
          mediaImage: "\u56FE\u7247",
          mediaVideo: "\u89C6\u9891",
          mediaFilter: "\u5A92\u4F53\u7C7B\u578B",
          mediaOpen: "\u6253\u5F00\u539F\u59CB\u5A92\u4F53",
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
          mediaPreviewHelp: "Preview available search images or direct media links below the answer. Unavailable media leaves the original answer and links intact. This setting changes presentation only.",
          mediaTitle: "Media previews",
          mediaPlay: "Play video",
          mediaEnlarge: "Enlarge image",
          mediaClose: "Close preview",
          mediaMore: "Show {count} more",
          mediaLess: "Show fewer",
          mediaPrevious: "Previous image",
          mediaNext: "Next image",
          mediaResolve: "Load media preview",
          mediaLoading: "Resolving media\u2026",
          mediaUnavailable: "Preview unavailable",
          mediaAll: "All",
          mediaImages: "Photos",
          mediaVideos: "Videos",
          mediaImage: "Photo",
          mediaVideo: "Video",
          mediaFilter: "Media type",
          mediaOpen: "Open original media",
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
            items: context.state.structuredItems.length ? context.state.structuredItems : extractSearchMedia(text),
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
        constructor(scope) {
          this.scope = scope;
          this.draft = null;
          this.dirty = false;
          this.saving = false;
          this.saveError = false;
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
        async save() {
          if (!this.dirty || this.saving || !this.snapshot().writable || this.snapshot().status !== "ready") return;
          const next = this.draftValue(), prev = this.value();
          const fields = FIELDS.filter((field) => next[field] !== prev[field]);
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
              if (this.snapshot().status !== "ready" || fields.some((field) => this.value()[field] !== next[field]))
                throw new Error("Settings mutation was not confirmed");
            }
            this.draft = null;
            this.dirty = false;
          } catch {
            this.saveError = true;
          } finally {
            this.saving = false;
            this.publish();
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
            discard: () => this.discard()
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
        if (!s.available) return null;
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
      function InlineMedia({ node, t }) {
        const [marker, setMarker] = React.useState(null);
        React.useEffect(() => {
          if (!marker) return;
          return installInlineMedia(marker, node.data.items, { image: t("mediaEnlarge"), video: t("mediaPlay"), close: t("mediaClose"), source: t("mediaOpen"), more: t("mediaMore"), less: t("mediaLess"), previous: t("mediaPrevious"), next: t("mediaNext") });
        }, [marker, node.data.items, t]);
        return React.createElement("span", { ref: setMarker, "aria-hidden": true });
      }
      function MediaNode(props) {
        const enabled = props.useMediaPreview((state) => state?.enabled === true);
        return enabled ? React.createElement(InlineMedia, { node: props.node, t: props.t }) : null;
      }
      const inject = ["slots", "locale", "settingsScope", "uiConversation"];
      function apply(ctx) {
        const slots = ctx.slots ?? ctx.get("slots"), svc = ctx.settingsScope ?? ctx.get("settingsScope"), locale = ctx.locale ?? ctx.get("locale"), uiConversation = ctx.uiConversation ?? ctx.get("uiConversation");
        if (!slots || !svc || !locale || !uiConversation) return;
        if (typeof slots.entriesOfSlot === "function") {
          ctx.effect(() => uiConversation.events.register(searchUsageDefinition), "lcx search billing data");
          ctx.effect(() => installUsageSlots(slots, React.createElement), "lcx search billing slots");
        }
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
        const controller = new Controller(svc.bind({ namespace: NAMESPACE }));
        installSlot(
          "settings.plugin.item",
          "lcx-codex settings slot",
          () => slots.register(
            {
              name: "settings.plugin.item",
              key: NAMESPACE,
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
