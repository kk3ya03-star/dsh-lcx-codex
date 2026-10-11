import { createHash, randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { SessionId, type Session } from "@deepseek-ai/dsh-session";
import "@deepseek-ai/dsh-settings";
import { attributionHeaders, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { resolveCatalogModel } from "./model-catalog.js";

type HeaderMap = Record<string, string>;
type RetryPolicyConfig = Parameters<typeof resolveRetryPolicy>[0];
type CacheRetention = "none" | "short" | "long";
type ResponsesCompat = { supportsDeveloperRole?: boolean; sessionAffinityFormat?: "openai" | "openai-nosession" | "openrouter"; supportsStrictMode?: boolean; supportsLongCacheRetention?: boolean; supportsOpenAIGrammarTools?: boolean; supportsAdditionalTools?: boolean; supportsToolSearch?: boolean; supportsExplicitPromptCacheMode?: boolean; supportsMaxOutputTokens?: boolean };
type RouteIdentity = { provider: string; model: string; baseURL: string; sessionId: string };
type RouteOptions = { provider?: unknown; model?: unknown; sessionId?: unknown };
type ProviderModelProfile = {
  id?: unknown;
  compat?: unknown;
  reasoningEfforts?: unknown;
};
type ProviderProfile = { api?: string; baseURL?: string; apiKeyEnv?: string; headers?: HeaderMap; reasoning?: unknown; cacheRetention?: unknown; timeoutMs?: unknown; streamIdleTimeoutMs?: unknown; maxRequestImageBytes?: unknown; requestImagePixelBudget?: unknown; requestImageMaxBytes?: unknown; retryPolicy?: RetryPolicyConfig; compat?: unknown; models?: ProviderModelProfile[]; modelOverrides?: Record<string, ProviderModelProfile> };
type RequestHeaderConfig = {
  provider?: unknown;
  model?: unknown;
  reasoningEffort?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
};
type RequestHeader = { config?: RequestHeaderConfig };
type RouteSession = Pick<Session, "requestHeader">;
export type RouteContext = Pick<
  Context,
  "credentials" | "llm" | "logger" | "sessions" | "settings"
>;
type RoutePolicy = { cacheRetention?: unknown; supportsLongCacheRetention?: unknown; supportsExplicitPromptCacheMode?: unknown; responsesCompat?: unknown; timeoutMs?: number; maxAttempts?: number; maxRequestImageBytes?: number; requestImagePixelBudget?: number; requestImageMaxBytes?: number };
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
type ModelDescriptorDefaults = Partial<
  Pick<PiResponsesModel, "reasoning" | "thinkingLevelMap">
>;
type UnresolvedRouteConfig = RoutePolicy & { provider: string; model: string; baseURL: string; apiKeyEnv: string; headers?: HeaderMap };
export type ResolvedResponsesRoute = UnresolvedRouteConfig & { api: "openai-responses"; cacheRetention: CacheRetention; supportsLongCacheRetention: boolean; responsesCompat?: ResponsesCompat; modelControls?: ModelControlProjection; modelDefaults?: ModelDescriptorDefaults; profileReasoning?: ModelThinkingLevel; streamIdleTimeoutMs?: number };
type GenerationControls = { reasoningEffort?: unknown; temperature?: unknown; maxTokens?: unknown };
type CheckpointRouteRecord = { version: number; provider: unknown; model: unknown; baseURLFingerprint: unknown; sourceSessionId: unknown };
type LcxError = Error & { code?: string };

/** @param {unknown} value */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** @param {unknown} value */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** @param {unknown} value */
export function normalizeBaseURL(value: unknown): string {
  return String(value ?? "").trim().replace(/\/+$/u, "");
}
/** @param {unknown} baseURL */
export function baseURLFingerprint(baseURL: unknown): string {
  return createHash("sha256").update(normalizeBaseURL(baseURL), "utf8").digest("hex");
}

/** @param {Partial<RouteIdentity> | null | undefined} route @param {{ includeSession?: boolean }} [options] */
export function routeFingerprint(route: Partial<RouteIdentity> | null | undefined, options: { includeSession?: boolean } = {}): string {
  const includeSession = options.includeSession !== false;
  return createHash("sha256").update([
    route?.provider ?? "", route?.model ?? "", normalizeBaseURL(route?.baseURL), includeSession ? (route?.sessionId ?? "") : "",
  ].join("\u001f"), "utf8").digest("hex");
}

/** @param {unknown} value */
function clampPromptCacheKey(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const chars = Array.from(String(value));
  return chars.length <= 64 ? String(value) : chars.slice(0, 64).join("");
}

/** @param {Partial<RouteIdentity> | null | undefined} route @param {Partial<Pick<ResolvedResponsesRoute, 'cacheRetention'>>} [config] @param {RouteContext | null | undefined} [ctx] */
export function promptCacheSessionId(route: Partial<RouteIdentity> | null | undefined, config: Partial<Pick<ResolvedResponsesRoute, "cacheRetention">> = {}, ctx: RouteContext | null | undefined = undefined): string | undefined {
  if (config.cacheRetention === "none") return undefined;
  const sessionId = route?.sessionId ? String(route.sessionId) : undefined;
  if (!sessionId) return undefined;
  const sessions = ctx?.sessions;
  let current = sessions?.get(SessionId(sessionId));
  if (current?.header?.origin !== "subagent") return sessionId;
  const seen = new Set([sessionId]);
  while (current?.header?.origin === "subagent" && current.header.parentSession) {
    const parentId: string = current.header.parentSession;
    if (seen.has(parentId)) return sessionId;
    const parent = sessions?.get(SessionId(parentId));
    if (!parent) return sessionId;
    seen.add(parentId);
    current = parent;
  }
  return current?.id ?? sessionId;
}

/** @param {Partial<RouteIdentity> | null | undefined} route @param {Partial<Pick<ResolvedResponsesRoute, 'cacheRetention'>>} [config] @param {RouteContext | null | undefined} [ctx] */
export function promptCacheKey(route: Partial<RouteIdentity> | null | undefined, config: Partial<Pick<ResolvedResponsesRoute, "cacheRetention">> = {}, ctx: RouteContext | null | undefined = undefined): string | undefined {
  return clampPromptCacheKey(promptCacheSessionId(route, config, ctx));
}

/** Grok follows Pi directly: cache/affinity belongs to the selected child session. */
export function grokPromptCacheSessionId(
  route: Partial<RouteIdentity> | null | undefined,
  config: Partial<Pick<ResolvedResponsesRoute, "cacheRetention">> = {},
): string | undefined {
  if (config.cacheRetention === "none") return undefined;
  const sessionId = String(route?.sessionId ?? "");
  return sessionId || undefined;
}
/** @param {Partial<Pick<ResolvedResponsesRoute, 'cacheRetention' | 'supportsLongCacheRetention' | 'responsesCompat'>>} [config] */
export function promptCacheRetention(config: Partial<Pick<ResolvedResponsesRoute, "cacheRetention" | "supportsLongCacheRetention" | "responsesCompat">> = {}): "24h" | undefined {
  return config.cacheRetention === "long" && config.supportsLongCacheRetention === true && config.responsesCompat?.supportsExplicitPromptCacheMode !== true ? "24h" : undefined;
}

/** @param {RetryPolicyConfig | null | undefined} policy @param {number} [fallback] */
function retryAttempts(policy: RetryPolicyConfig | null | undefined, fallback = 3): number {
  if (!policy) return fallback;
  try { const resolved = resolveRetryPolicy(policy, "llm-pi-ai provider retryPolicy"); if (resolved.mode === "normal" && isPositiveInteger(resolved.maxRetries)) return Math.min(resolved.maxRetries + 1, 6); } catch {}
  return fallback;
}

/** Follow the live directory entry to its SettingsForms profile. */
function configuredProviderProfile(
  ctx: RouteContext | null | undefined,
  provider: string,
): ProviderProfile | undefined {
  // Only llm-pi-ai profiles: other provider plugins' profiles are not LCX routes (Decision 8).
  try {
    const entry = ctx?.llm.listConfigurableProviders().find(
      (candidate) => candidate.provider === provider && candidate.settingsNs === "llm-pi-ai",
    );
    if (!entry || (typeof entry.error === "string" && entry.error.trim())) return undefined;
    const descriptor = ctx?.settings.describe().find((candidate) => candidate.ns === entry.settingsNs);
    let value: unknown = descriptor?.value;
    for (const segment of entry.settingsPath) {
      if (!isRecord(value)) return undefined;
      value = value[segment];
    }
    return isRecord(value) ? value as ProviderProfile : undefined;
  } catch {
    return undefined;
  }
}

/** @type {Set<keyof ResponsesCompat>} */
const RESPONSES_COMPAT_FIELDS = new Set(["supportsDeveloperRole", "sessionAffinityFormat", "supportsStrictMode", "supportsLongCacheRetention", "supportsOpenAIGrammarTools", "supportsAdditionalTools", "supportsToolSearch", "supportsExplicitPromptCacheMode", "supportsMaxOutputTokens"]);
/** @param {ResponsesCompat} target @param {unknown} source */
function copyResponsesCompat(target: ResponsesCompat, source: unknown): void {
  if (!isRecord(source)) return;
  for (const field of RESPONSES_COMPAT_FIELDS) {
    const value = source[field];
    if (field === "sessionAffinityFormat") {
      if (value === "openai" || value === "openai-nosession" || value === "openrouter") target.sessionAffinityFormat = value;
    } else if (typeof value === "boolean") Object.assign(target, { [field]: value });
  }
}

function modelDescriptorDefaults(
  model: PiResponsesModel | undefined,
): ModelDescriptorDefaults | undefined {
  if (!model) return undefined;
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
const hostRecognizedModels = new WeakMap<object, Map<string, string>>();

function recognitionKey(provider: unknown, modelId: unknown): string {
  return `${String(provider)} ${String(modelId)}`;
}

/** What decides whether DSH serves a model of this provider: the endpoint, the protocol and the served model ids. */
function profileFingerprint(profile: ProviderProfile | null | undefined): string {
  const ids = (list: unknown) => Array.isArray(list) ? list.map((entry) => String(entry?.id ?? "")) : [];
  return JSON.stringify([
    profile?.api ?? null,
    profile?.baseURL ?? null,
    ids(profile?.models),
    Object.keys(profile?.modelOverrides ?? {}).sort(),
  ]);
}

/** Record that DSH resolves this exact provider/model under the provider's current profile. */
export function markHostRecognizedModel(ctx: RouteContext | null | undefined, provider: unknown, modelId: unknown): void {
  const owner: unknown = ctx;
  if (owner === null || typeof owner !== "object") return;
  let known = hostRecognizedModels.get(owner);
  if (known === undefined) hostRecognizedModels.set(owner, known = new Map());
  if (known.size >= 256) known.clear();
  known.set(recognitionKey(provider, modelId), profileFingerprint(configuredProviderProfile(ctx, String(provider))));
}

function hostRecognizesModel(ctx: RouteContext | null | undefined, profile: ProviderProfile | null | undefined, provider: unknown, modelId: unknown): boolean {
  const owner: unknown = ctx;
  if (owner === null || typeof owner !== "object") return false;
  return hostRecognizedModels.get(owner)?.get(recognitionKey(provider, modelId)) === profileFingerprint(profile);
}

/**
 * A nonempty `models` list replaces the served catalog: DSH serves exactly the listed models, and LCX answers
 * `llm/stream` before DSH's adapter does, so a claim here would send a request DSH itself refuses.
 */
function profileExcludesModel(profile: ProviderProfile | null | undefined, modelId: unknown): boolean {
  return Array.isArray(profile?.models) && profile.models.length > 0 &&
    !profile.models.some((entry) => String(entry?.id ?? "") === String(modelId));
}

/**
 * DSH serves a model its catalog does not describe only when the profile lists it in `models`, or, for a profile
 * with no `models` list, when its own (newer) catalog describes it; the latter is visible to a plugin only as a
 * successful `resolveModelInfo`. A nonempty `models` list is authoritative: DSH serves exactly the listed models,
 * so a remembered recognition never widens it.
 */
function dshServesModel(ctx: RouteContext | null | undefined, profile: ProviderProfile | null | undefined, provider: unknown, modelId: unknown): boolean {
  if (Array.isArray(profile?.models) && profile.models.length > 0)
    return profile.models.some((entry) => String(entry?.id ?? "") === String(modelId));
  return hostRecognizesModel(ctx, profile, provider, modelId);
}

function configuredModelProfile(
  profile: ProviderProfile | null | undefined,
  modelId: unknown,
): ProviderModelProfile | undefined {
  const configuredModels = Array.isArray(profile?.models) ? profile.models : [];
  return configuredModels.length > 0
    ? configuredModels.find((entry) => String(entry?.id ?? "") === String(modelId))
    : profile?.modelOverrides?.[String(modelId)];
}

/** @param {ProviderProfile | null | undefined} profile @param {unknown} modelId @returns {ResponsesCompat | undefined} */
function configuredResponsesCompat(profile: ProviderProfile | null | undefined, modelId: unknown): ResponsesCompat | undefined {
  const compat: ResponsesCompat = {};
  copyResponsesCompat(compat, profile?.compat);
  copyResponsesCompat(compat, configuredModelProfile(profile, modelId)?.compat);
  return Object.keys(compat).length ? compat : undefined;
}

const MODEL_THINKING_LEVELS: readonly ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function profileReasoning(value: unknown): ModelThinkingLevel | undefined {
  return MODEL_THINKING_LEVELS.find((level) => level === value);
}

/**
 * The reasoning projection of a model whose profile entry declares `reasoningEfforts` (the mapping
 * from DSH levels to wire spellings, or `false` for a non-reasoning model); undefined when the
 * profile says nothing, so the caller falls back to the catalog or to what DSH resolved.
 */
function declaredReasoningControls(
  profile: ProviderProfile,
  modelId: string,
): ModelControlProjection | undefined {
  const efforts = configuredModelProfile(profile, modelId)?.reasoningEfforts;
  if (efforts === undefined) return undefined;
  if (efforts === false) return { reasoning: false };
  if (!isRecord(efforts)) return { reasoning: false };
  const thinkingLevelMap: Partial<
    Record<ModelThinkingLevel, string | null>
  > = {};
  let offOmitsReasoning = false;
  for (const level of MODEL_THINKING_LEVELS) {
    const value = efforts[level];
    if (value === undefined) thinkingLevelMap[level] = null;
    else if (value === null) {
      // DSH permits only off:null: it means supported-off by omitting the wire option. Pi 1.1.0 would
      // read an absent `off` as "send none", so the omission is made explicit here.
      thinkingLevelMap[level] = null;
      if (level === "off") offOmitsReasoning = true;
    } else if (typeof value === "string") thinkingLevelMap[level] = value;
  }
  return {
    reasoning: true,
    thinkingLevelMap,
    ...(offOmitsReasoning ? { offOmitsReasoning: true } : {}),
  };
}

function configuredModelControls(
  profile: ProviderProfile,
  modelId: string,
  base: PiResponsesModel | undefined,
): ModelControlProjection {
  return (
    declaredReasoningControls(profile, modelId) ?? {
      reasoning: base?.reasoning ?? false,
      ...(base?.thinkingLevelMap === undefined
        ? {}
        : { thinkingLevelMap: base.thinkingLevelMap }),
    }
  );
}

function isLcxCapabilityRoute(
  provider: string,
  model: string,
): boolean {
  return provider === "lcx" &&
    /^gpt-5\.6-(?:sol|luna|terra)$/iu.test(model);
}

/** Resolve only the selected DSH profile; policy cannot supply route identity or credentials. */
export function resolveResponsesRouteConfig(ctx: RouteContext | null | undefined, options: RouteOptions & { purpose?: string }, policy: RoutePolicy): ResolvedResponsesRoute | undefined {
  const provider = String(options?.provider ?? ""); const model = String(options?.model ?? "");
  if (!provider.trim() || !/^gpt-/iu.test(model)) return undefined;
  const profile = configuredProviderProfile(ctx, provider);
  const lcxCapabilityRoute = isLcxCapabilityRoute(provider, model);
  if (!isRecord(profile)) return undefined;
  const configured = profile;
  if (profileExcludesModel(configured, model)) return undefined;
  // Protocol and endpoint: the profile, then what DSH resolves for the model (see `resolveCatalogModel`).
  const catalog = resolveCatalogModel(provider, model, dshServesModel(ctx, configured, provider, model));
  const builtin = catalog.descriptor;
  const api = configured.api ?? catalog.api;
  if (api !== "openai-responses") return undefined;
  const baseURL = configured.baseURL ?? catalog.baseUrl;
  const apiKeyEnv = configured.apiKeyEnv;
  if (typeof baseURL !== "string" || !normalizeBaseURL(baseURL) || typeof apiKeyEnv !== "string" || !apiKeyEnv.trim()) return undefined;
  const responsesCompat: ResponsesCompat = {};
  copyResponsesCompat(responsesCompat, builtin?.compat); copyResponsesCompat(responsesCompat, lcxCapabilityRoute ? policy.responsesCompat : undefined); copyResponsesCompat(responsesCompat, configuredResponsesCompat(configured, model));
  const promptCacheModel = lcxCapabilityRoute && policy.supportsExplicitPromptCacheMode === true ? resolveCatalogModel("openai", model).descriptor : undefined;
  const promptCacheRaw: unknown = promptCacheModel;
  const promptCacheCompat = isRecord(promptCacheRaw)
    ? promptCacheRaw.compat
    : undefined;
  if (
    isRecord(promptCacheCompat) &&
    promptCacheCompat.supportsExplicitPromptCacheMode === true &&
    responsesCompat.supportsExplicitPromptCacheMode === undefined
  )
    responsesCompat.supportsExplicitPromptCacheMode = true;
  const resolvedCompat = Object.keys(responsesCompat).length ? responsesCompat : undefined;
  const supportsLongCacheRetention = resolvedCompat?.supportsLongCacheRetention ?? (lcxCapabilityRoute && policy.supportsLongCacheRetention === true);
  responsesCompat.supportsLongCacheRetention = supportsLongCacheRetention;
  const configuredRetention = configured.cacheRetention;
  const fallbackRetention = lcxCapabilityRoute ? policy.cacheRetention : undefined;
  const requestedRetention: CacheRetention | undefined = configuredRetention === "none" || configuredRetention === "short" || configuredRetention === "long" ? configuredRetention : fallbackRetention === "none" || fallbackRetention === "short" || fallbackRetention === "long" ? fallbackRetention : undefined;
  const cacheRetention: CacheRetention = requestedRetention === "long" && !supportsLongCacheRetention ? "short" : requestedRetention ?? (supportsLongCacheRetention ? "long" : "short");
  const declaredControls = declaredReasoningControls(configured, model);
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
    // Only a declared `reasoningEfforts` is projected here; an undeclared model follows the catalog
    // and what DSH resolved for it (see `routeModelOverride`).
    ...(declaredControls === undefined ? {} : { modelControls: declaredControls }),
    // These are explicitly LCX-owned transport and request-capability policies.
    timeoutMs: isPositiveInteger(configured.timeoutMs) ? configured.timeoutMs : policy.timeoutMs,
    maxAttempts: retryAttempts(configured.retryPolicy, policy.maxAttempts),
    maxRequestImageBytes: isPositiveInteger(configured.maxRequestImageBytes) ? configured.maxRequestImageBytes : policy.maxRequestImageBytes,
    requestImagePixelBudget: isPositiveInteger(configured.requestImagePixelBudget) ? configured.requestImagePixelBudget : policy.requestImagePixelBudget,
    requestImageMaxBytes: isPositiveInteger(configured.requestImageMaxBytes) ? configured.requestImageMaxBytes : policy.requestImageMaxBytes,
  };
}

/** Why a GPT request could not be resolved to an authenticated Responses route. */
export type ResponsesRouteDiagnosis = "no-profile" | "model-not-configured" | "api-unresolved" | "api-not-responses" | "incomplete";

/**
 * Name the reason `resolveResponsesRouteConfig` returned nothing, so the failure can tell the user what to
 * change: `api-unresolved` means neither the profile nor the model catalog names a protocol for this model.
 */
export function diagnoseResponsesRoute(ctx: RouteContext | null | undefined, options: RouteOptions): ResponsesRouteDiagnosis {
  const provider = String(options?.provider ?? ""); const model = String(options?.model ?? "");
  const profile = provider.trim() ? configuredProviderProfile(ctx, provider) : undefined;
  if (!isRecord(profile)) return "no-profile";
  if (profileExcludesModel(profile, model)) return "model-not-configured";
  const api = profile.api ?? resolveCatalogModel(provider, model, dshServesModel(ctx, profile, provider, model)).api;
  if (api === undefined) return "api-unresolved";
  return api === "openai-responses" ? "incomplete" : "api-not-responses";
}

/** Resolve a Grok-prefixed model through its selected DSH Responses profile. */
export function resolveGrokResponsesRouteConfig(
  ctx: RouteContext | null | undefined,
  options: RouteOptions,
  policy: RoutePolicy,
): ResolvedResponsesRoute | undefined {
  const provider = String(options?.provider ?? "");
  const model = String(options?.model ?? "");
  if (!provider.trim() || !/^grok/iu.test(model)) return undefined;
  const configured = configuredProviderProfile(ctx, provider);
  if (!isRecord(configured)) return undefined;
  if (profileExcludesModel(configured, model)) return undefined;
  const catalog = resolveCatalogModel(provider, model, dshServesModel(ctx, configured, provider, model));
  const selectedBuiltin = catalog.descriptor;
  const api = configured.api ?? catalog.api;
  if (api !== "openai-responses") return undefined;
  const baseURL = configured.baseURL ?? catalog.baseUrl;
  const apiKeyEnv = configured.apiKeyEnv;
  if (
    typeof baseURL !== "string" ||
    !normalizeBaseURL(baseURL) ||
    typeof apiKeyEnv !== "string" ||
    !apiKeyEnv.trim()
  )
    return undefined;
  const responsesCompat: ResponsesCompat = {};
  copyResponsesCompat(responsesCompat, selectedBuiltin?.compat);
  copyResponsesCompat(responsesCompat, configuredResponsesCompat(configured, model));
  const supportsLongCacheRetention =
    responsesCompat.supportsLongCacheRetention === true;
  responsesCompat.supportsLongCacheRetention = supportsLongCacheRetention;
  const requestedRetention = configured.cacheRetention;
  const cacheRetention: CacheRetention =
    requestedRetention === "none"
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
    timeoutMs: isPositiveInteger(configured.timeoutMs)
      ? configured.timeoutMs
      : undefined,
    streamIdleTimeoutMs: isPositiveFinite(configured.streamIdleTimeoutMs)
      ? configured.streamIdleTimeoutMs
      : 300_000,
    maxAttempts: retryAttempts(configured.retryPolicy, policy.maxAttempts),
    maxRequestImageBytes: isPositiveInteger(configured.maxRequestImageBytes)
      ? configured.maxRequestImageBytes
      : policy.maxRequestImageBytes,
    requestImagePixelBudget: isPositiveInteger(configured.requestImagePixelBudget)
      ? configured.requestImagePixelBudget
      : policy.requestImagePixelBudget,
    requestImageMaxBytes: isPositiveInteger(configured.requestImageMaxBytes)
      ? configured.requestImageMaxBytes
      : policy.requestImageMaxBytes,
  };
}

/** @param {RouteContext | null | undefined} ctx @param {Pick<ResolvedResponsesRoute, 'apiKeyEnv'>} config */
export async function resolveApiKey(ctx: RouteContext | null | undefined, config: Pick<ResolvedResponsesRoute, "apiKeyEnv">): Promise<string> {
  const resolved = await ctx?.credentials.resolve(credentialRef(config.apiKeyEnv));
  if (resolved?.value.trim()) return resolved.value.trim();
  const error: LcxError = new Error(
    `DSH provider credential is unavailable: ${config.apiKeyEnv}`,
  );
  error.code = "LCX_CREDENTIAL_UNAVAILABLE";
  throw error;
}

function setHeaderCaseInsensitive(
  headers: HeaderMap,
  name: string,
  value: string,
): void {
  const normalized = name.toLowerCase();
  for (const existing of Object.keys(headers))
    if (existing.toLowerCase() === normalized) delete headers[existing];
  headers[name] = value;
}

/** Apply DSH's case-insensitive attribution reservation at profile resolution. */
function effectiveGrokProfileHeaders(
  configured: HeaderMap | null | undefined,
): HeaderMap {
  const attribution = attributionHeaders();
  const reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));
  const effective: HeaderMap = {};
  for (const [name, value] of Object.entries(configured ?? {}))
    if (!reserved.has(name.toLowerCase()))
      setHeaderCaseInsensitive(effective, name, value);
  return effective;
}

