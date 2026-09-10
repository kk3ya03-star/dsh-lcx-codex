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
export declare function alphaActionState(record: unknown, action: unknown): ActionState | undefined;
export declare function assertAlphaActionAllowed(record: unknown, action: unknown): void;
export declare function alphaAdvertisedActions(record: unknown): string[];
export declare function alphaSearchParametersFor(record: unknown): {
    type: "object";
    required: string[];
    additionalProperties: false;
    properties: {
        query: {
            type: "string";
        };
        domains: {
            type: "array";
            items: {
                type: "string";
            };
        };
        recency: {
            type: "integer";
        };
        refId: {
            type: "string";
        };
        lineNumber: {
            type: "integer";
        };
        linkId: {
            type: "integer";
        };
        pattern: {
            type: "string";
        };
        pageNumber: {
            type: "integer";
        };
        ticker: {
            type: "string";
        };
        assetType: {
            type: "string";
            enum: string[];
        };
        market: {
            type: "string";
        };
        location: {
            type: "string";
        };
        start: {
            type: "string";
        };
        duration: {
            type: "integer";
        };
        fn: {
            type: "string";
            enum: string[];
        };
        league: {
            type: "string";
            enum: string[];
        };
        team: {
            type: "string";
        };
        opponent: {
            type: "string";
        };
        dateFrom: {
            type: "string";
        };
        dateTo: {
            type: "string";
        };
        numberOfGames: {
            type: "integer";
        };
        locale: {
            type: "string";
        };
        utcOffset: {
            type: "string";
        };
        responseLength: {
            type: "string";
            enum: string[];
        };
        action: {
            type: "string";
            enum: string[];
        };
    };
};
export declare class AlphaCapabilityStore {
    readonly store: JsonStore<CapabilityData>;
    constructor(file: string);
    get(fingerprint: string): AlphaCapabilityRecord | undefined;
    put(fingerprint: unknown, record: unknown): void;
}
export {};
