import { createHash, randomUUID } from "node:crypto";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { SessionId } from "@deepseek-ai/dsh-session";
import "@deepseek-ai/dsh-settings";
import { assertUsableApiKey, attributionHeaders, LlmError, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { resolveCatalogModel } from "./model-catalog.js";
import { clampOpenAIPromptCacheKey, getCatalogModels } from "./pi-responses-runtime.js";
import { providerSessionHeaders } from "./provider-headers.js";
import { codedError, isPositiveFinite, isPositiveSafeInteger, isRecord } from "./util.js";
import { DEFAULTS } from "./defaults.js";
export function normalizeBaseURL(value) {
    return String(value ?? "").trim().replace(/\/+$/u, "");
}
export function baseURLFingerprint(baseURL) {
    return createHash("sha256").update(normalizeBaseURL(baseURL), "utf8").digest("hex");
}
function findHeaderCaseInsensitive(headers, target) {
    const normalized = target.toLowerCase();
    for (const [name, value] of Object.entries(headers ?? {})) {
        if (name.toLowerCase() === normalized)
            return String(value);
    }
    return undefined;
}
function effectiveCredentialIdentity(effectiveAuthorization) {
    if (typeof effectiveAuthorization === "string" && /^Bearer\s+eyJ/iu.test(effectiveAuthorization.trim())) {
        const token = effectiveAuthorization.trim().replace(/^Bearer\s+/iu, "");
        const parts = token.split(".");
        if (parts.length === 3 && parts[1]) {
            try {
                const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
                const authClaim = isRecord(payload) ? payload["https://api.openai.com/auth"] : undefined;
                const accountId = isRecord(authClaim) ? authClaim.chatgpt_account_id : undefined;
                if (typeof accountId === "string" && accountId.trim().length > 0) {
                    return `chatgpt-acct:${accountId.trim()}`;
                }
            }
            catch { }
        }
    }
    return `auth:${effectiveAuthorization ?? ""}`;
}
function canonicalAuthorityHeaders(headers, excludeAuth = false) {
    return Object.entries(headers ?? {})
        .filter(([name]) => !excludeAuth || name.toLowerCase() !== "authorization")
        .map(([name, value]) => [name.toLowerCase(), String(value)])
        .sort(([left], [right]) => left.localeCompare(right));
}
export function requestHeaderAuthorityFingerprint(headers, credentialAuthority) {
    const effectiveAuth = credentialAuthority?.effectiveAuthorization ??
        findHeaderCaseInsensitive(headers, "authorization");
    const authDigest = createHash("sha256")
        .update(effectiveCredentialIdentity(effectiveAuth), "utf8")
        .digest("hex");
    return createHash("sha256")
        .update(JSON.stringify({
        v: 2,
        apiKeyEnv: String(credentialAuthority?.apiKeyEnv ?? ""),
        authDigest,
        headers: canonicalAuthorityHeaders(headers, true),
    }), "utf8")
        .digest("hex");
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
    let current = typeof sessions?.get === "function" ? sessions.get(SessionId(sessionId)) : undefined;
    if (current?.header?.origin !== "subagent")
        return sessionId;
    const seen = new Set([sessionId]);
    while (current?.header?.origin === "subagent" && current.header.parentSession) {
        const parentId = current.header.parentSession;
        if (seen.has(parentId))
            return sessionId;
        const parent = typeof sessions?.get === "function" ? sessions.get(SessionId(parentId)) : undefined;
        if (!parent)
            return sessionId;
        seen.add(parentId);
        current = parent;
    }
    return current?.id ?? sessionId;
}
export function promptCacheKey(route, config = {}, ctx = undefined) {
    if (config.responsesCompat?.promptCacheKeyMode === "disabled")
        return undefined;
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
const RESPONSES_COMPAT_FIELDS = new Set(["supportsDeveloperRole", "sessionAffinityFormat", "promptCacheKeyMode", "supportsStrictMode", "supportsLongCacheRetention", "supportsOpenAIGrammarTools", "supportsAdditionalTools", "supportsToolSearch", "supportsExplicitPromptCacheMode", "supportsMaxOutputTokens"]);
const RESPONSES_PROFILE_COMPAT_FIELDS = new Set(["supportsDeveloperRole", "supportsMaxOutputTokens", "supportsStrictMode", "supportsLongCacheRetention"]);
/** True when `model` names a Grok model (`grok-*`, `x-ai/grok-*`, or camelCase `grokCustom`/`GrOkCustomPreview`), rejecting non-Grok substrings like `vendor/grokking`. */
export function isGrokModelId(model) {
    const trimmed = String(model ?? "").trim();
    const terminal = trimmed.slice(trimmed.lastIndexOf("/") + 1);
    return (/^grok(?:$|[-._0-9])/iu.test(terminal) ||
        /^grok[A-Z]/u.test(terminal) ||
        /^[gG][rR][oO][kK][A-Z][a-z]/u.test(terminal));
}
function copyResponsesCompat(target, source, allowedFields = RESPONSES_COMPAT_FIELDS) {
    if (!isRecord(source))
        return;
    for (const field of allowedFields) {
        const value = source[field];
        if (field === "sessionAffinityFormat") {
            if (value === "openai" || value === "openai-nosession" || value === "openrouter")
                target.sessionAffinityFormat = value;
        }
        else if (field === "promptCacheKeyMode") {
            if (value === "auto" || value === "disabled" || value === "enabled")
                target.promptCacheKeyMode = value;
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
            if (!/^gpt-/iu.test(model.id) && !isGrokModelId(model.id))
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
 *
 * `assumeHostServes` answers the undecided case optimistically, for the one decision that cannot wait for DSH:
 * which tools to register while an agent's tools are assembled. It is exact, not a guess: a model on a provider
 * with no `models` list that DSH does not serve is refused by DSH (UNKNOWN_MODEL) before any request, so no tool
 * is ever sent for it, and one DSH does serve is taken by LCX (the stream awaits DSH's answer; see
 * `hostRecognizedRouteStream`), which is where the tools are used. The protocol still has to be the provider's
 * shared Responses protocol, and the model must not be one the catalog itself marks as another protocol.
 */
function dshServesModel(ctx, profile, provider, modelId, assumeHostServes = false) {
    if (Array.isArray(profile?.models) && profile.models.length > 0)
        return profile.models.some((entry) => String(entry?.id ?? "") === String(modelId));
    return assumeHostServes || hostRecognizesModel(ctx, profile, provider, modelId);
}
function configuredModelProfile(profile, modelId) {
    const configuredModels = Array.isArray(profile?.models) ? profile.models : [];
    return configuredModels.length > 0
        ? configuredModels.find((entry) => String(entry?.id ?? "") === String(modelId))
        : profile?.modelOverrides?.[String(modelId)];
}
function configuredResponsesCompat(profile, modelId) {
    const compat = {};
    copyResponsesCompat(compat, profile?.compat, RESPONSES_PROFILE_COMPAT_FIELDS);
    copyResponsesCompat(compat, configuredModelProfile(profile, modelId)?.compat, RESPONSES_PROFILE_COMPAT_FIELDS);
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
            // DSH permits only off:null: it means supported-off by omitting the wire option. Pi (1.3.0) would
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
export function resolveResponsesRouteConfig(ctx, options, policy, assumeHostServes = false) {
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
    const catalog = resolveCatalogModel(provider, model, dshServesModel(ctx, configured, provider, model, assumeHostServes));
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
    if (policy.promptCacheKeyMode === "disabled" || policy.promptCacheKeyMode === "enabled") {
        responsesCompat.promptCacheKeyMode = policy.promptCacheKeyMode;
    }
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
    // Pi defaults missing `supportsLongCacheRetention` to true (`model.compat?.supportsLongCacheRetention ?? true`)
    // while leaving missing `cacheRetention` on `"short"` (`resolveCacheRetention`). Only explicit `lcx/gpt-5.6-*`
    // capability routes retain LCX's legacy `supportsLongCacheRetention` -> `"long"` default when unconfigured.
    const supportsLongCacheRetention = resolvedCompat?.supportsLongCacheRetention ??
        (lcxCapabilityRoute ? policy.supportsLongCacheRetention === true : true);
    responsesCompat.supportsLongCacheRetention = supportsLongCacheRetention;
    const configuredRetention = configured.cacheRetention;
    const fallbackRetention = lcxCapabilityRoute ? policy.cacheRetention : undefined;
    const envRetention = process.env.PI_CACHE_RETENTION === "long" ? "long" : undefined;
    const requestedRetention = configuredRetention === "none" || configuredRetention === "short" || configuredRetention === "long"
        ? configuredRetention
        : fallbackRetention === "none" || fallbackRetention === "short" || fallbackRetention === "long"
            ? fallbackRetention
            : envRetention;
    const defaultRetention = lcxCapabilityRoute && supportsLongCacheRetention ? "long" : "short";
    const cacheRetention = requestedRetention === "long" && !supportsLongCacheRetention ? "short" : (requestedRetention ?? defaultRetention);
    const declaredControls = declaredReasoningControls(configured, model);
    const configuredModel = configuredModelProfile(configured, model);
    return {
        provider,
        model,
        api: "openai-responses",
        baseURL: normalizeBaseURL(baseURL),
        rawBaseURL: baseURL,
        apiKeyEnv,
        ...(builtin?.headers === undefined ? {} : { catalogHeaders: { ...builtin.headers } }),
        headers: { ...(configured.headers ?? {}) },
        cacheRetention,
        supportsLongCacheRetention,
        responsesCompat,
        // Only a declared `reasoningEfforts` is projected here; an undeclared model follows the catalog
        // and what DSH resolved for it (see `routeModelOverride`).
        ...(declaredControls === undefined ? {} : { modelControls: declaredControls }),
        profileReasoning: profileReasoning(configured.reasoning),
        ...(isPositiveSafeInteger(catalog.maxTokens) ? { catalogMaxTokens: catalog.maxTokens } : {}),
        ...(isPositiveSafeInteger(configuredModel?.maxTokens) ? { profileModelMaxTokens: configuredModel.maxTokens } : {}),
        ...(isPositiveSafeInteger(configured.defaultMaxTokens) ? { profileDefaultMaxTokens: configured.defaultMaxTokens } : {}),
        // These are explicitly LCX-owned transport and request-capability policies.
        timeoutMs: isPositiveSafeInteger(configured.timeoutMs) ? configured.timeoutMs : policy.timeoutMs,
        maxAttempts: retryAttempts(configured.retryPolicy, policy.maxAttempts),
        maxRequestImages: isPositiveSafeInteger(configured.maxRequestImages) ? configured.maxRequestImages : 50,
        imageOffloadCountQuantum: isPositiveSafeInteger(configured.imageOffloadCountQuantum) ? configured.imageOffloadCountQuantum : Math.min(10, isPositiveSafeInteger(configured.maxRequestImages) ? configured.maxRequestImages : 50),
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
/** Resolve a Grok model through its selected DSH Responses profile. */
export function resolveGrokResponsesRouteConfig(ctx, options, policy) {
    const provider = String(options?.provider ?? "");
    const model = String(options?.model ?? "");
    if (!provider.trim() || !isGrokModelId(model))
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
    if (policy.promptCacheKeyMode === "disabled" || policy.promptCacheKeyMode === "enabled") {
        responsesCompat.promptCacheKeyMode = policy.promptCacheKeyMode;
    }
    const supportsLongCacheRetention = responsesCompat.supportsLongCacheRetention !== false;
    responsesCompat.supportsLongCacheRetention = supportsLongCacheRetention;
    const configuredRetention = configured.cacheRetention;
    const envRetention = process.env.PI_CACHE_RETENTION === "long" ? "long" : undefined;
    const requestedRetention = configuredRetention === "none" || configuredRetention === "short" || configuredRetention === "long"
        ? configuredRetention
        : envRetention;
    const cacheRetention = requestedRetention === "none"
        ? "none"
        : requestedRetention === "long" && supportsLongCacheRetention
            ? "long"
            : "short";
    const configuredModel = configuredModelProfile(configured, model);
    return {
        provider,
        model,
        api: "openai-responses",
        baseURL: normalizeBaseURL(baseURL),
        rawBaseURL: baseURL,
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
        ...(isPositiveSafeInteger(catalog.maxTokens) ? { catalogMaxTokens: catalog.maxTokens } : {}),
        ...(isPositiveSafeInteger(configuredModel?.maxTokens) ? { profileModelMaxTokens: configuredModel.maxTokens } : {}),
        ...(isPositiveSafeInteger(configured.defaultMaxTokens) ? { profileDefaultMaxTokens: configured.defaultMaxTokens } : {}),
        // Pi applies only an explicitly configured request deadline; stream liveness
        // is owned separately by the provider idle watchdog.
        timeoutMs: isPositiveSafeInteger(configured.timeoutMs)
            ? configured.timeoutMs
            : undefined,
        streamIdleTimeoutMs: isPositiveFinite(configured.streamIdleTimeoutMs)
            ? configured.streamIdleTimeoutMs
            : DEFAULTS.streamIdleTimeoutMs,
        maxAttempts: retryAttempts(configured.retryPolicy, policy.maxAttempts),
        maxRequestImages: isPositiveSafeInteger(configured.maxRequestImages) ? configured.maxRequestImages : 50,
        imageOffloadCountQuantum: isPositiveSafeInteger(configured.imageOffloadCountQuantum) ? configured.imageOffloadCountQuantum : Math.min(10, isPositiveSafeInteger(configured.maxRequestImages) ? configured.maxRequestImages : 50),
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
function positiveFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
function isGrokBudgetRoute(route) {
    const provider = String(route?.provider ?? "").trim();
    return provider.length > 0 && isGrokModelId(route?.model);
}
export function grokBudgetInputSignature(ctx, route, requestMaxTokens) {
    const provider = String(route?.provider ?? "").trim();
    const model = String(route?.model ?? "").trim();
    const profile = provider ? configuredProviderProfile(ctx, provider) : undefined;
    const modelProfile = isRecord(profile) && model ? configuredModelProfile(profile, model) : undefined;
    return JSON.stringify([
        requestMaxTokens ?? null,
        isRecord(profile) ? profile.defaultContextWindow ?? null : null,
        modelProfile?.contextWindow ?? null,
        modelProfile?.maxTokens ?? null,
        Array.isArray(profile?.models) ? profile.models.map((entry) => String(entry?.id ?? "")) : null,
    ]);
}
/**
 * Pure pre-flight diagnostic for Grok profiles whose resolved `maxTokens >= contextWindow`.
 *
 * In DSH 0.2.2 (`dsh-llm-pi-ai` + `dsh-compaction-basic`), an explicit `maxTokens` on `models[]` or
 * `modelOverrides` becomes `ModelInfo.defaultMaxTokens` (reserved completion tokens). When `requestMaxTokens`
 * or `defaultMaxTokens >= contextWindow`, `contextWindow - reservedCompletionTokens <= 0`, blocking model
 * switches to Grok with `MODEL_SWITCH_COMPACTION_FAILED`.
 */
export function diagnoseGrokProfileBudget(profile, route, options) {
    const provider = String(route?.provider ?? "").trim();
    const model = String(route?.model ?? "").trim();
    if (!provider || !isGrokBudgetRoute({ provider, model }))
        return undefined;
    if (isRecord(profile) && profileExcludesModel(profile, model))
        return undefined;
    if (!isRecord(profile) && !options?.resolvedModelInfo)
        return undefined;
    const modelProfile = isRecord(profile) && model ? configuredModelProfile(profile, model) : undefined;
    const catalogModel = model ? getCatalogModels(provider).find((entry) => entry.id === model) : undefined;
    const contextWindow = positiveFiniteNumber(options?.resolvedModelInfo?.contextWindow) ??
        positiveFiniteNumber(modelProfile?.contextWindow) ??
        positiveFiniteNumber(catalogModel?.contextWindow) ??
        (isRecord(profile) ? positiveFiniteNumber(profile.defaultContextWindow) : undefined);
    const maxTokens = positiveFiniteNumber(options?.requestMaxTokens) ??
        positiveFiniteNumber(options?.resolvedModelInfo?.defaultMaxTokens) ??
        positiveFiniteNumber(modelProfile?.maxTokens);
    if (contextWindow === undefined || maxTokens === undefined || maxTokens < contextWindow)
        return undefined;
    const target = model ? `${provider}/${model}` : provider;
    return `[lcx-codex] Grok route "${target}" resolves maxTokens (${maxTokens}) >= contextWindow (${contextWindow}); DSH 0.2.2 blocks switching to Grok with MODEL_SWITCH_COMPACTION_FAILED (leaving zero message budget). Set maxTokens clearly below contextWindow (for example, 64000 or 128000 for a 500000 context window) in the llm-pi-ai provider profile ("models[].maxTokens" or "modelOverrides[\\"${model}\\"].maxTokens") or pass a lower request maxTokens.`;
}
export function diagnoseGrokContextBudget(ctx, route, options) {
    if (!isGrokBudgetRoute(route))
        return undefined;
    const provider = String(route?.provider ?? "").trim();
    const profile = configuredProviderProfile(ctx, provider);
    return diagnoseGrokProfileBudget(profile, route, options);
}
export function grokRouteMayNeedHostBudgetLookup(ctx, route, requestMaxTokens) {
    const provider = String(route?.provider ?? "").trim();
    const model = String(route?.model ?? "").trim();
    if (!provider || !isGrokBudgetRoute({ provider, model }))
        return false;
    const profile = configuredProviderProfile(ctx, provider);
    if (!isRecord(profile) || profileExcludesModel(profile, model))
        return false;
    const modelProfile = configuredModelProfile(profile, model);
    return (positiveFiniteNumber(requestMaxTokens) !== undefined ||
        positiveFiniteNumber(modelProfile?.maxTokens) !== undefined);
}
export async function diagnoseGrokContextBudgetAsync(ctx, route, options) {
    const provider = String(route?.provider ?? "").trim();
    const model = String(route?.model ?? "").trim();
    if (!provider || !isGrokBudgetRoute({ provider, model }))
        return undefined;
    const profile = configuredProviderProfile(ctx, provider);
    if (!isRecord(profile) || profileExcludesModel(profile, model))
        return undefined;
    let resolvedModelInfo;
    if (typeof ctx?.llm?.resolveModelInfo === "function") {
        try {
            const info = await ctx.llm.resolveModelInfo(provider, model, options?.signal);
            if (isRecord(info)) {
                resolvedModelInfo = {
                    contextWindow: isRecord(info.context) ? info.context.contextWindow : undefined,
                    defaultMaxTokens: info.defaultMaxTokens,
                };
            }
        }
        catch {
            // Fall back to configured profile + catalog metadata if host model resolution fails.
        }
    }
    return diagnoseGrokProfileBudget(profile, route, {
        requestMaxTokens: options?.requestMaxTokens,
        resolvedModelInfo,
    });
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
/** Headers whose owners (credentials, session affinity, correlation) layer them after the contributors. */
const OWNER_PROTECTED_HEADERS = new Set(["authorization", "cf-aig-authorization", "proxy-authorization", "x-api-key", "api-key", "cookie", "session_id", "session-id", "x-session-id", "x-client-request-id", "x-opencode-session"]);
/** The host exposes profile headers only. Credential and routing headers are layered by their owners later. */
export function prepareRequestHeaders(ctx, config, options = {}) {
    try {
        const initial = new Headers();
        // Contributors must never observe explicit profile credentials or routing/session affinity headers;
        // owners re-apply protected profile headers after contributors run.
        for (const [name, value] of Object.entries(config.headers ?? {})) {
            if (!OWNER_PROTECTED_HEADERS.has(name.toLowerCase()))
                initial.set(name, value);
        }
        const request = Object.freeze({ provider: config.provider, model: config.model, baseURL: config.rawBaseURL ?? config.baseURL,
            ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
            ...(options.purpose === undefined ? {} : { purpose: options.purpose }) });
        const waterfall = ctx?.waterfall;
        const headers = waterfall === undefined ? initial : waterfall.call(ctx, "llm-pi-ai/request-headers", request, initial, () => initial);
        for (const [name, value] of Object.entries(attributionHeaders()))
            headers.set(name, value);
        return Object.fromEntries(headers);
    }
    catch (error) {
        const diagnostic = error instanceof TypeError
            ? "TypeError during header preparation; check the contributing plugin's header names, values, and configuration"
            : error instanceof Error ? error.message : "the contributing plugin threw a non-Error value; throw an Error with a safe diagnostic";
        throw new LlmError(`pi-ai request header preparation failed for provider "${config.provider}": ${diagnostic}`, "REQUEST_HEADERS", { cause: error });
    }
}
function computeReplayAuthorityHeaders(contributorHeaders, protectedProfile) {
    const attributionKeys = new Set(Object.keys(attributionHeaders()).map((name) => name.toLowerCase()));
    const authorityContributors = Object.fromEntries(Object.entries(contributorHeaders).filter(([name]) => !attributionKeys.has(name.toLowerCase())));
    return layerHeaders(authorityContributors, protectedProfile);
}
/**
 * The headers of one GPT request. `sessionId` is the prompt-cache / affinity session (the root session for a
 * subagent, absent without cache retention); `providerSessionId` is the CURRENT DSH session, which is what Pi's
 * client sends in provider routing headers (`x-opencode-session`) whatever the cache policy is.
 */
export async function authenticatedRequestHeaders(ctx, config, sessionId, requestId, dynamicHeaders = {}, providerSessionId, request, resolvedApiKey) {
    const explicit = { ...(config.headers ?? {}) };
    const currentSessionId = providerSessionId ?? (sessionId ? String(sessionId) : undefined);
    // As on the host, the credential is resolved before contributors run: a missing one never reaches them.
    const apiKey = resolvedApiKey ?? (await resolveApiKey(ctx, config));
    const prepared = prepareRequestHeaders(ctx, config, request ?? (currentSessionId === undefined ? {} : { sessionId: currentSessionId }));
    const contributorHeaders = Object.fromEntries(Object.entries(prepared).filter(([name]) => !OWNER_PROTECTED_HEADERS.has(name.toLowerCase())));
    const sid = sessionId ? String(sessionId) : undefined;
    const format = sessionAffinityFormat(config);
    // Model/provider defaults precede the contributed profile layer. Credentials and session routing
    // are owned by their later layers; attribution is re-applied last.
    const headers = layerHeaders(config.catalogHeaders, dynamicHeaders, contributorHeaders, { authorization: `Bearer ${apiKey}` }, providerSessionHeaders(config.provider, providerSessionId ?? sid));
    if (sid && !hasExplicitSessionAffinity(explicit)) {
        if (format === "openai")
            headers["session-id"] = sid;
        else if (format === "openrouter")
            headers["x-session-id"] = sid;
    }
    if (requestId !== null && !hasHeader(explicit, "x-client-request-id")) {
        const correlation = requestId ?? (sid && (format === "openai" || format === "openai-nosession") ? sid : !sid ? randomUUID() : undefined);
        if (correlation)
            headers["x-client-request-id"] = correlation;
    }
    // Ordinary profile headers keep whatever the contributors made of them. The owner-protected ones (credential,
    // session affinity, correlation) are the profile's to set over every default and never a contributor's.
    // Attribution is re-applied last, as on the host.
    const protectedProfile = Object.fromEntries(Object.entries(explicit).filter(([name]) => OWNER_PROTECTED_HEADERS.has(name.toLowerCase())));
    const finalHeaders = layerHeaders(headers, protectedProfile, attributionHeaders());
    const replayAuthorityHeaders = computeReplayAuthorityHeaders(contributorHeaders, protectedProfile);
    const headerAuthorityFingerprint = requestHeaderAuthorityFingerprint(replayAuthorityHeaders, {
        apiKeyEnv: config.apiKeyEnv,
        effectiveAuthorization: findHeaderCaseInsensitive(finalHeaders, "authorization"),
    });
    return {
        headers: finalHeaders,
        replayAuthorityHeaders,
        headerAuthorityFingerprint,
    };
}
export async function authenticatedHeaders(ctx, config, sessionId, requestId, dynamicHeaders = {}, providerSessionId, request, resolvedApiKey) {
    return (await authenticatedRequestHeaders(ctx, config, sessionId, requestId, dynamicHeaders, providerSessionId, request, resolvedApiKey)).headers;
}
/** Grok mirrors Pi createClient ordering and request-header contributor hook without changing accepted GPT precedence. */
export async function authenticatedGrokRequestHeaders(ctx, config, sessionId, dynamicHeaders = {}, providerSessionId, request, resolvedApiKey) {
    const explicit = effectiveGrokProfileHeaders(config.headers);
    const sid = sessionId ? String(sessionId) : undefined;
    const currentSessionId = providerSessionId ?? sid;
    // Resolve credentials before contributors run, matching authenticatedHeaders and DSH PiAiAdapter.
    const apiKey = resolvedApiKey ?? (await resolveApiKey(ctx, config));
    const prepared = prepareRequestHeaders(ctx, { ...config, headers: explicit }, request ?? (currentSessionId === undefined ? {} : { sessionId: currentSessionId }));
    const contributorHeaders = Object.fromEntries(Object.entries(prepared).filter(([name]) => !OWNER_PROTECTED_HEADERS.has(name.toLowerCase())));
    // The catalog model's headers precede contributed/dynamic layers; credentials, session affinity,
    // protected profile headers, and final DSH attribution follow in owner order.
    const headers = layerHeaders(config.catalogHeaders, dynamicHeaders, contributorHeaders, { authorization: `Bearer ${apiKey}` }, providerSessionHeaders(config.provider, currentSessionId));
    const format = sessionAffinityFormat(config);
    if (sid) {
        if (format === "openai")
            headers["session-id"] = sid;
        else if (format === "openrouter")
            headers["x-session-id"] = sid;
        if (format === "openai" || format === "openai-nosession")
            headers["x-client-request-id"] = sid;
    }
    const protectedProfile = Object.fromEntries(Object.entries(explicit).filter(([name]) => OWNER_PROTECTED_HEADERS.has(name.toLowerCase())));
    const finalHeaders = layerHeaders(headers, protectedProfile, attributionHeaders());
    const replayAuthorityHeaders = computeReplayAuthorityHeaders(contributorHeaders, protectedProfile);
    const headerAuthorityFingerprint = requestHeaderAuthorityFingerprint(replayAuthorityHeaders, {
        apiKeyEnv: config.apiKeyEnv,
        effectiveAuthorization: findHeaderCaseInsensitive(finalHeaders, "authorization"),
    });
    return {
        headers: finalHeaders,
        replayAuthorityHeaders,
        headerAuthorityFingerprint,
    };
}
export async function authenticatedGrokHeaders(ctx, config, sessionId, dynamicHeaders = {}, providerSessionId, request, resolvedApiKey) {
    return (await authenticatedGrokRequestHeaders(ctx, config, sessionId, dynamicHeaders, providerSessionId, request, resolvedApiKey)).headers;
}
export function currentRoute(options, config) {
    return {
        provider: String(options?.provider ?? config.provider ?? ""),
        model: String(options?.model ?? config.model ?? ""),
        baseURL: normalizeBaseURL(config.baseURL),
        ...(config.rawBaseURL === undefined ? {} : { rawBaseURL: config.rawBaseURL }),
        sessionId: String(options?.sessionId ?? ""),
    };
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
export async function resolveRouteHeaderAuthorityFingerprint(ctx, route, routeConfig, request) {
    const provider = String(route?.provider ?? routeConfig?.provider ?? "");
    const model = String(route?.model ?? routeConfig?.model ?? "");
    const baseURL = String(route?.baseURL ?? routeConfig?.baseURL ?? "");
    const sessionId = String(route?.sessionId ?? "");
    const resolvedFromCtx = provider && model
        ? resolveResponsesRouteConfig(ctx, { provider, model }, {})
        : undefined;
    const rawApiKeyEnv = typeof routeConfig?.apiKeyEnv === "string" && routeConfig.apiKeyEnv.length > 0
        ? routeConfig.apiKeyEnv
        : resolvedFromCtx?.apiKeyEnv;
    const effectiveApiKeyEnv = rawApiKeyEnv ?? "";
    const effectiveHeaders = routeConfig?.headers ?? resolvedFromCtx?.headers;
    if (typeof ctx?.credentials?.resolve === "function") {
        const effectiveConfig = {
            ...(resolvedFromCtx ?? {}),
            ...(routeConfig ?? {}),
            provider,
            model,
            api: "openai-responses",
            baseURL,
            apiKeyEnv: effectiveApiKeyEnv,
            cacheRetention: (routeConfig?.cacheRetention ?? resolvedFromCtx?.cacheRetention ?? "short"),
            supportsLongCacheRetention: Boolean(routeConfig?.supportsLongCacheRetention ?? resolvedFromCtx?.supportsLongCacheRetention),
            ...(effectiveHeaders === undefined ? {} : { headers: effectiveHeaders }),
        };
        try {
            const apiKey = await resolveApiKey(ctx, { apiKeyEnv: rawApiKeyEnv });
            const cacheSessionId = promptCacheSessionId({ provider, model, baseURL, sessionId }, effectiveConfig, ctx);
            return (await authenticatedRequestHeaders(ctx, effectiveConfig, cacheSessionId, cacheSessionId === undefined ? null : sessionId, {}, sessionId || undefined, request, apiKey)).headerAuthorityFingerprint;
        }
        catch {
            return requestHeaderAuthorityFingerprint(effectiveHeaders, {
                apiKeyEnv: effectiveApiKeyEnv,
            });
        }
    }
    return requestHeaderAuthorityFingerprint(effectiveHeaders, {
        apiKeyEnv: effectiveApiKeyEnv,
    });
}
export function routeCompatible(record, route, ctx) {
    void ctx;
    return (!!record &&
        record.version === 5 &&
        record.provider === route.provider &&
        record.model === route.model &&
        record.baseURLFingerprint === baseURLFingerprint(route.baseURL) &&
        record.sourceSessionId === route.sessionId &&
        typeof record.headerAuthorityFingerprint === "string" &&
        record.headerAuthorityFingerprint.length > 0 &&
        typeof route.headerAuthorityFingerprint === "string" &&
        route.headerAuthorityFingerprint.length > 0 &&
        record.headerAuthorityFingerprint === route.headerAuthorityFingerprint);
}
