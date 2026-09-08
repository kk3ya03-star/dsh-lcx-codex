// @ts-check

import {
  createAssistantMessageEventStream,
  type AssistantMessageEvent,
  type Model as PiModel,
} from "@earendil-works/pi-ai";
import { processResponsesStream } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import type { FinishReason, LlmFailure, StreamChunk } from "@deepseek-ai/dsh-llm";
import { fetchSseWithRetry } from "./transport.js";
import {
  createGrokNativeReplayEnvelope,
  type GrokNativeReplayRoute,
} from "./grok-native-search.js";

type UnknownRecord = Record<string, unknown>;
type ResponseStreamEvent = import("openai/resources/responses/responses.js").ResponseStreamEvent;
type ResponseOutputItem = import("openai/resources/responses/responses.js").ResponseOutputItem;
type PiResponsesModel = PiModel<"openai-responses">;
type FailureCode =
  | "ABORTED"
  | "AUTH"
  | "UNSUPPORTED_OPTION"
  | "NO_ADAPTER"
  | "RATE_LIMIT"
  | "SERVER"
  | "INVALID_REQUEST"
  | "CONTEXT_WINDOW_EXCEEDED"
  | "TIMEOUT"
  | "TRANSPORT"
  | "RESPONSES_ERROR";
type ManagedFailure = {
  message: string;
  code: string;
  status?: number;
  requestId?: string;
  providerRetryAfterMs?: number;
};
type LcxError = Error & {
  code?: string;
  status?: number;
  requestId?: string;
  providerRetryAfterMs?: number;
  cause?: unknown;
};
type AbortLike = Pick<AbortSignal, "aborted" | "reason">;
type WireItem = UnknownRecord & {
  type: string;
  id?: unknown;
  call_id?: unknown;
  name?: unknown;
  status?: unknown;
  content?: unknown;
  summary?: unknown;
  arguments?: unknown;
  input?: unknown;
};
type StreamOptions = {
  signal?: AbortSignal;
  maxResponseBytes?: number;
};
type ResponseWireMeta = {
  responseModel?: string;
  nativeOutput?: unknown[];
  nativeVisibleAdditions?: unknown[];
};
export type ServerToolUsage = {
  webSearchCalls: number;
  xSearchCalls: number;
  total: number;
};

type StreamRequestOptions = {
  baseURL: string;
  provider: string;
  model: string;
  piModel: PiResponsesModel;
  body: UnknownRecord;
  grammarToolInputProperties?: ReadonlyMap<string, string>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  applyDefaultTimeout?: boolean;
  streamIdleTimeoutMs?: number;
  maxAttempts?: number;
  maxResponseBytes?: number;
  serverToolTypes?: ReadonlySet<string>;
  nativeReplayRoute?: GrokNativeReplayRoute;
  onServerToolUsage?: (usage: ServerToolUsage) => void;
};
type PiOutput = import("@earendil-works/pi-ai").AssistantMessage & {
  responseModel?: string;
  errorMessage?: string;
  __lcxFailure?: ManagedFailure;
};

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** @param {unknown} value @returns {value is UnknownRecord} */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} raw */
function safeStatus(raw: unknown) {
  return Number.isInteger(raw) && Number(raw) >= 100 && Number(raw) <= 599
    ? Number(raw)
    : undefined;
}

/** @param {unknown} raw */
function safeRequestId(raw: unknown) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 160)
    return undefined;
  return /^[A-Za-z0-9._:\/-]+$/u.test(raw) ? raw : undefined;
}

/** @param {unknown} error */
function errorFacts(error: unknown) {
  const seen = new Set();
  const codes = [];
  const texts = [];
  let status;
  let requestId;
  let providerRetryAfterMs;
  let current = error;
  for (
    let depth = 0;
    depth < 8 &&
    (current instanceof Error || isObject(current)) &&
    !seen.has(current);
    depth += 1
  ) {
    seen.add(current);
    const value = current as LcxError;
    if (status === undefined) status = safeStatus(value.status);
    if (requestId === undefined) requestId = safeRequestId(value.requestId);
    if (
      providerRetryAfterMs === undefined &&
      Number.isFinite(value.providerRetryAfterMs) &&
      Number(value.providerRetryAfterMs) > 0
    )
      providerRetryAfterMs = Number(value.providerRetryAfterMs);
    if (typeof value.code === "string" && value.code) codes.push(value.code);
    if (typeof value.message === "string" && value.message)
      texts.push(value.message);
    current = value.cause;
  }
  return {
    status,
    requestId,
    providerRetryAfterMs,
    codes,
    text: texts.join(" | "),
  };
}

/**
 * Provider bodies/messages are deliberately not surfaced. Only a stable class and safe facts leave the wire boundary.
 * @param {unknown} error
 * @param {AbortSignal} [signal]
 */
