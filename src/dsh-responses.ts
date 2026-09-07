import {
  offloadedImageText,
  offloadRequestImagesWithPolicy,
  requestImageHandleText,
  resolveImageAttachmentAccess,
  type ContentBlock,
  type Message,
} from "@deepseek-ai/dsh-llm";
import type { Context } from "@deepseek-ai/cordis";
import type { AttachmentStore } from "@deepseek-ai/dsh-attachment";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";
import type {} from "@deepseek-ai/dsh-fs";
type ImageAttachmentRef = Parameters<typeof requestImageHandleText>[0];
type FileAttachmentRef = Extract<ContentBlock, { type: "file" }>["attachment"];
type RequestImageAttachment = Parameters<typeof requestImageHandleText>[1];
type AttachmentServices = {
  store: AttachmentStore;
  resolveAccess(
    mapper: (hostPath: string) => string | undefined,
    ref: ImageAttachmentRef,
  ): ReturnType<typeof resolveImageAttachmentAccess>;
};
import {
  convertResponsesMessages,
  convertResponsesTools,
} from "@earendil-works/pi-ai/api/openai-responses-shared";
import { createGrammarToolInputProperties } from "@earendil-works/pi-ai/api/constrained-sampling";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type {
  AssistantMessage as PiAssistantMessage,
  Context as PiContextValue,
  ImageContent as PiImageContent,
  Model as PiModel,
  TextContent as PiTextContent,
  ThinkingContent as PiThinkingContent,
  Tool as PiToolValue,
  ToolCall as PiToolCall,
  ToolResultMessage as PiToolResultMessage,
  UserMessage as PiUserMessage,
} from "@earendil-works/pi-ai";

const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048;
const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024;

export {
  DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
};

type WireRecord = Record<string, unknown>;
type ImageSupport = "supported" | "unsupported" | "unknown";
type PiAssistantContentPart = PiTextContent | PiThinkingContent | PiToolCall;
type PiUserContentPart = PiTextContent | PiImageContent;
type PiMessage = PiContextValue["messages"][number];
type PiTool = PiToolValue;
type PiContext = {
  systemPrompt?: string;
  messages: PiMessage[];
  tools: PiTool[];
};
type DshContext = Pick<Context, "attachments" | "llm" | "fs">;
type ImageOptions = {
  imageSupport: ImageSupport;
  signal?: AbortSignal;
  maxRequestImageBytes: number;
  requestImagePixelBudget: number;
  requestImageMaxBytes: number;
};
type SerializeOptions = Partial<ImageOptions> & {
  route?: unknown;
  model?: unknown;
  responsesCompat?: unknown;
  systemPrompt?: unknown;
  includeSystemPrompt?: boolean;
  onReplayDegrade?: unknown;
  tools?: PiTool[];
};
type NativeItem = WireRecord & { type?: string; role?: string; content?: unknown; output?: unknown };
type ReplayBlock = WireRecord & { type: "text" | "reasoning" | "tool-call" };
type ReplayResponse = WireRecord & {
  kind: "pi-ai";
  version: 2;
  api: string;
  provider: string;
  model: string;
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
};

function isObject(value: unknown): value is WireRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isResponseInputItem(value: unknown): value is ResponseInputItem {
  if (!isObject(value)) return false;
  if (value.type === "compaction")
    return typeof value.encrypted_content === "string";
  if (value.type === "message" || value.type === undefined)
    return (
      (value.role === "developer" ||
        value.role === "user" ||
        value.role === "system" ||
        value.role === "assistant") &&
      (typeof value.content === "string" || Array.isArray(value.content))
    );
  if (value.type === "function_call")
    return (
      typeof value.call_id === "string" &&
      typeof value.name === "string" &&
      typeof value.arguments === "string"
    );
  if (value.type === "function_call_output")
    return typeof value.call_id === "string" && value.output !== undefined;
  return false;
}

export function responseInputItems(value: unknown): ResponseInputItem[] {
  if (!Array.isArray(value) || !value.every(isResponseInputItem))
    throw error(
      "native checkpoint contains an unsupported Responses input item",
      "LCX_COMPACT_INVALID_RESPONSE",
    );
  return value;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function positiveSafeInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : fallback;
}

