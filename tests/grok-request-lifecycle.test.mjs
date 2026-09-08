import test from 'node:test'
import assert from 'node:assert/strict'
import { collect, functionTools, grokHarness, sseResponse, user, xaiProfile } from './grok-fixture.mjs'

const options = () => ({ provider: 'xai', model: 'grok-4.6', sessionId: 'grok-lifecycle-59', reasoningEffort: 'high', messages: [user('synthetic lookup')], tools: functionTools })
const unexpected = () => { throw new Error('Unexpected fallback for configured native search') }

test('Grok bridge surfaces provider retry guidance after exactly one request', async t => {
  let attempts = 0
  t.mock.method(globalThis, 'fetch', async () => {
    attempts += 1
    return new Response('synthetic rate limit', { status: 429, headers: { 'retry-after-ms': '7000' } })
  })
  const h = grokHarness({ nativeX: true })
  const chunks = await collect(h.stream(options(), unexpected))
  assert.equal(attempts, 1)
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'RATE_LIMIT')
  assert.equal(chunks.at(-1).reason.failure.providerRetryAfterMs, 7000)
  assert.equal(chunks.at(-1).replayState, undefined)
})

test('Grok bridge forwards cancellation to the in-flight transport without replay or retry', async t => {
  let entered, attempts = 0, observedAbort = false
  const started = new Promise(resolve => { entered = resolve })
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    attempts += 1
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        observedAbort = true
        reject(init.signal.reason)
      }, { once: true })
      entered()
    })
  })
  const h = grokHarness({ nativeWeb: true })
  const controller = new AbortController()
  const pending = collect(h.stream({ ...options(), signal: controller.signal }, unexpected))
  await started
  controller.abort(new DOMException('synthetic cancellation', 'AbortError'))
  const chunks = await pending
  assert.equal(observedAbort, true)
  assert.equal(attempts, 1)
  assert.equal(chunks.at(-1).reason.kind, 'aborted')
  assert.equal(chunks.at(-1).replayState, undefined)
})

