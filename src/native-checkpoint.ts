import { isCompactCheckpointSource } from "@deepseek-ai/dsh-compaction";
import type { ResponseInputItem } from "openai/resources/responses/responses.js";
import type { Context } from "@deepseek-ai/cordis";
import {
  Session,
  SessionSeq,
  type SessionEvent,
} from "@deepseek-ai/dsh-session";
import {
  projectToolUpdates,
  requestImageHandleText,
  type ContentBlock,
  type Message,
  type RequestMessage,
  type StreamChunk,
  type TokenUsage,
} from "@deepseek-ai/dsh-llm";
import { baseURLFingerprint, routeCompatible } from "./route.js";
import { persistNativeImageReferences, responseInputItems } from "./dsh-responses.js";
import {
  estimateBudgetItem,
  modelVisibleBudgetView,
  portableBudgetError,
  portableTokenCeiling,
} from "./token-budget.js";
import { isRecord } from "./util.js";
import { DEFAULTS } from "./defaults.js";

type UnknownRecord = Record<string, unknown>;
type CompactionItem = { type: "compaction"; encrypted_content: string };
type RetainedClientItem = {
  type?: "message";
  role: "developer" | "user" | "system";
  content?: string | unknown[];
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
type IndexedItem = { item: unknown; index: number };
type SelectedItem = { index: number; item: unknown; tokens: number };
type Selection = { selected: SelectedItem[]; used: number };
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
type NativeCheckpointCandidate = {
  type: typeof NATIVE_BLOCK_TYPE;
  version: typeof NATIVE_BLOCK_VERSION;
  compactionId?: unknown;
  nativeOutput?: unknown;
  provider?: unknown;
  model?: unknown;
  baseURLFingerprint?: unknown;
  sourceSessionId?: unknown;
  retainedInputCount?: unknown;
  retainedClientCount?: unknown;
  retainedAssistantCount?: unknown;
};
type NativeCompactionResult = { compaction: CompactionItem };
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
type LcxError = Error & { code?: string };
type SessionQueryContext = Pick<Context, "get">;

function sessionQueryUnavailable(cause?: unknown): LcxError {
  return Object.assign(
    new Error("LCX checkpoint history requires the DSH session query service", { cause }),
    { code: "LCX_SESSION_QUERY_UNAVAILABLE" },
  );
}

async function observeEvents(ctx: SessionQueryContext, session: Session) {
  const query = ctx.get("sessionQuery");
  if (!query) throw sessionQueryUnavailable();
  try {
    return await query.observeSession(session.id, { projectionMode: "none" });
  } catch (cause) {
    throw sessionQueryUnavailable(cause);
  }
}
/**
 * Minimal validated candidate shape. DSH rawOutput is unknown until the existing
 * version, field, count, and compaction validation below has completed.
 */

export const NATIVE_BLOCK_TYPE = "lcx-native-compaction-v5";
const MIGRATED_NATIVE_BLOCK_PREFIX = "plugin:lcx-native-compaction-";
export const NATIVE_BLOCK_VERSION = 5;

export const RETAINED_MESSAGE_TOKEN_BUDGET = DEFAULTS.nativeRetentionTokenBudget;
export const ASSISTANT_RETENTION_TOKEN_RESERVE = DEFAULTS.assistantRetentionTokenReserve;
export const ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP = DEFAULTS.assistantRetentionPerMessageTokenCap;

function estimatedItemTokens(item: unknown) {
  return estimateBudgetItem(item);
}
function isRetainedClientItem(item: unknown): item is RetainedClientItem {
  if (!isRecord(item) || (item.type !== undefined && item.type !== "message"))
    return false;
  return (
    item.role === "user" || item.role === "developer" || item.role === "system"
  );
}
type RetainedAssistantPart = { type: "output_text"; text: string };

function assistantTextParts(item: unknown): RetainedAssistantPart[] {
  if (
    !isRecord(item) ||
    item.type !== "message" ||
    item.role !== "assistant" ||
    !Array.isArray(item.content)
  )
    return [];
  return item.content.filter(
    (part): part is RetainedAssistantPart =>
      isRecord(part) &&
      part.type === "output_text" &&
      typeof part.text === "string" &&
      part.text.length > 0,
  );
}
function isRetainedAssistantItem(item: unknown): boolean {
  return assistantTextParts(item).length > 0;
}
function assistantText(item: unknown): string {
  return assistantTextParts(item)
    .map((part) => part.text)
    .join("");
}
function retainedAssistantPhase(item: unknown): "commentary" | "final_answer" | undefined {
  const phase = isRecord(item) ? item.phase : undefined;
  return phase === "commentary" || phase === "final_answer" ? phase : undefined;
}
function containsBudgetImage(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsBudgetImage);
  if (!isRecord(value)) return false;
  return value.image === true || Object.values(value).some(containsBudgetImage);
}
function isImageBudgetItem(item: unknown) {
  return containsBudgetImage(modelVisibleBudgetView(item));
}