function error(message: string | undefined, code: string): Error & { code: string } {
  const value = new Error(message) as Error & { code: string };
  value.code = code;
  return value;
}

function errorCode(value: unknown): string | undefined {
  return isObject(value) && typeof value.code === "string" ? value.code : undefined;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function attachmentServices(
  store: AttachmentStore | undefined,
): AttachmentServices | undefined {
  if (store === undefined) return undefined;
  return {
    store,
    resolveAccess: (mapper, ref) =>
      resolveImageAttachmentAccess(store, mapper, ref),
  };
}

function hasImageAttachment(value: unknown): value is ImageAttachmentRef {
  return isObject(value) && typeof value.attachmentId === "string" && typeof value.bytes === "number";
}

function imageAccess(
  ctx: DshContext | undefined,
  attachments: AttachmentServices,
  ref: ImageAttachmentRef,
) {
  const mapper = ctx?.fs
    ? (hostPath: string): string | undefined =>
        ctx.fs.processPathFromHostPath(hostPath)
    : (): undefined => undefined;
  return attachments.resolveAccess(mapper, ref);
}

export async function resolveModelImageSupport(
  ctx: DshContext | undefined,
  route: { provider?: unknown; model?: unknown },
  signal?: AbortSignal,
): Promise<ImageSupport> {
  const llm = ctx?.llm;
  if (llm === undefined) return "unknown";
  try {
    const info = await llm.resolveModelInfo(
      stringValue(route.provider),
      stringValue(route.model),
      signal,
    );
    const modalities = info.inputModalities;
    return modalities?.includes("image")
      ? "supported"
      : modalities !== undefined
        ? "unsupported"
        : "unknown";
  } catch {
    return "unknown";
  }
}

function attachmentResolver(ctx: DshContext | undefined, options: ImageOptions) {
  const attachments = attachmentServices(ctx?.attachments);
  return async (block: { attachment: ImageAttachmentRef }, signal?: AbortSignal) => {
    if (attachments === undefined)
      throw error(
        "LCX requires the DSH 0.1.3 request-image attachment API",
        "LCX_COMPACT_IMAGE_API_UNAVAILABLE",
      );
    const request = await attachments.store.readImageRequest(
      block.attachment,
      { maxPixels: options.requestImagePixelBudget, maxBytes: options.requestImageMaxBytes },
      signal,
    );
    const data = request.data;
    const mediaType = request.mediaType ?? block.attachment.mediaType;
    if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data))
      throw error("DSH attachment returned no request-image bytes", "LCX_COMPACT_IMAGE_UNAVAILABLE");
    if (typeof mediaType !== "string" || !mediaType.startsWith("image/"))
      throw error("DSH attachment returned an invalid request-image media type", "LCX_COMPACT_IMAGE_UNAVAILABLE");
    const ref = request.attachment ?? block.attachment;
    return {
      data: Buffer.from(data),
      mediaType,
      ref,
      request,
      access: imageAccess(ctx, attachments, ref),
    };
  };
}

async function imagePart(
  block: { attachment: ImageAttachmentRef },
  ctx: DshContext | undefined,
  options: ImageOptions,
  imageMap: Map<string, ImageAttachmentRef>,
): Promise<WireRecord> {
  if (options.imageSupport === "unsupported")
    return { type: "input_text", text: "[image omitted because the target model does not support image input]" };
  const image = await attachmentResolver(ctx, options)(block, options.signal);
  if (Math.ceil(image.data.byteLength / 3) * 4 > options.maxRequestImageBytes)
    throw error("one image exceeds the configured LCX request image bound", "LCX_COMPACT_IMAGE_TOO_LARGE");
  const imageUrl = `data:${image.mediaType};base64,${image.data.toString("base64")}`;
  imageMap.set(imageUrl, structuredClone(image.ref));
  return { type: "input_image", detail: "auto", image_url: imageUrl };
}

