/**
 * DSH 0.1.6 cancels with plain-object `AgentCancelCause` values — `{ kind: "user" }`,
 * `{ kind: "parent" }`, `{ kind: "disposed" }`, `{ kind: "hook", reason }` — and exposes
 * that same object as the runtime `AbortSignal.reason`. Propagating it raw reaches DSH's
 * `errorMessage()`, which falls back to `String(value)`, so a cancelled in-flight call
 * persists `Error: [object Object]` as model-facing tool-result text.
 *
 * Every LCX transport/stream abort site normalizes through here instead. An `Error`
 * reason is preserved exactly — including `TimeoutError`, which failure classification
 * still reads off the signal — and any other reason becomes a stable `AbortError` that
 * keeps the original value as diagnostic `cause`. DSH's cancel cause is never mutated.
 */
type AbortReasonSource = Pick<AbortSignal, "aborted" | "reason">;
/**
 * Normalize an abort reason into something safe to throw. `fallback` is used only when
 * the reason is absent, preserving the older `signal.reason ?? error` behaviour.
 */
export declare function normalizeAbortReason(reason: unknown, fallback?: unknown): Error;
/** The error to throw for `signal`'s cancellation. */
export declare function abortError(signal: AbortReasonSource | undefined, fallback?: unknown): Error;
export {};
