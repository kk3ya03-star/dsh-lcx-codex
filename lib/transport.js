const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

export function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('request aborted'), { code: 'LCX_ABORTED' })
}
function makeError(message, code, extra = {}) { const error = new Error(message); error.code = code; Object.assign(error, extra); return error }
function retryableStatus(status) { return status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599) }
function delayFromHeaders(headers, attempt) {
  const millis = Number(headers?.get?.('retry-after-ms')); if (Number.isFinite(millis) && millis >= 0) return Math.min(millis, 30_000)
  const retryAfter = headers?.get?.('retry-after'); if (retryAfter) { const seconds = Number(retryAfter); if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000); const date = Date.parse(retryAfter); if (!Number.isNaN(date)) return Math.min(Math.max(0, date - Date.now()), 30_000) }
  return Math.min(10_000, 500 * 2 ** Math.max(0, attempt - 1))
}
async function sleep(ms, signal) { if (ms <= 0) return; await new Promise((resolve, reject) => { if (signal?.aborted) return reject(signal.reason); const timer = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true }) }) }
function combinedSignal(signal, timeoutMs) { if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) return signal; const timeout = AbortSignal.timeout(timeoutMs); return signal ? AbortSignal.any([signal, timeout]) : timeout }
async function readLimited(response, maxBytes = DEFAULT_MAX_BYTES) { const buffer = new Uint8Array(await response.arrayBuffer()); if (buffer.byteLength > maxBytes) throw makeError(`response exceeds ${maxBytes} bytes`, 'LCX_RESPONSE_TOO_LARGE', { status: response.status }); return new TextDecoder().decode(buffer) }

export async function fetchJsonWithRetry(url, body, headers = {}, signal, timeoutMs = DEFAULT_TIMEOUT_MS, options = {}) {
  const maxAttempts = Math.max(1, Math.min(6, Number(options.maxAttempts ?? 3))); const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_BYTES; let last
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    abortIfNeeded(signal)
    try {
      const requestSignal = combinedSignal(signal, timeoutMs)
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: JSON.stringify(body), signal: requestSignal })
      const text = await readLimited(response, maxResponseBytes); let parsed
      try { parsed = text ? JSON.parse(text) : {} } catch (cause) { throw makeError(`invalid JSON response from ${url}`, 'LCX_INVALID_JSON', { status: response.status, cause }) }
      if (!response.ok) {
        const message = parsed?.error?.message ?? parsed?.message ?? `HTTP ${response.status}`; const error = makeError(message, retryableStatus(response.status) ? 'LCX_HTTP_RETRYABLE' : 'LCX_HTTP_ERROR', { status: response.status, retryable: retryableStatus(response.status), requestId: response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined })
        if (!error.retryable || attempt >= maxAttempts) throw error; last = error; await sleep(delayFromHeaders(response.headers, attempt), signal); continue
      }
      return parsed
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      const retryable = error?.retryable === true || error?.code === 'LCX_HTTP_RETRYABLE' || error instanceof TypeError || ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT'].includes(error?.code)
      if (!retryable || attempt >= maxAttempts) { if (attempt >= maxAttempts && retryable) throw makeError(`request failed after ${maxAttempts} attempts: ${error?.message ?? String(error)}`, 'LCX_RETRY_EXHAUSTED', { cause: error, retryable: true }); throw error }
      last = error; await sleep(Math.min(10_000, 500 * 2 ** (attempt - 1)), signal)
    }
  }
  throw last ?? makeError('request failed', 'LCX_REQUEST_FAILED')
}

export async function fetchSseWithRetry(url, body, headers = {}, signal, timeoutMs = DEFAULT_TIMEOUT_MS, options = {}) {
  const maxAttempts = Math.max(1, Math.min(6, Number(options.maxAttempts ?? 3))); let last
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    abortIfNeeded(signal)
    try {
      const requestSignal = combinedSignal(signal, timeoutMs)
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...headers }, body: JSON.stringify(body), signal: requestSignal })
      if (!response.ok) {
        const text = await readLimited(response, Math.min(options.maxResponseBytes ?? DEFAULT_MAX_BYTES, 512 * 1024)); let message = `HTTP ${response.status}`
        try { message = JSON.parse(text)?.error?.message ?? JSON.parse(text)?.message ?? message } catch { if (text.trim()) message = text.slice(0, 1000) }
        const retryable = retryableStatus(response.status); const error = makeError(message, retryable ? 'LCX_HTTP_RETRYABLE' : 'LCX_HTTP_ERROR', { status: response.status, retryable })
        if (!retryable || attempt >= maxAttempts) throw error; last = error; await sleep(delayFromHeaders(response.headers, attempt), signal); continue
      }
      if (typeof options.consume === 'function') return await options.consume(response, { requestSignal }); return response
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      const retryable = error?.retryable === true || error?.code === 'LCX_HTTP_RETRYABLE' || error instanceof TypeError || ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT'].includes(error?.code)
      if (!retryable || attempt >= maxAttempts) { if (attempt >= maxAttempts && retryable) throw makeError(`request failed after ${maxAttempts} attempts: ${error?.message ?? String(error)}`, 'LCX_RETRY_EXHAUSTED', { cause: error, retryable: true }); throw error }
      last = error; await sleep(Math.min(10_000, 500 * 2 ** (attempt - 1)), signal)
    }
  }
  throw last ?? makeError('request failed', 'LCX_REQUEST_FAILED')
}

export async function consumeSse(response, onEvent, options = {}) {
  if (!response?.body) throw makeError('SSE response has no body', 'LCX_INVALID_SSE')
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_BYTES; const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = ''; let dataLines = []; let bytes = 0
  const dispatch = () => { if (dataLines.length === 0) return; const data = dataLines.join('\n'); dataLines = []; if (data === '[DONE]') return; let event; try { event = JSON.parse(data) } catch (cause) { throw makeError('malformed SSE JSON', 'LCX_INVALID_SSE', { cause }) } onEvent(event) }
  try {
    while (true) { abortIfNeeded(options.signal); const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > maxBytes) throw makeError(`SSE response exceeds ${maxBytes} bytes`, 'LCX_RESPONSE_TOO_LARGE'); pending += decoder.decode(value, { stream: true }); let newline; while ((newline = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, newline).replace(/\r$/u, ''); pending = pending.slice(newline + 1); if (line === '') dispatch(); else if (!line.startsWith(':') && line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /u, '')) } }
    pending += decoder.decode(); if (pending.startsWith('data:')) dataLines.push(pending.slice(5).replace(/^ /u, '')); dispatch()
  } finally { await reader.cancel().catch(() => undefined) }
}