async function piImageParts(
  block: { attachment: ImageAttachmentRef },
  ctx: DshContext | undefined,
  options: ImageOptions,
  imageMap: Map<string, ImageAttachmentRef>,
): Promise<PiUserContentPart[]> {
  if (options.imageSupport === "unsupported")
    return [{ type: "text", text: "[image omitted because the target model does not support image input]" }];
  const image = await attachmentResolver(ctx, options)(block, options.signal);
  if (Math.ceil(image.data.byteLength / 3) * 4 > options.maxRequestImageBytes)
    throw error("one image exceeds the configured LCX request image bound", "LCX_COMPACT_IMAGE_TOO_LARGE");
  const data = image.data.toString("base64");
  imageMap.set(`data:${image.mediaType};base64,${data}`, structuredClone(image.ref));
  return [
    { type: "text", text: requestImageHandleText(image.ref, image.request as Pick<RequestImageAttachment, "width" | "height">, image.access) },
    { type: "image", data, mimeType: image.mediaType },
  ];
}

function parseArguments(value: unknown): WireRecord {
  if (isObject(value)) return structuredClone(value);
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function invalidReplay(message: string) {
  return error(`invalid pi-ai replay state: ${message}`, "LCX_COMPACT_INVALID_REPLAY_STATE");
}

function unsupportedContent(type: unknown) {
  return error(`LCX Compact cannot safely serialize DSH message content type: ${String(type)}`, "LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT");
}

function replayBlockType(type: unknown): ReplayBlock["type"] | undefined {
  return type === "text" || type === "reasoning" || type === "tool-call" ? type : undefined;
}

export function readDshPiReplayState(value: unknown): { response: ReplayResponse; blocks: ReplayBlock[] } {
  if (!isObject(value)) throw invalidReplay("expected a replay envelope");
  const responseValue = value.response;
  if (!isObject(responseValue) || responseValue.kind !== "pi-ai" || responseValue.version !== 2)
    throw invalidReplay("expected a pi-ai version 2 response object");
  const required = ["api", "provider", "model"] as const;
  for (const key of required)
    if (typeof responseValue[key] !== "string" || responseValue[key].length === 0)
      throw invalidReplay(`${key} must be a non-empty string`);
  if (!(["stop", "length", "toolUse", "error", "aborted"] as const).includes(responseValue.stopReason as ReplayResponse["stopReason"]))
    throw invalidReplay("unknown stopReason");
  if (responseValue.responseModel !== undefined && typeof responseValue.responseModel !== "string") throw invalidReplay("responseModel must be a string");
  if (responseValue.responseId !== undefined && typeof responseValue.responseId !== "string") throw invalidReplay("responseId must be a string");
  if (!Array.isArray(value.blocks)) throw invalidReplay("blocks must be an array");
  const blocks = value.blocks.map((block, index): ReplayBlock => {
    if (!isObject(block) || replayBlockType(block.type) === undefined) throw invalidReplay(`block ${index} has an unknown type`);
    for (const signature of ["textSignature", "thinkingSignature", "thoughtSignature", "namespace"])
      if (block[signature] !== undefined && typeof block[signature] !== "string") throw invalidReplay(`block ${index} ${signature} must be a string`);
    if (block.redacted !== undefined && typeof block.redacted !== "boolean") throw invalidReplay(`block ${index} redacted must be boolean`);
    return { ...block, type: replayBlockType(block.type) } as ReplayBlock;
  });
  return { response: responseValue as ReplayResponse, blocks };
}

function foreignAssistant(message: Message): PiAssistantMessage {
  const source = message.source.kind === "model" ? message.source : undefined;
  const content: PiAssistantContentPart[] = [];
  for (const block of message.content) {
    if (block.type === "text") content.push({ type: "text", text: block.text });
    else if (block.type === "reasoning") content.push({ type: "thinking", thinking: block.text });
    else if (block.type === "tool-call") content.push({ type: "toolCall", id: String(block.id), name: block.name, arguments: parseArguments(block.arguments) });
    else throw unsupportedContent(block.type);
  }
  return { role: "assistant", content, api: "dsh-foreign", provider: source?.provider ?? "dsh-foreign", model: source?.model ?? "dsh-foreign", usage: emptyUsage(), stopReason: content.some((block) => block.type === "toolCall") ? "toolUse" : "stop", timestamp: 0 };
}

function replayedAssistant(
  message: Message,
  source: { replayState?: unknown; provider: string; model: string },
): PiAssistantMessage {
  if (source.replayState === undefined) throw invalidReplay("assistant source has no replay state");
  const state = readDshPiReplayState(source.replayState);
  if (state.response.provider !== source.provider) throw invalidReplay("provider does not match assistant source");
  if (state.response.model !== source.model) throw invalidReplay("model does not match assistant source");
  if (state.blocks.length !== message.content.length) throw invalidReplay("block count does not match assistant content");
  const content = message.content.map((block, index): PiAssistantContentPart => {
    const replay = state.blocks[index];
    if (replayBlockType(block.type) !== replay.type) throw invalidReplay(`block ${index} does not match assistant content`);
    if (block.type === "text") return { type: "text", text: block.text, ...(typeof replay.textSignature === "string" ? { textSignature: replay.textSignature } : {}) };
    if (block.type === "reasoning") return { type: "thinking", thinking: block.text, ...(typeof replay.thinkingSignature === "string" ? { thinkingSignature: replay.thinkingSignature } : {}), ...(typeof replay.redacted === "boolean" ? { redacted: replay.redacted } : {}) };
    if (block.type === "tool-call") return { type: "toolCall", id: String(block.id), name: block.name, arguments: parseArguments(block.arguments), ...(typeof replay.thoughtSignature === "string" ? { thoughtSignature: replay.thoughtSignature } : {}), ...(typeof replay.namespace === "string" ? { namespace: replay.namespace } : {}) };
    throw invalidReplay(`block ${index} has an unsupported type`);
  });
  return { role: "assistant", content, api: state.response.api, provider: state.response.provider, model: state.response.model, ...(typeof state.response.responseModel === "string" ? { responseModel: state.response.responseModel } : {}), ...(typeof state.response.responseId === "string" ? { responseId: state.response.responseId } : {}), usage: emptyUsage(), stopReason: state.response.stopReason, timestamp: 0 };
}

function toPiAssistant(
  message: Message,
  onReplayDegrade: unknown,
): PiAssistantMessage {
  const source = message.source;
  if (source.kind !== "model" || source.replayState === undefined) return foreignAssistant(message);
  try {
    return replayedAssistant(message, source);
  } catch (cause) {
    if (errorCode(cause) !== "LCX_COMPACT_INVALID_REPLAY_STATE") throw cause;
    if (typeof onReplayDegrade === "function") onReplayDegrade(errorMessage(cause));
    return foreignAssistant(message);
  }
}

async function piToolContent(
  blocks: readonly ContentBlock[],
  ctx: DshContext | undefined,
  options: ImageOptions,
  imageMap: Map<string, ImageAttachmentRef>,
): Promise<PiUserContentPart[]> {
  const content: PiUserContentPart[] = [];
  for (const block of blocks) {
    if (block.type === "text") content.push({ type: "text", text: block.text });
    else if (block.type === "image") content.push(...(await piImageParts(block, ctx, options, imageMap)));
    else if (block.type === "tool-result") content.push(...(await piToolContent(block.content, ctx, options, imageMap)));
    else throw unsupportedContent(block.type);
  }
  return content.length > 0 ? content : [{ type: "text", text: "(no output)" }];
}

function projectFileContent(blocks: readonly ContentBlock[], fileRequestText: (ref: FileAttachmentRef) => string): ContentBlock[] {
  return blocks.map((block): ContentBlock => {
    if (block.type === "file") return { type: "text", text: fileRequestText(block.attachment) } as ContentBlock;
    if (block.type === "tool-result") return { ...block, content: projectFileContent(block.content, fileRequestText) } as ContentBlock;
    return block;
  });
}

function projectFiles(
  messages: readonly Message[],
  ctx: DshContext | undefined,
): readonly Message[] {
  const fileRequestText = ctx?.llm?.fileRequestText.bind(ctx.llm);
  if (fileRequestText === undefined) {
    for (const message of messages)
      for (const block of message.content)
        if (block.type === "file")
          throw unsupportedContent("file (DSH fileRequestText API unavailable)");
    return messages;
  }
  return messages.map((message) => ({
    ...message,
    content: projectFileContent(message.content, fileRequestText),
  }));
}

async function dshToPiMessages(messages: readonly Message[], ctx: DshContext | undefined, options: ImageOptions & { onReplayDegrade?: unknown }, imageMap: Map<string, ImageAttachmentRef>): Promise<PiMessage[]> {
  const result: PiMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "assistant") { result.push(toPiAssistant(message, options.onReplayDegrade)); continue; }
    const ordinary: ContentBlock[] = [];
    const toolResults: ContentBlock[] = [];
    for (const block of message.content) {
      if (block.type === "text" || block.type === "image") ordinary.push(block);
      else if (block.type === "tool-result") toolResults.push(block);
      else throw unsupportedContent(block.type);
    }
    if (ordinary.length > 0) {
      const content: PiUserContentPart[] = [];
      for (const block of ordinary) {
        if (block.type === "text") content.push({ type: "text", text: block.text });
        else if (block.type === "image") content.push(...(await piImageParts(block, ctx, options, imageMap)));
      }
      if (content.length > 0) result.push({ role: "user", content, timestamp: 0 });
    }
    for (const block of toolResults) {
      if (block.type !== "tool-result") continue;
      result.push({ role: "toolResult", toolCallId: String(block.toolCallId), toolName: "unknown", content: await piToolContent(block.content, ctx, options, imageMap), addedToolNames: [], isError: block.isError === true, timestamp: 0 });
    }
  }
  return result;
}

