/** JSON-only accounting helpers shared by the host projection and client slots. */
export type Buckets = { uncachedInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
export type SearchUsage = { requestId: string; provider: string; model: string; usage: {
  inputTokens: number; outputTokens: number; totalTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
} };
export const object = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export const zeroBuckets = (): Buckets => ({uncachedInputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0});
export const isSearchTool = (name: unknown): name is string => name === 'web_search' || name === 'websearch_gpt_advanced';
export function auxiliaryUsageOf(event: unknown, toolName?: string): SearchUsage[] {
  if (!object(event) || event.type !== 'tool/result' || !object(event.data?.meta)) return [];
  // Only our owned search results may contribute auxiliary billing.
  // Official ToolMessageSource carries only callId; resolve its name from tool/call.
  if (!isSearchTool(toolName)) return [];
  const raw = event.data.meta.auxiliaryUsage;
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>(), result: SearchUsage[] = [];
  for (const item of raw) {
    if (!object(item) || typeof item.requestId !== 'string' || !item.requestId
      || typeof item.provider !== 'string' || !item.provider || typeof item.model !== 'string' || !item.model
      || !object(item.usage) || ids.has(item.requestId)) continue;
    const u = item.usage;
    if (![u.inputTokens,u.outputTokens,u.totalTokens,u.cacheReadTokens,u.cacheWriteTokens].every(count)
      || u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens !== u.totalTokens) continue;
    ids.add(item.requestId); result.push(item as SearchUsage);
  }
  return result;
}
export function addUsage(base: Buckets, records: readonly SearchUsage[]): Buckets {
  if (!records.length) return base;
  const next = {...base};
  for (const {usage:u} of records) {
    next.uncachedInputTokens += u.inputTokens; next.outputTokens += u.outputTokens;
    next.cacheReadTokens += u.cacheReadTokens; next.cacheWriteTokens += u.cacheWriteTokens;
  }
  if (!Object.values(next).every(count)) throw new Error('LCX search usage exceeds safe counters');
  return next;
}
export function mergeBuckets(base: unknown, extra: Buckets): unknown {
  if (!object(base) || Object.values(extra).every(n=>n===0)) return base;
  const next = {...base};
  for (const key of Object.keys(extra) as (keyof Buckets)[]) {
    // Keep unavailable host buckets unavailable rather than inventing zero.
    if (count(base[key])) next[key] = base[key] + extra[key];
  }
  return next;
}
export function addTurnUsage(base: unknown, records: readonly SearchUsage[]): unknown {
  if (!object(base) || !records.length || !count(base.totalTokens)) return base;
  const next = mergeBuckets(base, addUsage(zeroBuckets(),records)) as Record<string,unknown>;
  next.totalTokens = base.totalTokens + records.reduce((n,r)=>n+r.usage.totalTokens,0);
  // Auxiliary responses do not always disclose a reasoning subset.
  delete next.reasoningTokens;
  if (Array.isArray(base.routes)) {
    const routes = new Map<string,unknown>();
    for (const r of [...base.routes,...records]) routes.set(`${r.provider}\0${r.model}`,{provider:r.provider,model:r.model});
    next.routes = [...routes.values()];
  }
  return next;
}
/** The metadata is presentation/accounting state; it never changes request messages. */
export function aggregateContextOf(event: unknown): boolean | undefined {
  if (!object(event) || !['assistant/message','assistant/attempt'].includes(event.type) || !object(event.data)) return;
  const chunks = Array.isArray(event.data.stream) ? event.data.stream.filter((e:any)=>e.type==='chunk').map((e:any)=>e.chunk) : [];
  const sample = event.data.usage ?? chunks.findLast((c:any)=>c?.type==='usage')?.usage;
  if (!object(sample)) return;
  const replay = chunks.findLast((c:any)=>c?.type==='finish')?.replayState;
  const mark = replay?.response?.lcxUsage;
  if (mark?.version===1 && ['request','aggregate'].includes(mark.inputTokenScope)) return mark.inputTokenScope==='aggregate';
  // Read the already-installed local candidate without rewriting its logs.
  if (sample.inputTokenScope==='aggregate' || sample.inputTokenScope==='request') return sample.inputTokenScope==='aggregate';
  return replay?.grokNative?.kind==='xai-responses-native-search' && replay.grokNative.version===3;
}
