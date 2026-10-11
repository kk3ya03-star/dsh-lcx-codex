import type { Api, Model } from "@earendil-works/pi-ai";
export { convertResponsesMessages, convertResponsesTools, processResponsesStream, } from "@earendil-works/pi-ai/api/openai-responses-shared";
export { createGrammarToolInputProperties } from "@earendil-works/pi-ai/api/constrained-sampling";
export { clampOpenAIPromptCacheKey } from "@earendil-works/pi-ai/api/openai-prompt-cache";
export { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
export { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
export { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
export type BundledResponsesProvider = "cloudflare-ai-gateway" | "github-copilot" | "openai" | "opencode" | "opencode-go" | "xai";
/**
 * Every catalog entry of a bundled provider whatever its wire protocol. DSH resolves the protocol of a
 * model its catalog has not caught up with from the one protocol all of the provider's shipped models
 * share, so ownership needs the complete provider catalog and not only the Responses subset.
 */
export declare function getCatalogModels(provider: string): readonly Model<Api>[];
