/** Small value guards and error constructors shared by the host-side modules. */
/** A plain JSON-like object: not null and not an array. */
export function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** A number that is a positive safe integer. */
export function isPositiveSafeInteger(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
/** The value when it is a positive safe integer, otherwise the fallback. */
export function positiveSafeInteger(value, fallback) {
    return isPositiveSafeInteger(value) ? value : fallback;
}
/** A finite number greater than zero. */
export function isPositiveFinite(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}
/** An Error carrying a stable machine-readable `code`. */
export function codedError(message, code) {
    return Object.assign(new Error(message), { code });
}
