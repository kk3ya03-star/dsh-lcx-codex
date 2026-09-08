import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {
  GenerateOptions,
  LlmRuntime,
  Message,
  StreamChunk,
} from "@deepseek-ai/dsh-llm";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type {
  ToolDefinition,
  ToolDispatchExecution,
  ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import type { WebSearchRequest, WebSearchResult } from "@deepseek-ai/dsh-web";
import {
  WEB_SEARCH_MAX_QUERIES,
  applyWebSearchTool,
} from "@deepseek-ai/dsh-tool-web";
import "@deepseek-ai/dsh-agent";
import "@deepseek-ai/dsh-tools";
import "@deepseek-ai/dsh-web";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { fetchJsonWithRetry } from "./transport.js";
import {
  agentSessionId,
  agentUsesSession,
  compactionConfigState,
  compactionPatchCandidate,
  contextService,
  installCompactionPatch,
  patchCompactionConfig,
  patchToolResultPruner,
  readAgentRouteState,
  resolveAgentService,
  resolveContextService,
  resolveScopedService,
  restoreCompactionConfig,
  restoreCompactionPatches,
  restoreToolResultPruner,
  sessionFor,
  sessionFromAgent,
  sessionsService,
  scopedToolRuntime,
  tokenMeterTotal,
  toolResultPrunerState,
} from "./dsh-compat.js";
import type { CompactionPatchRecords } from "./dsh-compat.js";
import {
  authenticatedGrokHeaders,
  authenticatedHeaders,
  currentRoute,
  generationControlsFromSession,
  grokPromptCacheSessionId,
  promptCacheKey,
  promptCacheRetention,
  promptCacheSessionId,
  resolveGrokResponsesRouteConfig,
  resolveResponsesRouteConfig,
  routeFingerprint,
} from "./route.js";
import type { ResolvedResponsesRoute, RouteContext } from "./route.js";
import {
  DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  hydrateNativeImageReferences,
  resolveModelImageSupport,
  responseInputItems,
  serializeDshMessages,
} from "./dsh-responses.js";
import { mergeFeatureHeader, requestNativeCompaction } from "./compact-v2.js";
import { buildResponsesBody } from "./responses-request.js";
import {
  managedFailureChunk,
  streamResponsesRequest,
} from "./responses-stream.js";
import {
  assertSupportedCheckpointMessage,
  checkpointStateForMessage,
  compactCheckpointId,
  createNativeCheckpointBlock,
  nativeCheckpointChunks,
  portableMessagesForCheckpoint,
  stateRouteCompatible,
} from "./native-checkpoint.js";
import {
  HOSTED_SEARCH_OUTPUT,
  HOSTED_SEARCH_PARAMETERS,
  buildHostedSearchBody,
  normalizeHostedSearchArgs,
  parseHostedSearchResponse,
  renderHostedSearchResult,
} from "./web-search-hosted.js";
import {
  ALPHA_SCHEMA_FINGERPRINT,
  alphaRefRequiresStore,
  isAlphaContinuationUrl,
  isAlphaHttpUrl,
  ALPHA_SEARCH_OUTPUT,
  ALPHA_SEARCH_PARAMETERS,
  buildAlphaSearchBody,
  normalizeAlphaSearchArgs,
  parseAlphaSearchResponse,
  renderAlphaSearchResult,
} from "./web-search-alpha.js";
import {
  AlphaCapabilityStore,
  alphaCapabilityFingerprint,
  alphaCapabilityUsable,
} from "./web-search-capability.js";
import { AlphaRefStore } from "./web-search-ref-store.js";
import { ServiceMutex } from "./service-mutex.js";
import {
  GROK_NATIVE_SERVER_TOOL_TYPES,
  grokNativeSearchEnabled,
  grokVisibleFunctionTools,
  grokWireTools,
  restoreGrokNativeReplay,
  type GrokNativeReplayRoute,
  type GrokNativeSearchState,
} from "./grok-native-search.js";

export const name = "lcx-codex";
export const inject = ["llm", "web", "sessions", "tools", "settings", "credentials", "attachments", "fs"];
const SETTINGS_NS = "lcx-codex";
const ADVANCED_HOSTED_TOOL = "websearch_gpt_advanced";
const ALPHA_TOOL = "websearch_alpha";
const hostedSearchRouteContext = new AsyncLocalStorage<RouteRequest>();
const WEB_SEARCH_TIMEOUT_MS = 240_000;
const AUTO_COMPACTION_THRESHOLD_PERCENT = 90;
const EMERGENCY_PRUNE_THRESHOLD_PERCENT = 95;

type ConfigInput = {
  supportsLongCacheRetention?: unknown;
  supportsExplicitPromptCacheMode?: unknown;
  alphaCapabilityPath?: unknown;
  alphaRefPath?: unknown;
  alphaProfile?: unknown;
  alphaGroup?: unknown;
  alphaMaxOutputTokens?: unknown;
  webSearchProvider?: unknown;
  webMaxResults?: unknown;
  timeoutMs?: unknown;
  maxResponseBytes?: unknown;
  maxAttempts?: unknown;
  maxRequestImageBytes?: unknown;
  requestImagePixelBudget?: unknown;
  requestImageMaxBytes?: unknown;
  portableReplayMaxChars?: unknown;
  nativeRetentionTokenBudget?: unknown;
  assistantRetentionTokenReserve?: unknown;
  assistantRetentionPerMessageTokenCap?: unknown;
};

type NormalizedConfig = {
  supportsLongCacheRetention: boolean;
  supportsExplicitPromptCacheMode: boolean;
  alphaCapabilityPath: string;
  alphaRefPath: string;
  alphaProfile: string;
  alphaGroup: string;
  alphaMaxOutputTokens: number;
  webSearchProvider: string;
  webMaxResults: number;
  timeoutMs: number;
  maxResponseBytes: number;
  maxAttempts: number;
  maxRequestImageBytes: number;
  requestImagePixelBudget: number;
  requestImageMaxBytes: number;
  portableReplayMaxChars: number;
  nativeRetentionTokenBudget: number;
  assistantRetentionTokenReserve: number;
  assistantRetentionPerMessageTokenCap: number;
};

type ResponsesRouteConfig = ResolvedResponsesRoute &
  Pick<
    NormalizedConfig,
    | "alphaGroup"
    | "alphaMaxOutputTokens"
    | "alphaProfile"
    | "assistantRetentionPerMessageTokenCap"
    | "assistantRetentionTokenReserve"
    | "maxRequestImageBytes"
    | "maxResponseBytes"
    | "nativeRetentionTokenBudget"
    | "portableReplayMaxChars"
    | "requestImageMaxBytes"
    | "requestImagePixelBudget"
    | "webMaxResults"
  >;

type RouteRequest = {
  provider: string;
  model: string;
  sessionId: string;
};

function positiveInteger(value: unknown, fallback: number, maximum?: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    return fallback;
  return maximum === undefined ? value : Math.min(value, maximum);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function routeWithPolicies(
  route: ResolvedResponsesRoute,
  config: NormalizedConfig,
): ResponsesRouteConfig {
  return {
    ...route,
    alphaProfile: config.alphaProfile,
    alphaGroup: config.alphaGroup,
    alphaMaxOutputTokens: config.alphaMaxOutputTokens,
    assistantRetentionPerMessageTokenCap:
      config.assistantRetentionPerMessageTokenCap,
    assistantRetentionTokenReserve: config.assistantRetentionTokenReserve,
    maxRequestImageBytes: route.maxRequestImageBytes ?? config.maxRequestImageBytes,
    maxResponseBytes: config.maxResponseBytes,
    nativeRetentionTokenBudget: config.nativeRetentionTokenBudget,
    portableReplayMaxChars: config.portableReplayMaxChars,
    requestImageMaxBytes: route.requestImageMaxBytes ?? config.requestImageMaxBytes,
    requestImagePixelBudget: route.requestImagePixelBudget ?? config.requestImagePixelBudget,
    webMaxResults: config.webMaxResults,
  };
}

function grokReplayRoute(
  route: { provider: string; model: string; baseURL: string; sessionId: string },
  config: Pick<ResponsesRouteConfig, "apiKeyEnv" | "headers">,
): GrokNativeReplayRoute {
  return {
    ...route,
    apiKeyEnv: config.apiKeyEnv,
    headers: config.headers,
  };
}

type HostAgent = Agent;
type HostExecution = ToolDispatchExecution;
type HostContext = Context;

type AlphaCapabilityRecord = {
  classification: unknown;
  schemaFingerprint?: unknown;
};

type AlphaToolRegistration = {
  fingerprint: unknown;
  dispose: () => void;
};

type AlphaToolRegistry = Map<object, AlphaToolRegistration>;
type GptToolRegistration = {
  fingerprint: string;
  dispose: () => void;
};
type GptToolRegistry = Map<object, GptToolRegistration>;
type SettingsState = {
  enabled: boolean;
  webSearch: boolean;
  advancedHostedSearch: boolean;
  alphaSearch: boolean;
  grokNativeWebSearch: boolean;
  grokNativeXSearch: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function asAbortSignal(value: unknown): AbortSignal | undefined {
  return value instanceof AbortSignal ? value : undefined;
}

function errorDetails(value: unknown): {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  message?: unknown;
} {
  return isRecord(value)
      ? {
          name: value.name,
          code: value.code,
          status: value.status,
          message: value.message,
        }
      : {};
}

function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}
function defaultAlphaCapabilityPath() {
  return join(
    dshHome(),
    "storages",
    "lcx-codex",
    "web-alpha-capabilities.json",
  );
}
function defaultAlphaRefPath() {
  return join(dshHome(), "storages", "lcx-codex", "web-alpha-refs.json");
}

export const Config = z.object({
  supportsLongCacheRetention: z.boolean().default(false),
  supportsExplicitPromptCacheMode: z.boolean().default(false),
  alphaCapabilityPath: z.string().default(""),
  alphaRefPath: z.string().default(""),
  alphaProfile: z.string().default(""),
  alphaGroup: z.string().default(""),
  alphaMaxOutputTokens: z.number().default(2500),
  webSearchProvider: z.string().default("lcx-responses"),
  webMaxResults: z.number().default(8),
  timeoutMs: z.number().default(300000),
  maxResponseBytes: z.number().default(8 * 1024 * 1024),
  maxAttempts: z.number().default(3),
  maxRequestImageBytes: z.number().default(DEFAULT_MAX_REQUEST_IMAGE_BYTES),
  requestImagePixelBudget: z
    .number()
    .default(DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET),
  requestImageMaxBytes: z.number().default(DEFAULT_REQUEST_IMAGE_MAX_BYTES),
  portableReplayMaxChars: z.number().default(80_000),
  nativeRetentionTokenBudget: z.number().default(64_000),
  assistantRetentionTokenReserve: z.number().default(24_000),
  assistantRetentionPerMessageTokenCap: z.number().default(3_000),
});

const SettingsSchema = z.object({
  enabled: z.boolean().default(false),
  webSearch: z.boolean().default(false),
  advancedHostedSearch: z.boolean().default(false),
  alphaSearch: z.boolean().default(false),
  grokNativeWebSearch: z.boolean().default(false),
  grokNativeXSearch: z.boolean().default(false),
});

function normalizeConfig(input: ConfigInput = {}): NormalizedConfig {
  return {
    supportsLongCacheRetention: input.supportsLongCacheRetention === true,
    supportsExplicitPromptCacheMode:
      input.supportsExplicitPromptCacheMode === true,
    alphaCapabilityPath: stringValue(
      input.alphaCapabilityPath,
      defaultAlphaCapabilityPath(),
    ),
    alphaRefPath: stringValue(input.alphaRefPath, defaultAlphaRefPath()),
    alphaProfile: String(input.alphaProfile ?? ""),
    alphaGroup: String(input.alphaGroup ?? ""),
    alphaMaxOutputTokens: positiveInteger(input.alphaMaxOutputTokens, 2500, 32_000),
    webSearchProvider: stringValue(input.webSearchProvider, "lcx-responses"),
    webMaxResults: positiveInteger(input.webMaxResults, 8),
    timeoutMs: positiveInteger(input.timeoutMs, 300000),
    maxResponseBytes: positiveInteger(input.maxResponseBytes, 8 * 1024 * 1024),
    maxAttempts: positiveInteger(input.maxAttempts, 3, 6),
    maxRequestImageBytes: positiveInteger(
      input.maxRequestImageBytes,
      DEFAULT_MAX_REQUEST_IMAGE_BYTES,
    ),
    requestImagePixelBudget: positiveInteger(
      input.requestImagePixelBudget,
      DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    ),
    requestImageMaxBytes: positiveInteger(
      input.requestImageMaxBytes,
      DEFAULT_REQUEST_IMAGE_MAX_BYTES,
    ),
    portableReplayMaxChars: positiveInteger(input.portableReplayMaxChars, 80_000),
    nativeRetentionTokenBudget: positiveInteger(
      input.nativeRetentionTokenBudget,
      64_000,
    ),
    assistantRetentionTokenReserve:
      typeof input.assistantRetentionTokenReserve === "number" &&
      Number.isSafeInteger(input.assistantRetentionTokenReserve) &&
      input.assistantRetentionTokenReserve >= 0
        ? input.assistantRetentionTokenReserve
        : 24_000,
    assistantRetentionPerMessageTokenCap: positiveInteger(
      input.assistantRetentionPerMessageTokenCap,
      3_000,
    ),
  };
}

function webError(message: string | undefined, code: string, cause?: unknown) {
  const error = new Error(message, cause === undefined ? undefined : { cause }) as Error & {
    code: string;
  };
  error.name = "WebError";
  error.code = code;
  return error;
}

function routeConfigValue(value: unknown, name: "provider" | "model"): unknown {
  return isRecord(value) ? value[name] : undefined;
}

function activeAgentRoute(exec: HostExecution): RouteRequest {
  const route = readAgentRouteState(exec.agent);
  return {
    provider: stringValue(
      routeConfigValue(route.requestConfig, "provider") ??
        routeConfigValue(route.options, "provider"),
      "",
    ),
    model: stringValue(
      routeConfigValue(route.requestConfig, "model") ??
        routeConfigValue(route.options, "model"),
      "",
    ),
    sessionId: route.sessionId,
  };
}

function selectedAgentRoute(agent: HostAgent): RouteRequest {
  const route = readAgentRouteState(agent);
  return {
    provider: stringValue(
      routeConfigValue(route.requestConfig, "provider") ??
        routeConfigValue(route.options, "provider"),
      "",
    ),
    model: stringValue(
      routeConfigValue(route.requestConfig, "model") ??
        routeConfigValue(route.options, "model"),
      "",
    ),
    sessionId: route.sessionId,
  };
}

type SerializedDshMessages = Awaited<ReturnType<typeof serializeDshMessages>>;
type ImageAttachmentMap = SerializedDshMessages["imageMap"];
type ImageSupport = Awaited<ReturnType<typeof resolveModelImageSupport>>;

function requestImageOptions(
  routeConfig: Pick<
    ResponsesRouteConfig,
    | "maxRequestImageBytes"
    | "requestImageMaxBytes"
    | "requestImagePixelBudget"
  >,
  imageSupport: ImageSupport,
  signal: AbortSignal | undefined,
  imageMap: ImageAttachmentMap | undefined,
  extra: Record<string, unknown> = {},
) {
  return {
    imageSupport,
    signal,
    imageMap,
    maxRequestImageBytes: routeConfig.maxRequestImageBytes,
    requestImagePixelBudget: routeConfig.requestImagePixelBudget,
    requestImageMaxBytes: routeConfig.requestImageMaxBytes,
    ...extra,
  };
}

async function executeHostedSearch(
  ctx: RouteContext,
  routeConfig: ResponsesRouteConfig,
  args: unknown,
  signal: AbortSignal | undefined,
  sessionId = "",
) {
  const normalized = normalizeHostedSearchArgs(args);
  const requestId = randomUUID();
  const route = currentRoute(
    { provider: routeConfig.provider, model: routeConfig.model, sessionId },
    routeConfig,
  );
  const headers = await authenticatedHeaders(
    ctx,
    routeConfig,
    sessionId,
    requestId,
  );
  const searchCacheKey = sessionId
    ? `dsh-lcx-search:${routeFingerprint(route)}`
    : undefined;
  const body = buildHostedSearchBody(normalized, routeConfig.model, {
    promptCacheKey: searchCacheKey,
  });
  const response = await fetchJsonWithRetry(
    `${routeConfig.baseURL}/responses`,
    body,
    headers,
    signal,
    routeConfig.timeoutMs,
    {
      maxAttempts: routeConfig.maxAttempts,
      maxResponseBytes: routeConfig.maxResponseBytes,
    },
  );
  return parseHostedSearchResponse(
    response,
    requestId,
    routeConfig.webMaxResults,
  );
}

class LcxResponsesSearchProvider {
  readonly ctx: RouteContext;
  readonly getConfig: () => NormalizedConfig;
  readonly enabled: () => boolean;
  readonly id: string;

  constructor(
    ctx: RouteContext,
    getConfig: () => NormalizedConfig,
    enabled: () => boolean,
  ) {
    this.ctx = ctx;
    this.getConfig = getConfig;
    this.enabled = enabled;
    this.id = getConfig().webSearchProvider;
  }
  available() {
    const active = hostedSearchRouteContext.getStore();
    if (!active) return false;
    const config = this.getConfig();
    const route = resolveResponsesRouteConfig(
      this.ctx,
      active,
      config,
    );
    return this.enabled() && Boolean(route);
  }
  async search(
    request: WebSearchRequest,
    signal: AbortSignal | undefined,
  ): Promise<WebSearchResult> {
    const config = this.getConfig();
    const active = hostedSearchRouteContext.getStore();
    const route = active && resolveResponsesRouteConfig(this.ctx, active, config);
    const routeConfig = route && routeWithPolicies(route, config);
    if (!routeConfig)
      throw webError(
        "LCX Hosted Search requires a configured GPT openai-responses route",
        "LCX_WEB_ROUTE_UNAVAILABLE",
      );
    const sessionId = active?.sessionId ?? "";
    this.ctx.logger?.info?.(
      `[lcx-codex] web_search route: ${routeConfig.provider}/${routeConfig.model} (active-agent)`,
    );
    const result = await executeHostedSearch(
      this.ctx,
      routeConfig,
      { query: request.query },
      signal,
      sessionId,
    );
    const max = request.maxResults ?? routeConfig.webMaxResults;
    return {
      content: result.content || undefined,
      sources: result.sources.slice(0, max),
      truncated: result.truncated || result.sources.length > max,
    };
  }
}

function createScopedGptWebSearchTool(
  ctx: HostContext,
  state: SettingsState,
  getConfig: () => NormalizedConfig,
  provider: LcxResponsesSearchProvider,
  fetchEnabled: boolean,
): ToolDefinition {
  let definition: ToolDefinition | undefined;
  const composition = {
    web: {
      search: (request: WebSearchRequest, signal?: AbortSignal) =>
        provider.search(request, signal),
    },
    tools: {
      register(candidate: ToolDefinition) {
        definition = candidate;
        return () => {};
      },
    },
    systemPrompt: {
      getSectionOrder: () => 0,
      section: () => () => {},
    },
  };
  applyWebSearchTool(
    composition as unknown as HostContext,
    getConfig().webMaxResults,
    WEB_SEARCH_MAX_QUERIES,
    WEB_SEARCH_TIMEOUT_MS,
    fetchEnabled,
  );
  if (!definition)
    throw new Error("DSH web_search composition did not register a tool");
  const execute = definition.execute.bind(definition);
  return {
    ...definition,
    async execute(args: unknown, exec: ToolRunContext) {
      if (!state.enabled || !state.webSearch)
        throw webError("web_search GPT Hosted Search is disabled", "LCX_WEB_DISABLED");
      const active = activeAgentRoute(exec);
      const route = resolveResponsesRouteConfig(ctx, active, getConfig());
      if (!route)
        throw webError(
          "GPT Hosted Search requires the active GPT openai-responses route",
          "LCX_WEB_ROUTE_UNAVAILABLE",
        );
      return hostedSearchRouteContext.run(active, () => execute(args, exec));
    },
  };
}

function createAdvancedHostedTool(
  ctx: HostContext,
  state: {
    enabled: boolean;
    webSearch: boolean;
    advancedHostedSearch: boolean;
    alphaSearch?: boolean;
  },
  getConfig: () => NormalizedConfig,
) {
  return {
    name: ADVANCED_HOSTED_TOOL,
    description:
      "Advanced GPT Responses Hosted Search. Use DSH web_search for ordinary lookup. Call this only when you need domain allow/block filters, approximate user location, search-context size, image search, external-web-access or return-token-budget controls. It is one-shot and has no open/find/click state.",
    parameters: HOSTED_SEARCH_PARAMETERS,
    output: {
      schema: HOSTED_SEARCH_OUTPUT,
      render: (_args: unknown, value: unknown) =>
        renderHostedSearchResult(value),
    },
    async execute(args: unknown, exec: HostExecution) {
      if (!state.enabled || !state.webSearch || !state.advancedHostedSearch)
        throw webError(
          `${ADVANCED_HOSTED_TOOL} is disabled`,
          "LCX_WEB_DISABLED",
        );
      const config = getConfig();
      const active = activeAgentRoute(exec);
      const route = resolveResponsesRouteConfig(ctx, active, config);
      if (!route)
        throw webError(
          "Advanced Hosted Search requires the active GPT openai-responses route",
          "LCX_WEB_ROUTE_UNAVAILABLE",
        );
      return executeHostedSearch(
        ctx,
        routeWithPolicies(route, config),
        args,
        exec.signal,
        active.sessionId,
      );
    },
  };
}

function disposeGptToolsForAgent(
  agent: object,
  registrations: GptToolRegistry,
) {
  const registration = registrations.get(agent);
  if (!registration) return;
  registration.dispose();
  registrations.delete(agent);
}

function syncGptToolsForAgent(
  ctx: HostContext,
  agent: object & HostAgent,
  state: SettingsState,
  getConfig: () => NormalizedConfig,
  provider: LcxResponsesSearchProvider,
  registrations: GptToolRegistry,
) {
  const config = getConfig();
  const active = selectedAgentRoute(agent);
  const route = resolveResponsesRouteConfig(ctx, active, config);
  const webSearch = state.enabled && state.webSearch && Boolean(route);
  const advanced = webSearch && state.advancedHostedSearch;
  if (!webSearch && !advanced) {
    disposeGptToolsForAgent(agent, registrations);
    return false;
  }
  const fingerprint = JSON.stringify({
    provider: route?.provider,
    model: route?.model,
    baseURL: route?.baseURL,
    webSearch,
    advanced,
    webMaxResults: config.webMaxResults,
  });
  if (registrations.get(agent)?.fingerprint === fingerprint) return true;
  disposeGptToolsForAgent(agent, registrations);
  const scopedTools = scopedToolRuntime(agent);
  if (!scopedTools) return false;
  const disposers: Array<() => void> = [];
  try {
    if (webSearch) {
      const fetchEnabled = Boolean(scopedTools.get?.("web_fetch", agent));
      disposers.push(
        scopedTools.register(
          createScopedGptWebSearchTool(
            ctx,
            state,
            getConfig,
            provider,
            fetchEnabled,
          ),
        ),
      );
    }
    if (advanced)
      disposers.push(
        scopedTools.register(createAdvancedHostedTool(ctx, state, getConfig)),
      );
    registrations.set(agent, {
      fingerprint,
      dispose() {
        for (const dispose of disposers.reverse()) dispose();
      },
    });
    return true;
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    ctx.logger?.warn?.(
      `[lcx-codex] GPT search tool composition unavailable: ${errorDetails(error).message ?? String(error)}`,
    );
    return false;
  }
}

function alphaCapabilityFor(
  config: {
    baseURL: unknown;
    provider: unknown;
    model: unknown;
    alphaProfile: unknown;
    alphaGroup: unknown;
  },
  store: { get: (key: string) => AlphaCapabilityRecord | undefined },
) {
  const fingerprint = alphaCapabilityFingerprint({
    baseURL: config.baseURL,
    provider: config.provider,
    model: config.model,
    profile: config.alphaProfile,
    group: config.alphaGroup,
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
  });
  return { fingerprint, record: store.get(fingerprint) };
}

function verifiedAlphaCapabilityForRoute(
  ctx: HostContext,
  active: { provider: unknown; model: unknown; sessionId: string },
  config: NormalizedConfig,
  store: { get: (key: string) => AlphaCapabilityRecord | undefined },
) {
  const resolvedRoute = resolveResponsesRouteConfig(ctx, active, config);
  if (!resolvedRoute) return { route: undefined, usable: false };
  const route = routeWithPolicies(resolvedRoute, config);
  const { fingerprint, record } = alphaCapabilityFor(route, store);
  return {
    route,
    fingerprint,
    record,
    usable:
      alphaCapabilityUsable(record) &&
      record?.schemaFingerprint === ALPHA_SCHEMA_FINGERPRINT,
  };
}

async function executeAlpha(
  ctx: HostContext,
  routeConfig: ResponsesRouteConfig,
  capability: { classification: unknown },
  refStore: {
    assertUsable: (arg0: string, arg1: string, arg2: unknown) => void;
    record: (arg0: string, arg1: string, arg2: unknown[]) => void;
  },
  args: unknown,
  exec: HostExecution,
) {
  const normalized = normalizeAlphaSearchArgs(args);
  if (
    ["open", "find", "screenshot"].includes(normalized.action) &&
    isAlphaHttpUrl(normalized.refId) &&
    !isAlphaContinuationUrl(normalized.refId)
  ) {
    throw webError(
      "Alpha Search direct URLs must be public HTTP(S) targets",
      "LCX_ALPHA_URL_UNAVAILABLE",
    );
  }
  const sessionId = agentSessionId(exec?.agent);
  if (!sessionId)
    throw webError(
      "Alpha Search requires a DSH session",
      "LCX_ALPHA_SESSION_REQUIRED",
    );
  const routeFp = routeFingerprint({
    provider: routeConfig.provider,
    model: routeConfig.model,
    baseURL: routeConfig.baseURL,
    sessionId,
  });
  if (alphaRefRequiresStore(normalized.action, normalized.refId))
    refStore.assertUsable(sessionId, routeFp, normalized.refId);
  const requestId = randomUUID();
  const headers = await authenticatedHeaders(
    ctx,
    routeConfig,
    sessionId,
    requestId,
  );
  let response;
  try {
    response = await fetchJsonWithRetry(
      `${routeConfig.baseURL}/alpha/search`,
      buildAlphaSearchBody(
        normalized,
        routeConfig.model,
        sessionId,
        true,
        routeConfig.alphaMaxOutputTokens,
      ),
      headers,
      exec?.signal,
      routeConfig.timeoutMs,
      {
        maxAttempts: routeConfig.maxAttempts,
        maxResponseBytes: routeConfig.maxResponseBytes,
      },
    );
  } catch (error) {
    const details = errorDetails(error);
    if (
      [404, 405].includes(Number(details.status)) ||
      /channel does not support/iu.test(String(details.message ?? ""))
    )
      throw webError(
        "Alpha Search is not supported by this route",
        "LCX_ALPHA_UNAVAILABLE",
        error,
      );
    throw webError(
      "Alpha Search provider request failed",
      "LCX_ALPHA_PROVIDER_ERROR",
      error,
    );
  }
  const { refRecords, ...result } = parseAlphaSearchResponse(response, {
    action: normalized.action,
    capability: capability.classification,
    requestId,
  });
  refStore.record(
    sessionId,
    routeFp,
    refRecords,
  );
  return result;
}

function createAlphaTool(
  ctx: HostContext,
  state: { enabled: unknown; alphaSearch: unknown },
  getConfig: () => NormalizedConfig,
  capabilityStore: {
    get: (key: string) => AlphaCapabilityRecord | undefined;
  },
  refStore: {
    assertUsable: (sessionId: string, routeFingerprint: string, refId: unknown) => void;
    record: (sessionId: string, routeFingerprint: string, refs: unknown[]) => void;
  },
) {
  return {
    name: ALPHA_TOOL,
    description:
      "Stateful Codex/Alpha web command tool. Use it for search/open/find/click/PDF screenshot and the structured image/finance/weather/sports/time actions. Use DSH web_search for ordinary search, and websearch_gpt_advanced only for Hosted Search controls.",
    parameters: ALPHA_SEARCH_PARAMETERS,
    output: {
      schema: ALPHA_SEARCH_OUTPUT,
      render: (_args: unknown, value: unknown) =>
        renderAlphaSearchResult(value),
    },
    async execute(args: unknown, exec: HostExecution) {
      if (!state.enabled || !state.alphaSearch)
        throw webError(`${ALPHA_TOOL} is disabled`, "LCX_ALPHA_DISABLED");
      const config = getConfig();
      const active = activeAgentRoute(exec);
      const route = resolveResponsesRouteConfig(ctx, active, config);
      if (!route)
        throw webError(
          "Alpha Search requires the active GPT openai-responses route",
          "LCX_ALPHA_ROUTE_UNAVAILABLE",
        );
      const routeConfig = routeWithPolicies(route, config);
      const fingerprint = alphaCapabilityFingerprint({
        baseURL: routeConfig.baseURL,
        provider: routeConfig.provider,
        model: routeConfig.model,
        profile: routeConfig.alphaProfile,
        group: routeConfig.alphaGroup,
        schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
      });
      const capability = capabilityStore.get(fingerprint);
      if (
        !alphaCapabilityUsable(capability) ||
        capability?.schemaFingerprint !== ALPHA_SCHEMA_FINGERPRINT
      )
        throw webError(
          "Alpha Search capability has not been verified for this exact route/schema",
          "LCX_ALPHA_CAPABILITY_UNVERIFIED",
        );
      return executeAlpha(ctx, routeConfig, capability, refStore, args, exec);
    },
  };
}

function syncAlphaToolForAgent(
  ctx: HostContext,
  agent: object & HostAgent,
  state: {
    enabled: unknown;
    webSearch?: boolean;
    advancedHostedSearch?: boolean;
    alphaSearch: unknown;
  },
  getConfig: () => NormalizedConfig,
  capabilityStore: AlphaCapabilityStore,
  refStore: AlphaRefStore,
  registrations: AlphaToolRegistry,
) {
  const previous = registrations.get(agent);
  if (!state.enabled || !state.alphaSearch) {
    disposeAlphaToolForAgent(agent, registrations);
    return false;
  }
  try {
    const config = getConfig();
    const active = selectedAgentRoute(agent);
    const capability = verifiedAlphaCapabilityForRoute(
      ctx,
      active,
      config,
      capabilityStore,
    );
    if (!capability.usable) {
      disposeAlphaToolForAgent(agent, registrations);
      return false;
    }
    if (previous?.fingerprint === capability.fingerprint) return true;
    disposeAlphaToolForAgent(agent, registrations);
    const scopedTools = scopedToolRuntime(agent);
    if (!scopedTools) return false;
    // Alpha is route-bound; global registration would advertise a static record to other routes.
    registrations.set(agent, {
      fingerprint: capability.fingerprint,
      dispose: scopedTools.register(
        createAlphaTool(ctx, state, getConfig, capabilityStore, refStore),
      ),
    });
    return true;
  } catch (error) {
    disposeAlphaToolForAgent(agent, registrations);
    ctx.logger?.warn?.(
      `[lcx-codex] Alpha capability store unavailable: ${errorDetails(error).message ?? String(error)}`,
    );
    return false;
  }
}

function disposeAlphaToolForAgent(
  agent: object,
  registrations: AlphaToolRegistry,
) {
  const registration = registrations.get(agent);
  if (!registration) return;
  registration.dispose();
  registrations.delete(agent);
}

function isDshCompactionDirective(message: Message) {
  return (
    message?.role === "user" &&
    message?.source?.kind === "plugin" &&
    message?.source?.plugin === "dsh-compaction-basic"
  );
}
function stripCompactionDirective(messages: readonly Message[]): Message[] {
  if (messages.length === 0) return [];
  return isDshCompactionDirective(messages.at(-1)!)
    ? messages.slice(0, -1)
    : [...messages];
}

function mergeMap(
  target: Map<unknown, unknown>,
  source: Map<unknown, unknown>,
) {
  for (const [key, value] of source ?? []) target.set(key, value);
}

async function serializeNativeAware(
  messages: readonly Message[],
  route: { provider: string; model: string; baseURL: string; sessionId: string },
  routeConfig: ResponsesRouteConfig,
  ctx: HostContext,
  options: Pick<GenerateOptions, "signal" | "system" | "tools"> & {
    grokNativeReplayRoute?: GrokNativeReplayRoute;
  },
) {
  const session = sessionFor(ctx, route.sessionId);
  const imageSupport = await resolveModelImageSupport(
    ctx,
    route,
    options.signal,
  );
  const input: SerializedDshMessages["input"][number][] = [];
  const imageMap: ImageAttachmentMap = new Map();
  let nativeTools: SerializedDshMessages["tools"];
  let nativeModel: SerializedDshMessages["model"];
  let grammarToolInputProperties: SerializedDshMessages["grammarToolInputProperties"];
  let normal: Message[] = [];
  const serializeOptions = (
    imageMapOverride: ImageAttachmentMap | undefined = undefined,
    extra: Record<string, unknown> = {},
  ) =>
    requestImageOptions(
      routeConfig,
      imageSupport,
      options.signal,
      imageMapOverride,
      {
        route,
        tools: options.tools,
        responsesCompat: routeConfig.responsesCompat,
        ...extra,
      },
    );
  const prelude = await serializeDshMessages(
    [],
    ctx,
    serializeOptions(undefined, {
      systemPrompt: options.system,
      includeSystemPrompt: true,
    }),
  );
  const ephemeralPreludeItemCount = prelude.input.length;
  input.push(...prelude.input);
  nativeTools = prelude.tools;
  nativeModel = prelude.model;
  grammarToolInputProperties = prelude.grammarToolInputProperties;
  const flush = async () => {
    if (!normal.length) return;
    const batch = normal;
    normal = [];
    const serialized = await serializeDshMessages(
      batch,
      ctx,
      serializeOptions(),
    );
    nativeTools = serialized.tools ?? nativeTools;
    nativeModel = serialized.model ?? nativeModel;
    grammarToolInputProperties =
      serialized.grammarToolInputProperties ?? grammarToolInputProperties;
    input.push(...restoreGrokNativeReplay(
      serialized.input,
      batch,
      options.grokNativeReplayRoute,
    ) as SerializedDshMessages["input"]);
    mergeMap(imageMap, serialized.imageMap);
  };
  for (const message of messages ?? []) {
    assertSupportedCheckpointMessage(message);
    const state = session
      ? checkpointStateForMessage(session, message)
      : undefined;
    if (state && session) {
      const checkpointId = compactCheckpointId(message);
      if (!checkpointId) {
        normal.push(message);
        continue;
      }
      await flush();
      if (stateRouteCompatible(state, route, ctx)) {
        const nativeOutput = state.nativeOutput;
        const hydratedMap = new Map();
        const hydrated = await hydrateNativeImageReferences(
          nativeOutput,
          ctx,
          requestImageOptions(
            routeConfig,
            imageSupport,
            options.signal,
            hydratedMap,
          ),
        );
        input.push(...responseInputItems(hydrated));
        mergeMap(imageMap, hydratedMap);
      } else {
        const portable = portableMessagesForCheckpoint(
          session,
          checkpointId,
          { maxChars: routeConfig.portableReplayMaxChars },
        );
        const serialized = await serializeDshMessages(
          portable,
          ctx,
          serializeOptions(),
        );
        input.push(...serialized.input);
        mergeMap(imageMap, serialized.imageMap);
      }
      continue;
    }
    normal.push(message);
  }
  await flush();
  if (!nativeModel)
    throw Object.assign(
      new Error("LCX could not resolve the Pi Responses model descriptor"),
      { code: "LCX_RESPONSES_MODEL_UNAVAILABLE" },
    );
  return {
    input,
    ephemeralPreludeItemCount,
    imageMap,
    imageSupport,
    tools: nativeTools,
    model: nativeModel,
    grammarToolInputProperties,
  };
}

function fallbackEligible(error: unknown, signal: AbortSignal | undefined) {
  if (signal?.aborted) return false;
  const details = errorDetails(error);
  if (details.name === "AbortError" || details.code === "LCX_ABORTED")
    return false;
  if (details.name === "TimeoutError") return true;
  return ["LCX_HTTP_RETRYABLE", "LCX_RETRY_EXHAUSTED"].includes(
    String(details.code ?? ""),
  );
}

async function* remoteCompactionStream(
  options: GenerateOptions,
  routeConfig: ResponsesRouteConfig,
  ctx: HostContext,
  next: () => AsyncIterable<StreamChunk>,
): AsyncGenerator<StreamChunk> {
  const history = stripCompactionDirective(options.messages);
  const route = currentRoute(options, routeConfig);
  try {
    const prepared = await serializeNativeAware(
      history,
      route,
      routeConfig,
      ctx,
      { signal: options.signal, system: options.system, tools: options.tools },
    );
    const cacheSessionId = promptCacheSessionId(route, routeConfig, ctx);
    const headers = await authenticatedHeaders(
      ctx,
      routeConfig,
      cacheSessionId,
      cacheSessionId === undefined ? null : route.sessionId,
    );
    const generation = generationControlsFromSession(
      sessionFor(ctx, route.sessionId),
      route,
    );
    const result = await requestNativeCompaction({
      baseURL: routeConfig.baseURL,
      model: route.model,
      modelDescriptor: prepared.model,
      input: prepared.input,
      tools: prepared.tools ?? options.tools,
      promptCacheKey: promptCacheKey(route, routeConfig, ctx),
      promptCacheRetention: promptCacheRetention(routeConfig),
      cacheRetention: routeConfig.cacheRetention,
      reasoningEffort: generation.reasoningEffort,
      temperature: generation.temperature,
      maxTokens: generation.maxTokens,
      idempotencyKey: randomUUID(),
      headers,
      signal: options.signal,
      timeoutMs: routeConfig.timeoutMs,
      maxAttempts: routeConfig.maxAttempts,
      maxResponseBytes: routeConfig.maxResponseBytes,
    });
    const session = sessionFor(ctx, route.sessionId);
    if (session === undefined)
      throw webError(
        "Native compaction requires a live DSH session",
        "LCX_COMPACT_SESSION_UNAVAILABLE",
      );
    const block = createNativeCheckpointBlock({
      session,
      route,
      result,
      input: prepared.input,
      ephemeralPreludeItemCount: prepared.ephemeralPreludeItemCount,
      imageMap: prepared.imageMap,
      retentionOptions: {
        tokenBudget: routeConfig.nativeRetentionTokenBudget,
        assistantTokenReserve: routeConfig.assistantRetentionTokenReserve,
        assistantPerMessageTokenCap:
          routeConfig.assistantRetentionPerMessageTokenCap,
      },
    });
    ctx.logger?.info?.(
      `[lcx-codex] native V2 compaction succeeded; retained ${block.retainedClientCount ?? 0} client + ${block.retainedAssistantCount ?? 0} assistant-visible item(s) (~${block.retainedEstimatedTokens ?? 0} tokens) with the opaque checkpoint`,
    );
    for (const chunk of nativeCheckpointChunks(block, result.usage))
      yield chunk;
  } catch (error) {
    const session = sessionFor(ctx, route.sessionId);
    const hasExistingCheckpoint = messagesContainNativeCheckpoint(history, session);
    const details = errorDetails(error);
    const code = details.code ?? details.name ?? "ERROR";
    const status = Number.isInteger(details.status)
      ? ` status=${details.status}`
      : "";
    const requestId = isRecord(error) && error.requestId
      ? ` requestId=${String(error.requestId)}`
      : "";
    const providerCode = isRecord(error) && error.providerCode
      ? ` providerCode=${String(error.providerCode)}`
      : "";
    const providerType = isRecord(error) && error.providerType
      ? ` providerType=${String(error.providerType)}`
      : "";
    const providerParam = isRecord(error) && error.providerParam
      ? ` providerParam=${String(error.providerParam)}`
      : "";
    ctx.logger?.warn?.(
      `[lcx-codex] native V2 compaction failed: code=${code}${status}${requestId}${providerCode}${providerType}${providerParam}`,
    );
    if (hasExistingCheckpoint || !fallbackEligible(error, options.signal))
      throw error;
    ctx.logger?.info?.(
      "[lcx-codex] falling back to DSH basic compaction after allowlisted first-checkpoint native failure",
    );
    const stream = await next();
    for await (const chunk of stream) yield chunk;
  }
}

function routedTargetForAgent(
  agent: unknown,
): Pick<RouteRequest, "provider" | "model"> | undefined {
  const route = readAgentRouteState(agent);
  const provider = stringValue(
    routeConfigValue(route.requestConfig, "provider") ??
      routeConfigValue(route.options, "provider"),
    "",
  );
  const model = stringValue(
    routeConfigValue(route.requestConfig, "model") ??
      routeConfigValue(route.options, "model"),
    "",
  );
  return provider && model ? { provider, model } : undefined;
}

export function compactionPressureBand(
  totalTokens: number,
  contextWindow: number,
  policy: { auto: number; emergency: number },
) {
  const ratioPercent = (totalTokens / contextWindow) * 100;
  return {
    ratioPercent,
    band:
      ratioPercent < policy.auto
        ? "below"
        : ratioPercent < policy.emergency
          ? "native"
          : "emergency",
  };
}

function adjustedCompactionConfig(
  config: unknown,
  target: Pick<RouteRequest, "provider" | "model">,
  thresholdRatio: number,
) {
  if (!isRecord(config)) return config;
  const modelPolicies = Array.isArray(config.modelPolicies)
    ? config.modelPolicies.map((policy) =>
        isRecord(policy) &&
        policy.provider === target.provider &&
        policy.model === target.model
          ? { ...policy, thresholdRatio }
          : policy,
      )
    : config.modelPolicies;
  return {
    ...config,
    thresholdRatio,
    ...(modelPolicies === undefined ? {} : { modelPolicies }),
  };
}

function combinedAbortSignal(
  primary: AbortSignal,
  lifecycle: AbortSignal,
): AbortSignal {
  return primary === lifecycle ? primary : AbortSignal.any([primary, lifecycle]);
}

function patchCompactionPressureService(
  compactionValue: unknown,
  state: { enabled: boolean },
  getConfig: () => NormalizedConfig,
  ctx: HostContext,
  records: CompactionPatchRecords,
) {
  const candidate = compactionPatchCandidate(compactionValue, records);
  if (!candidate) return false;
  const mutex = new ServiceMutex();
  const lifecycle = new AbortController();
  return installCompactionPatch(records, candidate, mutex, lifecycle, async (
    agent,
    trigger,
    signal,
    callOriginal,
  ) => {
    const activeSignal = combinedAbortSignal(signal, lifecycle.signal);
    return mutex.run(activeSignal, async () => {
      if (trigger !== "pressure" || !state.enabled) return callOriginal(activeSignal);
      const config = getConfig();
      const target = routedTargetForAgent(agent);
      if (!target || !resolveResponsesRouteConfig(ctx, target, config))
        return callOriginal(activeSignal);
      const session = sessionFromAgent(agent);
      const tokenMeter =
        resolveScopedService(agent, "tokenMeter") ??
        resolveContextService(ctx, "tokenMeter");
      if (!session || tokenMeter === undefined) return callOriginal(activeSignal);
      let contextWindow: number | undefined;
      try {
        contextWindow = (
          await ctx.llm.resolveModelInfo(
            target.provider,
            target.model,
            activeSignal,
          )
        ).context?.contextWindow;
      } catch {
        return callOriginal(activeSignal);
      }
      const totalTokens = tokenMeterTotal(tokenMeter, session);
      if (
        contextWindow === undefined ||
        contextWindow <= 0 ||
        totalTokens === undefined
      )
        return callOriginal(activeSignal);
      const auto = AUTO_COMPACTION_THRESHOLD_PERCENT;
      const emergency = EMERGENCY_PRUNE_THRESHOLD_PERCENT;
      const pressure = compactionPressureBand(totalTokens, contextWindow, {
        auto,
        emergency,
      });
      if (pressure.band === "below") return null;
      const prunerState = toolResultPrunerState(
        resolveAgentService(ctx, agent, "toolResultPruner"),
      );
      const configState = compactionConfigState(compactionValue);
      const nativeFirst = pressure.band === "native";
      const prunerPatch = nativeFirst
        ? patchToolResultPruner(prunerState, () => ({ pruned: [], charsRemoved: 0 }))
        : undefined;
      const configPatch = patchCompactionConfig(configState, (originalConfig) =>
        adjustedCompactionConfig(originalConfig, target, auto / 100),
      );
      ctx.logger?.info?.(
        `[lcx-codex] auto pressure ${pressure.ratioPercent.toFixed(1)}%: ${nativeFirst ? "Native V2 first" : "emergency DSH prune allowed"} (native ${auto}%, emergency ${emergency}%)`,
      );
      try {
        return await callOriginal(activeSignal);
      } finally {
        restoreCompactionConfig(configPatch);
        restoreToolResultPruner(prunerPatch);
      }
    });
  });
}

function patchCompactionPressureForAgent(
  agent: object & HostAgent,
  state: { enabled: boolean },
  getConfig: () => NormalizedConfig,
  ctx: HostContext,
  records: CompactionPatchRecords,
) {
  return patchCompactionPressureService(
    resolveAgentService(ctx, agent, "compaction"),
    state,
    getConfig,
    ctx,
    records,
  );
}

async function restoreCompactionPressure(records: CompactionPatchRecords) {
  const reason = new Error("lcx-codex pressure coordination is shutting down");
  const entries = [...records.values()];
  for (const record of entries) {
    if (!record.lifecycle.signal.aborted) record.lifecycle.abort(reason);
  }
  await Promise.allSettled(entries.map((record) => record.mutex.close(reason)));
  restoreCompactionPatches(records, entries);
}

function messagesContainNativeCheckpoint(
  messages: readonly Message[],
  session: Session | undefined,
) {
  return session !== undefined && messages.some((message) =>
    checkpointStateForMessage(session, message),
  );
}

function inputHasNativeState(input: readonly unknown[]) {
  return input.some((item) => isRecord(item) && item.type === "compaction");
}

async function* managedResponsesStream(
  options: GenerateOptions,
  routeConfig: ResponsesRouteConfig,
  ctx: HostContext,
): AsyncGenerator<StreamChunk> {
  const route = currentRoute(options, routeConfig);
  try {
    if (options.stop !== undefined)
      throw Object.assign(
        new Error("LCX Responses does not support GenerateOptions.stop"),
        { code: "LCX_RESPONSES_UNSUPPORTED_OPTION" },
      );
    const prepared = await serializeNativeAware(
      options.messages,
      route,
      routeConfig,
      ctx,
      { signal: options.signal, system: options.system, tools: options.tools },
    );
    const cacheSessionId = promptCacheSessionId(route, routeConfig, ctx);
    const headers = await authenticatedHeaders(
      ctx,
      routeConfig,
      cacheSessionId,
      cacheSessionId === undefined ? null : route.sessionId,
    );
    const body = buildResponsesBody({
      model: prepared.model,
      input: prepared.input,
      tools: prepared.tools ?? options.tools,
      sessionId: cacheSessionId,
      promptCacheKey: promptCacheKey(route, routeConfig, ctx),
      promptCacheRetention: promptCacheRetention(routeConfig),
      cacheRetention: routeConfig.cacheRetention,
      reasoningEffort: options.reasoningEffort,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
    const nativeReplay = inputHasNativeState(prepared.input);
    if (nativeReplay) {
      body.tool_choice = "auto";
      body.parallel_tool_calls = true;
    }
    yield* streamResponsesRequest({
      baseURL: routeConfig.baseURL,
      provider: route.provider,
      model: route.model,
      piModel: prepared.model,
      body,
      grammarToolInputProperties: prepared.grammarToolInputProperties,
      headers: nativeReplay ? mergeFeatureHeader(headers) : headers,
      signal: options.signal,
      timeoutMs: routeConfig.timeoutMs,
      maxAttempts: 1,
      maxResponseBytes: routeConfig.maxResponseBytes,
    });
  } catch (error) {
    yield managedFailureChunk(error, options.signal);
  }
}

async function* managedGrokNativeSearchStream(
  options: GenerateOptions,
  routeConfig: ResponsesRouteConfig,
  nativeSearch: GrokNativeSearchState,
  ctx: HostContext,
): AsyncGenerator<StreamChunk> {
  const route = currentRoute(options, routeConfig);
  const nativeReplayRoute = grokReplayRoute(route, routeConfig);
  try {
    if (options.stop !== undefined)
      throw Object.assign(
        new Error("LCX Responses does not support GenerateOptions.stop"),
        { code: "LCX_RESPONSES_UNSUPPORTED_OPTION" },
      );
    const visibleTools = grokVisibleFunctionTools(options.tools, nativeSearch);
    const prepared = await serializeNativeAware(
      options.messages,
      route,
      routeConfig,
      ctx,
      {
        signal: options.signal,
        system: options.system,
        tools: visibleTools,
        grokNativeReplayRoute: nativeReplayRoute,
      },
    );
    const cacheSessionId = grokPromptCacheSessionId(route, routeConfig);
    const headers = await authenticatedGrokHeaders(
      ctx,
      routeConfig,
      cacheSessionId,
    );
    const model = {
      ...prepared.model,
      ...routeConfig.modelDefaults,
      ...routeConfig.modelControls,
      id: route.model,
      provider: route.provider,
      baseUrl: routeConfig.baseURL,
      api: "openai-responses" as const,
    };
    const effectiveReasoning = options.reasoningEffort ?? routeConfig.profileReasoning;
    if (
      effectiveReasoning !== undefined &&
      !getSupportedThinkingLevels(model).some((level) => level === effectiveReasoning)
    )
      throw Object.assign(
        new Error(
          `Grok route does not support reasoning effort "${String(effectiveReasoning)}"`,
        ),
        { code: "LCX_RESPONSES_UNSUPPORTED_OPTION" },
      );
    const body = buildResponsesBody({
      model,
      input: prepared.input,
      tools: grokWireTools(prepared.tools ?? visibleTools, nativeSearch),
      sessionId: cacheSessionId,
      promptCacheRetention: promptCacheRetention(routeConfig),
      cacheRetention: routeConfig.cacheRetention,
      reasoningEffort: effectiveReasoning,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
    if (nativeSearch.web) {
      const include = new Set(Array.isArray(body.include) ? body.include : []);
      include.add("web_search_call.action.sources");
      body.include = [...include];
    }
    yield* streamResponsesRequest({
      baseURL: routeConfig.baseURL,
      provider: route.provider,
      model: route.model,
      piModel: model,
      body,
      grammarToolInputProperties: prepared.grammarToolInputProperties,
      headers,
      signal: options.signal,
      timeoutMs: routeConfig.timeoutMs,
      applyDefaultTimeout: false,
      streamIdleTimeoutMs: routeConfig.streamIdleTimeoutMs,
      maxAttempts: 1,
      maxResponseBytes: routeConfig.maxResponseBytes,
      serverToolTypes: GROK_NATIVE_SERVER_TOOL_TYPES,
      nativeReplayRoute,
      onServerToolUsage(usage) {
        ctx.logger?.info?.(
          `[lcx-codex] Grok native search used ${usage.total} server-side tool call(s) (web=${usage.webSearchCalls}, x=${usage.xSearchCalls})`,
        );
      },
    });
  } catch (error) {
    yield managedFailureChunk(error, options.signal);
  }
}

function isGptLifecycleTarget(options: Pick<GenerateOptions, "model">): boolean {
  return /^gpt-/iu.test(String(options.model ?? ""));
}

async function* unavailableManagedRouteStream(
  options: GenerateOptions,
): AsyncGenerator<StreamChunk> {
  yield managedFailureChunk(
    Object.assign(
      new Error(
        "LCX is enabled but the selected DSH route cannot be resolved as an authenticated OpenAI Responses wire route",
      ),
      { code: "LCX_RESPONSES_ROUTE_UNAVAILABLE" },
    ),
    options.signal,
  );
}

function installInjected(
  ctx: HostContext,
  configInput: ConfigInput = {},
) {
  const baseConfig = normalizeConfig(configInput);
  let runtimeConfig = baseConfig;
  const state: SettingsState = {
    enabled: false,
    webSearch: false,
    advancedHostedSearch: false,
    alphaSearch: false,
    grokNativeWebSearch: false,
    grokNativeXSearch: false,
  };
  const provider = new LcxResponsesSearchProvider(
    ctx,
    () => runtimeConfig,
    () => state.enabled && state.webSearch,
  );
  const capabilityStore = new AlphaCapabilityStore(
    baseConfig.alphaCapabilityPath,
  );
  const refStore = new AlphaRefStore(baseConfig.alphaRefPath);
  const managedAgents = new Set<object & HostAgent>();
  const gptToolRegistrations: GptToolRegistry = new Map();
  const alphaToolRegistrations: AlphaToolRegistry = new Map();
  const compactionPatchRecords: CompactionPatchRecords = new Map();

  const syncAgentTools = (agent: object & HostAgent) => {
    syncGptToolsForAgent(
      ctx,
      agent,
      state,
      () => runtimeConfig,
      provider,
      gptToolRegistrations,
    );
    syncAlphaToolForAgent(
      ctx,
      agent,
      state,
      () => runtimeConfig,
      capabilityStore,
      refStore,
      alphaToolRegistrations,
    );
  };
  const refreshTools = () => {
    for (const agent of managedAgents) syncAgentTools(agent);
  };

  ctx.on(
    "session/disposed",
    (session: Session) => {
      for (const agent of managedAgents)
        if (agentUsesSession(agent, session)) {
          disposeGptToolsForAgent(agent, gptToolRegistrations);
          disposeAlphaToolForAgent(agent, alphaToolRegistrations);
          managedAgents.delete(agent);
        }
    },
    { global: true },
  );
  ctx.on(
    "session/event",
    (session: Session, event: SessionEvent) => {
      if (event.type === "request/header")
        for (const agent of managedAgents)
          if (agentUsesSession(agent, session)) syncAgentTools(agent);
    },
    { global: true },
  );

  const settingsEntry: SettingsState = {
    enabled: false,
    webSearch: false,
    advancedHostedSearch: false,
    alphaSearch: false,
    grokNativeWebSearch: false,
    grokNativeXSearch: false,
  };
  let source: () => SettingsState = () => settingsEntry;
  ctx.settings.installSection(
    ctx,
    SETTINGS_NS,
    SettingsSchema,
    settingsEntry,
    {
      setSource(current) {
        source = current;
      },
      onChange() {
        const value = source();
        state.enabled = value.enabled;
        state.webSearch = value.webSearch;
        state.advancedHostedSearch = value.advancedHostedSearch;
        state.alphaSearch = value.alphaSearch;
        state.grokNativeWebSearch = value.grokNativeWebSearch;
        state.grokNativeXSearch = value.grokNativeXSearch;
        runtimeConfig = baseConfig;
        refreshTools();
      },
    },
  );
  try {
    const value = source();
    Object.assign(state, {
      enabled: Boolean(value.enabled),
      webSearch: Boolean(value.webSearch),
      advancedHostedSearch: Boolean(value.advancedHostedSearch),
      alphaSearch: Boolean(value.alphaSearch),
      grokNativeWebSearch: Boolean(value.grokNativeWebSearch),
      grokNativeXSearch: Boolean(value.grokNativeXSearch),
    });
    runtimeConfig = baseConfig;
  } catch {}
  refreshTools();
  ctx.inject(["compaction"], (compactionCtx: HostContext) => {
    patchCompactionPressureService(
      resolveContextService(compactionCtx, "compaction"),
      state,
      () => runtimeConfig,
      ctx,
      compactionPatchRecords,
    );
  });

  ctx.on(
    "agent/created",
    ({ agent }) => {
      if (agent === null || typeof agent !== "object") return;
      managedAgents.add(agent);
      syncAgentTools(agent);
      const installed = patchCompactionPressureForAgent(
        agent,
        state,
        () => runtimeConfig,
        ctx,
        compactionPatchRecords,
      );
      if (installed)
        ctx.logger?.info?.(
          "[lcx-codex] pressure coordination installed through AgentPresets service resolver",
        );
    },
    { global: true },
  );

  ctx.on(
    "agent/status",
    ({ agent, status }) => {
      if (
        status !== "running" ||
        agent === null ||
        typeof agent !== "object"
      )
        return;
      managedAgents.add(agent);
      syncAgentTools(agent);
      const installed = patchCompactionPressureForAgent(
        agent,
        state,
        () => runtimeConfig,
        ctx,
        compactionPatchRecords,
      );
      if (installed)
        ctx.logger?.info?.(
          "[lcx-codex] pressure coordination installed through AgentPresets service resolver",
        );
    },
    { global: true },
  );

  ctx.on(
    "llm/stream",
    (
      options: GenerateOptions,
      next: () => AsyncIterable<StreamChunk>,
    ): AsyncIterable<StreamChunk> => {
      if (options.purpose === "session-title") return next();
      const grokNativeSearch: GrokNativeSearchState = {
        web: state.grokNativeWebSearch,
        x: state.grokNativeXSearch,
      };
      if (options.purpose === undefined && grokNativeSearchEnabled(grokNativeSearch)) {
        const grokRoute = resolveGrokResponsesRouteConfig(
          ctx,
          options,
          runtimeConfig,
        );
        if (grokRoute)
          return managedGrokNativeSearchStream(
            options,
            routeWithPolicies(grokRoute, runtimeConfig),
            grokNativeSearch,
            ctx,
          );
      }
      if (!state.enabled || !isGptLifecycleTarget(options)) return next();
      const routeConfig = resolveResponsesRouteConfig(
        ctx,
        options,
        runtimeConfig,
      );
      if (options.purpose === "compaction") {
        if (!routeConfig) return unavailableManagedRouteStream(options);
        return remoteCompactionStream(
          options,
          routeWithPolicies(routeConfig, runtimeConfig),
          ctx,
          next,
        );
      }
      if (!routeConfig) return unavailableManagedRouteStream(options);
      return managedResponsesStream(
        options,
        routeWithPolicies(routeConfig, runtimeConfig),
        ctx,
      );
    },
  );

  ctx.effect?.(
    () => async () => {
      for (const agent of managedAgents) {
        disposeGptToolsForAgent(agent, gptToolRegistrations);
        disposeAlphaToolForAgent(agent, alphaToolRegistrations);
      }
      managedAgents.clear();
      await restoreCompactionPressure(compactionPatchRecords);
    },
    "lcx-codex cleanup",
  );
}

export function apply(ctx: HostContext, configInput: ConfigInput = {}) {
  return installInjected(ctx, configInput);
}

apply.inject = inject;
apply.Config = Config;

export default apply;
