import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import { SettingsForms } from '@deepseek-ai/dsh-settings'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { Config as PiConfig } from '@deepseek-ai/dsh-llm-pi-ai'
import { loadHostSource } from './wp2-source.mjs'

const [host, route] = await Promise.all([loadHostSource('index'), loadHostSource('route')])

function formFixture(id, schema, raw = {}) {
  const ctx = new Context()
  const logs = []
  ctx.provide('loader', { await: () => Promise.resolve() }, true)
  ctx.provide('profileContext', { home: 'unused' }, true)
  const entry = {
    options: { id, config: raw },
    fiber: { uid: 1, state: 2, runtime: { Config: schema }, config: schema(raw), ctx },
  }
  const editor = {
    configuration: () => [{ entry, inherited: {}, override: raw }],
    entries: () => [entry],
    async edit(_entry, change) {
      raw = change(raw, {})
      entry.options.config = raw
      entry.fiber.config = schema(raw)
    },
  }
  ctx.provide('configEditor', editor, true)
  const forms = new SettingsForms(ctx)
  ctx.on('settings/document-updated', (ns, revision) => logs.push({ ns, revision }))
  return { ctx, entry, forms, logs, raw: () => raw }
}

test('LCX Config is a live SettingsForms entry with defaults, updates and disposal', async () => {
  const f = formFixture('lcx-codex', host.Config)
  const initial = f.forms.describe().find(row => row.ns === 'lcx-codex')
  assert.ok(initial)
  assert.equal(initial.value.enabled, false)
  assert.equal(initial.value.searchMediaPreview, false)
  assert.equal(initial.value.webSearch, false)
  assert.equal(initial.value.alphaCapabilityPath, undefined, 'ordinary config is outside the live form')
  assert.equal(f.entry.fiber.config.enabled.get(), false)
  assert.ok(f.logs.some(row => row.ns === 'lcx-codex'))
  await f.forms.mutate('lcx-codex', [{ op: 'set', path: ['enabled'], value: true }], initial.revision)
  assert.equal(f.forms.describe()[0].value.enabled, true)
  assert.equal(f.entry.fiber.config.enabled.get(), true)
  assert.equal(f.raw().enabled, true)
  assert.ok(f.logs.some(row => row.revision === initial.revision + 1))
  const off = f.forms.configure({ auto: false }, f.entry.fiber)
  assert.equal(f.forms.describe()[0].autoGenerate, false)
  off()
  assert.equal(f.forms.describe()[0].autoGenerate, true)
  f.entry.fiber.state = 0
  assert.deepEqual(f.forms.describe(), [])
  assert.ok(f.logs.some(row => row.revision === initial.revision + 2))
})

