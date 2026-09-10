import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { JsonSchemaNode, ToolOutputDefinition } from "@deepseek-ai/dsh-tools";
import { outputDomains, outputLineRange, parseWebRunOutput } from "./web-run-output.js";

type RecordValue = Record<string, unknown>;
type PresentationValue = ReturnType<NonNullable<ToolOutputDefinition["presentationMeta"]>>;
type SearchContextSize = "low" | "medium" | "high";
type ReturnTokenBudget = "default" | "unlimited";
type SearchContentType = "text" | "image";
interface UserLocation { country?: string; city?: string; region?: string; timezone?: string }
interface ImageSettings { maxResults?: number; caption?: boolean }
interface HostedSearchArgs { query: string; searchContextSize?: SearchContextSize; allowedDomains?: string[]; blockedDomains?: string[]; userLocation?: UserLocation; externalWebAccess?: boolean; returnTokenBudget?: ReturnTokenBudget; searchContentTypes?: SearchContentType[]; imageSettings?: ImageSettings }
interface Source { url: string; title?: string; snippet?: string; publishedAt?: string; refId?: string }
interface ImageResult { imageUrl: string; thumbnailUrl?: string; sourceWebsiteUrl?: string; caption?: string }
export type HostedMediaCandidate = {
  kind: "image";
  url: string;
  previewUrl?: string;
  sourceUrl?: string;
  caption?: string;
  structured: true;
}

export const HOSTED_SEARCH_PARAMETERS = { type: "object", properties: { query: { type: "string", description: "Advanced Responses Hosted Web Search query. Use DSH web_search for ordinary searches." }, searchContextSize: { type: "string", enum: ["low", "medium", "high"] }, allowedDomains: { type: "array", items: { type: "string" } }, blockedDomains: { type: "array", items: { type: "string" } }, userLocation: { type: "object", properties: { country: { type: "string" }, city: { type: "string" }, region: { type: "string" }, timezone: { type: "string" } }, additionalProperties: false }, externalWebAccess: { type: "boolean" }, returnTokenBudget: { type: "string", enum: ["default", "unlimited"] }, searchContentTypes: { type: "array", items: { type: "string", enum: ["text", "image"] } }, imageSettings: { type: "object", properties: { maxResults: { type: "integer" }, caption: { type: "boolean" } }, additionalProperties: false } }, required: ["query"], additionalProperties: false } satisfies JsonSchemaNode;
export const HOSTED_SEARCH_OUTPUT = { type: "object", properties: { mode: { type: "string", enum: ["hosted"] }, action: { type: "string" }, emulation: { type: "string", enum: ["native"] }, content: { type: "string" }, sources: { type: "array", items: { type: "object" } }, citations: { type: "array", items: { type: "object" } }, images: { type: "array", items: { type: "object" } }, warnings: { type: "array", items: { type: "string" } }, outputBlocks: { type: "array", items: { type: "object" } }, domains: { type: "array", items: { type: "string" } }, lineRange: { type: "object" }, requestId: { type: "string" }, responseId: { type: "string" }, retrievedAt: { type: "string" }, truncated: { type: "boolean" }, usage: { type: "object", properties: { inputTokens: { type: "number" }, outputTokens: { type: "number" }, totalTokens: { type: "number" }, cachedInputTokens: { type: "number" }, actionCount: { type: "number" }, serverWebSearchCalls: { type: "number" } }, additionalProperties: false } }, required: ["mode", "action", "emulation", "content", "sources", "citations", "images", "warnings", "requestId", "retrievedAt", "truncated"], additionalProperties: false } satisfies JsonSchemaNode;

function failure(message: string | undefined, code = "WEB_INVALID_REQUEST"): Error & { code: string } { return Object.assign(new Error(message), { code }); }
function isRecord(value: unknown): value is RecordValue { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item): item is string => typeof item === "string"); }
function isInteger(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value); }
function httpUrl(value: unknown): URL | undefined { if (typeof value !== "string") return undefined; try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url : undefined; } catch { return undefined; } }

function normalizeDomains(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!isStringArray(value) || value.length < 1 || value.length > 100) throw failure(`websearch_gpt_advanced.${field} must contain 1 to 100 domains`);
  const result = value.map((item) => {
    const domain = item.trim().toLowerCase();
    if (!domain || domain.length > 253 || domain.includes("/") || domain.includes(":") || domain.endsWith(".") || domain.split(".").length < 2) throw failure(`websearch_gpt_advanced.${field} contains an invalid domain`);
    return domain;
  });
  if (new Set(result).size !== result.length) throw failure(`websearch_gpt_advanced.${field} contains duplicates`);
  return result;
}

