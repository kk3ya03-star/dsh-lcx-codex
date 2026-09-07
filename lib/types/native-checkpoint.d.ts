import type { ResponseInputItem } from "openai/resources/responses/responses.js";
import { Session, type SessionEvent } from "@deepseek-ai/dsh-session";
import { requestImageHandleText, type Message, type StreamChunk, type TokenUsage } from "@deepseek-ai/dsh-llm";
type CompactionItem = {
    type: "compaction";
    encrypted_content: string;
};
export type NativeOutputItem = ResponseInputItem;
type RouteIdentity = {
    provider: string;
    model: string;
    baseURL: string;
    sessionId: string;
};
type CompactionSummaryEvent = SessionEvent<"compaction/summary">;
type RetentionOptions = {
    tokenBudget?: number;
    assistantTokenReserve?: number;
    assistantPerMessageTokenCap?: number;
};
type RetentionPlan = {
    items: unknown[];
    clientCount: number;
    assistantCount: number;
    estimatedTokens: number;
    clientEstimatedTokens: number;
    assistantEstimatedTokens: number;
};
type NativeCheckpointBase = {
    compactionId: string;
    provider: string;
    model: string;
    baseURLFingerprint: string;
    sourceSessionId: string;
    nativeOutput: NativeOutputItem[];
    nativeCompaction?: CompactionItem;
    retainedInputCount?: number;
    retainedClientCount?: number;
    retainedAssistantCount?: number;
    retainedEstimatedTokens?: number;
    createdAt?: number;
};
export type NativeCheckpointV5 = NativeCheckpointBase & {
    type: "lcx-native-compaction-v5";
    version: 5;
    retentionPolicy?: "conversation-fidelity-v1";
};
export type NativeCheckpointBlock = NativeCheckpointV5;
declare module "@deepseek-ai/dsh-llm" {
    interface ContentBlockMap {
        "lcx-native-compaction-v5": NativeCheckpointV5;
    }
}
type NativeCompactionResult = {
    compaction: CompactionItem;
};
type ImageAttachmentRef = Parameters<typeof requestImageHandleText>[0];
type CheckpointRouteRecord = {
    version: number;
    provider: unknown;
    model: unknown;
    baseURLFingerprint: unknown;
    sourceSessionId: unknown;
};
type CreateCheckpointOptions = {
    session: Session;
    route: RouteIdentity;
    result: NativeCompactionResult;
    input?: unknown[];
    ephemeralPreludeItemCount?: number;
    imageMap?: ReadonlyMap<string, ImageAttachmentRef>;
    retentionOptions?: RetentionOptions;
};
/**
 * @typedef {object} NativeCheckpointBase
 * @property {string} compactionId
 * @property {string} provider
 * @property {string} model
 * @property {string} baseURLFingerprint
 * @property {string} sourceSessionId
 * @property {NativeOutputItem[]} nativeOutput
 * @property {CompactionItem} [nativeCompaction]
 * @property {number} [retainedInputCount]
 * @property {number} [retainedClientCount]
 * @property {number} [retainedAssistantCount]
 * @property {number} [retainedEstimatedTokens]
 * @property {number} [createdAt]
 */
/** @typedef {NativeCheckpointBase & { type: 'lcx-native-compaction-v5', version: 5, retentionPolicy?: 'conversation-fidelity-v1' }} NativeCheckpointV5 */
/** @typedef {NativeCheckpointV5} NativeCheckpointBlock */
/**
 * Minimal validated candidate shape. DSH rawOutput is unknown until the existing
 * version, field, count, and compaction validation below has completed.
 * @typedef {object} NativeCheckpointCandidate
 * @property {typeof NATIVE_BLOCK_TYPE} type
 * @property {typeof NATIVE_BLOCK_VERSION} version
 * @property {unknown} [compactionId]
 * @property {unknown} [nativeOutput]
 * @property {unknown} [provider]
 * @property {unknown} [model]
 * @property {unknown} [baseURLFingerprint]
 * @property {unknown} [sourceSessionId]
 * @property {unknown} [retainedInputCount]
 * @property {unknown} [retainedClientCount]
 * @property {unknown} [retainedAssistantCount]
 */
