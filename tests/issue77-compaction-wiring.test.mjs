import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolResultPruner } from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import { compactionPressureBand } from '../lib/index.js'
import { promptCacheSessionId } from '../lib/route.js'
import {
  concreteService,
  patchToolResultPruner,
  resolveAgentService,
  resolveContextService,
  resolveScopedService,
  restoreToolResultPruner,
  toolResultPrunerState,
} from '../lib/dsh-compat.js'

// Issue 77 P1 — compaction/token-meter revalidation.
//
// tests/pressure-coordination.test.mjs already asserts the band logic, but it
// drives a hand-written stand-in: `{ pruneSession(session) { ... } }`. That
// fixture cannot notice if DSH 0.1.6 moved, renamed or re-wrapped the real
// service, which is exactly the risk a version retarget carries — the same
// class of gap that let the dropped `searchUsageDefinition` registration pass
// a green suite earlier in this Issue.
//
// These tests wire LCX's patch helpers to the real `ToolResultPruner` from the
// installed 0.1.6-alpha.2 runtime, over real `Session` surfaces, and prove
// suppression by its effect: an over-threshold tool result is really shadowed
// when unpatched and really left alone while patched.

const NATIVE_PERCENT = 90
const EMERGENCY_PERCENT = 95
const PRUNE_THRESHOLD_CHARS = 8192
const OVERSIZE_CHARS = 20_000

function prunerContext() {
  const ctx = new Context()
  ctx.provide('tokenMeter', { estimateMessage: () => 1234 }, true)
  const pruner = new ToolResultPruner(ctx, {})
  return { ctx, pruner }
}

function sessionWithOversizeToolResult(id) {
  const session = Session.create(SessionId(id))
  const callId = `call_${id}`
  session.append('tool/call', { turn: 1, step: 1, callId, name: 'probe', arguments: '{}' })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: {
      role: 'tool',
      source: { kind: 'tool', callId },
      content: [{
        type: 'tool-result',
        toolCallId: callId,
        content: [{ type: 'text', text: 'X'.repeat(OVERSIZE_CHARS) }],
      }],
    },
  }, { surfaceOp: 'append' })
  return session
}

test('LCX resolves, patches and restores the real DSH 0.1.6 ToolResultPruner', () => {
  const { ctx, pruner } = prunerContext()

  const resolved = resolveContextService(ctx, 'toolResultPruner')
  assert.ok(resolved, 'LCX must find the toolResultPruner service on a real context')
  assert.equal(concreteService(resolved), pruner, 'LCX must unwrap the Cordis proxy to the concrete instance')

  // Unpatched: the real pruner really shadows an over-threshold tool result.
  const before = concreteService(resolved).pruneSession(sessionWithOversizeToolResult('unpatched'))
  assert.equal(before.pruned.length, 1)
  assert.equal(before.pruned[0].charsBefore, OVERSIZE_CHARS)
  assert.ok(before.pruned[0].charsAfter <= PRUNE_THRESHOLD_CHARS)
  assert.ok(before.charsRemoved > 0)

  const state = toolResultPrunerState(resolved)
  assert.ok(state.pruner, 'a real ToolResultPruner instance must be recognised as patchable')
  assert.equal(typeof state.original, 'function', 'the prototype pruneSession must be captured as the original')

  const patch = patchToolResultPruner(state, () => ({ pruned: [], charsRemoved: 0 }))
  assert.ok(patch, 'the no-op must install on a real instance')

  // Patched: nothing is shadowed, and the surface is left intact.
  const patchedSession = sessionWithOversizeToolResult('patched')
  const during = concreteService(resolved).pruneSession(patchedSession)
  assert.deepEqual(during, { pruned: [], charsRemoved: 0 })
  assert.equal(
    patchedSession.surface.nodes.filter(seq => patchedSession.eventAt(seq)?.type === 'compaction/prune').length,
    0,
    'suppression must leave no compaction/prune on the surface',
  )

  restoreToolResultPruner(patch)

  // Restored: identical real behaviour returns.
  const after = concreteService(resolved).pruneSession(sessionWithOversizeToolResult('restored'))
  assert.equal(after.pruned.length, 1)
  assert.equal(after.pruned[0].charsBefore, before.pruned[0].charsBefore)
  assert.equal(after.pruned[0].charsAfter, before.pruned[0].charsAfter)
  assert.equal(after.charsRemoved, before.charsRemoved)
})

