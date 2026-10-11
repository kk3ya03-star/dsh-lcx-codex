import {
  IMAGE_OFFLOAD_REQUIRED_CODE,
  LlmError,
  offloadedImageText,
  projectOffloadedImages,
  requiredImageOffload,
  requestImageHandleText,
  resolveImageAttachmentAccess,
  type ContentBlock,
  type Message,
  type RequestMessage,
} from "@deepseek-ai/dsh-llm";
import type { Context } from "@deepseek-ai/cordis";
import { requestImageDimensions } from "@deepseek-ai/dsh-attachment";
import type { AttachmentStore, RequestImageAttachment } from "@deepseek-ai/dsh-attachment";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";
import type {} from "@deepseek-ai/dsh-fs";
type ImageAttachmentRef = Parameters<typeof requestImageHandleText>[0];
type FileAttachmentRef = Extract<ContentBlock, { type: "file" }>["attachment"];
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
  createGrammarToolInputProperties,
  normalizeContext,
} from "./pi-responses-runtime.js";
import { resolveCatalogModel } from "./model-catalog.js";
import { withoutDeferLoading } from "./tool-surface.js";
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
type ImageBlock = Extract<ContentBlock, { type: "image" }>;
type PiAssistantContentPart = PiTextContent | PiThinkingContent | PiToolCall;
type PiUserContentPart = PiTextContent | PiImageContent;
type PiMessage = PiContextValue["messages"][number];
type PiTool = PiToolValue;
type PiContext = {
  systemPrompt?: string;
  messages: PiMessage[];
  tools: PiTool[];
};
type RequestImageVersions = ReadonlyMap<string, RequestImageAttachment>;
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
  /**
   * The resolved route's `systemPromptUpdate` mode (DSH 0.2.1 `ModelInfo`). Only `"in-history"` changes
   * serialization: a non-leading `system` message is then a real instruction update and is emitted in
   * its history position with the model's instruction role. Any other value keeps the DSH 0.1.5-style
   * mapping (later `system` messages are ordinary user context).
   */
  systemPromptUpdate?: unknown;
  onReplayDegrade?: unknown;
  tools?: PiTool[];
  /**
   * `"addition-only"` marks `tools` as an anchored surface (see `planToolSurface`): tools flagged
   * `deferLoading` are declared only by the developer tool-addition messages in `messages`, rendered in
   * history position as Responses `additional_tools` (or `tool_search` output), while the request `tools`
   * keeps only the immediate declarations. Any other value keeps the strict full-list contract.
   */
  toolUpdate?: unknown;
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

/**
 * Facts DSH resolves for the exact routed model through `llm.resolveModelInfo`, the same
 * adapter-owned metadata the agent loop uses to choose how a system prompt change is recorded.
 * Resolution failure reports `resolved: false` with conservative defaults (unknown image support, no in-history mode).
 */
export async function resolveRouteModelFacts(
  ctx: DshContext | undefined,
  route: { provider?: unknown; model?: unknown },
  signal?: AbortSignal,
): Promise<{
  imageSupport: ImageSupport;
  systemPromptUpdate: "in-history" | undefined;
  /** DSH `ModelInfo.toolUpdate` for the exact routed model (0.2.1+); absent on routes that declare none. */
  toolUpdate: "in-history" | "addition-only" | undefined;
  /** DSH's reasoning capability for the model: absent when DSH offers no reasoning control. */
  reasoning: { efforts: string[] } | undefined;
  /** DSH's context window for the exact routed model (profile, then host catalog); absent when unreported. */
  contextWindow: number | undefined;
  resolved: boolean;
}> {
  const llm = ctx?.llm;
  if (llm === undefined) return { imageSupport: "unknown", systemPromptUpdate: undefined, toolUpdate: undefined, reasoning: undefined, contextWindow: undefined, resolved: false };
  try {
    const info = await llm.resolveModelInfo(
      stringValue(route.provider),
      stringValue(route.model),
      signal,
    );
    const modalities = info.inputModalities;
    return {
      imageSupport: modalities?.includes("image")
        ? "supported"
        : modalities !== undefined
          ? "unsupported"
          : "unknown",
      systemPromptUpdate: info.systemPromptUpdate === "in-history" ? "in-history" : undefined,
      toolUpdate: info.toolUpdate === "addition-only" || info.toolUpdate === "in-history" ? info.toolUpdate : undefined,
      reasoning: info.reasoning === undefined
        ? undefined
        : { efforts: info.reasoning.efforts.map((effort) => String(effort.id)) },
      contextWindow: positiveSafeInteger(info.context?.contextWindow, 0) || undefined,
      resolved: true,
    };
  } catch {
    // `resolved: false` tells callers the mode is unknown rather than known-absent, so they can refuse
    // to downgrade history that only an in-history route may legitimately contain.
    return { imageSupport: "unknown", systemPromptUpdate: undefined, toolUpdate: undefined, reasoning: undefined, contextWindow: undefined, resolved: false };
  }
}

