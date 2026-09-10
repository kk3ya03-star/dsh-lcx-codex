import test from 'node:test'
import assert from 'node:assert/strict'
import { Context, symbols as cordisSymbols } from '@deepseek-ai/cordis'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { InvocationPolicyScope } from '../lib/invocation-policy-scope.js'
import { ServiceMutex } from '../lib/service-mutex.js'
import {
  agentSessionId,
  compactionConfigState,
  compactionPatchCandidate,
  concreteService,
  contextService,
  installCompactionPatch,
  patchCompactionConfig,
  patchToolResultPruner,
  patchVisibleWebSearchTimeout,
  readAgentRouteState,
  readWebSearchProvider,
  refreshVisibleWebSearchTimeouts,
  resolveAgentService,
  resolveContextService,
  resolveScopedService,
  restoreCompactionConfig,
  restoreCompactionPatches,
  restoreToolResultPruner,
  restoreVisibleWebSearchTimeouts,
  scopedToolRuntime,
  sessionFor,
  sessionsService,
  toolResultPrunerState,
  writeWebSearchProvider,
} from '../lib/dsh-compat.js'

test('scoped tool registration preserves the DSH service receiver and disposer', () => {
  const definitions = new Set()
  const tools = {
    register(definition) {
      assert.equal(this, tools)
      definitions.add(definition)
      return () => definitions.delete(definition)
    },
  }
  const agent = { ctx: { get: name => name === 'tools' ? tools : undefined } }
  const definition = { name: 'alpha-fixture' }
  const dispose = scopedToolRuntime(agent).register(definition)
  assert.equal(definitions.has(definition), true)
  dispose()
  assert.equal(definitions.size, 0)
  assert.equal(scopedToolRuntime({ ctx: {} }), undefined)
})

test('agent route and Sessions access use the DSH 0.1.5 public shape', () => {
  const requestConfig = { provider: 'header-provider', model: 'header-model' }
  const options = { provider: 'selected-provider', model: 'selected-model' }
  const agentSession = { id: 'session-compat', requestHeader: () => ({ config: requestConfig }) }
  const agent = { options, session: agentSession }
  assert.deepEqual(readAgentRouteState(agent), { requestConfig, options, sessionId: agentSession.id })
  assert.equal(agentSessionId(agent), agentSession.id)
  assert.equal(agentSessionId(undefined), '')

  const session = Session.create(SessionId(agentSession.id))
  const records = new Map([[session.id, session]])
  const service = { get: id => records.get(id) }
  const propertyContext = { sessions: service }
  const getterContext = { get: name => name === 'sessions' ? service : undefined }
  assert.equal(typeof sessionsService(propertyContext)?.get, 'function')
  assert.equal(typeof sessionsService(getterContext)?.get, 'function')
  assert.equal(sessionFor(getterContext, session.id), session)
  assert.equal(sessionFor(getterContext, ''), undefined)
  assert.equal(sessionFor({ sessions: { get: () => agentSession } }, session.id), undefined)
})

test('agent service resolution uses the official AgentPresets service resolver', () => {
  const presetService = { kind: 'preset' }
  const scopedService = { kind: 'scoped' }
  const agent = { ctx: { get: name => name === 'compaction' ? scopedService : undefined } }
  const ctx = {
    rootOnly: { kind: 'root' },
    agentPresets: { serviceFor: (_agent, name) => name === 'compaction' ? presetService : undefined },
    get(name) { return this[name] },
  }
  assert.equal(contextService(ctx, 'rootOnly'), ctx.rootOnly)
  assert.equal(resolveContextService(ctx, 'rootOnly'), ctx.rootOnly)
  assert.equal(resolveScopedService(agent, 'compaction'), scopedService)
  assert.equal(resolveAgentService(ctx, agent, 'compaction'), presetService)
  assert.equal(resolveAgentService(ctx, agent, 'missing'), undefined)

  ctx.agentPresets.serviceFor = () => { throw new Error('preset unavailable') }
  assert.equal(resolveAgentService(ctx, agent, 'compaction'), undefined)
  const unavailable = { rootOnly: ctx.rootOnly, get: () => { throw new Error('context unavailable') } }
  assert.throws(() => contextService(unavailable, 'rootOnly'), /context unavailable/u)
  assert.equal(resolveContextService(unavailable, 'rootOnly'), undefined)
})