export function managedFailure(
  error: unknown,
  signal: AbortLike | undefined,
): ManagedFailure {
  const facts = errorFacts(error);
  const sourceCodes = new Set(facts.codes);
  const text = facts.text;
  const signalReason = signal?.reason as
    | { name?: unknown; code?: unknown; message?: unknown }
    | undefined;
  const signalTimedOut =
    signal?.aborted &&
    (signalReason?.name === "TimeoutError" ||
      signalReason?.code === "TimeoutError" ||
      /time(?:d)?\s*out|timeout/iu.test(String(signalReason?.message ?? "")));
  let code: FailureCode = "RESPONSES_ERROR";
  if (
    signalTimedOut ||
    facts.status === 408 ||
    sourceCodes.has("TimeoutError") ||
    /time(?:d)?\s*out|timeout/iu.test(text)
  )
    code = "TIMEOUT";
  else if (
    signal?.aborted ||
    sourceCodes.has("LCX_ABORTED") ||
    /\babort(?:ed)?\b/iu.test(text)
  )
    code = "ABORTED";
  else if (sourceCodes.has("LCX_RESPONSES_UNSUPPORTED_OPTION"))
    code = "UNSUPPORTED_OPTION";
  else if (
    sourceCodes.has("LCX_RESPONSES_ROUTE_UNAVAILABLE") ||
    sourceCodes.has("LCX_RESPONSES_MODEL_UNAVAILABLE")
  )
    code = "NO_ADAPTER";
  else if (
    facts.status === 401 ||
    facts.status === 403 ||
    sourceCodes.has("AUTH") ||
    sourceCodes.has("LCX_CREDENTIAL_UNAVAILABLE")
  )
    code = "AUTH";
  else if (facts.status === 409 || facts.status === 425) code = "TRANSPORT";
  else if (facts.status === 429 || /rate.?limit|quota exceeded/iu.test(text))
    code = "RATE_LIMIT";
  else if (facts.status !== undefined && facts.status >= 500) code = "SERVER";
  else if (
    /context (?:window|length)|maximum context|too many tokens/iu.test(text) ||
    [...sourceCodes].some((value) =>
      /context.*(?:window|length|exceed)/iu.test(value),
    )
  )
    code = "CONTEXT_WINDOW_EXCEEDED";
  else if (
    facts.status === 400 ||
    facts.status === 404 ||
    facts.status === 413 ||
    facts.status === 422 ||
    sourceCodes.has("LCX_RESPONSES_INVALID_INPUT") ||
    sourceCodes.has("LCX_CHECKPOINT_UNSUPPORTED") ||
    /invalid.?request|payload too large|length limit exceeded/iu.test(text)
  )
    code = "INVALID_REQUEST";
  else if (sourceCodes.has("LCX_RESPONSE_TOO_LARGE")) code = "INVALID_REQUEST";
  else if (
    sourceCodes.has("LCX_INVALID_SSE") ||
    /stream ended before|without a terminal|malformed.*sse/iu.test(text)
  )
    code = "TRANSPORT";
  else if (
    error instanceof TypeError ||
    /\bnetwork|connection|socket|fetch|ECONN|EAI_AGAIN|terminated|premature close\b/iu.test(
      text,
    )
  )
    code = "TRANSPORT";
  const messages = /** @type {Record<string, string>} */ {
    ABORTED: "Responses request was aborted",
    AUTH: "Responses request was rejected by authentication",
    UNSUPPORTED_OPTION: "LCX Responses does not support this request option",
    NO_ADAPTER: "LCX could not resolve the selected Responses route",
    RATE_LIMIT: "Responses provider rate limit was reached",
    SERVER: "Responses provider returned a server failure",
    INVALID_REQUEST: sourceCodes.has("LCX_CHECKPOINT_UNSUPPORTED")
      ? "Unsupported or invalid LCX checkpoint; start a new session"
      : "Responses provider rejected the request",
    CONTEXT_WINDOW_EXCEEDED:
      "Responses request exceeded the model context window",
    TIMEOUT: "Responses request timed out",
    TRANSPORT: "Responses transport failed",
    RESPONSES_ERROR: "Responses request failed",
  };
  return {
    message: messages[code] ?? messages.RESPONSES_ERROR,
    code,
    ...(facts.status === undefined ? {} : { status: facts.status }),
    ...(facts.requestId === undefined ? {} : { requestId: facts.requestId }),
    ...(facts.providerRetryAfterMs === undefined
      ? {}
      : { providerRetryAfterMs: facts.providerRetryAfterMs }),
  };
}

/** @param {unknown} error @param {AbortSignal} [signal] */
export function managedFailureChunk(
  error: unknown,
  signal?: AbortLike,
): StreamChunk {
  const managed = managedFailure(error, signal);
  const failure: LlmFailure = {
    message: managed.message,
    code: managed.code,
    ...(managed.status === undefined ? {} : { status: managed.status }),
    ...(managed.providerRetryAfterMs === undefined
      ? {}
      : { providerRetryAfterMs: managed.providerRetryAfterMs }),
  };
  return {
    type: "finish",
    reason:
      managed.code === "ABORTED"
        ? { kind: "aborted", failure }
        : { kind: "error", failure },
  };
}

async function readWithSignal(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read();
  if (signal.aborted) throw signal.reason;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function requestDeadline(
  parent: AbortSignal | undefined,
  timeoutMs: number | undefined,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onParentAbort();
  else parent?.addEventListener("abort", onParentAbort, { once: true });
  if (
    !controller.signal.aborted &&
    typeof timeoutMs === "number" &&
    Number.isFinite(timeoutMs) &&
    timeoutMs > 0
  )
    timer = setTimeout(() => controller.abort(Object.assign(
      new Error(`Responses request timeout after ${timeoutMs}ms`),
      { code: "LCX_REQUEST_TIMEOUT" },
    )), timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
      if (!controller.signal.aborted)
        controller.abort(Object.assign(new Error("Responses request consumer stopped"), {
          code: "LCX_ABORTED",
        }));
    },
  };
}

function streamIdleWatchdog(
  parent: AbortSignal | undefined,
  idleTimeoutMs: number | undefined,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onParentAbort();
  else parent?.addEventListener("abort", onParentAbort, { once: true });
  const disarm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const arm = () => {
    if (controller.signal.aborted) return;
    disarm();
    if (typeof idleTimeoutMs === "number" && Number.isFinite(idleTimeoutMs) && idleTimeoutMs > 0)
      timer = setTimeout(() => controller.abort(Object.assign(
        new Error(`Responses stream idle timeout after ${idleTimeoutMs}ms`),
        { code: "LCX_STREAM_IDLE_TIMEOUT" },
      )), idleTimeoutMs);
  };
  return {
    signal: controller.signal,
    arm,
    disarm,
    dispose() {
      disarm();
      parent?.removeEventListener("abort", onParentAbort);
      if (!controller.signal.aborted)
        controller.abort(Object.assign(new Error("Responses stream consumer stopped"), {
          code: "LCX_ABORTED",
        }));
    },
  };
}

/**
 * Minimal JSON SSE reader. LCX owns the exact HTTP wire; Pi owns event semantics after this boundary.
 * Stream liveness is measured after Pi emits meaningful DSH progress, not here.
 * @param {Response} response
 * @param {StreamOptions} [options]
 */
