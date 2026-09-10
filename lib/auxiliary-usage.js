import { AsyncLocalStorage } from "node:async_hooks";
const calls = new AsyncLocalStorage();
const object = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
/** Collect only authoritative Responses billing, independently of context size. */
export function recordHostedUsage(response, requestId, provider, model) {
    const store = calls.getStore();
    if (!store || !object(response) || !object(response.usage))
        return;
    const u = response.usage;
    const input = u.input_tokens, output = u.output_tokens, total = u.total_tokens;
    const cached = object(u.input_tokens_details) ? u.input_tokens_details.cached_tokens : undefined;
    if (!count(input) || !count(output) || !count(total) || !count(cached)
        || cached > input || input + output !== total)
        return;
    store.push({ requestId, provider, model, usage: {
            inputTokens: input - cached, outputTokens: output, totalTokens: total,
            cacheReadTokens: cached, cacheWriteTokens: 0,
        } });
}
/** Extend only LCX-owned search output; rendering and request schemas stay intact. */
export function withAuxiliaryUsage(tool) {
    const schema = tool.output.schema;
    if (schema.type !== "object")
        throw new Error("Search accounting requires an object output");
    return {
        ...tool,
        output: {
            ...tool.output,
            schema: { ...schema, properties: { ...schema.properties, auxiliaryUsage: {
                        type: "array", items: { type: "object", additionalProperties: true },
                    } } },
            render(args, value) {
                if (!object(value))
                    return tool.output.render(args, value);
                const { auxiliaryUsage: _billing, ...original } = value;
                return tool.output.render(args, original);
            },
            presentationMeta(args, value) {
                if (!object(value))
                    return tool.output.presentationMeta?.(args, value) ?? {};
                const { auxiliaryUsage, ...original } = value;
                const meta = tool.output.presentationMeta?.(args, original) ?? {};
                if (!Array.isArray(auxiliaryUsage) || auxiliaryUsage.length === 0)
                    return meta;
                if (!object(meta))
                    throw new Error("Search accounting requires object presentation metadata");
                return { ...meta, auxiliaryUsage };
            },
        },
        async execute(args, exec) {
            const records = [];
            return calls.run(records, async () => {
                const value = await tool.execute(args, exec);
                if (records.length === 0)
                    return value;
                if (!object(value))
                    throw new Error("Search accounting requires an object result");
                return { ...value, auxiliaryUsage: records };
            });
        },
    };
}
