import { abortError } from "./abort-error.js";
import { DEFAULTS } from "./defaults.js";

const DEFAULT_TIMEOUT_MS = DEFAULTS.requestTimeoutMs;
const DEFAULT_MAX_BYTES = DEFAULTS.maxResponseBytes;
const MAX_ERROR_BYTES = 512 * 1024;

type AbortLike = Pick<AbortSignal, "aborted" | "reason" | "addEventListener" | "removeEventListener">;
type TransportError = Error & { code?: string; retryable?: boolean };
type RetryOptions = { maxAttempts?: number; maxResponseBytes?: number };
type SseRetryOptions<T = Response> = RetryOptions & {
  consume?: (response: Response, options: { requestSignal?: AbortSignal }) => Promise<T>;
  applyDefaultTimeout?: boolean;
};
type JsonRequestBody = Record<string, unknown>;
type SseRequestBody = Record<string, unknown>;

function errorFacts(value: unknown): TransportError {
  return value instanceof Error ? value as TransportError : new Error(String(value));
}

export function abortIfNeeded(signal: AbortLike | undefined) {
  if (signal?.aborted) throw abortError(signal);
}
function makeError(
  message: string | undefined,
  code: string,
  extra: Record<string, unknown> = {},
): TransportError {
  const error: TransportError = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}
function retryableStatus(status: number) {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  );
}
// Retain only an allowlisted class, never upstream messages or account balances.
function isQuotaError(text: string): boolean {
  try {
    const code = JSON.parse(text)?.error?.code;
    return code === "insufficient_user_quota" || code === "insufficient_quota";
  } catch {
    return false;
  }
}
function retryAfterFromHeaders(headers: Headers) {
  const rawMillis = headers?.get?.("retry-after-ms");
  const millis = Number(rawMillis);
  if (
    rawMillis !== null &&
    rawMillis !== undefined &&
    rawMillis !== "" &&
    Number.isFinite(millis) &&
    millis >= 0
  )
    return Math.min(millis, 30_000);
  const retryAfter = headers?.get?.("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.min(seconds * 1000, 30_000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date))
      return Math.min(Math.max(0, date - Date.now()), 30_000);
  }
  return undefined;
}
function delayFromHeaders(headers: Headers, attempt: number) {
  const retryAfter = retryAfterFromHeaders(headers);
  if (retryAfter !== undefined) return retryAfter;
  return Math.min(10_000, 500 * 2 ** Math.max(0, attempt - 1));
}
async function sleep(ms: number | undefined, signal: AbortLike | undefined) {
  if (ms === undefined || ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function combinedSignal(signal: AbortSignal | undefined, timeoutMs: unknown): AbortSignal | undefined {
  if (!(typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0))
    return signal;
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
async function readLimited(response: Response, maxBytes = DEFAULT_MAX_BYTES) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBytes)
        throw makeError(
          `response exceeds ${maxBytes} bytes`,
          "LCX_RESPONSE_TOO_LARGE",
          { status: response.status },
        );
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Cleanup must not replace the read/size error.
    }
    reader.releaseLock();
  }
}

/**
 * The shared request core: POST with bounded retries. A non-2xx answer becomes a classified error (quota,
 * retryable status, other) with its retry-after delay, a transport failure is retried with backoff, and a
 * 2xx answer is handed to `onOk`, whose failures are classified like any other.
 */
async function postWithRetry<T>(
  url: string | URL | Request,
  body: Record<string, unknown>,
  headers: HeadersInit,
  accept: string,
  signal: AbortSignal | undefined,
  requestTimeoutMs: number | undefined,
  maxAttemptsOption: unknown,
  maxErrorBytes: number,
  onOk: (response: Response, requestSignal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(DEFAULTS.maxAttemptsCap, Number(maxAttemptsOption ?? DEFAULTS.maxAttempts)));
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    abortIfNeeded(signal);
    try {
      const requestSignal = combinedSignal(signal, requestTimeoutMs);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept,
          ...headers,
        },
        body: JSON.stringify(body),
        signal: requestSignal,
        redirect: "error",
      });
      if (!response.ok) {
        const text = await readLimited(response, maxErrorBytes);
        const quota = isQuotaError(text);
        const retryable = !quota && retryableStatus(response.status);
        const providerRetryAfterMs = retryAfterFromHeaders(response.headers);
        const error = makeError(
          `HTTP ${response.status}`,
          quota ? "LCX_INSUFFICIENT_QUOTA" : retryable ? "LCX_HTTP_RETRYABLE" : "LCX_HTTP_ERROR",
          {
            status: response.status,
            retryable,
            requestId:
              response.headers.get("x-request-id") ??
              response.headers.get("request-id") ??
              undefined,
            ...(providerRetryAfterMs === undefined
              ? {}
              : { providerRetryAfterMs }),
          },
        );
        if (!retryable || attempt >= maxAttempts) throw error;
        last = error;
        await sleep(delayFromHeaders(response.headers, attempt), signal);
        continue;
      }
      return await onOk(response, requestSignal);
    } catch (error) {
      if (signal?.aborted) throw abortError(signal, error);
      const details = errorFacts(error);
      const retryable =
        details.retryable === true ||
        details.code === "LCX_HTTP_RETRYABLE" ||
        error instanceof TypeError ||
        [
          "ECONNRESET",
          "ECONNREFUSED",
          "ETIMEDOUT",
          "EAI_AGAIN",
          "UND_ERR_CONNECT_TIMEOUT",
        ].includes(details.code ?? "");
      if (!retryable || attempt >= maxAttempts) {
        if (attempt >= maxAttempts && retryable)
          throw makeError(
            `request failed after ${maxAttempts} attempts`,
            "LCX_RETRY_EXHAUSTED",
            { cause: error, retryable: true },
          );
        throw error;
      }
      last = error;
      await sleep(Math.min(10_000, 500 * 2 ** (attempt - 1)), signal);
    }
  }
  throw last ?? makeError("request failed", "LCX_REQUEST_FAILED");
}