async function* responseEvents(
  response: Response,
  options: StreamOptions = {},
): AsyncGenerator<UnknownRecord> {
  if (!response?.body)
    throw Object.assign(new Error("Responses stream returned no body"), {
      code: "LCX_INVALID_SSE",
      status: response?.status,
    });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const maxBytes = options.maxResponseBytes ?? 8 * 1024 * 1024;
  let bytes = 0;
  let pending = "";
  /** @type {string[]} */
  let dataLines: string[] = [];
  const decode = () => {
    if (dataLines.length === 0) return undefined;
    const data = dataLines.join("\n");
    dataLines = [];
    if (data === "[DONE]") return undefined;
    try {
      return JSON.parse(data);
    } catch (cause) {
      throw Object.assign(
        new Error("Responses stream contained malformed SSE JSON", { cause }),
        { code: "LCX_INVALID_SSE" },
      );
    }
  };
  try {
    while (true) {
      if (options.signal?.aborted)
        throw (
          options.signal.reason ??
          Object.assign(new Error("request aborted"), { code: "LCX_ABORTED" })
        );
      const { done, value } = await readWithSignal(reader, options.signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes)
        throw Object.assign(
          new Error(`Responses SSE exceeds ${maxBytes} bytes`),
          { code: "LCX_RESPONSE_TOO_LARGE" },
        );
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
    await reader.cancel().catch(() => undefined);
  }
}

function isSupportedOutputItem(value: unknown): value is ResponseOutputItem {
  if (!isObject(value)) return false;
  if (value.type === "message")
    return (
      typeof value.id === "string" &&
      value.role === "assistant" &&
      (value.status === "in_progress" ||
        value.status === "completed" ||
        value.status === "incomplete") &&
      Array.isArray(value.content) &&
      value.content.every(
        (part) =>
          isObject(part) &&
          ((part.type === "output_text" &&
            typeof part.text === "string" &&
            Array.isArray(part.annotations)) ||
            (part.type === "refusal" && typeof part.refusal === "string")),
      )
    );
  if (value.type === "reasoning")
    return (
      typeof value.id === "string" &&
      Array.isArray(value.summary) &&
      value.summary.every(
        (part) => isObject(part) && typeof part.text === "string",
      )
    );
  if (value.type === "function_call")
    return (
      typeof value.id === "string" &&
      typeof value.call_id === "string" &&
      typeof value.name === "string" &&
      typeof value.arguments === "string"
    );
  return (
    value.type === "custom_tool_call" &&
    typeof value.id === "string" &&
    typeof value.call_id === "string" &&
    typeof value.name === "string" &&
    typeof value.input === "string"
  );
}

function isTerminalResponse(value: unknown): boolean {
  if (!isObject(value) || typeof value.id !== "string") return false;
  if (!Array.isArray(value.output)) return false;
  return (
    value.status === "completed" ||
    value.status === "incomplete" ||
    value.status === "failed" ||
    value.status === "cancelled" ||
    value.status === "in_progress" ||
    value.status === "queued"
  );
}

const PI_RESPONSE_EVENT_TYPES = new Set([
  "response.created",
  "response.output_item.added",
  "response.output_item.done",
  "response.reasoning_summary_text.delta",
  "response.reasoning_summary_part.done",
  "response.reasoning_text.delta",
  "response.output_text.delta",
  "response.refusal.delta",
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
  "response.custom_tool_call_input.delta",
  "response.custom_tool_call_input.done",
  "response.completed",
  "response.incomplete",
  "response.failed",
  "error",
]);

/**
 * Pi only consumes this public Responses subset. Validate all fields it reads before
 * narrowing provider wire data, and silently preserve Pi's existing behavior of
 * ignoring unrelated Responses events.
 */
function isSupportedResponseStreamEvent(
  value: unknown,
): value is ResponseStreamEvent {
  if (!isObject(value)) return false;
  if (
    !Number.isSafeInteger(value.sequence_number) ||
    typeof value.type !== "string" ||
    !PI_RESPONSE_EVENT_TYPES.has(value.type)
  )
    return false;
  if (value.type === "response.created")
    return isObject(value.response) && typeof value.response.id === "string";
  if (
    value.type === "response.output_item.added" ||
    value.type === "response.output_item.done"
  )
    return Number.isSafeInteger(value.output_index) && isSupportedOutputItem(value.item);
  if (
    value.type === "response.output_text.delta" ||
    value.type === "response.refusal.delta" ||
    value.type === "response.reasoning_text.delta"
  )
    return (
      Number.isSafeInteger(value.output_index) &&
      Number.isSafeInteger(value.content_index) &&
      typeof value.item_id === "string" &&
      typeof value.delta === "string"
    );
  if (value.type === "response.reasoning_summary_text.delta")
    return (
      Number.isSafeInteger(value.output_index) &&
      Number.isSafeInteger(value.summary_index) &&
      typeof value.item_id === "string" &&
      typeof value.delta === "string"
    );
  if (value.type === "response.reasoning_summary_part.done")
    return (
      Number.isSafeInteger(value.output_index) &&
      Number.isSafeInteger(value.summary_index) &&
      typeof value.item_id === "string"
    );
  if (value.type === "response.function_call_arguments.delta")
    return (
      Number.isSafeInteger(value.output_index) &&
      typeof value.item_id === "string" &&
      typeof value.delta === "string"
    );
  if (value.type === "response.function_call_arguments.done")
    return (
      Number.isSafeInteger(value.output_index) &&
      typeof value.item_id === "string" &&
      typeof value.arguments === "string"
    );
  if (value.type === "response.custom_tool_call_input.delta")
    return (
      Number.isSafeInteger(value.output_index) &&
      typeof value.item_id === "string" &&
      typeof value.delta === "string"
    );
  if (value.type === "response.custom_tool_call_input.done")
    return (
      Number.isSafeInteger(value.output_index) &&
      typeof value.item_id === "string" &&
      typeof value.input === "string"
    );
  if (
    value.type === "response.completed" ||
    value.type === "response.incomplete"
  )
    return isTerminalResponse(value.response);
  if (value.type === "response.failed") return isObject(value.response);
  return typeof value.code === "string" && typeof value.message === "string";
}

async function* validatedResponseEvents(
  source: AsyncIterable<UnknownRecord>,
): AsyncGenerator<ResponseStreamEvent> {
  let sequenceNumber = 0;
  for await (const raw of source) {
    if (!isObject(raw)) continue;
    if (!PI_RESPONSE_EVENT_TYPES.has(String(raw.type ?? ""))) continue;
    const event = { ...raw, sequence_number: sequenceNumber++ };
    if (!isSupportedResponseStreamEvent(event))
      throw Object.assign(
        new Error("Responses stream contained an unsupported Pi event"),
        { code: "LCX_INVALID_SSE" },
      );
    yield event;
  }
}

/** @param {UnknownRecord} item */
function itemKind(item: Pick<WireItem, "type">) {
  if (item.type === "message") return "text";
  if (item.type === "reasoning") return "reasoning";
  if (item.type === "function_call" || item.type === "custom_tool_call")
    return "tool-call";
  return undefined;
}

/** @param {UnknownRecord} item */
function itemIdentity(item: Pick<WireItem, "id" | "call_id" | "type">) {
  const id =
    typeof item.id === "string" && item.id
      ? item.id
      : typeof item.call_id === "string"
        ? item.call_id
        : "";
  return id ? `${String(item.type)}:${id}` : undefined;
}

/** @param {UnknownRecord} item */
function itemText(item: Pick<
  WireItem,
  "type" | "content" | "summary" | "arguments" | "input"
>) {
  if (item.type === "message")
    return (Array.isArray(item.content) ? item.content : [])
      .map((part: { type: string; text: unknown; refusal: unknown }) =>
        isObject(part) &&
        (part.type === "output_text" || part.type === "refusal")
          ? String(part.text ?? part.refusal ?? "")
          : "",
      )
      .join("");
  if (item.type === "reasoning") {
    const parts =
      Array.isArray(item.summary) && item.summary.length > 0
        ? item.summary
        : Array.isArray(item.content)
          ? item.content
          : [];
    return parts
      .map((part: { text: unknown }) =>
        isObject(part) ? String(part.text ?? "") : "",
      )
      .join("\n\n");
  }
  if (item.type === "function_call") return String(item.arguments ?? "");
  if (item.type === "custom_tool_call") return String(item.input ?? "");
  return "";
}

/** @param {UnknownRecord} item @param {number} index */
function normalizedTerminalItem(item: WireItem, index: number): WireItem {
  if (item.type === "message")
    return {
      ...structuredClone(item),
      id: typeof item.id === "string" && item.id ? item.id : `msg_lcx_${index}`,
      role: "assistant",
      status: item.status ?? "completed",
      content: Array.isArray(item.content) ? structuredClone(item.content) : [],
    };
  if (item.type === "reasoning")
    return {
      ...structuredClone(item),
      id: typeof item.id === "string" && item.id ? item.id : `rs_lcx_${index}`,
      summary: Array.isArray(item.summary) ? structuredClone(item.summary) : [],
    };
  if (item.type === "function_call")
    return {
      ...structuredClone(item),
      id: typeof item.id === "string" && item.id ? item.id : `fc_lcx_${index}`,
      call_id:
        typeof item.call_id === "string" && item.call_id
          ? item.call_id
          : `call_lcx_${index}`,
      name: String(item.name ?? ""),
      arguments: String(item.arguments ?? ""),
    };
  if (item.type === "custom_tool_call")
    return {
      ...structuredClone(item),
      id: typeof item.id === "string" && item.id ? item.id : `ctc_lcx_${index}`,
      call_id:
        typeof item.call_id === "string" && item.call_id
          ? item.call_id
          : `call_lcx_${index}`,
      name: String(item.name ?? ""),
      input: String(item.input ?? ""),
    };
  return structuredClone(item);
}

/** @param {UnknownRecord} item @param {number} index */
function addedShell(
  item: Pick<WireItem, "type" | "id" | "call_id" | "name">,
  index: number,
): WireItem {
  if (item.type === "message")
    return {
      type: "message",
      id: item.id ?? `msg_lcx_${index}`,
      role: "assistant",
      status: "in_progress",
      content: [],
    };
  if (item.type === "reasoning")
    return { type: "reasoning", id: item.id ?? `rs_lcx_${index}`, summary: [] };
  if (item.type === "function_call")
    return {
      type: "function_call",
      id: item.id ?? `fc_lcx_${index}`,
      call_id: item.call_id ?? `call_lcx_${index}`,
      name: String(item.name ?? ""),
      arguments: "",
    };
  return {
    type: "custom_tool_call",
    id: item.id ?? `ctc_lcx_${index}`,
    call_id: item.call_id ?? `call_lcx_${index}`,
    name: String(item.name ?? ""),
    input: "",
  };
}

/** @param {UnknownRecord} record @param {UnknownRecord} item */
function recordMatches(
  record: { kind: string | undefined; item: WireItem; text: unknown },
  item: WireItem,
) {
  if (record.kind !== itemKind(item)) return false;
  const recordItem = /** @type {UnknownRecord} */ record.item;
  if (
    itemIdentity(recordItem) &&
    itemIdentity(recordItem) === itemIdentity(item)
  )
    return true;
  const streamed = String(record.text ?? "");
  const terminal = itemText(item);
  return (
    streamed.length > 0 &&
    terminal.length > 0 &&
    (streamed === terminal ||
      streamed.startsWith(terminal) ||
      terminal.startsWith(streamed))
  );
}

/**
 * Some compatible gateways omit `response.output_item.added/done`, or terminal output indexes drift
 * when a reasoning item is inserted. Normalize only the missing framing; Pi remains authoritative for item semantics.
 * @param {AsyncIterable<unknown>} source
 * @param {{ responseModel?: string }} [meta]
 */
async function* normalizedResponseEvents(
  source: AsyncIterable<unknown>,
  meta: ResponseWireMeta = {},
  options: {
    serverToolTypes?: ReadonlySet<string>;
    onServerToolUsage?: (usage: ServerToolUsage) => void;
  } = {},
): AsyncGenerator<UnknownRecord> {
  const open = new Map<number, { kind: string | undefined; item: WireItem; text: string }>();
  const completed = new Set<string>();
  const completedWireItems = new Map<number, unknown>();
  const serverToolIds = new Map<string, Set<string>>();
  const citations = new Map<string, string>();
  const observeCitation = (candidate: unknown) => {
    if (!isObject(candidate)) return;
    try {
      const url = new URL(String(candidate.url ?? ""));
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      const title = typeof candidate.title === "string"
        ? candidate.title.replace(/[\r\n]+/gu, " ").trim()
        : "";
      if (!citations.has(url.href)) citations.set(url.href, title);
    } catch {}
  };
  const observeCitations = (item: unknown) => {
    if (!isObject(item)) return;
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (!isObject(part) || part.type !== "output_text" || !Array.isArray(part.annotations))
          continue;
        for (const annotation of part.annotations)
          if (isObject(annotation) && annotation.type === "url_citation")
            observeCitation(annotation);
      }
    }
    // Search candidates are not answer citations. Only output_text annotations qualify.
  };
  const isServerToolItem = (value: unknown): value is WireItem =>
    isObject(value) && options.serverToolTypes?.has(String(value.type ?? "")) === true;
  const observeServerTool = (item: WireItem) => {
    const type = String(item.type);
    let ids = serverToolIds.get(type);
    if (!ids) {
      ids = new Set();
      serverToolIds.set(type, ids);
    }
    ids.add(typeof item.id === "string" && item.id ? item.id : `${type}:${ids.size}`);
  };
  /** @param {number} index @param {UnknownRecord} item */
  const ensure = function* (
    index: number,
    item: WireItem,
  ): Generator<UnknownRecord, { kind: string | undefined; item: WireItem; text: string }, void> {
    let record = open.get(index);
    if (record) return record;
    const normalized = normalizedTerminalItem(item, index);
    record = { kind: itemKind(normalized), item: normalized, text: "" };
    open.set(index, record);
    yield {
      type: "response.output_item.added",
      output_index: index,
      item: addedShell(normalized, index),
    };
    return record;
  };

  for await (const raw of source) {
    if (!isObject(raw)) continue;
    const event = /** @type {UnknownRecord} */ raw;
    const index = Number.isInteger(event.output_index)
      ? Number(event.output_index)
      : 0;
    if (event.type === "response.output_item.done" && isObject(event.item))
      completedWireItems.set(index, structuredClone(event.item));
    if (
      (event.type === "response.output_item.added" ||
        event.type === "response.output_item.done") &&
      isServerToolItem(event.item)
    ) {
      observeServerTool(event.item);
      continue;
    }
    if (event.type === "response.output_item.added" && isObject(event.item)) {
      const item = normalizedTerminalItem(event.item as WireItem, index);
      open.set(index, { kind: itemKind(item), item, text: itemText(item) });
      yield { ...event, item };
      continue;
    }
    if (event.type === "response.output_text.delta") {
      let record = open.get(index);
      if (!record) {
        const item = {
          type: "message",
          id:
            typeof event.item_id === "string"
              ? event.item_id
              : `msg_lcx_${index}`,
        };
        const generated = ensure(index, item);
        let next = generated.next();
        while (!next.done) {
          yield next.value;
          next = generated.next();
        }
        record = next.value;
      }
      record.text = String(record.text ?? "") + String(event.delta ?? "");
      yield event;
      continue;
    }
    if (
      event.type === "response.reasoning_summary_text.delta" ||
      event.type === "response.reasoning_text.delta"
    ) {
      let record = open.get(index);
      if (!record) {
        const item = {
          type: "reasoning",
          id:
            typeof event.item_id === "string"
              ? event.item_id
              : `rs_lcx_${index}`,
        };
        const generated = ensure(index, item);
        let next = generated.next();
        while (!next.done) {
          yield next.value;
          next = generated.next();
        }
        record = next.value;
      }
      record.text = String(record.text ?? "") + String(event.delta ?? "");
      yield event;
      continue;
    }
    if (event.type === "response.function_call_arguments.delta") {
      let record = open.get(index);
      if (!record) {
        const item = {
          type: "function_call",
          id:
            typeof event.item_id === "string"
              ? event.item_id
              : `fc_lcx_${index}`,
          call_id:
            typeof event.call_id === "string"
              ? event.call_id
              : `call_lcx_${index}`,
          name: String(event.name ?? ""),
        };
        const generated = ensure(index, item);
        let next = generated.next();
        while (!next.done) {
          yield next.value;
          next = generated.next();
        }
        record = next.value;
      }
      record.text = String(record.text ?? "") + String(event.delta ?? "");
      yield event;
      continue;
    }
    if (event.type === "response.custom_tool_call_input.delta") {
      let record = open.get(index);
      if (!record) {
        const item = {
          type: "custom_tool_call",
          id:
            typeof event.item_id === "string"
              ? event.item_id
              : `ctc_lcx_${index}`,
          call_id:
            typeof event.call_id === "string"
              ? event.call_id
              : `call_lcx_${index}`,
          name: String(event.name ?? ""),
        };
        const generated = ensure(index, item);
        let next = generated.next();
        while (!next.done) {
          yield next.value;
          next = generated.next();
        }
        record = next.value;
      }
      record.text = String(record.text ?? "") + String(event.delta ?? "");
      yield event;
      continue;
    }
    if (event.type === "response.output_item.done" && isObject(event.item)) {
      const item = normalizedTerminalItem(event.item as WireItem, index);
      const identity = itemIdentity(item);
      if (identity) completed.add(identity);
      open.delete(index);
      yield { ...event, item };
      continue;
    }
    if (
      (event.type === "response.completed" ||
        event.type === "response.incomplete") &&
      isObject(event.response)
    ) {
      const response = /** @type {UnknownRecord} */ event.response;
      if (typeof response.model === "string" && response.model.length > 0)
        meta.responseModel = response.model;
      const terminalOutput = Array.isArray(response.output) && response.output.length > 0
        ? response.output
        : [...completedWireItems.entries()]
            .sort(([left], [right]) => left - right)
            .map(([, item]) => item);
      const nativeOutput = terminalOutput.map((item) => structuredClone(item));
      const nativeVisibleAdditions: unknown[] = [];
      for (const item of terminalOutput) {
        observeCitations(item);
        if (isServerToolItem(item)) observeServerTool(item);
      }
      const output = terminalOutput
        .filter((item) => !isServerToolItem(item))
        .map((item: unknown, terminalIndex: number) =>
          isObject(item)
            ? normalizedTerminalItem(item as WireItem, terminalIndex)
            : item,
        );
      if (options.serverToolTypes && citations.size > 0) {
        const visibleText = output
          .filter(isObject)
          .map((item) => itemText(item as WireItem))
          .join("\n");
        const missing = [...citations].filter(([url]) => !visibleText.includes(url));
        if (missing.length > 0) {
          const suffix = missing
            .map(([url, title]) => `- ${title ? `${title}: ` : ""}${url}`)
            .join("\n");
          const responseId = String(response.id ?? "native")
            .replace(/[^A-Za-z0-9_-]/gu, "_")
            .slice(0, 40);
          const fallbackItem = {
            type: "message",
            id: `msg_lcx_sources_${responseId}`.slice(0, 64),
            role: "assistant",
            status: "completed",
            content: [{
              type: "output_text",
              text: `\n\nSources:\n${suffix}`,
              annotations: [],
            }],
          };
          output.push(fallbackItem);
          nativeVisibleAdditions.push(structuredClone(fallbackItem));
        }
      }
      if (
        event.type === "response.completed" &&
        response.status === "completed" &&
        options.serverToolTypes
      ) {
        meta.nativeOutput = nativeOutput;
        meta.nativeVisibleAdditions = nativeVisibleAdditions;
      }
      const used = new Set();
      for (const [streamIndex, record] of open) {
        let terminalIndex = output.findIndex(
          (item: unknown, candidateIndex: unknown) =>
            !used.has(candidateIndex) &&
            isObject(item) &&
            candidateIndex === streamIndex &&
            recordMatches(record, item as WireItem),
        );
        if (terminalIndex < 0)
          terminalIndex = output.findIndex(
            (item: unknown, candidateIndex: unknown) =>
              !used.has(candidateIndex) &&
              isObject(item) &&
              recordMatches(record, item as WireItem),
          );
        const item =
          terminalIndex >= 0
            ? output[terminalIndex] as WireItem
            : normalizedTerminalItem(record.item, streamIndex);
        if (terminalIndex >= 0) used.add(terminalIndex);
        yield {
          type: "response.output_item.done",
          output_index: streamIndex,
          item,
        };
        const identity = itemIdentity(item);
        if (identity) completed.add(identity);
      }
      open.clear();
      for (const [terminalIndex, candidate] of output.entries()) {
        if (
          !isObject(candidate) ||
          !itemKind(candidate as WireItem) ||
          used.has(terminalIndex)
        )
          continue;
        const item = candidate as WireItem;
        const identity = itemIdentity(item);
        if (identity && completed.has(identity)) continue;
        yield {
          type: "response.output_item.added",
          output_index: terminalIndex,
          item: addedShell(item, terminalIndex),
        };
        const text = itemText(item);
        if (text) {
          if (item.type === "message")
            yield {
              type: "response.output_text.delta",
              output_index: terminalIndex,
              content_index: 0,
              item_id: item.id,
              delta: text,
            };
          else if (item.type === "reasoning")
            yield {
              type: "response.reasoning_summary_text.delta",
              output_index: terminalIndex,
              summary_index: 0,
              item_id: item.id,
              delta: text,
            };
          else if (item.type === "function_call")
            yield {
              type: "response.function_call_arguments.delta",
              output_index: terminalIndex,
              item_id: item.id,
              call_id: item.call_id,
              name: item.name,
              delta: text,
            };
          else
            yield {
              type: "response.custom_tool_call_input.delta",
              output_index: terminalIndex,
              item_id: item.id,
              call_id: item.call_id,
              name: item.name,
              delta: text,
            };
        }
        yield {
          type: "response.output_item.done",
          output_index: terminalIndex,
          item,
        };
        if (identity) completed.add(identity);
      }
      if (options.onServerToolUsage) {
        const usage = isObject(response.usage) ? response.usage : {};
        const details = isObject(usage.server_side_tool_usage_details)
          ? usage.server_side_tool_usage_details
          : {};
        const safeCount = (value: unknown, fallback: number) =>
          Number.isSafeInteger(value) && Number(value) >= 0
            ? Number(value)
            : fallback;
        const webSearchCalls = safeCount(
          details.web_search_calls,
          serverToolIds.get("web_search_call")?.size ?? 0,
        );
        const xSearchCalls = safeCount(
          details.x_search_calls,
          serverToolIds.get("x_search_call")?.size ?? 0,
        );
        const total = safeCount(
          usage.num_server_side_tools_used,
          webSearchCalls + xSearchCalls,
        );
        if (total > 0 || webSearchCalls > 0 || xSearchCalls > 0)
          options.onServerToolUsage({ webSearchCalls, xSearchCalls, total });
      }
      yield { ...event, response: { ...response, output } };
      continue;
    }
    yield event;
  }
}

