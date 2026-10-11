import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { type SearchUsage } from '../search-accounting.js';
import { type CallTurns } from './nested-calls.js';
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
    interface ConversationTurnDataMap {
        'lcx-search-usage': readonly SearchUsage[];
    }
}
type UsageState = {
    turn: number;
    records: SearchUsage[];
    pending: Record<string, string>;
    complete: boolean;
};
/**
 * A turn-local data contribution; it adds no transcript rows and keeps built-in actions. A nested settlement
 * carries no turn: it is resolved through the root call it names, remembered in `callTurns` (see nested-calls.ts),
 * which the owner clears when the Definition is unregistered.
 */
export declare function createSearchUsageDefinition(callTurns?: CallTurns): ConversationNodeDefinition<UsageState>;
export declare const searchUsageDefinition: ConversationNodeDefinition<UsageState>;
type CreateElement = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => unknown;
type UsageSlotName = 'conversation.chat.turnTail' | 'conversation.composer.dock';
type UsageRegistration = {
    name: UsageSlotName;
    id: string;
    order: number;
    locale: string;
};
type Slots = {
    inject(name: UsageSlotName, callback: () => unknown): unknown;
    register(options: UsageRegistration, component: unknown): unknown;
};
/** Register only LCX-owned additive list entries; never inspect or replace DSH entries. */
export declare function installUsageSlots(slots: Slots, createElement: CreateElement): () => void;
export {};
