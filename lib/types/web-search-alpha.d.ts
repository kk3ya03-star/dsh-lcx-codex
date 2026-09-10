import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { type WebRunLink } from "./web-run-output.js";
export declare const ALPHA_ACTIONS: string[];
export declare const ALPHA_SEARCH_PARAMETERS: {
    type: "object";
    properties: {
        action: {
            type: "string";
            enum: string[];
        };
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
    };
    required: string[];
    additionalProperties: false;
};
export declare const ALPHA_SEARCH_OUTPUT: {
    type: "object";
    properties: {
        mode: {
            type: "string";
        };
        action: {
            type: "string";
        };
        capability: {
            type: "string";
        };
        emulation: {
            type: "string";
        };
        content: {
            type: "string";
        };
        results: {
            type: "array";
            items: {
                type: "object";
            };
        };
        refs: {
            type: "array";
            items: {
                type: "string";
            };
        };
        sources: {
            type: "array";
            items: {
                type: "object";
            };
        };
        citations: {
            type: "array";
            items: {
                type: "object";
            };
        };
        outputBlocks: {
            type: "array";
            items: {
                type: "object";
            };
        };
        links: {
            type: "array";
            items: {
                type: "object";
            };
        };
        pdfRefs: {
            type: "array";
            items: {
                type: "string";
            };
        };
        domains: {
            type: "array";
            items: {
                type: "string";
            };
        };
        lineRange: {
            type: "object";
        };
        requestId: {
            type: "string";
        };
        responseId: {
            type: "string";
        };
        retrievedAt: {
            type: "string";
        };
        warnings: {
            type: "array";
            items: {
                type: "string";
            };
        };
    };
    required: string[];
    additionalProperties: false;
};
export declare const ALPHA_SCHEMA_FINGERPRINT: string;
export declare const ALPHA_PROBE_VERSION = 12;
type RecordValue = Record<string, unknown>;
type AlphaAction = (typeof ALPHA_ACTIONS)[number];
type NormalizedAlphaArgs = RecordValue & {
    action: AlphaAction;
};
type AlphaResponse = {
    output: string;
    results?: unknown[];
    id?: unknown;
};
type AlphaProbeValue = RecordValue & {
    content?: unknown;
    results?: unknown;
    refs?: unknown;
    links?: unknown;
    pdfRefs?: unknown;
    outputBlocks?: unknown;
    sources?: unknown;
};
type AlphaInvoke = (args: RecordValue) => Promise<AlphaProbeValue>;
export declare function normalizeAlphaSearchArgs(args: unknown): NormalizedAlphaArgs;
export declare function alphaActionCommand(args: NormalizedAlphaArgs): Record<string, unknown>;
export declare function buildAlphaSearchBody(args: NormalizedAlphaArgs, model: unknown, sessionId: string, externalWebAccess?: boolean, maxOutputTokens?: number): {
    id: string;
    model: unknown;
    input: {
        role: string;
        content: {
            type: string;
            text: string;
        }[];
    }[];
    commands: Record<string, unknown>;
    settings: {
        allowed_callers: string[];
        external_web_access: boolean;
    };
    max_output_tokens: number;
};
export declare function isPublicAlphaTarget(url: URL): boolean;
export declare function isAlphaHttpUrl(value: unknown): value is string;
export declare function isAlphaContinuationUrl(value: unknown): value is string;
export declare function alphaRefRequiresStore(action: string, refId: unknown): boolean;
interface AlphaRefProvenance {
    action: string;
    originKind: "response" | "request";
    originFingerprint: string;
    artifactFingerprint?: string;
}
interface AlphaRefObservation {
    refId: string;
    url?: string;
    provenance: AlphaRefProvenance;
}
export declare function parseAlphaSearchResponse(response: AlphaResponse, options: {
    action: unknown;
    capability: unknown;
    requestId: unknown;
    retrievedAt?: unknown;
}): {
    mode: string;
    action: unknown;
    capability: unknown;
    emulation: string;
    content: string;
    results: unknown;
    refs: string[];
    sources: {
        refId?: string;
        snippet?: string;
        title?: string;
        url: string;
    }[];
    citations: {
        refId?: string;
        snippet?: string;
        title?: string;
        url: string;
    }[];
    outputBlocks: import("./web-run-output.js").WebRunBlock[];
    links: WebRunLink[];
    pdfRefs: string[];
    domains: string[];
    lineRange?: {
        first: number;
        last: number;
    } | undefined;
    requestId: unknown;
    responseId?: string | undefined;
    retrievedAt: {};
    warnings: string[];
    refRecords: AlphaRefObservation[];
};
export declare function renderAlphaSearchResult(value: unknown): ContentBlock[];
export declare const ALPHA_STATEFUL_RETRY_MAX_ATTEMPTS = 1;
export declare function alphaSearchRetryOptions(maxResponseBytes?: number): {
    maxAttempts: number;
    maxResponseBytes?: number | undefined;
};
export declare function runWithAlphaSessionLock<T>(sessionId: unknown, signal: AbortSignal | undefined, task: () => T | Promise<T>): Promise<T>;
export declare function fetchAlphaSearchJson(options: {
    url: string;
    body: Record<string, unknown>;
    headers?: HeadersInit;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxResponseBytes?: number;
    sessionId: unknown;
}): Promise<any>;
export declare function probeAlphaCapabilities({ invoke, schemaFingerprint, trustedNativeProvenance, actionProbes, clickProbeRef, screenshotProbeRef, }: {
    invoke: AlphaInvoke;
    schemaFingerprint: unknown;
    trustedNativeProvenance?: boolean;
    actionProbes?: Record<string, RecordValue>;
    clickProbeRef?: unknown;
    screenshotProbeRef?: unknown;
}): Promise<{
    classification: string;
    actions: {
        [k: string]: string;
    };
    probedAt: string;
    schemaFingerprint: unknown;
    probeVersion: number;
    provenance: string;
}>;
export {};
