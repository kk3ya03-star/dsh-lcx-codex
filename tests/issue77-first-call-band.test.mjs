import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolResultPruner } from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import SettingsProvider from '@deepseek-ai/dsh-settings'
import apply from '../lib/index.js'

// Issue 77 — the first-call ordering artifact, and the seam it was hiding.
//
// COMPACTION-WIRING-COVERAGE.md recorded an unexplained result: a throwaway
// harness driving LCX's pressure wrapper with a real TokenMeter and a real
// ToolResultPruner decided the band correctly as the *second* harness in a
// process, but as the first it returned early and called the original. The
// cause was not identified, so the test was dropped and the seam — LCX's own
// band decision with the real pruner behind it — stayed uncovered.
//
// The obvious explanation — that `state.enabled` is still false because the
// settings `onChange` has not run — was tested here and is **wrong**. LCX seeds
// its settings state eagerly from `source()` immediately after
// `installSection` returns (src/index.ts:1800-1809), so the band decision never
// waits for `onChange`. That is asserted below rather than assumed, and it is
// half of why production has no such window; the other half is that DSH 0.1.6's
// own SettingsProvider calls `hooks.onChange()` synchronously inside
// `installSection` anyway (@deepseek-ai/dsh-settings/lib/index.js:327-338),
// which is also asserted against the installed runtime.
//
// The one settings-shaped way to reach the early return is a host whose
// `installSection` never supplies a source at all, which no DSH does.
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

function realTokenMeter() {
  const ctx = new Context()
  ctx.provide('sessionProjections', { register: () => () => {}, stateOf: () => undefined, define: () => {} }, true)
  return new TokenMeter(ctx, {})
}

/**
 * The host context LCX installs into. `settings.installSection` is the only
 * seam under experiment. Everything the band decision itself touches — Session,
 * TokenMeter, ToolResultPruner — is the real installed class.
 */
function hostContext({ settingsMode = 'sync' } = {}) {
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
    config: { thresholdRatio: 0.8, modelPolicies: [] },
    async compactIfNeeded(agent) {
      // DSH's engine prunes through the service LCX may have patched.
      const result = agent.ctx.get('toolResultPruner').pruneSession(agent.session)
      this.calls.push({ id: agent.session.id, pruned: result.pruned.length })
      return null
    },
  }
  const originalCompact = compaction.compactIfNeeded

  let settingsRefresh
  const entry = {
    enabled: true,
    webSearch: false,
    advancedHostedSearch: false,
    alphaSearch: false,
    grokNativeWebSearch: false,
    grokNativeXSearch: false,
    searchMediaPreview: false,
  }
  const ctx = {
    llm: { resolveModelInfo: async () => ({ context: { contextWindow } }) },
    sessions: {}, tools: { register() {} }, credentials: {}, attachments: {}, fs: {},
    web: { registerSearchProvider() {} },
    settings: {
      get: () => ({
        providers: {
          fixture: { api: 'openai-responses', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'FIXTURE' },
        },
      }),
      installSection(_owner, _ns, _schema, _base, hooks) {
        // 'sync' is what DSH's own SettingsProvider does. 'manual' withholds
        // onChange. 'silent' supplies nothing at all, which no DSH does.
        if (settingsMode === 'silent') return
        hooks.setSource(() => entry)
        settingsRefresh = hooks.onChange
        if (settingsMode === 'sync') hooks.onChange()
      },
    },
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
    install() { apply(ctx) },
    refreshSettings: () => settingsRefresh?.(),
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
      return { total, window: Math.ceil(total / (percent / 100)) }
    },
    async dispose() {
      for (const effect of effects.splice(0).reverse()) if (typeof effect === 'function') await effect()
    },
  }
}

test('DSH 0.1.6 settings call onChange synchronously inside installSection', () => {
  // The production lifecycle has no window in which state.enabled is still
  // false: this is the installed runtime's own behaviour, not a reading of it.
  const ctx = new Context()
  const provider = new SettingsProvider(ctx, {})
  assert.equal(typeof provider.installSection, 'function')

  const source = provider.installSection.toString()
  assert.match(source, /hooks\.onChange\(\)/u)

  // LCX registers its own section through this method; drive it with LCX's own
  // shape of hooks and assert onChange lands before installSection returns.
  let changedBeforeReturn = false
  let registered = false
  const recording = {
    ...provider,
    register() { registered = true; return { get: () => ({ enabled: true }), watch() {} } },
    ctx: { effect() {} },
  }
  provider.installSection.call(recording, ctx, 'probe-ns', {}, { enabled: true }, {
    setSource() {},
    onChange() { changedBeforeReturn = true },
  })
  assert.equal(registered, true)
  assert.equal(changedBeforeReturn, true, 'onChange must land before installSection returns')
})

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

test('LCX seeds its settings state at install, so the first call does not wait for onChange', async () => {
  // 'manual' never calls onChange at all. If the band decision depended on it,
  // this is exactly the position the dropped harness failed in.
  const f = hostContext({ settingsMode: 'manual' })
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

test('only a host that never supplies a settings source leaves LCX disabled', async () => {
  // The single settings-shaped route to the early return, named so it is not
  // mistaken for a product defect: no DSH behaves this way.
  const f = hostContext({ settingsMode: 'silent' })
  f.install()

  const agent = f.agent('no-source')
  f.setContextWindow(f.windowFor(agent.session, 92).window)
  await f.compaction.compactIfNeeded(agent, 'pressure', new AbortController().signal)

  assert.equal(
    f.logs.find((line) => line.includes('auto pressure')),
    undefined,
    'with no source LCX stays disabled and returns early',
  )
  assert.equal(f.compaction.calls.at(-1).pruned, 1, 'the original ran unmodified, so DSH pruned')

  await f.dispose()
})