/** @param {unknown} usage */
function isManagedFailure(value: unknown): value is ManagedFailure {
  return (
    isObject(value) &&
    typeof value.message === "string" &&
    typeof value.code === "string" &&
    (value.status === undefined || typeof value.status === "number") &&
    (value.requestId === undefined || typeof value.requestId === "string") &&
    (value.providerRetryAfterMs === undefined ||
      typeof value.providerRetryAfterMs === "number")
  );
}

function dshUsage(usage: unknown) {
  const value = /** @type {UnknownRecord} */ isObject(usage) ? usage : {};
  return {
    inputTokens: Number(value.input ?? 0),
    outputTokens: Number(value.output ?? 0),
    ...(Number(value.cacheRead ?? 0) > 0
      ? { cacheReadTokens: Number(value.cacheRead) }
      : {}),
    ...(Number(value.cacheWrite ?? 0) > 0
      ? { cacheWriteTokens: Number(value.cacheWrite) }
      : {}),
    ...(Number(value.reasoning ?? 0) > 0
      ? { reasoningTokens: Number(value.reasoning) }
      : {}),
  };
}

/** @param {unknown} value */
function rawArguments(value: unknown) {
  try {
    return JSON.stringify(isObject(value) ? value : {});
  } catch {
    return "{}";
  }
}

