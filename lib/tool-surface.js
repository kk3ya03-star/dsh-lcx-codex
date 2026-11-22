import { getResponsesToolSupport } from "./pi-responses-runtime.js";
import { projectToolUpdates } from "@deepseek-ai/dsh-llm";
export const DEFAULT_TOOL_UPDATES = "addition-only";
/** Reason used when the route compat explicitly declines both declaration kinds; a deliberate configuration. */
export const COMPAT_OPT_OUT = "route compat opts out of additional_tools and tool_search";
/** Reason used when the route compat names no supported declaration shape at all; LCX does not guess one. */
export const COMPAT_SILENT = "route compat does not say whether the model supports additional_tools or tool_search";
/**
 * Which declaration item carries a mid-session addition, from what the route compat states: `additional_tools`
 * wins over `tool_search` when both are supported, as in Pi. A shape is never guessed: a compat that is silent
 * about both (a model neither the bundled Pi catalog nor the profile describes) or that declines both yields
 * no shape, and the request carries the complete tool list instead. DSH declares addition-only for models whose
 * own catalog supports one of the two, but only the compat says which.
 */
export function declarationKind(compat) {
    const support = getResponsesToolSupport({ ...compat, supportsMidConvoSystemMessages: true });
    return support === "changes" ? "additional_tools" : support === "additions" ? "tool_search" : undefined;
}
/** Remove the activation marker; the wire never carries it. */
export function withoutDeferLoading(tool) {
    if (!("deferLoading" in tool))
        return tool;
    const { deferLoading: _deferred, ...rest } = tool;
    return rest;
}
function full(messages, tools, toolHistory, fallbackReason, fallbackUnexpected) {
    // Same projection DSH applies for a route without `toolUpdate`: developer updates are dropped and
    // `deferLoading` is cleared, so every declared tool is immediately usable.
    const projected = projectToolUpdates(messages, tools, undefined, toolHistory);
    return {
        messages: projected.messages,
        tools: projected.tools,
        anchored: false,
        ...(fallbackReason === undefined ? {} : { fallbackReason, fallbackUnexpected: fallbackUnexpected === true }),
    };
}
/**
 * Decide the tool surface of one GPT Responses request.
 *
 * DSH history projection is used only when every condition holds; Pi owns the wire tool state:
 * the policy is on, DSH reports `toolUpdate: "addition-only"` with an in-history system prompt, the route
 * compat names a supported declaration shape (`additional_tools` or `tool_search`; silence is not guessed
 * at, see `declarationKind`), and DSH supplied its tool history. The host
 * projection is then re-verified (LCX-owned self check); any inconsistency falls back to the full list.
 * Removals and same-name redefinitions need no extra handling: the host history fold already yields a
 * shrunken or fully redeclared baseline for them (one-time cache loss), which this function passes through.
 */
export function planToolSurface(input) {
    const { mode, messages, tools, toolHistory, facts, compat } = input;
    const fallback = (reason) => full(messages, tools, toolHistory, mode === "addition-only" ? reason : undefined, facts.toolUpdate === "addition-only" && reason !== COMPAT_OPT_OUT);
    if (mode !== "addition-only")
        return full(messages, tools, toolHistory);
    if ((tools === undefined || tools.length === 0) &&
        toolHistory === undefined &&
        !messages.some((message) => message.role === "developer")) {
        return full(messages, tools, toolHistory);
    }
    if (tools === undefined)
        return fallback("no tools");
    if (!facts.resolved)
        return fallback("model information unavailable");
    if (facts.toolUpdate !== "addition-only")
        return fallback("route does not declare addition-only tool updates");
    if (facts.systemPromptUpdate !== "in-history")
        return fallback("route is not in-history");
    const kind = declarationKind(compat);
    if (kind === undefined)
        return fallback(compat?.supportsAdditionalTools === false || compat?.supportsToolSearch === false ? COMPAT_OPT_OUT : COMPAT_SILENT);
    if (toolHistory === undefined)
        return fallback("no DSH tool history");
    const developerIds = new Set(messages.flatMap((message) => (message.role === "developer" && typeof message.id === "string" ? [message.id] : [])));
    if (toolHistory.updates.some((update) => !developerIds.has(update.messageId)))
        return fallback("tool history references missing developer updates");
    const projected = projectToolUpdates(messages, tools, "addition-only", toolHistory);
    const projectedTools = projected.tools;
    if (projectedTools === undefined)
        return fallback("host projection returned no tools");
    const added = new Set();
    for (const message of projected.messages) {
        if (message.role !== "developer")
            continue;
        for (const block of message.content) {
            if (block.type !== "tool-addition")
                return fallback(`unsupported developer block ${block.type}`);
            if (added.has(block.toolName))
                return fallback("duplicate tool addition");
            added.add(block.toolName);
        }
    }
    const deferred = new Set();
    for (const tool of projectedTools) {
        if (tool.deferLoading === true)
            deferred.add(tool.name);
    }
    if (deferred.size !== added.size || [...deferred].some((name) => !added.has(name)))
        return fallback("deferred tools and retained additions disagree");
    // The declared surface must match the active normalized definitions (ignoring projection-owned
    // `deferLoading`); a name or schema mismatch means history and live header diverged, where only
    // the full active tool list is safe to send.
    const canonicalJsonValue = (value) => {
        if (Array.isArray(value))
            return ["a", ...value.map(canonicalJsonValue)];
        if (value !== null && typeof value === "object") {
            const record = value;
            const entries = [];
            for (const key of Object.keys(record).sort()) {
                if (!Object.hasOwn(record, key))
                    continue;
                const child = record[key];
                if (child !== undefined)
                    entries.push([key, canonicalJsonValue(child)]);
            }
            return ["o", entries];
        }
        return value;
    };
    const canonicalToolSignature = (tool) => {
        const copy = { ...tool };
        delete copy.deferLoading;
        return JSON.stringify(canonicalJsonValue(copy));
    };
    const active = new Map(tools.map((tool) => [tool.name, canonicalToolSignature(tool)]));
    if (active.size !== tools.length ||
        active.size !== projectedTools.length ||
        projectedTools.some((tool) => active.get(tool.name) !== canonicalToolSignature(tool)))
        return fallback("declared tools differ from the active tools");
    // Without any deferred tool or retained addition the verified request equals the full list; use the
    // ordinary path so the common no-change turn stays byte-identical with the 0.5.1 behaviour.
    if (deferred.size === 0 && added.size === 0)
        return full(messages, tools, toolHistory);
    return {
        messages: projected.messages,
        tools: projectedTools,
        anchored: true,
    };
}
