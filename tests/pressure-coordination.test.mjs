import test from 'node:test'
import assert from 'node:assert/strict'
import { ServiceMutex } from '../lib/service-mutex.js'
import apply, { compactionPressureBand } from '../lib/index.js'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import { pluginConfig, providerContext } from './dsh02-fixture.mjs'

const CONTEXT_WINDOW = 262_144
const OUTPUT_RESERVE = 32_768
const HEADROOM = 65_536
const PRESSURE_BUDGET = CONTEXT_WINDOW - OUTPUT_RESERVE - HEADROOM
const NATIVE_THRESHOLD = Math.floor(PRESSURE_BUDGET * 0.9)
const EMERGENCY_THRESHOLD = Math.floor(PRESSURE_BUDGET * 0.95)
const SCOPED_RATIO = NATIVE_THRESHOLD / CONTEXT_WINDOW
const NATIVE_POINT = 150_000
const EMERGENCY_POINT = 160_000

const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const turn = () => new Promise(resolve => setImmediate(resolve))

async function settlesBeforeGate(promise) {
  return Promise.race([
    promise.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 50)),
  ])
}

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

test('F5 native and emergency thresholds use DSH pressure budget after output reserve and headroom', () => {
  const policy = { auto: 90, emergency: 95, outputReserve: OUTPUT_RESERVE, headroomTokens: HEADROOM }
  for (const contextWindow of [262_144, 272_000]) {
    const budget = contextWindow - OUTPUT_RESERVE - HEADROOM
    const nativeStart = Math.floor(budget * 0.9)
    const emergencyStart = Math.floor(budget * 0.95)
    assert.equal(compactionPressureBand(nativeStart - 1, contextWindow, policy).band, 'below')
    assert.equal(compactionPressureBand(nativeStart, contextWindow, policy).band, 'native')
    assert.equal(compactionPressureBand(emergencyStart - 1, contextWindow, policy).band, 'native')
    assert.equal(compactionPressureBand(emergencyStart, contextWindow, policy).band, 'emergency')
  }
})

function pressureFixture({ legacyConfig = false } = {}) {
  const handlers = new Map(), logs = [], effects = []
  const config = { thresholdRatio: 0.8, headroomTokens: HEADROOM, modelPolicies: [{ provider: 'fixture', model: 'gpt-fixture', thresholdRatio: 0.7 }] }
  const pruner = { calls: [], pruneSession(session) { this.calls.push(session.id); return { pruned: [], charsRemoved: 0 } } }
  const originalPrune = pruner.pruneSession
  let enabled = true
  const compaction = { calls: [], async compactIfNeeded(agent, trigger, signal) {
    const call = {
      id: agent.session.id,
      trigger,
      config: this.config,
      threshold: this.config.thresholdRatio,
      modelThreshold: this.config.modelPolicies[0].thresholdRatio,
    }
    this.calls.push(call)
    pruner.pruneSession(agent.session)
    if (agent.work) await agent.work(signal)
    if (agent.checkAfterWork) {
      call.afterThreshold = this.config.thresholdRatio
      pruner.pruneSession(agent.session)
    }
    return null
  } }
  Object.defineProperty(compaction, 'config', {
    configurable: !legacyConfig,
    enumerable: true,
    writable: true,
    value: config,
  })
  const originalCompact = compaction.compactIfNeeded
  const provider = providerContext({ fixture: { api: 'openai-responses', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'FIXTURE' } })
  const plugin = pluginConfig({ enabled: true })
  const ctx = {
    llm: { ...provider.llm, resolveModelInfo: async () => ({ context: { contextWindow: CONTEXT_WINDOW }, defaultMaxTokens: OUTPUT_RESERVE }) },
    sessions: {}, tools: { register() {} }, credentials: {}, attachments: {}, fs: {},
    web: { registerSearchProvider() {} },
    settings: { ...provider.settings, configure: () => () => {} },
    agentPresets: { serviceFor: (_agent, name) => ({ compaction, toolResultPruner: pruner })[name] },
    get(name) { return this[name] }, inject() {},
    on(name, handler) { handlers.set(name, handler) },
    effect(setup) { effects.push(setup()) },
    logger: { info: message => logs.push(message), warn: message => logs.push(message) },
  }
  apply(ctx, plugin)
  const agent = (id, totalTokens) => {
    const result = { session: Session.create(SessionId(id)), options: { provider: 'fixture', model: 'gpt-fixture' }, ctx: { get: name => name === 'tokenMeter' ? { measure: () => ({ totalTokens }) } : name === 'toolResultPruner' ? pruner : undefined } }
    handlers.get('agent/created')({ agent: result })
    return result
  }
  return {
    compaction, config, pruner, originalPrune, originalCompact, agent, logs,
    replaceConfig(value) {
      Object.defineProperty(compaction, 'config', {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      })
    },
    disable() { enabled = false; updateVolatile(plugin.enabled, pluginConfig({ enabled }).enabled); handlers.get('loader/volatile-update')() },
    restart() { apply(ctx, pluginConfig({ enabled })) },
    async dispose() { for (const effect of effects.splice(0).reverse()) if (typeof effect === 'function') await effect() },
  }
}