function truncateVisibleAssistantItem(
  item: unknown,
  maxTokens = ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP,
): UnknownRecord | undefined {
  const text = assistantText(item);
  if (!text) return undefined;
  const phase = retainedAssistantPhase(item);
  const providerId =
    isRecord(item) && typeof item.id === "string" && item.id
      ? item.id
      : undefined;
  const candidate = (retained: string, preserveProviderId: boolean) => ({
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: retained }],
    ...(phase ? { phase } : {}),
    ...(preserveProviderId && providerId ? { id: providerId } : {}),
  });
  const full = candidate(text, true);
  if ((estimatedItemTokens(full) ?? Infinity) <= maxTokens) return full;
  const marker = "\n…[LCX retained answer truncated]…\n";
  const shortened = (count: number) => {
    const available = Math.max(0, count - marker.length);
    const head = Math.floor(available * 0.72);
    const tail = available - head;
    return candidate(
      `${text.slice(0, head)}${marker}${text.slice(Math.max(head, text.length - tail))}`,
      false,
    );
  };
  let low = 0;
  let high = text.length;
  let best;
  while (low <= high) {
    const count = Math.floor((low + high) / 2);
    const next = shortened(count);
    if ((estimatedItemTokens(next) ?? Infinity) <= maxTokens) {
      best = next;
      low = count + 1;
    } else high = count - 1;
  }
  return best;
}

function selectNewest(
  candidates: readonly IndexedItem[],
  budget: number,
  transform: (value: IndexedItem) => unknown = (value) =>
    structuredClone(value.item),
  stopOnImageOverflow = false,
): Selection {
  const selected = [];
  let used = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    const item = transform(candidate);
    if (!item) continue;
    const tokens = estimatedItemTokens(item);
    if (tokens === undefined || tokens > budget || used + tokens > budget) {
      if (
        stopOnImageOverflow &&
        tokens !== undefined &&
        isImageBudgetItem(item)
      )
        break;
      continue;
    }
    selected.push({ index: candidate.index, item, tokens });
    used += tokens;
  }
  return { selected, used };
}

export function retainedConversationPlan(
  input: readonly unknown[] | null | undefined,
  options: RetentionOptions = {},
): RetentionPlan {
  const configuredBudget = options.tokenBudget;
  const totalBudget =
    typeof configuredBudget === "number" &&
    Number.isSafeInteger(configuredBudget) &&
    configuredBudget > 0
      ? configuredBudget
      : RETAINED_MESSAGE_TOKEN_BUDGET;
  const configuredReserve = options.assistantTokenReserve;
  const assistantReserve = Math.min(
    totalBudget,
    typeof configuredReserve === "number" &&
      Number.isSafeInteger(configuredReserve) &&
      configuredReserve >= 0
      ? configuredReserve
      : ASSISTANT_RETENTION_TOKEN_RESERVE,
  );
  const configuredPerMessageCap = options.assistantPerMessageTokenCap;
  const perMessageCap =
    typeof configuredPerMessageCap === "number" &&
    Number.isSafeInteger(configuredPerMessageCap) &&
    configuredPerMessageCap > 0
      ? configuredPerMessageCap
      : ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP;
  const indexed = (input ?? []).map((item, index) => ({ item, index }));
  const assistant = selectNewest(
    indexed.filter(({ item }) => isRetainedAssistantItem(item)),
    assistantReserve,
    ({ item }) => truncateVisibleAssistantItem(item, perMessageCap),
  );
  const remaining = Math.max(0, totalBudget - assistant.used);
  const client = selectNewest(
    indexed.filter(({ item }) => isRetainedClientItem(item)),
    remaining,
    undefined,
    true,
  );
  const selected = [...client.selected, ...assistant.selected].sort(
    (a, b) => a.index - b.index,
  );
  return {
    items: selected.map(({ item }) => item),
    clientCount: client.selected.length,
    assistantCount: assistant.selected.length,
    estimatedTokens: client.used + assistant.used,
    clientEstimatedTokens: client.used,
    assistantEstimatedTokens: assistant.used,
  };
}
function hasCompactionId(
  source: Message["source"],
): source is Message["source"] & { compactionId: string } {
  return (
    isCompactCheckpointSource(source) &&
    "compactionId" in source &&
    typeof source.compactionId === "string" &&
    source.compactionId.length > 0
  );
}

