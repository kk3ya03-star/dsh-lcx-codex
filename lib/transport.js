import { setTimeout as delay } from 'node:timers/promises'

const MAX_RETRY_DELAY_MS = 30_000
const combinedSignalStates = new WeakMap()

export class LcxHttpError extends Error {
  constructor(message, { code = 'LCX_HTTP_ERROR', status, retryable = false, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'LcxHttpError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

export function abortIfNeeded(signal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('request aborted')
  }
}

function responseDetail(body) {
  try {
    const parsed = JSON.parse(body)
    if (typeof parsed?.error === 'string') return parsed.error
    if (typeof parsed?.error?.message === 'string') return parsed.error.message
    if (typeof parsed?.message === 'string') return parsed.message
  } catch {
    // The status and a bounded body preview are enough when the gateway did not return JSON.
  }
  return String(body ?? '').replace(/\s+/gu, ' ').trim().slice(0, 500)
}

function retryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599)
}

function combinedSignal(signal, timeoutMs) {
  const controller = new AbortController()
  let timer
  const abort = (reason) => {
    if (controller.signal.aborted) return
    if (timer !== undefined) globalThis.clearTimeout(timer)
    combinedSignalStates.delete(controller.signal)
    signal?.removeEventListener('abort', onCallerAbort)
    controller.abort(reason)
  }
  const onCallerAbort = () => abort(signal.reason)
  if (Number.isFinite(timeoutMs)) {
    timer = globalThis.setTimeout(() => {
      abort(new DOMException(`The operation was aborted due to timeout`, 'TimeoutError'))
    }, Math.max(0, timeoutMs))
    timer.unref?.()
  }
  combinedSignalStates.set(controller.signal, { timer, callerSignal: signal, onCallerAbort })
  if (signal?.aborted) abort(signal.reason)
  else signal?.addEventListener('abort', onCallerAbort, { once: true })
  return controller.signal
}

function holdSignal(signal) {
  combinedSignalStates.get(signal)?.timer?.ref?.()
}

function releaseSignal(signal) {
  const state = combinedSignalStates.get(signal)
  if (!state) return
  if (state.timer !== undefined) globalThis.clearTimeout(state.timer)
  state.callerSignal?.removeEventListener('abort', state.onCallerAbort)
  combinedSignalStates.delete(signal)
}

function retryAfterMilliseconds(response) {
  const value = response?.headers?.get?.('retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_DELAY_MS, Math.ceil(seconds * 1000))
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.min(MAX_RETRY_DELAY_MS, Math.max(0, date - Date.now())) : undefined
}

function timeoutError(timeoutMs, cause) {
  return new LcxHttpError(`LCX request timed out after ${timeoutMs} ms`, { code: 'LCX_TIMEOUT', retryable: true, cause })
}

function abortRequestIfNeeded(requestSignal, callerSignal, timeoutMs) {
  abortIfNeeded(callerSignal)
  if (!requestSignal?.aborted) return
  if (requestSignal.reason?.name === 'TimeoutError') throw timeoutError(timeoutMs, requestSignal.reason)
  throw requestSignal.reason instanceof Error ? requestSignal.reason : new Error('request aborted')
}

function retryWaitMilliseconds(error, baseDelayMs, attempt) {
  const retryAfter = Number(error?.retryAfterMs)
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(MAX_RETRY_DELAY_MS, retryAfter)
  const exponential = baseDelayMs * (2 ** (attempt - 1))
  return Number.isFinite(exponential) && exponential >= 0 ? Math.min(MAX_RETRY_DELAY_MS, exponential) : MAX_RETRY_DELAY_MS
}

async function readLimitedText(response, maxResponseBytes, signal, label) {
  if (!response?.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parts = []
  let bytes = 0
  const cancel = () => { reader.cancel(signal?.reason).catch(() => undefined) }
  try {
    signal?.addEventListener('abort', cancel, { once: true })
    while (true) {
      abortIfNeeded(signal)
      const result = await reader.read()
      abortIfNeeded(signal)
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > maxResponseBytes) {
        throw new LcxHttpError(`LCX ${label} response exceeds ${maxResponseBytes} bytes`, { code: 'LCX_RESPONSE_TOO_LARGE', status: response.status })
      }
      parts.push(decoder.decode(result.value, { stream: true }))
    }
    parts.push(decoder.decode())
    return parts.join('')
  } finally {
    signal?.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => undefined)
  }
}

function normalizeReadError(error, requestSignal, timeoutMs) {
  if (requestSignal?.aborted && requestSignal.reason?.name === 'TimeoutError') return timeoutError(timeoutMs, error)
  return error
}

