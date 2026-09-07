export declare const PORTABLE_BUDGET_ERROR_CODE = "LCX_PORTABLE_BUDGET_EXCEEDED";
/**
 * A small conservative fallback, deliberately not a tokenizer. The baseline
 * preserves legacy /4 while CJK and structural characters cost more.
 * @param {unknown} value
 * @returns {number | undefined}
 */
export declare function estimateTextTokens(value: unknown): number | undefined;
/**
 * Project an item to model-visible fields only. Opaque provider state, raw
 * binary, and replay/session metadata are intentionally excluded.
 * @param {unknown} item
 * @returns {unknown | undefined}
 */
export declare function modelVisibleBudgetView(item: unknown): {
    type: string;
    call_id: string;
    name: string;
    arguments: string;
    output?: undefined;
    role?: undefined;
    content?: undefined;
} | {
    name?: undefined;
    arguments?: undefined;
    type: string;
    call_id: string;
    output: string;
    role?: undefined;
    content?: undefined;
} | {
    name?: undefined;
    arguments?: undefined;
    type?: undefined;
    call_id?: undefined;
    output?: undefined;
    role: string;
    content: unknown[];
} | undefined;
/**
 * @param {unknown} item
 * @returns {number | undefined}
 */
export declare function estimateBudgetItem(item: unknown): number | undefined;
/** @param {unknown} maxChars */
export declare function portableTokenCeiling(maxChars: unknown): number | undefined;
/** @param {string} message */
export declare function portableBudgetError(message: string): Error & {
    code: string;
};
