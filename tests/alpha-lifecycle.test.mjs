import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import apply from '../lib/index.js'
import { ALPHA_PROBE_VERSION, ALPHA_SCHEMA_FINGERPRINT } from '../lib/web-search-alpha.js'
import { AlphaCapabilityStore, alphaCapabilityFingerprint } from '../lib/web-search-capability.js'
import { AlphaRefStore } from '../lib/web-search-ref-store.js'
import { routeFingerprint } from '../lib/route.js'

test('registered Alpha tool conforms to DSH output schema while persisting private refs', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-alpha-lifecycle-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const route = { provider: 'fixture', model: 'gpt-fixture', baseURL: 'https://example.invalid/v1', sessionId: 'session-alpha-output' }
  const capabilityPath = join(directory, 'capabilities.json')
  const refPath = join(directory, 'refs.json')
  new AlphaCapabilityStore(capabilityPath).put(alphaCapabilityFingerprint({ ...route, profile: '', group: '', schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT }), {
    classification: 'command-capable', actions: { time: 'supported' }, probedAt: new Date().toISOString(),
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT, probeVersion: ALPHA_PROBE_VERSION, provenance: 'unavailable',
  })
  const handlers = new Map()
  const definitions = new Map()
  const tools = { register(definition) {
    assert.equal(this, tools)
    definitions.set(definition.name, definition)
    return () => definitions.delete(definition.name)
  } }
  const ctx = {
    llm: {}, sessions: {}, attachments: {}, fs: {}, tools,
    credentials: { resolve: async () => ({ value: 'synthetic-only' }) },
    web: { searchProviderId: 'native', registerSearchProvider() {} },
    settings: {
      get: () => ({ providers: { fixture: { api: 'openai-responses', baseURL: route.baseURL, apiKeyEnv: 'FIXTURE_KEY' } } }),
      installSection(_owner, _key, _schema, _base, hooks) {
        hooks.setSource(() => ({ enabled: true, webSearch: true, advancedHostedSearch: false, alphaSearch: true }))
        hooks.onChange()
      },
    },
    on(name, handler) { handlers.set(name, handler) },
    get(name) { return this[name] },
    inject() {}, effect() {},
    logger: { info() {}, warn(message) { assert.fail(message) } },
  }
  apply(ctx, { alphaCapabilityPath: capabilityPath, alphaRefPath: refPath })
  const agent = { options: route, session: Session.create(SessionId(route.sessionId)), ctx: { get: name => name === 'tools' ? tools : undefined } }
  handlers.get('agent/created')({ agent })
  const tool = definitions.get('websearch_alpha')
  assert.ok(tool, 'verified route advertises its actual Alpha tool')
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    id: 'alpha-fixture', output: 'Synthetic UTC time', results: [{ ref_id: 'turn0time0', value: '12:00' }],
  }), { headers: { 'content-type': 'application/json' } }))
  const value = await tool.execute({ action: 'time', utcOffset: '+00:00' }, { agent, signal: new AbortController().signal })
  assert.deepEqual(validateJsonSchemaValue(tool.output.schema, value), [])
  assert.equal(Object.hasOwn(value, 'refRecords'), false)
  assert.ok(value.refs.includes('turn0time0'))
  const store = new AlphaRefStore(refPath)
  assert.doesNotThrow(() => store.assertUsable(route.sessionId, routeFingerprint(route), 'turn0time0'))
  globalThis.fetch.mock.mockImplementation(async () => new Response(JSON.stringify({
    output: 'Unable to open `turn0time0`: the reference ID is invalid or unavailable in this browsing session.',
    results: [{ ref_id: 'turn0failed' }],
  }), { headers: { 'content-type': 'application/json' } }))
  await assert.rejects(tool.execute({ action: 'open', refId: 'turn0time0' }, { agent }), { code: 'LCX_ALPHA_ACTION_FAILED' })
  assert.throws(() => new AlphaRefStore(refPath).assertUsable(route.sessionId, routeFingerprint(route), 'turn0failed'))
  globalThis.fetch.mock.mockImplementation(async () => new Response(JSON.stringify({
    output: 'Synthetic UTC time after error', results: [{ ref_id: 'turn1time0', value: '12:01' }],
  }), { headers: { 'content-type': 'application/json' } }))
  const recovered = await tool.execute({ action: 'time', utcOffset: '+00:00' }, { agent })
  assert.deepEqual(validateJsonSchemaValue(tool.output.schema, recovered), [])
  assert.ok(recovered.refs.includes('turn1time0'))
  handlers.get('session/disposed')(agent.session)
  assert.equal(definitions.has('websearch_alpha'), false)
})

test('plugin apply accepts a valid V1 ref store while Alpha is disabled without rewriting it', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-alpha-v1-disabled-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const refPath = join(directory, 'refs.json')
  const source = `${JSON.stringify({
    version: 1,
    sessions: {
      'legacy-session': {
        routeFingerprint: 'legacy-route',
        updatedAt: '2026-09-09T00:00:00.000Z',
        refs: { turn0search0: { refId: 'turn0search0', url: 'https://example.com/docs' } },
      },
    },
  }, null, 2)}\n`
  writeFileSync(refPath, source)
  const ctx = {
    llm: {}, sessions: {}, attachments: {}, fs: {}, tools: { register() {} }, credentials: {},
    web: { searchProviderId: 'native', registerSearchProvider() {} },
    settings: {
      get: () => ({ providers: {} }),
      installSection(_owner, _key, _schema, _base, hooks) {
        hooks.setSource(() => ({ enabled: true, webSearch: true, advancedHostedSearch: false, alphaSearch: false }))
        hooks.onChange()
      },
    },
    on() {}, get(name) { return this[name] }, inject() {}, effect() {},
    logger: { info() {}, warn() {} },
  }
  assert.doesNotThrow(() => apply(ctx, {
    alphaRefPath: refPath,
    alphaCapabilityPath: join(directory, 'capabilities.json'),
  }))
  assert.equal(readFileSync(refPath, 'utf8'), source)
})
