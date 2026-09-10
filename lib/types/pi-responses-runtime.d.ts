import type { Model } from "@earendil-works/pi-ai";
export { convertResponsesMessages, convertResponsesTools, processResponsesStream, } from "@earendil-works/pi-ai/api/openai-responses-shared";
export { createGrammarToolInputProperties } from "@earendil-works/pi-ai/api/constrained-sampling";
export { clampOpenAIPromptCacheKey } from "@earendil-works/pi-ai/api/openai-prompt-cache";
export { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
export { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
export type BundledResponsesProvider = "cloudflare-ai-gateway" | "github-copilot" | "openai" | "opencode" | "opencode-go" | "xai";
export declare function getBuiltinProviders(): readonly BundledResponsesProvider[];
export declare function getBuiltinModels(provider: string): readonly Model<"openai-responses">[];
