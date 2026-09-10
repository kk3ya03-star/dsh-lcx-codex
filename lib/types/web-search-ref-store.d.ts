import { JsonStore } from "./json-store.js";
declare const VERSION = 2;
export interface AlphaRefProvenance {
    action: string;
    originKind: "response" | "request" | "legacy-unattributed";
    originFingerprint: string;
    artifactFingerprint?: string;
}
export interface AlphaRefRecord {
    refId: string;
    url?: string;
    provenance: AlphaRefProvenance;
}
interface SessionRecord {
    routeFingerprint: string;
    updatedAt: string;
    refs: Record<string, AlphaRefRecord>;
}
interface RefStoreData {
    version: typeof VERSION;
    sessions: Record<string, SessionRecord>;
}
export declare class AlphaRefStore {
    readonly store: JsonStore<RefStoreData>;
    constructor(file: string);
    record(sessionId: unknown, routeFingerprint: unknown, refs: unknown): void;
    assertUsable(sessionId: unknown, routeFingerprint: unknown, refId: unknown): AlphaRefRecord;
}
export {};
