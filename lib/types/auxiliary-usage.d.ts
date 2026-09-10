import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
/** Collect only authoritative Responses billing, independently of context size. */
export declare function recordHostedUsage(response: unknown, requestId: string, provider: string, model: string): void;
/** Extend only LCX-owned search output; rendering and request schemas stay intact. */
export declare function withAuxiliaryUsage(tool: ToolDefinition): ToolDefinition;
