import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { ToolResultPruner } from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  compactionConfigState,
  patchCompactionConfig,
  patchToolResultPruner,
  restoreCompactionConfig,
  restoreToolResultPruner,
  toolResultPrunerState,
} from '../lib/dsh-compat.js'
import { InvocationPolicyScope } from '../lib/invocation-policy-scope.js'

const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const turn = () => new Promise(resolve => setImmediate(resolve))

test('nested operations start from host policy and restore the outer projection', async () => {
  const baseConfig = { thresholdRatio: 0.8 }
  const basePrune = () => 'base-prune'
  const compaction = { config: baseConfig }
  const pruner = { pruneSession: basePrune }
  const scope = new InvocationPolicyScope()
  assert.equal(scope.ensure(compaction, 'config'), true)
  assert.equal(scope.ensure(pruner, 'pruneSession'), true)

  await scope.run(undefined, 'shared', async () => {
    const outerConfig = { thresholdRatio: 0.9 }
    const outerPrune = () => 'outer-prune'
    compaction.config = outerConfig
    pruner.pruneSession = outerPrune
    assert.equal(compaction.config, outerConfig)
    assert.equal(pruner.pruneSession, outerPrune)

    await scope.run(undefined, 'shared', async () => {
      assert.equal(compaction.config, baseConfig)
      assert.equal(pruner.pruneSession, basePrune)
      compaction.config = { thresholdRatio: 0.95 }
      pruner.pruneSession = () => 'inner-prune'
    })

    assert.equal(compaction.config, outerConfig)
    assert.equal(pruner.pruneSession, outerPrune)
  })

  assert.equal(compaction.config, baseConfig)
  assert.equal(pruner.pruneSession, basePrune)
  await scope.close()
  scope.restore()
  assert.deepEqual(Object.getOwnPropertyDescriptor(compaction, 'config'), {
    configurable: true,
    enumerable: true,
    writable: true,
    value: baseConfig,
  })
  assert.equal(pruner.pruneSession, basePrune)
})

test('host descriptor replacement invalidates fastpath and exclusive fallback waits for active calls', async () => {
  const baseConfig = { thresholdRatio: 0.8 }
  const hostConfig = { thresholdRatio: 0.75 }
  const compaction = { config: baseConfig }
  const scope = new InvocationPolicyScope()
  assert.equal(scope.ensure(compaction, 'config'), true)
  const started = deferred(), gate = deferred()
  const active = scope.run(undefined, 'shared', async () => {
    compaction.config = { thresholdRatio: 0.9 }
    started.resolve()
    await gate.promise
  })
  await started.promise

  Object.defineProperty(compaction, 'config', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: hostConfig,
  })
  assert.equal(scope.ensure(compaction, 'config'), false)
  let fallbackStarted = false
  const fallback = scope.run(undefined, 'exclusive', async () => {
    fallbackStarted = true
    const original = compaction.config
    compaction.config = { thresholdRatio: 0.91 }
    assert.equal(compaction.config.thresholdRatio, 0.91)
    compaction.config = original
  })
  await turn()
  assert.equal(fallbackStarted, false)
  gate.resolve()
  await active
  await fallback
  assert.equal(fallbackStarted, true)
  assert.equal(compaction.config, hostConfig)
  await scope.close()
  scope.restore()
  assert.equal(compaction.config, hostConfig)
})