test('web provider selection is reversible and fails closed on inaccessible host state', () => {
  const ctx = { web: { searchProviderId: 'original' } }
  assert.equal(readWebSearchProvider(ctx), 'original')
  assert.equal(writeWebSearchProvider(ctx, 'lcx-responses'), true)
  assert.equal(readWebSearchProvider(ctx), 'lcx-responses')
  assert.equal(writeWebSearchProvider(ctx, 'original'), true)

  const denied = { web: new Proxy({}, { get() { throw new Error('denied') }, set() { return false } }) }
  assert.equal(readWebSearchProvider(denied), undefined)
  assert.equal(writeWebSearchProvider(denied, 'lcx-responses'), false)
  assert.equal(writeWebSearchProvider({}, 'lcx-responses'), false)
})

test('compaction patches deduplicate by concrete identity and restore only their own wrapper', async () => {
  const original = async function original() { return 'original' }
  const concrete = { compactIfNeeded: original }
  const originalDescriptor = Object.getOwnPropertyDescriptor(concrete, 'compactIfNeeded')
  const proxy = { [cordisSymbols.original]: concrete }
  const records = new Map()
  assert.equal(concreteService(proxy), concrete)

  const candidate = compactionPatchCandidate(proxy, records)
  assert.ok(candidate)
  assert.equal(
    installCompactionPatch(
      records,
      candidate,
      new ServiceMutex(),
      new InvocationPolicyScope(),
      new AbortController(),
      async (_agent, _trigger, signal, callOriginal) => callOriginal(signal),
    ),
    true,
  )
  const wrapper = concrete.compactIfNeeded
  assert.notEqual(wrapper, original)
  assert.deepEqual(Object.getOwnPropertyDescriptor(concrete, 'compactIfNeeded'), {
    ...originalDescriptor,
    value: wrapper,
  })
  assert.equal(await wrapper({}, 'test', new AbortController().signal), 'original')
  assert.equal(compactionPatchCandidate(proxy, records), undefined)
  restoreCompactionPatches(records)
  assert.equal(concrete.compactIfNeeded, original)
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(concrete, 'compactIfNeeded'),
    originalDescriptor,
  )
  assert.equal(records.size, 0)

  const secondRecords = new Map()
  const second = compactionPatchCandidate(proxy, secondRecords)
  assert.ok(second)
  installCompactionPatch(
    secondRecords,
    second,
    new ServiceMutex(),
    new InvocationPolicyScope(),
    new AbortController(),
    async (_agent, _trigger, signal, callOriginal) => callOriginal(signal),
  )
  const external = async () => 'external'
  concrete.compactIfNeeded = external
  restoreCompactionPatches(secondRecords)
  assert.equal(concrete.compactIfNeeded, external)
})

