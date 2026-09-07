// @ts-check
import { isCompactCheckpointSource } from "@deepseek-ai/dsh-compaction";
import { SessionSeq, } from "@deepseek-ai/dsh-session";
import { baseURLFingerprint, routeCompatible } from "./route.js";
import { persistNativeImageReferences, responseInputItems } from "./dsh-responses.js";
import { estimateBudgetItem, modelVisibleBudgetView, portableBudgetError, portableTokenCeiling, } from "./token-budget.js";
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
export const NATIVE_BLOCK_TYPE = "lcx-native-compaction-v5";
export const NATIVE_BLOCK_VERSION = 5;
export const RETAINED_MESSAGE_TOKEN_BUDGET = 64_000;
export const ASSISTANT_RETENTION_TOKEN_RESERVE = 24_000;
export const ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP = 3_000;
/**
 * @param {unknown} value
 * @returns {value is UnknownRecord}
 */
function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** @param {Message | null | undefined} message */
function textOf(message) {
    return (message?.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
}
/** @param {unknown} item */
function estimatedItemTokens(item) {
    return estimateBudgetItem(item);
}
/**
 * @param {unknown} item
 * @returns {item is UnknownRecord}
 */
function isRetainedClientItem(item) {
    if (!isObject(item) || (item.type !== undefined && item.type !== "message"))
        return false;
    return (item.role === "user" || item.role === "developer" || item.role === "system");
}
function assistantTextParts(item) {
    if (!isObject(item) ||
        item.type !== "message" ||
        item.role !== "assistant" ||
        !Array.isArray(item.content))
        return [];
    return item.content.filter((part) => isObject(part) &&
        part.type === "output_text" &&
        typeof part.text === "string" &&
        part.text.length > 0);
}
/** @param {unknown} item */
function isRetainedAssistantItem(item) {
    return assistantTextParts(item).length > 0;
}
/** @param {unknown} item */
function assistantText(item) {
    return assistantTextParts(item)
        .map((part) => part.text)
        .join("");
}
/** @param {unknown} item */
function retainedAssistantPhase(item) {
    const phase = isObject(item) ? item.phase : undefined;
    return phase === "commentary" || phase === "final_answer" ? phase : undefined;
}
/** @param {unknown} value */
function containsBudgetImage(value) {
    if (Array.isArray(value))
        return value.some(containsBudgetImage);
    if (!isObject(value))
        return false;
    return value.image === true || Object.values(value).some(containsBudgetImage);
}
/** @param {unknown} item */
function isImageBudgetItem(item) {
    return containsBudgetImage(modelVisibleBudgetView(item));
}
/**
 * @param {unknown} item
 * @param {number} [maxTokens]
 * @returns {UnknownRecord | undefined}
 */
function truncateVisibleAssistantItem(item, maxTokens = ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP) {
    const text = assistantText(item);
    if (!text)
        return undefined;
    const phase = retainedAssistantPhase(item);
    const providerId = isObject(item) && typeof item.id === "string" && item.id
        ? item.id
        : undefined;
    /** @param {string} retained @param {boolean} preserveProviderId */
    const candidate = (retained, preserveProviderId) => ({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: retained }],
        ...(phase ? { phase } : {}),
        ...(preserveProviderId && providerId ? { id: providerId } : {}),
    });
    const full = candidate(text, true);
    if ((estimatedItemTokens(full) ?? Infinity) <= maxTokens)
        return full;
    const marker = "\n…[LCX retained answer truncated]…\n";
    /** @param {number} count */
    const shortened = (count) => {
        const available = Math.max(0, count - marker.length);
        const head = Math.floor(available * 0.72);
        const tail = available - head;
        return candidate(`${text.slice(0, head)}${marker}${text.slice(Math.max(head, text.length - tail))}`, false);
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
        }
        else
            high = count - 1;
    }
    return best;
}
/**
 * @param {IndexedItem[]} candidates
 * @param {number} budget
 * @param {(value: IndexedItem) => unknown} [transform]
 * @param {boolean} [stopOnImageOverflow]
 * @returns {Selection}
 */
