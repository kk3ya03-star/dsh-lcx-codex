import { clampOpenAIPromptCacheKey } from "./pi-responses-runtime.js";
import { responsesTools } from "./dsh-responses.js";
import { isRecord } from "./util.js";
const OPENAI_RESPONSES_MIN_OUTPUT_TOKENS = 16;
/** Pi's fixed request effort while the real one travels in `configuration_update` input items. */
const CONFIGURATION_UPDATE_REQUEST_EFFORT = "medium";
function modelId(model) {
    return typeof model === "string" ? model : model.id;
}
function modelRecord(model) {
    return typeof model === "string"
        ? {
            id: model,
            provider: "lcx",
            reasoning: true,
        }
        : model;
}
function normalizeCacheRetention(value) {
    const normalized = String(value);
    return normalized === "none" || normalized === "short" || normalized === "long"
        ? normalized
        : "short";
}
function isOpenAIDirectSignInTarget(model) {
    return (isRecord(model) &&
        model.provider === "openai" &&
        model.baseUrl === "https://api.openai.com/v1");
}
/**
 * Matches Pi's `isChatGPTSignIn`: direct `openai` against `https://api.openai.com/v1` with a non-`sk-` token.
 */
export function isChatGPTSignInCredential(model, apiKey) {
    if (!isRecord(model))
        return false;
    return (isOpenAIDirectSignInTarget(model) &&
        apiKey !== undefined &&
        !apiKey.startsWith("sk-"));
}
/**
 * The effort Pi 1.3.0 sends as `configuration_update` input items instead of `reasoning.effort`, or undefined
 * to send it as `reasoning.effort` (Pi's `getConfigurationUpdateEffort`): only for a model whose compat states
 * `supportsMidConvoEffort`, only with a requested level, and never for a Sign in with ChatGPT key, which rejects
 * those items. The key is read only when that last rule can apply.
 */
export async function configurationUpdateEffort(model, reasoningEffort, apiKey, options) {
    if (options?.gatewayCompatibilityFallback === true ||
        model.compat?.supportsMidConvoEffort !== true ||
        reasoningEffort === undefined ||
        reasoningEffort === "off")
        return undefined;
    const requested = String(reasoningEffort);
    const mapped = model.thinkingLevelMap?.[requested];
    // A level the model maps to null is unsupported; DSH refuses it before dispatch, so it never travels here.
    if (mapped === null)
        return undefined;
    if (isOpenAIDirectSignInTarget(model) && isChatGPTSignInCredential(model, await apiKey()))
        return undefined;
    return mapped ?? requested;
}
/**
 * Pi-parity generation controls for OpenAI Responses.
 */
export function responsesGenerationEnvelope({ model = "unknown", reasoningEffort, temperature, maxTokens, configurationUpdateEffort, gatewayCompatibilityFallback = false, omitUnsupportedFields = false, apiKey, includeDefaultReasoning = false, } = {}) {
    const descriptor = modelRecord(model);
    const suppressChatGptUnsupported = omitUnsupportedFields === true || isChatGPTSignInCredential(descriptor, apiKey);
    const result = {};
    if (descriptor.reasoning !== false) {
        if (descriptor.provider === "xai" ||
            descriptor.includeEncryptedReasoning === true)
            result.include = ["reasoning.encrypted_content"];
        if (reasoningEffort !== undefined && reasoningEffort !== "off") {
            const requested = String(reasoningEffort);
            // Unmapped means "send the level as is"; an explicit null means the model declares the level
            // unsupported, so nothing is sent for it (the DSH adapter refuses such a level before dispatch).
            const mapped = descriptor.thinkingLevelMap?.[requested];
            const wire = mapped === undefined ? requested : mapped;
            if (wire !== null) {
                // With mid-conversation effort the request carries a fixed effort, so an effort change keeps the
                // cached prefix; the level itself is the last `configuration_update` input item.
                const useConfigurationUpdate = !gatewayCompatibilityFallback && configurationUpdateEffort !== undefined;
                result.reasoning = {
                    effort: useConfigurationUpdate ? CONFIGURATION_UPDATE_REQUEST_EFFORT : wire,
                    summary: "auto",
                };
                result.include = ["reasoning.encrypted_content"];
            }
        }
        else if (includeDefaultReasoning &&
            descriptor.provider !== "github-copilot" &&
            descriptor.thinkingLevelMap?.off !== null) {
            result.reasoning = { effort: descriptor.thinkingLevelMap?.off ?? "none" };
        }
    }
    if (temperature !== undefined) {
        if (!Number.isFinite(temperature))
            throw Object.assign(new Error("Responses temperature must be finite"), {
                code: "LCX_RESPONSES_INVALID_INPUT",
            });
        if (!suppressChatGptUnsupported)
            result.temperature = Number(temperature);
    }
    if (maxTokens !== undefined) {
        if (!Number.isSafeInteger(maxTokens) || Number(maxTokens) <= 0)
            throw Object.assign(new Error("Responses maxTokens must be a positive safe integer"), { code: "LCX_RESPONSES_INVALID_INPUT" });
        if (!suppressChatGptUnsupported && descriptor.compat?.supportsMaxOutputTokens !== false)
            result.max_output_tokens = Math.max(OPENAI_RESPONSES_MIN_OUTPUT_TOKENS, Number(maxTokens));
    }
    return result;
}
/**
 * Build the shared LCX-owned request envelope while retaining Pi Responses semantics.
 * Production LCX ordinary/compact/replay construction places the DSH system prompt in canonical input.
 */
