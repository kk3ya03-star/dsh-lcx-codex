import type { RequestMessage } from "@deepseek-ai/dsh-llm";
/**
 * Request headers that Pi's own client adds for a catalog provider beyond the model's static `headers`. LCX
 * builds the Responses request itself, so it asks Pi's public helpers for them instead of restating the rules,
 * and the provider receives what Pi's client would send.
 */
type HeaderMap = Record<string, string>;
/** GitHub Copilot: `X-Initiator`, `Openai-Intent` and, when images are sent, `Copilot-Vision-Request`. */
export declare function providerDynamicHeaders(provider: string, messages: readonly RequestMessage[]): HeaderMap;
/** OpenCode Zen / Go: the per-conversation routing header Pi adds before dispatch. */
export declare function providerSessionHeaders(provider: string, sessionId: string | undefined): HeaderMap;
export {};