function selectNewest(candidates, budget, transform = (value) => structuredClone(value.item), stopOnImageOverflow = false) {
    /** @type {SelectedItem[]} */
    const selected = [];
    let used = 0;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index];
        const item = transform(candidate);
        if (!item)
            continue;
        const tokens = estimatedItemTokens(item);
        if (tokens === undefined || tokens > budget || used + tokens > budget) {
            if (stopOnImageOverflow &&
                tokens !== undefined &&
                isImageBudgetItem(item))
                break;
            continue;
        }
        selected.push({ index: candidate.index, item, tokens });
        used += tokens;
    }
    return { selected, used };
}
/**
 * @param {unknown[] | null | undefined} input
 * @param {RetentionOptions} [options]
 * @returns {unknown[]}
 */
export function retainedCompactionInput(input, options = {}) {
    const configuredBudget = options.tokenBudget;
    const budget = typeof configuredBudget === "number" &&
        Number.isSafeInteger(configuredBudget) &&
        configuredBudget > 0
        ? configuredBudget
        : RETAINED_MESSAGE_TOKEN_BUDGET;
    const candidates = (input ?? [])
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => isRetainedClientItem(item));
    return selectNewest(candidates, budget)
        .selected.sort((a, b) => a.index - b.index)
        .map(({ item }) => item);
}
/**
 * @param {unknown[] | null | undefined} input
 * @param {RetentionOptions} [options]
 * @returns {RetentionPlan}
 */
export function retainedConversationPlan(input, options = {}) {
    const configuredBudget = options.tokenBudget;
    const totalBudget = typeof configuredBudget === "number" &&
        Number.isSafeInteger(configuredBudget) &&
        configuredBudget > 0
        ? configuredBudget
        : RETAINED_MESSAGE_TOKEN_BUDGET;
    const configuredReserve = options.assistantTokenReserve;
    const assistantReserve = Math.min(totalBudget, typeof configuredReserve === "number" &&
        Number.isSafeInteger(configuredReserve) &&
        configuredReserve >= 0
        ? configuredReserve
        : ASSISTANT_RETENTION_TOKEN_RESERVE);
    const configuredPerMessageCap = options.assistantPerMessageTokenCap;
    const perMessageCap = typeof configuredPerMessageCap === "number" &&
        Number.isSafeInteger(configuredPerMessageCap) &&
        configuredPerMessageCap > 0
        ? configuredPerMessageCap
        : ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP;
    const indexed = (input ?? []).map((item, index) => ({ item, index }));
    const assistant = selectNewest(indexed.filter(({ item }) => isRetainedAssistantItem(item)), assistantReserve, ({ item }) => truncateVisibleAssistantItem(item, perMessageCap));
    const remaining = Math.max(0, totalBudget - assistant.used);
    const client = selectNewest(indexed.filter(({ item }) => isRetainedClientItem(item)), remaining, undefined, true);
    const selected = [...client.selected, ...assistant.selected].sort((a, b) => a.index - b.index);
    return {
        items: selected.map(({ item }) => item),
        clientCount: client.selected.length,
        assistantCount: assistant.selected.length,
        estimatedTokens: client.used + assistant.used,
        clientEstimatedTokens: client.used,
        assistantEstimatedTokens: assistant.used,
    };
}
/**
 * @param {unknown[] | null | undefined} input
 * @param {RetentionOptions} [options]
 */
