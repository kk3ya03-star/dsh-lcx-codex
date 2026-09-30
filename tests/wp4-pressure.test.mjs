import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { restoreCompactionPatches } from '../lib/dsh-compat.js'

const compiledPath = resolve(`.wp4-index-${process.pid}.mjs`)
const built = await build({
  entryPoints: [resolve('src/index.ts')], bundle: true, packages: 'external',
  format: 'esm', platform: 'node', target: 'node24', write: false,
  footer: { js: '\nexport { patchCompactionPressureService };' },
})
await writeFile(compiledPath, built.outputFiles[0].contents)
let source
try { source = await import(pathToFileURL(compiledPath).href) }
finally { await unlink(compiledPath) }

test('Native and emergency bands use routed pressure budget and exact boundaries', () => {
  const policy = { auto: 90, emergency: 95 }
  for (const contextWindow of [272_000, 500_000, 1_050_000]) {
    for (const outputReserve of [0, 32_768, 131_072]) {
      for (const headroomTokens of [0, 65_536, 131_072]) {
        const budget = contextWindow - outputReserve - headroomTokens
        if (budget <= 0) continue
        const config = { ...policy, outputReserve, headroomTokens }
        const native = Math.floor(budget * 0.9)
        const emergency = Math.floor(budget * 0.95)
        assert.equal(source.compactionPressureBand(native - 1, contextWindow, config).band, 'below')
        assert.equal(source.compactionPressureBand(native, contextWindow, config).band, 'native')
        assert.equal(source.compactionPressureBand(emergency - 1, contextWindow, config).band, 'native')
        assert.equal(source.compactionPressureBand(emergency, contextWindow, config).band, 'emergency')
        assert.equal(source.compactionPressureBand(native, contextWindow, config).pressureBudget, budget)
        // DSH uses this formula after LCX scopes the ratio for the target.
        const dshScopedThreshold = Math.floor(Math.min(contextWindow * (native / contextWindow), budget))
        assert.ok(dshScopedThreshold <= native)
        assert.ok(native - dshScopedThreshold <= 1)
        assert.ok(native <= budget, 'Native begins within DSH capacity')
      }
    }
  }
})

test('GPT pressure wrapper preserves DSH below band and uses header output cap plus model headroom', async () => {
  const calls = []
  const compaction = {
    config: { thresholdRatio: 0.8, headroomTokens: 65_536, modelPolicies: [{ provider: 'relay', model: 'gpt-fixture', headroomTokens: 20_000 }] },
    async compactIfNeeded(agent) {
      calls.push({ id: agent.session.id, thresholdRatio: this.config.thresholdRatio, prune: agent.ctx.get('toolResultPruner').pruneSession(agent.session) })
      return null
    },
  }
  const pruner = { pruneSession() { return 'real-prune' } }
  let contextWindow = 272_000
  const ctx = {
    llm: {
      listConfigurableProviders: () => [{ provider: 'relay', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'relay'] }],
      resolveModelInfo: async () => ({ context: { contextWindow }, defaultMaxTokens: 32_768 }),
    },
    settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { relay: { api: 'openai-responses', baseURL: 'https://fixture.invalid/v1', apiKeyEnv: 'FIXTURE' } } } }] },
    agentPresets: { serviceFor: (_agent, name) => ({ compaction, toolResultPruner: pruner })[name] },
    logger: { info() {} }, get(name) { return this[name] },
  }
  const records = new Map()
  assert.equal(source.patchCompactionPressureService(compaction, { enabled: true }, () => ({}), ctx, records), true)
  const budget = 272_000 - 40_000 - 20_000
  const native = Math.floor(budget * 0.9)
  const emergency = Math.floor(budget * 0.95)
  const run = async (id, tokens, model = 'gpt-fixture', maxTokens = 40_000) => {
    const session = Session.create(SessionId(id))
    session.append('request/header', { header: { config: { provider: 'relay', model, ...(maxTokens === null ? {} : { maxTokens }) } }, reason: 'initial' })
    const agent = { session, options: {}, ctx: { get: name => ({ tokenMeter: { measure: () => ({ totalTokens: tokens }) }, toolResultPruner: pruner })[name] } }
    await compaction.compactIfNeeded(agent, 'pressure', new AbortController().signal)
    return calls.at(-1)
  }
  try {
    assert.deepEqual(await run('below', native - 1), { id: 'below', thresholdRatio: 0.8, prune: 'real-prune' })
    const atNative = await run('native', native)
    assert.equal(atNative.prune.pruned.length, 0)
    assert.ok(Math.floor(Math.min(272_000 * atNative.thresholdRatio, budget)) <= native)
    const atEmergency = await run('emergency', emergency)
    assert.equal(atEmergency.prune, 'real-prune')
    const defaultBudget = 272_000 - 32_768 - 20_000
    const atDefault = await run('adapter-default', Math.floor(defaultBudget * 0.9), 'gpt-fixture', null)
    assert.equal(atDefault.prune.pruned.length, 0)
    contextWindow = 1_050_000
    const hostDefaultThreshold = Math.floor(Math.min(contextWindow * 0.8, contextWindow - 32_768 - 20_000))
    assert.ok(hostDefaultThreshold < Math.floor((contextWindow - 32_768 - 20_000) * 0.9))
    assert.deepEqual(await run('host-earlier', hostDefaultThreshold, 'gpt-fixture', null), {
      id: 'host-earlier', thresholdRatio: 0.8, prune: 'real-prune',
    })
    assert.deepEqual(await run('grok', emergency, 'grok-4.6'), { id: 'grok', thresholdRatio: 0.8, prune: 'real-prune' })
    assert.equal(compaction.config.thresholdRatio, 0.8)
  } finally { restoreCompactionPatches(records) }
})
