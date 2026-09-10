// Public Pi 0.85.1 runtime surface used by LCX. The release build bundles this file.
import type { Api, Model } from "@earendil-works/pi-ai";
import { CLOUDFLARE_AI_GATEWAY_MODELS } from "@earendil-works/pi-ai/providers/cloudflare-ai-gateway.models";
import { GITHUB_COPILOT_MODELS } from "@earendil-works/pi-ai/providers/github-copilot.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { OPENCODE_MODELS } from "@earendil-works/pi-ai/providers/opencode.models";
import { OPENCODE_GO_MODELS } from "@earendil-works/pi-ai/providers/opencode-go.models";
import { XAI_MODELS } from "@earendil-works/pi-ai/providers/xai.models";

export {
  convertResponsesMessages,
  convertResponsesTools,
  processResponsesStream,
} from "@earendil-works/pi-ai/api/openai-responses-shared";
export { createGrammarToolInputProperties } from "@earendil-works/pi-ai/api/constrained-sampling";
export { clampOpenAIPromptCacheKey } from "@earendil-works/pi-ai/api/openai-prompt-cache";
export { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
export { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

export type BundledResponsesProvider =
  | "cloudflare-ai-gateway"
  | "github-copilot"
  | "openai"
  | "opencode"
  | "opencode-go"
  | "xai";

const RESPONSE_CATALOGS: Readonly<
  Record<BundledResponsesProvider, Readonly<Record<string, Model<Api>>>>
> = {
  "cloudflare-ai-gateway": CLOUDFLARE_AI_GATEWAY_MODELS,
  "github-copilot": GITHUB_COPILOT_MODELS,
  openai: OPENAI_MODELS,
  opencode: OPENCODE_MODELS,
  "opencode-go": OPENCODE_GO_MODELS,
  xai: XAI_MODELS,
};

const providers: readonly BundledResponsesProvider[] = Object.freeze(
  Object.keys(RESPONSE_CATALOGS) as BundledResponsesProvider[],
);
function responsesOnly(
  catalog: Readonly<Record<string, Model<Api>>>,
): readonly Model<"openai-responses">[] {
  return Object.values(catalog).filter(
    (model): model is Model<"openai-responses"> => model.api === "openai-responses",
  );
}
const models: Readonly<
  Record<BundledResponsesProvider, readonly Model<"openai-responses">[]>
> = {
  "cloudflare-ai-gateway": responsesOnly(RESPONSE_CATALOGS["cloudflare-ai-gateway"]),
  "github-copilot": responsesOnly(RESPONSE_CATALOGS["github-copilot"]),
  openai: responsesOnly(RESPONSE_CATALOGS.openai),
  opencode: responsesOnly(RESPONSE_CATALOGS.opencode),
  "opencode-go": responsesOnly(RESPONSE_CATALOGS["opencode-go"]),
  xai: responsesOnly(RESPONSE_CATALOGS.xai),
};

export function getBuiltinProviders(): readonly BundledResponsesProvider[] {
  return providers;
}

export function getBuiltinModels(provider: string): readonly Model<"openai-responses">[] {
  return models[provider as BundledResponsesProvider] ?? [];
}
