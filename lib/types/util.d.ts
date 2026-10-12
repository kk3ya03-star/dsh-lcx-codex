/** Small value guards and error constructors shared by the host-side modules. */
export type UnknownRecord = Record<string, unknown>;
export type CodedError = Error & {
    code: string;
};
/** A plain JSON-like object: not null and not an array. */
export declare function isRecord(value: unknown): value is UnknownRecord;
/** A number that is a positive safe integer. */
export declare function isPositiveSafeInteger(value: unknown): value is number;
/** The value when it is a positive safe integer, otherwise the fallback. */
export declare function positiveSafeInteger(value: unknown, fallback: number): number;
/** A finite number greater than zero. */
export declare function isPositiveFinite(value: unknown): value is number;
/** An Error carrying a stable machine-readable `code`. */
export declare function codedError(message: string | undefined, code: string): CodedError;