test('the native band suppresses the real pruner and the emergency band releases it', () => {
  const { ctx } = prunerContext()
  const resolved = resolveContextService(ctx, 'toolResultPruner')
  const policy = { auto: NATIVE_PERCENT, emergency: EMERGENCY_PERCENT }
  const contextWindow = 272_000

  for (const [percent, expectedBand] of [[88.3, 'below'], [90.5, 'native'], [95.5, 'emergency']]) {
    const band = compactionPressureBand(Math.round(contextWindow * percent / 100), contextWindow, policy)
    assert.equal(band.band, expectedBand, `${percent}% must be ${expectedBand}`)

    // Production installs the no-op only in the native band.
    const patch = band.band === 'native'
      ? patchToolResultPruner(toolResultPrunerState(resolved), () => ({ pruned: [], charsRemoved: 0 }))
      : undefined

    const result = concreteService(resolved).pruneSession(sessionWithOversizeToolResult(`band-${percent}`))
    if (expectedBand === 'native') assert.deepEqual(result, { pruned: [], charsRemoved: 0 }, 'native band must suppress')
    else assert.equal(result.pruned.length, 1, `${expectedBand} band must let the real pruner act`)

    restoreToolResultPruner(patch)
  }

  // The service is left exactly as production leaves it.
  assert.equal(concreteService(resolved).pruneSession(sessionWithOversizeToolResult('band-final')).pruned.length, 1)
})

test('suppression and restoration hold across two concurrent sessions', () => {
  const { ctx } = prunerContext()
  const resolved = resolveContextService(ctx, 'toolResultPruner')

  const patch = patchToolResultPruner(toolResultPrunerState(resolved), () => ({ pruned: [], charsRemoved: 0 }))
  const a = sessionWithOversizeToolResult('concurrent-a')
  const b = sessionWithOversizeToolResult('concurrent-b')
  assert.deepEqual(concreteService(resolved).pruneSession(a), { pruned: [], charsRemoved: 0 })
  assert.deepEqual(concreteService(resolved).pruneSession(b), { pruned: [], charsRemoved: 0 })
  for (const session of [a, b])
    assert.equal(
      session.surface.nodes.filter(seq => session.eventAt(seq)?.type === 'compaction/prune').length,
      0,
      'neither concurrent session may be pruned while suppressed',
    )

  restoreToolResultPruner(patch)

  for (const session of [sessionWithOversizeToolResult('concurrent-a2'), sessionWithOversizeToolResult('concurrent-b2')])
    assert.equal(concreteService(resolved).pruneSession(session).pruned.length, 1, 'both sessions prune again after restore')
})

// Issue 77 P1 — root vs subagent behaviour.
//
// LCX's only root/subagent branch is `promptCacheSessionId`, which walks a
// subagent chain up to its root so a subagent shares the root's prompt-cache
// identity. tests/protocol.test.mjs covers the walk, but with object literals
// shaped like `{ id, header: { origin, parentSession } }`. Those pass whether
// or not DSH 0.1.6 still names the fields that way. These tests use real
// Session headers from the installed runtime.

function realSession(id, extra) {
  return Session.create(SessionId(id), undefined, {
    version: 3, id, createdAt: Date.now(), isSeeded: false, ...extra,
  })
}

function sessionsOf(...sessions) {
  const byId = new Map(sessions.map(session => [String(session.id), session]))
  return { sessions: { get: id => byId.get(String(id)) } }
}

test('a real subagent Session chain resolves to its root for prompt-cache identity', () => {
  const root = realSession('cache-root')
  const child = realSession('cache-child', { origin: 'subagent', parentSession: 'cache-root' })
  const grandchild = realSession('cache-grandchild', { origin: 'subagent', parentSession: 'cache-child' })

  // The real runtime must still carry the fields LCX branches on.
  assert.equal(child.header.origin, 'subagent')
  assert.equal(child.header.parentSession, 'cache-root')

  const ctx = sessionsOf(root, child, grandchild)
  assert.equal(promptCacheSessionId({ sessionId: 'cache-grandchild' }, {}, ctx), 'cache-root')
  assert.equal(promptCacheSessionId({ sessionId: 'cache-child' }, {}, ctx), 'cache-root')
  assert.equal(promptCacheSessionId({ sessionId: 'cache-root' }, {}, ctx), 'cache-root')
})

test('a real ordinary fork keeps its own prompt-cache identity', () => {
  const root = realSession('fork-root')
  const fork = realSession('fork-child', { parentSession: 'fork-root' })
  assert.equal(fork.header.origin, undefined)
  const ctx = sessionsOf(root, fork)
  assert.equal(promptCacheSessionId({ sessionId: 'fork-child' }, {}, ctx), 'fork-child')
})

