// @ts-check

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

const ABORT_MESSAGE = "The operation was aborted";

function abortInstance(): Error {
  if (typeof DOMException === "function")
    return new DOMException(ABORT_MESSAGE, "AbortError");
  const error = new Error(ABORT_MESSAGE);
  error.name = "AbortError";
  return error;
}

// `DOMException.prototype.code` is a getter-only accessor, so own properties are
// defined rather than assigned. Both stay non-enumerable, like a native `cause`.
function define(target: object, key: string, value: unknown) {
  try {
    Object.defineProperty(target, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  } catch {}
}

function synthesize(reason: unknown): Error {
  const error = abortInstance();
  define(error, "code", "LCX_ABORTED");
  if (reason !== undefined && reason !== null) define(error, "cause", reason);
  return error;
}

/**
 * Normalize an abort reason into something safe to throw. `fallback` is used only when
 * the reason is absent, preserving the older `signal.reason ?? error` behaviour.
 */
export function normalizeAbortReason(
  reason: unknown,
  fallback?: unknown,
): Error {
  if (reason instanceof Error) return reason;
  if (reason === undefined || reason === null) {
    if (fallback instanceof Error) return fallback;
    return synthesize(undefined);
  }
  return synthesize(reason);
}

/** The error to throw for `signal`'s cancellation. */
export function abortError(
  signal: AbortReasonSource | undefined,
  fallback?: unknown,
): Error {
  return normalizeAbortReason(signal?.reason, fallback);
}