test('installed pressure wrapper switches at exact tokens and restores host policy', async () => {
  const f = pressureFixture()
  const native = NATIVE_THRESHOLD, emergency = EMERGENCY_THRESHOLD
  for (const tokens of [native - 1, native, emergency - 1, emergency]) {
    const before = f.compaction.calls.length, prunes = f.pruner.calls.length
    const agent = f.agent(`boundary-${tokens}`, tokens)
    await f.compaction.compactIfNeeded(agent, 'pressure', new AbortController().signal)
    assert.equal(f.compaction.calls.length - before, 1, JSON.stringify({ tokens, logs: f.logs, calls: f.compaction.calls }))
    assert.equal(f.pruner.calls.length - prunes, tokens < native || tokens >= emergency ? 1 : 0)
    assert.equal(f.compaction.config, f.config)
    assert.equal(f.pruner.pruneSession, f.originalPrune)
    if (tokens >= native) {
      assert.equal(f.compaction.calls.at(-1).threshold, SCOPED_RATIO)
      assert.equal(f.compaction.calls.at(-1).modelThreshold, SCOPED_RATIO)
    }
  }
  f.disable()
  await f.compaction.compactIfNeeded(f.agent('disabled', native), 'pressure', new AbortController().signal)
  assert.equal(f.compaction.calls.at(-1).threshold, 0.8)
  assert.equal(f.pruner.calls.at(-1), 'disabled')
  await f.dispose()
  assert.equal(f.compaction.compactIfNeeded, f.originalCompact)
  assert.equal(f.compaction.config, f.config)
  assert.equal(f.pruner.pruneSession, f.originalPrune)
})

test('two GPT sessions use independent native/emergency policy and recover after failure', async () => {
  const f = pressureFixture(), gate = deferred()
  const first = f.agent('native-failure', NATIVE_POINT), second = f.agent('emergency-concurrent', EMERGENCY_POINT)
  first.work = () => gate.promise
  const running = f.compaction.compactIfNeeded(first, 'pressure', new AbortController().signal)
  const rejected = assert.rejects(running, /synthetic failure/)
  await turn()
  const concurrent = f.compaction.compactIfNeeded(second, 'pressure', new AbortController().signal)
  assert.equal(await settlesBeforeGate(concurrent), true)
  assert.deepEqual(f.compaction.calls.map(({ id, threshold, modelThreshold }) => ({ id, threshold, modelThreshold })), [
    { id: 'native-failure', threshold: SCOPED_RATIO, modelThreshold: SCOPED_RATIO },
    { id: 'emergency-concurrent', threshold: SCOPED_RATIO, modelThreshold: SCOPED_RATIO },
  ])
  assert.notEqual(f.compaction.calls[0].config, f.compaction.calls[1].config)
  assert.deepEqual(f.pruner.calls, ['emergency-concurrent'])
  assert.equal(f.compaction.config, f.config)
  assert.equal(f.pruner.pruneSession, f.originalPrune)
  gate.reject(new Error('synthetic failure'))
  await rejected
  await f.compaction.compactIfNeeded(f.agent('after-failure', EMERGENCY_POINT), 'pressure', new AbortController().signal)
  assert.deepEqual(f.pruner.calls, ['emergency-concurrent', 'after-failure'])
  assert.equal(f.compaction.config, f.config)
  assert.equal(f.pruner.pruneSession, f.originalPrune)
  await f.dispose()
})

