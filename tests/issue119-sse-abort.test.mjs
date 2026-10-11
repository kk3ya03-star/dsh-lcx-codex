import test from 'node:test'
import assert from 'node:assert/strict'
import { consumeSse } from '../lib/transport.js'

// Issue 119 item 7 (hardening): `consumeSse` only looked at its signal between reads, so a read that
// never settles kept it pending after an abort unless the caller had also tied the body to the same
// signal. The abort must cancel the reader itself.

const settle = (promise, ms = 1500) => Promise.race([
  promise.then(() => ({ state: 'resolved' }), (error) => ({ state: 'rejected', error })),
  new Promise((resolve) => setTimeout(() => resolve({ state: 'pending' }), ms)),
])

test('an abort interrupts a read that never settles and cancels the body', async () => {
  let cancelled = false
  const body = new ReadableStream({ start() {}, cancel() { cancelled = true } })
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error('user cancel')), 50)
  const outcome = await settle(consumeSse(new Response(body), () => {}, { signal: controller.signal }))
  assert.equal(outcome.state, 'rejected', 'consumeSse settles after the abort')
  assert.match(String(outcome.error?.message), /user cancel/u, 'the abort reason is reported')
  assert.equal(cancelled, true, 'the underlying body was cancelled')
})

test('an abort after some events reports the abort, not a clean end of stream', async () => {
  const events = []
  const encoder = new TextEncoder()
  const body = new ReadableStream({ start(streamController) { streamController.enqueue(encoder.encode('data: {"n":1}\n\n')) } })
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error('user cancel')), 50)
  const outcome = await settle(consumeSse(new Response(body), (event) => events.push(event), { signal: controller.signal }))
  assert.equal(outcome.state, 'rejected')
  assert.deepEqual(events, [{ n: 1 }])
})

test('a stream that ends normally is unaffected and removes its abort listener', async () => {
  const controller = new AbortController()
  const listeners = new Set()
  const signal = {
    get aborted() { return controller.signal.aborted },
    get reason() { return controller.signal.reason },
    addEventListener(type, listener) { listeners.add(listener) },
    removeEventListener(type, listener) { listeners.delete(listener) },
  }
  const events = []
  const wire = ['data: {"n":1}', '', 'data: {"n":2}', '', 'data: [DONE]', '', ''].join('\n')
  await consumeSse(new Response(wire), (event) => events.push(event), { signal })
  assert.deepEqual(events, [{ n: 1 }, { n: 2 }])
  assert.equal(listeners.size, 0, 'no listener is left on the caller signal')
})

test('an already-aborted signal rejects without reading', async () => {
  const controller = new AbortController()
  controller.abort(new Error('early'))
  let pulled = false
  const body = new ReadableStream({ pull() { pulled = true } })
  const outcome = await settle(consumeSse(new Response(body), () => {}, { signal: controller.signal }))
  assert.equal(outcome.state, 'rejected')
  assert.equal(pulled, false)
})
