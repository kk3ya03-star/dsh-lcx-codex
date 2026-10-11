export declare const PORTABLE_BUDGET_ERROR_CODE = "LCX_PORTABLE_BUDGET_EXCEEDED";
export declare const PORTABLE_UNSUPPORTED_CONTENT_CODE = "LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT";
/**
 * A small conservative fallback, deliberately not a tokenizer. The baseline
 * preserves legacy /4 while CJK and structural characters cost more.
 */
export declare function estimateTextTokens(value: unknown): number | undefined;
/**
 * Project an item to model-visible fields only. Opaque provider state, raw
 * binary, and replay/session metadata are intentionally excluded.
 */
export declare function modelVisibleBudgetView(item: unknown): {
    type: string;
    call_id: string;
    name: string;
    arguments: string;
    output?: undefined;
    toolCallId?: undefined;
    role?: undefined;
    content?: undefined;
} | {
    name?: undefined;
    arguments?: undefined;
    type: string;
    call_id: string;
    output: string;
    toolCallId?: undefined;
    role?: undefined;
    content?: undefined;
} | {
    name?: undefined;
    arguments?: undefined;
    type?: undefined;
    call_id?: undefined;
    output?: undefined;
    role: string;
    toolCallId: string | undefined;
    content: unknown[];
} | {
    name?: undefined;
    arguments?: undefined;
    type?: undefined;
    call_id?: undefined;
    output?: undefined;
    toolCallId?: undefined;
    role: string;
    content: unknown[];
} | undefined;
export declare function estimateBudgetItem(item: unknown): number | undefined;
export declare function portableTokenCeiling(maxChars: unknown): number | undefined;
export declare function portableBudgetError(message: string): Error & {
    code: string;
};
