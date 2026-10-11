import { createHash, randomUUID } from "node:crypto";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { SessionId } from "@deepseek-ai/dsh-session";
import "@deepseek-ai/dsh-settings";
import { assertUsableApiKey, attributionHeaders, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { resolveCatalogModel } from "./model-catalog.js";
import { clampOpenAIPromptCacheKey } from "./pi-responses-runtime.js";
import { providerSessionHeaders } from "./provider-headers.js";
import { codedError, isPositiveFinite, isPositiveSafeInteger, isRecord } from "./util.js";
import { DEFAULTS } from "./defaults.js";
export function normalizeBaseURL(value) {
    return String(value ?? "").trim().replace(/\/+$/u, "");
}
export function baseURLFingerprint(baseURL) {
    return createHash("sha256").update(normalizeBaseURL(baseURL), "utf8").digest("hex");
}
export function routeFingerprint(route, options = {}) {
    const includeSession = options.includeSession !== false;
    return createHash("sha256").update([
        route?.provider ?? "", route?.model ?? "", normalizeBaseURL(route?.baseURL), includeSession ? (route?.sessionId ?? "") : "",
    ].join("\u001f"), "utf8").digest("hex");
}
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
export function promptCacheKey(route, config = {}, ctx = undefined) {
    return clampOpenAIPromptCacheKey(promptCacheSessionId(route, config, ctx));
}
/** Grok follows Pi directly: cache/affinity belongs to the selected child session. */
export function grokPromptCacheSessionId(route, config = {}) {
    if (config.cacheRetention === "none")
        return undefined;
    const sessionId = String(route?.sessionId ?? "");
    return sessionId || undefined;
}
export function promptCacheRetention(config = {}) {
    return config.cacheRetention === "long" && config.supportsLongCacheRetention === true && config.responsesCompat?.supportsExplicitPromptCacheMode !== true ? "24h" : undefined;
}
function retryAttempts(policy, fallback = DEFAULTS.maxAttempts) {
    if (!policy)
        return fallback;
    try {
        const resolved = resolveRetryPolicy(policy, "llm-pi-ai provider retryPolicy");
        if (resolved.mode === "normal" && isPositiveSafeInteger(resolved.maxRetries))
            return Math.min(resolved.maxRetries + 1, DEFAULTS.maxAttemptsCap);
    }
    catch { }
    return fallback;
}
/** Follow the live directory entry to its SettingsForms profile. */
function configuredProviderProfile(ctx, provider) {
    // Only llm-pi-ai profiles: other provider plugins' profiles are not LCX routes (Decision 8).
    try {
        const entry = ctx?.llm.listConfigurableProviders().find((candidate) => candidate.provider === provider && candidate.settingsNs === "llm-pi-ai");
        if (!entry || (typeof entry.error === "string" && entry.error.trim()))
            return undefined;
        const descriptor = ctx?.settings.describe().find((candidate) => candidate.ns === entry.settingsNs);
        let value = descriptor?.value;
        for (const segment of entry.settingsPath) {
            if (!isRecord(value))
                return undefined;
            value = value[segment];
        }
        return isRecord(value) ? value : undefined;
    }
    catch {
        return undefined;
    }
}
const RESPONSES_COMPAT_FIELDS = new Set(["supportsDeveloperRole", "sessionAffinityFormat", "supportsStrictMode", "supportsLongCacheRetention", "supportsOpenAIGrammarTools", "supportsAdditionalTools", "supportsToolSearch", "supportsExplicitPromptCacheMode", "supportsMaxOutputTokens"]);
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
function modelDescriptorDefaults(model) {
    if (!model)
        return undefined;
    return {
        reasoning: model.reasoning,
        thinkingLevelMap: model.thinkingLevelMap,
    };
}
/**
 * Models DSH itself resolved (`llm.resolveModelInfo` succeeded), remembered per plugin context together with a
 * fingerprint of the provider profile they were observed under. The route resolvers are synchronous, so the
 * stream handler asks DSH once for a route it cannot resolve and records the answer here; later resolutions of
 * the same model under the same profile need no further lookup. A live profile change alters the fingerprint,
 * which drops the answer and lets a fresh lookup decide again.
 */
const hostRecognizedModels = new WeakMap();
function recognitionKey(provider, modelId) {
    return `${String(provider)}\u001f${String(modelId)}`;
}
/** What decides whether DSH serves a model of this provider: the endpoint, the protocol and the served model ids. */
function profileFingerprint(profile) {
    const ids = (list) => Array.isArray(list) ? list.map((entry) => String(entry?.id ?? "")) : [];
    return JSON.stringify([
        profile?.api ?? null,
        profile?.baseURL ?? null,
        ids(profile?.models),
        Object.keys(profile?.modelOverrides ?? {}).sort(),
    ]);
}
/**
 * Record that DSH resolves this exact provider/model under the provider's current profile.
 * @returns whether this changed what is remembered (a new model, or the profile changed since).
 */
export function markHostRecognizedModel(ctx, provider, modelId) {
    const owner = ctx;
    if (owner === null || typeof owner !== "object")
        return false;
    let known = hostRecognizedModels.get(owner);
    if (known === undefined)
        hostRecognizedModels.set(owner, known = new Map());
    if (known.size >= 256)
        known.clear();
    const key = recognitionKey(provider, modelId);
    const fingerprint = profileFingerprint(configuredProviderProfile(ctx, String(provider)));
    const changed = known.get(key) !== fingerprint;
    known.set(key, fingerprint);
    return changed;
}
/**
 * Ask DSH, ahead of any request, which GPT / Grok models it serves on providers whose profile lists no
 * `models`, and remember the ones LCX's bundled catalog does not describe. One `listModels` call per such
 * provider: it returns exactly the models DSH would resolve. A model listed in a profile needs no lookup
 * (the list itself declares it) and a provider DSH does not serve is skipped.
 * @returns whether the remembered set changed, so the caller can resynchronise the tools it registers.
 */
export async function warmHostRecognizedModels(ctx) {
    let entries;
    try {
        entries = ctx?.llm.listConfigurableProviders() ?? [];
    }
    catch {
        return false;
    }
    let changed = false;
    for (const entry of entries) {
        if (entry.settingsNs !== "llm-pi-ai" || (typeof entry.error === "string" && entry.error.trim()))
            continue;
        const profile = configuredProviderProfile(ctx, entry.provider);
        if (!isRecord(profile) || (Array.isArray(profile.models) && profile.models.length > 0))
            continue;
        let models;
        try {
            models = (await ctx?.llm.listModels(entry.provider)) ?? [];
        }
        catch {
            continue;
        }
        for (const model of models) {
            if (!/^(?:gpt-|grok)/iu.test(model.id))
                continue;
            if (resolveCatalogModel(entry.provider, model.id).source === "catalog-model")
                continue;
            if (markHostRecognizedModel(ctx, entry.provider, model.id))
                changed = true;
        }
    }
    return changed;
}
function hostRecognizesModel(ctx, profile, provider, modelId) {
    const owner = ctx;
    if (owner === null || typeof owner !== "object")
        return false;
    return hostRecognizedModels.get(owner)?.get(recognitionKey(provider, modelId)) === profileFingerprint(profile);
}
/**
 * Providers whose authentication Pi resolves itself and LCX cannot reproduce from one credential reference:
 * Cloudflare AI Gateway needs the account and gateway ids in the endpoint and sends the key as
 * `cf-aig-authorization` while removing `Authorization`. DSH serves them, LCX leaves them to DSH.
 */
const HOST_AUTH_PROVIDERS = new Set(["cloudflare-ai-gateway"]);
function usesHostProviderAuth(provider) {
    return HOST_AUTH_PROVIDERS.has(String(provider));
}
/**
 * A nonempty `models` list replaces the served catalog: DSH serves exactly the listed models, and LCX answers
 * `llm/stream` before DSH's adapter does, so a claim here would send a request DSH itself refuses.
 */
function profileExcludesModel(profile, modelId) {
    return Array.isArray(profile?.models) && profile.models.length > 0 &&
        !profile.models.some((entry) => String(entry?.id ?? "") === String(modelId));
}
/**
 * DSH serves a model its catalog does not describe only when the profile lists it in `models`, or, for a profile
 * with no `models` list, when its own (newer) catalog describes it; the latter is visible to a plugin only as a
 * successful `resolveModelInfo`. A nonempty `models` list is authoritative: DSH serves exactly the listed models,
 * so a remembered recognition never widens it.
 */
function dshServesModel(ctx, profile, provider, modelId) {
    if (Array.isArray(profile?.models) && profile.models.length > 0)
        return profile.models.some((entry) => String(entry?.id ?? "") === String(modelId));
    return hostRecognizesModel(ctx, profile, provider, modelId);
}
function configuredModelProfile(profile, modelId) {
    const configuredModels = Array.isArray(profile?.models) ? profile.models : [];
    return configuredModels.length > 0
        ? configuredModels.find((entry) => String(entry?.id ?? "") === String(modelId))
        : profile?.modelOverrides?.[String(modelId)];
}
function configuredResponsesCompat(profile, modelId) {
    const compat = {};
    copyResponsesCompat(compat, profile?.compat);
    copyResponsesCompat(compat, configuredModelProfile(profile, modelId)?.compat);
    return Object.keys(compat).length ? compat : undefined;
}
const MODEL_THINKING_LEVELS = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
];
function profileReasoning(value) {
    return MODEL_THINKING_LEVELS.find((level) => level === value);
}
/**
 * The reasoning projection of a model whose profile entry declares `reasoningEfforts` (the mapping
 * from DSH levels to wire spellings, or `false` for a non-reasoning model); undefined when the
 * profile says nothing, so the caller falls back to the catalog or to what DSH resolved.
 */