export function compactCheckpointId(
  message: RequestMessage | null | undefined,
): string | undefined {
  const source = message?.source;
  return source && hasCompactionId(source) ? source.compactionId : undefined;
}
/** Reject reserved checkpoint markers without interpreting unsupported formats or opening sidecars. */
export function assertSupportedCheckpointMessage(message: RequestMessage): void {
  // Legacy marker-only messages had no DSH checkpoint source. A marker quoted
  // inside ordinary content (for example a tool's source-file excerpt) is data.
  const legacyMarkerOnly = message.role === "user" && message.content.length === 1 &&
    message.content[0]?.type === "text" &&
    /^\[dsh-lcx-codex-[^\]\r\n]*checkpoint:[^\]\r\n]*\]$/iu.test(message.content[0].text.trim());
  for (const block of message.content) {
    if (
      (block.type.startsWith("lcx-native-compaction-") && block.type !== NATIVE_BLOCK_TYPE) ||
      block.type.startsWith(MIGRATED_NATIVE_BLOCK_PREFIX) ||
      block.type === "text" && (legacyMarkerOnly ||
        compactCheckpointId(message) !== undefined && /\[dsh-lcx-codex-[^\]\r\n]*checkpoint:/iu.test(block.text))
    ) throw Object.assign(new Error("Unsupported LCX checkpoint format; start a new session"), {
      code: "LCX_CHECKPOINT_UNSUPPORTED",
    });
  }
}
/** The active transaction is read from one immutable query observation. */
export async function activeCompactionId(ctx: SessionQueryContext, session: Session | null | undefined) {
  if (!session) return undefined;
  const ended = new Set();
  const lease = await observeEvents(ctx, session);
  try {
    const events = lease.events;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!event) continue;
      if (event.type === "compaction/end") ended.add(String(event.data.compactionId));
      if (
        event.type === "compaction/start" &&
        !ended.has(String(event.data.compactionId))
      )
        return String(event.data.compactionId);
    }
    return undefined;
  } finally {
    lease[Symbol.dispose]();
  }
}

/**
 * On "in-history" routes DSH records every system prompt change as a full later `system` message
 * (source `system-prompt`). A checkpoint begins a new DSH series whose head is re-rendered with the
 * CURRENT prompt, so those snapshots in the retained window are superseded by that head. Retaining
 * one, as developer/system or even as user text, would keep a stale full prompt (for example plan-mode
 * policy that has since been switched off) in front of the model after the compaction.
 *
 * Only items the serializer traced back to such snapshots (`supersededItemIndices`, absolute positions
 * in `input`) are removed. Any other retained developer/system item is genuine client context and
 * stays. The ephemeral prelude is removed by the caller's slice, and the retention budget is computed
 * over what is actually kept.
 */
function dropSupersededItems(
  input: readonly unknown[],
  preludeCount: number,
  superseded: readonly number[],
): unknown[] {
  const drop = new Set<number>();
  for (const position of superseded) {
    if (!Number.isSafeInteger(position) || position < preludeCount || position >= input.length)
      throw Object.assign(
        new Error("Native compaction superseded-item provenance is invalid"),
        { code: "LCX_COMPACTION_PRELUDE_PROVENANCE_INVALID" },
      );
    drop.add(position);
  }
  return input.slice(preludeCount).filter((_, offset) => !drop.has(preludeCount + offset));
}

