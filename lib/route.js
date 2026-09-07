import { createHash, randomUUID } from "node:crypto";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { SessionId } from "@deepseek-ai/dsh-session";
import "@deepseek-ai/dsh-settings";
import { attributionHeaders, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { getBuiltinModels, getBuiltinProviders, } from "@earendil-works/pi-ai/providers/all";
/** @param {unknown} value */
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** @param {unknown} value */
function isPositiveInteger(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function asLlmSettingsSection(value) {
    if (!isRecord(value))
        return undefined;
    const providers = value.providers;
    if (providers === undefined)
        return {};
    if (!isRecord(providers))
        return undefined;
    return { providers: providers };
}
/** @param {unknown} value */
export function normalizeBaseURL(value) {
    return String(value ?? "").trim().replace(/\/+$/u, "");
}
/** @param {unknown} baseURL */
export function baseURLFingerprint(baseURL) {
    return createHash("sha256").update(normalizeBaseURL(baseURL), "utf8").digest("hex");
}
/** @param {Partial<RouteIdentity> | null | undefined} route @param {{ includeSession?: boolean }} [options] */
export function routeFingerprint(route, options = {}) {
    const includeSession = options.includeSession !== false;
    return createHash("sha256").update([
        route?.provider ?? "", route?.model ?? "", normalizeBaseURL(route?.baseURL), includeSession ? (route?.sessionId ?? "") : "",
    ].join("\u001f"), "utf8").digest("hex");
}
/** @param {unknown} value */
function clampPromptCacheKey(value) {
    if (value === undefined)
        return undefined;
    const chars = Array.from(String(value));
    return chars.length <= 64 ? String(value) : chars.slice(0, 64).join("");
}
/** @param {Partial<RouteIdentity> | null | undefined} route @param {Partial<Pick<ResolvedResponsesRoute, 'cacheRetention'>>} [config] @param {RouteContext | null | undefined} [ctx] */
export function promptCacheSessionId(route, config = {}, ctx = undefined) {
    if (config.cacheRetention === "none")
        return undefined;
    const sessionId = route?.sessionId ? String(route.sessionId) : undefined;
    if (!sessionId)
        return undefined;
    const sessions = ctx?.sessions;
    let current = sessions?.get(SessionId(sessionId));
    if (current?.header?.origin !== "subagent")
        return sessionId;
    const seen = new Set([sessionId]);
    while (current?.header?.origin === "subagent" && current.header.parentSession) {
        const parentId = current.header.parentSession;
        if (seen.has(parentId))
            return sessionId;
        const parent = sessions?.get(SessionId(parentId));
        if (!parent)
            return sessionId;
        seen.add(parentId);
        current = parent;
    }
    return current?.id ?? sessionId;
}
/** @param {Partial<RouteIdentity> | null | undefined} route @param {Partial<Pick<ResolvedResponsesRoute, 'cacheRetention'>>} [config] @param {RouteContext | null | undefined} [ctx] */
export function promptCacheKey(route, config = {}, ctx = undefined) {
    return clampPromptCacheKey(promptCacheSessionId(route, config, ctx));
}
/** @param {Partial<Pick<ResolvedResponsesRoute, 'cacheRetention' | 'supportsLongCacheRetention' | 'responsesCompat'>>} [config] */
export function promptCacheRetention(config = {}) {
    return config.cacheRetention === "long" && config.supportsLongCacheRetention === true && config.responsesCompat?.supportsExplicitPromptCacheMode !== true ? "24h" : undefined;
}
/** @param {RetryPolicyConfig | null | undefined} policy @param {number} [fallback] */
function retryAttempts(policy, fallback = 3) {
    if (!policy)
        return fallback;
    try {
        const resolved = resolveRetryPolicy(policy, "llm-pi-ai provider retryPolicy");
        if (resolved.mode === "normal" && isPositiveInteger(resolved.maxRetries))
            return Math.min(resolved.maxRetries + 1, 6);
    }
    catch { }
    return fallback;
}
/** @param {RouteContext | null | undefined} ctx @param {string} namespace */
export function settingsValue(ctx, namespace) {
    return asLlmSettingsSection(ctx?.settings?.get(namespace));
}
/** @type {Set<keyof ResponsesCompat>} */
const RESPONSES_COMPAT_FIELDS = new Set(["supportsDeveloperRole", "sessionAffinityFormat", "supportsStrictMode", "supportsLongCacheRetention", "supportsOpenAIGrammarTools", "supportsAdditionalTools", "supportsToolSearch", "supportsExplicitPromptCacheMode", "supportsMaxOutputTokens"]);
/** @param {ResponsesCompat} target @param {unknown} source */
function copyResponsesCompat(target, source) {
    if (!isRecord(source))
        return;
    for (const field of RESPONSES_COMPAT_FIELDS) {
        const value = source[field];
        if (field === "sessionAffinityFormat") {
            if (value === "openai" || value === "openai-nosession" || value === "openrouter")
                target.sessionAffinityFormat = value;
        }
        else if (typeof value === "boolean")
            Object.assign(target, { [field]: value });
    }
}
/** @param {unknown} provider @param {unknown} modelId */
function builtinResponsesModel(provider, modelId) {
    const providerName = String(provider ?? "");
    const builtinProvider = getBuiltinProviders().find((candidate) => candidate === providerName);
    if (builtinProvider === undefined)
        return undefined;
    return getBuiltinModels(builtinProvider).find((model) => model.id === String(modelId ?? "") && model.api === "openai-responses");
}
/** @param {ProviderProfile | null | undefined} profile @param {unknown} modelId @returns {ResponsesCompat | undefined} */
function configuredResponsesCompat(profile, modelId) {
    const compat = {};
    copyResponsesCompat(compat, profile?.compat);
    const configuredModels = Array.isArray(profile?.models) ? profile.models : [];
    const modelEntry = configuredModels.length > 0
        ? configuredModels.find((entry) => String(entry?.id ?? "") === String(modelId))
        : profile?.modelOverrides?.[String(modelId)];
    copyResponsesCompat(compat, modelEntry?.compat);
    return Object.keys(compat).length ? compat : undefined;
}
function isLcxCapabilityRoute(provider, model) {
    return provider === "lcx" &&
        /^gpt-5\.6-(?:sol|luna|terra)$/iu.test(model);
}
/** Resolve only the selected DSH profile; policy cannot supply route identity or credentials. */
export function resolveResponsesRouteConfig(ctx, options, policy) {
    const provider = String(options?.provider ?? "");
    const model = String(options?.model ?? "");
    if (!provider.trim() || !/^gpt-/iu.test(model))
        return undefined;
    const section = settingsValue(ctx, "llm-pi-ai");
    const profile = section?.providers?.[provider];
    const lcxCapabilityRoute = isLcxCapabilityRoute(provider, model);
    if (!isRecord(profile))
        return undefined;
    const configured = profile;
    const builtin = builtinResponsesModel(provider, model);
    const api = configured.api ?? builtin?.api;
    if (api !== "openai-responses")
        return undefined;
    const baseURL = configured.baseURL ?? builtin?.baseUrl;
    const apiKeyEnv = configured.apiKeyEnv;
    if (typeof baseURL !== "string" || !normalizeBaseURL(baseURL) || typeof apiKeyEnv !== "string" || !apiKeyEnv.trim())
        return undefined;
    const responsesCompat = {};
    copyResponsesCompat(responsesCompat, builtin?.compat);
    copyResponsesCompat(responsesCompat, lcxCapabilityRoute ? policy.responsesCompat : undefined);
    copyResponsesCompat(responsesCompat, configuredResponsesCompat(configured, model));
    const promptCacheModel = lcxCapabilityRoute && policy.supportsExplicitPromptCacheMode === true ? builtinResponsesModel("openai", model) : undefined;
    const promptCacheRaw = promptCacheModel;
    const promptCacheCompat = isRecord(promptCacheRaw)
        ? promptCacheRaw.compat
        : undefined;
    if (isRecord(promptCacheCompat) &&
        promptCacheCompat.supportsExplicitPromptCacheMode === true &&
        responsesCompat.supportsExplicitPromptCacheMode === undefined)
        responsesCompat.supportsExplicitPromptCacheMode = true;
    const resolvedCompat = Object.keys(responsesCompat).length ? responsesCompat : undefined;
    const supportsLongCacheRetention = resolvedCompat?.supportsLongCacheRetention ?? (lcxCapabilityRoute && policy.supportsLongCacheRetention === true);
    responsesCompat.supportsLongCacheRetention = supportsLongCacheRetention;
    const configuredRetention = configured.cacheRetention;
    const fallbackRetention = lcxCapabilityRoute ? policy.cacheRetention : undefined;
    const requestedRetention = configuredRetention === "none" || configuredRetention === "short" || configuredRetention === "long" ? configuredRetention : fallbackRetention === "none" || fallbackRetention === "short" || fallbackRetention === "long" ? fallbackRetention : undefined;
    const cacheRetention = requestedRetention === "long" && !supportsLongCacheRetention ? "short" : requestedRetention ?? (supportsLongCacheRetention ? "long" : "short");
    return {
        provider,
        model,
        api: "openai-responses",
        baseURL: normalizeBaseURL(baseURL),
        apiKeyEnv,
        headers: { ...(configured.headers ?? {}) },
        cacheRetention,
        supportsLongCacheRetention,
        responsesCompat,
        // These are explicitly LCX-owned transport and request-capability policies.
        timeoutMs: isPositiveInteger(configured.timeoutMs) ? configured.timeoutMs : policy.timeoutMs,
        maxAttempts: retryAttempts(configured.retryPolicy, policy.maxAttempts),
        maxRequestImageBytes: isPositiveInteger(configured.maxRequestImageBytes) ? configured.maxRequestImageBytes : policy.maxRequestImageBytes,
        requestImagePixelBudget: isPositiveInteger(configured.requestImagePixelBudget) ? configured.requestImagePixelBudget : policy.requestImagePixelBudget,
        requestImageMaxBytes: isPositiveInteger(configured.requestImageMaxBytes) ? configured.requestImageMaxBytes : policy.requestImageMaxBytes,
    };
}
/** @param {RouteContext | null | undefined} ctx @param {Pick<ResolvedResponsesRoute, 'apiKeyEnv'>} config */
export async function resolveApiKey(ctx, config) {
    const resolved = await ctx?.credentials.resolve(credentialRef(config.apiKeyEnv));
    if (resolved?.value.trim())
        return resolved.value.trim();
    const ambient = String(process.env[config.apiKeyEnv] ?? "").trim();
    if (ambient)
        return ambient;
    const error = new Error(`DSH provider credential is unavailable: ${config.apiKeyEnv}`);
    error.code = "LCX_CREDENTIAL_UNAVAILABLE";
    throw error;
}
/** @param {HeaderMap | null | undefined} headers @param {string} name */
function hasHeader(headers, name) { return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === name.toLowerCase()); }
/** @param {HeaderMap | null | undefined} headers */
function hasExplicitSessionAffinity(headers) { return ["session-id", "session_id", "x-session-id"].some((name) => hasHeader(headers, name)); }
/** @param {Partial<ResolvedResponsesRoute> | null | undefined} config */
function sessionAffinityFormat(config) {
    if (config?.api && config.api !== "openai-responses")
        return "none";
    const explicit = config?.responsesCompat?.sessionAffinityFormat;
    if (explicit === "openai" || explicit === "openai-nosession" || explicit === "openrouter")
        return explicit;
    return String(config?.provider ?? "").toLowerCase() === "openrouter" ||
        String(config?.baseURL ?? "").toLowerCase().includes("openrouter.ai")
        ? "openrouter"
        : "openai";
}
/** @param {RouteContext | null | undefined} ctx @param {ResolvedResponsesRoute} config @param {unknown} sessionId @param {string | null | undefined} requestId @returns {Promise<HeaderMap>} */
export async function authenticatedHeaders(ctx, config, sessionId, requestId) {
    const explicit = { ...(config.headers ?? {}) };
    const headers = {
        ...attributionHeaders(),
        authorization: `Bearer ${await resolveApiKey(ctx, config)}`,
    };
    const sid = sessionId ? String(sessionId) : undefined;
    const format = sessionAffinityFormat(config);
    if (sid && !hasExplicitSessionAffinity(explicit)) {
        if (format === "openai")
            headers.session_id = sid;
        else if (format === "openrouter")
            headers["x-session-id"] = sid;
    }
    if (requestId !== null && !hasHeader(explicit, "x-client-request-id")) {
        const correlation = requestId ?? (sid && (format === "openai" || format === "openai-nosession") ? sid : !sid ? randomUUID() : undefined);
        if (correlation)
            headers["x-client-request-id"] = correlation;
    }
    return { ...headers, ...explicit };
}
/** @param {RouteOptions | null | undefined} options @param {Pick<UnresolvedRouteConfig, 'provider' | 'model' | 'baseURL'>} config @returns {RouteIdentity} */
export function currentRoute(options, config) {
    return { provider: String(options?.provider ?? config.provider ?? ""), model: String(options?.model ?? config.model ?? ""), baseURL: normalizeBaseURL(config.baseURL), sessionId: String(options?.sessionId ?? "") };
}
/** @param {RequestHeader | null | undefined} header @param {Partial<RouteIdentity> | null | undefined} route @returns {GenerationControls} */
export function generationControlsFromHeader(header, route) {
    const config = header?.config;
    if (!config || String(config.provider ?? "") !== String(route?.provider ?? "") || String(config.model ?? "") !== String(route?.model ?? ""))
        return {};
    const controls = {};
    if (config.reasoningEffort !== undefined)
        controls.reasoningEffort = config.reasoningEffort;
    if (config.temperature !== undefined)
        controls.temperature = config.temperature;
    if (config.maxTokens !== undefined)
        controls.maxTokens = config.maxTokens;
    return controls;
}
/** @param {RouteSession | null | undefined} session @param {Partial<RouteIdentity> | null | undefined} route @returns {GenerationControls} */
export function generationControlsFromSession(session, route) {
    try {
        return generationControlsFromHeader(session?.requestHeader?.(), route);
    }
    catch {
        return {};
    }
}
/** @param {CheckpointRouteRecord | null | undefined} record @param {RouteIdentity} route @param {unknown} ctx */
export function routeCompatible(record, route, ctx) {
    void ctx;
    return !!record && record.version === 5 && record.provider === route.provider && record.model === route.model && record.baseURLFingerprint === baseURLFingerprint(route.baseURL) && record.sourceSessionId === route.sessionId;
}
