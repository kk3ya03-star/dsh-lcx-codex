import type { Message } from "@deepseek-ai/dsh-llm";
type InputItem = Record<string, unknown>;
/** Codex recent_input on the canonical DSH message surface. */
export declare function recentAlphaInput(messages: readonly Message[]): InputItem[] | undefined;
export {};