export async function createNativeCheckpointBlock({
  ctx,
  session,
  route,
  result,
  input = [],
  ephemeralPreludeItemCount = 0,
  supersededItemIndices = [],
  imageMap,
  retentionOptions = {},
}: CreateCheckpointOptions): Promise<NativeCheckpointV5> {
  const compactionId = await activeCompactionId(ctx, session);
  if (!compactionId) {
    const error: LcxError = new Error(
      "Native compaction could not correlate the active DSH compaction transaction",
    );
    error.code = "LCX_COMPACTION_ID_UNAVAILABLE";
    throw error;
  }
  if (
    !Number.isSafeInteger(ephemeralPreludeItemCount) ||
    ephemeralPreludeItemCount < 0 ||
    ephemeralPreludeItemCount > input.length
  ) {
    throw Object.assign(
      new Error("Native compaction prelude provenance is invalid"),
      { code: "LCX_COMPACTION_PRELUDE_PROVENANCE_INVALID" },
    );
  }
  const retention = retainedConversationPlan(
    dropSupersededItems(input, ephemeralPreludeItemCount, supersededItemIndices),
    retentionOptions,
  );
  const nativeOutput = persistNativeImageReferences(
    [...retention.items, structuredClone(result.compaction)],
    imageMap ?? new Map<string, ImageAttachmentRef>(),
  ) as NativeOutputItem[];
  return {
    type: NATIVE_BLOCK_TYPE,
    version: NATIVE_BLOCK_VERSION,
    retentionPolicy: "conversation-fidelity-v1",
    compactionId,
    provider: route.provider,
    model: route.model,
    baseURLFingerprint: baseURLFingerprint(route.baseURL),
    sourceSessionId: route.sessionId,
    nativeOutput,
    nativeCompaction: structuredClone(result.compaction),
    retainedInputCount: retention.items.length,
    retainedClientCount: retention.clientCount,
    retainedAssistantCount: retention.assistantCount,
    retainedEstimatedTokens: retention.estimatedTokens,
    createdAt: Date.now(),
  };
}

export function nativeCheckpointChunks(
  block: NativeCheckpointBlock,
  usage: TokenUsage | undefined,
): StreamChunk[] {
  const text = "LCX Native V2 checkpoint saved in the DSH session log.";
  return [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text },
    { type: "block-end", index: 0, block: { type: "text", text } },
    { type: "block-start", index: 1, blockType: block.type },
    { type: "block-end", index: 1, block: structuredClone(block) },
    ...(usage === undefined ? [] : [{ type: "usage" as const, usage }]),
    { type: "finish", reason: { kind: "stop" } },
  ];
}

export async function compactionSummaryEvent(
  ctx: SessionQueryContext,
  session: Session | null | undefined,
  compactionId: string | null | undefined,
): Promise<CompactionSummaryEvent | undefined> {
  if (!session || !compactionId) return undefined;
  const lease = await observeEvents(ctx, session);
  try {
    const events = lease.events;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (
        event?.type === "compaction/summary" &&
        String(event.data.compactionId) === compactionId
      )
        return event;
    }
    return undefined;
  } finally {
    lease[Symbol.dispose]();
  }
}
/**
 * rawOutput elements remain untrusted until stateFromSummaryEvent validates them.
 */
function isNativeCheckpointCandidate(
  value: unknown,
): value is NativeCheckpointCandidate {
  if (!isRecord(value)) return false;
  return (
    value.type === NATIVE_BLOCK_TYPE && value.version === NATIVE_BLOCK_VERSION
  );
}