export async function resolveModelImageSupport(
  ctx: DshContext | undefined,
  route: { provider?: unknown; model?: unknown },
  signal?: AbortSignal,
): Promise<ImageSupport> {
  return (await resolveRouteModelFacts(ctx, route, signal)).imageSupport;
}

function attachmentResolver(
  ctx: DshContext | undefined,
  options: ImageOptions,
  requestImages?: RequestImageVersions,
) {
  const attachments = attachmentServices(ctx?.attachments);
  return async (block: { attachment: ImageAttachmentRef }, signal?: AbortSignal) => {
    if (attachments === undefined)
      throw error(
        "LCX requires the DSH request-image attachment API",
        "LCX_COMPACT_IMAGE_API_UNAVAILABLE",
      );
    const request = requestImages === undefined
      ? await attachments.store.readImageRequest(
          block.attachment,
          { ...requestImageDimensions(block.attachment.width, block.attachment.height, options.requestImagePixelBudget), maxBytes: options.requestImageMaxBytes },
          signal,
        )
      : requestImages.get(String(block.attachment.attachmentId));
    if (request === undefined)
      throw error("DSH attachment returned no request-image bytes", "LCX_COMPACT_IMAGE_UNAVAILABLE");
    const data = request.data;
    const mediaType = request.mediaType ?? block.attachment.mediaType;
    if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data))
      throw error("DSH attachment returned no request-image bytes", "LCX_COMPACT_IMAGE_UNAVAILABLE");
    if (typeof mediaType !== "string" || !mediaType.startsWith("image/"))
      throw error("DSH attachment returned an invalid request-image media type", "LCX_COMPACT_IMAGE_UNAVAILABLE");
    return {
      data: Buffer.from(data),
      mediaType,
      ref: block.attachment,
      request,
      access: imageAccess(ctx, attachments, block.attachment),
    };
  };
}

async function imagePart(
  block: { attachment: ImageAttachmentRef },
  ctx: DshContext | undefined,
  options: ImageOptions,
  imageMap: Map<string, ImageAttachmentRef>,
  requestImages?: RequestImageVersions,
): Promise<WireRecord> {
  if (options.imageSupport === "unsupported")
    return { type: "input_text", text: "[image omitted because the target model does not support image input]" };
  const image = await attachmentResolver(ctx, options, requestImages)(block, options.signal);
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
  requestImages: RequestImageVersions,
): Promise<PiUserContentPart[]> {
  if (options.imageSupport === "unsupported")
    return [{ type: "text", text: "[image omitted because the target model does not support image input]" }];
  const image = await attachmentResolver(ctx, options, requestImages)(block, options.signal);
  if (Math.ceil(image.data.byteLength / 3) * 4 > options.maxRequestImageBytes)
    throw error("one image exceeds the configured LCX request image bound", "LCX_COMPACT_IMAGE_TOO_LARGE");
  const data = image.data.toString("base64");
  imageMap.set(`data:${image.mediaType};base64,${data}`, structuredClone(image.ref));
  return [
    { type: "text", text: requestImageHandleText(image.ref, image.request as Pick<RequestImageAttachment, "width" | "height">, image.access) },
    { type: "image", data, mimeType: image.mediaType },
  ];
}