test('formal BasicCompactionEngine unload restores prototype lookup and preserves host replacements', async () => {
  const engine = new BasicCompactionEngine(new Context(), { auto: false })
  const prototype = BasicCompactionEngine.prototype
  const prototypeDescriptor = Object.getOwnPropertyDescriptor(prototype, 'compactIfNeeded')
  assert.ok(prototypeDescriptor)
  assert.equal(Object.getOwnPropertyDescriptor(engine, 'compactIfNeeded'), undefined)

  const unload = async records => {
    const entries = [...records.values()]
    const reason = new Error('test unload')
    for (const record of entries) record.lifecycle.abort(reason)
    await Promise.all(entries.flatMap(record => [
      record.policyScope.close(reason),
      record.mutex.close(reason),
    ]))
    restoreCompactionPatches(records, entries)
    for (const record of entries) record.policyScope.restore()
  }

  try {
    const records = new Map()
    const candidate = compactionPatchCandidate(engine, records)
    assert.ok(candidate)
    assert.equal(candidate.originalOwnDescriptor, undefined)
    assert.equal(installCompactionPatch(
      records,
      candidate,
      new ServiceMutex(),
      new InvocationPolicyScope(),
      new AbortController(),
      async (_agent, _trigger, signal, callOriginal) => callOriginal(signal),
    ), true)
    const installed = Object.getOwnPropertyDescriptor(engine, 'compactIfNeeded')
    assert.deepEqual({
      configurable: installed?.configurable,
      enumerable: installed?.enumerable,
      writable: installed?.writable,
      valueIsWrapper: installed?.value === engine.compactIfNeeded,
    }, {
      configurable: true,
      enumerable: true,
      writable: true,
      valueIsWrapper: true,
    })

    await unload(records)
    assert.equal(Object.getOwnPropertyDescriptor(engine, 'compactIfNeeded'), undefined)
    assert.equal(engine.compactIfNeeded, prototypeDescriptor.value)

    const prototypeUpdate = async function prototypeUpdate() { return 'prototype-update' }
    Object.defineProperty(prototype, 'compactIfNeeded', {
      ...prototypeDescriptor,
      value: prototypeUpdate,
    })
    assert.equal(engine.compactIfNeeded, prototypeUpdate)
    assert.equal(await engine.compactIfNeeded(), 'prototype-update')

    const replacementRecords = new Map()
    const replacementCandidate = compactionPatchCandidate(engine, replacementRecords)
    assert.ok(replacementCandidate)
    assert.equal(replacementCandidate.originalOwnDescriptor, undefined)
    assert.equal(installCompactionPatch(
      replacementRecords,
      replacementCandidate,
      new ServiceMutex(),
      new InvocationPolicyScope(),
      new AbortController(),
      async (_agent, _trigger, signal, callOriginal) => callOriginal(signal),
    ), true)
    const hostReplacement = async function hostReplacement() { return 'host-replacement' }
    const hostDescriptor = {
      configurable: true,
      enumerable: false,
      writable: false,
      value: hostReplacement,
    }
    Object.defineProperty(engine, 'compactIfNeeded', hostDescriptor)
    await unload(replacementRecords)
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(engine, 'compactIfNeeded'),
      hostDescriptor,
    )
    assert.equal(engine.compactIfNeeded, hostReplacement)
  } finally {
    Object.defineProperty(prototype, 'compactIfNeeded', prototypeDescriptor)
    Reflect.deleteProperty(engine, 'compactIfNeeded')
  }
})