/** @param {HeaderMap | null | undefined} headers @param {string} name */
function hasHeader(headers: HeaderMap | null | undefined, name: string): boolean { return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === name.toLowerCase()); }
/** @param {HeaderMap | null | undefined} headers */
function hasExplicitSessionAffinity(headers: HeaderMap | null | undefined): boolean { return ["session-id", "session_id", "x-session-id"].some((name) => hasHeader(headers, name)); }
/** @param {Partial<ResolvedResponsesRoute> | null | undefined} config */
function sessionAffinityFormat(config: Partial<ResolvedResponsesRoute> | null | undefined): "none" | "openai" | "openai-nosession" | "openrouter" {
  if (config?.api && config.api !== "openai-responses") return "none";
  const explicit = config?.responsesCompat?.sessionAffinityFormat;
  if (explicit === "openai" || explicit === "openai-nosession" || explicit === "openrouter") return explicit;
  return String(config?.provider ?? "").toLowerCase() === "openrouter" ||
    String(config?.baseURL ?? "").toLowerCase().includes("openrouter.ai")
    ? "openrouter"
    : "openai";
}

/** @param {RouteContext | null | undefined} ctx @param {ResolvedResponsesRoute} config @param {unknown} sessionId @param {string | null | undefined} requestId @returns {Promise<HeaderMap>} */
export async function authenticatedHeaders(ctx: RouteContext | null | undefined, config: ResolvedResponsesRoute, sessionId: unknown, requestId: string | null | undefined): Promise<HeaderMap> {
  const explicit = { ...(config.headers ?? {}) };
  const headers: HeaderMap = {
    ...attributionHeaders(),
    authorization: `Bearer ${await resolveApiKey(ctx, config)}`,
  };
  const sid = sessionId ? String(sessionId) : undefined; const format = sessionAffinityFormat(config);
  if (sid && !hasExplicitSessionAffinity(explicit)) { if (format === "openai") headers.session_id = sid; else if (format === "openrouter") headers["x-session-id"] = sid; }
  if (requestId !== null && !hasHeader(explicit, "x-client-request-id")) { const correlation = requestId ?? (sid && (format === "openai" || format === "openai-nosession") ? sid : !sid ? randomUUID() : undefined); if (correlation) headers["x-client-request-id"] = correlation; }
  return { ...headers, ...explicit };
}