export function retainedConversationInput(input, options = {}) {
    return retainedConversationPlan(input, options).items;
}
/** @param {unknown[] | null | undefined} items */
export function hasRetainedCompactionInput(items) {
    return (items ?? []).some((item) => isRetainedClientItem(item) || isRetainedAssistantItem(item));
}
/** @param {Message | null | undefined} message */
function hasCompactionId(source) {
    return (isCompactCheckpointSource(source) &&
        "compactionId" in source &&
        typeof source.compactionId === "string" &&
        source.compactionId.length > 0);
}
export function compactCheckpointId(message) {
    const source = message?.source;
    return source && hasCompactionId(source) ? source.compactionId : undefined;
}
/** Reject reserved checkpoint markers without interpreting unsupported formats or opening sidecars. */
export function assertSupportedCheckpointMessage(message) {
    for (const block of message.content) {
        if (block.type.startsWith("lcx-native-compaction-") && block.type !== NATIVE_BLOCK_TYPE ||
            block.type === "text" && /\[dsh-lcx-codex-[^\]\r\n]*checkpoint:/iu.test(block.text))
            throw Object.assign(new Error("Unsupported LCX checkpoint format; start a new session"), {
                code: "LCX_CHECKPOINT_UNSUPPORTED",
            });
    }
}
/** @param {Session | null | undefined} session */
export function activeCompactionId(session) {
    if (!session)
        return undefined;
    /** @type {Set<string>} */ const ended = new Set();
    const events = session.snapshotEvents();
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (!event)
            continue;
        if (event.type === "compaction/end")
            ended.add(String(event.data.compactionId));
        if (event.type === "compaction/start" &&
            !ended.has(String(event.data.compactionId)))
            return String(event.data.compactionId);
    }
    return undefined;
}
/**
 * @param {CreateCheckpointOptions} options
 * @returns {NativeCheckpointV5}
 */
export function createNativeCheckpointBlock({ session, route, result, input = [], ephemeralPreludeItemCount = 0, imageMap, retentionOptions = {}, }) {
    const compactionId = activeCompactionId(session);
    if (!compactionId) {
        const error = new Error("Native compaction could not correlate the active DSH compaction transaction");
        error.code = "LCX_COMPACTION_ID_UNAVAILABLE";
        throw error;
    }
    if (!Number.isSafeInteger(ephemeralPreludeItemCount) ||
        ephemeralPreludeItemCount < 0 ||
        ephemeralPreludeItemCount > input.length) {
        throw Object.assign(new Error("Native compaction prelude provenance is invalid"), { code: "LCX_COMPACTION_PRELUDE_PROVENANCE_INVALID" });
    }
    const retention = retainedConversationPlan(input.slice(ephemeralPreludeItemCount), retentionOptions);
    /** @type {NativeOutputItem[]} */
    const nativeOutput = persistNativeImageReferences([...retention.items, structuredClone(result.compaction)], imageMap ?? new Map());
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
/**
 * @param {NativeCheckpointBlock} block
 * @param {unknown} usage
 * @returns {UnknownRecord[]}
 */
export function nativeCheckpointChunks(block, usage) {
    const text = "LCX Native V2 checkpoint saved in the DSH session log.";
    return [
        { type: "block-start", index: 0, blockType: "text" },
        { type: "text-delta", index: 0, text },
        { type: "block-end", index: 0, block: { type: "text", text } },
        { type: "block-start", index: 1, blockType: block.type },
        { type: "block-end", index: 1, block: structuredClone(block) },
        ...(usage === undefined ? [] : [{ type: "usage", usage }]),
        { type: "finish", reason: { kind: "stop" } },
    ];
}
/**
 * @param {Session | null | undefined} session
 * @param {string | null | undefined} compactionId
 * @returns {CompactionSummaryEvent | undefined}
 */
export function compactionSummaryEvent(session, compactionId) {
    if (!session || !compactionId)
        return undefined;
    const events = session.snapshotEvents();
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type === "compaction/summary" &&
            String(event.data.compactionId) === compactionId)
            return event;
    }
    return undefined;
}
/**
 * rawOutput elements remain untrusted until stateFromSummaryEvent validates them.
 * @param {CompactionSummaryEvent | null | undefined} event
 * @returns {NativeCheckpointCandidate | undefined}
 */