function nativeBlockFromSummary(
  event: CompactionSummaryEvent | null | undefined,
): NativeCheckpointCandidate | undefined {
  const raw = event?.data.rawOutput;
  if (!raw) return undefined;
  assertNoMigratedNativeBlock(raw);
  for (const value of raw) {
    if (isNativeCheckpointCandidate(value)) return value;
  }
  return undefined;
}
function assertNoMigratedNativeBlock(raw: readonly unknown[] | undefined): void {
  if (raw?.some(value => isRecord(value) && typeof value.type === "string" &&
    value.type.startsWith(MIGRATED_NATIVE_BLOCK_PREFIX)))
    throw Object.assign(new Error("Unsupported LCX checkpoint format; start a new session"), {
      code: "LCX_CHECKPOINT_UNSUPPORTED",
    });
}
function validateCount(value: unknown): value is number | undefined {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  );
}
export function stateFromSummaryEvent(
  event: CompactionSummaryEvent | null | undefined,
) {
  if (!event) return undefined;
  const block = nativeBlockFromSummary(event);
  if (!block) return undefined;
  if (
    block.compactionId !== event.data.compactionId ||
    !Array.isArray(block.nativeOutput) ||
    block.nativeOutput.length === 0
  )
    return undefined;
  if (
    typeof block.provider !== "string" ||
    typeof block.model !== "string" ||
    typeof block.baseURLFingerprint !== "string" ||
    typeof block.sourceSessionId !== "string"
  )
    return undefined;
  if (
    !validateCount(block.retainedInputCount) ||
    !validateCount(block.retainedClientCount) ||
    !validateCount(block.retainedAssistantCount)
  )
    return undefined;
  try {
    responseInputItems(block.nativeOutput);
  } catch {
    return undefined;
  }
  const compactions = block.nativeOutput.filter(
    (item): item is CompactionItem =>
      isRecord(item) &&
      item.type === "compaction" &&
      typeof item.encrypted_content === "string",
  );
  if (compactions.length !== 1 || compactions[0].encrypted_content.trim().length === 0) return undefined;
  const compactionIndex = block.nativeOutput.findIndex(
    (item) => isRecord(item) && item.type === "compaction",
  );
  const prefix =
    compactionIndex >= 0 ? block.nativeOutput.slice(0, compactionIndex) : [];
  {
    const clients = prefix.filter(isRetainedClientItem).length;
    const assistants = prefix.filter(isRetainedAssistantItem).length;
    const total = clients + assistants;
    if (
      block.retainedInputCount !== undefined &&
      block.retainedInputCount !== total
    )
      return undefined;
    if (
      block.retainedClientCount !== undefined &&
      block.retainedClientCount !== clients
    )
      return undefined;
    if (
      block.retainedAssistantCount !== undefined &&
      block.retainedAssistantCount !== assistants
    )
      return undefined;
  }
  const nativeCompaction = compactions[0];
  if (!nativeCompaction) return undefined;
  const base = {
    compactionId: String(block.compactionId),
    provider: block.provider,
    model: block.model,
    baseURLFingerprint: block.baseURLFingerprint,
    sourceSessionId: block.sourceSessionId,
    nativeOutput: structuredClone(block.nativeOutput) as NativeOutputItem[],
    nativeCompaction: structuredClone(nativeCompaction),
    ...(block.retainedInputCount === undefined
      ? {}
      : { retainedInputCount: block.retainedInputCount }),
    ...(block.retainedClientCount === undefined
      ? {}
      : { retainedClientCount: block.retainedClientCount }),
    ...(block.retainedAssistantCount === undefined
      ? {}
      : { retainedAssistantCount: block.retainedAssistantCount }),
  };
  return { ...base, type: NATIVE_BLOCK_TYPE, version: NATIVE_BLOCK_VERSION };
}
export function checkpointStateForMessage(ctx: SessionQueryContext, session: Session, message: Message) {
  assertSupportedCheckpointMessage(message);
  const id = compactCheckpointId(message);
  if (!id) return undefined;
  return checkpointStateForMessageAsync(ctx, session, id);
}