function normalizeLocation(value: unknown): UserLocation {
  if (!isRecord(value)) throw failure("websearch_gpt_advanced.userLocation must be an object");
  const result: UserLocation = {};
  if (value.country !== undefined) {
    if (typeof value.country !== "string" || !/^[a-z]{2}$/iu.test(value.country.trim())) throw failure("userLocation.country must be ISO alpha-2");
    result.country = value.country.trim().toUpperCase();
  }
  for (const field of ["city", "region"] as const) if (value[field] !== undefined) {
    const text = value[field];
    if (typeof text !== "string" || !text.trim() || text.length > 200) throw failure(`userLocation.${field} is invalid`);
    result[field] = text.trim();
  }
  if (value.timezone !== undefined) {
    if (typeof value.timezone !== "string") throw failure("userLocation.timezone must be an IANA timezone");
    try { new Intl.DateTimeFormat("en-US", { timeZone: value.timezone }).format(); } catch { throw failure("userLocation.timezone must be an IANA timezone"); }
    result.timezone = value.timezone;
  }
  if (!Object.keys(result).length) throw failure("userLocation is empty");
  return result;
}

export function normalizeHostedSearchArgs(args: unknown): HostedSearchArgs {
  if (!isRecord(args) || typeof args.query !== "string" || !args.query.trim()) throw failure("websearch_gpt_advanced.query must be non-empty");
  const query = args.query.trim(); if (query.length > 16_000) throw failure("query is too long");
  const result: HostedSearchArgs = { query };
  if (args.searchContextSize !== undefined) { if (!["low", "medium", "high"].includes(String(args.searchContextSize))) throw failure("searchContextSize is invalid"); result.searchContextSize = args.searchContextSize as SearchContextSize; }
  const allowedDomains = normalizeDomains(args.allowedDomains, "allowedDomains"); const blockedDomains = normalizeDomains(args.blockedDomains, "blockedDomains");
  if (allowedDomains) result.allowedDomains = allowedDomains; if (blockedDomains) result.blockedDomains = blockedDomains;
  if (allowedDomains && blockedDomains && allowedDomains.some((domain) => blockedDomains.includes(domain))) throw failure("domain filters conflict");
  if (args.userLocation !== undefined) result.userLocation = normalizeLocation(args.userLocation);
  if (args.externalWebAccess !== undefined) { if (typeof args.externalWebAccess !== "boolean") throw failure("externalWebAccess must be boolean"); result.externalWebAccess = args.externalWebAccess; }
  if (args.returnTokenBudget !== undefined) { if (args.returnTokenBudget !== "default" && args.returnTokenBudget !== "unlimited") throw failure("returnTokenBudget is invalid"); result.returnTokenBudget = args.returnTokenBudget; }
  if (args.searchContentTypes !== undefined) { if (!isStringArray(args.searchContentTypes) || !args.searchContentTypes.length || args.searchContentTypes.length > 2 || args.searchContentTypes.some((value) => value !== "text" && value !== "image")) throw failure("searchContentTypes is invalid"); result.searchContentTypes = [...new Set(args.searchContentTypes)] as SearchContentType[]; }
  if (args.imageSettings !== undefined) {
    if (!result.searchContentTypes?.includes("image") || !isRecord(args.imageSettings)) throw failure("imageSettings requires image search");
    const imageSettings: ImageSettings = {};
    if (args.imageSettings.maxResults !== undefined) { const maxResults = args.imageSettings.maxResults; if (!isInteger(maxResults) || maxResults < 1 || maxResults > 100) throw failure("imageSettings.maxResults is invalid"); imageSettings.maxResults = maxResults; }
    if (args.imageSettings.caption !== undefined) { if (typeof args.imageSettings.caption !== "boolean") throw failure("imageSettings.caption must be boolean"); imageSettings.caption = args.imageSettings.caption; }
    result.imageSettings = imageSettings;
  }
  return result;
}