/** Grok mirrors Pi createClient ordering without changing accepted GPT headers. */
export async function authenticatedGrokHeaders(
  ctx: RouteContext | null | undefined,
  config: ResolvedResponsesRoute,
  sessionId: unknown,
): Promise<HeaderMap> {
  const explicit = effectiveGrokProfileHeaders(config.headers);
  const headers: HeaderMap = {
    authorization: `Bearer ${await resolveApiKey(ctx, config)}`,
  };
  const sid = sessionId ? String(sessionId) : undefined;
  const format = sessionAffinityFormat(config);
  if (sid) {
    if (format === "openai") headers.session_id = sid;
    else if (format === "openrouter") headers["x-session-id"] = sid;
    if (format === "openai" || format === "openai-nosession")
      headers["x-client-request-id"] = sid;
  }
  for (const [name, value] of Object.entries(explicit))
    setHeaderCaseInsensitive(headers, name, value);
  for (const [name, value] of Object.entries(attributionHeaders()))
    setHeaderCaseInsensitive(headers, name, value);
  return headers;
}

/** @param {RouteOptions | null | undefined} options @param {Pick<UnresolvedRouteConfig, 'provider' | 'model' | 'baseURL'>} config @returns {RouteIdentity} */
export function currentRoute(options: RouteOptions | null | undefined, config: Pick<UnresolvedRouteConfig, "provider" | "model" | "baseURL">): RouteIdentity {
  return { provider: String(options?.provider ?? config.provider ?? ""), model: String(options?.model ?? config.model ?? ""), baseURL: normalizeBaseURL(config.baseURL), sessionId: String(options?.sessionId ?? "") };
}

