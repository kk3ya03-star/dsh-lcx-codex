import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSpillStore from '@deepseek-ai/dsh-spill-local'
import * as spillPolicy from '@deepseek-ai/dsh-spill-policy'
import { hasSpillNotice } from '@deepseek-ai/dsh-spill-policy/notice'
import { createAssistantMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import applyLcx from '../lib/index.js'
import { loadHostSource } from './wp2-source.mjs'
import { AlphaCapabilityStore, alphaCapabilityFingerprint } from '../lib/web-search-capability.js'
import { ALPHA_PROBE_VERSION, ALPHA_SCHEMA_FINGERPRINT } from '../lib/web-search-alpha.js'
import { AlphaRefStore } from '../lib/web-search-ref-store.js'
import { routeFingerprint } from '../lib/route.js'

const route = { provider: 'fixture', model: 'gpt-fixture', baseURL: 'https://fixture.invalid/v1' }
const { serializeDshMessages } = await loadHostSource('dsh-responses')
const LONG = `BEGIN ${'middle evidence '.repeat(11000)} END`
const mediaUrl = 'https://images.example.com/fixture.png'

function providerResponse({ images = false } = {}) {
  return {
    id: 'canned-hosted', status: 'completed', output_text: LONG,
    usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, input_tokens_details: { cached_tokens: 4 } },
    output: [{ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ url: 'https://example.com/source', title: 'Source' }] },
      ...(images ? { results: [{ type: 'image_result', image_url: mediaUrl, caption: 'Fixture image' }] } : {}) }],
  }
}

async function fixture(t, { failStore = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'lcx-f13-spill-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const ctx = new Context()
  const fibers = [await ctx.plugin(SystemPrompt), await ctx.plugin(ToolRuntime),
    await ctx.plugin(LocalSpillStore, { root: join(directory, 'spill'), cleanupPeriodDays: 0 }),
    await ctx.plugin(spillPolicy, { maxInlineTokens: 12500 })]
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  const warnings = []
  ctx.logger.warn = message => warnings.push(String(message))
  if (failStore) ctx.spillStore.saveText = async () => { throw new Error('canned storage failure') }

  const capabilityPath = join(directory, 'capabilities.json')
  const refPath = join(directory, 'refs.json')
  new AlphaCapabilityStore(capabilityPath).put(alphaCapabilityFingerprint({ ...route, profile: '', group: '', schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT }), {
    classification: 'command-capable', actions: { search_query: 'supported', open: 'supported' },
    probedAt: new Date().toISOString(), schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    probeVersion: ALPHA_PROBE_VERSION, provenance: 'unavailable',
  })
  const handlers = new Map()
  const definitions = new Map()
  const fake = {
    logger: { info() {}, warn(message) { warnings.push(String(message)) } },
    llm: { listConfigurableProviders: () => [{ provider: 'fixture', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'fixture'] }] },
    sessions: {}, attachments: {}, fs: {},
    credentials: { resolve: async () => ({ value: 'canned-only' }) },
    web: { searchProviderId: 'native', registerSearchProvider() {} },
    tools: { register() { throw new Error('unexpected global registration') } },
    settings: {
      get: () => ({ providers: { fixture: { api: 'openai-responses', baseURL: route.baseURL, apiKeyEnv: 'CANNED_KEY' } } }),
      describe: () => [{ ns: 'llm-pi-ai', value: { providers: { fixture: { api: 'openai-responses', baseURL: route.baseURL, apiKeyEnv: 'CANNED_KEY' } } } }],
      configure: () => () => {},
      installSection(_owner, _key, _schema, _base, hooks) {
        hooks.setSource(() => ({ enabled: true, webSearch: true, advancedHostedSearch: true, alphaSearch: true }))
        hooks.onChange()
      },
    },
    on(name, handler) { handlers.set(name, handler) },
    get(name) { return this[name] }, inject() {}, effect() {},
  }
  const live = value => ({ get: () => value })
  applyLcx(fake, { alphaCapabilityPath: capabilityPath, alphaRefPath: refPath, maxAttempts: 1,
    enabled: live(true), webSearch: live(true), advancedHostedSearch: live(true), alphaSearch: live(true),
    grokNativeWebSearch: live(false), grokNativeXSearch: live(false) })
  const session = Session.create(SessionId('f13-session'))
  const agent = {
    options: route, session,
    ctx: { get(name) { return name === 'tools' ? {
      get(toolName) { return definitions.get(toolName) },
      register(definition) { definitions.set(definition.name, definition); return () => definitions.delete(definition.name) },
    } : undefined } },
  }
  handlers.get('agent/created')({ agent })
  assert.ok(definitions.size > 0, JSON.stringify(warnings))
  for (const definition of definitions.values()) ctx.tools.register(definition)
  const run = (name, args) => ctx.tools.execute({ toolCallId: ToolCallId(`call-${name}`), name, arguments: args, agent,
    signal: new AbortController().signal })
  return { directory, refPath, ctx, session, agent, run, warnings }
}

async function serializedResult(name, result, ctx) {
  const callId = `call-${name}`
  const messages = [
    createAssistantMessage({ content: [{ type: 'tool-call', id: callId, name, arguments: '{}' }], source: { provider: route.provider, model: route.model } }),
    createToolResultMessage({ callId, content: result.content, isError: result.isError }),
  ]
  const serialized = await serializeDshMessages(messages, ctx, { route, imageSupport: 'unsupported' })
  const output = serialized.input.find(item => item.type === 'function_call_output' && item.call_id === callId)
  assert.ok(output)
  return output
}

