import { type Model as PiModel } from "@earendil-works/pi-ai";
import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import { type GrokNativeReplayRoute } from "./grok-native-search.js";
type UnknownRecord = Record<string, unknown>;
type PiResponsesModel = PiModel<"openai-responses">;
type ManagedFailure = {
    message: string;
    code: string;
    status?: number;
    requestId?: string;
    providerRetryAfterMs?: number;
};
type AbortLike = Pick<AbortSignal, "aborted" | "reason">;
export type ServerToolUsage = {
    webSearchCalls: number;
    xSearchCalls: number;
    total: number;
};
type StreamRequestOptions = {
    baseURL: string;
    provider: string;
    model: string;
    piModel: PiResponsesModel;
    body: UnknownRecord;
    grammarToolInputProperties?: ReadonlyMap<string, string>;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
    applyDefaultTimeout?: boolean;
    streamIdleTimeoutMs?: number;
    maxAttempts?: number;
    maxResponseBytes?: number;
    serverToolTypes?: ReadonlySet<string>;
    nativeReplayRoute?: GrokNativeReplayRoute;
    onServerToolUsage?: (usage: ServerToolUsage) => void;
};
/**
 * Provider bodies/messages are deliberately not surfaced. Only a stable class and safe facts leave the wire boundary.
 * @param {unknown} error
 * @param {AbortSignal} [signal]
 */
export declare function managedFailure(error: unknown, signal: AbortLike | undefined): ManagedFailure;
/** @param {unknown} error @param {AbortSignal} [signal] */
export declare function managedFailureChunk(error: unknown, signal?: AbortLike): StreamChunk;
/**
 * Send one LCX-owned OpenAI Responses request. Ordinary and replay use one provider attempt;
 * the DSH agent recovery layer remains the visible retry owner.
 * @param {object} options
 * @param {string} options.baseURL
 * @param {string} options.provider
 * @param {string} options.model
 * @param {UnknownRecord} options.piModel
 * @param {UnknownRecord} options.body
 * @param {Map<string, string>} [options.grammarToolInputProperties]
 * @param {Record<string, string>} [options.headers]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxAttempts]
 * @param {number} [options.maxResponseBytes]
 * @param {ReadonlySet<string>} [options.serverToolTypes]
 * @param {(usage: ServerToolUsage) => void} [options.onServerToolUsage]
 */
export declare function streamResponsesRequest({ baseURL, provider, model, piModel, body, grammarToolInputProperties, headers, signal, timeoutMs, applyDefaultTimeout, streamIdleTimeoutMs, maxAttempts, maxResponseBytes, serverToolTypes, nativeReplayRoute, onServerToolUsage, }: StreamRequestOptions): AsyncGenerator<StreamChunk, void, unknown>;
export {};