test('a real subagent chain with an absent parent falls back to its own identity', () => {
  const orphan = realSession('orphan-child', { origin: 'subagent', parentSession: 'not-present' })
  const ctx = sessionsOf(orphan)
  assert.equal(promptCacheSessionId({ sessionId: 'orphan-child' }, {}, ctx), 'orphan-child')
})

// Issue 77 P1 — the three-step service resolution production actually uses.
//
// src/index.ts:1398-1403 resolves the pruner as
//   resolveAgentService(ctx, agent, 'toolResultPruner')
//     ?? resolveScopedService(agent, 'toolResultPruner')
//     ?? resolveContextService(ctx, 'toolResultPruner')
// The tests above exercise only the third step. These cover the precedence, so
// a per-agent pruner cannot be missed in favour of a context-wide one — with a
// real ToolResultPruner in every slot.

function prunerOn(ctx) {
  return new ToolResultPruner(ctx, {})
}

function prunesOf(resolved, label) {
  return concreteService(resolved).pruneSession(sessionWithOversizeToolResult(label)).pruned.length
}

test('agent-preset resolution wins over the agent scope and the context', () => {
  const rootCtx = new Context()
  rootCtx.provide('tokenMeter', { estimateMessage: () => 1234 }, true)
  const contextPruner = prunerOn(rootCtx)

  const agentCtx = new Context()
  agentCtx.provide('tokenMeter', { estimateMessage: () => 1234 }, true)
  const scopedPruner = prunerOn(agentCtx)

  const presetCtx = new Context()
  presetCtx.provide('tokenMeter', { estimateMessage: () => 1234 }, true)
  const presetPruner = prunerOn(presetCtx)

  rootCtx.provide('agentPresets', {
    serviceFor: (_agent, name) => (name === 'toolResultPruner' ? presetPruner : undefined),
  }, true)

  const agent = { ctx: agentCtx, session: { id: 'agent-1' } }
  const resolved = resolveAgentService(rootCtx, agent, 'toolResultPruner')
    ?? resolveScopedService(agent, 'toolResultPruner')
    ?? resolveContextService(rootCtx, 'toolResultPruner')
  assert.equal(concreteService(resolved), presetPruner, 'the agent preset must win')

  // Patching the resolved service must suppress that instance and leave the others real.
  const patch = patchToolResultPruner(toolResultPrunerState(resolved), () => ({ pruned: [], charsRemoved: 0 }))
  assert.ok(patch)
  assert.equal(presetPruner.pruneSession(sessionWithOversizeToolResult('preset-patched')).pruned.length, 0)
  assert.equal(scopedPruner.pruneSession(sessionWithOversizeToolResult('scoped-live')).pruned.length, 1)
  assert.equal(contextPruner.pruneSession(sessionWithOversizeToolResult('context-live')).pruned.length, 1)
  restoreToolResultPruner(patch)
  assert.equal(presetPruner.pruneSession(sessionWithOversizeToolResult('preset-restored')).pruned.length, 1)
})

test('the agent scope is used when no agent preset provides a pruner', () => {
  const rootCtx = new Context()
  rootCtx.provide('tokenMeter', { estimateMessage: () => 1234 }, true)
  prunerOn(rootCtx)
  rootCtx.provide('agentPresets', { serviceFor: () => undefined }, true)

  const agentCtx = new Context()
  agentCtx.provide('tokenMeter', { estimateMessage: () => 1234 }, true)
  const scopedPruner = prunerOn(agentCtx)

  const agent = { ctx: agentCtx, session: { id: 'agent-2' } }
  const resolved = resolveAgentService(rootCtx, agent, 'toolResultPruner')
    ?? resolveScopedService(agent, 'toolResultPruner')
    ?? resolveContextService(rootCtx, 'toolResultPruner')
  assert.equal(concreteService(resolved), scopedPruner, 'the agent scope must be used')
  assert.equal(prunesOf(resolved, 'scoped-resolved'), 1)
})

test('resolution falls back to the context when the agent carries no scope', () => {
  const rootCtx = new Context()
  rootCtx.provide('tokenMeter', { estimateMessage: () => 1234 }, true)
  const contextPruner = prunerOn(rootCtx)

  const agent = { session: { id: 'agent-3' } }
  const resolved = resolveAgentService(rootCtx, agent, 'toolResultPruner')
    ?? resolveScopedService(agent, 'toolResultPruner')
    ?? resolveContextService(rootCtx, 'toolResultPruner')
  assert.equal(concreteService(resolved), contextPruner, 'the context must be the last resort')
  assert.equal(prunesOf(resolved, 'context-resolved'), 1)
})