function builtinResponsesModel(provider: string, modelId: string) {
  try {
    return getBuiltinModels(provider as Parameters<typeof getBuiltinModels>[0]).find((model) => model.id === modelId && model.api === "openai-responses");
  } catch {
    return undefined;
  }
}

export function resolvePiResponsesModel(options: { imageSupport: unknown; route?: unknown; model?: unknown; responsesCompat?: unknown }) {
  const route = isObject(options.route) ? options.route : {};
  const explicit = isObject(options.model) ? options.model : {};
  const provider = stringValue(explicit.provider, stringValue(route.provider, "dsh-lcx-codex"));
  const id = stringValue(explicit.id, stringValue(route.model, "unknown"));
  const builtin = builtinResponsesModel(provider, id);
  const builtinRecord: WireRecord = isObject(builtin) ? builtin : {};
  const compat = { ...(isObject(builtinRecord.compat) ? builtinRecord.compat : {}), ...(isObject(options.responsesCompat) ? options.responsesCompat : {}), ...(isObject(explicit.compat) ? explicit.compat : {}) };
  const imageSupport = options.imageSupport === "supported" || options.imageSupport === "unsupported" ? options.imageSupport : "unknown";
  const input = imageSupport === "supported" ? ["text", "image"] : imageSupport === "unsupported" ? ["text"] : Array.isArray(explicit.input) ? explicit.input : Array.isArray(builtinRecord.input) ? builtinRecord.input : ["text"];
  return { ...builtinRecord, ...explicit, id, name: stringValue(explicit.name, stringValue(builtinRecord.name, id)), api: "openai-responses", provider, baseUrl: stringValue(explicit.baseUrl, stringValue(route.baseURL, stringValue(builtinRecord.baseUrl))), reasoning: typeof explicit.reasoning === "boolean" ? explicit.reasoning : typeof builtinRecord.reasoning === "boolean" ? builtinRecord.reasoning : true, input, cost: explicit.cost ?? builtinRecord.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: positiveSafeInteger(explicit.contextWindow ?? builtinRecord.contextWindow, 262144), maxTokens: positiveSafeInteger(explicit.maxTokens ?? builtinRecord.maxTokens, 32768), ...(Object.keys(compat).length > 0 ? { compat } : {}) };
}

