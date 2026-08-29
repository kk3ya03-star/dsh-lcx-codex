import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchJsonWithRetry, fetchSseWithRetry } from '../lib/transport.js'

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