test('compatibility patch points fail safe when optional host writes are rejected', () => {
  const original = () => 'original'
  const readOnlyCompaction = {}
  Object.defineProperty(readOnlyCompaction, 'compactIfNeeded', { value: original, writable: false })
  const records = new Map()
  const candidate = compactionPatchCandidate(readOnlyCompaction, records)
  assert.ok(candidate)
  assert.equal(
    installCompactionPatch(
      records,
      candidate,
      new ServiceMutex(),
      new InvocationPolicyScope(),
      new AbortController(),
      async (_agent, _trigger, signal, callOriginal) => callOriginal(signal),
    ),
    false,
  )
  assert.equal(readOnlyCompaction.compactIfNeeded, original)
  assert.equal(records.size, 0)

  const inheritedMethod = async () => 'inherited'
  const unsupportedPrototypes = [
    Object.create(Object.prototype, {
      compactIfNeeded: {
        configurable: true,
        enumerable: false,
        writable: false,
        value: inheritedMethod,
      },
    }),
    Object.create(Object.prototype, {
      compactIfNeeded: {
        configurable: true,
        enumerable: false,
        get: () => inheritedMethod,
      },
    }),
  ]
  for (const prototype of unsupportedPrototypes) {
    const inheritedCompaction = Object.create(prototype)
    const inheritedRecords = new Map()
    const inheritedCandidate = compactionPatchCandidate(
      inheritedCompaction,
      inheritedRecords,
    )
    assert.ok(inheritedCandidate)
    assert.equal(installCompactionPatch(
      inheritedRecords,
      inheritedCandidate,
      new ServiceMutex(),
      new InvocationPolicyScope(),
      new AbortController(),
      async (_agent, _trigger, signal, callOriginal) => callOriginal(signal),
    ), false)
    assert.equal(
      Object.getOwnPropertyDescriptor(inheritedCompaction, 'compactIfNeeded'),
      undefined,
    )
    assert.equal(inheritedCompaction.compactIfNeeded, inheritedMethod)
    assert.equal(inheritedRecords.size, 0)
  }

  const config = { thresholdRatio: 0.8 }
  const rejectedConfig = {
    get config() { return config },
    set config(_value) { throw new Error('config write rejected') },
  }
  assert.equal(patchCompactionConfig(compactionConfigState(rejectedConfig), value => ({ ...value, thresholdRatio: 0.9 })), undefined)
  assert.equal(rejectedConfig.config, config)

  const rejectedDefinition = {}
  Object.defineProperty(rejectedDefinition, 'timeoutMs', { get: () => 5_000, set: () => { throw new Error('timeout write rejected') }, configurable: true })
  const agent = { ctx: { tools: { get: () => rejectedDefinition } } }
  const definitions = new Map()
  assert.doesNotThrow(() => patchVisibleWebSearchTimeout(agent, () => 240_000, definitions))
  assert.doesNotThrow(() => restoreVisibleWebSearchTimeouts(definitions))
})

test('temporary pruner and compaction config mutations restore by identity', () => {
  const originalPrune = () => 'pruned'
  const pruner = { pruneSession: originalPrune }
  const noOp = () => ({ pruned: [], charsRemoved: 0 })
  const prunerPatch = patchToolResultPruner(toolResultPrunerState(pruner), noOp)
  assert.equal(pruner.pruneSession, noOp)
  restoreToolResultPruner(prunerPatch)
  assert.equal(pruner.pruneSession, originalPrune)

  const originalConfig = { thresholdRatio: 0.8 }
  const compaction = { config: originalConfig }
  const configPatch = patchCompactionConfig(compactionConfigState(compaction), config => ({ ...config, thresholdRatio: 0.9 }))
  assert.equal(compaction.config.thresholdRatio, 0.9)
  restoreCompactionConfig(configPatch)
  assert.equal(compaction.config, originalConfig)

  const externalPrune = () => 'external'
  const guardedPatch = patchToolResultPruner(toolResultPrunerState(pruner), noOp)
  pruner.pruneSession = externalPrune
  restoreToolResultPruner(guardedPatch)
  assert.equal(pruner.pruneSession, externalPrune)
})

test('visible web_search timeout patch tracks, refreshes, and restores the original definition', () => {
  const existing = { timeoutMs: 5_000 }
  const added = {}
  let definition = existing
  const agent = { ctx: { tools: { get: (name) => name === 'web_search' ? definition : undefined } } }
  const records = new Map()

  patchVisibleWebSearchTimeout(agent, () => 240_000, records)
  assert.equal(existing.timeoutMs, 240_000)
  refreshVisibleWebSearchTimeouts(records, undefined)
  assert.equal(existing.timeoutMs, 5_000)

  definition = added
  patchVisibleWebSearchTimeout(agent, () => 120_000, records)
  assert.equal(added.timeoutMs, 120_000)
  refreshVisibleWebSearchTimeouts(records, undefined)
  assert.equal(Object.prototype.hasOwnProperty.call(added, 'timeoutMs'), true)
  assert.equal(added.timeoutMs, undefined)
  restoreVisibleWebSearchTimeouts(records)
  assert.equal(existing.timeoutMs, 5_000)
  assert.equal(Object.prototype.hasOwnProperty.call(added, 'timeoutMs'), false)
  assert.equal(records.size, 0)

  definition = undefined
  let computed = false
  patchVisibleWebSearchTimeout(agent, () => { computed = true; return 240_000 }, records)
  assert.equal(computed, false)
})