/** @param {RequestHeader | null | undefined} header @param {Partial<RouteIdentity> | null | undefined} route @returns {GenerationControls} */
export function generationControlsFromHeader(header: RequestHeader | null | undefined, route: Partial<RouteIdentity> | null | undefined): GenerationControls {
  const config = header?.config;
  if (!config || String(config.provider ?? "") !== String(route?.provider ?? "") || String(config.model ?? "") !== String(route?.model ?? "")) return {};
  const controls: GenerationControls = {}; if (config.reasoningEffort !== undefined) controls.reasoningEffort = config.reasoningEffort; if (config.temperature !== undefined) controls.temperature = config.temperature; if (config.maxTokens !== undefined) controls.maxTokens = config.maxTokens; return controls;
}

/** @param {RouteSession | null | undefined} session @param {Partial<RouteIdentity> | null | undefined} route @returns {GenerationControls} */
export function generationControlsFromSession(session: RouteSession | null | undefined, route: Partial<RouteIdentity> | null | undefined): GenerationControls {
  try { return generationControlsFromHeader(session?.requestHeader?.(), route); } catch { return {}; }
}

/** @param {CheckpointRouteRecord | null | undefined} record @param {RouteIdentity} route @param {unknown} ctx */
export function routeCompatible(record: CheckpointRouteRecord | null | undefined, route: RouteIdentity, ctx: unknown): boolean {
  void ctx;
  return !!record && record.version === 5 && record.provider === route.provider && record.model === route.model && record.baseURLFingerprint === baseURLFingerprint(route.baseURL) && record.sourceSessionId === route.sessionId;
}
