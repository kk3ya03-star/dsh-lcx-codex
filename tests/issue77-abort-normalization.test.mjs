import test from 'node:test'
import assert from 'node:assert/strict'

import { abortError, normalizeAbortReason } from '../lib/abort-error.js'
import { abortIfNeeded, consumeSse, fetchJsonWithRetry } from '../lib/transport.js'
import { managedFailure, managedFailureChunk, streamResponsesRequest } from '../lib/responses-stream.js'

// DSH 0.1.6 cancels with a plain-object AgentCancelCause and exposes it as
// AbortSignal.reason: the session controller cancels `{ kind: 'user' }`, the agent
// loop `{ kind: 'disposed' }`, the subagent driver `{ kind: 'parent' }`.
const CANCEL_CAUSES = [
  ['user', { kind: 'user' }],
  ['parent', { kind: 'parent' }],
  ['disposed', { kind: 'disposed' }],
]

// dsh-tools renders a failed tool call as `Error: ${errorMessage(error)}`, and
// errorMessage falls back to String(value) for a non-Error. That fallback is what
// persisted `Error: [object Object]` as model-facing tool-result text.
function dshToolResultText(error) {
  return `Error: ${error instanceof Error ? error.message : String(error)}`
}

function assertNormalized(error, cause) {
  assert.ok(error instanceof Error, 'a non-Error cancel cause must not escape as itself')
  assert.equal(error.name, 'AbortError')
  assert.notEqual(dshToolResultText(error), 'Error: [object Object]')
  assert.ok(error.message.length > 0)
  assert.equal(error.cause, cause, 'the original cause is retained for diagnosis')
}

function assertCauseUntouched(cause, keys) {
  assert.deepEqual(Object.keys(cause), keys)
  assert.equal(Object.isFrozen(cause), false, 'DSH owns the cancel cause; LCX must not freeze it')
  assert.equal(Object.isExtensible(cause), true)
}

function stalledSseResponse(prelude) {
  let cancelled = 0
  let sink
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      sink = controller
      if (prelude) controller.enqueue(encoder.encode(prelude))
    },
    cancel() {
      cancelled += 1
    },
  })
  const response = new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  return {
    response,
    cancellations: () => cancelled,
    push: (text) => {
      try {
        sink.enqueue(encoder.encode(text))
      } catch {}
    },
  }
}

function piModel() {
  return {
    id: 'gpt-5.6-sol',
    name: 'GPT 5.6 Sol',
    api: 'openai-responses',
    provider: 'lcx',
    baseUrl: 'https://example.invalid/v1',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 32768,
    thinkingLevelMap: { off: 'none', xhigh: 'xhigh' },
    compat: {},
  }
}