function isNativeCheckpointCandidate(value) {
    if (!isObject(value))
        return false;
    return (value.type === NATIVE_BLOCK_TYPE && value.version === NATIVE_BLOCK_VERSION);
}
function nativeBlockFromSummary(event) {
    const raw = event?.data.rawOutput;
    if (!raw)
        return undefined;
    for (const value of raw)
        if (isNativeCheckpointCandidate(value))
            return value;
    return undefined;
}
/** @param {unknown} value */
function validateCount(value) {
    return (value === undefined ||
        (typeof value === "number" && Number.isSafeInteger(value) && value >= 0));
}
/**
 * @param {CompactionSummaryEvent | null | undefined} event
 * @returns {NativeCheckpointBlock | undefined}
 */
export function stateFromSummaryEvent(event) {
    if (!event)
        return undefined;
    const block = nativeBlockFromSummary(event);
    if (!block)
        return undefined;
    if (block.compactionId !== event.data.compactionId ||
        !Array.isArray(block.nativeOutput) ||
        block.nativeOutput.length === 0)
        return undefined;
    if (typeof block.provider !== "string" ||
        typeof block.model !== "string" ||
        typeof block.baseURLFingerprint !== "string" ||
        typeof block.sourceSessionId !== "string")
        return undefined;
    if (!validateCount(block.retainedInputCount) ||
        !validateCount(block.retainedClientCount) ||
        !validateCount(block.retainedAssistantCount))
        return undefined;
    try {
        responseInputItems(block.nativeOutput);
    }
    catch {
        return undefined;
    }
    const compactions = block.nativeOutput.filter((item) => isObject(item) &&
        item.type === "compaction" &&
        typeof item.encrypted_content === "string");
    if (compactions.length !== 1 || compactions[0].encrypted_content.trim().length === 0)
        return undefined;
    const compactionIndex = block.nativeOutput.findIndex((item) => isObject(item) && item.type === "compaction");
    const prefix = compactionIndex >= 0 ? block.nativeOutput.slice(0, compactionIndex) : [];
    {
        const clients = prefix.filter(isRetainedClientItem).length;
        const assistants = prefix.filter(isRetainedAssistantItem).length;
        const total = clients + assistants;
        if (block.retainedInputCount !== undefined &&
            block.retainedInputCount !== total)
            return undefined;
        if (block.retainedClientCount !== undefined &&
            block.retainedClientCount !== clients)
            return undefined;
        if (block.retainedAssistantCount !== undefined &&
            block.retainedAssistantCount !== assistants)
            return undefined;
    }
    const nativeCompaction = compactions[0];
    if (!nativeCompaction)
        return undefined;
    const base = {
        compactionId: String(block.compactionId),
        provider: block.provider,
        model: block.model,
        baseURLFingerprint: block.baseURLFingerprint,
        sourceSessionId: block.sourceSessionId,
        nativeOutput: structuredClone(block.nativeOutput),
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
/**
 * @param {Session} session
 * @param {Message} message
 */
export function checkpointStateForMessage(session, message) {
    assertSupportedCheckpointMessage(message);
    const id = compactCheckpointId(message);
    if (!id)
        return undefined;
    const event = compactionSummaryEvent(session, id);
    const state = stateFromSummaryEvent(event);
    const hasNativeBlock = event?.data.rawOutput?.some(value => isObject(value) && typeof value.type === "string" && value.type.startsWith("lcx-native-compaction-"));
    if (hasNativeBlock && !state)
        throw Object.assign(new Error("Unsupported or invalid LCX checkpoint; start a new session"), { code: "LCX_CHECKPOINT_UNSUPPORTED" });
    return state;
}
/**
 * @param {NativeCheckpointBlock} state
 * @param {RouteIdentity} route
 * @param {unknown} ctx
 */
export function stateRouteCompatible(state, route, ctx) {
    return routeCompatible(state, route, ctx);
}
/**
 * @param {Session} session
 * @param {number} seq
 * @returns {Message | undefined}
 */
function eventMessage(session, seq) {
    if (!Number.isSafeInteger(seq) || seq < 0)
        return undefined;
    const event = session.eventAt(SessionSeq(seq));
    return event ? (session.deriveEventMessage(event) ?? undefined) : undefined;
}
/** @param {Message} message */
function estimateChars(message) {
    try {
        const encoded = JSON.stringify(message);
        return typeof encoded === "string" ? encoded.length : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * @param {Session} session
 * @param {string} compactionId
 * @returns {Message[]}
 */
function expandedCheckpointMessages(session, compactionId) {
    const summaries = new Map();
    for (const event of session.snapshotEvents())
        if (event.type === "compaction/summary")
            summaries.set(String(event.data.compactionId), event);
    const active = new Set();
    const stack = [];
    const enter = (id) => {
        const summary = summaries.get(id);
        if (active.has(id) || !summary)
            throw Object.assign(new Error("Portable checkpoint history is cyclic or incomplete"), { code: "LCX_CHECKPOINT_UNSUPPORTED" });
        active.add(id);
        stack.push({ id, seqs: summary.data.shadowedSeqs, index: 0 });
    };
    // Walk the DSH event graph iteratively so repeated compaction has no depth cutoff.
    const result = [];
    enter(compactionId);
    while (stack.length) {
        const frame = stack[stack.length - 1];
        if (frame.index === frame.seqs.length) {
            active.delete(frame.id);
            stack.pop();
            continue;
        }
        const message = eventMessage(session, frame.seqs[frame.index++]);
        if (!message)
            continue;
        const nested = compactCheckpointId(message);
        if (nested)
            enter(nested);
        else
            result.push(structuredClone(message));
    }
    return result;
}
/**
 * @param {Session} session
 * @param {string} compactionId
 * @returns {Message[]}
 */
export function shadowedMessagesForCheckpoint(session, compactionId) {
    return expandedCheckpointMessages(session, compactionId);
}
/**
 * @param {readonly Message[]} messages
 * @returns {Message[][]}
 */
function groupMessages(messages) {
    /** @type {Message[][]} */
    const groups = [];
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        const toolCalls = message.role === "assistant"
            ? message.content
                .filter((block) => block.type === "tool-call")
                .map((block) => String(block.id))
            : [];
        if (toolCalls.length === 0) {
            groups.push([message]);
            continue;
        }
        const group = [message];
        const pending = new Set(toolCalls);
        let cursor = index + 1;
        while (cursor < messages.length && pending.size > 0) {
            const next = messages[cursor];
            if (!next)
                break;
            const results = next.role === "user"
                ? next.content
                    .filter((block) => block.type === "tool-result")
                    .map((block) => String(block.toolCallId))
                : [];
            if (results.length === 0)
                break;
            group.push(next);
            for (const id of results)
                pending.delete(id);
            cursor += 1;
        }
        if (pending.size === 0)
            index = cursor - 1;
        groups.push(group);
    }
    return groups;
}
/**
 * @param {Session} session
 * @param {string} compactionId
 * @param {{ maxChars?: number }} [options]
 * @returns {Message[]}
 */
export function portableMessagesForCheckpoint(session, compactionId, options = {}) {
    const configuredMaxChars = options.maxChars;
    const maxChars = typeof configuredMaxChars === "number" &&
        Number.isSafeInteger(configuredMaxChars) &&
        configuredMaxChars > 0
        ? configuredMaxChars
        : 80_000;
    const maxTokens = portableTokenCeiling(maxChars) ?? 1;
    const expanded = shadowedMessagesForCheckpoint(session, compactionId);
    if (expanded.length === 0)
        return [];
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
        const exceeds = !budgetable ||
            chars + groupChars > maxChars ||
            tokens + groupTokens > maxTokens;
        if (exceeds) {
            if (kept.length === 0)
                throw portableBudgetError("Portable checkpoint newest message group exceeds the configured budget");
            break;
        }
        kept.unshift(...group);
        chars += groupChars;
        tokens += groupTokens;
    }
    return kept;
}
