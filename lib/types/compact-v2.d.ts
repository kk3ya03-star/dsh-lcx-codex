import { buildCompactionResponsesBody } from "./responses-request.js";
type HeaderMap = Record<string, string>;
type CompactionItem = {
    type: "compaction";
    encrypted_content: string;
};
type FunctionCallItem = {
    type: "function_call";
    call_id: string;
};
type FunctionCallOutputItem = {
    type: "function_call_output";
    call_id: string;
};
type ValidatedOutputItem = CompactionItem | FunctionCallItem | FunctionCallOutputItem | {
    type: string;
};
type CanonicalUsage = {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
};
type GenerationControls = {
    reasoningEffort?: unknown;
    temperature?: unknown;
    maxTokens?: unknown;
};
type GenerationEnvelope = {
    reasoning?: {
        effort: string;
        summary: "auto";
    };
    include?: string[];
    temperature?: number;
    max_output_tokens?: number;
};
type NativeCompactionBodyOptions = GenerationControls & {
    model: string;
    modelDescriptor?: Exclude<Parameters<typeof buildCompactionResponsesBody>[0]["model"], string>;
    input: unknown[];
    tools?: unknown;
    promptCacheKey?: string;
    promptCacheRetention?: string;
    cacheRetention?: "none" | "short" | "long";
};
type NativeCompactionRequestOptions = NativeCompactionBodyOptions & {
    baseURL: string;
    idempotencyKey?: string;
    headers?: HeaderMap;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxAttempts?: number;
    maxResponseBytes?: number;
};
type SseParseOptions = {
    signal?: AbortSignal;
    maxResponseBytes?: number;
};
type NativeCompactionResult = {
    object: unknown;
    id?: string;
    output: ValidatedOutputItem[];
    compaction: CompactionItem;
    usage?: CanonicalUsage;
};
export declare const REMOTE_COMPACTION_V2_FEATURE = "remote_compaction_v2";
/**
 * @param {HeaderMap} [headers]
 * @returns {HeaderMap}
 */
export declare function mergeFeatureHeader(headers?: HeaderMap): HeaderMap;
/**
 * @param {GenerationControls} [controls]
 * @returns {GenerationEnvelope}
 */
export declare function responsesGenerationEnvelope(controls?: GenerationControls): GenerationEnvelope;
/**
 * @param {NativeCompactionBodyOptions} options
 * @returns {NativeCompactionBody}
 */
export declare function buildNativeCompactionBody({ model, modelDescriptor, input, tools, promptCacheKey, promptCacheRetention, cacheRetention, reasoningEffort, temperature, maxTokens, }: NativeCompactionBodyOptions): {
    [x: string]: unknown;
} & {
    model: string;
    input: unknown[];
    stream: boolean;
    store: boolean;
    tool_choice?: string;
    parallel_tool_calls?: boolean;
};
/**
 * Provider SSE events enter as unknown; response.completed remains authoritative.
 * @param {Response} response
 * @param {SseParseOptions} [options]
 * @returns {Promise<NativeCompactionResult>}
 */
export declare function parseNativeCompactionSse(response: Response, options?: SseParseOptions): Promise<NativeCompactionResult>;
/**
 * @param {NativeCompactionRequestOptions} options
 */
export declare function requestNativeCompaction({ baseURL, model, modelDescriptor, input, tools, promptCacheKey, promptCacheRetention, cacheRetention, reasoningEffort, temperature, maxTokens, idempotencyKey, headers, signal, timeoutMs, maxAttempts, maxResponseBytes, }: NativeCompactionRequestOptions): Promise<NativeCompactionResult>;
export {};