async function checkpointStateForMessageAsync(ctx: SessionQueryContext, session: Session, id: string) {
  const event = await compactionSummaryEvent(ctx, session, id);
  const state = stateFromSummaryEvent(event);
  const hasNativeBlock = event?.data.rawOutput?.some(value =>
    isRecord(value) && typeof value.type === "string" &&
      (value.type.startsWith("lcx-native-compaction-") || value.type.startsWith(MIGRATED_NATIVE_BLOCK_PREFIX)),
  );
  if (hasNativeBlock && !state) throw Object.assign(
    new Error("Unsupported or invalid LCX checkpoint; start a new session"),
    { code: "LCX_CHECKPOINT_UNSUPPORTED" },
  );
  return state;
}
export function stateRouteCompatible(
  state: CheckpointRouteRecord | null | undefined,
  route: RouteIdentity,
  ctx: unknown,
) {
  return routeCompatible(state, route, ctx);
}
const DSH_PROJECTION_UNAVAILABLE_PREFIX = 'session message projection "';
const DSH_PROJECTION_UNAVAILABLE_SUFFIX =
  '" was removed or replaced; restore the session with its owning plugin';

/**
 * DSH 0.1.6 attaches no error code or subclass to this failure and exposes no
 * public inventory of required or active projections, so message shape is the
 * only available signal. Both classes fail closed, so a misclassification
 * costs precision in the error code, not correctness.
 */
function isMissingOrReplacedProjectionError(cause: unknown): cause is Error {
  if (!(cause instanceof Error)) return false;
  const { message } = cause;
  if (
    !message.startsWith(DSH_PROJECTION_UNAVAILABLE_PREFIX) ||
    !message.endsWith(DSH_PROJECTION_UNAVAILABLE_SUFFIX)
  )
    return false;
  const projectionType = message.slice(
    DSH_PROJECTION_UNAVAILABLE_PREFIX.length,
    message.length - DSH_PROJECTION_UNAVAILABLE_SUFFIX.length,
  );
  return projectionType.length > 0;
}

function checkpointHistoryReadError(cause: unknown) {
  return Object.assign(
    new Error("Unsupported or invalid LCX checkpoint history; start a new session", {
      cause,
    }),
    { code: "LCX_CHECKPOINT_UNSUPPORTED" },
  );
}

/**
 * DSH 0.1.6 derives a message only while every `SessionMessageProjection` the
 * durable log committed is still registered; an absent or replaced owner throws
 * instead of yielding pre-projection content. Reconstructing the shadowed
 * transcript without that owner would resurrect content a durable decision
 * (for example `image/offload`) removed, so this is a checkpoint
 * incompatibility rather than a recoverable read.
 */
