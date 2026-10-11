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
export type ProviderContextDetails = {
    input_tokens: number;
    output_tokens: number;
};
/** Copy only complete, safe counters; provider extensions never enter durable metadata. */
export declare function sanitizeContextDetails(value: unknown): ProviderContextDetails | undefined;
export declare const zeroBuckets: () => Buckets;
export declare const isSearchTool: (name: unknown) => name is string;
/** DSH 0.2.1 settles a tool called from inside programmatic tool calling (`run_code`) with this event, not `tool/result`. */
export declare const NESTED_SETTLE_EVENT = "tool/ptc-dispatch";
/**
 * A search call's settlement and its tool-owned presentation `meta`, from either event that carries one: a
 * model-direct call settles as `tool/result` (its name comes from the earlier `tool/call`); a nested call settles
 * as `tool/ptc-dispatch`, whose `name`, `subCallId` and `meta` are its own fields.
 */
export declare function searchSettlementOf(event: unknown, pendingName?: string): {
    name: string;
    meta: Record<string, any>;
} | undefined;
export declare function auxiliaryUsageOf(event: unknown, toolName?: string): SearchUsage[];
export declare function addUsage(base: Buckets, records: readonly SearchUsage[]): Buckets;
export declare function mergeBuckets(base: unknown, extra: Buckets): unknown;
export declare function addTurnUsage(base: unknown, records: readonly SearchUsage[]): unknown;
/** The metadata is presentation/accounting state; it never changes request messages. */
export declare function aggregateContextOf(event: unknown): boolean | undefined;
export declare function providerContextOf(event: unknown): ProviderContextDetails | undefined;
