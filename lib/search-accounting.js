export const object = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export const zeroBuckets = () => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
export const isSearchTool = (name) => name === 'web_search' || name === 'websearch_gpt_advanced';
export function auxiliaryUsageOf(event, toolName) {
    if (!object(event) || event.type !== 'tool/result' || !object(event.data?.meta))
        return [];
    // Only our owned search results may contribute auxiliary billing.
    // Official ToolMessageSource carries only callId; resolve its name from tool/call.
    if (!isSearchTool(toolName))
        return [];
    const raw = event.data.meta.auxiliaryUsage;
    if (!Array.isArray(raw))
        return [];
    const ids = new Set(), result = [];
    for (const item of raw) {
        if (!object(item) || typeof item.requestId !== 'string' || !item.requestId
            || typeof item.provider !== 'string' || !item.provider || typeof item.model !== 'string' || !item.model
            || !object(item.usage) || ids.has(item.requestId))
            continue;
        const u = item.usage;
        if (![u.inputTokens, u.outputTokens, u.totalTokens, u.cacheReadTokens, u.cacheWriteTokens].every(count)
            || u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens !== u.totalTokens)
            continue;
        ids.add(item.requestId);
        result.push(item);
    }
    return result;
}
export function addUsage(base, records) {
    if (!records.length)
        return base;
    const next = { ...base };
    for (const { usage: u } of records) {
        next.uncachedInputTokens += u.inputTokens;
        next.outputTokens += u.outputTokens;
        next.cacheReadTokens += u.cacheReadTokens;
        next.cacheWriteTokens += u.cacheWriteTokens;
    }
    if (!Object.values(next).every(count))
        throw new Error('LCX search usage exceeds safe counters');
    return next;
}
export function mergeBuckets(base, extra) {
    if (!object(base) || Object.values(extra).every(n => n === 0))
        return base;
    const next = { ...base };
    for (const key of Object.keys(extra)) {
        // Keep unavailable host buckets unavailable rather than inventing zero.
        if (count(base[key]))
            next[key] = base[key] + extra[key];
    }
    return next;
}
export function addTurnUsage(base, records) {
    if (!object(base) || !records.length || !count(base.totalTokens))
        return base;
    const next = mergeBuckets(base, addUsage(zeroBuckets(), records));
    next.totalTokens = base.totalTokens + records.reduce((n, r) => n + r.usage.totalTokens, 0);
    // Auxiliary responses do not always disclose a reasoning subset.
    delete next.reasoningTokens;
    if (Array.isArray(base.routes)) {
        const routes = new Map();
        for (const r of [...base.routes, ...records])
            routes.set(`${r.provider}\0${r.model}`, { provider: r.provider, model: r.model });
        next.routes = [...routes.values()];
    }
    return next;
}
/** The metadata is presentation/accounting state; it never changes request messages. */
export function aggregateContextOf(event) {
    if (!object(event) || !['assistant/message', 'assistant/attempt'].includes(event.type) || !object(event.data))
        return;
    const chunks = Array.isArray(event.data.stream) ? event.data.stream.filter((e) => e.type === 'chunk').map((e) => e.chunk) : [];
    const sample = event.data.usage ?? chunks.findLast((c) => c?.type === 'usage')?.usage;
    if (!object(sample))
        return;
    const replay = chunks.findLast((c) => c?.type === 'finish')?.replayState;
    const mark = replay?.response?.lcxUsage;
    if (mark?.version === 1 && ['request', 'aggregate'].includes(mark.inputTokenScope))
        return mark.inputTokenScope === 'aggregate';
    // Read the already-installed local candidate without rewriting its logs.
    if (sample.inputTokenScope === 'aggregate' || sample.inputTokenScope === 'request')
        return sample.inputTokenScope === 'aggregate';
    return replay?.grokNative?.kind === 'xai-responses-native-search' && replay.grokNative.version === 3;
}
