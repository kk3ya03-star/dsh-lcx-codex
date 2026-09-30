import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolResultPruner } from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import apply from '../lib/index.js'
import { pluginConfig, providerContext } from './dsh02-fixture.mjs'

// Issue 77 — the first-call ordering artifact, and the seam it was hiding.
//
// COMPACTION-WIRING-COVERAGE.md recorded an unexplained result: a throwaway
// harness driving LCX's pressure wrapper with a real TokenMeter and a real
// ToolResultPruner decided the band correctly as the *second* harness in a
// process, but as the first it returned early and called the original. The
// cause was not identified, so the test was dropped and the seam — LCX's own
// band decision with the real pruner behind it — stayed uncovered.
//
// DSH 0.2 replaced installSection with schema-derived volatile Config fields.
// The first-call settings lifecycle is covered in wp2-config-route.test.mjs.
//
// What the dropped harness actually tripped is NOT REPRODUCED UNDER THE
// SUPPORTED SEAM, and nothing here claims to have identified its cause: the
// host context below is hand-built rather than the full assembled Cordis/DSH
// plugin graph, so it can show the supported path has no such window but not
// name the historical harness's early return. The regression closes the seam
// the gap was actually about.
//
// This file is deliberately its own test file: `node --test` gives each file
// its own process, so every case below is the *first* LCX install in its
// process — the position the artifact appeared in.

const OVERSIZE_CHARS = 20_000
const PRUNE_THRESHOLD_CHARS = 8192
const HEADROOM_TOKENS = 65_536

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
      toolCallId: callId,
      content: [{ type: 'text', text: 'X'.repeat(OVERSIZE_CHARS) }],
    },
  }, { surfaceOp: 'append' })
  return session
}

function realTokenMeter() {
  const ctx = new Context()
  ctx.provide('sessionProjections', { register: () => () => {}, stateOf: () => undefined, define: () => {} }, true)
  return new TokenMeter(ctx, {})
}

/**
 * Historical host fixture for the pressure-band behavior. The Config lifecycle
 * now has its own DSH 0.2 test; this fixture remains for later compaction work.
 */
function hostContext() {
  const logs = []
  const effects = []
  const handlers = new Map()
  const prunerCtx = new Context()
  prunerCtx.provide('tokenMeter', { estimateMessage: () => 1234 }, true)
  const pruner = new ToolResultPruner(prunerCtx, {})
  const originalPrune = Object.getPrototypeOf(pruner).pruneSession
  const tokenMeter = realTokenMeter()

  let contextWindow = 262144
  const compaction = {
    calls: [],
    config: { thresholdRatio: 0.8, headroomTokens: HEADROOM_TOKENS, retainTokens: 0, modelPolicies: [] },
    async compactIfNeeded(agent) {
      // DSH's engine prunes through the service LCX may have patched.
      const result = agent.ctx.get('toolResultPruner').pruneSession(agent.session)
      this.calls.push({ id: agent.session.id, pruned: result.pruned.length })
      return null
    },
  }
  const originalCompact = compaction.compactIfNeeded

  const provider = providerContext({ fixture: { api: 'openai-responses', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'FIXTURE' } })
  const ctx = {
    llm: { ...provider.llm, resolveModelInfo: async () => ({ context: { contextWindow } }) },
    sessions: {}, tools: { register() {} }, credentials: {}, attachments: {}, fs: {},
    web: { registerSearchProvider() {} },
    settings: { ...provider.settings, configure: () => () => {} },
    agentPresets: { serviceFor: (_agent, name) => ({ compaction, toolResultPruner: pruner })[name] },
    get(name) { return this[name] },
    inject() {},
    on(name, handler) { handlers.set(name, handler) },
    effect(setup) { effects.push(setup()) },
    logger: { info: (message) => logs.push(message), warn: (message) => logs.push(message) },
  }

  return {
    ctx, compaction, pruner, tokenMeter, logs,
    originalPrune, originalCompact,
    install() { apply(ctx, pluginConfig({ enabled: true })) },
    setContextWindow(value) { contextWindow = value },
    agent(id) {
      const session = sessionWithOversizeToolResult(id)
      const result = {
        session,
        options: { provider: 'fixture', model: 'gpt-fixture' },
        ctx: { get: (name) => ({ tokenMeter, toolResultPruner: pruner })[name] },
      }
      handlers.get('agent/created')?.({ agent: result })
      return result
    },
    /** The window that puts this session's real measured total in `percent`. */
    windowFor(session, percent) {
      const total = tokenMeter.measure(session).totalTokens
      return { total, window: HEADROOM_TOKENS + Math.ceil(total / (percent / 100)) }
    },
    async dispose() {
      for (const effect of effects.splice(0).reverse()) if (typeof effect === 'function') await effect()
    },
  }
}

test('first LCX install in a process decides the native band with the real pruner behind it', async () => {
  const f = hostContext()
  f.install()

  const agent = f.agent('native-first-call')
  const { total, window } = f.windowFor(agent.session, 92)
  assert.ok(total > 0, 'the real TokenMeter must measure the real session')
  f.setContextWindow(window)

  await f.compaction.compactIfNeeded(agent, 'pressure', new AbortController().signal)

  const decision = f.logs.find((line) => line.includes('auto pressure'))
  assert.ok(decision, `LCX must make the band decision itself, logs: ${JSON.stringify(f.logs)}`)
  assert.match(decision, /Native V2 first/u)
  assert.match(decision, /\(native 90%, emergency 95%\)/u)

  // The seam: the real ToolResultPruner really was suppressed. The session
  // holds a tool result well over the prune threshold, and nothing pruned it.
  assert.equal(f.compaction.calls.at(-1).pruned, 0)
  assert.equal(f.pruner.pruneSession, f.originalPrune, 'the patch is restored after the call')

  // ...and unpatched, that same pruner really does shadow that result.
  const after = f.pruner.pruneSession(sessionWithOversizeToolResult('control'))
  assert.equal(after.pruned.length, 1)
  assert.ok(after.pruned[0].charsAfter <= PRUNE_THRESHOLD_CHARS)

  await f.dispose()
})

test('first LCX install in a process lets DSH prune in the emergency band', async () => {
  const f = hostContext()
  f.install()

  const agent = f.agent('emergency-first-call')
  const { window } = f.windowFor(agent.session, 97)
  f.setContextWindow(window)

  await f.compaction.compactIfNeeded(agent, 'pressure', new AbortController().signal)

  const decision = f.logs.find((line) => line.includes('auto pressure'))
  assert.ok(decision, `LCX must make the band decision itself, logs: ${JSON.stringify(f.logs)}`)
  assert.match(decision, /emergency DSH prune allowed/u)
  assert.equal(f.compaction.calls.at(-1).pruned, 1, 'the real pruner must run in the emergency band')

  await f.dispose()
})

test('DSH 0.2 plugin Config seeds first-call pressure before a document update', async () => {
  const f = hostContext()
  f.install()

  const agent = f.agent('seeded-at-install')
  f.setContextWindow(f.windowFor(agent.session, 92).window)
  await f.compaction.compactIfNeeded(agent, 'pressure', new AbortController().signal)

  const decision = f.logs.find((line) => line.includes('auto pressure'))
  assert.ok(decision, 'the seeded state is enough to decide the band')
  assert.match(decision, /Native V2 first/u)
  assert.equal(f.compaction.calls.at(-1).pruned, 0)

  await f.dispose()
})