/** @param {unknown} message */
function replayState(
  message: UnknownRecord,
  nativeOutput?: readonly unknown[],
  nativeVisibleAdditions?: readonly unknown[],
  nativeReplayRoute?: GrokNativeReplayRoute,
) {
  if (!isObject(message)) return undefined;
  const content: UnknownRecord[] = Array.isArray(message.content)
    ? message.content.filter(isObject)
    : [];
  const provider =
    typeof message.provider === "string" ? message.provider : undefined;
  const model = typeof message.model === "string" ? message.model : undefined;
  const api = typeof message.api === "string" ? message.api : undefined;
  if (!provider || !model || !api) return undefined;
  const grokNative = createGrokNativeReplayEnvelope(
    nativeOutput,
    nativeReplayRoute,
    nativeVisibleAdditions,
  );
  return {
    response: {
      kind: "pi-ai",
      version: 2,
      api,
      provider,
      model,
      ...(typeof message.responseModel === "string"
        ? { responseModel: message.responseModel }
        : {}),
      ...(typeof message.responseId === "string"
        ? { responseId: message.responseId }
        : {}),
      stopReason: message.stopReason,
    },
    blocks: content.map((block) => {
        if (block?.type === "text")
          return {
            type: "text",
            ...(typeof block.textSignature === "string"
              ? { textSignature: block.textSignature }
              : {}),
          };
        if (block?.type === "thinking")
          return {
            type: "reasoning",
            ...(typeof block.thinkingSignature === "string"
              ? { thinkingSignature: block.thinkingSignature }
              : {}),
            ...(typeof block.redacted === "boolean"
              ? { redacted: block.redacted }
              : {}),
          };
        return {
          type: "tool-call",
          ...(typeof block?.thoughtSignature === "string"
            ? { thoughtSignature: block.thoughtSignature }
            : {}),
          ...(typeof block?.namespace === "string" && block.namespace.length > 0
            ? { namespace: block.namespace }
            : {}),
        };
      },
    ),
    ...(grokNative === undefined ? {} : { grokNative }),
  };
}