test('real DSH legacy settings import keeps LCX switches and the Pi provider profile exactly once', async t => {
  const dshHome = mkdtempSync(join(tmpdir(), 'lcx-issue90-legacy-settings-'))
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  const settingsPath = join(dshHome, 'settings.yaml')
  writeFileSync(settingsPath, [
    'lcx-codex:',
    '  enabled: true',
    '  webSearch: true',
    '  advancedHostedSearch: true',
    '  alphaSearch: true',
    '  grokNativeWebSearch: true',
    '  grokNativeXSearch: true',
    '  searchMediaPreview: true',
    'llm-pi-ai:',
    '  providers:',
    '    relay:',
    '      api: openai-responses',
    '      baseURL: https://relay.invalid/v1',
    '      apiKeyEnv: RELAY_TEST_KEY',
    '      models:',
    '        - id: gpt-fixture',
    '',
  ].join('\n'))

  const ctx = new Context()
  const loaderSettled = Promise.withResolvers()
  ctx.provide('loader', { await: () => loaderSettled.promise }, true)
  ctx.provide('profileContext', { home: dshHome, name: 'isolated-test' }, true)
  const entries = [
    { id: 'lcx-codex', schema: host.Config },
    { id: 'llm-pi-ai', schema: PiConfig },
  ].map(({ id, schema }, index) => ({
    id,
    options: { id, config: {} },
    fiber: { uid: index + 1, state: 2, runtime: { Config: schema }, config: schema({}), ctx },
  }))
  let edits = 0
  ctx.provide('configEditor', {
    configuration: () => entries.map(entry => ({ entry, inherited: {}, override: entry.options.config })),
    entries: () => entries,
    async edit(entry, change) {
      const raw = change(entry.options.config, {})
      entry.options.config = raw
      entry.fiber.config = entry.fiber.runtime.Config(raw)
      edits += 1
    },
  }, true)
  const forms = new SettingsForms(ctx)
  const imported = Promise.withResolvers()
  const realImport = forms.importLegacyDocument.bind(forms)
  forms.importLegacyDocument = async () => {
    try { imported.resolve(await realImport()) }
    catch (error) { imported.reject(error); throw error }
  }
  loaderSettled.resolve()
  await imported.promise

  assert.equal(existsSync(settingsPath), false)
  assert.equal(existsSync(`${settingsPath}.imported`), true)
  assert.match(readFileSync(`${settingsPath}.imported`, 'utf8'), /lcx-codex:/u)
  const lcx = entries[0].fiber.config
  for (const key of ['enabled', 'webSearch', 'advancedHostedSearch', 'alphaSearch', 'grokNativeWebSearch', 'grokNativeXSearch', 'searchMediaPreview'])
    assert.equal(lcx[key].get(), true, key)
  const profile = entries[1].options.config.providers.relay
  assert.equal(profile.api, 'openai-responses')
  assert.equal(profile.baseURL, 'https://relay.invalid/v1')
  assert.equal(profile.apiKeyEnv, 'RELAY_TEST_KEY')
  assert.deepEqual(profile.models, [{ id: 'gpt-fixture' }])
  assert.equal(edits, 2)
  await realImport()
  assert.equal(edits, 2, 'a second boot cannot re-import either section')
  assert.deepEqual(Object.keys(entries[1].options.config.providers), ['relay'])
})

test('LCX applies volatile updates before the next stream', async () => {
  const f = formFixture('lcx-codex', host.Config)
  const config = host.Config({})
  const handlers = new Map()
  const disposers = []
  const ctx = {
    settings: f.forms,
    llm: new LlmRuntime(f.ctx),
    logger: { info() {}, warn() {}, error() {} },
    inject() {},
    on(name, callback) { handlers.set(name, callback); return () => handlers.delete(name) },
    effect(setup) { disposers.push(setup()) },
    get(name) { return this[name] },
  }
  host.apply(ctx, config)
  const next = async function* () { yield { type: 'sentinel' } }
  const options = { provider: 'missing', model: 'gpt-fixture', signal: new AbortController().signal }
  assert.equal((await handlers.get('llm/stream')(options, next).next()).value.type, 'sentinel')
  updateVolatile(config.enabled, host.Config({ enabled: true }).enabled)
  handlers.get('loader/volatile-update')()
  const failure = (await handlers.get('llm/stream')(options, next).next()).value
  assert.notEqual(failure.type, 'sentinel')
  for (const dispose of disposers.reverse()) await dispose?.()
  assert.ok(disposers.length > 0)
})

