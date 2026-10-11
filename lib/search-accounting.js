export const object = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
/** Copy only complete, safe counters; provider extensions never enter durable metadata. */
export function sanitizeContextDetails(value) {
    if (!object(value) || !count(value.input_tokens) || !count(value.output_tokens))
        return;
    return { input_tokens: value.input_tokens, output_tokens: value.output_tokens };
}
export const zeroBuckets = () => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
export const isSearchTool = (name) => name === 'web_search' || name === 'websearch_gpt_advanced';
/** DSH 0.2.1 settles a tool called from inside programmatic tool calling (`run_code`) with this event, not `tool/result`. */
export const NESTED_SETTLE_EVENT = 'tool/ptc-dispatch';
/**
 * A search call's settlement and its tool-owned presentation `meta`, from either event that carries one: a
 * model-direct call settles as `tool/result` (its name comes from the earlier `tool/call`); a nested call settles
 * as `tool/ptc-dispatch`, whose `name`, `subCallId` and `meta` are its own fields.
 */
function searchSettlementOf(event, pendingName) {
    if (!object(event) || !object(event.data) || !object(event.data.meta))
        return;
    // Official ToolMessageSource carries only callId; a direct result resolves its name from tool/call.
    // A nested settlement states the tool it dispatched, so it needs no pending entry.
    const name = event.type === NESTED_SETTLE_EVENT ? event.data.name : event.type === 'tool/result' ? pendingName : undefined;
    // Only our owned search results may contribute auxiliary billing or media.
    return isSearchTool(name) ? { name, meta: event.data.meta } : undefined;
}
export function auxiliaryUsageOf(event, toolName) {
    const settled = searchSettlementOf(event, toolName);
    if (!settled)
        return [];
    const raw = settled.meta.auxiliaryUsage;
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
/** The metadata is presentation/accounting state; it never changes request messages. */
export function aggregateContextOf(event) {
    const mark = contextMarkerOf(event);
    if (mark === undefined)
        return;
    return mark?.version === 1 && mark.inputTokenScope === 'aggregate';
}
function contextMarkerOf(event) {
    if (!object(event) || !['assistant/message', 'assistant/attempt'].includes(event.type) || !object(event.data))
        return;
    const chunks = Array.isArray(event.data.stream) ? event.data.stream.filter((e) => e.type === 'chunk').map((e) => e.chunk) : [];
    const sample = event.data.usage ?? chunks.findLast((c) => c?.type === 'usage')?.usage;
    if (!object(sample))
        return;
    const replay = chunks.findLast((c) => c?.type === 'finish')?.replayState;
    const mark = replay?.response?.lcxUsage;
    if (object(mark) && mark.version === 1 && ['request', 'aggregate'].includes(mark.inputTokenScope))
        return mark;
    // Without a valid durable scope marker, preserve DSH's ordinary usage baseline.
    return null;
}
export function providerContextOf(event) {
    const mark = contextMarkerOf(event);
    if (mark?.inputTokenScope !== 'aggregate' || mark.contextProvenance !== 'provider-context-details')
        return;
    return sanitizeContextDetails(mark.contextDetails);
}