/** @param {unknown} message */
function successfulFinish(message: unknown): FinishReason {
  const value = /** @type {UnknownRecord} */ isObject(message) ? message : {};
  const stopReason = String(value.stopReason ?? "stop");
  const content = /** @type {UnknownRecord[]} */ Array.isArray(value.content)
    ? value.content.filter(isObject)
    : [];
  if (stopReason === "length") return { kind: "max-tokens" };
  if (
    stopReason === "toolUse" ||
    content.some((block) => block.type === "toolCall")
  )
    return { kind: "tool-calls" };
  if (stopReason === "stop" && content.length === 0)
    return {
      kind: "error",
      failure: {
        message: "Responses provider completed without content",
        code: "EMPTY_RESPONSE",
      },
    };
  return { kind: "stop" };
}

/**
 * Pi event vocabulary -> DSH StreamChunk. This remains thin and provider-neutral.
 * @param {AsyncIterable<AssistantMessageEvent>} events
 * @param {AbortSignal} [signal]
 */
async function* toDshChunks(
  events: AsyncIterable<AssistantMessageEvent>,
  signal?: AbortLike,
  wireMeta?: ResponseWireMeta,
  nativeReplayRoute?: GrokNativeReplayRoute,
): AsyncGenerator<StreamChunk> {
  const toolIds = new Map<number, { id: string; name: string }>();
  for await (const event of events) {
    switch (event.type) {
      case "start":
        break;
      case "text_start":
        yield {
          type: "block-start",
          index: Number(event.contentIndex),
          blockType: "text",
        };
        break;
      case "text_delta":
        yield {
          type: "text-delta",
          index: Number(event.contentIndex),
          text: String(event.delta ?? ""),
        };
        break;
      case "text_end":
        yield {
          type: "block-end",
          index: Number(event.contentIndex),
          block: { type: "text", text: String(event.content ?? "") },
        };
        break;
      case "thinking_start":
        yield {
          type: "block-start",
          index: Number(event.contentIndex),
          blockType: "reasoning",
        };
        break;
      case "thinking_delta":
        yield {
          type: "reasoning-delta",
          index: Number(event.contentIndex),
          text: String(event.delta ?? ""),
        };
        break;
      case "thinking_end":
        yield {
          type: "block-end",
          index: Number(event.contentIndex),
          block: { type: "reasoning", text: String(event.content ?? "") },
        };
        break;
      case "toolcall_start": {
        const partial = /** @type {UnknownRecord | undefined} */ isObject(
          event.partial,
        )
          ? event.partial
          : undefined;
        const content = Array.isArray(partial?.content) ? partial.content : [];
        const item = content[Number(event.contentIndex)];
        const block = isObject(item) ? item : undefined;
        toolIds.set(Number(event.contentIndex), {
          id: String(block?.id ?? ""),
          name: String(block?.name ?? ""),
        });
        yield {
          type: "block-start",
          index: Number(event.contentIndex),
          blockType: "tool-call",
        };
        break;
      }
      case "toolcall_delta": {
        const known = toolIds.get(Number(event.contentIndex)) ?? {
          id: "",
          name: "",
        };
        yield {
          type: "tool-call-delta",
          index: Number(event.contentIndex),
          id: ToolCallId(known.id),
          ...(known.name ? { name: known.name } : {}),
          argumentsDelta: String(event.delta ?? ""),
        };
        break;
      }
      case "toolcall_end": {
        const call: UnknownRecord = isObject(event.toolCall)
          ? event.toolCall
          : {};
        yield {
          type: "block-end",
          index: Number(event.contentIndex),
          block: {
            type: "tool-call",
            id: ToolCallId(String(call.id ?? "")),
            name: String(call.name ?? ""),
            arguments: rawArguments(call.arguments),
          },
        };
        break;
      }
      case "done": {
        const message: UnknownRecord = isObject(event.message)
          ? event.message
          : {};
        yield { type: "usage", usage: dshUsage(message.usage) };
        const reason = successfulFinish(message);
        const replay = reason.kind === "error"
          ? undefined
          : replayState(
              message,
              wireMeta?.nativeOutput,
              wireMeta?.nativeVisibleAdditions,
              nativeReplayRoute,
            );
        yield {
          type: "finish",
          reason,
          ...(replay === undefined ? {} : { replayState: replay }),
        };
        return;
      }
      case "error": {
        const message: UnknownRecord = isObject(event.error)
          ? event.error
          : {};
        yield { type: "usage", usage: dshUsage(message.usage) };
        const failure = isManagedFailure(message.__lcxFailure)
          ? message.__lcxFailure
          : managedFailure(
              Object.assign(
                new Error(
                  String(message.errorMessage ?? "Responses stream failed"),
                ),
                {
                  code:
                    message.stopReason === "aborted"
                      ? "LCX_ABORTED"
                      : undefined,
                },
              ),
              signal,
            );
        const normalizedFailure: LlmFailure = {
          message: String(failure.message ?? "Responses stream failed"),
          code: String(failure.code ?? "RESPONSES_ERROR"),
          ...(typeof failure.status === "number" ? { status: failure.status } : {}),
          ...(typeof failure.providerRetryAfterMs === "number"
            ? { providerRetryAfterMs: failure.providerRetryAfterMs }
            : {}),
        };
        yield {
          type: "finish",
          reason:
            normalizedFailure.code === "ABORTED"
              ? { kind: "aborted", failure: normalizedFailure }
              : { kind: "error", failure: normalizedFailure },
        };
        return;
      }
      default:
        break;
    }
  }
  yield managedFailureChunk(
    Object.assign(
      new Error("Responses event stream ended without done/error"),
      { code: "LCX_INVALID_SSE" },
    ),
    signal,
  );
}

