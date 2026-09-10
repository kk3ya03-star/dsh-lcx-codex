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
type Entry = {
    component: unknown;
    options?: {
        id?: string;
        key?: string;
        order?: number;
        priority?: number;
    };
    locale?: string;
    children?: unknown;
    inject?: unknown;
    store?: unknown;
};
type Slots = {
    entriesOfSlot(name: string): readonly Entry[];
    inject(name: string, callback: () => unknown): unknown;
    register(options: unknown, component: unknown): unknown;
};
type CreateElement = (type: any, props: any, ...children: any[]) => any;
/** Decorate the elected DSH 0.1.5 entry while preserving every non-component owner. */
export declare function installUsageSlots(slots: Slots, createElement: CreateElement): () => void;
export {};