export function buildResponsesBody({ model, input, tools, sessionId, promptCacheKey, promptCacheRetention, cacheRetention, reasoningEffort, temperature, maxTokens, configurationUpdateEffort, gatewayCompatibilityFallback, omitUnsupportedFields, apiKey, samplingParams, }) {
    if (!Array.isArray(input))
        throw Object.assign(new Error("Responses input must be an array"), {
            code: "LCX_RESPONSES_INVALID_INPUT",
        });
    const descriptor = modelRecord(model);
    const suppressChatGptUnsupported = omitUnsupportedFields === true || isChatGPTSignInCredential(descriptor, apiKey);
    const retention = normalizeCacheRetention(cacheRetention);
    const compat = descriptor.compat ?? {};
    const supportsLongCache = compat.supportsLongCacheRetention !== false;
    const sendPromptCacheKey = retention !== "none" && compat.promptCacheKeyMode !== "disabled";
    const cacheKey = !sendPromptCacheKey
        ? undefined
        : (promptCacheKey ?? clampOpenAIPromptCacheKey(sessionId));
    const longRetention = !suppressChatGptUnsupported && retention === "long" && compat.supportsExplicitPromptCacheMode !== true
        ? promptCacheRetention ?? (supportsLongCache ? "24h" : undefined)
        : undefined;
    // Pi uses explicit 30m only for long retention; short is implicit.
    const currentCache = !suppressChatGptUnsupported &&
        retention === "long" &&
        supportsLongCache &&
        compat.supportsExplicitPromptCacheMode === true;
    const explicitCache = !suppressChatGptUnsupported &&
        retention === "none" &&
        compat.supportsExplicitPromptCacheMode === true;
    const promptCacheOptions = currentCache
        ? { ttl: "30m" }
        : explicitCache
            ? { mode: "explicit" }
            : undefined;
    const nativeTools = responsesTools(Array.isArray(tools) ? tools : undefined);
    const body = {
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
            configurationUpdateEffort,
            gatewayCompatibilityFallback,
            omitUnsupportedFields: suppressChatGptUnsupported,
            includeDefaultReasoning: true,
        }),
    };
    if (isRecord(samplingParams))
        Object.assign(body, structuredClone(samplingParams));
    return body;
}
/**
 * Compact is the standard request plus the one opaque-history transition patch.
 */
export function buildCompactionResponsesBody(options) {
    const body = buildResponsesBody(options);
    if (body.input.some((item) => isRecord(item) && item.type === "compaction_trigger")) {
        throw Object.assign(new Error("native compaction input already contains compaction_trigger"), { code: "LCX_COMPACT_DUPLICATE_TRIGGER" });
    }
    body.input = [...body.input, { type: "compaction_trigger" }];
    // Remote Compaction V2 has historically required these explicit controls.
    body.tool_choice = "auto";
    body.parallel_tool_calls = true;
    return body;
}
