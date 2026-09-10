import type { SearchMediaItem } from './search-media.js';

export const inlineMediaCss = `
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
.lcx-media-thumb:not([data-video])::after{content:'↗';position:absolute;right:6px;bottom:6px;display:grid;place-items:center;width:22px;height:22px;border-radius:7px;background:#14212b99;color:white;font:15px/1 system-ui;backdrop-filter:blur(6px);pointer-events:none}
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

type Labels = { image: string; video: string; close: string; source: string; more: string; less: string; previous: string; next: string };
type PreviewItem = SearchMediaItem & { readonly sources: readonly string[] };
type PreviewEntry = { item: PreviewItem; button: HTMLButtonElement; fail: () => void; cleanup: () => void; load?: () => void };
const VISIBLE_MEDIA_LIMIT = 4;
const mediaKey = (item: Pick<SearchMediaItem, 'kind' | 'url'>) => item.kind === 'video' ? item.url : item.url.replace(/#.*$/, '');

function previewItems(items: readonly SearchMediaItem[]): Map<string, PreviewItem> {
  const groups = new Map<string, SearchMediaItem[]>();
  for (const item of items) {
    if (item.kind === 'page') continue;
    const url = new URL(item.url);
    // Only alternate file extensions at the exact same origin/path/query/fragment qualify.
    // Never merge across CDNs, signed URLs, different resolutions, or temporal fragments.
    const identity = item.kind === 'video'
      ? JSON.stringify(['video', url.origin, url.pathname.replace(/\.(mp4|webm|ogv)$/i, ''), url.search, url.hash])
      : JSON.stringify(['image', mediaKey(item)]);
    const group = groups.get(identity) ?? [];
    if (!group.some(value => value.url === item.url)) group.push(item);
    groups.set(identity, group);
  }
  const result = new Map<string, PreviewItem>();
  const priority = (url: string) => ({mp4:0, webm:1, ogv:2}[new URL(url).pathname.split('.').at(-1)!.toLowerCase()] ?? 3);
  for (const group of groups.values()) {
    group.sort((a, b) => priority(a.url) - priority(b.url));
    const item = {...group[0], sources: group.map(value => value.url)};
    for (const value of group) result.set(mediaKey(value), item);
  }
  return result;
}
const activeDialogByDocument = new WeakMap<Document, () => void>();

/** DSH chat DOM capability check; an unknown renderer fails closed. */
export function supportsInlineMediaDom(marker: HTMLElement): boolean {
  const row = marker.closest<HTMLElement>('[data-chat-flow-kind="lcx-search-media"]');
  const answer = row?.previousElementSibling;
  const ElementClass = marker.ownerDocument.defaultView?.HTMLElement;
  return Boolean(
    ElementClass && answer instanceof ElementClass &&
    row?.parentElement === answer.parentElement &&
    answer.dataset.chatFlowKind === 'assistant-step' &&
    typeof answer.dataset.chatTurn === 'string' &&
    answer.dataset.chatTurn !== '' &&
    answer.dataset.chatTurn === row?.dataset.chatTurn,
  );
}

/** Own only inserted elements. Never replace React-owned text, links or children. */
export function installInlineMedia(marker: HTMLElement, items: readonly SearchMediaItem[], labels: Labels): () => void {
  if (items.length === 0 || !supportsInlineMediaDom(marker)) return () => {};
  const row = marker.closest<HTMLElement>('[data-chat-flow-kind="lcx-search-media"]')!;
  const answer = row.previousElementSibling as HTMLElement;
  const doc = marker.ownerDocument;
  const wanted = previewItems(items.filter(item => item.structured !== true));
  const structured = [...new Set(previewItems(items.filter(item => item.structured === true)).values())];
  const previews = new Map<HTMLAnchorElement, { preview: HTMLElement; href: string }>();
  const strips = new Map<Element, HTMLElement>();
  const entries = new Map<HTMLElement, PreviewEntry>();
  let expanded = false;
  const toggle = doc.createElement('button'); toggle.type = 'button'; toggle.className = 'lcx-media-toggle';
  const toggleRow = doc.createElement('span'); toggleRow.className = 'lcx-media-toggle-row'; toggleRow.append(toggle);
  toggle.onclick = () => { expanded = !expanded; updateVisibility(); toggle.focus({preventScroll:true}); };
  const failed = new Set<string>();
  let disposed = false;
  let frame = 0;
  let ownedClose: (() => void) | undefined;

  function orderedEntries() {
    return [...answer!.querySelectorAll<HTMLElement>('.lcx-inline-media')].flatMap(preview => {
      const entry = entries.get(preview); return entry ? [{preview, ...entry}] : [];
    });
  }

  function updateVisibility() {
    const all = orderedEntries();
    all.forEach((entry, index) => {
      const hidden = !expanded && index >= VISIBLE_MEDIA_LIMIT;
      if (entry.preview.hidden !== hidden) entry.preview.hidden = hidden;
      if (!hidden) { entry.load?.(); const saved = entries.get(entry.preview); if (saved) saved.load = undefined; }
    });
    if (all.length <= VISIBLE_MEDIA_LIMIT) { toggleRow.remove(); return; }
    const text = expanded ? labels.less : labels.more.replace('{count}', String(all.length - VISIBLE_MEDIA_LIMIT));
    if (toggle.textContent !== text) toggle.textContent = text;
    const aria = String(expanded); if (toggle.getAttribute('aria-expanded') !== aria) toggle.setAttribute('aria-expanded', aria);
    const parent = all[expanded ? all.length - 1 : VISIBLE_MEDIA_LIMIT - 1].preview.parentElement!;
    if (toggleRow.parentElement !== parent || toggleRow !== parent.lastElementChild) parent.append(toggleRow);
  }

  function removePreview(preview: HTMLElement) {
    const strip = preview.parentElement;
    entries.get(preview)?.cleanup();
    entries.delete(preview);
    preview.remove();
    if (strip?.classList.contains('lcx-media-strip') && !strip.childElementCount) {
      strip.remove();
      for (const [block, value] of strips) if (value === strip) strips.delete(block);
    }
  }

  function placePreview(anchor: HTMLAnchorElement, preview: HTMLElement) {
    // Keep React-owned sentences and punctuation intact; collect previews below their paragraph/list item.
    const block = anchor.closest('p,li,td,th,figcaption');
    const owner = block && answer!.contains(block) ? block : anchor;
    let strip = strips.get(owner);
    if (!strip?.isConnected) {
      strip = doc.createElement('span'); strip.className = 'lcx-media-strip';
      if (owner === anchor) anchor.after(strip); else owner.append(strip);
      strips.set(owner, strip);
    }
    strip.append(preview);
  }

  function open(item: PreviewItem, trigger: HTMLButtonElement, fail: () => void) {
    activeDialogByDocument.get(doc)?.();
    const dialog = doc.createElement('dialog');
    dialog.className = 'lcx-media-dialog';
    dialog.setAttribute('aria-label', item.kind === 'image' ? labels.image : labels.video);
    const close = doc.createElement('button');
    close.type = 'button'; close.className = 'lcx-media-close'; close.textContent = '×';
    close.setAttribute('aria-label', labels.close);
    let media = doc.createElement(item.kind === 'image' ? 'img' : 'video');
    if (media instanceof HTMLImageElement) { media.alt = trigger.getAttribute('aria-label') ?? labels.image; media.referrerPolicy = 'no-referrer'; }
    else { media.controls = true; media.playsInline = true; media.preload = 'none'; }
    if (media instanceof HTMLVideoElement) media.src = item.url;
    const source = doc.createElement('a'); source.href = item.sourceUrl ?? item.url; source.target = '_blank';
    source.rel = 'noopener noreferrer'; source.textContent = labels.source;
    let closed = false;
    let sourceIndex = 0;
    let previous: HTMLButtonElement | undefined;
    let next: HTMLButtonElement | undefined;
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
      if (media instanceof HTMLVideoElement) { media.pause(); media.removeAttribute('src'); media.load(); }
      dialog.remove();
      if (activeDialogByDocument.get(doc) === cleanup) activeDialogByDocument.delete(doc);
      if (ownedClose === cleanup) ownedClose = undefined;
      if (trigger.isConnected) trigger.focus({preventScroll: true});
    };
    ownedClose = cleanup;
    activeDialogByDocument.set(doc, cleanup);
    close.onclick = cleanup;
    dialog.oncancel = event => { event.preventDefault(); cleanup(); };
    dialog.onclick = event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) cleanup(); } };
    media.onerror = () => {
      if (closed) return;
      if (media instanceof HTMLVideoElement && sourceIndex + 1 < item.sources.length) {
        sourceIndex += 1;
        media.src = item.sources[sourceIndex]; source.href = item.sources[sourceIndex];
        media.load();
        void media.play().catch(() => { /* Keep native controls; media errors advance the bounded source list. */ });
        return;
      }
      cleanup(); fail();
    };
    dialog.append(close, media, source); doc.body.append(dialog);
    if (item.kind === 'image') {
      const nav = doc.createElement('span'); nav.className = 'lcx-media-nav';
      const previousButton = doc.createElement('button'), nextButton = doc.createElement('button'), counter = doc.createElement('span');
      previous = previousButton; next = nextButton;
      previousButton.type = nextButton.type = 'button'; previousButton.textContent = '‹'; nextButton.textContent = '›';
      previousButton.setAttribute('aria-label', labels.previous); nextButton.setAttribute('aria-label', labels.next);
      counter.setAttribute('aria-live', 'polite');
      nav.append(previousButton, counter, nextButton); dialog.append(nav);
      let currentKey = mediaKey(item);
      const images = () => orderedEntries().filter(entry => entry.item.kind === 'image');
      const select = (index: number) => {
        if (closed) return;
        const list = images(), entry = list[index];
        if (!entry) return;
        currentKey = mediaKey(entry.item);
        const image = doc.createElement('img'); image.alt = entry.button.getAttribute('aria-label') ?? labels.image; image.referrerPolicy = 'no-referrer';
        image.onerror = () => {
          if (closed || media !== image) return;
          entry.fail();
          const remaining = images();
          if (!remaining.length) { cleanup(); return; }
          select(Math.min(index, remaining.length - 1));
        };
        media.onerror = null; media.replaceWith(image); media = image;
        source.href = entry.item.sourceUrl ?? entry.item.url; image.src = entry.item.url;
        counter.textContent = `${index + 1} / ${list.length}`;
        previousButton.disabled = index === 0; nextButton.disabled = index === list.length - 1;
        nav.hidden = list.length < 2;
      };
      const move = (offset: number) => { const list = images(); select(list.findIndex(entry => mediaKey(entry.item) === currentKey) + offset); };
      previousButton.onclick = () => move(-1); nextButton.onclick = () => move(1);
      dialog.onkeydown = event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); }
      };
      select(images().findIndex(entry => mediaKey(entry.item) === mediaKey(item)));
    }
    dialog.showModal(); close.focus();
    if (media instanceof HTMLVideoElement) void media.play().catch(() => { /* Native controls remain available if autoplay policy rejects play. */ });
  }

  function createPreview(item: PreviewItem, description: string, forget?: () => void): HTMLElement | undefined {
    const key = mediaKey(item);
    if (failed.has(key)) return undefined;
    const preview = doc.createElement('span'); preview.className = 'lcx-inline-media'; preview.dataset.url = item.url;
    if (item.structured) preview.dataset.structured = '';
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'lcx-media-thumb';
    const label = item.kind === 'image' ? labels.image : labels.video;
    button.setAttribute('aria-label', label + ' · ' + description);
    let thumbnail: HTMLImageElement | undefined;
    const fail = () => { failed.add(key); removePreview(preview); forget?.(); updateVisibility(); };
    const cleanup = () => {
      button.onclick = null;
      if (thumbnail) { thumbnail.onload = null; thumbnail.onerror = null; }
      entry.load = undefined;
    };
    const entry: PreviewEntry = {item, button, fail, cleanup};
    const previewUrl = item.kind === 'image' ? (item.previewUrl ?? item.url) : (item.previewUrl ?? item.poster);
    if (previewUrl) {
      const image = doc.createElement('img'); thumbnail = image;
      image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      button.append(image);
      // Keep a viewport position for native lazy loading without a blank tile or invisible tab stop.
      button.tabIndex = -1; button.style.visibility = 'hidden'; preview.style.height = '1px'; preview.style.margin = '0';
      const reveal = () => { button.tabIndex = 0; button.style.visibility = ''; preview.style.height = ''; preview.style.margin = ''; };
      image.onload = reveal;
      image.onerror = item.kind === 'image' ? fail : () => { image.remove(); reveal(); };
      entry.load = () => { image.src = previewUrl; };
    }
    if (item.kind === 'video') {
      button.dataset.video = '';
      const play = doc.createElement('span'); play.className = 'lcx-media-play-label'; play.textContent = labels.video;
      button.append(play);
      const format = item.sources.map(value => /\.(mp4|webm|ogv)$/i.exec(new URL(value).pathname)?.[1]).filter(Boolean).join(' / ');
      if (format) {
        const badge = doc.createElement('span'); badge.className = 'lcx-media-format'; badge.textContent = format.toUpperCase();
        badge.setAttribute('aria-hidden', 'true'); button.append(badge);
      }
    }
    button.onclick = () => open(item, button, fail);
    preview.append(button); entries.set(preview, entry);
    return preview;
  }

  for (const item of structured) {
    const preview = createPreview(item, item.caption ?? new URL(item.url).hostname);
    if (!preview) continue;
    let strip = strips.get(answer);
    if (!strip) {
      strip = doc.createElement('span'); strip.className = 'lcx-media-strip';
      answer.append(strip); strips.set(answer, strip);
    }
    strip.append(preview);
  }

  const canPreview = (anchor: HTMLAnchorElement) => !anchor.closest('pre,code,[data-streaming],[data-turn-process-inline],.lcx-inline-media');
  function scan() {
    frame = 0;
    if (disposed) return;
    const candidates = new Map<HTMLAnchorElement, { item: PreviewItem; url: URL }>();
    const selected = new Set<string>();
    for (const anchor of answer.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (!canPreview(anchor)) continue;
      let url: URL;
      try { url = new URL(anchor.href); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      const baseItem = wanted.get(url.href.replace(/#.*$/, ''));
      const item = wanted.get(url.href) ?? (baseItem?.kind === 'image' ? baseItem : undefined);
      if (!item) continue;
      const key = mediaKey(item);
      if (selected.has(key) || failed.has(key)) continue;
      selected.add(key);
      candidates.set(anchor, {item, url});
    }
    for (const [anchor, current] of previews) {
      if (!candidates.has(anchor) || !current.preview.isConnected || current.href !== anchor.href) {
        removePreview(current.preview); previews.delete(anchor);
      }
    }
    for (const [anchor, {item, url}] of candidates) {
      if (previews.has(anchor)) continue;
      const preview = createPreview(
        item,
        anchor.textContent?.trim() || url.hostname,
        () => previews.delete(anchor),
      );
      if (!preview) continue;
      placePreview(anchor, preview); previews.set(anchor, {preview, href: anchor.href});
    }
    updateVisibility();
  }
  scan();
  const observer = new MutationObserver(() => { if (!disposed && !frame) frame = requestAnimationFrame(scan); });
  observer.observe(answer, {
    attributes: true,
    attributeFilter: ['data-streaming', 'data-turn-process-inline', 'href'],
    childList: true,
    subtree: true,
  });
  return () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    ownedClose?.();
    toggle.onclick = null;
    toggleRow.remove();
    for (const preview of [...entries.keys()]) removePreview(preview);
    previews.clear(); entries.clear();
    for (const strip of strips.values()) strip.remove();
    strips.clear();
  };
}
