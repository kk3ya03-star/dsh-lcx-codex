import type { Context } from "@deepseek-ai/cordis";
import { type Session } from "@deepseek-ai/dsh-session";
import "@deepseek-ai/dsh-settings";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
type HeaderMap = Record<string, string>;
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
    /**
     * The profile declared `off: null`: selecting off is supported and sends no reasoning option. The map
     * then carries an explicit `off: null` so the request builder omits the parameter, and this flag keeps
     * the level selectable (a null map entry alone would mark it unsupported).
     */
    offOmitsReasoning?: boolean;
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
    catalogHeaders?: HeaderMap;
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
export declare function normalizeBaseURL(value: unknown): string;
export declare function baseURLFingerprint(baseURL: unknown): string;
export declare function routeFingerprint(route: Partial<RouteIdentity> | null | undefined, options?: {
    includeSession?: boolean;
}): string;
export declare function promptCacheSessionId(route: Partial<RouteIdentity> | null | undefined, config?: Partial<Pick<ResolvedResponsesRoute, "cacheRetention">>, ctx?: RouteContext | null | undefined): string | undefined;
export declare function promptCacheKey(route: Partial<RouteIdentity> | null | undefined, config?: Partial<Pick<ResolvedResponsesRoute, "cacheRetention">>, ctx?: RouteContext | null | undefined): string | undefined;
/** Grok follows Pi directly: cache/affinity belongs to the selected child session. */
export declare function grokPromptCacheSessionId(route: Partial<RouteIdentity> | null | undefined, config?: Partial<Pick<ResolvedResponsesRoute, "cacheRetention">>): string | undefined;
export declare function promptCacheRetention(config?: Partial<Pick<ResolvedResponsesRoute, "cacheRetention" | "supportsLongCacheRetention" | "responsesCompat">>): "24h" | undefined;
/**
 * Record that DSH resolves this exact provider/model under the provider's current profile.
 * @returns whether this changed what is remembered (a new model, or the profile changed since).
 */
export declare function markHostRecognizedModel(ctx: RouteContext | null | undefined, provider: unknown, modelId: unknown): boolean;
/**
 * Ask DSH, ahead of any request, which GPT / Grok models it serves on providers whose profile lists no
 * `models`, and remember the ones LCX's bundled catalog does not describe. One `listModels` call per such
 * provider: it returns exactly the models DSH would resolve. A model listed in a profile needs no lookup
 * (the list itself declares it) and a provider DSH does not serve is skipped.
 * @returns whether the remembered set changed, so the caller can resynchronise the tools it registers.
 */
export declare function warmHostRecognizedModels(ctx: RouteContext | null | undefined): Promise<boolean>;
/** Resolve only the selected DSH profile; policy cannot supply route identity or credentials. */
export declare function resolveResponsesRouteConfig(ctx: RouteContext | null | undefined, options: RouteOptions & {
    purpose?: string;
}, policy: RoutePolicy, assumeHostServes?: boolean): ResolvedResponsesRoute | undefined;
/** Why a GPT request could not be resolved to an authenticated Responses route. */
export type ResponsesRouteDiagnosis = "no-profile" | "model-not-configured" | "host-auth" | "api-unresolved" | "api-not-responses" | "incomplete";
/**
 * Name the reason `resolveResponsesRouteConfig` returned nothing, so the failure can tell the user what to
 * change: `api-unresolved` means neither the profile nor the model catalog names a protocol for this model.
 */
export declare function diagnoseResponsesRoute(ctx: RouteContext | null | undefined, options: RouteOptions): ResponsesRouteDiagnosis;
/** Resolve a Grok-prefixed model through its selected DSH Responses profile. */
export declare function resolveGrokResponsesRouteConfig(ctx: RouteContext | null | undefined, options: RouteOptions, policy: RoutePolicy): ResolvedResponsesRoute | undefined;
export declare function resolveApiKey(ctx: RouteContext | null | undefined, config: Pick<ResolvedResponsesRoute, "apiKeyEnv">): Promise<string>;
/**
 * The headers of one GPT request. `sessionId` is the prompt-cache / affinity session (the root session for a
 * subagent, absent without cache retention); `providerSessionId` is the CURRENT DSH session, which is what Pi's
 * client sends in provider routing headers (`x-opencode-session`) whatever the cache policy is.
 */
export declare function authenticatedHeaders(ctx: RouteContext | null | undefined, config: ResolvedResponsesRoute, sessionId: unknown, requestId: string | null | undefined, dynamicHeaders?: HeaderMap, providerSessionId?: string): Promise<HeaderMap>;
/** Grok mirrors Pi createClient ordering without changing accepted GPT headers. */
export declare function authenticatedGrokHeaders(ctx: RouteContext | null | undefined, config: ResolvedResponsesRoute, sessionId: unknown, dynamicHeaders?: HeaderMap, providerSessionId?: string): Promise<HeaderMap>;
export declare function currentRoute(options: RouteOptions | null | undefined, config: Pick<UnresolvedRouteConfig, "provider" | "model" | "baseURL">): RouteIdentity;
export declare function generationControlsFromHeader(header: RequestHeader | null | undefined, route: Partial<RouteIdentity> | null | undefined): GenerationControls;
export declare function generationControlsFromSession(session: RouteSession | null | undefined, route: Partial<RouteIdentity> | null | undefined): GenerationControls;
export declare function routeCompatible(record: CheckpointRouteRecord | null | undefined, route: RouteIdentity, ctx: unknown): boolean;
export {};
