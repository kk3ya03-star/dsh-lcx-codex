import type { Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import "@deepseek-ai/dsh-settings";
import { resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
type HeaderMap = Record<string, string>;
type RetryPolicyConfig = Parameters<typeof resolveRetryPolicy>[0];
type CacheRetention = "none" | "short" | "long";
type ResponsesCompat = {
    supportsDeveloperRole?: boolean;
    sessionAffinityFormat?: "openai" | "openai-nosession" | "openrouter";
    supportsStrictMode?: boolean;
    supportsLongCacheRetention?: boolean;
    supportsOpenAIGrammarTools?: boolean;
    supportsAdditionalTools?: boolean;
    supportsToolSearch?: boolean;
    supportsExplicitPromptCacheMode?: boolean;
    supportsMaxOutputTokens?: boolean;
};
type RouteIdentity = {
    provider: string;
    model: string;
    baseURL: string;
    sessionId: string;
};
type RouteOptions = {
    provider?: unknown;
    model?: unknown;
    sessionId?: unknown;
};
type ProviderModelProfile = {
    id?: unknown;
    compat?: unknown;
    reasoningEfforts?: unknown;
};
type ProviderProfile = {
    api?: string;
    baseURL?: string;
    apiKeyEnv?: string;
    headers?: HeaderMap;
    reasoning?: unknown;
    cacheRetention?: unknown;
    timeoutMs?: unknown;
    streamIdleTimeoutMs?: unknown;
    maxRequestImageBytes?: unknown;
    requestImagePixelBudget?: unknown;
    requestImageMaxBytes?: unknown;
    retryPolicy?: RetryPolicyConfig;
    compat?: unknown;
    models?: ProviderModelProfile[];
    modelOverrides?: Record<string, ProviderModelProfile>;
};
type LlmSettingsSection = {
    providers?: Record<string, ProviderProfile>;
};
type RequestHeaderConfig = {
    provider?: unknown;
    model?: unknown;
    reasoningEffort?: unknown;
    temperature?: unknown;
    maxTokens?: unknown;
};
type RequestHeader = {
    config?: RequestHeaderConfig;
};
type RouteSession = Pick<Session, "requestHeader">;
export type RouteContext = Pick<Context, "credentials" | "llm" | "logger" | "sessions" | "settings">;
type RoutePolicy = {
    cacheRetention?: unknown;
    supportsLongCacheRetention?: unknown;
    supportsExplicitPromptCacheMode?: unknown;
    responsesCompat?: unknown;
    timeoutMs?: number;
    maxAttempts?: number;
    maxRequestImageBytes?: number;
    requestImagePixelBudget?: number;
    requestImageMaxBytes?: number;
};
type PiResponsesModel = Model<"openai-responses">;
type ModelControlProjection = {
    reasoning?: boolean;
    thinkingLevelMap?: Partial<Record<ModelThinkingLevel, string | null>>;
    includeEncryptedReasoning?: boolean;
};
type ModelDescriptorDefaults = Partial<Pick<PiResponsesModel, "reasoning" | "thinkingLevelMap">>;
type UnresolvedRouteConfig = RoutePolicy & {
    provider: string;
    model: string;
    baseURL: string;
    apiKeyEnv: string;
    headers?: HeaderMap;
};
export type ResolvedResponsesRoute = UnresolvedRouteConfig & {
    api: "openai-responses";
    cacheRetention: CacheRetention;
    supportsLongCacheRetention: boolean;
    responsesCompat?: ResponsesCompat;
    modelControls?: ModelControlProjection;
    modelDefaults?: ModelDescriptorDefaults;
    profileReasoning?: ModelThinkingLevel;
    streamIdleTimeoutMs?: number;
};
type GenerationControls = {
    reasoningEffort?: unknown;
    temperature?: unknown;
    maxTokens?: unknown;
};
type CheckpointRouteRecord = {
    version: number;
    provider: unknown;
    model: unknown;
    baseURLFingerprint: unknown;
    sourceSessionId: unknown;
};
/** @param {unknown} value */
export declare function normalizeBaseURL(value: unknown): string;
/** @param {unknown} baseURL */
export declare function baseURLFingerprint(baseURL: unknown): string;
/** @param {Partial<RouteIdentity> | null | undefined} route @param {{ includeSession?: boolean }} [options] */
export declare function routeFingerprint(route: Partial<RouteIdentity> | null | undefined, options?: {
    includeSession?: boolean;
}): string;
/** @param {Partial<RouteIdentity> | null | undefined} route @param {Partial<Pick<ResolvedResponsesRoute, 'cacheRetention'>>} [config] @param {RouteContext | null | undefined} [ctx] */
export declare function promptCacheSessionId(route: Partial<RouteIdentity> | null | undefined, config?: Partial<Pick<ResolvedResponsesRoute, "cacheRetention">>, ctx?: RouteContext | null | undefined): string | undefined;
/** @param {Partial<RouteIdentity> | null | undefined} route @param {Partial<Pick<ResolvedResponsesRoute, 'cacheRetention'>>} [config] @param {RouteContext | null | undefined} [ctx] */
export declare function promptCacheKey(route: Partial<RouteIdentity> | null | undefined, config?: Partial<Pick<ResolvedResponsesRoute, "cacheRetention">>, ctx?: RouteContext | null | undefined): string | undefined;
/** Grok follows Pi directly: cache/affinity belongs to the selected child session. */
export declare function grokPromptCacheSessionId(route: Partial<RouteIdentity> | null | undefined, config?: Partial<Pick<ResolvedResponsesRoute, "cacheRetention">>): string | undefined;
/** @param {Partial<Pick<ResolvedResponsesRoute, 'cacheRetention' | 'supportsLongCacheRetention' | 'responsesCompat'>>} [config] */
export declare function promptCacheRetention(config?: Partial<Pick<ResolvedResponsesRoute, "cacheRetention" | "supportsLongCacheRetention" | "responsesCompat">>): "24h" | undefined;
/** @param {RouteContext | null | undefined} ctx @param {string} namespace */
export declare function settingsValue(ctx: RouteContext | null | undefined, namespace: string): LlmSettingsSection | undefined;
/** Resolve only the selected DSH profile; policy cannot supply route identity or credentials. */
export declare function resolveResponsesRouteConfig(ctx: RouteContext | null | undefined, options: RouteOptions & {
    purpose?: string;
}, policy: RoutePolicy): ResolvedResponsesRoute | undefined;
/** Resolve a Grok-prefixed model through its selected DSH Responses profile. */
export declare function resolveGrokResponsesRouteConfig(ctx: RouteContext | null | undefined, options: RouteOptions, policy: RoutePolicy): ResolvedResponsesRoute | undefined;
/** @param {RouteContext | null | undefined} ctx @param {Pick<ResolvedResponsesRoute, 'apiKeyEnv'>} config */
export declare function resolveApiKey(ctx: RouteContext | null | undefined, config: Pick<ResolvedResponsesRoute, "apiKeyEnv">): Promise<string>;
/** @param {RouteContext | null | undefined} ctx @param {ResolvedResponsesRoute} config @param {unknown} sessionId @param {string | null | undefined} requestId @returns {Promise<HeaderMap>} */
export declare function authenticatedHeaders(ctx: RouteContext | null | undefined, config: ResolvedResponsesRoute, sessionId: unknown, requestId: string | null | undefined): Promise<HeaderMap>;
/** Grok mirrors Pi createClient ordering without changing accepted GPT headers. */
export declare function authenticatedGrokHeaders(ctx: RouteContext | null | undefined, config: ResolvedResponsesRoute, sessionId: unknown): Promise<HeaderMap>;
/** @param {RouteOptions | null | undefined} options @param {Pick<UnresolvedRouteConfig, 'provider' | 'model' | 'baseURL'>} config @returns {RouteIdentity} */
export declare function currentRoute(options: RouteOptions | null | undefined, config: Pick<UnresolvedRouteConfig, "provider" | "model" | "baseURL">): RouteIdentity;
/** @param {RequestHeader | null | undefined} header @param {Partial<RouteIdentity> | null | undefined} route @returns {GenerationControls} */
export declare function generationControlsFromHeader(header: RequestHeader | null | undefined, route: Partial<RouteIdentity> | null | undefined): GenerationControls;
/** @param {RouteSession | null | undefined} session @param {Partial<RouteIdentity> | null | undefined} route @returns {GenerationControls} */
export declare function generationControlsFromSession(session: RouteSession | null | undefined, route: Partial<RouteIdentity> | null | undefined): GenerationControls;
/** @param {CheckpointRouteRecord | null | undefined} record @param {RouteIdentity} route @param {unknown} ctx */
export declare function routeCompatible(record: CheckpointRouteRecord | null | undefined, route: RouteIdentity, ctx: unknown): boolean;
export {};
