import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolExecutionResult, ToolDispatchExecution } from "@deepseek-ai/dsh-tools";
export type ToolExecuteListener = (exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>) => Promise<ToolExecutionResult>;
/** Collect only authoritative Responses billing, independently of context size. */
export declare function recordHostedUsage(response: unknown, requestId: string, provider: string, model: string): void;
/** Extend only LCX-owned search output; rendering and request schemas stay intact. */
export declare function withAuxiliaryUsage(tool: ToolDefinition): ToolDefinition;
/**
 * Attach the billing a failed search collected to its error result. The around-dispatch wrapper is the
 * one DSH seam that may author `meta` on a failure; the session search-usage projection then reads it
 * from the persisted `tool/result` exactly as it does for a successful call.
 */
export declare const failedAuxiliaryUsageListener: ToolExecuteListener;
/** Register {@link failedAuxiliaryUsageListener} on one context; returns the disposer. */
export declare function installFailedAuxiliaryUsage(ctx: Context): () => void;