test('Grok and DeepSeek pressure complete under a long GPT compaction with host policy', async () => {
  const f = pressureFixture(), gate = deferred()
  const gpt = f.agent('gpt-held', NATIVE_POINT)
  const deepseek = f.agent('deepseek-native', NATIVE_POINT)
  const grok = f.agent('grok-native', NATIVE_POINT)
  deepseek.options = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
  grok.options = { provider: 'relay', model: 'grok-4.6' }
  gpt.work = () => gate.promise
  const running = f.compaction.compactIfNeeded(gpt, 'pressure', new AbortController().signal)
  await turn()
  const nativeCalls = [deepseek, grok].map(agent =>
    f.compaction.compactIfNeeded(agent, 'pressure', new AbortController().signal))
  assert.equal(await settlesBeforeGate(Promise.all(nativeCalls)), true)
  assert.deepEqual(f.compaction.calls.map(({ id, threshold, modelThreshold }) =>
    ({ id, threshold, modelThreshold })), [
    { id: 'gpt-held', threshold: SCOPED_RATIO, modelThreshold: SCOPED_RATIO },
    { id: 'deepseek-native', threshold: 0.8, modelThreshold: 0.7 },
    { id: 'grok-native', threshold: 0.8, modelThreshold: 0.7 },
  ])
  assert.deepEqual(f.pruner.calls, ['deepseek-native', 'grok-native'])
  assert.equal(f.compaction.config, f.config)
  assert.equal(f.pruner.pruneSession, f.originalPrune)
  gate.resolve()
  await running
  await f.dispose()
})

test('a nested non-GPT pressure call starts from host policy, then restores outer GPT policy', async () => {
  const f = pressureFixture()
  const gpt = f.agent('gpt-outer', NATIVE_POINT)
  const grok = f.agent('grok-inner', NATIVE_POINT)
  grok.options = { provider: 'relay', model: 'grok-4.6' }
  gpt.checkAfterWork = true
  gpt.work = () => f.compaction.compactIfNeeded(grok, 'pressure', new AbortController().signal)
  await f.compaction.compactIfNeeded(gpt, 'pressure', new AbortController().signal)
  assert.deepEqual(f.compaction.calls.map(({ id, threshold, afterThreshold }) => ({ id, threshold, afterThreshold })), [
    { id: 'gpt-outer', threshold: SCOPED_RATIO, afterThreshold: SCOPED_RATIO },
    { id: 'grok-inner', threshold: 0.8, afterThreshold: undefined },
  ])
  assert.deepEqual(f.pruner.calls, ['grok-inner'])
  assert.equal(f.compaction.config, f.config)
  assert.equal(f.pruner.pruneSession, f.originalPrune)
  await f.dispose()
})

test('below-threshold GPT pressure returns while another GPT compaction is active', async () => {
  const f = pressureFixture(), gate = deferred()
  const held = f.agent('held-high', NATIVE_POINT)
  held.work = () => gate.promise
  const running = f.compaction.compactIfNeeded(held, 'pressure', new AbortController().signal)
  await turn()
  const below = f.compaction.compactIfNeeded(f.agent('below', 1000), 'pressure', new AbortController().signal)
  assert.equal(await settlesBeforeGate(below), true)
  assert.deepEqual(f.compaction.calls.map(call => call.id), ['held-high', 'below'], 'F5 leaves DSH pressure active below LCX Native band')
  gate.resolve()
  await running
  await f.dispose()
})

test('production wrapper rechecks replaced config descriptors and preserves host replacement', async () => {
  const f = pressureFixture(), gate = deferred()
  const active = f.agent('descriptor-active', NATIVE_POINT)
  active.work = () => gate.promise
  const running = f.compaction.compactIfNeeded(active, 'pressure', new AbortController().signal)
  await turn()
  const hostConfig = {
    thresholdRatio: 0.75,
    headroomTokens: HEADROOM,
    modelPolicies: [{ provider: 'fixture', model: 'gpt-fixture', thresholdRatio: 0.65 }],
  }
  f.replaceConfig(hostConfig)
  const fallback = f.compaction.compactIfNeeded(
    f.agent('descriptor-fallback', EMERGENCY_POINT),
    'pressure',
    new AbortController().signal,
  )
  assert.equal(await settlesBeforeGate(fallback), false)
  assert.deepEqual(f.compaction.calls.map(call => call.id), ['descriptor-active'])
  gate.resolve()
  await Promise.all([running, fallback])
  assert.deepEqual(f.compaction.calls.map(({ id, threshold, modelThreshold }) => ({ id, threshold, modelThreshold })), [
    { id: 'descriptor-active', threshold: SCOPED_RATIO, modelThreshold: SCOPED_RATIO },
    { id: 'descriptor-fallback', threshold: SCOPED_RATIO, modelThreshold: SCOPED_RATIO },
  ])
  assert.equal(f.compaction.config, hostConfig)
  await f.dispose()
  assert.equal(f.compaction.config, hostConfig)
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.compaction, 'config'), {
    configurable: true,
    enumerable: true,
    writable: true,
    value: hostConfig,
  })
})