function abortableResponse(response, requestSignal, callerSignal, timeoutMs, ownsRequestSignal = false) {
  if (!response?.body || !requestSignal) return response
  const source = response.body
  const reader = source.getReader()
  let abortError
  let cleanedUp = false
  let pendingReadReject
  let onAbort
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    requestSignal.removeEventListener('abort', onAbort)
    if (ownsRequestSignal) releaseSignal(requestSignal)
  }
  const abort = () => {
    if (abortError) return
    abortError = callerSignal?.aborted
      ? (callerSignal.reason instanceof Error ? callerSignal.reason : new Error('request aborted'))
      : requestSignal.reason?.name === 'TimeoutError'
        ? timeoutError(timeoutMs, requestSignal.reason)
        : (requestSignal.reason instanceof Error ? requestSignal.reason : new Error('request aborted'))
    cleanup()
    pendingReadReject?.(abortError)
    reader.cancel(abortError).catch(() => undefined)
  }
  onAbort = abort
  const stream = new ReadableStream({
    start(controller) {
      if (requestSignal.aborted) {
        abort()
        controller.error(abortError)
      } else {
        requestSignal.addEventListener('abort', onAbort, { once: true })
      }
    },
    async pull(controller) {
      if (abortError) return
      try {
        const result = await new Promise((resolve, reject) => {
          pendingReadReject = reject
          reader.read().then(resolve, reject)
        })
        pendingReadReject = undefined
        if (abortError) return
        if (result.done) {
          cleanup()
          controller.close()
        } else {
          controller.enqueue(result.value)
        }
      } catch (error) {
        pendingReadReject = undefined
        cleanup()
        controller.error(abortError ?? error)
      }
    },
    cancel(reason) {
      cleanup()
      reader.cancel(reason).catch(() => undefined)
    },
  })
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export async function fetchJson(url, body, headers, signal, timeoutMs, options = {}) {
  abortIfNeeded(signal)
  const maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024
  const requestSignal = options.requestSignal ?? combinedSignal(signal, timeoutMs)
  const ownsRequestSignal = !options.requestSignal
  if (ownsRequestSignal) holdSignal(requestSignal)
  try {
    abortRequestIfNeeded(requestSignal, signal, timeoutMs)
    let serializedBody
  try {
    serializedBody = JSON.stringify(body)
  } catch (error) {
    throw new LcxHttpError(`LCX request body is not serializable: ${String(error)}`, { code: 'LCX_INVALID_REQUEST', cause: error })
  }
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
      body: serializedBody,
      signal: requestSignal,
    })
  } catch (error) {
    abortIfNeeded(signal)
    if (requestSignal?.aborted) abortRequestIfNeeded(requestSignal, signal, timeoutMs)
    if (error?.name === 'TimeoutError') throw timeoutError(timeoutMs, error)
    throw error
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    throw new LcxHttpError(`LCX response exceeds ${maxResponseBytes} bytes`, { code: 'LCX_RESPONSE_TOO_LARGE', status: response.status })
  }

  let text
  try {
    text = await readLimitedText(response, maxResponseBytes, requestSignal, 'JSON')
  } catch (error) {
    throw normalizeReadError(error, requestSignal, timeoutMs)
  }
  if (!response.ok) {
    const detail = responseDetail(text)
    const error = new LcxHttpError(`LCX request failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`, {
      code: retryableStatus(response.status) ? 'LCX_HTTP_RETRYABLE' : 'LCX_HTTP_ERROR',
      status: response.status,
      retryable: retryableStatus(response.status),
    })
    error.retryAfterMs = retryAfterMilliseconds(response)
    throw error
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new LcxHttpError(`LCX returned a non-JSON response: ${String(error)}`, { code: 'LCX_INVALID_JSON', status: response.status, cause: error })
  }
  }
  finally {
    if (ownsRequestSignal) releaseSignal(requestSignal)
  }
}

