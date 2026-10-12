// Public Pi 1.1.0 runtime surface used by LCX. The release build bundles this file.
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
export { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
export { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
export { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "@earendil-works/pi-ai/api/github-copilot-headers";
export { withOpenCodeSessionHeader } from "@earendil-works/pi-ai/providers/opencode-headers";

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

/**
 * Every catalog entry of a bundled provider whatever its wire protocol. DSH resolves the protocol of a
 * model its catalog has not caught up with from the one protocol all of the provider's shipped models
 * share, so ownership needs the complete provider catalog and not only the Responses subset.
 */
export function getCatalogModels(provider: string): readonly Model<Api>[] {
  return Object.hasOwn(RESPONSE_CATALOGS, provider)
    ? Object.values(RESPONSE_CATALOGS[provider as BundledResponsesProvider]).filter(
        // Pi 1.x catalogs may also hold image / classifier models; only chat models are routable here.
        (model) => (model as { type?: string }).type === undefined || (model as { type?: string }).type === "chat",
      )
    : [];
}
