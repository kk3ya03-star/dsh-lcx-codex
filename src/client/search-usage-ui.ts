import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { auxiliaryUsageOf, isSearchTool, object, type SearchUsage } from '../search-accounting.js';

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap { 'lcx-search-usage': readonly SearchUsage[] }
}
/** A turn-local data contribution; it adds no transcript rows and keeps built-in actions. */
export const searchUsageDefinition: ConversationNodeDefinition<{turn:number;records:SearchUsage[];pending:Record<string,string>;complete:boolean}> = {
  kind:'lcx-search-usage',
  match(event) {
    if (event.type==='turn/start') return {id:String(event.data.turn),role:'start'};
    if (event.type==='turn/end' || event.type==='tool/result' || event.type==='tool/call') return {id:String(event.data.turn),role:'update'};
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

/** Additive turn-local usage contribution; the DSH turn-tail renderer remains the owner. */
function TurnTailUsage({ turn, t }: TurnTailUsageProps, createElement?: CreateElement): unknown {
  if (!createElement) return null;
  return usageView(createElement, 'turn', recordsTotal(turn.data.get('lcx-search-usage') ?? []), t);
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
