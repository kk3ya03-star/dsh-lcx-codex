import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { type SearchUsage } from '../search-accounting.js';
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
    interface ConversationTurnDataMap {
        'lcx-search-usage': readonly SearchUsage[];
    }
}
/** A turn-local data contribution; it adds no transcript rows and keeps built-in actions. */
export declare const searchUsageDefinition: ConversationNodeDefinition<{
    turn: number;
    records: SearchUsage[];
    pending: Record<string, string>;
    complete: boolean;
}>;
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
