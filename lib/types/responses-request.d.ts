type UnknownRecord = Record<string, unknown>;
type CacheRetention = "none" | "short" | "long";
type ResponsesCompat = {
    supportsLongCacheRetention?: boolean;
    supportsExplicitPromptCacheMode?: boolean;
    supportsMaxOutputTokens?: boolean;
    supportsMidConvoEffort?: boolean;
};
type PiResponsesModel = {
    id: string;
    provider: string;
    baseUrl?: string;
    reasoning?: boolean;
    thinkingLevelMap?: Record<string, string | null>;
    includeEncryptedReasoning?: boolean;
    compat?: ResponsesCompat;
};
type GenerationControls = {
    reasoningEffort?: unknown;
    temperature?: unknown;
    maxTokens?: unknown;
    /** Set when the effort is sent as `configuration_update` items (see `configurationUpdateEffort`). */
    configurationUpdateEffort?: string;
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
 * The effort Pi 1.3.0 sends as `configuration_update` input items instead of `reasoning.effort`, or undefined
 * to send it as `reasoning.effort` (Pi's `getConfigurationUpdateEffort`): only for a model whose compat states
 * `supportsMidConvoEffort`, only with a requested level, and never for a Sign in with ChatGPT key, which rejects
 * those items. The key is read only when that last rule can apply.
 */
export declare function configurationUpdateEffort(model: PiResponsesModel, reasoningEffort: unknown, apiKey: () => Promise<string>): Promise<string | undefined>;
/**
 * Pi-parity generation controls for OpenAI Responses.
 */
export declare function responsesGenerationEnvelope({ model, reasoningEffort, temperature, maxTokens, configurationUpdateEffort, includeDefaultReasoning, }?: GenerationControls & {
    model?: PiResponsesModel | string;
    includeDefaultReasoning?: boolean;
}): UnknownRecord;
/**
 * Build the shared LCX-owned request envelope while retaining Pi 0.86.0 Responses semantics.
 * Production LCX ordinary/compact/replay construction places the DSH system prompt in canonical input.
 */
export declare function buildResponsesBody({ model, input, tools, sessionId, promptCacheKey, promptCacheRetention, cacheRetention, reasoningEffort, temperature, maxTokens, configurationUpdateEffort, samplingParams, }: BuildResponsesBodyOptions): ResponsesWireBody;
/**
 * Compact is the standard request plus the one opaque-history transition patch.
 */
export declare function buildCompactionResponsesBody(options: BuildResponsesBodyOptions): ResponsesWireBody;
export {};