export async function fetchJsonWithRetry(
  url: string | URL | Request,
  body: JsonRequestBody,
  headers: HeadersInit = {},
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined = DEFAULT_TIMEOUT_MS,
  options: RetryOptions = {},
) {
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_BYTES;
  return postWithRetry(
    url,
    body,
    headers,
    "application/json",
    signal,
    timeoutMs,
    options.maxAttempts,
    Math.min(maxResponseBytes, MAX_ERROR_BYTES),
    async (response) => {
      const text = await readLimited(response, maxResponseBytes);
      try {
        return text ? JSON.parse(text) : {};
      } catch (cause) {
        throw makeError(
          `invalid JSON response from ${url}`,
          "LCX_INVALID_JSON",
          { status: response.status, cause },
        );
      }
    },
  );
}

export async function fetchSseWithRetry<T = Response>(
  url: string | URL | Request,
  body: SseRequestBody,
  headers: HeadersInit = {},
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  options: SseRetryOptions<T> = {},
): Promise<T> {
  const requestTimeoutMs = timeoutMs ??
    (options.applyDefaultTimeout === false ? undefined : DEFAULT_TIMEOUT_MS);
  return postWithRetry<T>(
    url,
    body,
    headers,
    "text/event-stream",
    signal,
    requestTimeoutMs,
    options.maxAttempts,
    Math.min(options.maxResponseBytes ?? DEFAULT_MAX_BYTES, MAX_ERROR_BYTES),
    async (response, requestSignal) =>
      typeof options.consume === "function"
        ? options.consume(response, { requestSignal })
        : (response as T),
  );
}

/** The errors one SSE consumer reports; each caller keeps its own wording and codes. */
export type SseReadErrors = {
  noBody(response: Response): Error;
  malformed(cause: unknown): Error;
  tooLarge(maxBytes: number): Error;
};

/** `reader.read()` that settles with the abort as soon as `signal` aborts, whatever the stream does. */
async function readWithSignal(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read();
  if (signal.aborted) throw abortError(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

/**
 * The one SSE event reader: yields each parsed JSON `data:` event (`[DONE]` yields nothing) with a byte limit.
 * An abort interrupts a read that never settles in two ways: the pending read is rejected with the abort, and
 * the underlying reader is cancelled so the connection is released; the abort is also re-checked around every
 * read. The reader is always cancelled and released when the generator ends, however it ends.
 */
export async function* readSseEvents(
  response: Response,
  options: { signal?: AbortSignal; maxBytes?: number; errors: SseReadErrors },
): AsyncGenerator<unknown> {
  const { signal, errors } = options;
  if (!response?.body) throw errors.noBody(response);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let dataLines: string[] = [];
  let bytes = 0;
  const decode = () => {
    if (dataLines.length === 0) return undefined;
    const data = dataLines.join("\n");
    dataLines = [];
    if (data === "[DONE]") return undefined;
    try {
      return JSON.parse(data);
    } catch (cause) {
      throw errors.malformed(cause);
    }
  };
  const onAbort = () => {
    reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      abortIfNeeded(signal);
      const { done, value } = await readWithSignal(reader, signal);
      abortIfNeeded(signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw errors.tooLarge(maxBytes);
      pending += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/u, "");
        pending = pending.slice(newline + 1);
        if (line === "") {
          const event = decode();
          if (event !== undefined) yield event;
        } else if (!line.startsWith(":") && line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /u, ""));
        }
      }
    }
    pending += decoder.decode();
    if (pending.startsWith("data:"))
      dataLines.push(pending.slice(5).replace(/^ /u, ""));
    const event = decode();
    if (event !== undefined) yield event;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      await reader.cancel();
    } catch {
      // Cleanup must not replace the stream/parse/cancellation outcome.
    }
    try {
      reader.releaseLock();
    } catch {
      // The acquired reader owns no further work after settlement.
    }
  }
}

export async function consumeSse(
  response: Response,
  onEvent: (event: unknown) => void,
  options: { signal?: AbortSignal; maxResponseBytes?: number } = {},
) {
  for await (const event of readSseEvents(response, {
    signal: options.signal,
    maxBytes: options.maxResponseBytes,
    errors: {
      noBody: () => makeError("SSE response has no body", "LCX_INVALID_SSE"),
      malformed: (cause) => makeError("malformed SSE JSON", "LCX_INVALID_SSE", { cause }),
      tooLarge: (maxBytes) =>
        makeError(`SSE response exceeds ${maxBytes} bytes`, "LCX_RESPONSE_TOO_LARGE"),
    },
  }))
    onEvent(event);
}
