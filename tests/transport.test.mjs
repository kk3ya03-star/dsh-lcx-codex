import test from 'node:test'
import assert from 'node:assert/strict'
import { consumeSse, fetchJsonWithRetry, fetchSseWithRetry } from '../lib/transport.js'

for (const [name, transport, status, limit] of [
  ['JSON success', fetchJsonWithRetry, 200, 4],
  ['JSON error', fetchJsonWithRetry, 500, 4],
  ['SSE error', fetchSseWithRetry, 500, 4],
  ['JSON error default cap', fetchJsonWithRetry, 500, undefined],
  ['SSE error default cap', fetchSseWithRetry, 500, undefined],
]) {
  test(`${name} cancels oversized bodies before draining and does not retry`, async (t) => {
    let pulls = 0, cancellations = 0, requests = 0, response
    t.mock.method(globalThis, 'fetch', async () => {
      requests++
      response = new Response(new ReadableStream({
        pull(controller) {
          pulls++
          if (pulls === 100) return controller.close()
          controller.enqueue(new Uint8Array(limit === undefined ? 256 * 1024 : 3))
        },
        cancel() { cancellations++ },
      }, { highWaterMark: 0 }), { status, headers: { 'content-length': '1' } })
      return response
    })
    await assert.rejects(
      transport('https://example.invalid', {}, {}, undefined, 1000, { maxResponseBytes: limit }),
      (error) => error.code === 'LCX_RESPONSE_TOO_LARGE' && error.status === status,
    )
    assert.equal(pulls, limit === undefined ? 3 : 2)
    assert.equal(cancellations, 1)
    assert.equal(requests, 1)
    assert.equal(response.body.locked, false)
  })
}

test('JSON byte limit accepts exact-size UTF-8 split across chunks and an empty body', async (t) => {
  const bytes = new TextEncoder().encode('{"text":"\u4e2d\ud83d\ude00"}')
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  })))
  assert.deepEqual(await fetchJsonWithRetry('https://example.invalid', {}, {}, undefined, 1000,
    { maxResponseBytes: bytes.length }), { text: '\u4e2d\ud83d\ude00' })
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }))
  assert.deepEqual(await fetchJsonWithRetry('https://example.invalid', {}, {}, undefined), {})
})

test('JSON stream read errors and cancellation cleanup preserve the original error', async (t) => {
  const failure = new Error('synthetic read failure')
  let response
  t.mock.method(globalThis, 'fetch', async () => {
    response = new Response(new ReadableStream({ pull(controller) { controller.error(failure) } }))
    return response
  })
  await assert.rejects(fetchJsonWithRetry('https://example.invalid', {}, {}, undefined), error => error === failure)
  assert.equal(response.body.locked, false)
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(8)) },
    cancel() { throw new Error('cleanup failure') },
  })))
  await assert.rejects(fetchJsonWithRetry('https://example.invalid', {}, {}, undefined, 1000,
    { maxResponseBytes: 4 }), error => error.code === 'LCX_RESPONSE_TOO_LARGE')
})

function errorResponse(status, sentinel) {
  return new Response(JSON.stringify({ error: { message: sentinel } }), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-redacted' },
  })
}

test('credential transports reject redirects and do not expose provider bodies', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  const sentinel = 'PROVIDER_BODY_MUST_NOT_ESCAPE'
  globalThis.fetch = async (_url, init) => {
    requests.push(init)
    return errorResponse(401, sentinel)
  }
  try {
    await assert.rejects(
      fetchJsonWithRetry('https://example.invalid/v1/test', {}, { authorization: 'Bearer redacted' }, undefined, 1000, { maxAttempts: 1 }),
      (error) => error?.status === 401 && !String(error?.message).includes(sentinel),
    )
    await assert.rejects(
      fetchSseWithRetry('https://example.invalid/v1/test', {}, { authorization: 'Bearer redacted' }, undefined, 1000, { maxAttempts: 1 }),
      (error) => error?.status === 401 && !String(error?.message).includes(sentinel),
    )
    assert.equal(requests.length, 2)
    for (const request of requests) assert.equal(request.redirect, 'error')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('consumeSse releases its reader after normal, error and cancellation settlement', async () => {
  const complete = new Response('data: {"type":"test"}\n\n')
  const events = []
  await consumeSse(complete, event => events.push(event))
  assert.deepEqual(events, [{ type: 'test' }])
  assert.equal(complete.body.locked, false)

  const malformed = new Response('data: {not-json}\n\n')
  await assert.rejects(consumeSse(malformed, () => {}), error => error.code === 'LCX_INVALID_SSE')
  assert.equal(malformed.body.locked, false)

  let cancellations = 0
  const oversized = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(4)) },
    cancel() { cancellations += 1 },
  }, { highWaterMark: 0 }))
  await assert.rejects(
    consumeSse(oversized, () => {}, { maxResponseBytes: 3 }),
    error => error.code === 'LCX_RESPONSE_TOO_LARGE',
  )
  assert.equal(cancellations, 1)
  assert.equal(oversized.body.locked, false)
})

test('successful retry backoff removes its abort listener', async t => {
  const controller = new AbortController()
  const signal = controller.signal
  const add = signal.addEventListener.bind(signal)
  const remove = signal.removeEventListener.bind(signal)
  let added = 0, removed = 0, requests = 0
  signal.addEventListener = (...args) => { if (args[0] === 'abort') added += 1; return add(...args) }
  signal.removeEventListener = (...args) => { if (args[0] === 'abort') removed += 1; return remove(...args) }
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1
    return requests === 1
      ? new Response('retry', { status: 503, headers: { 'retry-after-ms': '1' } })
      : new Response('{}', { status: 200 })
  })
  assert.deepEqual(await fetchJsonWithRetry('https://example.invalid', {}, {}, signal, undefined, { maxAttempts: 2 }), {})
  assert.equal(added, 1)
  assert.equal(removed, 1)
})

test('single-attempt transports preserve bounded provider retry guidance', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('rate limited', {
    status: 429,
    headers: { 'content-type': 'text/plain', 'retry-after-ms': '45000' },
  })
  try {
    for (const transport of [fetchJsonWithRetry, fetchSseWithRetry]) {
      await assert.rejects(
        transport('https://example.invalid/v1/test', {}, {}, undefined, 1000, { maxAttempts: 1 }),
        (error) => error?.status === undefined && error?.cause?.status === 429 && error?.cause?.providerRetryAfterMs === 30000,
      )
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})
