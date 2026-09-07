import { requestImageHandleText, type Message } from "@deepseek-ai/dsh-llm";
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
export declare function resolveModelImageSupport(ctx: DshContext | undefined, route: {
    provider?: unknown;
    model?: unknown;
}, signal?: AbortSignal): Promise<ImageSupport>;
export declare function readDshPiReplayState(value: unknown): {
    response: ReplayResponse;
    blocks: ReplayBlock[];
};
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
export declare function serializeDshMessages(messages: readonly Message[], ctx: DshContext | undefined, options?: SerializeOptions): Promise<{
    input: import("openai/resources/responses/responses.js").ResponseInput;
    imageMap: Map<string, import("@deepseek-ai/dsh-attachment").ImageAttachmentRef>;
    tools: import("openai/resources/responses/responses.js").Tool[] | undefined;
    model: PiModel<"openai-responses">;
    grammarToolInputProperties: ReadonlyMap<string, string>;
    deferredToolsMode: string | undefined;
}>;
export declare function responsesTools(tools: readonly PiTool[] | undefined): any[] | undefined;
export declare function persistNativeImageReferences(output: readonly unknown[], imageMap: ReadonlyMap<string, ImageAttachmentRef>): unknown[];
export declare function hydrateNativeImageReferences(output: unknown, ctx: DshContext | undefined, options?: Partial<ImageOptions> & {
    imageMap?: unknown;
}): Promise<unknown[]>;
