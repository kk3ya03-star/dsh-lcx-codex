import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { auxiliaryUsageOf, isSearchTool, NESTED_SETTLE_EVENT, object, type SearchUsage } from '../search-accounting.js';
import { createCallTurns, type CallTurns } from './nested-calls.js';

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap { 'lcx-search-usage': readonly SearchUsage[] }
}
type UsageState = {turn:number;records:SearchUsage[];pending:Record<string,string>;complete:boolean};
/**
 * A turn-local data contribution; it adds no transcript rows and keeps built-in actions. A nested settlement
 * carries no turn: it is resolved through the root call it names, remembered in `callTurns` (see nested-calls.ts),
 * which the owner clears when the Definition is unregistered.
 */
export function createSearchUsageDefinition(callTurns:CallTurns=createCallTurns()): ConversationNodeDefinition<UsageState> {
  return {
  kind:'lcx-search-usage',
  match(event) {
    if (event.type!=='assistant/live-chunk') callTurns.observe(event.seq);
    if (event.type==='turn/start') callTurns.openTurn(event.data.turn);
    if (event.type==='turn/end') callTurns.closeTurn(event.data.turn);
    if (event.type==='turn/start') return {id:String(event.data.turn),role:'start'};
    if (event.type==='tool/call') callTurns.remember(event.data.callId,event.data.turn);
    if (event.type==='turn/end' || event.type==='tool/result' || event.type==='tool/call') return {id:String(event.data.turn),role:'update'};
    if (event.type===NESTED_SETTLE_EVENT) {
      const turn=callTurns.turnOf(event.data.rootCallId);
      return turn===undefined ? null : {id:String(turn),role:'update'};
    }
    return null;
  },
  start(_context,match) {
    if (match.event.type!=='turn/start') throw new Error('LCX billing requires a complete turn');
    return {turn:match.event.data.turn,records:[],pending:{},complete:false};
  },
  update(context,match) {
    const event=match.event,state=context.state,pending={...state.pending};
    if(event.type==='tool/call' && isSearchTool(event.data.name)) pending[event.data.callId]=event.data.name;
    const callId=event.type==='tool/result'?event.data.message.source.callId:undefined;
    // A nested settlement names its own tool, so it never has (or needs) a pending entry.
    const extra=auxiliaryUsageOf(event,callId?pending[callId]:undefined);
    if(callId)delete pending[callId];
    return {...state,pending,records:[...state.records,...extra],complete:event.type==='turn/end'};
  },
  publication:match=>match.event.type==='turn/end'?'immediate':'none',
  buildLocationData(context,scope) {
    const s=context.state;
    return scope==='turn' && s?.complete ? {kind:'turn',turn:s.turn,key:'lcx-search-usage',value:s.records}:null;
  },
  };
}
export const searchUsageDefinition = createSearchUsageDefinition();
type Translator = (key: string) => string;
type CreateElement = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => unknown;
type UsageSlotName = 'conversation.chat.turnTail' | 'conversation.composer.dock';
type UsageRegistration = { name: UsageSlotName; id: string; order: number; locale: string };
type Slots = {
  inject(name: UsageSlotName, callback: () => unknown): unknown;
  register(options: UsageRegistration, component: unknown): unknown;
};
type TurnTailUsageProps = TurnTailOwnerProps & { t?: Translator };
type SessionUsageProps = { useProjection: (key: string) => unknown; t?: Translator };

function tokenCount(value: number): string {
  return String(value);
}

function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export type CacheHitRate = {
  readonly percent: number;
  readonly cacheReadTokens: number;
  readonly promptTokens: number;
};

/**
 * Pure presentation helper: derive integer prompt-cache hit percentage from
 * DSH TurnTokenUsage or session TokenUsage counters without side effects.
 */
