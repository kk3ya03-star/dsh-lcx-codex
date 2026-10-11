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
    if (compat?.supportsAdditionalTools === true)
        return "additional_tools";
    if (compat?.supportsToolSearch === true)
        return "tool_search";
    return undefined;
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
 * Addition-only is used only when every condition holds, otherwise the full current list is sent:
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
    // Without any deferred tool or retained addition the request equals the full list; use the ordinary path
    // so the common no-change turn stays byte-identical with the 0.5.1 behaviour.
    if (deferred.size === 0 && added.size === 0)
        return full(messages, tools, toolHistory);
    if (deferred.size !== added.size || [...deferred].some((name) => !added.has(name)))
        return fallback("deferred tools and retained additions disagree");
    // The declared surface must equal the active surface; a mismatch means the history fold and the live
    // header diverged (restore, fork or migration), where only the full list is known to be correct.
    const active = new Set(tools.map((tool) => tool.name));
    if (active.size !== projectedTools.length || projectedTools.some((tool) => !active.has(tool.name)))
        return fallback("declared tools differ from the active tools");
    return {
        messages: projected.messages,
        tools: projectedTools,
        anchored: true,
        compat: kind === "additional_tools" ? { supportsAdditionalTools: true } : { supportsAdditionalTools: false, supportsToolSearch: true },
    };
}
