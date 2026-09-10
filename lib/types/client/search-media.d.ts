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
/** Extract bounded remote media linked by visible assistant prose. */
export declare function extractSearchMedia(text: string): readonly SearchMediaItem[];