function eventMessage(session: Session, events: readonly SessionEvent[], seq: number) {
  if (!Number.isSafeInteger(seq) || seq < 0)
    throw checkpointHistoryReadError(
      new Error("Portable checkpoint history contains an invalid event sequence"),
    );
  try {
    const event = events[seq];
    if (!event)
      throw new Error(`Portable checkpoint history is missing event at seq ${seq}`);
    return session.deriveEventMessage(event) ?? undefined;
  } catch (cause) {
    if (isMissingOrReplacedProjectionError(cause))
      throw Object.assign(
        new Error(
          "Session history requires a message projection this runtime does not provide; restore the owning plugin to reuse this checkpoint",
          { cause },
        ),
        { code: "LCX_CHECKPOINT_PROJECTION_UNAVAILABLE" },
      );
    throw checkpointHistoryReadError(cause);
  }
}
function estimateChars(message: Message) {
  try {
    const encoded = JSON.stringify(message);
    return typeof encoded === "string" ? encoded.length : undefined;
  } catch {
    return undefined;
  }
}
async function expandedCheckpointMessages(
  ctx: SessionQueryContext,
  session: Session,
  compactionId: string,
): Promise<Message[]> {
  const lease = await observeEvents(ctx, session);
  try {
    const events = lease.events;
    const summaries = new Map<string, CompactionSummaryEvent>();
    for (const event of events)
      if (event.type === "compaction/summary") summaries.set(String(event.data.compactionId), event);
    const active = new Set<string>();
    const stack: { id: string; seqs: readonly SessionSeq[]; index: number }[] = [];
    const enter = (id: string) => {
      const summary = summaries.get(id);
      if (active.has(id) || !summary)
        throw Object.assign(new Error("Portable checkpoint history is cyclic or incomplete"), { code: "LCX_CHECKPOINT_UNSUPPORTED" });
      assertNoMigratedNativeBlock(summary.data.rawOutput);
      active.add(id);
      stack.push({ id, seqs: summary.data.shadowedSeqs, index: 0 });
    };
    // Walk the DSH event graph iteratively so repeated compaction has no depth cutoff.
    const result: Message[] = [];
    enter(compactionId);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.index === frame.seqs.length) {
        active.delete(frame.id);
        stack.pop();
        continue;
      }
      const message = eventMessage(session, events, frame.seqs[frame.index++]);
      if (!message) continue;
      assertSupportedCheckpointMessage(message);
      const nested = compactCheckpointId(message);
      if (nested) enter(nested);
      else result.push(structuredClone(message));
    }
    // Same projection DSH applies for routes without toolUpdate (Decision 6).
    return projectToolUpdates(result, undefined, undefined, undefined).messages as Message[];
  } finally {
    lease[Symbol.dispose]();
  }
}
export async function shadowedMessagesForCheckpoint(
  ctx: SessionQueryContext,
  session: Session,
  compactionId: string,
) {
  return expandedCheckpointMessages(ctx, session, compactionId);
}
function groupMessages(messages: readonly Message[]): Message[][] {
  const groups = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const toolCalls =
      message.role === "assistant"
        ? message.content
            .filter(
              (block): block is Extract<ContentBlock, { type: "tool-call" }> =>
                block.type === "tool-call",
            )
            .map((block) => String(block.id))
        : [];
    if (toolCalls.length === 0) {
      // A tool result no call can claim (its call was not directly in front of it) cannot be replayed:
      // upstream refuses a function_call_output without its call. Results that belong to a call are
      // consumed with that call's group below and never reach this branch.
      if (message.role === "tool") continue;
      groups.push([message]);
      continue;
    }
    const group = [message];
    const pending = new Set(toolCalls);
    let cursor = index + 1;
    // The run of tool messages right behind the call belongs to this group. Only the first result of
    // each call it issued joins the group; a result for any other call, or a repeat, is not replayable
    // (upstream refuses a function_call_output without its call) and is dropped. The whole run is
    // consumed either way, so nothing in it is read again as a group of its own.
    while (cursor < messages.length) {
      const next = messages[cursor];
      if (!next || next.role !== "tool") break;
      const id = String(next.toolCallId);
      if (pending.delete(id)) group.push(next);
      cursor += 1;
    }
    index = cursor - 1;
    groups.push(group);
  }
  return groups;
}
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
export function withoutSupersededPromptSnapshots(messages: readonly Message[]): Message[] {
  return messages.filter(
    (message) => !(message.role === "system" && message.source?.kind === "system-prompt"),
  );
}
export async function portableMessagesForCheckpoint(
  ctx: SessionQueryContext,
  session: Session,
  compactionId: string,
  options: { maxChars?: number } = {},
): Promise<Message[]> {
  const configuredMaxChars = options.maxChars;
  const maxChars =
    typeof configuredMaxChars === "number" &&
    Number.isSafeInteger(configuredMaxChars) &&
    configuredMaxChars > 0
      ? configuredMaxChars
      : DEFAULTS.portableReplayMaxChars;
  const maxTokens = portableTokenCeiling(maxChars) ?? 1;
  // Superseded prompt snapshots are removed before grouping so they never consume the replay budget.
  const expanded = withoutSupersededPromptSnapshots(
    await shadowedMessagesForCheckpoint(ctx, session, compactionId),
  );
  if (expanded.length === 0) return [];
  const groups = groupMessages(expanded);
  const kept = [];
  let chars = 0;
  let tokens = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    let groupChars = 0;
    let groupTokens = 0;
    let budgetable = true;
    for (const message of group) {
      const messageChars = estimateChars(message);
      const messageTokens = estimatedItemTokens(message);
      if (messageChars === undefined || messageTokens === undefined) {
        budgetable = false;
        break;
      }
      groupChars += messageChars;
      groupTokens += messageTokens;
    }
    const exceeds =
      !budgetable ||
      chars + groupChars > maxChars ||
      tokens + groupTokens > maxTokens;
    if (exceeds) {
      if (kept.length === 0)
        throw portableBudgetError(
          "Portable checkpoint newest message group exceeds the configured budget",
        );
      break;
    }
    kept.unshift(...group);
    chars += groupChars;
    tokens += groupTokens;
  }
  return kept;
}
