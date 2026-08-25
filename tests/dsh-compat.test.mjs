import test from 'node:test'
import assert from 'node:assert/strict'
import { symbols as cordisSymbols } from '@deepseek-ai/cordis'
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
  sessionFor,
  sessionsService,
  toolResultPrunerState,
  writeWebSearchProvider,
} from '../lib/dsh-compat.js'

test('agent route and Sessions access preserve the DSH rc.2 shape', () => {
  const requestConfig = { provider: 'header-provider', model: 'header-model' }
  const options = { provider: 'selected-provider', model: 'selected-model' }
  const session = { id: 'session-compat', requestHeader: () => ({ config: requestConfig }) }
  const agent = { options, session }
  assert.deepEqual(readAgentRouteState(agent), { requestConfig, options, sessionId: session.id })
  assert.equal(agentSessionId(agent), session.id)
  assert.equal(agentSessionId(undefined), '')

  const records = new Map([[session.id, session]])
  const service = { get: id => records.get(id), list: () => [...records.values()] }
  const propertyContext = { sessions: service }
  const getterContext = { get: name => name === 'sessions' ? service : undefined }
  assert.equal(sessionsService(propertyContext), service)
  assert.equal(sessionsService(getterContext), service)
  assert.equal(sessionFor(getterContext, session.id), session)
  assert.equal(sessionFor(getterContext, ''), undefined)
})

test('service resolution prefers AgentPresets and keeps scoped/root fallbacks fail-safe', () => {
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
  assert.equal(resolveAgentService(ctx, agent, 'compaction'), scopedService)
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

test('compaction patches deduplicate by concrete identity and restore only their own wrapper', () => {
  const original = function original() { return 'original' }
  const concrete = { compactIfNeeded: original }
  const proxy = { [cordisSymbols.original]: concrete }
  const records = new Map()
  assert.equal(concreteService(proxy), concrete)

  const candidate = compactionPatchCandidate(proxy, records)
  const wrapper = function wrapper() { return 'wrapper' }
  const record = { ...candidate, wrapper }
  assert.equal(installCompactionPatch(records, record), true)
  assert.equal(concrete.compactIfNeeded, wrapper)
  assert.equal(compactionPatchCandidate(proxy, records), undefined)
  restoreCompactionPatches(records)
  assert.equal(concrete.compactIfNeeded, original)
  assert.equal(records.size, 0)

  const secondRecords = new Map()
  const second = { ...compactionPatchCandidate(proxy, secondRecords), wrapper }
  installCompactionPatch(secondRecords, second)
  const external = () => 'external'
  concrete.compactIfNeeded = external
  restoreCompactionPatches(secondRecords)
  assert.equal(concrete.compactIfNeeded, external)
})

test('compatibility patch points fail safe when optional host writes are rejected', () => {
  const original = () => 'original'
  const readOnlyCompaction = {}
  Object.defineProperty(readOnlyCompaction, 'compactIfNeeded', { value: original, writable: false })
  const records = new Map()
  const candidate = compactionPatchCandidate(readOnlyCompaction, records)
  assert.equal(installCompactionPatch(records, { ...candidate, wrapper: () => 'wrapper' }), false)
  assert.equal(readOnlyCompaction.compactIfNeeded, original)
  assert.equal(records.size, 0)

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