function parseArguments(value: unknown): PiToolCall["arguments"] {
  if (isObject(value)) return structuredClone(value) as PiToolCall["arguments"];
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed) ? parsed as PiToolCall["arguments"] : {};
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

function replayTextPhase(signature: unknown): "commentary" | "final_answer" | undefined {
  if (typeof signature !== "string" || !signature.startsWith("{")) return undefined;
  try {
    const parsed: unknown = JSON.parse(signature);
    if (!isObject(parsed) || parsed.v !== 1 || typeof parsed.id !== "string") return undefined;
    return parsed.phase === "commentary" || parsed.phase === "final_answer"
      ? parsed.phase
      : undefined;
  } catch {
    return undefined;
  }
}

function restorePortableAssistantPhases(
  input: readonly unknown[],
  messages: readonly PiMessage[],
  target: { provider: string; id: string; api: string },
): unknown[] {
  const slots: Array<{ text: string; phase?: "commentary" | "final_answer" }> = [];
  for (const message of messages) {
    if (message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted")
      continue;
    const sameProviderAndApi = message.provider === target.provider && message.api === target.api;
    const sameModel = sameProviderAndApi && message.model === target.id;
    for (const block of message.content) {
      if (block.type === "text") {
        const phase = sameProviderAndApi && !sameModel
          ? replayTextPhase(block.textSignature)
          : undefined;
        slots.push({ text: block.text, ...(phase === undefined ? {} : { phase }) });
      } else if (block.type === "thinking" && !sameModel && !block.redacted && block.thinking.trim()) {
        slots.push({ text: block.thinking });
      }
    }
  }
  const output = structuredClone(input) as unknown[];
  let slotIndex = 0;
  for (const [index, candidate] of output.entries()) {
    if (!isObject(candidate) || candidate.type !== "message" || candidate.role !== "assistant" ||
        !Array.isArray(candidate.content)) continue;
    const slot = slots[slotIndex++];
    if (slot?.phase === undefined) continue;
    const text = candidate.content
      .map((part) => isObject(part) && part.type === "output_text" ? String(part.text ?? "") : "")
      .join("");
    if (text === slot.text) output[index] = { ...candidate, phase: slot.phase };
  }
  return output;
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
  requestImages: RequestImageVersions,
): Promise<PiUserContentPart[]> {
  const content: PiUserContentPart[] = [];
  for (const block of blocks) {
    if (block.type === "text") content.push({ type: "text", text: block.text });
    else if (block.type === "image") content.push(...(await piImageParts(block, ctx, options, imageMap, requestImages)));
    else if (block.type === "reasoning") continue;
    else throw unsupportedContent(block.type);
  }
  return content.length > 0 ? content : [{ type: "text", text: "(no output)" }];
}

function projectFileContent(blocks: readonly ContentBlock[], fileRequestText: (ref: FileAttachmentRef) => string): ContentBlock[] {
  return blocks.map((block): ContentBlock => {
    if (block.type === "file") return { type: "text", text: fileRequestText(block.attachment) } as ContentBlock;
    return block;
  });
}

function projectFiles(
  messages: readonly RequestMessage[],
  ctx: DshContext | undefined,
): readonly RequestMessage[] {
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

function collectRequestImageRefs(
  blocks: readonly ContentBlock[],
  refs: Map<string, ImageAttachmentRef>,
): void {
  for (const block of blocks) {
    if (block.type === "image") {
      if (block.offloaded !== true) refs.set(String(block.attachment.attachmentId), block.attachment);
    }
  }
}

async function prepareRequestImageVersions(
  messages: readonly RequestMessage[],
  ctx: DshContext | undefined,
  options: ImageOptions,
): Promise<ReadonlyMap<string, RequestImageAttachment>> {
  const attachments = attachmentServices(ctx?.attachments);
  if (attachments === undefined) return new Map();
  const refs = new Map<string, ImageAttachmentRef>();
  for (const message of messages) collectRequestImageRefs(message.content, refs);
  const versions = await Promise.all([...refs.values()].map(async (ref) => {
    const target = {
      ...requestImageDimensions(ref.width, ref.height, options.requestImagePixelBudget),
      maxBytes: options.requestImageMaxBytes,
    };
    return [String(ref.attachmentId), await attachments.store.readImageRequest(ref, target, options.signal)] as const;
  }));
  return new Map(versions);
}

/** A full system prompt snapshot written by DSH's own system-prompt projection. */
export function isPromptSnapshotMessage(message: RequestMessage): boolean {
  return message.role === "system" && message.source?.kind === "system-prompt";
}

/** Whether history after the leading head holds a non-empty DSH prompt snapshot (an in-history update). */
export function hasMidHistoryPromptSnapshot(messages: readonly RequestMessage[]): boolean {
  return messages.slice(1).some((message) =>
    isPromptSnapshotMessage(message) &&
    message.content.some((block) => block.type === "text" && block.text.length > 0));
}

function flattenMessageText(message: RequestMessage): string {
  return message.content.map((block) => {
    if (block.type !== "text") throw unsupportedContent(block.type);
    return block.text;
  }).join("");
}

async function dshToPiMessages(
  messages: readonly RequestMessage[],
  ctx: DshContext | undefined,
  options: ImageOptions & { onReplayDegrade?: unknown; inHistorySystem?: boolean; snapshotMarker?: string; anchoredTools?: readonly PiTool[] },
  imageMap: Map<string, ImageAttachmentRef>,
  requestImages: RequestImageVersions,
): Promise<PiMessage[]> {
  const result: PiMessage[] = [];
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "system") {
      if (options.inHistorySystem === true) {
        // In-history routes record a changed system prompt as a full later `system` message that keeps
        // instruction authority. Pi renders a non-leading system message with the model's instruction
        // role (developer for reasoning models, system otherwise) at this exact position.
        const text = flattenMessageText(message);
        if (text.length > 0) {
          // A throwaway marker message directly before a DSH prompt snapshot lets the serializer trace the
          // rendered item back to its source message without inspecting text; it is removed afterwards.
          if (options.snapshotMarker !== undefined && isPromptSnapshotMessage(message))
            result.push({ role: "user", content: options.snapshotMarker, timestamp: 0 });
          result.push({ role: "system", content: text, timestamp: 0 });
        }
        continue;
      }
      result.push({ role: "user", content: flattenMessageText(message), timestamp: 0 });
      continue;
    }
    if (message.role === "developer") {
      // Mirrors the host adapter's `appendDeveloper`: one tool-registry event becomes one system update that
      // carries the added declarations; Pi renders it as `additional_tools` at this exact position.
      if (options.anchoredTools === undefined) throw unsupportedContent("developer message");
      const toolsAdded: PiTool[] = [];
      for (const block of message.content) {
        if (block.type !== "tool-addition") throw unsupportedContent(block.type);
        const tool = options.anchoredTools.find((candidate) => candidate.name === block.toolName);
        if (tool === undefined)
          throw error(`LCX tool update references undeclared tool "${block.toolName}"`, "LCX_RESPONSES_INVALID_INPUT");
        toolsAdded.push(tool);
      }
      if (toolsAdded.length > 0) result.push({ role: "system", content: [], toolsAdded, timestamp: 0 } as unknown as PiMessage);
      continue;
    }
    if (message.role === "assistant") {
      const assistant = toPiAssistant(message, options.onReplayDegrade);
      for (const block of assistant.content)
        if (block.type === "toolCall") toolNames.set(String(block.id), block.name);
      result.push(assistant);
      continue;
    }
    if (message.role === "tool") {
      const toolCallId = String(message.toolCallId);
      result.push({ role: "toolResult", toolCallId, toolName: toolNames.get(toolCallId) ?? "unknown", content: await piToolContent(message.content, ctx, options, imageMap, requestImages), isError: message.isError === true, timestamp: 0 });
      continue;
    }
    const ordinary: ContentBlock[] = [];
    for (const block of message.content) {
      if (block.type === "text" || block.type === "image") ordinary.push(block);
      else if (block.type === "reasoning") continue;
      else throw unsupportedContent(block.type);
    }
    if (ordinary.length > 0) {
      const content: PiUserContentPart[] = [];
      for (const block of ordinary) {
        if (block.type === "text") content.push({ type: "text", text: block.text });
        else if (block.type === "image") content.push(...(await piImageParts(block, ctx, options, imageMap, requestImages)));
      }
      if (content.length > 0) result.push({ role: "user", content, timestamp: 0 });
    }
  }
  return result;
}

