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
/**
 * Which declaration item carries a mid-session addition. DSH declares `toolUpdate: "addition-only"` only for
 * models whose host catalog supports `additional_tools` or `tool_search`, so a route compat that says nothing
 * (LCX's frozen Pi 0.86 catalog does not know newer models such as gpt-6-sol) is not evidence against it. Only
 * an explicit `false` on a declaration kind that is not backed by an explicit `true` opts the route out.
 */
export declare function declarationKind(compat: ToolSurfaceCompat | undefined): "additional_tools" | "tool_search" | undefined;
/** Remove the activation marker; the wire never carries it. */
export declare function withoutDeferLoading(tool: ToolSchema): ToolSchema;
/**
 * Decide the tool surface of one GPT Responses request.
 *
 * Addition-only is used only when every condition holds, otherwise the full current list is sent:
 * the policy is on, DSH reports `toolUpdate: "addition-only"` with an in-history system prompt, the route
 * compat does not explicitly opt out of `additional_tools`/`tool_search` (silence is accepted: the host
 * declares addition-only only for models that support them), and DSH supplied its tool history. The host
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