test('legacy fallback aborts queued pressure and remains usable', async () => {
  const f = pressureFixture({ legacyConfig: true }), gate = deferred()
  const held = f.agent('legacy-held', NATIVE_POINT)
  held.work = () => gate.promise
  const running = f.compaction.compactIfNeeded(held, 'pressure', new AbortController().signal)
  await turn()
  const aborter = new AbortController()
  const queued = f.compaction.compactIfNeeded(f.agent('legacy-queued', EMERGENCY_POINT), 'pressure', aborter.signal)
  aborter.abort(new DOMException('queued cancelled', 'AbortError'))
  await assert.rejects(queued, error => error?.name === 'AbortError')
  assert.deepEqual(f.compaction.calls.map(call => call.id), ['legacy-held'])
  gate.resolve()
  await running
  await f.compaction.compactIfNeeded(f.agent('legacy-after', EMERGENCY_POINT), 'pressure', new AbortController().signal)
  assert.deepEqual(f.compaction.calls.map(call => call.id), ['legacy-held', 'legacy-after'])
  assert.equal(f.compaction.config, f.config)
  assert.equal(f.pruner.pruneSession, f.originalPrune)
  await f.dispose()
})

test('active abort propagates and later scoped pressure recovers', async () => {
  const f = pressureFixture()
  const aborter = new AbortController()
  const active = f.agent('active-abort', NATIVE_POINT)
  active.work = signal => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const running = f.compaction.compactIfNeeded(active, 'pressure', aborter.signal)
  await turn()
  aborter.abort(new DOMException('active cancelled', 'AbortError'))
  await assert.rejects(running, error => error?.name === 'AbortError')
  await f.compaction.compactIfNeeded(f.agent('after-active-abort', EMERGENCY_POINT), 'pressure', new AbortController().signal)
  assert.equal(f.compaction.calls.at(-1).id, 'after-active-abort')
  assert.equal(f.compaction.config, f.config)
  assert.equal(f.pruner.pruneSession, f.originalPrune)
  await f.dispose()
})

test('cold restart reinstalls scoped pressure after complete teardown', async () => {
  const f = pressureFixture()
  const before = f.agent('before-restart', NATIVE_POINT)
  await f.compaction.compactIfNeeded(before, 'pressure', new AbortController().signal)
  await f.dispose()
  assert.equal(f.compaction.compactIfNeeded, f.originalCompact)
  assert.equal(f.compaction.config, f.config)
  assert.equal(f.pruner.pruneSession, f.originalPrune)

  f.restart()
  const after = f.agent('after-restart', NATIVE_POINT)
  await f.compaction.compactIfNeeded(after, 'pressure', new AbortController().signal)
  assert.notEqual(f.compaction.compactIfNeeded, f.originalCompact)
  assert.deepEqual(f.compaction.calls.map(({ id, threshold }) => ({ id, threshold })), [
    { id: 'before-restart', threshold: SCOPED_RATIO },
    { id: 'after-restart', threshold: SCOPED_RATIO },
  ])
  assert.equal(f.compaction.config, f.config)
  assert.equal(f.pruner.pruneSession, f.originalPrune)
  await f.dispose()
  assert.equal(f.compaction.compactIfNeeded, f.originalCompact)
})

test('unload cancels admission, drains active scope, and restores host descriptors', async () => {
  const f = pressureFixture(), gate = deferred()
  const active = f.agent('unload-active', NATIVE_POINT)
  active.work = () => gate.promise
  const running = f.compaction.compactIfNeeded(active, 'pressure', new AbortController().signal)
  await turn()
  let disposed = false
  const disposal = f.dispose().then(() => { disposed = true })
  await turn()
  assert.equal(disposed, false)
  await assert.rejects(
    f.compaction.compactIfNeeded(f.agent('unload-late', EMERGENCY_POINT), 'pressure', new AbortController().signal),
    /shutting down/u,
  )
  gate.resolve()
  await running
  await disposal
  assert.equal(disposed, true)
  assert.equal(f.compaction.compactIfNeeded, f.originalCompact)
  assert.equal(f.compaction.config, f.config)
  assert.equal(f.pruner.pruneSession, f.originalPrune)
})