test('repeated Grok requests retain cache identity and carry no provider conversation pointer', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return sseResponse([{ type: 'response.completed', response: {
      id: `resp_repeat_${requests.length}`, model: 'grok-4.6', status: 'completed',
      output: [{ type: 'message', id: `msg_repeat_${requests.length}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'fixture answer', annotations: [] }] }],
      usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
    } }])
  })
  const h = grokHarness({ nativeWeb: true, nativeX: true })
  for (const text of ['first question', 'second question']) {
    const chunks = await collect(h.stream({ ...options(), messages: [user(text)] }, unexpected))
    assert.equal(chunks.at(-1).reason.kind, 'stop')
  }
  assert.equal(requests[0].prompt_cache_key, 'grok-lifecycle-59')
  assert.equal(requests[1].prompt_cache_key, requests[0].prompt_cache_key)
  for (const body of requests) {
    assert.equal(Object.hasOwn(body, 'previous_response_id'), false)
    assert.equal(Object.hasOwn(body, 'conversation'), false)
    assert.equal(body.store, false)
  }
})

test('Grok idle watchdog aborts a pre-header stall as TIMEOUT', async t => {
  let observedAbort = false
  t.mock.method(globalThis, 'fetch', async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      observedAbort = true
      reject(init.signal.reason)
    }, { once: true })
  }))
  const profile = { ...xaiProfile, streamIdleTimeoutMs: 20 }
  const h = grokHarness({ nativeWeb: true, profiles: { xai: profile } })
  const chunks = await collect(h.stream(options(), unexpected))
  assert.equal(observedAbort, true)
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'TIMEOUT')
})

function pacedSseResponse(parts, delayMs, lifecycle = {}) {
  const encoder = new TextEncoder()
  let index = 0
  return new Response(new ReadableStream({
    async pull(controller) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
      if (lifecycle.cancelled) return
      if (index >= parts.length) {
        if (lifecycle.stallAfterParts) return new Promise(() => {})
        return controller.close()
      }
      controller.enqueue(encoder.encode(parts[index++]))
    },
    cancel() { lifecycle.cancelled = true; lifecycle.cancellations = (lifecycle.cancellations ?? 0) + 1 },
  }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/event-stream' } })
}

function completedEvent(text = 'healthy') {
  return `data: ${JSON.stringify({ type: 'response.completed', response: {
    id: 'resp_lifecycle', model: 'grok-4.6', status: 'completed',
    output: [{ type: 'message', id: 'msg_lifecycle', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  } })}\n\n`
}

for (const heartbeat of [': keepalive\n\n', 'data: {"type":"response.proxy.heartbeat"}\n\n'])
test(`Grok idle watchdog rejects non-progress ${heartbeat.startsWith(':') ? 'comments' : 'unknown events'}`, async t => {
  const lifecycle = {}
  const parts = Array.from({ length: 40 }, () => heartbeat)
  parts.push(completedEvent())
  t.mock.method(globalThis, 'fetch', async () => pacedSseResponse(parts, 8, lifecycle))
  const profile = { ...xaiProfile, streamIdleTimeoutMs: 60 }
  const h = grokHarness({ nativeX: true, profiles: { xai: profile } })
  const chunks = await collect(h.stream(options(), unexpected))
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'TIMEOUT')
  assert.equal(lifecycle.cancellations, 1)
})

function progressingParts(count = 12) {
  const events = [{ type: 'response.output_item.added', output_index: 0,
    item: { type: 'message', id: 'msg_lifecycle', role: 'assistant', status: 'in_progress', content: [] } }]
  for (let i = 0; i < count; i++) events.push({ type: 'response.output_text.delta', item_id: 'msg_lifecycle', output_index: 0, content_index: 0, delta: 'x' })
  return [...events.map(event => `data: ${JSON.stringify(event)}\n\n`), completedEvent('x'.repeat(count)), 'data: [DONE]\n\n']
}

test('real DSH output progress keeps Grok alive beyond one idle interval', async t => {
  t.mock.method(globalThis, 'fetch', async () => pacedSseResponse(progressingParts(), 12))
  const profile = { ...xaiProfile, streamIdleTimeoutMs: 80 }
  const h = grokHarness({ nativeX: true, profiles: { xai: profile } })
  const started = Date.now()
  const chunks = await collect(h.stream(options(), unexpected))
  assert.ok(Date.now() - started > 80)
  assert.ok(chunks.some(chunk => chunk.type === 'text-delta'))
  assert.equal(chunks.at(-1).reason.kind, 'stop')
})

test('stalled Grok body read times out and cancels the pending reader', async t => {
  const lifecycle = { stallAfterParts: true }
  t.mock.method(globalThis, 'fetch', async () => pacedSseResponse([': first-byte\n\n'], 1, lifecycle))
  const profile = { ...xaiProfile, streamIdleTimeoutMs: 20 }
  const h = grokHarness({ nativeWeb: true, profiles: { xai: profile } })
  const chunks = await collect(h.stream(options(), unexpected))
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'TIMEOUT')
  assert.equal(lifecycle.cancellations, 1)
})

test('explicit profile total deadline still applies to an active Grok stream', async t => {
  const lifecycle = {}
  const parts = progressingParts(30)
  t.mock.method(globalThis, 'fetch', async () => pacedSseResponse(parts, 5, lifecycle))
  const profile = { ...xaiProfile, timeoutMs: 30, streamIdleTimeoutMs: 100 }
  const h = grokHarness({ nativeX: true, profiles: { xai: profile } })
  const chunks = await collect(h.stream(options(), unexpected))
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'TIMEOUT')
  assert.equal(lifecycle.cancellations, 1)
})

test('consumer stop aborts and cancels a pending Grok stream read without leaks', async t => {
  const lifecycle = { stallAfterParts: true }
  const added = `data: ${JSON.stringify({
    type: 'response.output_item.added', output_index: 0,
    item: { type: 'message', id: 'msg_pending', role: 'assistant', status: 'in_progress', content: [] },
  })}\n\n`
  t.mock.method(globalThis, 'fetch', async () => pacedSseResponse([added], 1, lifecycle))
  const profile = { ...xaiProfile, streamIdleTimeoutMs: 1000 }
  const h = grokHarness({ nativeWeb: true, profiles: { xai: profile } })
  const iterator = h.stream(options(), unexpected)[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.equal(first.value.type, 'block-start')
  await iterator.return()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(lifecycle.cancellations, 1)
})

test('consumer think time does not count toward Grok provider idle timeout', async t => {
  let bodyController
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      bodyController = controller
      controller.enqueue(new TextEncoder().encode(progressingParts(0)[0]))
    },
  }), { headers: { 'content-type': 'text/event-stream' } }))
  const h = grokHarness({ nativeX: true, profiles: { xai: { ...xaiProfile, streamIdleTimeoutMs: 40 } } })
  const iterator = h.stream(options(), unexpected)[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.equal(first.value.type, 'block-start')
  await new Promise(resolve => setTimeout(resolve, 100))
  bodyController.enqueue(new TextEncoder().encode(completedEvent('resumed')))
  bodyController.close()
  const chunks = []
  while (true) { const step = await iterator.next(); if (step.done) break; chunks.push(step.value) }
  assert.equal(chunks.at(-1).reason.kind, 'stop')
})

test('accepted relay Grok route surfaces upstream tool rejection without DSH fallback', async t => {
  let attempts = 0
  t.mock.method(globalThis, 'fetch', async () => {
    attempts += 1
    return new Response('synthetic unsupported server tool', { status: 400 })
  })
  const model = 'grokCustomUnsupported'
  const profile = {
    ...xaiProfile,
    models: [{ id: model, reasoningEfforts: { high: 'relay-high' } }],
  }
  const h = grokHarness({ nativeWeb: true, profiles: { relay: profile } })
  const chunks = await collect(h.stream({
    provider: 'relay', model, sessionId: 'relay-error',
    reasoningEffort: 'high', messages: [user('lookup')], tools: functionTools,
  }, unexpected))
  assert.equal(attempts, 1)
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'INVALID_REQUEST')
  assert.equal(chunks.at(-1).replayState, undefined)
})
