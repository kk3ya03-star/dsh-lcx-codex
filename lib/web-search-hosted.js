import { outputDomains, outputLineRange, parseWebRunOutput } from "./web-run-output.js";
export const HOSTED_SEARCH_PARAMETERS = { type: "object", properties: { query: { type: "string", description: "Advanced Responses Hosted Web Search query. Use DSH web_search for ordinary searches." }, searchContextSize: { type: "string", enum: ["low", "medium", "high"] }, allowedDomains: { type: "array", items: { type: "string" } }, blockedDomains: { type: "array", items: { type: "string" } }, userLocation: { type: "object", properties: { country: { type: "string" }, city: { type: "string" }, region: { type: "string" }, timezone: { type: "string" } }, additionalProperties: false }, externalWebAccess: { type: "boolean" }, returnTokenBudget: { type: "string", enum: ["default", "unlimited"] }, searchContentTypes: { type: "array", items: { type: "string", enum: ["text", "image"] } }, imageSettings: { type: "object", properties: { maxResults: { type: "integer" }, caption: { type: "boolean" } }, additionalProperties: false } }, required: ["query"], additionalProperties: false };
export const HOSTED_SEARCH_OUTPUT = { type: "object", properties: { mode: { type: "string", enum: ["hosted"] }, action: { type: "string" }, emulation: { type: "string", enum: ["native"] }, content: { type: "string" }, sources: { type: "array", items: { type: "object" } }, citations: { type: "array", items: { type: "object" } }, images: { type: "array", items: { type: "object" } }, warnings: { type: "array", items: { type: "string" } }, outputBlocks: { type: "array", items: { type: "object" } }, domains: { type: "array", items: { type: "string" } }, lineRange: { type: "object" }, requestId: { type: "string" }, responseId: { type: "string" }, retrievedAt: { type: "string" }, truncated: { type: "boolean" } }, required: ["mode", "action", "emulation", "content", "sources", "citations", "images", "warnings", "requestId", "retrievedAt", "truncated"], additionalProperties: false };
function failure(message, code = "WEB_INVALID_REQUEST") { return Object.assign(new Error(message), { code }); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isStringArray(value) { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function isInteger(value) { return typeof value === "number" && Number.isInteger(value); }
function httpUrl(value) { if (typeof value !== "string")
    return undefined; try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : undefined;
}
catch {
    return undefined;
} }
function normalizeDomains(value, field) {
    if (value === undefined)
        return undefined;
    if (!isStringArray(value) || value.length < 1 || value.length > 100)
        throw failure(`websearch_gpt_advanced.${field} must contain 1 to 100 domains`);
    const result = value.map((item) => {
        const domain = item.trim().toLowerCase();
        if (!domain || domain.length > 253 || domain.includes("/") || domain.includes(":") || domain.endsWith(".") || domain.split(".").length < 2)
            throw failure(`websearch_gpt_advanced.${field} contains an invalid domain`);
        return domain;
    });
    if (new Set(result).size !== result.length)
        throw failure(`websearch_gpt_advanced.${field} contains duplicates`);
    return result;
}
function normalizeLocation(value) {
    if (!isRecord(value))
        throw failure("websearch_gpt_advanced.userLocation must be an object");
    const result = {};
    if (value.country !== undefined) {
        if (typeof value.country !== "string" || !/^[a-z]{2}$/iu.test(value.country.trim()))
            throw failure("userLocation.country must be ISO alpha-2");
        result.country = value.country.trim().toUpperCase();
    }
    for (const field of ["city", "region"])
        if (value[field] !== undefined) {
            const text = value[field];
            if (typeof text !== "string" || !text.trim() || text.length > 200)
                throw failure(`userLocation.${field} is invalid`);
            result[field] = text.trim();
        }
    if (value.timezone !== undefined) {
        if (typeof value.timezone !== "string")
            throw failure("userLocation.timezone must be an IANA timezone");
        try {
            new Intl.DateTimeFormat("en-US", { timeZone: value.timezone }).format();
        }
        catch {
            throw failure("userLocation.timezone must be an IANA timezone");
        }
        result.timezone = value.timezone;
    }
    if (!Object.keys(result).length)
        throw failure("userLocation is empty");
    return result;
}
export function normalizeHostedSearchArgs(args) {
    if (!isRecord(args) || typeof args.query !== "string" || !args.query.trim())
        throw failure("websearch_gpt_advanced.query must be non-empty");
    const query = args.query.trim();
    if (query.length > 16_000)
        throw failure("query is too long");
    const result = { query };
    if (args.searchContextSize !== undefined) {
        if (!["low", "medium", "high"].includes(String(args.searchContextSize)))
            throw failure("searchContextSize is invalid");
        result.searchContextSize = args.searchContextSize;
    }
    const allowedDomains = normalizeDomains(args.allowedDomains, "allowedDomains");
    const blockedDomains = normalizeDomains(args.blockedDomains, "blockedDomains");
    if (allowedDomains)
        result.allowedDomains = allowedDomains;
    if (blockedDomains)
        result.blockedDomains = blockedDomains;
    if (allowedDomains && blockedDomains && allowedDomains.some((domain) => blockedDomains.includes(domain)))
        throw failure("domain filters conflict");
    if (args.userLocation !== undefined)
        result.userLocation = normalizeLocation(args.userLocation);
    if (args.externalWebAccess !== undefined) {
        if (typeof args.externalWebAccess !== "boolean")
            throw failure("externalWebAccess must be boolean");
        result.externalWebAccess = args.externalWebAccess;
    }
    if (args.returnTokenBudget !== undefined) {
        if (args.returnTokenBudget !== "default" && args.returnTokenBudget !== "unlimited")
            throw failure("returnTokenBudget is invalid");
        result.returnTokenBudget = args.returnTokenBudget;
    }
    if (args.searchContentTypes !== undefined) {
        if (!isStringArray(args.searchContentTypes) || !args.searchContentTypes.length || args.searchContentTypes.length > 2 || args.searchContentTypes.some((value) => value !== "text" && value !== "image"))
            throw failure("searchContentTypes is invalid");
        result.searchContentTypes = [...new Set(args.searchContentTypes)];
    }
    if (args.imageSettings !== undefined) {
        if (!result.searchContentTypes?.includes("image") || !isRecord(args.imageSettings))
            throw failure("imageSettings requires image search");
        const imageSettings = {};
        if (args.imageSettings.maxResults !== undefined) {
            const maxResults = args.imageSettings.maxResults;
            if (!isInteger(maxResults) || maxResults < 1 || maxResults > 100)
                throw failure("imageSettings.maxResults is invalid");
            imageSettings.maxResults = maxResults;
        }
        if (args.imageSettings.caption !== undefined) {
            if (typeof args.imageSettings.caption !== "boolean")
                throw failure("imageSettings.caption must be boolean");
            imageSettings.caption = args.imageSettings.caption;
        }
        result.imageSettings = imageSettings;
    }
    return result;
}
export function buildHostedSearchBody(args, model, options = {}) {
    const tool = { type: "web_search", ...(args.searchContextSize ? { search_context_size: args.searchContextSize } : {}), ...(args.allowedDomains || args.blockedDomains ? { filters: { ...(args.allowedDomains ? { allowed_domains: args.allowedDomains } : {}), ...(args.blockedDomains ? { blocked_domains: args.blockedDomains } : {}) } } : {}), ...(args.userLocation ? { user_location: { type: "approximate", ...args.userLocation } } : {}), ...(args.externalWebAccess !== undefined ? { external_web_access: args.externalWebAccess } : {}), ...(args.returnTokenBudget ? { return_token_budget: args.returnTokenBudget } : {}), ...(args.searchContentTypes ? { search_content_types: args.searchContentTypes } : {}), ...(args.imageSettings ? { image_settings: { ...(args.imageSettings.maxResults !== undefined ? { max_results: args.imageSettings.maxResults } : {}), ...(args.imageSettings.caption !== undefined ? { caption: args.imageSettings.caption } : {}) } } : {}) };
    return { model, input: [{ role: "user", content: [{ type: "input_text", text: args.query }] }], tools: [tool], tool_choice: "required", include: ["web_search_call.action.sources", ...(args.searchContentTypes?.includes("image") ? ["web_search_call.results"] : [])], stream: false, store: false, ...(options.promptCacheKey ? { prompt_cache_key: options.promptCacheKey } : {}) };
}
function textFrom(value, seen = new Set()) {
    if (typeof value === "string")
        return value;
    if (!value || typeof value !== "object" || seen.has(value))
        return "";
    seen.add(value);
    if (Array.isArray(value))
        return value.map((item) => textFrom(item, seen)).filter(Boolean).join("\n");
    if (!isRecord(value))
        return "";
    if (typeof value.text === "string" && ["output_text", "text", "input_text"].includes(value.type))
        return value.text;
    return Array.isArray(value.content) ? textFrom(value.content, seen) : "";
}
function sourceFrom(value) { if (!isRecord(value))
    return undefined; const url = httpUrl(value.url); if (!url)
    return undefined; return { url: url.toString(), ...(typeof value.title === "string" && value.title ? { title: value.title } : {}), ...(typeof value.snippet === "string" && value.snippet ? { snippet: value.snippet } : {}), ...(typeof value.publishedAt === "string" ? { publishedAt: value.publishedAt } : typeof value.published_at === "string" ? { publishedAt: value.published_at } : {}), ...(typeof value.ref_id === "string" ? { refId: value.ref_id } : {}) }; }
function imageFrom(value) { if (!isRecord(value) || value.type !== "image_result")
    return undefined; const imageUrl = httpUrl(value.image_url); if (!imageUrl)
    return undefined; const thumbnailUrl = httpUrl(value.thumbnail_url); const sourceWebsiteUrl = httpUrl(value.source_website_url); return { imageUrl: imageUrl.toString(), ...(thumbnailUrl ? { thumbnailUrl: thumbnailUrl.toString() } : {}), ...(sourceWebsiteUrl ? { sourceWebsiteUrl: sourceWebsiteUrl.toString() } : {}), ...(typeof value.caption === "string" ? { caption: value.caption } : {}) }; }
function responseArtifacts(response) { const sources = []; const citations = []; const images = []; const actions = []; if (!isRecord(response) || !Array.isArray(response.output))
    return { sources, citations, images, actions }; for (const item of response.output) {
    if (!isRecord(item))
        continue;
    if (item.type === "web_search_call") {
        const action = isRecord(item.action) && typeof item.action.type === "string" ? item.action.type : "search";
        actions.push(action);
        if (isRecord(item.action) && Array.isArray(item.action.sources))
            for (const value of item.action.sources) {
                const source = sourceFrom(value);
                if (source)
                    sources.push(source);
            }
        if (Array.isArray(item.results))
            for (const value of item.results) {
                const image = imageFrom(value);
                if (image)
                    images.push(image);
            }
    }
    if (item.type === "message" && Array.isArray(item.content))
        for (const part of item.content)
            if (isRecord(part) && part.type === "output_text" && Array.isArray(part.annotations))
                for (const annotation of part.annotations)
                    if (isRecord(annotation) && annotation.type === "url_citation") {
                        const source = sourceFrom(annotation);
                        if (source) {
                            citations.push(source);
                            sources.push(source);
                        }
                    }
} return { sources, citations, images, actions }; }
function canonicalUrl(value) { const url = httpUrl(value); if (!url)
    return undefined; url.hash = ""; for (const key of [...url.searchParams.keys()])
    if (/^(utm_|gclid$|fbclid$)/iu.test(key))
        url.searchParams.delete(key); return url.toString(); }
function uniqueByUrl(values) { const result = []; const seen = new Set(); for (const value of values) {
    const key = canonicalUrl(value.url);
    if (!key || seen.has(key))
        continue;
    seen.add(key);
    result.push(value);
} return result; }
export function parseHostedSearchResponse(response, requestId, maxResults = 8, retrievedAt = new Date().toISOString()) {
    if (!isRecord(response))
        throw failure("Hosted Web Search returned an invalid response", "WEB_RESPONSE_INCOMPLETE");
    if (isRecord(response.error))
        throw failure(typeof response.error.message === "string" ? response.error.message : "Hosted Web Search failed", "LCX_WEB_PROVIDER_ERROR");
    if (response.status !== "completed")
        throw failure(`Hosted Web Search status: ${String(response.status ?? "missing")}`, "WEB_RESPONSE_INCOMPLETE");
    if (Array.isArray(response.output) && response.output.some(item => isRecord(item) && item.type === "web_search_call" && item.status !== undefined && item.status !== "completed"))
        throw failure("Hosted Web Search did not complete its search action", "LCX_WEB_PROVIDER_ERROR");
    const output = typeof response.output_text === "string" ? response.output_text : textFrom(response.output ?? response.content);
    const outputBlocks = parseWebRunOutput(output);
    const artifacts = responseArtifacts(response);
    if (!artifacts.actions.length)
        throw failure("Hosted Web Search completed without web_search", "WEB_SEARCH_NOT_EXECUTED");
    const sources = uniqueByUrl([...artifacts.sources, ...outputBlocks.flatMap((block) => block.url ? [{ url: block.url, ...(block.title ? { title: block.title } : {}) }] : [])]);
    const citations = uniqueByUrl(artifacts.citations);
    const limited = sources.slice(0, Math.max(1, maxResults));
    const images = artifacts.images.slice(0, Math.max(1, maxResults));
    if (!output && !limited.length && !images.length)
        throw failure("Hosted Web Search returned no output", "WEB_NO_SOURCES");
    return { mode: "hosted", action: artifacts.actions[0], emulation: "native", content: output, sources: limited, citations, images, warnings: artifacts.actions.length > 1 ? [`Multiple hosted search actions were returned: ${artifacts.actions.join(", ")}`] : [], outputBlocks, domains: outputDomains(outputBlocks), ...(outputLineRange(outputBlocks) ? { lineRange: outputLineRange(outputBlocks) } : {}), requestId, ...(typeof response.id === "string" ? { responseId: response.id } : {}), retrievedAt, truncated: sources.length > limited.length || artifacts.images.length > images.length };
}
export function renderHostedSearchResult(value) { const data = isRecord(value) ? value : {}; const parts = []; if (typeof data.content === "string" && data.content)
    parts.push(data.content); if (Array.isArray(data.sources) && data.sources.length)
    parts.push(`来源：\n${data.sources.filter(isRecord).map((source) => `- [${String(source.title ?? source.url ?? "")}](${String(source.url ?? "")})${source.snippet ? ` — ${String(source.snippet)}` : ""}`).join("\n")}`); if (Array.isArray(data.images) && data.images.length)
    parts.push(`图片：\n${data.images.filter(isRecord).map((image) => `- [${String(image.caption ?? image.imageUrl ?? "")}](${String(image.imageUrl ?? "")})`).join("\n")}`); if (Array.isArray(data.warnings) && data.warnings.length)
    parts.push(data.warnings.map((warning) => `警告：${String(warning)}`).join("\n")); parts.push(`检索时间：${String(data.retrievedAt ?? "")}`); return [{ type: "text", text: parts.filter(Boolean).join("\n\n") }]; }
