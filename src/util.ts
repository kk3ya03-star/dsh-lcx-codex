/** Small value guards and error constructors shared by the host-side modules. */

export type UnknownRecord = Record<string, unknown>;
export type CodedError = Error & { code: string };

/** A plain JSON-like object: not null and not an array. */
export function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A number that is a positive safe integer. */
export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** The value when it is a positive safe integer, otherwise the fallback. */
export function positiveSafeInteger(value: unknown, fallback: number): number {
  return isPositiveSafeInteger(value) ? value : fallback;
}

/** A finite number greater than zero. */
export function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** An Error carrying a stable machine-readable `code`. */
export function codedError(message: string | undefined, code: string): CodedError {
  return Object.assign(new Error(message), { code });
}