/**
 * Send one LCX-owned OpenAI Responses request. Ordinary and replay use one provider attempt;
 * the DSH agent recovery layer remains the visible retry owner.
 * @param {object} options
 * @param {string} options.baseURL
 * @param {string} options.provider
 * @param {string} options.model
 * @param {UnknownRecord} options.piModel
 * @param {UnknownRecord} options.body
 * @param {Map<string, string>} [options.grammarToolInputProperties]
 * @param {Record<string, string>} [options.headers]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxAttempts]
 * @param {number} [options.maxResponseBytes]
 * @param {ReadonlySet<string>} [options.serverToolTypes]
 * @param {(usage: ServerToolUsage) => void} [options.onServerToolUsage]
 */
export async function* streamResponsesRequest({
  baseURL,
  provider,
  model,
  piModel,
  body,
  grammarToolInputProperties,
  headers,
  signal,
  timeoutMs,
  applyDefaultTimeout = true,
  streamIdleTimeoutMs,
  maxAttempts = 1,
  maxResponseBytes,
  serverToolTypes,
  nativeReplayRoute,
  onServerToolUsage,
}: StreamRequestOptions) {
  const effectiveTimeoutMs = timeoutMs ?? (applyDefaultTimeout ? 300_000 : undefined);
  const deadline = requestDeadline(signal, effectiveTimeoutMs);
  const watchdog = streamIdleWatchdog(deadline.signal, streamIdleTimeoutMs);
  try {
    // Match DSH's idleWatchdog.next(): the first outstanding next includes
    // request dispatch and headers, and later intervals cover one DSH chunk.
    watchdog.arm();
    const response = await fetchSseWithRetry(
      `${String(baseURL).replace(/\/+$/u, "")}/responses`,
      body,
      headers,
      watchdog.signal,
      undefined,
      { maxAttempts, maxResponseBytes, applyDefaultTimeout: false },
    );
    const output: PiOutput = {
      role: "assistant",
      content: [],
      api: "openai-responses",
      provider,
      model,
      usage: emptyUsage(),
      stopReason: "pending",
      timestamp: Date.now(),
    };
    const piEvents = createAssistantMessageEventStream();
    const wireMeta: ResponseWireMeta = {};
    const parser = (async () => {
      try {
        piEvents.push({ type: "start", partial: output });
        await processResponsesStream(
          validatedResponseEvents(
            normalizedResponseEvents(
              responseEvents(response, {
                signal: watchdog.signal,
                maxResponseBytes,
              }),
              wireMeta,
              { serverToolTypes, onServerToolUsage },
            ),
          ),
          output,
          piEvents,
          piModel,
          { grammarToolInputProperties },
        );
        if (
          typeof wireMeta.responseModel === "string" &&
          wireMeta.responseModel.length > 0
        )
          output.responseModel = wireMeta.responseModel;
        if (signal?.aborted)
          throw (
            signal.reason ??
            Object.assign(new Error("request aborted"), { code: "LCX_ABORTED" })
          );
        if (output.stopReason === "pending")
          throw Object.assign(
            new Error("Responses stream ended without a stop reason"),
            { code: "LCX_INVALID_SSE" },
          );
        if (output.stopReason === "aborted" || output.stopReason === "error")
          throw new Error("Responses stream ended in failure");
        piEvents.push({
          type: "done",
          reason: output.stopReason,
          message: output,
        });
        piEvents.end();
      } catch (error) {
        output.stopReason = signal?.aborted ? "aborted" : "error";
        output.errorMessage =
          error instanceof Error ? error.message : "Responses stream failed";
        output.__lcxFailure = managedFailure(error, signal);
        piEvents.push({
          type: "error",
          reason: /** @type {'aborted' | 'error'} */ output.stopReason,
          error: output,
        });
        piEvents.end();
      }
    })();
    const chunks = toDshChunks(
      piEvents,
      signal,
      wireMeta,
      nativeReplayRoute,
    )[Symbol.asyncIterator]();
    let exhausted = false;
    try {
      while (true) {
        const result = await chunks.next();
        if (watchdog.signal.aborted) throw watchdog.signal.reason;
        if (result.done) {
          exhausted = true;
          watchdog.disarm();
          break;
        }
        watchdog.disarm();
        yield result.value;
        watchdog.arm();
      }
    } finally {
      watchdog.disarm();
      if (!exhausted) await chunks.return?.(undefined);
    }
    await parser;
  } catch (error) {
    yield managedFailureChunk(error, signal);
  } finally {
    watchdog.dispose();
    deadline.dispose();
  }
}
