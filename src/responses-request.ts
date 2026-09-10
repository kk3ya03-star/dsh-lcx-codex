// @ts-check

import { clampOpenAIPromptCacheKey } from "./pi-responses-runtime.js";
import { responsesTools } from "./dsh-responses.js";

const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;

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
  includeEncryptedReasoning?: boolean;
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

/** @param {unknown} value */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function modelId(model: PiResponsesModel | string): string {
  return typeof model === "string" ? model : model.id;
}

function modelRecord(model: PiResponsesModel | string): PiResponsesModel {
  return typeof model === "string"
    ? /** @type {PiResponsesModel} */ {
        id: model,
        provider: "lcx",
        reasoning: true,
      }
    : model;
}

/** @param {unknown} value */
function normalizeCacheRetention(value: unknown): CacheRetention {
  const normalized = String(value);
  return normalized === "none" || normalized === "short" || normalized === "long"
    ? normalized
    : "short";
}

/**
 * Pi-parity generation controls for OpenAI Responses.
 * @param {GenerationControls & { model?: PiResponsesModel | string, includeDefaultReasoning?: boolean }} [controls]
 */
export function responsesGenerationEnvelope({
  model = "unknown",
  reasoningEffort,
  temperature,
  maxTokens,
  includeDefaultReasoning = false,
}: GenerationControls & {
  model?: PiResponsesModel | string;
  includeDefaultReasoning?: boolean;
} = {}): UnknownRecord {
  const descriptor = modelRecord(model);
  const result: UnknownRecord = {};
  if (descriptor.reasoning !== false) {
    if (
      descriptor.provider === "xai" ||
      descriptor.includeEncryptedReasoning === true
    )
      result.include = ["reasoning.encrypted_content"];
    if (reasoningEffort !== undefined && reasoningEffort !== "off") {
      const requested = String(reasoningEffort);
      const wire = descriptor.thinkingLevelMap?.[requested] ?? requested;
      if (wire !== null) {
        result.reasoning = { effort: wire, summary: "auto" };
        result.include = ["reasoning.encrypted_content"];
      }
    } else if (
      includeDefaultReasoning &&
      descriptor.provider !== "github-copilot" &&
      descriptor.thinkingLevelMap?.off !== null
    ) {
      result.reasoning = { effort: descriptor.thinkingLevelMap?.off ?? "none" };
    }
  }
  if (temperature !== undefined) {
    if (!Number.isFinite(temperature))
      throw Object.assign(new Error("Responses temperature must be finite"), {
        code: "LCX_RESPONSES_INVALID_INPUT",
      });
    result.temperature = Number(temperature);
  }
  if (maxTokens !== undefined) {
    if (!Number.isSafeInteger(maxTokens) || Number(maxTokens) <= 0)
      throw Object.assign(
        new Error("Responses maxTokens must be a positive safe integer"),
        { code: "LCX_RESPONSES_INVALID_INPUT" },
      );
    if (descriptor.compat?.supportsMaxOutputTokens !== false)
      result.max_output_tokens = Math.max(
        OPENAI_RESPONSES_MIN_OUTPUT_TOKENS,
        Number(maxTokens),
      );
  }
  return result;
}

/**
 * Build the shared LCX-owned request envelope while retaining Pi 0.85.1 Responses semantics.
 * Production LCX ordinary/compact/replay construction places the DSH system prompt in canonical input.
 * @param {BuildResponsesBodyOptions} options
 */
export function buildResponsesBody({
  model,
  input,
  tools,
  sessionId,
  promptCacheKey,
  promptCacheRetention,
  cacheRetention,
  reasoningEffort,
  temperature,
  maxTokens,
  samplingParams,
}: BuildResponsesBodyOptions): ResponsesWireBody {
  if (!Array.isArray(input))
    throw Object.assign(new Error("Responses input must be an array"), {
      code: "LCX_RESPONSES_INVALID_INPUT",
    });
  const descriptor = modelRecord(model);
  const retention = normalizeCacheRetention(cacheRetention);
  const compat = descriptor.compat ?? {};
  const cacheKey =
    retention === "none"
      ? undefined
      : (promptCacheKey ?? clampOpenAIPromptCacheKey(sessionId));
  const longRetention = retention === "long" && compat.supportsExplicitPromptCacheMode !== true
    ? promptCacheRetention ?? (compat.supportsLongCacheRetention === true ? "24h" : undefined)
    : undefined;
  // Pi 0.85.1 uses explicit 30m only for long retention; short is implicit.
  const currentCache =
    retention === "long" && compat.supportsLongCacheRetention === true && compat.supportsExplicitPromptCacheMode === true;
  const explicitCache =
    retention === "none" && compat.supportsExplicitPromptCacheMode === true;
  const promptCacheOptions = currentCache
    ? { ttl: "30m" }
    : explicitCache
      ? { mode: "explicit" }
      : undefined;
  const nativeTools = responsesTools(
    Array.isArray(tools) ? tools as Parameters<typeof responsesTools>[0] : undefined,
  );
  const body: ResponsesWireBody = {
    model: modelId(model),
    input: structuredClone(input),
    stream: true,
    store: false,
    ...(nativeTools !== undefined && nativeTools.length > 0
      ? { tools: nativeTools }
      : {}),
    ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
    ...(longRetention ? { prompt_cache_retention: longRetention } : {}),
    ...(promptCacheOptions ? { prompt_cache_options: promptCacheOptions } : {}),
    ...responsesGenerationEnvelope({
      model: descriptor,
      reasoningEffort,
      temperature,
      maxTokens,
      includeDefaultReasoning: true,
    }),
  };
  if (isObject(samplingParams))
    Object.assign(body, structuredClone(samplingParams));
  return body;
}

/**
 * Compact is the standard request plus the one opaque-history transition patch.
 * @param {BuildResponsesBodyOptions} options
 */
export function buildCompactionResponsesBody(
  options: BuildResponsesBodyOptions,
): ResponsesWireBody {
  const body = buildResponsesBody(options);
  if (
    body.input.some(
      (item) => isObject(item) && item.type === "compaction_trigger",
    )
  ) {
    throw Object.assign(
      new Error("native compaction input already contains compaction_trigger"),
      { code: "LCX_COMPACT_DUPLICATE_TRIGGER" },
    );
  }
  body.input = [...body.input, { type: "compaction_trigger" }];
  // Remote Compaction V2 has historically required these explicit controls.
  body.tool_choice = "auto";
  body.parallel_tool_calls = true;
  return body;
}