test('formal DSH 0.1.5 classes consume scoped config and pruner with original receivers', async () => {
  const ctx = new Context()
  const gate = deferred()
  const totals = new Map([
    ['formal-gpt-below', 85],
    ['formal-gpt-native', 90],
    ['formal-grok', 85],
  ])
  let holdGpt = true
  ctx.provide('llm', {
    async resolveModelInfo(provider) {
      if (provider === 'gpt-route' && holdGpt) await gate.promise
      return { context: { contextWindow: 100 } }
    },
  })
  ctx.provide('tokenMeter', {
    measure(session) { return { totalTokens: totals.get(session.id), nodes: [] } },
    estimateMessage() { return 1 },
  })
  const pruner = new ToolResultPruner(ctx)
  const originalPrune = pruner.pruneSession
  const actualPrunes = []
  pruner.pruneSession = function (session) {
    actualPrunes.push(session.id)
    return Reflect.apply(originalPrune, this, [session])
  }
  const engine = new BasicCompactionEngine(ctx, {
    auto: false,
    thresholdRatio: 0.8,
    retainRatio: 0.1,
  })
  assert.equal(engine instanceof BasicCompactionEngine, true)
  assert.equal(pruner instanceof ToolResultPruner, true)

  const session = (id, provider) => {
    const result = Session.create(SessionId(id))
    result.append('request/header', {
      header: { config: { provider, model: `${provider}-model` } },
      reason: 'initial',
    })
    return result
  }
  const gptBelow = { session: session('formal-gpt-below', 'gpt-route'), options: {} }
  const gptNative = { session: session('formal-gpt-native', 'gpt-route'), options: {} }
  const grok = { session: session('formal-grok', 'grok-route'), options: {} }
  const scope = new InvocationPolicyScope()
  const configState = compactionConfigState(engine)
  const prunerState = toolResultPrunerState(pruner)
  assert.equal(scope.ensure(configState.service, 'config'), true)
  assert.equal(scope.ensure(prunerState.pruner, 'pruneSession'), true)

  const scopedCall = (agent, noOpCalls) => scope.run(undefined, 'shared', async () => {
    const configPatch = patchCompactionConfig(compactionConfigState(engine), config => ({
      ...config,
      thresholdRatio: 0.9,
    }))
    const prunerPatch = patchToolResultPruner(toolResultPrunerState(pruner), sessionValue => {
      noOpCalls.push(sessionValue.id)
      return { pruned: [], charsRemoved: 0 }
    })
    try {
      return await engine.compactIfNeeded(agent, 'pressure', new AbortController().signal)
    } finally {
      restoreCompactionConfig(configPatch)
      restoreToolResultPruner(prunerPatch)
    }
  })

  const belowNoOp = []
  const held = scopedCall(gptBelow, belowNoOp)
  await turn()
  const grokCall = scope.run(undefined, 'shared', () =>
    engine.compactIfNeeded(grok, 'pressure', new AbortController().signal))
  await grokCall
  assert.deepEqual(actualPrunes, ['formal-grok'])
  assert.deepEqual(belowNoOp, [])
  gate.resolve()
  await held

  holdGpt = false
  const nativeNoOp = []
  await scopedCall(gptNative, nativeNoOp)
  assert.deepEqual(nativeNoOp, ['formal-gpt-native'])
  assert.deepEqual(actualPrunes, ['formal-grok'])
  assert.equal(engine.config.thresholdRatio, 0.8)
  assert.equal(pruner.pruneSession, prunerState.original)
  await scope.close()
  scope.restore()
  assert.equal(engine.config.thresholdRatio, 0.8)
  assert.equal(pruner.pruneSession, prunerState.original)
})

test('formal BasicCompactionEngine durable lock rejects same-session overlap and permits a later check', async () => {
  const ctx = new Context()
  const summaryStarted = deferred(), summaryGate = deferred()
  ctx.provide('llm', {
    async resolveModelInfo() { return { context: { contextWindow: 100 } } },
  })
  ctx.provide('tokenMeter', {
    measure(session) {
      const compacted = session.surface.replaceGeneration > 0
      const nodes = session.surface.nodes.map(seq => ({
        seq,
        tokens: compacted ? 2 : 40,
        heuristicTokens: compacted ? 2 : 40,
      }))
      return {
        totalTokens: nodes.reduce((sum, node) => sum + node.tokens, 0),
        nodes,
      }
    },
    estimateMessage() { return 1 },
  })
  class GatedEngine extends BasicCompactionEngine {
    async summarize() {
      summaryStarted.resolve()
      await summaryGate.promise
      return {
        summary: [{ type: 'text', text: 'short checkpoint' }],
        provider: 'fixture',
        model: 'fixture-model',
      }
    }
  }
  const engine = new GatedEngine(ctx, {
    auto: false,
    thresholdRatio: 0.8,
    retainTokens: 10,
    compactionRetries: 0,
  })
  const session = Session.create(SessionId('formal-same-session'))
  session.append('turn/start', { turn: 1 })
  session.append('request/header', {
    header: { config: { provider: 'fixture', model: 'fixture-model' } },
    reason: 'initial',
  })
  for (let index = 0; index < 3; index += 1) {
    session.append('user/message', {
      role: 'user',
      id: `same-${index}`,
      source: { kind: 'user' },
      content: [{ type: 'text', text: `message ${index}` }],
    }, { surfaceOp: 'append' })
  }
  const agent = { session, options: {} }
  const first = engine.compactIfNeeded(agent, 'pressure', new AbortController().signal)
  await summaryStarted.promise
  await assert.rejects(
    engine.compactIfNeeded(agent, 'pressure', new AbortController().signal),
    error => error instanceof ManualCompactionError && error.code === 'busy',
  )
  summaryGate.resolve()
  const result = await first
  assert.ok(result)
  assert.equal(await engine.compactIfNeeded(agent, 'pressure', new AbortController().signal), null)
})