test('F13 real Hosted and Alpha results spill into bounded model output and preserve metadata and cold locator', async t => {
  const h = await fixture(t)
  t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(String(url).includes('/alpha/search')
    ? { id: 'canned-alpha', output: LONG, results: [{ ref_id: 'turn0search0', url: 'https://example.com/source' }] }
    : providerResponse({ images: true })), { headers: { 'content-type': 'application/json' } }))
  for (const [name, args] of [
    ['web_search', { queries: ['fixture'] }],
    ['websearch_gpt_advanced', { query: 'fixture', searchContentTypes: ['text', 'image'] }],
    ['websearch_alpha', { action: 'search_query', query: 'fixture' }],
  ]) {
    const result = await h.run(name, args)
    assert.equal(result.isError, false, JSON.stringify(result))
    const text = result.content.map(block => block.text ?? '').join('')
    assert.ok(text.length < LONG.length / 2, name)
    assert.ok(hasSpillNotice(text), name)
    assert.match(text, /BEGIN/)
    assert.match(text, /END|opaqueRef=turn0search0/)
    const output = await serializedResult(name, result, h.ctx)
    assert.match(JSON.stringify(output.output), /Full formatted result stored at:/)
    const callId = `call-${name}`
    const message = createToolResultMessage({ callId, content: result.content, isError: result.isError })
    h.session.append('tool/result', { turn: 1, step: 1, ...(result.meta ? { meta: result.meta } : {}), message }, { surfaceOp: 'append' })
    const reopened = Session.fromRestore(h.session.id, [...h.session.snapshotEvents()], h.session.header, h.session.inheritedEventCount, 'shared-frozen')
    const persisted = [...reopened.snapshotEvents()].filter(event => event.type === 'tool/result').at(-1).data
    assert.deepEqual(persisted.message.content, result.content)
    assert.deepEqual(persisted.meta, result.meta)
    const locator = /Full formatted result stored at: ([^ ]+)\. Use read/.exec(text)?.[1]
    assert.ok(locator, name)
    assert.match(readFileSync(locator, 'utf8'), /middle evidence/)
    assert.match(readFileSync(locator, 'utf8'), /BEGIN/)
    assert.equal(hasSpillNotice(persisted.message.content.map(block => block.text ?? '').join('')), true)
    if (name !== 'websearch_alpha') {
      assert.equal(result.meta.auxiliaryUsage[0].usage.totalTokens, 30)
      if (name === 'websearch_gpt_advanced') {
        assert.equal(result.meta.lcxHostedMedia.candidates[0].url, mediaUrl)
        assert.match(JSON.stringify(output.output), /fixture\.png/)
        assert.match(readFileSync(locator, 'utf8'), /Fixture image/)
      }
    } else {
      assert.doesNotThrow(() => new AlphaRefStore(h.refPath).assertUsable(String(h.session.id), routeFingerprint({ ...route, sessionId: String(h.session.id) }), 'turn0search0'))
    }
  }
})

test('F13 real spill-store failure keeps canonical Hosted content inline', async t => {
  const h = await fixture(t, { failStore: true })
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(providerResponse()), { headers: { 'content-type': 'application/json' } }))
  const result = await h.run('websearch_gpt_advanced', { query: 'fixture' })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.match(result.content[0].text, /middle evidence/)
  assert.equal(hasSpillNotice(result.content[0].text), false)
  assert.ok(h.warnings.some(message => message.includes('keeping the inline content')))
  const output = await serializedResult('websearch_gpt_advanced', result, h.ctx)
  assert.match(JSON.stringify(output.output), /middle evidence/)
})

test('F13 Alpha ref omitted from the inline middle still resolves after cold ref-store reopen', async t => {
  const h = await fixture(t)
  const refs = Array.from({ length: 500 }, (_, index) => `turn0search${index}`)
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body)
    return new Response(JSON.stringify(request.commands.open
      ? { id: 'canned-open', output: 'Recovered omitted Alpha reference', results: [{ ref_id: request.commands.open[0].ref_id }] }
      : { id: 'canned-many-refs', output: LONG, results: refs.map((ref_id, index) => ({ ref_id, url: `https://example.com/source/${index}` })) }),
    { headers: { 'content-type': 'application/json' } })
  })
  const result = await h.run('websearch_alpha', { action: 'search_query', query: 'fixture' })
  assert.equal(result.isError, false, JSON.stringify(result))
  const view = result.content.map(block => block.text ?? '').join('')
  assert.ok(hasSpillNotice(view))
  const omitted = refs.find(ref => !view.includes(`opaqueRef=${ref} `))
  assert.ok(omitted, 'at least one Alpha ref is outside the bounded inline view')
  const reopened = new AlphaRefStore(h.refPath)
  assert.doesNotThrow(() => reopened.assertUsable(String(h.session.id), routeFingerprint({ ...route, sessionId: String(h.session.id) }), omitted))
  const continued = await h.run('websearch_alpha', { action: 'open', refId: omitted })
  assert.equal(continued.isError, false, JSON.stringify(continued))
  assert.match(continued.content[0].text, /Recovered omitted Alpha reference/)
})
