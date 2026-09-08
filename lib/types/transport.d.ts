type AbortLike = Pick<AbortSignal, "aborted" | "reason" | "addEventListener">;
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
export declare function consumeSse(response: Response, onEvent: (event: unknown) => void, options?: {
    signal?: AbortSignal;
    maxResponseBytes?: number;
}): Promise<void>;
export {};
