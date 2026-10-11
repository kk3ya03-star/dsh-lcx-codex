import type { RequestMessage } from "@deepseek-ai/dsh-llm";
import type { Message } from "@earendil-works/pi-ai";
import {
  buildCopilotDynamicHeaders,
  hasCopilotVisionInput,
  withOpenCodeSessionHeader,
} from "./pi-responses-runtime.js";

/**
 * Request headers that Pi's own client adds for a catalog provider beyond the model's static `headers`. LCX
 * builds the Responses request itself, so it asks Pi's public helpers for them instead of restating the rules,
 * and the provider receives what Pi's client would send.
 */
type HeaderMap = Record<string, string>;

/** The user / assistant / toolResult view of a DSH request that Pi's Copilot helpers read. */
function piMessages(messages: readonly RequestMessage[]): Message[] {
  const result: Message[] = [];
  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant")
      result.push({ role: message.role, content: message.content } as unknown as Message);
    else if (message.role === "tool")
      result.push({ role: "toolResult", content: message.content } as unknown as Message);
  }
  return result;
}

/** GitHub Copilot: `X-Initiator`, `Openai-Intent` and, when images are sent, `Copilot-Vision-Request`. */
export function providerDynamicHeaders(provider: string, messages: readonly RequestMessage[]): HeaderMap {
  if (provider !== "github-copilot") return {};
  const pi = piMessages(messages);
  return buildCopilotDynamicHeaders({ messages: pi, hasImages: hasCopilotVisionInput(pi) });
}

/** OpenCode Zen / Go: the per-conversation routing header Pi adds before dispatch. */
export function providerSessionHeaders(provider: string, sessionId: string | undefined): HeaderMap {
  if ((provider !== "opencode" && provider !== "opencode-go") || sessionId === undefined) return {};
  let captured: HeaderMap = {};
  const capture = (_model: unknown, _context: unknown, options: { headers?: HeaderMap } | undefined) => {
    captured = { ...options?.headers };
    return undefined as never;
  };
  withOpenCodeSessionHeader({ stream: capture, streamSimple: capture } as never).stream(
    undefined as never,
    undefined as never,
    { sessionId } as never,
  );
  return captured;
}