export async function serializeDshMessages(messages: readonly Message[], ctx: DshContext | undefined, options: SerializeOptions = {}) {
  const normalized: ImageOptions & { route: unknown; model: unknown; responsesCompat: unknown; systemPrompt?: string; includeSystemPrompt: boolean; onReplayDegrade?: unknown; tools: readonly PiTool[] } = {
    imageSupport: options.imageSupport === "supported" || options.imageSupport === "unsupported" ? options.imageSupport : "unknown",
    signal: options.signal instanceof AbortSignal ? options.signal : undefined,
    route: options.route ?? {}, model: options.model, responsesCompat: options.responsesCompat,
    systemPrompt: typeof options.systemPrompt === "string" ? options.systemPrompt : undefined,
    includeSystemPrompt: options.includeSystemPrompt === true, onReplayDegrade: options.onReplayDegrade,
    maxRequestImageBytes: positiveSafeInteger(options.maxRequestImageBytes, DEFAULT_MAX_REQUEST_IMAGE_BYTES),
    requestImagePixelBudget: positiveSafeInteger(options.requestImagePixelBudget, DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET),
    requestImageMaxBytes: positiveSafeInteger(options.requestImageMaxBytes, DEFAULT_REQUEST_IMAGE_MAX_BYTES),
    tools: Array.isArray(options.tools) ? options.tools : [],
  };
  const imageMap = new Map<string, ImageAttachmentRef>();
  const fileProjected = projectFiles(messages, ctx);
  const attachments = attachmentServices(ctx?.attachments);
  const projected = offloadRequestImagesWithPolicy(fileProjected, {
    representation: "base64", maxBytes: normalized.maxRequestImageBytes, byteQuantum: 1,
    byteLength: (ref) => Math.min(ref.bytes, normalized.requestImageMaxBytes),
    placeholder: (ref) =>
      offloadedImageText(
        ref,
        attachments === undefined ? undefined : imageAccess(ctx, attachments, ref),
      ),
  });
  const model = resolvePiResponsesModel(normalized);
  const context: PiContext = { systemPrompt: normalized.systemPrompt, messages: await dshToPiMessages(projected, ctx, normalized, imageMap), tools: [...normalized.tools] };
  const compat = isObject(model.compat) ? model.compat : {};
  const supportsStrictMode = compat.supportsStrictMode === true;
  const supportsOpenAIGrammarTools = compat.supportsOpenAIGrammarTools === true;
  const supportsAdditionalTools = compat.supportsAdditionalTools === true;
  const supportsToolSearch = compat.supportsToolSearch === true;
  const deferredToolsMode = supportsAdditionalTools ? "additional-tools" : supportsToolSearch ? "tool-search" : undefined;
  const grammarToolInputProperties = createGrammarToolInputProperties(context.tools, supportsOpenAIGrammarTools);
  // DSH has no authoritative added-tool provenance; keep its full catalog immediate.
  const immediateTools = new Map<string, PiTool>();
  for (const tool of context.tools) if (tool.name) immediateTools.set(tool.name, tool);
  const toolOptions = { supportsStrictMode, supportsOpenAIGrammarTools };
  const piContext: PiContextValue = {
    systemPrompt: context.systemPrompt,
    messages: context.messages as PiContextValue["messages"],
    tools: context.tools,
  };
  const piModel = model as PiModel<"openai-responses">;
  const input = convertResponsesMessages(piModel, piContext, new Set(["openai", "openai-codex", "opencode"]), { includeSystemPrompt: normalized.includeSystemPrompt, grammarToolInputProperties, deferredTools: new Map<string, PiTool>(), deferredToolsMode, toolOptions });
  const tools = options.tools === undefined ? undefined : convertResponsesTools([...immediateTools.values()], toolOptions);
  return { input, imageMap, tools, model: piModel, grammarToolInputProperties, deferredToolsMode };
}

