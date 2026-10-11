import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolExecutionResult, ToolDispatchExecution } from "@deepseek-ai/dsh-tools";

export type ToolExecuteListener = (
  exec: ToolDispatchExecution,
  next: () => Promise<ToolExecutionResult>,
) => Promise<ToolExecutionResult>;

type UsageRecord = { requestId: string; provider: string; model: string; usage: {
  inputTokens: number; outputTokens: number; totalTokens: number;
  cacheReadTokens: number; cacheWriteTokens: number;
} };
const calls = new AsyncLocalStorage<UsageRecord[]>();
/**
 * Usage a search already billed before its body threw, keyed by the execution object the registry
 * passes to both the body and the around-dispatch wrappers. DSH builds a failed result from the thrown
 * error alone, so the records can only reach `meta` through `installFailedAuxiliaryUsage`.
 */
const failedBilling = new WeakMap<object, UsageRecord[]>();
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Collect only authoritative Responses billing, independently of context size. */
export function recordHostedUsage(response: unknown, requestId: string, provider: string, model: string): void {
  const store = calls.getStore();
  if (!store || !object(response) || !object(response.usage)) return;
  const u = response.usage;
  const input = u.input_tokens, output = u.output_tokens, total = u.total_tokens;
  const details = object(u.input_tokens_details) ? u.input_tokens_details : undefined;
  const cached = details?.cached_tokens;
  // Same disjoint accounting as the main Responses path: input = input_tokens - cached - cache_write.
  // An absent or null cache_write_tokens is zero; any other non-counter value is not authoritative.
  const written = details?.cache_write_tokens ?? 0;
  if (!count(input) || !count(output) || !count(total) || !count(cached) || !count(written)
    || cached + written > input || input + output !== total) return;
  store.push({ requestId, provider, model, usage: {
    inputTokens: input - cached - written, outputTokens: output, totalTokens: total,
    cacheReadTokens: cached, cacheWriteTokens: written,
  } });
}

/** Extend only LCX-owned search output; rendering and request schemas stay intact. */
export function withAuxiliaryUsage(tool: ToolDefinition): ToolDefinition {
  const schema = tool.output.schema;
  if (schema.type !== "object") throw new Error("Search accounting requires an object output");
  return {
    ...tool,
    output: {
      ...tool.output,
      schema: { ...schema, properties: { ...schema.properties, auxiliaryUsage: {
        type: "array", items: { type: "object", additionalProperties: true },
      } } },
      render(args, value) {
        if (!object(value)) return tool.output.render(args, value);
        const { auxiliaryUsage: _billing, ...original } = value;
        return tool.output.render(args, original);
      },
      presentationMeta(args, value) {
        if (!object(value)) return tool.output.presentationMeta?.(args, value) ?? {};
        const { auxiliaryUsage, ...original } = value;
        const meta = tool.output.presentationMeta?.(args, original) ?? {};
        if (!Array.isArray(auxiliaryUsage) || auxiliaryUsage.length === 0) return meta;
        if (!object(meta)) throw new Error("Search accounting requires object presentation metadata");
        return { ...meta, auxiliaryUsage };
      },
    },
    async execute(args, exec) {
      const records: UsageRecord[] = [];
      return calls.run(records, async () => {
        let value: unknown;
        try {
          value = await tool.execute(args, exec);
        } catch (error) {
          // Already-billed requests must not vanish with the failure that followed them.
          if (records.length > 0 && object(exec)) failedBilling.set(exec, records);
          throw error;
        }
        if (records.length === 0) return value;
        if (!object(value)) throw new Error("Search accounting requires an object result");
        return { ...value, auxiliaryUsage: records };
      });
    },
  };
}

/**
 * Attach the billing a failed search collected to its error result. The around-dispatch wrapper is the
 * one DSH seam that may author `meta` on a failure; the session search-usage projection then reads it
 * from the persisted `tool/result` exactly as it does for a successful call.
 */
export const failedAuxiliaryUsageListener: ToolExecuteListener = async (exec, next) => {
  const result = await next();
  if (!result.isError) return result;
  const records = failedBilling.get(exec);
  if (records === undefined || records.length === 0) return result;
  const meta: Record<string, unknown> = object(result.meta) ? { ...result.meta } : {};
  meta.auxiliaryUsage = records;
  return { ...result, meta } as typeof result;
};

/** Register {@link failedAuxiliaryUsageListener} on one context; returns the disposer. */
export function installFailedAuxiliaryUsage(ctx: Context): () => void {
  return ctx.on("tools/execute", failedAuxiliaryUsageListener);
}