export function buildHostedSearchBody(args: HostedSearchArgs, model: unknown, options: { promptCacheKey?: string } = {}) {
  const tool = { type: "web_search", ...(args.searchContextSize ? { search_context_size: args.searchContextSize } : {}), ...(args.allowedDomains || args.blockedDomains ? { filters: { ...(args.allowedDomains ? { allowed_domains: args.allowedDomains } : {}), ...(args.blockedDomains ? { blocked_domains: args.blockedDomains } : {}) } } : {}), ...(args.userLocation ? { user_location: { type: "approximate", ...args.userLocation } } : {}), ...(args.externalWebAccess !== undefined ? { external_web_access: args.externalWebAccess } : {}), ...(args.returnTokenBudget ? { return_token_budget: args.returnTokenBudget } : {}), ...(args.searchContentTypes ? { search_content_types: args.searchContentTypes } : {}), ...(args.imageSettings ? { image_settings: { ...(args.imageSettings.maxResults !== undefined ? { max_results: args.imageSettings.maxResults } : {}), ...(args.imageSettings.caption !== undefined ? { caption: args.imageSettings.caption } : {}) } } : {}) };
  return { model, input: [{ role: "user", content: [{ type: "input_text", text: args.query }] }], tools: [tool], tool_choice: "required", include: ["web_search_call.action.sources", ...(args.searchContentTypes?.includes("image") ? ["web_search_call.results"] : [])], stream: false, store: false, ...(options.promptCacheKey ? { prompt_cache_key: options.promptCacheKey } : {}) };
}

function textFrom(value: unknown, seen = new Set<object>()): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => textFrom(item, seen)).filter(Boolean).join("\n");
  if (!isRecord(value)) return "";
  if (typeof value.text === "string" && ["output_text", "text", "input_text"].includes(value.type as string)) return value.text;
  return Array.isArray(value.content) ? textFrom(value.content, seen) : "";
}
function sourceFrom(value: unknown): Source | undefined { if (!isRecord(value)) return undefined; const url = httpUrl(value.url); if (!url) return undefined; return { url: url.toString(), ...(typeof value.title === "string" && value.title ? { title: value.title } : {}), ...(typeof value.snippet === "string" && value.snippet ? { snippet: value.snippet } : {}), ...(typeof value.publishedAt === "string" ? { publishedAt: value.publishedAt } : typeof value.published_at === "string" ? { publishedAt: value.published_at } : {}), ...(typeof value.ref_id === "string" ? { refId: value.ref_id } : {}) }; }
function imageFrom(value: unknown): ImageResult | undefined { if (!isRecord(value) || value.type !== "image_result") return undefined; const imageUrl = httpUrl(value.image_url); if (!imageUrl) return undefined; const thumbnailUrl = httpUrl(value.thumbnail_url); const sourceWebsiteUrl = httpUrl(value.source_website_url); return { imageUrl: imageUrl.toString(), ...(thumbnailUrl ? { thumbnailUrl: thumbnailUrl.toString() } : {}), ...(sourceWebsiteUrl ? { sourceWebsiteUrl: sourceWebsiteUrl.toString() } : {}), ...(typeof value.caption === "string" ? { caption: value.caption } : {}) }; }
function responseArtifacts(response: unknown): { sources: Source[]; citations: Source[]; images: ImageResult[]; actions: string[] } { const sources: Source[] = []; const citations: Source[] = []; const images: ImageResult[] = []; const actions: string[] = []; if (!isRecord(response) || !Array.isArray(response.output)) return { sources, citations, images, actions }; for (const item of response.output) { if (!isRecord(item)) continue; if (item.type === "web_search_call") { const action = isRecord(item.action) && typeof item.action.type === "string" ? item.action.type : "search"; actions.push(action); if (isRecord(item.action) && Array.isArray(item.action.sources)) for (const value of item.action.sources) { const source = sourceFrom(value); if (source) sources.push(source); } if (Array.isArray(item.results)) for (const value of item.results) { const image = imageFrom(value); if (image) images.push(image); } } if (item.type === "message" && Array.isArray(item.content)) for (const part of item.content) if (isRecord(part) && part.type === "output_text" && Array.isArray(part.annotations)) for (const annotation of part.annotations) if (isRecord(annotation) && annotation.type === "url_citation") { const source = sourceFrom(annotation); if (source) { citations.push(source); sources.push(source); } } } return { sources, citations, images, actions }; }
function canonicalUrl(value: unknown): string | undefined { const url = httpUrl(value); if (!url) return undefined; url.hash = ""; for (const key of [...url.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$)/iu.test(key)) url.searchParams.delete(key); return url.toString(); }
function uniqueByUrl<T extends { url: string }>(values: T[]): T[] { const result: T[] = []; const seen = new Set<string>(); for (const value of values) { const key = canonicalUrl(value.url); if (!key || seen.has(key)) continue; seen.add(key); result.push(value); } return result; }
function nonNegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function hostedUsageFrom(response: unknown, actionCount: number) {
  const usage = isRecord(response) && isRecord(response.usage) ? response.usage : undefined;
  const inputDetails = usage && isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : usage && isRecord(usage.prompt_tokens_details)
      ? usage.prompt_tokens_details
      : undefined;
  const serverDetails = usage && isRecord(usage.server_side_tool_usage_details)
    ? usage.server_side_tool_usage_details
    : undefined;
  const result: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    actionCount?: number;
    serverWebSearchCalls?: number;
  } = {};
  const inputTokens = usage ? nonNegativeInt(usage.input_tokens ?? usage.prompt_tokens) : undefined;
  const outputTokens = usage ? nonNegativeInt(usage.output_tokens ?? usage.completion_tokens) : undefined;
  const totalTokens = usage ? nonNegativeInt(usage.total_tokens) : undefined;
  const cachedInputTokens = inputDetails ? nonNegativeInt(inputDetails.cached_tokens) : undefined;
  const serverWebSearchCalls = serverDetails ? nonNegativeInt(serverDetails.web_search_calls) : undefined;
  if (inputTokens !== undefined) result.inputTokens = inputTokens;
  if (outputTokens !== undefined) result.outputTokens = outputTokens;
  if (totalTokens !== undefined) result.totalTokens = totalTokens;
  // cachedInputTokens is a subset of inputTokens (cache hits), not an extra addend.
  if (cachedInputTokens !== undefined) result.cachedInputTokens = cachedInputTokens;
  if (actionCount > 0) result.actionCount = actionCount;
  if (serverWebSearchCalls !== undefined) result.serverWebSearchCalls = serverWebSearchCalls;
  return Object.keys(result).length ? result : undefined;
}
function sourceLine(source: RecordValue): string {
  return `- [${String(source.title ?? source.url ?? "")}](${String(source.url ?? "")})${source.snippet ? ` — ${String(source.snippet)}` : ""}`;
}
function usageLine(usage: RecordValue): string {
  const parts: string[] = [];
  if (usage.inputTokens !== undefined) parts.push(`input=${String(usage.inputTokens)}`);
  if (usage.outputTokens !== undefined) parts.push(`output=${String(usage.outputTokens)}`);
  if (usage.totalTokens !== undefined) parts.push(`total=${String(usage.totalTokens)}`);
  if (usage.cachedInputTokens !== undefined) parts.push(`cachedInput=${String(usage.cachedInputTokens)}`);
  if (usage.actionCount !== undefined) parts.push(`actionCount=${String(usage.actionCount)}`);
  if (usage.serverWebSearchCalls !== undefined) parts.push(`serverWebSearchCalls=${String(usage.serverWebSearchCalls)}`);
  return parts.length ? `用量：${parts.join(" ")}` : "";
}