function builtinResponsesModel(provider: string, modelId: string) {
  // The exact bundled catalog entry (see `resolveCatalogModel`): the same descriptor the route resolution reads.
  return resolveCatalogModel(provider, modelId).descriptor;
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

export async function serializeDshMessages(messages: readonly RequestMessage[], ctx: DshContext | undefined, options: SerializeOptions = {}) {
  const anchored = options.toolUpdate === "addition-only";
  if (anchored && options.systemPromptUpdate !== "in-history")
    throw error("LCX addition-only tool updates require an in-history route", "LCX_RESPONSES_INVALID_INPUT");
  for (const message of messages) {
    if (message.role === "developer" && !anchored) throw unsupportedContent("developer message");
    for (const block of message.content)
      if (block.type === "tool-addition" || block.type === "tool-removal") {
        // Removals never reach a serializer: the host projection drops them on an addition-only route.
        if (!anchored || message.role !== "developer" || block.type === "tool-removal") throw unsupportedContent(block.type);
      }
  }
  for (const tool of options.tools ?? [])
    if (!anchored && "deferLoading" in tool && tool.deferLoading === true)
      throw unsupportedContent("deferLoading tool declaration");
  // Declared = every tool the history may reference; immediate = the subset that stays in the request `tools`.
  const declaredTools: PiTool[] = (Array.isArray(options.tools) ? options.tools : []).map((tool) => withoutDeferLoading(tool as never) as PiTool);
  const immediateDeclared: PiTool[] = (Array.isArray(options.tools) ? options.tools : [])
    .filter((tool) => !("deferLoading" in tool && tool.deferLoading === true))
    .map((tool) => withoutDeferLoading(tool as never) as PiTool);
  const normalized: ImageOptions & { route: unknown; model: unknown; responsesCompat: unknown; systemPrompt?: string; includeSystemPrompt: boolean; inHistorySystem: boolean; snapshotMarker?: string; onReplayDegrade?: unknown; tools: readonly PiTool[]; anchoredTools?: readonly PiTool[] } = {
    imageSupport: options.imageSupport === "supported" || options.imageSupport === "unsupported" ? options.imageSupport : "unknown",
    signal: options.signal instanceof AbortSignal ? options.signal : undefined,
    route: options.route ?? {}, model: options.model, responsesCompat: options.responsesCompat,
    systemPrompt: typeof options.systemPrompt === "string" ? options.systemPrompt : undefined,
    includeSystemPrompt: options.includeSystemPrompt === true, onReplayDegrade: options.onReplayDegrade,
    inHistorySystem: options.systemPromptUpdate === "in-history",
    snapshotMarker: options.systemPromptUpdate === "in-history" ? `\u0000lcx-prompt-snapshot:${globalThis.crypto.randomUUID()}` : undefined,
    maxRequestImageBytes: positiveSafeInteger(options.maxRequestImageBytes, DEFAULT_MAX_REQUEST_IMAGE_BYTES),
    requestImagePixelBudget: positiveSafeInteger(options.requestImagePixelBudget, DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET),
    requestImageMaxBytes: positiveSafeInteger(options.requestImageMaxBytes, DEFAULT_REQUEST_IMAGE_MAX_BYTES),
    tools: immediateDeclared,
    ...(anchored ? { anchoredTools: declaredTools } : {}),
  };
  const imageMap = new Map<string, ImageAttachmentRef>();
  const fileProjected = projectFiles(messages, ctx);
  const attachments = attachmentServices(ctx?.attachments);
  const requestImages = normalized.imageSupport === "unsupported"
    ? new Map<string, RequestImageAttachment>()
    : await prepareRequestImageVersions(fileProjected, ctx, normalized);
  const offloadImages = attachments === undefined || normalized.imageSupport === "unsupported"
    ? 0
    : requiredImageOffload(
        fileProjected,
        { representation: "base64", maxBytes: normalized.maxRequestImageBytes },
        (block: ImageBlock) => {
          // `requiredImageOffload` applies the base64 expansion itself for a
          // base64 representation, so this reports raw request-version bytes.
          const request = requestImages.get(String(block.attachment.attachmentId));
          return request?.bytes ?? block.attachment.bytes;
        },
      );
  if (offloadImages > 0) {
    throw new LlmError(
      `LCX request images exceed the configured base64 bound; ${offloadImages} more oldest occurrence(s) must be offloaded.`,
      IMAGE_OFFLOAD_REQUIRED_CODE,
      { offloadImages },
    );
  }
  const projected = projectOffloadedImages(
    fileProjected,
    (ref) => offloadedImageText(
      ref,
      attachments === undefined ? undefined : imageAccess(ctx, attachments, ref),
    ),
  );
  const model = resolvePiResponsesModel(normalized);
  const dshContext: PiContext = { systemPrompt: normalized.systemPrompt, messages: await dshToPiMessages(projected, ctx, normalized, imageMap, requestImages), tools: [...normalized.tools] };
  const compat = isObject(model.compat) ? model.compat : {};
  const supportsStrictMode = compat.supportsStrictMode === true;
  const supportsOpenAIGrammarTools = compat.supportsOpenAIGrammarTools === true;
  const supportsAdditionalTools = compat.supportsAdditionalTools === true;
  const supportsToolSearch = compat.supportsToolSearch === true;
  const deferredToolsMode = supportsAdditionalTools ? "additional-tools" : supportsToolSearch ? "tool-search" : undefined;
  const grammarToolInputProperties = createGrammarToolInputProperties([...(normalized.anchoredTools ?? dshContext.tools)], supportsOpenAIGrammarTools);
  // Immediate declarations only: on an anchored surface deferred tools are declared by their history additions.
  const immediateTools = new Map<string, PiTool>();
  for (const tool of dshContext.tools) if (tool.name) immediateTools.set(tool.name, tool);
  const toolOptions = { supportsStrictMode, supportsOpenAIGrammarTools, toolSearchResult: false };
  const normalizedContext = normalizeContext(dshContext);
  // Pi treats whichever system message is first in the transcript as the leading prompt: it skips it when
  // includeSystemPrompt is false and renders it without the update framing. A serialization batch carrying
  // no caller-owned head (no systemPrompt/tools) must never promote a history update to that slot, so an
  // empty placeholder holds the leading position and renders nothing.
  const piContext = normalized.inHistorySystem && normalizedContext.messages[0]?.role === "system" && normalizedContext.messages === dshContext.messages
    ? { ...normalizedContext, messages: [{ role: "system" as const, content: "", timestamp: 0 }, ...normalizedContext.messages] }
    : normalizedContext;
  const piModel = model as PiModel<"openai-responses">;
  // Pi collapses every system message into the leading one unless the transport accepts mid-conversation
  // system messages, which would drop or reorder in-history updates in batched serialization.
  const convertedInput = convertResponsesMessages(piModel, piContext, new Set(["openai", "openai-codex", "opencode"]), { includeSystemPrompt: normalized.includeSystemPrompt, grammarToolInputProperties, supportsAdditionalTools, supportsToolSearch, supportsMidConvoSystemMessages: normalized.inHistorySystem, toolOptions });
  const supersededInstructionItems: number[] = [];
  const unmarkedInput: unknown[] = [];
  let markersFound = 0;
  for (let position = 0; position < convertedInput.length; position += 1) {
    const item = convertedInput[position] as unknown;
    if (normalized.snapshotMarker !== undefined && isMarkerItem(item, normalized.snapshotMarker)) {
      markersFound += 1;
      const rendered = convertedInput[position + 1] as unknown;
      if (!isObject(rendered) || (rendered.role !== "developer" && rendered.role !== "system"))
        throw error("LCX could not trace a rendered system prompt snapshot", "LCX_RESPONSES_INVALID_INPUT");
      supersededInstructionItems.push(unmarkedInput.length);
      continue;
    }
    unmarkedInput.push(item);
  }
  if (normalized.snapshotMarker !== undefined) {
    // Markers are inserted only before non-empty snapshots (empty ones render nothing), so each inserted
    // marker must be found exactly once and none may survive in the output, even if a future Pi merged
    // adjacent user messages.
    const inserted = dshContext.messages.filter(
      (message) => message.role === "user" && message.content === normalized.snapshotMarker,
    ).length;
    const nonce = normalized.snapshotMarker.slice(normalized.snapshotMarker.lastIndexOf(":") + 1);
    if (markersFound !== inserted || JSON.stringify(unmarkedInput).includes(nonce))
      throw error("LCX could not remove a system prompt snapshot marker", "LCX_RESPONSES_INVALID_INPUT");
  }
  const input = restorePortableAssistantPhases(unmarkedInput, dshContext.messages, { provider: model.provider, id: model.id, api: model.api });
  const tools = options.tools === undefined ? undefined : convertResponsesTools([...immediateTools.values()], toolOptions);
  return { input, supersededInstructionItems, imageMap, tools, model: piModel, grammarToolInputProperties, deferredToolsMode };
}

function isMarkerItem(item: unknown, marker: string): boolean {
  if (!isObject(item) || item.role !== "user" || !Array.isArray(item.content)) return false;
  return item.content.length === 1 && isObject(item.content[0]) && item.content[0].text === marker;
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

/** Base64 payload length of every `input_image` data URL in Responses input items, in order. */
export function inputImageBase64Lengths(input: unknown): number[] {
  const lengths: number[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!isObject(value)) return;
    if (value.type === "input_image" && typeof value.image_url === "string") {
      const url = value.image_url;
      const comma = url.indexOf(",");
      lengths.push(url.startsWith("data:") && comma >= 0 ? url.length - comma - 1 : 0);
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(input);
  return lengths;
}

/**
 * Enforce the request image bound over the whole assembled request. Each serialization batch is
 * checked on its own, but images a native checkpoint hydrates (and portable replay re-renders) are
 * not DSH surface images and arrive in other batches, so only the sum shows the real request size.
 * DSH can offload only surface images, oldest first: when offloading enough of them fits the request
 * the route asks for exactly that many; when even all of them cannot, no retry can help and the
 * checkpoint's own images are the reason.
 * @param options.fixedBytes base64 length of images DSH cannot offload (checkpoint / replay)
 * @param options.surfaceBytes base64 length of each offloadable image, oldest first
 */
export function assertAggregateImageBudget(options: { maxBytes: number; fixedBytes: number; surfaceBytes: readonly number[] }): void {
  const total = options.surfaceBytes.reduce((sum, bytes) => sum + bytes, options.fixedBytes);
  if (total <= options.maxBytes) return;
  const excess = total - options.maxBytes;
  let removed = 0;
  let count = 0;
  for (const bytes of options.surfaceBytes) {
    if (removed >= excess) break;
    removed += bytes;
    count += 1;
  }
  if (removed >= excess) {
    throw new LlmError(
      `LCX request images exceed the configured base64 bound once checkpoint images are counted; ${count} more oldest occurrence(s) must be offloaded.`,
      IMAGE_OFFLOAD_REQUIRED_CODE,
      { offloadImages: count },
    );
  }
  throw error(
    `Images retained in the compaction checkpoint (${options.fixedBytes} base64 bytes) leave no room within the ${options.maxBytes}-byte request image bound, and offloading new images cannot recover it; start a new session or raise maxRequestImageBytes`,
    "LCX_CHECKPOINT_IMAGE_BUDGET",
  );
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
