import { JsonStore } from "./json-store.js";
declare const VERSION = 1;
type Classification = "native" | "command-capable" | "emulated-search-only" | "unsupported" | "unknown";
type ActionState = "supported" | "unsupported" | "unknown";
type Provenance = "trusted-native" | "unavailable";
export interface AlphaCapabilityRecord {
    classification: Classification;
    actions: Record<string, ActionState>;
    probedAt: string;
    schemaFingerprint: string;
    probeVersion?: number;
    provenance?: Provenance;
}
interface CapabilityData {
    version: typeof VERSION;
    capabilities: Record<string, AlphaCapabilityRecord>;
}
export declare function alphaCapabilityFingerprint(config: Record<string, unknown>): string;
export declare function alphaCapabilityUsable(record: unknown): boolean;
export declare class AlphaCapabilityStore {
    readonly store: JsonStore<CapabilityData>;
    constructor(file: string);
    get(fingerprint: string): AlphaCapabilityRecord | undefined;
    put(fingerprint: unknown, record: unknown): void;
}
export {};