export function promptCacheHitRate(usage: unknown): CacheHitRate | null {
  if (!object(usage)) return null;
  const cacheReadTokens = usage.cacheReadTokens;
  if (!isSafeCount(cacheReadTokens)) return null;

  let promptTokens: number;
  if (usage.totalTokens !== undefined) {
    if (!isSafeCount(usage.totalTokens) || !isSafeCount(usage.outputTokens)) return null;
    if (usage.totalTokens < usage.outputTokens) return null;
    promptTokens = usage.totalTokens - usage.outputTokens;
    const hasUncached = usage.uncachedInputTokens !== undefined;
    const hasWrite = usage.cacheWriteTokens !== undefined;
    if (hasUncached && !isSafeCount(usage.uncachedInputTokens)) return null;
    if (hasWrite && !isSafeCount(usage.cacheWriteTokens)) return null;
    const knownPrompt = BigInt(hasUncached ? usage.uncachedInputTokens : 0) +
      BigInt(cacheReadTokens) +
      BigInt(hasWrite ? usage.cacheWriteTokens : 0);
    if (knownPrompt > BigInt(promptTokens)) return null;
  } else {
    if (!isSafeCount(usage.uncachedInputTokens)) return null;
    if (usage.cacheWriteTokens !== undefined && !isSafeCount(usage.cacheWriteTokens)) return null;
    const sum = BigInt(usage.uncachedInputTokens) + BigInt(cacheReadTokens) + BigInt(usage.cacheWriteTokens ?? 0);
    if (sum > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    promptTokens = Number(sum);
  }

  if (promptTokens <= 0 || cacheReadTokens > promptTokens) return null;
  if (cacheReadTokens === promptTokens) {
    return { percent: 100, cacheReadTokens, promptTokens };
  }
  const numerator = BigInt(cacheReadTokens);
  const denominator = BigInt(promptTokens);
  const rounded = Number((numerator * 100n + denominator / 2n) / denominator);
  return { percent: rounded >= 100 ? 99 : rounded, cacheReadTokens, promptTokens };
}

function recordsTotal(records: readonly SearchUsage[]): number {
  let total = 0;
  for (const record of records) {
    const value = record.usage.totalTokens;
    if (!Number.isSafeInteger(value) || value < 0) continue;
    total += value;
    if (!Number.isSafeInteger(total)) return 0;
  }
  return total;
}

function bucketsTotal(value: unknown): number {
  if (!object(value)) return 0;
  let total = 0;
  for (const key of ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
    const count = value[key];
    if (!Number.isSafeInteger(count) || count < 0) return 0;
    total += count;
    if (!Number.isSafeInteger(total)) return 0;
  }
  return total;
}

function usageView(createElement: CreateElement, scope: 'turn' | 'session', total: number, t?: Translator): unknown {
  if (total <= 0) return null;
  const label = t?.(scope === 'turn' ? 'usageTurn' : 'usageSession') ?? 'Search usage';
  return createElement('span', {
    className: `lcx-search-usage lcx-search-usage-${scope}`,
    'data-lcx-search-usage': scope,
    title: `${label}: ${tokenCount(total)}`,
  }, `${label}: ${tokenCount(total)}`);
}

function cacheHitView(createElement: CreateElement, usage: unknown, t?: Translator): unknown {
  const rate = promptCacheHitRate(usage);
  if (!rate) return null;
  const label = t?.('cacheHitTurn') ?? 'Cache';
  const titleLabel = t?.('cacheHitTurnTitle') ?? 'Prompt cache hit rate';
  return createElement('span', {
    className: 'lcx-cache-hit lcx-cache-hit-turn',
    'data-lcx-cache-hit': 'turn',
    title: `${titleLabel}: ${rate.percent}% (${tokenCount(rate.cacheReadTokens)} / ${tokenCount(rate.promptTokens)})`,
  }, `${label} ${rate.percent}%`);
}

/** Additive turn-local usage contribution; the DSH turn-tail renderer remains the owner. */
function TurnTailUsage({ turn, t }: TurnTailUsageProps, createElement?: CreateElement): unknown {
  if (!createElement) return null;
  const rawSearch = turn?.data?.get?.('lcx-search-usage');
  const searchEl = usageView(createElement, 'turn', recordsTotal(Array.isArray(rawSearch) ? rawSearch : []), t);
  const rawTail = turn?.data?.get?.('turn-tail');
  const cacheEl = cacheHitView(createElement, object(rawTail) ? rawTail.tokenUsage : undefined, t);
  if (searchEl && cacheEl) {
    return createElement('span', {
      className: 'lcx-turn-usage',
      'data-lcx-turn-usage': 'turn',
    }, searchEl, cacheEl);
  }
  return searchEl ?? cacheEl ?? null;
}

/** Separate session-level LCX surface; the built-in StatsPills projection is untouched. */
function SessionUsage({ useProjection, t }: SessionUsageProps, createElement?: CreateElement): unknown {
  if (!createElement) return null;
  const extra = useProjection('lcxSearchUsage');
  const auxiliary = object(extra) ? extra.auxiliary : undefined;
  return usageView(createElement, 'session', bucketsTotal(auxiliary), t);
}

/** Register only LCX-owned additive list entries; never inspect or replace DSH entries. */
export function installUsageSlots(slots: Slots, createElement: CreateElement): () => void {
  const registrations: readonly [UsageRegistration, unknown][] = [
    [{ name: 'conversation.chat.turnTail', id: 'lcx-search-usage-turn', order: 0, locale: 'lcx-codex' },
      (props: TurnTailUsageProps) => TurnTailUsage(props, createElement)],
    [{ name: 'conversation.composer.dock', id: 'lcx-search-usage-session', order: 10, locale: 'lcx-codex' },
      (props: SessionUsageProps) => SessionUsage(props, createElement)],
  ];
  const cleanups: (() => void)[] = [];
  for (const [name, component] of registrations) {
    try {
      const effect = slots.inject(name.name, () => {
        const dispose = slots.register(name, component);
        return typeof dispose === 'function' ? dispose : undefined;
      });
      if (typeof effect === 'function') cleanups.push(effect as () => void);
    } catch {
      // Optional client surfaces fail closed while the owning fiber remains unloadable.
    }
  }
  return () => {
    for (const dispose of cleanups.reverse()) dispose();
  };
}