export function parseHostedSearchResponse(response: unknown, requestId: string, maxResults = 8, retrievedAt = new Date().toISOString()) {
  if (!isRecord(response)) throw failure("Hosted Web Search returned an invalid response", "WEB_RESPONSE_INCOMPLETE");
  if (isRecord(response.error)) throw failure(typeof response.error.message === "string" ? response.error.message : "Hosted Web Search failed", "LCX_WEB_PROVIDER_ERROR");
  if (response.status !== "completed") throw failure(`Hosted Web Search status: ${String(response.status ?? "missing")}`, "WEB_RESPONSE_INCOMPLETE");
  if (Array.isArray(response.output) && response.output.some(item => isRecord(item) && item.type === "web_search_call" && item.status !== undefined && item.status !== "completed"))
    throw failure("Hosted Web Search did not complete its search action", "LCX_WEB_PROVIDER_ERROR");
  const output = typeof response.output_text === "string" ? response.output_text : textFrom(response.output ?? response.content);
  const outputBlocks = parseWebRunOutput(output); const artifacts = responseArtifacts(response);
  if (!artifacts.actions.length) throw failure("Hosted Web Search completed without web_search", "WEB_SEARCH_NOT_EXECUTED");
  const citations = uniqueByUrl(artifacts.citations);
  const discovered = uniqueByUrl([...artifacts.sources, ...outputBlocks.flatMap((block) => block.url ? [{ url: block.url, ...(block.title ? { title: block.title } : {}) }] : [])]);
  const ranked = uniqueByUrl([...citations, ...discovered]);
  const limited = ranked.slice(0, Math.max(1, maxResults));
  const images = artifacts.images.slice(0, Math.max(1, maxResults));
  const usage = hostedUsageFrom(response, artifacts.actions.length);
  if (!output && !limited.length && !images.length) throw failure("Hosted Web Search returned no output", "WEB_NO_SOURCES");
  return { mode: "hosted", action: artifacts.actions[0], emulation: "native", content: output, sources: limited, citations, images, warnings: artifacts.actions.length > 1 ? [`Multiple hosted search actions were returned: ${artifacts.actions.join(", ")}`] : [], outputBlocks, domains: outputDomains(outputBlocks), ...(outputLineRange(outputBlocks) ? { lineRange: outputLineRange(outputBlocks) } : {}), requestId, ...(typeof response.id === "string" ? { responseId: response.id } : {}), retrievedAt, truncated: ranked.length > limited.length || artifacts.images.length > images.length, ...(usage ? { usage } : {}) };
}

