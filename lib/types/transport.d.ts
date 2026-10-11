type AbortLike = Pick<AbortSignal, "aborted" | "reason" | "addEventListener" | "removeEventListener">;
type RetryOptions = {
    maxAttempts?: number;
    maxResponseBytes?: number;
};
type SseRetryOptions<T = Response> = RetryOptions & {
    consume?: (response: Response, options: {
        requestSignal?: AbortSignal;
    }) => Promise<T>;
    applyDefaultTimeout?: boolean;
};
type JsonRequestBody = Record<string, unknown>;
type SseRequestBody = Record<string, unknown>;
export declare function abortIfNeeded(signal: AbortLike | undefined): void;
export declare function fetchJsonWithRetry(url: string | URL | Request, body: JsonRequestBody, headers: HeadersInit | undefined, signal: AbortSignal | undefined, timeoutMs?: number | undefined, options?: RetryOptions): Promise<any>;
export declare function fetchSseWithRetry<T = Response>(url: string | URL | Request, body: SseRequestBody, headers: HeadersInit | undefined, signal: AbortSignal | undefined, timeoutMs: number | undefined, options?: SseRetryOptions<T>): Promise<T>;
/** The errors one SSE consumer reports; each caller keeps its own wording and codes. */
export type SseReadErrors = {
    noBody(response: Response): Error;
    malformed(cause: unknown): Error;
    tooLarge(maxBytes: number): Error;
};
/**
 * The one SSE event reader: yields each parsed JSON `data:` event (`[DONE]` yields nothing) with a byte limit.
 * An abort interrupts a read that never settles in two ways: the pending read is rejected with the abort, and
 * the underlying reader is cancelled so the connection is released; the abort is also re-checked around every
 * read. The reader is always cancelled and released when the generator ends, however it ends.
 */
export declare function readSseEvents(response: Response, options: {
    signal?: AbortSignal;
    maxBytes?: number;
    errors: SseReadErrors;
}): AsyncGenerator<unknown>;
export declare function consumeSse(response: Response, onEvent: (event: unknown) => void, options?: {
    signal?: AbortSignal;
    maxResponseBytes?: number;
}): Promise<void>;
export {};
