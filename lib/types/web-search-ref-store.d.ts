import { JsonStore } from "./json-store.js";
declare const VERSION = 1;
interface RefRecord {
    refId: string;
    url?: string;
}
interface SessionRecord {
    routeFingerprint: string;
    updatedAt: string;
    refs: Record<string, RefRecord>;
}
interface RefStoreData {
    version: typeof VERSION;
    sessions: Record<string, SessionRecord>;
}
export declare class AlphaRefStore {
    readonly store: JsonStore<RefStoreData>;
    constructor(file: string);
    record(sessionId: unknown, routeFingerprint: unknown, refs: unknown): void;
    assertUsable(sessionId: unknown, routeFingerprint: unknown, refId: unknown): RefRecord;
}
export {};