export function responsesTools(tools: readonly PiTool[] | undefined) {
  if (tools === undefined) return undefined;
  if (!Array.isArray(tools)) throw error("LCX Responses tools must be an array", "LCX_COMPACT_INVALID_TOOLS");
  if (tools.every((tool) => isObject(tool) && typeof tool.type === "string")) return structuredClone(tools);
  for (const tool of tools) if (!isObject(tool) || typeof tool.name !== "string" || !tool.name) throw error("LCX Responses tool has no name", "LCX_COMPACT_INVALID_TOOLS");
  return convertResponsesTools(tools, { supportsStrictMode: false, supportsOpenAIGrammarTools: false });
}

function isResponsesMessageItem(item: unknown): item is NativeItem & { role: string } {
  return isObject(item) && typeof item.role === "string" && (item.type === undefined || item.type === "message");
}

function mapImageParts(value: readonly unknown[], mapper: (part: WireRecord) => WireRecord): unknown[] {
  return value.map((part): unknown => {
    if (!isObject(part)) return structuredClone(part);
    if (part.type === "input_image" || part.type === "dsh_image_attachment") return mapper(part);
    if (part.type === "function_call_output" && Array.isArray(part.output)) return { ...structuredClone(part), output: mapImageParts(part.output, mapper) };
    return structuredClone(part);
  });
}

