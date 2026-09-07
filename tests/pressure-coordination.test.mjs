import test from 'node:test'
import assert from 'node:assert/strict'
import { ServiceMutex } from '../lib/service-mutex.js'
import apply, { compactionPressureBand } from '../lib/index.js'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

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

function pressureFixture() {
  const handlers = new Map(), logs = [], effects = []
  const config = { thresholdRatio: 0.8, modelPolicies: [{ provider: 'fixture', model: 'gpt-fixture', thresholdRatio: 0.7 }] }
  const pruner = { calls: [], pruneSession(session) { this.calls.push(session.id); return { pruned: [], charsRemoved: 0 } } }
  const originalPrune = pruner.pruneSession
  let enabled = true
  const compaction = { config, calls: [], async compactIfNeeded(agent, trigger, signal) {
    this.calls.push({ id: agent.session.id, trigger, threshold: this.config.thresholdRatio, modelThreshold: this.config.modelPolicies[0].thresholdRatio })
    pruner.pruneSession(agent.session)
    if (agent.work) await agent.work(signal)
    return null
  } }
  const originalCompact = compaction.compactIfNeeded
  const ctx = {
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 262144 } }) },
    sessions: {}, tools: { register() {} }, credentials: {}, attachments: {}, fs: {},
    web: { registerSearchProvider() {} },
    settings: {
      get: () => ({ providers: { fixture: { api: 'openai-responses', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'FIXTURE' } } }),
      installSection(_owner, _ns, _schema, _base, hooks) { hooks.setSource(() => ({ enabled, webSearch: false, advancedHostedSearch: false, alphaSearch: false })); this.refresh = hooks.onChange; hooks.onChange() },
    },
    agentPresets: { serviceFor: (_agent, name) => ({ compaction, toolResultPruner: pruner })[name] },
    get(name) { return this[name] }, inject() {},
    on(name, handler) { handlers.set(name, handler) },
    effect(setup) { effects.push(setup()) },
    logger: { info: message => logs.push(message), warn: message => logs.push(message) },
  }
  apply(ctx)
  const agent = (id, totalTokens) => {
    const result = { session: Session.create(SessionId(id)), options: { provider: 'fixture', model: 'gpt-fixture' }, ctx: { get: name => name === 'tokenMeter' ? { measure: () => ({ totalTokens }) } : undefined } }
    handlers.get('agent/created')({ agent: result })
    return result
  }
  return { compaction, config, pruner, originalPrune, originalCompact, agent, logs, disable() { enabled = false; ctx.settings.refresh() }, async dispose() { for (const effect of effects.reverse()) if (typeof effect === 'function') await effect() } }
}

test('installed pressure wrapper switches at exact tokens and restores host policy', async () => {
  const f = pressureFixture()
  const native = Math.ceil(262144 * 0.9), emergency = Math.ceil(262144 * 0.95)
  for (const tokens of [native - 1, native, emergency - 1, emergency]) {
    const before = f.compaction.calls.length, prunes = f.pruner.calls.length
    const agent = f.agent(`boundary-${tokens}`, tokens)
    await f.compaction.compactIfNeeded(agent, 'pressure', new AbortController().signal)
    assert.equal(f.compaction.calls.length - before, tokens < native ? 0 : 1, JSON.stringify({ tokens, logs: f.logs, calls: f.compaction.calls }))
    assert.equal(f.pruner.calls.length - prunes, tokens >= emergency ? 1 : 0)
    assert.equal(f.compaction.config, f.config)
    assert.equal(f.pruner.pruneSession, f.originalPrune)
    if (tokens >= native) {
      assert.equal(f.compaction.calls.at(-1).threshold, 0.9)
      assert.equal(f.compaction.calls.at(-1).modelThreshold, 0.9)
    }
  }
  f.disable()
  await f.compaction.compactIfNeeded(f.agent('disabled', native), 'pressure', new AbortController().signal)
  assert.equal(f.compaction.calls.at(-1).threshold, 0.8)
  assert.equal(f.pruner.calls.at(-1), 'disabled')
  await f.dispose()
  assert.equal(f.compaction.compactIfNeeded, f.originalCompact)
})

test('shared pressure service serializes native/emergency calls and restores on failure', async () => {
  const f = pressureFixture(), gate = deferred()
  const first = f.agent('native-failure', 240000), second = f.agent('emergency-after-failure', 250000)
  first.work = () => gate.promise
  const running = f.compaction.compactIfNeeded(first, 'pressure', new AbortController().signal)
  const rejected = assert.rejects(running, /synthetic failure/)
  await new Promise(resolve => setImmediate(resolve))
  const queued = f.compaction.compactIfNeeded(second, 'pressure', new AbortController().signal)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.compaction.calls.length, 1)
  assert.deepEqual(f.pruner.calls, [])
  gate.reject(new Error('synthetic failure'))
  await rejected
  await queued
  assert.deepEqual(f.pruner.calls, ['emergency-after-failure'])
  assert.equal(f.compaction.config, f.config)
  assert.equal(f.pruner.pruneSession, f.originalPrune)
  await f.dispose()
})