function declaredReasoningControls(profile, modelId) {
    const efforts = configuredModelProfile(profile, modelId)?.reasoningEfforts;
    if (efforts === undefined)
        return undefined;
    if (efforts === false)
        return { reasoning: false };
    if (!isRecord(efforts))
        return { reasoning: false };
    const thinkingLevelMap = {};
    let offOmitsReasoning = false;
    for (const level of MODEL_THINKING_LEVELS) {
        const value = efforts[level];
        if (value === undefined)
            thinkingLevelMap[level] = null;
        else if (value === null) {
            // DSH permits only off:null: it means supported-off by omitting the wire option. Pi 1.1.0 would
            // read an absent `off` as "send none", so the omission is made explicit here.
            thinkingLevelMap[level] = null;
            if (level === "off")
                offOmitsReasoning = true;
        }
        else if (typeof value === "string")
            thinkingLevelMap[level] = value;
    }
    return {
        reasoning: true,
        thinkingLevelMap,
        ...(offOmitsReasoning ? { offOmitsReasoning: true } : {}),
    };
}
function configuredModelControls(profile, modelId, base) {
    return (declaredReasoningControls(profile, modelId) ?? {
        reasoning: base?.reasoning ?? false,
        ...(base?.thinkingLevelMap === undefined
            ? {}
            : { thinkingLevelMap: base.thinkingLevelMap }),
    });
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
    const profile = configuredProviderProfile(ctx, provider);
    const lcxCapabilityRoute = isLcxCapabilityRoute(provider, model);
    if (!isRecord(profile))
        return undefined;
    const configured = profile;
    if (profileExcludesModel(configured, model) || usesHostProviderAuth(provider))
        return undefined;
    // Protocol and endpoint: the profile, then what DSH resolves for the model (see `resolveCatalogModel`).
    const catalog = resolveCatalogModel(provider, model, dshServesModel(ctx, configured, provider, model));
    const builtin = catalog.descriptor;
    const api = configured.api ?? catalog.api;
    if (api !== "openai-responses")
        return undefined;
    const baseURL = configured.baseURL ?? catalog.baseUrl;
    const apiKeyEnv = configured.apiKeyEnv;
    if (typeof baseURL !== "string" || !normalizeBaseURL(baseURL) || typeof apiKeyEnv !== "string" || !apiKeyEnv.trim())
        return undefined;
    const responsesCompat = {};
    copyResponsesCompat(responsesCompat, builtin?.compat);
    copyResponsesCompat(responsesCompat, lcxCapabilityRoute ? policy.responsesCompat : undefined);
    copyResponsesCompat(responsesCompat, configuredResponsesCompat(configured, model));
    const promptCacheModel = lcxCapabilityRoute && policy.supportsExplicitPromptCacheMode === true ? resolveCatalogModel("openai", model).descriptor : undefined;
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
    const declaredControls = declaredReasoningControls(configured, model);
    return {
        provider,
        model,
        api: "openai-responses",
        baseURL: normalizeBaseURL(baseURL),
        apiKeyEnv,
        ...(builtin?.headers === undefined ? {} : { catalogHeaders: { ...builtin.headers } }),
        headers: { ...(configured.headers ?? {}) },
        cacheRetention,
        supportsLongCacheRetention,
        responsesCompat,
        // Only a declared `reasoningEfforts` is projected here; an undeclared model follows the catalog
        // and what DSH resolved for it (see `routeModelOverride`).
        ...(declaredControls === undefined ? {} : { modelControls: declaredControls }),
        // These are explicitly LCX-owned transport and request-capability policies.
        timeoutMs: isPositiveSafeInteger(configured.timeoutMs) ? configured.timeoutMs : policy.timeoutMs,
        maxAttempts: retryAttempts(configured.retryPolicy, policy.maxAttempts),
        maxRequestImageBytes: isPositiveSafeInteger(configured.maxRequestImageBytes) ? configured.maxRequestImageBytes : policy.maxRequestImageBytes,
        requestImagePixelBudget: isPositiveSafeInteger(configured.requestImagePixelBudget) ? configured.requestImagePixelBudget : policy.requestImagePixelBudget,
        requestImageMaxBytes: isPositiveSafeInteger(configured.requestImageMaxBytes) ? configured.requestImageMaxBytes : policy.requestImageMaxBytes,
    };
}
/**
 * Name the reason `resolveResponsesRouteConfig` returned nothing, so the failure can tell the user what to
 * change: `api-unresolved` means neither the profile nor the model catalog names a protocol for this model.
 */