export function persistNativeImageReferences(output: readonly unknown[], imageMap: ReadonlyMap<string, ImageAttachmentRef>) {
  const persist = (part: WireRecord): WireRecord => {
    if (part.type === "dsh_image_attachment" && isObject(part.attachment)) return structuredClone(part);
    if (part.type !== "input_image" || typeof part.image_url !== "string") throw error("native compact returned an invalid image item", "LCX_COMPACT_INVALID_RESPONSE");
    const ref = imageMap.get(part.image_url);
    if (ref === undefined) throw error("native compact returned an untracked image item", "LCX_COMPACT_INVALID_RESPONSE");
    return { type: "dsh_image_attachment", attachment: structuredClone(ref) };
  };
  return output.map((item): unknown => {
    if (!isObject(item)) return structuredClone(item);
    if (isResponsesMessageItem(item) && Array.isArray(item.content)) return { ...structuredClone(item), content: mapImageParts(item.content, persist) };
    if (item.type === "function_call_output" && Array.isArray(item.output)) return { ...structuredClone(item), output: mapImageParts(item.output, persist) };
    return structuredClone(item);
  });
}

async function hydratePart(part: unknown, ctx: DshContext | undefined, options: ImageOptions & { imageMap: Map<string, ImageAttachmentRef> }): Promise<unknown> {
  if (!isObject(part) || part.type !== "dsh_image_attachment") return structuredClone(part);
  const attachment = part.attachment;
  if (!hasImageAttachment(attachment)) throw error("native compact returned an invalid image attachment", "LCX_COMPACT_INVALID_RESPONSE");
  if (options.imageSupport === "unsupported") return { type: "input_text", text: "[image omitted because the target model does not support image input]" };
  return imagePart({ attachment }, ctx, options, options.imageMap);
}

export async function hydrateNativeImageReferences(output: unknown, ctx: DshContext | undefined, options: Partial<ImageOptions> & { imageMap?: unknown } = {}) {
  const normalized: ImageOptions & { imageMap: Map<string, ImageAttachmentRef> } = {
    imageSupport: options.imageSupport === "supported" || options.imageSupport === "unsupported" ? options.imageSupport : "unknown",
    signal: options.signal instanceof AbortSignal ? options.signal : undefined,
    maxRequestImageBytes: positiveSafeInteger(options.maxRequestImageBytes, DEFAULT_MAX_REQUEST_IMAGE_BYTES),
    requestImagePixelBudget: positiveSafeInteger(options.requestImagePixelBudget, DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET),
    requestImageMaxBytes: positiveSafeInteger(options.requestImageMaxBytes, DEFAULT_REQUEST_IMAGE_MAX_BYTES),
    imageMap: options.imageMap instanceof Map ? options.imageMap as Map<string, ImageAttachmentRef> : new Map<string, ImageAttachmentRef>(),
  };
  const result: unknown[] = [];
  for (const item of asArray(output)) {
    if (!isObject(item)) { result.push(structuredClone(item)); continue; }
    if (isResponsesMessageItem(item) && Array.isArray(item.content)) {
      const content: unknown[] = [];
      for (const part of item.content) content.push(await hydratePart(part, ctx, normalized));
      result.push({ ...structuredClone(item), content });
    } else if (item.type === "function_call_output" && Array.isArray(item.output)) {
      const value: unknown[] = [];
      for (const part of item.output) value.push(await hydratePart(part, ctx, normalized));
      result.push({ ...structuredClone(item), output: value });
    } else result.push(structuredClone(item));
  }
  return result;
}
