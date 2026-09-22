// @ts-check
const ABORT_MESSAGE = "The operation was aborted";
function abortInstance() {
    if (typeof DOMException === "function")
        return new DOMException(ABORT_MESSAGE, "AbortError");
    const error = new Error(ABORT_MESSAGE);
    error.name = "AbortError";
    return error;
}
// `DOMException.prototype.code` is a getter-only accessor, so own properties are
// defined rather than assigned. Both stay non-enumerable, like a native `cause`.
function define(target, key, value) {
    try {
        Object.defineProperty(target, key, {
            value,
            configurable: true,
            writable: true,
            enumerable: false,
        });
    }
    catch { }
}
function synthesize(reason) {
    const error = abortInstance();
    define(error, "code", "LCX_ABORTED");
    if (reason !== undefined && reason !== null)
        define(error, "cause", reason);
    return error;
}
/**
 * Normalize an abort reason into something safe to throw. `fallback` is used only when
 * the reason is absent, preserving the older `signal.reason ?? error` behaviour.
 */
export function normalizeAbortReason(reason, fallback) {
    if (reason instanceof Error)
        return reason;
    if (reason === undefined || reason === null) {
        if (fallback instanceof Error)
            return fallback;
        return synthesize(undefined);
    }
    return synthesize(reason);
}
/** The error to throw for `signal`'s cancellation. */
export function abortError(signal, fallback) {
    return normalizeAbortReason(signal?.reason, fallback);
}