export async function fetchSse(url, body, headers, signal, timeoutMs, options = {}) {
  abortIfNeeded(signal)
  const maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024
  const requestSignal = options.requestSignal ?? combinedSignal(signal, timeoutMs)
  const ownsRequestSignal = !options.requestSignal
  if (ownsRequestSignal) holdSignal(requestSignal)
  let handedOff = false
  try {
    abortRequestIfNeeded(requestSignal, signal, timeoutMs)
    let serializedBody
    try {
      serializedBody = JSON.stringify(body)
  } catch (error) {
    throw new LcxHttpError(`LCX request body is not serializable: ${String(error)}`, { code: 'LCX_INVALID_REQUEST', cause: error })
  }
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: { accept: 'text/event-stream', 'content-type': 'application/json', ...headers },
      body: serializedBody,
      signal: requestSignal,
    })
  } catch (error) {
    abortIfNeeded(signal)
    if (requestSignal?.aborted) abortRequestIfNeeded(requestSignal, signal, timeoutMs)
    if (error?.name === 'TimeoutError') throw timeoutError(timeoutMs, error)
    throw error
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    throw new LcxHttpError(`LCX SSE response exceeds ${maxResponseBytes} bytes`, { code: 'LCX_RESPONSE_TOO_LARGE', status: response.status })
  }
  if (!response.ok) {
    let text
    try {
      text = await readLimitedText(response, maxResponseBytes, requestSignal, 'SSE')
    } catch (error) {
      throw normalizeReadError(error, requestSignal, timeoutMs)
    }
    const detail = responseDetail(text)
    const error = new LcxHttpError(`LCX request failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`, {
      code: retryableStatus(response.status) ? 'LCX_HTTP_RETRYABLE' : 'LCX_HTTP_ERROR',
      status: response.status,
      retryable: retryableStatus(response.status),
    })
    error.retryAfterMs = retryAfterMilliseconds(response)
    throw error
  }
  if (!response.body) {
    throw new LcxHttpError('LCX SSE response has no body', { code: 'LCX_INVALID_SSE', status: response.status })
  }
    const wrapped = abortableResponse(response, requestSignal, signal, timeoutMs, ownsRequestSignal)
    handedOff = ownsRequestSignal
    return wrapped
  } finally {
    if (ownsRequestSignal && !handedOff) releaseSignal(requestSignal)
  }
}

async function waitForRetry(waitMs, operationSignal, callerSignal, timeoutMs) {
  abortRequestIfNeeded(operationSignal, callerSignal, timeoutMs)
  try {
    await delay(waitMs, undefined, { signal: operationSignal })
  } catch (error) {
    abortRequestIfNeeded(operationSignal, callerSignal, timeoutMs)
    throw error
  }
}

function transientNetworkError(error) {
  if (!error || error.name === 'AbortError' || error.name === 'TimeoutError') return false
  if (error instanceof LcxHttpError) return error.code === 'LCX_HTTP_RETRYABLE' || error.code === 'LCX_TIMEOUT'
  return error.retryable === true || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.code)
}

export async function fetchSseWithRetry(url, body, headers, signal, timeoutMs, options = {}) {
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 3, 6))
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 250)
  const consume = options.consume
  if (typeof consume !== 'function') throw new TypeError('fetchSseWithRetry requires a consume callback')
  const operationSignal = combinedSignal(signal, timeoutMs)
  holdSignal(operationSignal)
  let attempt = 0
  try {
    while (attempt < maxAttempts) {
      attempt += 1
      try {
        abortRequestIfNeeded(operationSignal, signal, timeoutMs)
        const response = await fetchSse(url, body, headers, signal, timeoutMs, { ...options, requestSignal: operationSignal })
        try {
          return await consume(response, { ...options, requestSignal: operationSignal })
        } finally {
          if (response.body) await response.body.cancel().catch(() => undefined)
        }
      } catch (error) {
        abortIfNeeded(signal)
        if (operationSignal.aborted) abortRequestIfNeeded(operationSignal, signal, timeoutMs)
        if (!transientNetworkError(error) || attempt >= maxAttempts) throw error
        await waitForRetry(retryWaitMilliseconds(error, baseDelayMs, attempt), operationSignal, signal, timeoutMs)
      }
    }
    throw new LcxHttpError('LCX SSE retry loop exhausted', { code: 'LCX_RETRY_EXHAUSTED' })
  } finally {
    releaseSignal(operationSignal)
  }
}

export async function fetchJsonWithRetry(url, body, headers, signal, timeoutMs, options = {}) {
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 3, 6))
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 250)
  const operationSignal = combinedSignal(signal, timeoutMs)
  holdSignal(operationSignal)
  let attempt = 0
  try {
    while (attempt < maxAttempts) {
      attempt += 1
      try {
        abortRequestIfNeeded(operationSignal, signal, timeoutMs)
        return await fetchJson(url, body, headers, signal, timeoutMs, { ...options, requestSignal: operationSignal })
      } catch (error) {
        abortIfNeeded(signal)
        if (operationSignal.aborted) abortRequestIfNeeded(operationSignal, signal, timeoutMs)
        if (!transientNetworkError(error) || attempt >= maxAttempts) throw error
        await waitForRetry(retryWaitMilliseconds(error, baseDelayMs, attempt), operationSignal, signal, timeoutMs)
      }
    }
    throw new LcxHttpError('LCX retry loop exhausted', { code: 'LCX_RETRY_EXHAUSTED' })
  } finally {
    releaseSignal(operationSignal)
  }
}
