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
export declare const inlineMediaCss = "\n[data-chat-flow-kind=\"lcx-search-media\"]{display:none!important}\n.lcx-media{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;min-width:0;max-width:100%;margin:16px 0 4px;font-family:var(--dsw-font-family,inherit);color:var(--dsw-alias-label-primary,inherit)}\n.lcx-media *{box-sizing:border-box}\n.lcx-media[hidden]{display:none}\n.lcx-media-rail{position:relative;min-width:0;--lcx-h:136px}\n.lcx-media-rail[data-count=\"1\"]{--lcx-h:220px}\n.lcx-media-rail[data-count=\"2\"]{--lcx-h:176px}\n.lcx-media-track{--lcx-fade-l:0px;--lcx-fade-r:0px;display:flex;gap:8px;margin:0;padding:0;list-style:none;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x proximity;scroll-behavior:smooth;scrollbar-width:none;overscroll-behavior-x:contain;-webkit-mask-image:linear-gradient(to right,transparent 0,#000 var(--lcx-fade-l),#000 calc(100% - var(--lcx-fade-r)),transparent 100%);mask-image:linear-gradient(to right,transparent 0,#000 var(--lcx-fade-l),#000 calc(100% - var(--lcx-fade-r)),transparent 100%)}\n.lcx-media-track::-webkit-scrollbar{display:none}\n.lcx-media-rail[data-more-left] .lcx-media-track{--lcx-fade-l:40px}\n.lcx-media-rail[data-more-right] .lcx-media-track{--lcx-fade-r:40px}\n.lcx-media-tile{position:relative;flex:none;height:var(--lcx-h);aspect-ratio:var(--lcx-ar,4/3);max-width:100%;margin:0;padding:0;scroll-snap-align:start;border-radius:var(--dsw-radius-md,12px);overflow:hidden;background:var(--dsw-alias-bg-skeleton,#0000000a)}\n.lcx-media-tile::after{content:\"\";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2,#0000001a);pointer-events:none}\n.lcx-media-tile[data-state=\"loading\"]{background:linear-gradient(100deg,var(--dsw-alias-bg-skeleton,#0000000a) 30%,var(--dsw-alias-interactive-bg-hover,#2631480f) 50%,var(--dsw-alias-bg-skeleton,#0000000a) 70%) 0 0/300% 100%;animation:lcx-media-shimmer 1.4s ease-in-out infinite}\n@keyframes lcx-media-shimmer{from{background-position:100% 0}to{background-position:0 0}}\n.lcx-media-open{position:absolute;inset:0;display:block;width:100%;height:100%;margin:0;padding:0;border:0;border-radius:inherit;background:none;color:inherit;font:inherit;cursor:zoom-in}\n.lcx-media-open:disabled{cursor:default}\n.lcx-media-open img{display:block;width:100%;height:100%;max-width:none;margin:0;padding:0;border:0;border-radius:0;object-fit:cover;opacity:0;transition:opacity .25s ease,transform .45s cubic-bezier(.2,.7,.2,1)}\n.lcx-media-tile[data-state=\"loaded\"] .lcx-media-open img{opacity:1}\n.lcx-media-tile[data-fit=\"contain\"] .lcx-media-open img{object-fit:contain}\n.lcx-media-tile[data-state=\"loaded\"]:hover .lcx-media-open img{transform:scale(1.04)}\n.lcx-media-fail{position:absolute;inset:0;display:grid;place-items:center;color:var(--dsw-alias-label-tertiary,#8a93a6)}\n.lcx-media-fail svg{width:22px;height:22px}\n.lcx-media-chip{position:absolute;left:6px;bottom:6px;z-index:1;max-width:calc(100% - 12px);overflow:hidden;padding:2px 8px;border-radius:var(--dsw-radius-xs,6px);background:#00000073;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#fff;font-size:11px;line-height:16px;font-weight:500;white-space:nowrap;text-overflow:ellipsis;text-decoration:none;opacity:0;transform:translateY(3px);transition:opacity .18s ease,transform .18s ease}\na.lcx-media-chip:hover{text-decoration:underline;text-underline-offset:2px}\n.lcx-media-tile:hover .lcx-media-chip,.lcx-media-tile:focus-within .lcx-media-chip,.lcx-media-tile[data-state=\"failed\"] .lcx-media-chip{opacity:1;transform:none}\n.lcx-media-tile[data-state=\"failed\"] .lcx-media-chip{background:transparent;-webkit-backdrop-filter:none;backdrop-filter:none;color:var(--dsw-alias-label-tertiary,#8a93a6)}\n.lcx-media-nav{position:absolute;top:50%;z-index:2;display:grid;place-items:center;width:32px;height:32px;margin-top:-16px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 0 0 .5px var(--dsw-alias-border-l3,#0000001f),0 2px 10px #00000021;color:var(--dsw-alias-label-primary,#1f2430);cursor:pointer;opacity:0;transition:opacity .15s ease}\n.lcx-media-nav[hidden]{display:none}\n.lcx-media-nav[data-dir=\"prev\"]{left:8px}\n.lcx-media-nav[data-dir=\"next\"]{right:8px}\n.lcx-media-nav svg{width:16px;height:16px}\n.lcx-media-rail:hover .lcx-media-nav,.lcx-media-nav:focus-visible{opacity:1}\n.lcx-media-videos{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,210px),1fr));gap:8px;min-width:0}\n.lcx-media-video{display:flex;align-items:center;gap:10px;width:100%;min-width:0;margin:0;padding:6px 12px 6px 6px;border:0;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .15s ease}\n.lcx-media-video:hover{background:var(--dsw-alias-interactive-bg-active,#26314817)}\n.lcx-media-play{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:999px;background:var(--dsw-alias-label-primary,#1f2430);color:var(--dsw-alias-label-primary-foreground,#fff);transition:transform .15s ease}\n.lcx-media-video:hover .lcx-media-play{transform:scale(1.06)}\n.lcx-media-play svg{width:16px;height:16px;margin-left:2px}\n.lcx-media-video-text{display:flex;flex-direction:column;min-width:0}\n.lcx-media-video-title{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:13px;line-height:19px;font-weight:500;color:var(--dsw-alias-label-primary,inherit)}\n.lcx-media-video-sub{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8a93a6)}\n.lcx-media-player{grid-column:1/-1;position:relative;width:min(100%,640px);aspect-ratio:16/9;border-radius:var(--dsw-radius-md,12px);overflow:hidden;background:#000}\n.lcx-media-player video{display:block;width:100%;height:100%;max-width:none;margin:0;border:0;object-fit:contain;background:#000}\n.lcx-media-player-close{position:absolute;top:8px;right:8px;z-index:1;display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:999px;background:#00000080;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#fff;cursor:pointer}\n.lcx-media-player-close svg,.lcx-media-close svg{width:14px;height:14px}\n.lcx-media-player-fail{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:16px;color:#ffffffd9;font-size:13px;line-height:20px;text-align:center}\n.lcx-media-player-fail a{color:#fff;text-decoration:underline;text-underline-offset:3px}\n.lcx-media-open:focus-visible,.lcx-media-chip:focus-visible,.lcx-media-nav:focus-visible,.lcx-media-video:focus-visible,.lcx-media-player-close:focus-visible,.lcx-media-close:focus-visible,.lcx-media-dialog a:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-link,#416de0));outline-offset:2px}\n.lcx-media-open:focus-visible{outline-offset:-2px}\n.lcx-media-dialog{position:fixed;inset:0;box-sizing:border-box;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:48px;border:0;overflow:hidden;background:var(--dsw-alias-bg-mask-1,#0009);-webkit-backdrop-filter:var(--dsw-mask-blur,blur(8px));backdrop-filter:var(--dsw-mask-blur,blur(8px));color:var(--dsw-alias-label-primary,inherit);font-family:var(--dsw-font-family,inherit)}\n.lcx-media-dialog[open]{display:grid;place-items:center}\n.lcx-media-dialog::backdrop{background:transparent}\n.lcx-media-dialog-body{display:flex;flex-direction:column;align-items:center;gap:12px;min-width:0;max-width:min(100%,1600px);max-height:100%}\n.lcx-media-dialog img{display:block;max-width:100%;max-height:calc(100vh - 150px);width:auto;height:auto;object-fit:contain;border-radius:var(--dsw-radius-md,12px);box-shadow:var(--dsw-elevation-prominent,0 10px 40px #0005)}\n.lcx-media-dialog-fail{display:grid;place-items:center;min-width:min(320px,100%);min-height:160px;padding:24px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#5a6478);font-size:13px;line-height:20px}\n.lcx-media-dialog-bar{display:flex;align-items:center;gap:14px;max-width:100%;padding:6px 16px;border-radius:999px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 0 0 .5px var(--dsw-alias-border-l3,#0000001f);font-size:12px;line-height:20px}\n.lcx-media-dialog-caption{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary,#5a6478)}\n.lcx-media-dialog-bar a{flex:none;color:var(--dsw-alias-link,#416de0);text-decoration:none}\n.lcx-media-dialog-bar a:hover{text-decoration:underline;text-underline-offset:3px}\n.lcx-media-close{position:fixed;top:20px;right:20px;z-index:1;display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 0 0 .5px var(--dsw-alias-border-l3,#0000001f);color:var(--dsw-alias-label-primary,#1f2430);cursor:pointer}\n@media(max-width:520px){.lcx-media-rail{--lcx-h:112px}.lcx-media-rail[data-count=\"1\"]{--lcx-h:184px}.lcx-media-rail[data-count=\"2\"]{--lcx-h:136px}.lcx-media-dialog{padding:16px}.lcx-media-close{top:12px;right:12px}}\n@media(hover:none){.lcx-media-chip{opacity:1;transform:none}.lcx-media-nav{display:none}}\n@media(prefers-reduced-motion:reduce){.lcx-media-track{scroll-behavior:auto}.lcx-media-tile[data-state=\"loading\"]{animation:none}.lcx-media-open img,.lcx-media-chip,.lcx-media-nav,.lcx-media-video,.lcx-media-play{transition:none}.lcx-media-tile[data-state=\"loaded\"]:hover .lcx-media-open img{transform:none}}\n";
/**
 * DSH 0.2 renders a Markdown image as `<p><button><img></button> …</p>` with the button
 * `inline-block; vertical-align:middle`, so any text or links after the image in the same
 * paragraph sit beside it. LCX only restyles that wrapper (PO decision, Issue #102): inside
 * assistant responses an image that is the button's only child always starts its own line.
 * Structural selector only (no hashed DSH class names); if DSH changes the DOM it simply stops matching.
 */
export declare const nativeMarkdownImageCss = "\n[data-chat-flow-kind=\"assistant-step\"] p>button:has(>img:only-child){display:block;width:fit-content;max-width:100%;margin:4px 0 8px}\n";
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
        labels: {
            dialog: string;
            close: string;
        };
        onClose: () => void;
    }) => (() => void) | null;
};
/** Natural aspect ratios are honoured within these bounds; extreme panoramas/strips are cropped to them. */
export declare const TILE_ASPECT_MIN = 0.5;
export declare const TILE_ASPECT_MAX = 2.2;
/** DSH chat DOM capability check; an unknown renderer fails closed. */
export declare function supportsInlineMediaDom(marker: HTMLElement): boolean;
/**
 * Own only inserted elements. Never replace React-owned text, links or children.
 * One `.lcx-media` block is appended to the owning response and removed on dispose.
 */
export declare function installInlineMedia(marker: HTMLElement, items: readonly SearchMediaItem[], labels: MediaLabels, host?: InlineMediaHost): () => void;