export type HostedMediaTool = "web_search" | "websearch_gpt_advanced";

/** Project Hosted image results into LCX-owned, tool-private, replayable UI metadata. */
export function hostedMediaPresentationMeta(
  value: unknown,
  tool: HostedMediaTool,
  base: PresentationValue = {},
): PresentationValue {
  const inherited = base !== null && typeof base === "object" && !Array.isArray(base) ? base : {};
  if (!isRecord(value) || !Array.isArray(value.images)) return inherited;
  const candidates = value.images.flatMap((entry): HostedMediaCandidate[] => {
    if (!isRecord(entry)) return [];
    const imageUrl = httpUrl(entry.imageUrl);
    if (!imageUrl) return [];
    const previewUrl = httpUrl(entry.thumbnailUrl);
    const sourceUrl = httpUrl(entry.sourceWebsiteUrl);
    return [{
      kind: "image",
      url: imageUrl.toString(),
      ...(previewUrl ? { previewUrl: previewUrl.toString() } : {}),
      ...(sourceUrl ? { sourceUrl: sourceUrl.toString() } : {}),
      ...(typeof entry.caption === "string" && entry.caption ? { caption: entry.caption } : {}),
      structured: true,
    }];
  });
  return candidates.length
    ? { ...inherited, lcxHostedMedia: { version: 1, tool, candidates } }
    : inherited;
}

export function renderHostedSearchResult(value: unknown): ContentBlock[] {
  const data = isRecord(value) ? value : {};
  const parts: string[] = [];
  if (typeof data.content === "string" && data.content) parts.push(data.content);
  const citations = Array.isArray(data.citations) ? data.citations.filter(isRecord) : [];
  const citationUrls = new Set(citations.map((source) => String(source.url ?? "")).filter(Boolean));
  if (citations.length) parts.push(`引用：\n${citations.map(sourceLine).join("\n")}`);
  const extraSources = Array.isArray(data.sources)
    ? data.sources.filter(isRecord).filter((source) => !citationUrls.has(String(source.url ?? "")))
    : [];
  if (extraSources.length) parts.push(`来源：\n${extraSources.map(sourceLine).join("\n")}`);
  if (Array.isArray(data.images) && data.images.length) {
    parts.push(`图片：\n${data.images.filter(isRecord).map((image) => {
      const caption = String(image.caption ?? image.imageUrl ?? "");
      const imageUrl = String(image.imageUrl ?? "");
      const sourcePage = typeof image.sourceWebsiteUrl === "string" && image.sourceWebsiteUrl
        ? ` 来源页: ${image.sourceWebsiteUrl}`
        : "";
      return `- [${caption}](${imageUrl})${sourcePage}`;
    }).join("\n")}`);
  }
  if (Array.isArray(data.warnings) && data.warnings.length) parts.push(data.warnings.map((warning) => `警告：${String(warning)}`).join("\n"));
  if (isRecord(data.usage)) {
    const renderedUsage = usageLine(data.usage);
    if (renderedUsage) parts.push(renderedUsage);
  }
  parts.push(`检索时间：${String(data.retrievedAt ?? "")}`);
  return [{ type: "text", text: parts.filter(Boolean).join("\n\n") }];
}