/** @typedef {{ compaction: CompactionItem }} NativeCompactionResult */
/** @typedef {{ session: Session, route: RouteIdentity, result: NativeCompactionResult, input?: unknown[], ephemeralPreludeItemCount?: number, imageMap?: unknown, retentionOptions?: RetentionOptions }} CreateCheckpointOptions */
/** @typedef {Error & { code?: string }} LcxError */
export declare const NATIVE_BLOCK_TYPE = "lcx-native-compaction-v5";
export declare const NATIVE_BLOCK_VERSION = 5;
export declare const RETAINED_MESSAGE_TOKEN_BUDGET = 64000;
export declare const ASSISTANT_RETENTION_TOKEN_RESERVE = 24000;
export declare const ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP = 3000;
/**
 * @param {unknown[] | null | undefined} input
 * @param {RetentionOptions} [options]
 * @returns {unknown[]}
 */
export declare function retainedCompactionInput(input: readonly unknown[] | null | undefined, options?: RetentionOptions): unknown[];
/**
 * @param {unknown[] | null | undefined} input
 * @param {RetentionOptions} [options]
 * @returns {RetentionPlan}
 */
export declare function retainedConversationPlan(input: readonly unknown[] | null | undefined, options?: RetentionOptions): RetentionPlan;
/**
 * @param {unknown[] | null | undefined} input
 * @param {RetentionOptions} [options]
 */
export declare function retainedConversationInput<T>(input: readonly T[] | null | undefined, options?: RetentionOptions): T[];
/** @param {unknown[] | null | undefined} items */
export declare function hasRetainedCompactionInput(items: readonly unknown[] | null | undefined): boolean;
export declare function compactCheckpointId(message: Message | null | undefined): string | undefined;
/** Reject reserved checkpoint markers without interpreting unsupported formats or opening sidecars. */
export declare function assertSupportedCheckpointMessage(message: Message): void;
/** @param {Session | null | undefined} session */
export declare function activeCompactionId(session: Session | null | undefined): string | undefined;
/**
 * @param {CreateCheckpointOptions} options
 * @returns {NativeCheckpointV5}
 */
export declare function createNativeCheckpointBlock({ session, route, result, input, ephemeralPreludeItemCount, imageMap, retentionOptions, }: CreateCheckpointOptions): NativeCheckpointV5;
/**
 * @param {NativeCheckpointBlock} block
 * @param {unknown} usage
 * @returns {UnknownRecord[]}
 */
export declare function nativeCheckpointChunks(block: NativeCheckpointBlock, usage: TokenUsage | undefined): StreamChunk[];
/**
 * @param {Session | null | undefined} session
 * @param {string | null | undefined} compactionId
 * @returns {CompactionSummaryEvent | undefined}
 */
export declare function compactionSummaryEvent(session: Session | null | undefined, compactionId: string | null | undefined): CompactionSummaryEvent | undefined;
/**
 * @param {CompactionSummaryEvent | null | undefined} event
 * @returns {NativeCheckpointBlock | undefined}
 */
export declare function stateFromSummaryEvent(event: CompactionSummaryEvent | null | undefined): {
    compactionId: string;
    provider: string;
    model: string;
    baseURLFingerprint: string;
    sourceSessionId: string;
    nativeOutput: NativeOutputItem[];
    nativeCompaction: CompactionItem;
    retainedInputCount?: number | undefined;
    retainedClientCount?: number | undefined;
    retainedAssistantCount?: number | undefined;
    type: string;
    version: number;
} | undefined;
/**
 * @param {Session} session
 * @param {Message} message
 */
export declare function checkpointStateForMessage(session: Session, message: Message): {
    compactionId: string;
    provider: string;
    model: string;
    baseURLFingerprint: string;
    sourceSessionId: string;
    nativeOutput: NativeOutputItem[];
    nativeCompaction: CompactionItem;
    retainedInputCount?: number | undefined;
    retainedClientCount?: number | undefined;
    retainedAssistantCount?: number | undefined;
    type: string;
    version: number;
} | undefined;
/**
 * @param {NativeCheckpointBlock} state
 * @param {RouteIdentity} route
 * @param {unknown} ctx
 */
export declare function stateRouteCompatible(state: CheckpointRouteRecord | null | undefined, route: RouteIdentity, ctx: unknown): boolean;
/**
 * @param {Session} session
 * @param {string} compactionId
 * @returns {Message[]}
 */
export declare function shadowedMessagesForCheckpoint(session: Session, compactionId: string): Message[];
/**
 * @param {Session} session
 * @param {string} compactionId
 * @param {{ maxChars?: number }} [options]
 * @returns {Message[]}
 */
export declare function portableMessagesForCheckpoint(session: Session, compactionId: string, options?: {
    maxChars?: number;
}): Message[];
export {};
