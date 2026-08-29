import test from 'node:test'
import assert from 'node:assert/strict'
import { ServiceMutex } from '../lib/service-mutex.js'
import { compactionPressureBand } from '../lib/index.js'

const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }

test('ServiceMutex serializes one concrete shared service across triggers', async () => {
  const mutex = new ServiceMutex()
  const gate = deferred()
  const order = []
  const first = mutex.run(undefined, async () => { order.push('A:start'); await gate.promise; order.push('A:end') })
  await Promise.resolve()
  const second = mutex.run(undefined, async () => { order.push('B:start'); order.push('B:end') })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(order, ['A:start'])
  gate.resolve()
  await Promise.all([first, second])
  assert.deepEqual(order, ['A:start', 'A:end', 'B:start', 'B:end'])
})

test('ServiceMutex aborts queued callers and close drains the active owner', async () => {
  const mutex = new ServiceMutex()
  const gate = deferred()
  const first = mutex.run(undefined, async () => { await gate.promise })
  await Promise.resolve()
  const aborter = new AbortController()
  const queued = mutex.run(aborter.signal, async () => 'should-not-run')
  aborter.abort(new DOMException('cancelled', 'AbortError'))
  await assert.rejects(queued, (error) => error?.name === 'AbortError')
  let drained = false
  const closing = mutex.close(new Error('closing')).then(() => { drained = true })
  await Promise.resolve()
  assert.equal(drained, false)
  gate.resolve()
  await first
  await closing
  assert.equal(drained, true)
  await assert.rejects(mutex.run(undefined, async () => 'late'), /closing/u)
})

test('90% native and 95% emergency thresholds use resolved operational context windows', () => {
  const policy = { auto: 90, emergency: 95 }
  for (const contextWindow of [262_144, 272_000]) {
    const nativeStart = Math.ceil(contextWindow * 0.9)
    const emergencyStart = Math.ceil(contextWindow * 0.95)
    assert.equal(compactionPressureBand(nativeStart - 1, contextWindow, policy).band, 'below')
    assert.equal(compactionPressureBand(nativeStart, contextWindow, policy).band, 'native')
    assert.equal(compactionPressureBand(emergencyStart - 1, contextWindow, policy).band, 'native')
    assert.equal(compactionPressureBand(emergencyStart, contextWindow, policy).band, 'emergency')
  }
})
