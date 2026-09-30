import type { SearchMediaItem } from './search-media.js';

/**
 * LCX search media presentation (Issue #102).
 *
 * Ownership: DSH 0.2 renders Markdown/native images itself. LCX only renders
 *  - structured provider image candidates and plain direct image links from the answer text
 *    (never Markdown images) as ONE borderless image rail under the owning response, and
 *  - direct playable video URLs as user-initiated cards that expand into an inline player.
 *
 * Design: images keep their own proportions at a shared row height (no frames, no letterboxing),
 * attribution is a small overlay chip, overflow scrolls horizontally with edge fades and arrow
 * buttons. Everything uses DSH `--dsw-*` theme tokens; only overlays drawn on top of media
 * (chip, player chrome) use fixed translucent black/white, which reads the same in both themes.
 */
export const inlineMediaCss = `
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

/**
 * DSH 0.2 renders a Markdown image as `<p><button><img></button> …</p>` with the button
 * `inline-block; vertical-align:middle`, so any text or links after the image in the same
 * paragraph sit beside it. LCX only restyles that wrapper (PO decision, Issue #102): inside
 * assistant responses an image that is the button's only child always starts its own line.
 * Structural selector only (no hashed DSH class names); if DSH changes the DOM it simply stops matching.
 */
export const nativeMarkdownImageCss = `
[data-chat-flow-kind="assistant-step"] p>button:has(>img:only-child){display:block;width:fit-content;max-width:100%;margin:4px 0 8px}
`;

export type MediaLabels = {
  /** Trigger label for an image tile ("Enlarge image"). */
  image: string;
  /** Trigger label for a video card ("Play video"). */
  video: string;
  close: string;
  /** "Open original media" link text. */
  source: string;
  /** Failed-image text (tooltip / accessible name of the placeholder). */
  failed: string;
  /** Video that cannot be played. */
  videoFailed: string;
  /** Accessible name of the image rail ("Search images"). */
  heading: string;
  /** Rail scroll buttons. */
  previous: string;
  next: string;
  /** Accessible name of the inline video player. */
  dialog: string;
  /** Accessible name of the image preview (matches DSH's own lightbox wording). */
  imageDialog: string;
};

/**
 * Optional bridge to DSH's own public image lightbox (`ImageLightbox` exported by
 * `@deepseek-ai/dsh-client-ui-primitives`). Returns a disposer, or null when the
 * host cannot provide it, in which case LCX opens its own theme-aware dialog.
 */
export type InlineMediaHost = {
  openImage?: (options: {
    src: string;
    alt: string;
    labels: { dialog: string; close: string };
    onClose: () => void;
  }) => (() => void) | null;
};

type PreviewItem = SearchMediaItem & { readonly sources: readonly string[] };

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 3.5l9 9m0-9l-9 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICON_BROKEN = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 16l4.5-4.5 3 3 2.5-2.5 7 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/></svg>';
const ICON_PREV = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Natural aspect ratios are honoured within these bounds; extreme panoramas/strips are cropped to them. */
export const TILE_ASPECT_MIN = 0.5;
export const TILE_ASPECT_MAX = 2.2;
const imageKey = (url: string) => url.replace(/#.*$/, '');
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const fileNameOf = (url: string) => {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '');
    return name || hostOf(url);
  } catch { return url; }
};

/**
 * Rail images: structured provider candidates first, then plain direct image links from the
 * answer text (the extractor already excludes Markdown images, which DSH renders itself).
 */
function railImages(items: readonly SearchMediaItem[]): SearchMediaItem[] {
  const seen = new Set<string>();
  const result: SearchMediaItem[] = [];
  for (const item of [...items.filter(value => value.structured === true), ...items.filter(value => value.structured !== true)]) {
    if (item.kind !== 'image') continue;
    const key = imageKey(item.url);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/** Direct videos, grouping alternate encodings that share origin/path/query/fragment. */
function videoItems(items: readonly SearchMediaItem[]): PreviewItem[] {
  const groups = new Map<string, SearchMediaItem[]>();
  for (const item of items) {
    if (item.kind !== 'video') continue;
    const url = new URL(item.url);
    // Only alternate file extensions at the exact same origin/path/query/fragment qualify.
    // Never merge across CDNs, signed URLs, different resolutions, or temporal fragments.
    const identity = JSON.stringify([url.origin, url.pathname.replace(/\.(mp4|webm|ogv)$/i, ''), url.search, url.hash]);
    const group = groups.get(identity) ?? [];
    if (!group.some(value => value.url === item.url)) group.push(item);
    groups.set(identity, group);
  }
  const priority = (url: string) => ({ mp4: 0, webm: 1, ogv: 2 }[new URL(url).pathname.split('.').at(-1)!.toLowerCase() as 'mp4'] ?? 3);
  return [...groups.values()].map(group => {
    group.sort((a, b) => priority(a.url) - priority(b.url));
    return { ...group[0], sources: group.map(value => value.url) };
  });
}

const activeDialogByDocument = new WeakMap<Document, () => void>();

/** Resolve only a response in the media node's own Turn and chat column. */
function inlineMediaAnswer(marker: HTMLElement): HTMLElement | null {
  const row = marker.closest<HTMLElement>('[data-chat-flow-kind="lcx-search-media"]');
  const ElementClass = marker.ownerDocument.defaultView?.HTMLElement;
  if (!ElementClass || !row || !row.dataset.chatTurn) return null;
  const group = row.closest<HTMLElement>('[data-chat-group-key][data-step-process]');
  const column = group?.parentElement;
  if (!group || !(column instanceof ElementClass) || !column.hasAttribute('data-chat-flow') ||
      group.dataset.chatTurn !== row.dataset.chatTurn) return null;
  // The group may follow several steps of one Turn. The last preceding response
  // is the one that emitted this media node; never search outside this column.
  let answer: HTMLElement | null = null;
  for (const child of column.children) {
    if (child === group) break;
    if (child instanceof ElementClass && child.dataset.chatFlowKind === 'assistant-step' &&
        child.dataset.chatGroupPart === 'response' && child.dataset.chatTurn === row.dataset.chatTurn) {
      answer = child;
    }
  }
  return answer;
}

/** DSH chat DOM capability check; an unknown renderer fails closed. */
export function supportsInlineMediaDom(marker: HTMLElement): boolean {
  return inlineMediaAnswer(marker) !== null;
}

/**
 * Own only inserted elements. Never replace React-owned text, links or children.
 * One `.lcx-media` block is appended to the owning response and removed on dispose.
 */
export function installInlineMedia(
  marker: HTMLElement,
  items: readonly SearchMediaItem[],
  labels: MediaLabels,
  host: InlineMediaHost = {},
): () => void {
  const resolvedAnswer = inlineMediaAnswer(marker);
  const images = railImages(items), videos = videoItems(items);
  if (!resolvedAnswer || (images.length === 0 && videos.length === 0)) return () => {};
  const answer: HTMLElement = resolvedAnswer;
  const doc = marker.ownerDocument;
  const win = doc.defaultView;
  const cleanups: Array<() => void> = [];
  let disposed = false;
  let frame = 0;
  let ownedClose: (() => void) | undefined;

  // Exactly one media block per response, even if an older instance was orphaned.
  // The owner marker lives on the DOM node, so even a second copy of this module (plugin hot reload)
  // cannot fight over the same response: only the latest installer keeps its block attached.
  const token = Math.random().toString(36).slice(2);
  answer.dataset.lcxMediaOwner = token;
  for (const stale of [...answer.children]) if (stale.classList.contains('lcx-media')) stale.remove();

  const root = doc.createElement('div');
  root.className = 'lcx-media';
  root.dataset.lcxMedia = '';

  // ---- image fallback dialog (only when DSH's lightbox is unavailable) ----------------------------
  function openDialog(item: SearchMediaItem, trigger: HTMLElement, description: string) {
    activeDialogByDocument.get(doc)?.();
    const dialog = doc.createElement('dialog');
    dialog.className = 'lcx-media-dialog';
    dialog.setAttribute('aria-label', labels.imageDialog);
    dialog.dataset.kind = 'image';
    const body = doc.createElement('div'); body.className = 'lcx-media-dialog-body';
    const close = doc.createElement('button');
    close.type = 'button'; close.className = 'lcx-media-close'; close.innerHTML = ICON_CLOSE;
    close.setAttribute('aria-label', labels.close);
    const bar = doc.createElement('div'); bar.className = 'lcx-media-dialog-bar';
    const caption = doc.createElement('span'); caption.className = 'lcx-media-dialog-caption';
    caption.textContent = description; caption.title = description;
    const source = doc.createElement('a');
    source.href = item.sourceUrl ?? item.url; source.target = '_blank';
    source.rel = 'noopener noreferrer'; source.textContent = labels.source;
    bar.append(caption, source);

    let media: HTMLElement;
    let closed = false;
    const image = doc.createElement('img');
    image.alt = description; image.referrerPolicy = 'no-referrer'; image.src = item.url;
    image.onerror = () => {
      if (closed) return;
      const fail = doc.createElement('div'); fail.className = 'lcx-media-dialog-fail'; fail.textContent = labels.failed;
      media.onerror = null; media.replaceWith(fail); media = fail;
    };
    media = image;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      close.onclick = null; dialog.oncancel = null; dialog.onclick = null; dialog.onkeydown = null;
      media.onerror = null;
      dialog.remove();
      if (activeDialogByDocument.get(doc) === cleanup) activeDialogByDocument.delete(doc);
      if (ownedClose === cleanup) ownedClose = undefined;
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
    };
    ownedClose = cleanup;
    activeDialogByDocument.set(doc, cleanup);
    close.onclick = cleanup;
    dialog.oncancel = event => { event.preventDefault(); cleanup(); };
    // The dialog element itself is the viewport mask; only a click on it (not on its content) dismisses.
    dialog.onclick = event => { if (event.target === dialog) cleanup(); };
    dialog.onkeydown = event => {
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]')];
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      const active = doc.activeElement;
      if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    body.append(media, bar);
    dialog.append(body, close);
    doc.body.append(dialog);
    dialog.showModal(); close.focus();
  }

  function openImage(item: SearchMediaItem, trigger: HTMLElement, description: string) {
    activeDialogByDocument.get(doc)?.();
    if (host.openImage) {
      let closed = false;
      let dispose: (() => void) | null = null;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        dispose?.();
        if (activeDialogByDocument.get(doc) === cleanup) activeDialogByDocument.delete(doc);
        if (ownedClose === cleanup) ownedClose = undefined;
        if (trigger.isConnected) trigger.focus({ preventScroll: true });
      };
      dispose = host.openImage({ src: item.url, alt: description, labels: { dialog: labels.imageDialog, close: labels.close }, onClose: cleanup });
      if (dispose) { ownedClose = cleanup; activeDialogByDocument.set(doc, cleanup); return; }
      closed = true;
    }
    openDialog(item, trigger, description);
  }

  // ---- structured image rail ----------------------------------------------------------------------
  if (images.length) {
    const rail = doc.createElement('div'); rail.className = 'lcx-media-rail';
    rail.dataset.count = String(Math.min(images.length, 3));
    const track = doc.createElement('ul'); track.className = 'lcx-media-track'; track.setAttribute('role', 'list');
    track.setAttribute('aria-label', `${labels.heading} · ${images.length}`);
    const makeNav = (dir: 'prev' | 'next') => {
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'lcx-media-nav';
      button.dataset.dir = dir; button.hidden = true; button.tabIndex = -1;
      button.setAttribute('aria-label', dir === 'prev' ? labels.previous : labels.next);
      button.innerHTML = dir === 'prev' ? ICON_PREV : ICON_NEXT;
      button.onclick = () => track.scrollBy({ left: (dir === 'prev' ? -1 : 1) * Math.max(160, track.clientWidth * 0.8), behavior: 'smooth' });
      cleanups.push(() => { button.onclick = null; });
      return button;
    };
    const prev = makeNav('prev'), next = makeNav('next');
    // Scroll affordances follow the real overflow: edge fades + arrow buttons only where more content exists.
    const updateEdges = () => {
      if (disposed) return;
      const max = track.scrollWidth - track.clientWidth;
      const left = track.scrollLeft > 2, right = max - track.scrollLeft > 2;
      rail.toggleAttribute('data-more-left', left); rail.toggleAttribute('data-more-right', right);
      prev.hidden = !left; next.hidden = !right;
    };
    track.addEventListener('scroll', updateEdges, { passive: true });
    cleanups.push(() => track.removeEventListener('scroll', updateEdges));
    const Resize = win?.ResizeObserver;
    if (Resize) { const resize = new Resize(updateEdges); resize.observe(track); cleanups.push(() => resize.disconnect()); }

    for (const item of images) {
      const domain = hostOf(item.sourceUrl ?? item.url);
      const description = item.caption ?? domain;
      const tile = doc.createElement('li'); tile.className = 'lcx-media-tile'; tile.dataset.state = 'loading'; tile.dataset.url = item.url;
      const open = doc.createElement('button'); open.type = 'button'; open.className = 'lcx-media-open';
      open.setAttribute('aria-label', `${labels.image} · ${description}`);
      if (item.caption) open.title = item.caption;
      const image = doc.createElement('img');
      image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer'; image.draggable = false;
      open.append(image);
      let source = item.previewUrl ?? item.url;
      image.onload = () => {
        if (tile.dataset.state !== 'loading') return;
        const ratio = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 0;
        if (ratio) tile.style.setProperty('--lcx-ar', String(Math.min(TILE_ASPECT_MAX, Math.max(TILE_ASPECT_MIN, ratio))));
        // Beyond the clamp (wide logos, banners, tall strips) show the whole image instead of cropping it.
        if (ratio && (ratio > TILE_ASPECT_MAX || ratio < TILE_ASPECT_MIN)) tile.dataset.fit = 'contain';
        tile.dataset.state = 'loaded';
        updateEdges();
      };
      image.onerror = () => {
        // One bounded equivalent fallback: thumbnail -> full image.
        if (source !== item.url) { source = item.url; image.src = source; return; }
        image.onload = null; image.onerror = null; image.remove();
        // A prose link that is not a loadable image (hotlink protection, 404, not really an image)
        // simply leaves the rail: the link itself is still in the answer. Provider candidates keep a
        // quiet placeholder so their source attribution is not lost.
        if (item.structured !== true) {
          open.onclick = null; open.onfocus = null;
          tile.remove();
          rail.dataset.count = String(Math.min(track.children.length, 3));
          if (track.children.length === 0) { rail.remove(); if (!root.querySelector('.lcx-media-videos')) root.hidden = true; }
          updateEdges();
          return;
        }
        tile.dataset.state = 'failed';
        open.disabled = true; open.onclick = null;
        open.setAttribute('aria-label', `${labels.failed} · ${description}`); open.title = labels.failed;
        const fail = doc.createElement('span'); fail.className = 'lcx-media-fail';
        fail.innerHTML = ICON_BROKEN;
        open.append(fail);
      };
      image.src = source;
      open.onclick = () => openImage(item, open, description);
      open.onfocus = () => tile.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      const chip = item.sourceUrl ? doc.createElement('a') : doc.createElement('span');
      chip.className = 'lcx-media-chip'; chip.textContent = domain; chip.title = item.caption ? `${item.caption} · ${domain}` : domain;
      if (item.sourceUrl) {
        const anchor = chip as HTMLAnchorElement;
        anchor.href = item.sourceUrl; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
      }
      tile.append(open, chip); track.append(tile);
      cleanups.push(() => { open.onclick = null; open.onfocus = null; image.onload = null; image.onerror = null; });
    }
    rail.append(track, prev, next);
    root.append(rail);
  }

  // ---- direct video cards -> inline player --------------------------------------------------------
  if (videos.length) {
    const section = doc.createElement('div'); section.className = 'lcx-media-videos';
    for (const item of videos) {
      const name = fileNameOf(item.url);
      const format = item.sources.map(value => /\.(mp4|webm|ogv)$/i.exec(new URL(value).pathname)?.[1]).filter(Boolean).join(' / ').toUpperCase();
      const card = doc.createElement('button'); card.type = 'button'; card.className = 'lcx-media-video'; card.dataset.url = item.url;
      card.setAttribute('aria-label', `${labels.video} · ${name}`);
      const play = doc.createElement('span'); play.className = 'lcx-media-play'; play.setAttribute('aria-hidden', 'true');
      play.innerHTML = ICON_PLAY;
      const text = doc.createElement('span'); text.className = 'lcx-media-video-text';
      const title = doc.createElement('span'); title.className = 'lcx-media-video-title'; title.textContent = name; title.title = item.url;
      const sub = doc.createElement('span'); sub.className = 'lcx-media-video-sub';
      sub.textContent = [hostOf(item.url), format].filter(Boolean).join(' · ');
      text.append(title, sub);
      card.append(play, text);
      let collapse: ((refocus?: boolean) => void) | undefined;
      // Nothing is requested before this click; the player is created, loaded and played from the user's gesture.
      card.onclick = () => {
        const player = doc.createElement('div'); player.className = 'lcx-media-player';
        player.setAttribute('role', 'group'); player.setAttribute('aria-label', `${labels.dialog} · ${name}`);
        const video = doc.createElement('video');
        video.controls = true; video.playsInline = true; video.preload = 'none';
        const poster = item.previewUrl ?? item.poster;
        if (poster) video.poster = poster;
        const close = doc.createElement('button'); close.type = 'button'; close.className = 'lcx-media-player-close';
        close.innerHTML = ICON_CLOSE; close.setAttribute('aria-label', labels.close);
        let sourceIndex = 0;
        let closed = false;
        video.onerror = () => {
          if (closed) return;
          if (sourceIndex + 1 < item.sources.length) {
            sourceIndex += 1;
            video.src = item.sources[sourceIndex];
            video.load();
            void video.play().catch(() => { /* Native controls stay available; errors advance the bounded source list. */ });
            return;
          }
          video.onerror = null; video.pause(); video.removeAttribute('src'); video.load(); video.remove();
          const fail = doc.createElement('div'); fail.className = 'lcx-media-player-fail';
          const message = doc.createElement('span'); message.textContent = labels.videoFailed;
          const link = doc.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = labels.source;
          fail.append(message, link); player.append(fail);
        };
        collapse = (refocus = true) => {
          if (closed) return;
          closed = true;
          video.onerror = null; close.onclick = null; player.onkeydown = null;
          video.pause(); video.removeAttribute('src'); video.load();
          player.replaceWith(card);
          collapse = undefined;
          if (refocus && card.isConnected) card.focus({ preventScroll: true });
        };
        close.onclick = () => collapse?.();
        player.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); collapse?.(); } };
        video.src = item.url;
        player.append(video, close);
        card.replaceWith(player);
        video.focus({ preventScroll: true });
        void video.play().catch(() => { /* Native controls remain available if the browser refuses. */ });
      };
      section.append(card);
      cleanups.push(() => { collapse?.(false); card.onclick = null; });
    }
    root.append(section);
  }

  answer.append(root);
  // React may append later blocks to the response; keep LCX's block last and re-attach it if the subtree is replaced.
  const keepAttached = () => {
    frame = 0;
    if (disposed) return;
    if (answer.dataset.lcxMediaOwner !== token) { root.remove(); return; }
    if (root.parentElement !== answer || answer.lastElementChild !== root) answer.append(root);
  };
  const observer = new MutationObserver(() => { if (!disposed && !frame) frame = requestAnimationFrame(keepAttached); });
  observer.observe(answer, { childList: true });

  return () => {
    if (disposed) return;
    observer.disconnect();
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    ownedClose?.();
    for (const cleanup of cleanups) cleanup();
    cleanups.length = 0;
    disposed = true;
    if (answer.dataset.lcxMediaOwner === token) delete answer.dataset.lcxMediaOwner;
    root.remove();
  };
}
