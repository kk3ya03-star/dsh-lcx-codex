/** JSON-only accounting helpers shared by the host projection and client slots. */
export type Buckets = {
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
};
export type SearchUsage = {
    requestId: string;
    provider: string;
    model: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
    };
};
export declare const object: (v: unknown) => v is Record<string, any>;
export declare const zeroBuckets: () => Buckets;
export declare const isSearchTool: (name: unknown) => name is string;
export declare function auxiliaryUsageOf(event: unknown, toolName?: string): SearchUsage[];
export declare function addUsage(base: Buckets, records: readonly SearchUsage[]): Buckets;
export declare function mergeBuckets(base: unknown, extra: Buckets): unknown;
export declare function addTurnUsage(base: unknown, records: readonly SearchUsage[]): unknown;
/** The metadata is presentation/accounting state; it never changes request messages. */
export declare function aggregateContextOf(event: unknown): boolean | undefined;
