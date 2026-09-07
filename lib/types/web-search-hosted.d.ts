import type { ContentBlock } from "@deepseek-ai/dsh-llm";
type SearchContextSize = "low" | "medium" | "high";
type ReturnTokenBudget = "default" | "unlimited";
type SearchContentType = "text" | "image";
interface UserLocation {
    country?: string;
    city?: string;
    region?: string;
    timezone?: string;
}
interface ImageSettings {
    maxResults?: number;
    caption?: boolean;
}
interface HostedSearchArgs {
    query: string;
    searchContextSize?: SearchContextSize;
    allowedDomains?: string[];
    blockedDomains?: string[];
    userLocation?: UserLocation;
    externalWebAccess?: boolean;
    returnTokenBudget?: ReturnTokenBudget;
    searchContentTypes?: SearchContentType[];
    imageSettings?: ImageSettings;
}
interface Source {
    url: string;
    title?: string;
    snippet?: string;
    publishedAt?: string;
    refId?: string;
}
interface ImageResult {
    imageUrl: string;
    thumbnailUrl?: string;
    sourceWebsiteUrl?: string;
    caption?: string;
}
export declare const HOSTED_SEARCH_PARAMETERS: {
    type: "object";
    properties: {
        query: {
            type: "string";
            description: string;
        };
        searchContextSize: {
            type: "string";
            enum: string[];
        };
        allowedDomains: {
            type: "array";
            items: {
                type: "string";
            };
        };
        blockedDomains: {
            type: "array";
            items: {
                type: "string";
            };
        };
        userLocation: {
            type: "object";
            properties: {
                country: {
                    type: "string";
                };
                city: {
                    type: "string";
                };
                region: {
                    type: "string";
                };
                timezone: {
                    type: "string";
                };
            };
            additionalProperties: false;
        };
        externalWebAccess: {
            type: "boolean";
        };
        returnTokenBudget: {
            type: "string";
            enum: string[];
        };
        searchContentTypes: {
            type: "array";
            items: {
                type: "string";
                enum: string[];
            };
        };
        imageSettings: {
            type: "object";
            properties: {
                maxResults: {
                    type: "integer";
                };
                caption: {
                    type: "boolean";
                };
            };
            additionalProperties: false;
        };
    };
    required: string[];
    additionalProperties: false;
};
export declare const HOSTED_SEARCH_OUTPUT: {
    type: "object";
    properties: {
        mode: {
            type: "string";
            enum: string[];
        };
        action: {
            type: "string";
        };
        emulation: {
            type: "string";
            enum: string[];
        };
        content: {
            type: "string";
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
        images: {
            type: "array";
            items: {
                type: "object";
            };
        };
        warnings: {
            type: "array";
            items: {
                type: "string";
            };
        };
        outputBlocks: {
            type: "array";
            items: {
                type: "object";
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
        truncated: {
            type: "boolean";
        };
    };
    required: string[];
    additionalProperties: false;
};
export declare function normalizeHostedSearchArgs(args: unknown): HostedSearchArgs;
export declare function buildHostedSearchBody(args: HostedSearchArgs, model: unknown, options?: {
    promptCacheKey?: string;
}): {
    model: unknown;
    input: {
        role: string;
        content: {
            type: string;
            text: string;
        }[];
    }[];
    tools: {
        type: string;
        search_context_size?: SearchContextSize | undefined;
        filters?: {
            allowed_domains?: string[] | undefined;
            blocked_domains?: string[] | undefined;
        } | undefined;
        user_location?: {
            country?: string;
            city?: string;
            region?: string;
            timezone?: string;
            type: string;
        } | undefined;
        external_web_access?: boolean | undefined;
        return_token_budget?: ReturnTokenBudget | undefined;
        search_content_types?: SearchContentType[] | undefined;
        image_settings?: {
            max_results?: number | undefined;
            caption?: boolean | undefined;
        } | undefined;
    }[];
    tool_choice: string;
    include: string[];
    stream: boolean;
    store: boolean;
    prompt_cache_key?: string | undefined;
};
export declare function parseHostedSearchResponse(response: unknown, requestId: string, maxResults?: number, retrievedAt?: string): {
    mode: string;
    action: string;
    emulation: string;
    content: string;
    sources: {
        url: string;
        title?: string | undefined;
    }[];
    citations: Source[];
    images: ImageResult[];
    warnings: string[];
    outputBlocks: import("./web-run-output.js").WebRunBlock[];
    domains: string[];
    lineRange?: {
        first: number;
        last: number;
    } | undefined;
    requestId: string;
    responseId?: string | undefined;
    retrievedAt: string;
    truncated: boolean;
};
export declare function renderHostedSearchResult(value: unknown): ContentBlock[];
export {};
