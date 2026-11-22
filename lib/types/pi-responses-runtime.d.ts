import type { Api, Model } from "@earendil-works/pi-ai";
export { getResponsesToolSupport, convertResponsesMessages, convertResponsesTools, processResponsesStream, } from "@earendil-works/pi-ai/api/openai-responses-shared";
export { createGrammarToolInputProperties } from "@earendil-works/pi-ai/api/constrained-sampling";
export { clampOpenAIPromptCacheKey } from "@earendil-works/pi-ai/api/openai-prompt-cache";
export { clampMaxTokensToContext } from "@earendil-works/pi-ai/api/simple-options";
export { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
export { normalizeContext, resolveTranscriptTools, resolveTranscript } from "@earendil-works/pi-ai/utils/transcript";
export { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
export { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "@earendil-works/pi-ai/api/github-copilot-headers";
export { withOpenCodeSessionHeader } from "@earendil-works/pi-ai/providers/opencode-headers";
export type BundledResponsesProvider = "cloudflare-ai-gateway" | "github-copilot" | "openai" | "opencode" | "opencode-go" | "xai";
/**
 * Every catalog entry of a bundled provider whatever its wire protocol. DSH resolves the protocol of a
 * model its catalog has not caught up with from the one protocol all of the provider's shipped models
 * share, so ownership needs the complete provider catalog and not only the Responses subset.
 */
export declare function getCatalogModels(provider: string): readonly Model<Api>[];
/**
 * Static `maxTokens` capacities for routable `gpt-*` / `grok*` chat models from Pi catalogs that are NOT
 * already bundled in `RESPONSE_CATALOGS` (e.g. `openrouter/x-ai/grok-4.7`, `azure/gpt-*`, `openai-codex/*`),
 * verified against `@earendil-works/pi-ai/providers/all` by `scripts/build-pi-runtime.mjs`.
 */
export declare const NON_RESPONSES_CATALOG_MAX_TOKENS: Readonly<Record<string, number>>;
export declare function getCatalogModelMaxTokens(provider: string, modelId: string): number | undefined;
