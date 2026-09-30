import type { ResponseInputItem } from "openai/resources/responses/responses.js";
import type { Context } from "@deepseek-ai/cordis";
import { Session, type SessionEvent } from "@deepseek-ai/dsh-session";
import { requestImageHandleText, type Message, type RequestMessage, type StreamChunk, type TokenUsage } from "@deepseek-ai/dsh-llm";
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
    ctx: SessionQueryContext;
    session: Session;
    route: RouteIdentity;
    result: NativeCompactionResult;
    input?: unknown[];
    ephemeralPreludeItemCount?: number;
    imageMap?: ReadonlyMap<string, ImageAttachmentRef>;
    retentionOptions?: RetentionOptions;
};
type SessionQueryContext = Pick<Context, "get">;
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
export declare function compactCheckpointId(message: RequestMessage | null | undefined): string | undefined;
/** Reject reserved checkpoint markers without interpreting unsupported formats or opening sidecars. */
export declare function assertSupportedCheckpointMessage(message: RequestMessage): void;
/** The active transaction is read from one immutable query observation. */
export declare function activeCompactionId(ctx: SessionQueryContext, session: Session | null | undefined): Promise<string | undefined>;
/**
 * @param {CreateCheckpointOptions} options
 * @returns {Promise<NativeCheckpointV5>}
 */
export declare function createNativeCheckpointBlock({ ctx, session, route, result, input, ephemeralPreludeItemCount, imageMap, retentionOptions, }: CreateCheckpointOptions): Promise<NativeCheckpointV5>;
/**
 * @param {NativeCheckpointBlock} block
 * @param {unknown} usage
 * @returns {UnknownRecord[]}
 */
export declare function nativeCheckpointChunks(block: NativeCheckpointBlock, usage: TokenUsage | undefined): StreamChunk[];
/**
 * @param {Session | null | undefined} session
 * @param {string | null | undefined} compactionId
 * @returns {Promise<CompactionSummaryEvent | undefined>}
 */
export declare function compactionSummaryEvent(ctx: SessionQueryContext, session: Session | null | undefined, compactionId: string | null | undefined): Promise<CompactionSummaryEvent | undefined>;
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
export declare function checkpointStateForMessage(ctx: SessionQueryContext, session: Session, message: Message): Promise<{
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
} | undefined> | undefined;
/**
 * @param {NativeCheckpointBlock} state
 * @param {RouteIdentity} route
 * @param {unknown} ctx
 */
export declare function stateRouteCompatible(state: CheckpointRouteRecord | null | undefined, route: RouteIdentity, ctx: unknown): boolean;
/**
 * @param {Session} session
 * @param {string} compactionId
 * @returns {Promise<Message[]>}
 */
export declare function shadowedMessagesForCheckpoint(ctx: SessionQueryContext, session: Session, compactionId: string): Promise<Message[]>;
/**
 * @param {Session} session
 * @param {string} compactionId
 * @param {{ maxChars?: number }} [options]
 * @returns {Promise<Message[]>}
 */
export declare function portableMessagesForCheckpoint(ctx: SessionQueryContext, session: Session, compactionId: string, options?: {
    maxChars?: number;
}): Promise<Message[]>;
export {};
