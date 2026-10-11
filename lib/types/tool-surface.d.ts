import { type RequestMessage } from "@deepseek-ai/dsh-llm";
import type { ToolHistory, ToolSchema } from "@deepseek-ai/dsh-llm";
/**
 * The route-policy value of `toolUpdates`: `"addition-only"` anchors the request `tools` to the initial
 * declaration set and renders later additions at their history position (DSH 0.2.1 host semantics);
 * `"full"` sends the complete current tool set on every request (the 0.5.1 behaviour).
 */
export type ToolUpdatesMode = "addition-only" | "full";
export declare const DEFAULT_TOOL_UPDATES: ToolUpdatesMode;
export type ToolSurfaceFacts = {
    /** DSH `ModelInfo.toolUpdate` of the exact routed model; absent when unresolved or not declared. */
    toolUpdate: "in-history" | "addition-only" | undefined;
    /** DSH `ModelInfo.systemPromptUpdate`; addition-only is only coherent on an in-history route. */
    systemPromptUpdate: "in-history" | undefined;
    /** False when the model information could not be read. */
    resolved: boolean;
};
export type ToolSurfaceCompat = {
    supportsAdditionalTools?: boolean;
    supportsToolSearch?: boolean;
};
export type ToolSurface = {
    messages: RequestMessage[];
    tools: ToolSchema[] | undefined;
    /** True only when the request carries host-style addition-only updates (deferred tools + developer additions). */
    anchored: boolean;
    /**
     * Compat flags the serializer must use for this request when anchored. The declaration item is chosen here
     * (`additional_tools` wins over `tool_search`, as in Pi), independent of what LCX's own route compat knows.
     */
    compat?: {
        supportsAdditionalTools: boolean;
        supportsToolSearch?: boolean;
    };
    /** Why the full-list path was used although anchoring was requested; undefined when anchored or not requested. */
    fallbackReason?: string;
    /** True when the host declared addition-only for this route yet LCX could not follow: worth a warning. */
    fallbackUnexpected?: boolean;
};
/** Reason used when the route compat explicitly declines both declaration kinds; a deliberate configuration. */
export declare const COMPAT_OPT_OUT = "route compat opts out of additional_tools and tool_search";
/** Reason used when the route compat names no supported declaration shape at all; LCX does not guess one. */
export declare const COMPAT_SILENT = "route compat does not say whether the model supports additional_tools or tool_search";
/**
 * Which declaration item carries a mid-session addition, from what the route compat states: `additional_tools`
 * wins over `tool_search` when both are supported, as in Pi. A shape is never guessed: a compat that is silent
 * about both (a model neither the bundled Pi catalog nor the profile describes) or that declines both yields
 * no shape, and the request carries the complete tool list instead. DSH declares addition-only for models whose
 * own catalog supports one of the two, but only the compat says which.
 */
export declare function declarationKind(compat: ToolSurfaceCompat | undefined): "additional_tools" | "tool_search" | undefined;
/** Remove the activation marker; the wire never carries it. */
export declare function withoutDeferLoading(tool: ToolSchema): ToolSchema;
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
export declare function planToolSurface(input: {
    mode: ToolUpdatesMode;
    messages: readonly RequestMessage[];
    tools: readonly ToolSchema[] | undefined;
    toolHistory: ToolHistory | undefined;
    facts: ToolSurfaceFacts;
    compat: ToolSurfaceCompat | undefined;
}): ToolSurface;