test('real provider directory and live SettingsForms profile drive the next route', async () => {
  const f = formFixture('llm-pi-ai', PiConfig, {
    providers: {
      relay: { api: 'openai-responses', baseURL: 'https://first.invalid/v1', apiKeyEnv: 'RELAY_KEY', headers: { 'x-secret': 'private-header' }, retryPolicy: { mode: 'normal', maxRetries: 1 }, compat: { supportsStrictMode: false }, models: [{ id: 'gpt-fixture', compat: { supportsDeveloperRole: false } }] },
    },
  })
  const llm = new LlmRuntime(f.ctx)
  llm.registerConfigurableProviders([{ provider: 'relay', displayName: 'Relay', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'relay'] }])
  const context = { settings: f.forms, llm }
  const resolve = () => route.resolveResponsesRouteConfig(context, { provider: 'relay', model: 'gpt-fixture' }, {})
  const first = resolve()
  assert.equal(first.baseURL, 'https://first.invalid/v1')
  assert.equal(first.maxAttempts, 2)
  assert.equal(first.responsesCompat.supportsStrictMode, false)
  assert.deepEqual(first.headers, { 'x-secret': 'private-header' })
  await f.forms.mutate('llm-pi-ai', [
    { op: 'set', path: ['providers', 'relay', 'baseURL'], value: 'https://second.invalid/v1' },
    { op: 'set', path: ['providers', 'relay', 'retryPolicy'], value: { mode: 'normal', maxRetries: 3 } },
    { op: 'set', path: ['providers', 'relay', 'compat'], value: { supportsStrictMode: true } },
    { op: 'set', path: ['providers', 'relay', 'models'], value: [{ id: 'gpt-next', compat: { supportsDeveloperRole: true } }] },
  ], f.forms.describe()[0].revision)
  const next = route.resolveResponsesRouteConfig(context, { provider: 'relay', model: 'gpt-next' }, {})
  assert.equal(next.baseURL, 'https://second.invalid/v1')
  assert.equal(next.maxAttempts, 4)
  assert.equal(next.responsesCompat.supportsStrictMode, true)
  assert.equal(next.responsesCompat.supportsDeveloperRole, true)
  assert.equal(next.model, 'gpt-next')
  assert.equal(JSON.stringify(f.logs).includes('private-header'), false)
  assert.equal(JSON.stringify(f.logs).includes('RELAY_KEY'), false)
})

test('profiles owned by other provider plugins are not LCX routes', () => {
  const f = formFixture('other-provider-plugin', PiConfig, {
    providers: { relay: { api: 'openai-responses', baseURL: 'https://other.invalid/v1', apiKeyEnv: 'RELAY_KEY' } },
  })
  const llm = new LlmRuntime(f.ctx)
  llm.registerConfigurableProviders([{ provider: 'relay', displayName: 'Relay', settingsNs: 'other-provider-plugin', settingsPath: ['providers', 'relay'] }])
  const context = { settings: f.forms, llm }
  assert.equal(route.resolveResponsesRouteConfig(context, { provider: 'relay', model: 'gpt-fixture' }, {}), undefined)
  assert.equal(route.resolveGrokResponsesRouteConfig(context, { provider: 'relay', model: 'grok-4.6' }, {}), undefined)
})

test('a throwing provider directory makes the route unavailable instead of throwing', () => {
  const context = { settings: { describe: () => [] }, llm: { listConfigurableProviders() { throw new Error('directory down') } } }
  assert.equal(route.resolveResponsesRouteConfig(context, { provider: 'relay', model: 'gpt-fixture' }, {}), undefined)
})

test('credentials are resolved only through the DSH credentials service', async () => {
  const previous = process.env.WP2_SENTINEL_KEY
  process.env.WP2_SENTINEL_KEY = 'ambient-should-not-be-read'
  try {
    await assert.rejects(
      route.resolveApiKey({ credentials: { resolve: async () => undefined } }, { apiKeyEnv: 'WP2_SENTINEL_KEY' }),
      { code: 'LCX_CREDENTIAL_UNAVAILABLE' },
    )
    assert.equal(
      await route.resolveApiKey({ credentials: { resolve: async () => ({ value: 'service-value' }) } }, { apiKeyEnv: 'WP2_SENTINEL_KEY' }),
      'service-value',
    )
  } finally {
    if (previous === undefined) delete process.env.WP2_SENTINEL_KEY
    else process.env.WP2_SENTINEL_KEY = previous
  }
})

test('built-in credential-only profile projection omits api and baseURL', () => {
  const f = formFixture('llm-pi-ai', PiConfig, { providers: {
    openai: { apiKeyEnv: 'OPENAI_KEY' },
    xai: { apiKeyEnv: 'XAI_KEY' },
  } })
  const providers = f.forms.describe()[0].value.providers
  for (const name of ['openai', 'xai']) {
    assert.equal(typeof providers[name].apiKeyEnv, 'string')
    assert.equal(providers[name].api, undefined)
    assert.equal(providers[name].baseURL, undefined)
  }
})
