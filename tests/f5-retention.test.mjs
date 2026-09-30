import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { Context } from '@deepseek-ai/cordis'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { restoreCompactionPatches } from '../lib/dsh-compat.js'

const compiledPath = resolve(`.f5-retention-${process.pid}.mjs`)
const built = await build({
  entryPoints: [resolve('src/index.ts')], bundle: true, packages: 'external',
  format: 'esm', platform: 'node', target: 'node24', write: false,
  footer: { js: '\nexport { patchCompactionPressureService };' },
})
await writeFile(compiledPath, built.outputFiles[0].contents)
let source
try { source = await import(pathToFileURL(compiledPath).href) }
finally { await unlink(compiledPath) }

const WINDOW = 272_000
const OUTPUT = 32_768
const HEADROOM = 65_536
const BUDGET = WINDOW - OUTPUT - HEADROOM
const NATIVE = Math.floor(0.9 * BUDGET)
const MODEL = 'gpt-fixture'
let sessionNumber = 0

async function pressureWithRealEngine(config, expectedRatio) {
  const logs = []
  const observed = []
  const meter = { measure: () => ({ totalTokens: NATIVE, nodes: [] }) }
  let engine
  const ctx = new Context()
  ctx.provide('llm', {
      listConfigurableProviders: () => [{ provider: 'relay', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'relay'] }],
      async resolveModelInfo() {
        observed.push({ config: engine.config, ratio: engine.config.modelPolicies.find(p => p.provider === 'relay' && p.model === MODEL)?.thresholdRatio ?? engine.config.thresholdRatio })
        return { context: { contextWindow: WINDOW }, defaultMaxTokens: OUTPUT }
      },
  }, true)
  ctx.provide('tokenMeter', meter, true)
  ctx.provide('settings', { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { relay: { api: 'openai-responses', baseURL: 'https://fixture.invalid/v1', apiKeyEnv: 'FIXTURE' } } } }] }, true)
  ctx.logger.info = message => logs.push(message)
  engine = new BasicCompactionEngine(ctx, { auto: false, headroomTokens: HEADROOM, ...config })
  const original = engine.config
  const session = Session.create(SessionId(`f5-retention-${++sessionNumber}`))
  session.append('request/header', {
    header: { config: { provider: 'relay', model: MODEL, maxTokens: OUTPUT } }, reason: 'initial',
  })
  const agent = { session, options: {}, ctx: { get: name => name === 'tokenMeter' ? meter : undefined } }
  const records = new Map()
  assert.equal(source.patchCompactionPressureService(engine, { enabled: true }, () => ({}), ctx, records), true)
  try {
    // This invokes the installed BasicCompactionEngine's resolveCompactSpec path.
    assert.equal(await engine.compactIfNeeded(agent, 'pressure', new AbortController().signal), null)
    assert.equal(observed.length, 2)
    assert.equal(observed[1].ratio, expectedRatio)
    assert.equal(observed[1].config === original, expectedRatio === 0.8)
    assert.equal(engine.config, original)
    assert.equal(logs.filter(message => message.includes('retaining upstream DSH threshold')).length,
      expectedRatio === 0.8 ? 1 : 0)
  } finally { restoreCompactionPatches(records) }
}

test('root retainTokens conflict keeps upstream pressure with the reported 272k example', async () => {
  assert.equal(BUDGET, 173_696)
  assert.equal(NATIVE, 156_326)
  await pressureWithRealEngine({ retainTokens: 165_000 }, 0.8)
})

test('root retainRatio conflict keeps upstream pressure', async () => {
  await pressureWithRealEngine({ retainRatio: 0.68 }, 0.8)
})

test('exact-model retainTokens overrides safe root retention and keeps upstream pressure', async () => {
  await pressureWithRealEngine({ retainRatio: 0.1, modelPolicies: [
    { provider: 'relay', model: MODEL, retainTokens: 165_000 },
  ] }, 0.8)
})

test('exact-model retainRatio overrides root retainTokens and keeps upstream pressure', async () => {
  await pressureWithRealEngine({ retainTokens: 20_000, modelPolicies: [
    { provider: 'relay', model: MODEL, retainRatio: 0.68 },
  ] }, 0.8)
})

test('safe retention still scopes the real engine to the 90% budget threshold', async () => {
  await pressureWithRealEngine({ retainTokens: 100_000 }, NATIVE / WINDOW)
})