for (const [kind, shape] of CANCEL_CAUSES) {
  test(`${kind} cancel cause is normalized on immediate abort`, () => {
    const cause = { ...shape }
    const keys = Object.keys(cause)
    const controller = new AbortController()
    controller.abort(cause)

    assert.throws(() => abortIfNeeded(controller.signal), (error) => {
      assertNormalized(error, cause)
      return true
    })
    assertNormalized(abortError(controller.signal), cause)
    assertCauseUntouched(cause, keys)
  })

  test(`${kind} cancel cause is normalized during an in-flight SSE read`, async () => {
    const cause = { ...shape }
    const keys = Object.keys(cause)
    const controller = new AbortController()
    const { response, cancellations, push } = stalledSseResponse('data: {"type":"ping"}\n\n')

    // consumeSse checks the signal between reads, which is where a cancelled
    // in-flight search leaves the loop once the socket delivers anything further.
    const consumed = consumeSse(response, () => {}, { signal: controller.signal })
    await new Promise((resolve) => setImmediate(resolve))
    controller.abort(cause)
    push('data: {"type":"ping"}\n\n')

    await assert.rejects(consumed, (error) => {
      assertNormalized(error, cause)
      return true
    })
    assert.equal(cancellations(), 1, 'the reader is still released on a normalized abort')
    assertCauseUntouched(cause, keys)
  })

  test(`${kind} cancel cause is normalized during retry backoff`, async () => {
    const cause = { ...shape }
    const keys = Object.keys(cause)
    const controller = new AbortController()
    const previous = globalThis.fetch
    let requests = 0
    globalThis.fetch = async () => {
      requests += 1
      queueMicrotask(() => controller.abort(cause))
      return new Response('{"error":{"message":"retry"}}', {
        status: 500,
        headers: { 'retry-after-ms': '5000' },
      })
    }
    try {
      await assert.rejects(
        fetchJsonWithRetry('https://example.invalid/v1/x', {}, {}, controller.signal, 1000, { maxAttempts: 3 }),
        (error) => {
          assertNormalized(error, cause)
          return true
        },
      )
      assert.equal(requests, 1, 'the abort ends the retry loop rather than sleeping it out')
    } finally {
      globalThis.fetch = previous
    }
    assertCauseUntouched(cause, keys)
  })

  test(`${kind} cancel cause is normalized while the Responses stream is reading`, async () => {
    const cause = { ...shape }
    const keys = Object.keys(cause)
    const controller = new AbortController()
    const previous = globalThis.fetch
    globalThis.fetch = async () =>
      stalledSseResponse('data: {"type":"response.created","response":{"id":"resp_1"}}\n\n').response
    try {
      const stream = streamResponsesRequest({
        baseURL: 'https://example.invalid/v1',
        provider: 'lcx',
        model: 'gpt-5.6-sol',
        piModel: piModel(),
        body: { model: 'gpt-5.6-sol', input: [], stream: true, store: false },
        headers: { authorization: 'Bearer test' },
        signal: controller.signal,
        maxAttempts: 1,
      })
      const chunks = []
      const drain = (async () => {
        for await (const chunk of stream) chunks.push(chunk)
      })()
      await new Promise((resolve) => setImmediate(resolve))
      controller.abort(cause)
      await drain

      const finish = chunks.find((chunk) => chunk.type === 'finish')
      assert.equal(finish.reason.kind, 'aborted')
      assert.equal(finish.reason.failure.code, 'ABORTED')
      assert.ok(!JSON.stringify(chunks).includes('[object Object]'))
    } finally {
      globalThis.fetch = previous
    }
    assertCauseUntouched(cause, keys)
  })

  test(`${kind} cancel cause still classifies as ABORTED`, () => {
    const cause = { ...shape }
    const controller = new AbortController()
    controller.abort(cause)
    const normalized = abortError(controller.signal)

    assert.equal(managedFailure(cause, controller.signal).code, 'ABORTED')
    assert.equal(managedFailure(normalized, controller.signal).code, 'ABORTED')
    assert.equal(managedFailureChunk(normalized, controller.signal).reason.kind, 'aborted')
    assert.equal(managedFailureChunk(cause, controller.signal).reason.kind, 'aborted')
  })
}

test('an Error abort reason is preserved exactly, including TimeoutError', () => {
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  const timedOut = new AbortController()
  timedOut.abort(timeout)
  assert.equal(abortError(timedOut.signal), timeout)
  assert.equal(normalizeAbortReason(timeout), timeout)
  assert.equal(managedFailure(abortError(timedOut.signal), timedOut.signal).code, 'TIMEOUT')

  const custom = Object.assign(new Error('provider closed the stream'), { code: 'LCX_CUSTOM' })
  const closed = new AbortController()
  closed.abort(custom)
  const preserved = abortError(closed.signal)
  assert.equal(preserved, custom)
  assert.equal(preserved.code, 'LCX_CUSTOM')
  assert.equal(preserved.cause, undefined, 'a preserved Error is not rewritten')
})

test('a missing abort reason keeps the caught error and otherwise reads as an abort', () => {
  const caught = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
  assert.equal(normalizeAbortReason(undefined, caught), caught)

  const synthesized = normalizeAbortReason(undefined)
  assert.equal(synthesized.name, 'AbortError')
  assert.equal(synthesized.code, 'LCX_ABORTED')
  assert.equal(synthesized.cause, undefined)
  assert.equal(managedFailure(synthesized, undefined).code, 'ABORTED')
})

test('a non-Error reason that is not a DSH cancel cause is still normalized', () => {
  for (const reason of ['stopped', 42, { kind: 'hook', reason: 'policy' }]) {
    const normalized = normalizeAbortReason(reason)
    assert.equal(normalized.name, 'AbortError')
    assert.equal(normalized.cause, reason)
    assert.notEqual(dshToolResultText(normalized), 'Error: [object Object]')
  }
})
