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
    /** Absolute `input` positions of items rendered from superseded DSH system prompt snapshots. */
    supersededItemIndices?: readonly number[];
    imageMap?: ReadonlyMap<string, ImageAttachmentRef>;
    retentionOptions?: RetentionOptions;
};
type SessionQueryContext = Pick<Context, "get">;
/**
 * Minimal validated candidate shape. DSH rawOutput is unknown until the existing
 * version, field, count, and compaction validation below has completed.
 */
export declare const NATIVE_BLOCK_TYPE = "lcx-native-compaction-v5";
export declare const NATIVE_BLOCK_VERSION = 5;
export declare const RETAINED_MESSAGE_TOKEN_BUDGET: number;
export declare const ASSISTANT_RETENTION_TOKEN_RESERVE: number;
export declare const ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP: number;
export declare function retainedConversationPlan(input: readonly unknown[] | null | undefined, options?: RetentionOptions): RetentionPlan;
export declare function compactCheckpointId(message: RequestMessage | null | undefined): string | undefined;
/** Reject reserved checkpoint markers without interpreting unsupported formats or opening sidecars. */
export declare function assertSupportedCheckpointMessage(message: RequestMessage): void;
/** The active transaction is read from one immutable query observation. */
export declare function activeCompactionId(ctx: SessionQueryContext, session: Session | null | undefined): Promise<string | undefined>;
export declare function createNativeCheckpointBlock({ ctx, session, route, result, input, ephemeralPreludeItemCount, supersededItemIndices, imageMap, retentionOptions, }: CreateCheckpointOptions): Promise<NativeCheckpointV5>;
export declare function nativeCheckpointChunks(block: NativeCheckpointBlock, usage: TokenUsage | undefined): StreamChunk[];
export declare function compactionSummaryEvent(ctx: SessionQueryContext, session: Session | null | undefined, compactionId: string | null | undefined): Promise<CompactionSummaryEvent | undefined>;
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
export declare function stateRouteCompatible(state: CheckpointRouteRecord | null | undefined, route: RouteIdentity, ctx: unknown): boolean;
export declare function shadowedMessagesForCheckpoint(ctx: SessionQueryContext, session: Session, compactionId: string): Promise<Message[]>;
/**
 * A shadowed `system/message` (source `system-prompt`) is a full system prompt snapshot DSH appended
 * when the prompt changed on an "in-history" route. Portable replay is only used when the checkpoint
 * cannot be replayed natively (fork, route or model migration), and the request that follows always
 * carries a head rendered with the current prompt, so every snapshot in the shadowed range is
 * superseded: replaying it, even as user text, would put stale instructions (for example plan-mode
 * policy that was switched off) back in front of the model.
 *
 * Only messages DSH itself marks as system-prompt snapshots are dropped. The head is never inside a
 * compaction range, and a Session V3 log (where later system messages were ordinary context) cannot
 * reach this path: LCX refuses V3 checkpoints before transport. Other system-role messages without that
 * source keep the previous ordinary-context mapping.
 */
export declare function withoutSupersededPromptSnapshots(messages: readonly Message[]): Message[];
export declare function portableMessagesForCheckpoint(ctx: SessionQueryContext, session: Session, compactionId: string, options?: {
    maxChars?: number;
}): Promise<Message[]>;
export {};
