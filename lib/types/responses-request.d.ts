/** @typedef {'none' | 'short' | 'long'} CacheRetention */
type UnknownRecord = Record<string, unknown>;
type CacheRetention = "none" | "short" | "long";
type ResponsesCompat = {
    supportsLongCacheRetention?: boolean;
    supportsExplicitPromptCacheMode?: boolean;
    supportsMaxOutputTokens?: boolean;
};
type PiResponsesModel = {
    id: string;
    provider: string;
    reasoning?: boolean;
    thinkingLevelMap?: Record<string, string | null>;
    compat?: ResponsesCompat;
};
type GenerationControls = {
    reasoningEffort?: unknown;
    temperature?: unknown;
    maxTokens?: unknown;
};
type BuildResponsesBodyOptions = GenerationControls & {
    model: PiResponsesModel | string;
    input: unknown[];
    tools?: unknown;
    sessionId?: string;
    promptCacheKey?: string;
    promptCacheRetention?: string;
    cacheRetention?: CacheRetention;
    samplingParams?: UnknownRecord;
};
type ResponsesWireBody = UnknownRecord & {
    model: string;
    input: unknown[];
    stream: boolean;
    store: boolean;
    tool_choice?: string;
    parallel_tool_calls?: boolean;
};
/**
 * Pi-parity generation controls for OpenAI Responses.
 * @param {GenerationControls & { model?: PiResponsesModel | string, includeDefaultReasoning?: boolean }} [controls]
 */
export declare function responsesGenerationEnvelope({ model, reasoningEffort, temperature, maxTokens, includeDefaultReasoning, }?: GenerationControls & {
    model?: PiResponsesModel | string;
    includeDefaultReasoning?: boolean;
}): UnknownRecord;
/**
 * Build the shared LCX-owned request envelope while retaining Pi 0.85.1 Responses semantics.
 * Production LCX ordinary/compact/replay construction places the DSH system prompt in canonical input.
 * @param {BuildResponsesBodyOptions} options
 */
export declare function buildResponsesBody({ model, input, tools, sessionId, promptCacheKey, promptCacheRetention, cacheRetention, reasoningEffort, temperature, maxTokens, samplingParams, }: BuildResponsesBodyOptions): ResponsesWireBody;
/**
 * Compact is the standard request plus the one opaque-history transition patch.
 * @param {BuildResponsesBodyOptions} options
 */
export declare function buildCompactionResponsesBody(options: BuildResponsesBodyOptions): ResponsesWireBody;
export {};
