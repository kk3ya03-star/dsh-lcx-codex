export type SearchMediaItem = {
    readonly kind: "image" | "video" | "page";
    readonly url: string;
    readonly poster?: string;
    readonly previewUrl?: string;
    readonly sourceUrl?: string;
    readonly caption?: string;
    readonly structured?: true;
};
export declare const SEARCH_MEDIA_LIMIT = 60;
export type StructuredMediaTool = "web_search" | "websearch_gpt_advanced";
/** Narrow LCX-owned tool-private media metadata without reading model-visible output. */
export declare function structuredSearchMedia(meta: unknown, expectedTool: StructuredMediaTool): readonly SearchMediaItem[];
export declare function mergeSearchMedia(structured: readonly SearchMediaItem[], fallback: readonly SearchMediaItem[]): readonly SearchMediaItem[];
/**
 * Extract bounded direct media links from visible assistant prose, in text order.
 *
 * Ownership (Issue #102): Markdown images are rendered by DSH itself, so their
 * destinations are never returned, and a bare link to an image DSH already renders
 * natively in the same text is skipped. Plain direct image links and direct video
 * files are LCX's; everything else (pages, video sites) stays an ordinary link.
 */
export declare function extractDirectMediaLinks(text: string): readonly SearchMediaItem[];
/** Direct video files only (see `extractDirectMediaLinks`). */
export declare function extractDirectVideoLinks(text: string): readonly SearchMediaItem[];
