import { requestImageHandleText, type RequestMessage } from "@deepseek-ai/dsh-llm";
import type { Context } from "@deepseek-ai/cordis";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";
type ImageAttachmentRef = Parameters<typeof requestImageHandleText>[0];
import type { Model as PiModel, Tool as PiToolValue } from "@earendil-works/pi-ai";
declare const DEFAULT_MAX_REQUEST_IMAGE_BYTES: number;
declare const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET: number;
declare const DEFAULT_REQUEST_IMAGE_MAX_BYTES: number;
export { DEFAULT_MAX_REQUEST_IMAGE_BYTES, DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET, DEFAULT_REQUEST_IMAGE_MAX_BYTES, };
type WireRecord = Record<string, unknown>;
type ImageSupport = "supported" | "unsupported" | "unknown";
type PiTool = PiToolValue;
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
};
type ReplayBlock = WireRecord & {
    type: "text" | "reasoning" | "tool-call";
};
type ReplayResponse = WireRecord & {
    kind: "pi-ai";
    version: 2;
    api: string;
    provider: string;
    model: string;
    stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
};
export declare function responseInputItems(value: unknown): ResponseInputItem[];
/**
 * Facts DSH resolves for the exact routed model through `llm.resolveModelInfo`, the same
 * adapter-owned metadata the agent loop uses to choose how a system prompt change is recorded.
 * Resolution failure reports `resolved: false` with conservative defaults (unknown image support, no in-history mode).
 */
export declare function resolveRouteModelFacts(ctx: DshContext | undefined, route: {
    provider?: unknown;
    model?: unknown;
}, signal?: AbortSignal): Promise<{
    imageSupport: ImageSupport;
    systemPromptUpdate: "in-history" | undefined;
    /** DSH's reasoning capability for the model: absent when DSH offers no reasoning control. */
    reasoning: {
        efforts: string[];
    } | undefined;
    resolved: boolean;
}>;
export declare function resolveModelImageSupport(ctx: DshContext | undefined, route: {
    provider?: unknown;
    model?: unknown;
}, signal?: AbortSignal): Promise<ImageSupport>;
export declare function readDshPiReplayState(value: unknown): {
    response: ReplayResponse;
    blocks: ReplayBlock[];
};
/** A full system prompt snapshot written by DSH's own system-prompt projection. */
export declare function isPromptSnapshotMessage(message: RequestMessage): boolean;
/** Whether history after the leading head holds a non-empty DSH prompt snapshot (an in-history update). */
export declare function hasMidHistoryPromptSnapshot(messages: readonly RequestMessage[]): boolean;
export declare function resolvePiResponsesModel(options: {
    imageSupport: unknown;
    route?: unknown;
    model?: unknown;
    responsesCompat?: unknown;
}): {
    id: string;
    name: string;
    api: string;
    provider: string;
    baseUrl: string;
    reasoning: boolean;
    input: any[];
    cost: {};
    contextWindow: number;
    maxTokens: number;
    compat?: {
        [x: string]: unknown;
    } | undefined;
};
export declare function serializeDshMessages(messages: readonly RequestMessage[], ctx: DshContext | undefined, options?: SerializeOptions): Promise<{
    input: unknown[];
    supersededInstructionItems: number[];
    imageMap: Map<string, import("@deepseek-ai/dsh-attachment").ImageAttachmentRef>;
    tools: import("openai/resources/responses/responses.js").Tool[] | undefined;
    model: PiModel<"openai-responses">;
    grammarToolInputProperties: ReadonlyMap<string, string>;
    deferredToolsMode: string | undefined;
}>;
export declare function responsesTools(tools: readonly PiTool[] | undefined): any[] | undefined;
export declare function persistNativeImageReferences(output: readonly unknown[], imageMap: ReadonlyMap<string, ImageAttachmentRef>): unknown[];
/** Base64 payload length of every `input_image` data URL in Responses input items, in order. */
export declare function inputImageBase64Lengths(input: unknown): number[];
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
export declare function assertAggregateImageBudget(options: {
    maxBytes: number;
    fixedBytes: number;
    surfaceBytes: readonly number[];
}): void;
export declare function hydrateNativeImageReferences(output: unknown, ctx: DshContext | undefined, options?: Partial<ImageOptions> & {
    imageMap?: unknown;
}): Promise<unknown[]>;