export function diagnoseResponsesRoute(ctx, options) {
    const provider = String(options?.provider ?? "");
    const model = String(options?.model ?? "");
    const profile = provider.trim() ? configuredProviderProfile(ctx, provider) : undefined;
    if (!isRecord(profile))
        return "no-profile";
    if (profileExcludesModel(profile, model))
        return "model-not-configured";
    if (usesHostProviderAuth(provider))
        return "host-auth";
    const api = profile.api ?? resolveCatalogModel(provider, model, dshServesModel(ctx, profile, provider, model)).api;
    if (api === undefined)
        return "api-unresolved";
    return api === "openai-responses" ? "incomplete" : "api-not-responses";
}
/** Resolve a Grok-prefixed model through its selected DSH Responses profile. */
export function resolveGrokResponsesRouteConfig(ctx, options, policy) {
    const provider = String(options?.provider ?? "");
    const model = String(options?.model ?? "");
    if (!provider.trim() || !/^grok/iu.test(model))
        return undefined;
    const configured = configuredProviderProfile(ctx, provider);
    if (!isRecord(configured))
        return undefined;
    if (profileExcludesModel(configured, model) || usesHostProviderAuth(provider))
        return undefined;
    const catalog = resolveCatalogModel(provider, model, dshServesModel(ctx, configured, provider, model));
    const selectedBuiltin = catalog.descriptor;
    const api = configured.api ?? catalog.api;
    if (api !== "openai-responses")
        return undefined;
    const baseURL = configured.baseURL ?? catalog.baseUrl;
    const apiKeyEnv = configured.apiKeyEnv;
    if (typeof baseURL !== "string" ||
        !normalizeBaseURL(baseURL) ||
        typeof apiKeyEnv !== "string" ||
        !apiKeyEnv.trim())
        return undefined;
    const responsesCompat = {};
    copyResponsesCompat(responsesCompat, selectedBuiltin?.compat);
    copyResponsesCompat(responsesCompat, configuredResponsesCompat(configured, model));
    const supportsLongCacheRetention = responsesCompat.supportsLongCacheRetention === true;
    responsesCompat.supportsLongCacheRetention = supportsLongCacheRetention;
    const requestedRetention = configured.cacheRetention;
    const cacheRetention = requestedRetention === "none"
        ? "none"
        : requestedRetention === "long" && supportsLongCacheRetention
            ? "long"
            : "short";
    return {
        provider,
        model,
        api: "openai-responses",
        baseURL: normalizeBaseURL(baseURL),
        apiKeyEnv,
        ...(selectedBuiltin?.headers === undefined ? {} : { catalogHeaders: { ...selectedBuiltin.headers } }),
        headers: effectiveGrokProfileHeaders(configured.headers),
        cacheRetention,
        supportsLongCacheRetention,
        responsesCompat,
        modelDefaults: modelDescriptorDefaults(selectedBuiltin),
        modelControls: {
            ...configuredModelControls(configured, model, selectedBuiltin),
            includeEncryptedReasoning: true,
        },
        profileReasoning: profileReasoning(configured.reasoning),
        // Pi applies only an explicitly configured request deadline; stream liveness
        // is owned separately by the provider idle watchdog.
        timeoutMs: isPositiveSafeInteger(configured.timeoutMs)
            ? configured.timeoutMs
            : undefined,
        streamIdleTimeoutMs: isPositiveFinite(configured.streamIdleTimeoutMs)
            ? configured.streamIdleTimeoutMs
            : DEFAULTS.streamIdleTimeoutMs,
        maxAttempts: retryAttempts(configured.retryPolicy, policy.maxAttempts),
        maxRequestImageBytes: isPositiveSafeInteger(configured.maxRequestImageBytes)
            ? configured.maxRequestImageBytes
            : policy.maxRequestImageBytes,
        requestImagePixelBudget: isPositiveSafeInteger(configured.requestImagePixelBudget)
            ? configured.requestImagePixelBudget
            : policy.requestImagePixelBudget,
        requestImageMaxBytes: isPositiveSafeInteger(configured.requestImageMaxBytes)
            ? configured.requestImageMaxBytes
            : policy.requestImageMaxBytes,
    };
}
export async function resolveApiKey(ctx, config) {
    const resolved = await ctx?.credentials.resolve(credentialRef(config.apiKeyEnv));
    // DSH's own definition of a usable key (trimmed, nothing an HTTP header cannot carry). A rejected key is
    // reported by its reference only, never by its value.
    if (resolved?.value.trim())
        return assertUsableApiKey(resolved.value, "lcx-codex", config.apiKeyEnv);
    throw codedError(`DSH provider credential is unavailable: ${config.apiKeyEnv}`, "LCX_CREDENTIAL_UNAVAILABLE");
}
function setHeaderCaseInsensitive(headers, name, value) {
    const normalized = name.toLowerCase();
    for (const existing of Object.keys(headers))
        if (existing.toLowerCase() === normalized)
            delete headers[existing];
    headers[name] = value;
}
/** Layer header maps, later ones replacing earlier ones whatever the header name's case. */
function layerHeaders(...layers) {
    const result = {};
    for (const layer of layers)
        for (const [name, value] of Object.entries(layer ?? {}))
            setHeaderCaseInsensitive(result, name, value);
    return result;
}
/** Apply DSH's case-insensitive attribution reservation at profile resolution. */
function effectiveGrokProfileHeaders(configured) {
    const attribution = attributionHeaders();
    const reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));
    const effective = {};
    for (const [name, value] of Object.entries(configured ?? {}))
        if (!reserved.has(name.toLowerCase()))
            setHeaderCaseInsensitive(effective, name, value);
    return effective;
}
function hasHeader(headers, name) { return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === name.toLowerCase()); }
function hasExplicitSessionAffinity(headers) { return ["session-id", "session_id", "x-session-id"].some((name) => hasHeader(headers, name)); }
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
export async function authenticatedHeaders(ctx, config, sessionId, requestId, dynamicHeaders = {}) {
    const explicit = { ...(config.headers ?? {}) };
    const sid = sessionId ? String(sessionId) : undefined;
    const format = sessionAffinityFormat(config);
    // Lowest first, as Pi's client layers them: the catalog model's own headers, DSH attribution, the credential,
    // the provider's per-request headers (Copilot initiator / vision, OpenCode routing), then the affinity ids.
    const headers = layerHeaders(config.catalogHeaders, attributionHeaders(), { authorization: `Bearer ${await resolveApiKey(ctx, config)}` }, dynamicHeaders, providerSessionHeaders(config.provider, sid));
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
    // The profile's own headers win over every default.
    return layerHeaders(headers, explicit);
}
/** Grok mirrors Pi createClient ordering without changing accepted GPT headers. */
export async function authenticatedGrokHeaders(ctx, config, sessionId, dynamicHeaders = {}) {
    const explicit = effectiveGrokProfileHeaders(config.headers);
    const sid = sessionId ? String(sessionId) : undefined;
    // The catalog model's headers come first, so DSH attribution (applied last, as the host does) replaces them.
    const headers = layerHeaders(config.catalogHeaders, {
        authorization: `Bearer ${await resolveApiKey(ctx, config)}`,
    }, dynamicHeaders, providerSessionHeaders(config.provider, sid));
    const format = sessionAffinityFormat(config);
    if (sid) {
        if (format === "openai")
            headers.session_id = sid;
        else if (format === "openrouter")
            headers["x-session-id"] = sid;
        if (format === "openai" || format === "openai-nosession")
            headers["x-client-request-id"] = sid;
    }
    for (const [name, value] of Object.entries(explicit))
        setHeaderCaseInsensitive(headers, name, value);
    for (const [name, value] of Object.entries(attributionHeaders()))
        setHeaderCaseInsensitive(headers, name, value);
    return headers;
}
export function currentRoute(options, config) {
    return { provider: String(options?.provider ?? config.provider ?? ""), model: String(options?.model ?? config.model ?? ""), baseURL: normalizeBaseURL(config.baseURL), sessionId: String(options?.sessionId ?? "") };
}
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
export function generationControlsFromSession(session, route) {
    try {
        return generationControlsFromHeader(session?.requestHeader?.(), route);
    }
    catch {
        return {};
    }
}
export function routeCompatible(record, route, ctx) {
    void ctx;
    return !!record && record.version === 5 && record.provider === route.provider && record.model === route.model && record.baseURLFingerprint === baseURLFingerprint(route.baseURL) && record.sourceSessionId === route.sessionId;
}
