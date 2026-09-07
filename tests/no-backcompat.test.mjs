import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import apply, { Config } from '../lib/index.js'
import { assertSupportedCheckpointMessage, checkpointStateForMessage, stateFromSummaryEvent } from '../lib/native-checkpoint.js'
import { baseURLFingerprint, resolveResponsesRouteConfig, routeCompatible } from '../lib/route.js'
import { buildResponsesBody } from '../lib/responses-request.js'

const selected = { provider: 'fixture', model: 'gpt-fixture', sessionId: 'session-cleanup' }
const profile = { api: 'openai-responses', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'FIXTURE_KEY' }
const user = text => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const collect = async stream => { const result = []; for await (const item of stream) result.push(item); return result }

test('remote compaction trusts DSH directive provenance, never matching user prompt text', async (t) => {
  const session = Session.create(SessionId(selected.sessionId))
  const h = harness({ session, config: { maxAttempts: 1 } })
  let body
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    body = JSON.parse(init.body)
    return new Response('synthetic unauthorized', { status: 401 })
  })
  for (const [source, text, retained] of [
    [{ kind: 'plugin', plugin: 'dsh-compaction-basic' }, 'Future DSH summary instruction', false],
    [{ kind: 'user' }, 'You are now acting as a compaction engine: please review this prompt', true],
    [{ kind: 'plugin', plugin: 'another-plugin' }, 'You are now acting as a compaction engine: quoted content', true],
  ]) {
    await assert.rejects(collect(h.handlers.get('llm/stream')({
      ...selected, purpose: 'compaction', messages: [user('history survives'), { ...user(text), source }],
    }, () => { throw new Error('Basic must not run') })), { code: 'LCX_HTTP_ERROR' })
    assert.equal(JSON.stringify(body.input).includes(text), retained)
    assert.equal(JSON.stringify(body.input).includes('history survives'), true)
    assert.deepEqual(body.input.at(-1), { type: 'compaction_trigger' })
  }
})

function harness({ profiles = { fixture: profile }, enabled = true, session, config = {}, settings = {} } = {}) {
  const handlers = new Map()
  let webProvider, schema, entry, onChange
  const imageOptions = []
  const ctx = {
    logger: { info() {}, warn() {} },
    sessions: { get: () => session },
    credentials: { resolve: async () => ({ value: 'synthetic-test-key' }) },
    llm: {
      resolveModelInfo: async () => ({ input: ['text', 'image'], context: { contextWindow: 262144 } }),
      fileRequestText: () => 'file fixture',
    },
    attachments: {
      imageHostPath() { return 'D:/synthetic/image.png' },
      async readImageRequest(ref, options) {
        imageOptions.push(options)
        return { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', attachment: ref, bytes: 3, width: 1, height: 1 }
      },
    },
    web: { searchProviderId: 'native', registerSearchProvider(provider) { webProvider = provider } },
    tools: { register: () => () => {} },
    settings: {
      get: () => ({ providers: profiles }),
      installSection(_owner, _namespace, valueSchema, value, hooks) {
        schema = valueSchema
        entry = { ...value, ...settings, enabled, webSearch: true }
        hooks.setSource(() => entry)
        onChange = hooks.onChange
        onChange()
      },
    },
    on(event, handler) { handlers.set(event, handler) },
    inject(names, callback) { if (names.every(name => ctx[name])) callback(ctx) },
    get(name) { return ctx[name] },
    effect() {},
  }
  apply(ctx, config)
  return { ctx, handlers, webProvider, schema, entry, imageOptions, change() { onChange() } }
}

test('removed config and stored settings fields are absent, not migration aliases', () => {
  const fields = Config.dict
  for (const field of ['provider', 'model', 'baseURL', 'apiKeyEnv', 'headers', 'legacyCheckpointPath', 'checkpointPath', 'webSearchTimeoutMs', 'autoCompactionThresholdPercent', 'emergencyPruneThresholdPercent']) {
    assert.equal(Object.hasOwn(fields, field), false, field)
  }
  const h = harness()
  assert.deepEqual(Object.keys(h.schema.dict).sort(), ['advancedHostedSearch', 'alphaSearch', 'enabled', 'webSearch'])
  for (const path of ['src/legacy-v3.ts', 'lib/legacy-v3.js', 'lib/types/legacy-v3.d.ts']) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path)
  }
  for (const path of ['src/index.ts', 'src/route.ts', 'src/native-checkpoint.ts']) {
    assert.doesNotMatch(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), /fallbackOwned|legacyCheckpointPath|loadLegacyRecord|NativeCheckpointV4|LEGACY_V4|LEGACY_V3|fallbackToBasicCompaction/)
  }
})

test('missing, incomplete, malformed, and non-GPT DSH routes fail closed despite old config', async () => {
  const old = { ...selected, ...profile, headers: { 'x-old-owner': 'lcx' } }
  for (const candidate of [undefined, null, {}, { ...profile, api: 'anthropic-messages' }, { ...profile, apiKeyEnv: '' }, { ...profile, baseURL: '' }]) {
    const h = harness({ profiles: { fixture: candidate }, config: old })
    assert.equal(resolveResponsesRouteConfig(h.ctx, selected, old), undefined)
    const chunks = await collect(h.handlers.get('llm/stream')({ ...selected, messages: [user('hello')] }, () => { throw new Error('native path must not run') }))
    assert.equal(chunks.at(-1).reason.failure.code, 'NO_ADAPTER')
    assert.equal(h.webProvider.available(), false)
    await assert.rejects(h.webProvider.search({ query: 'hello' }), { code: 'LCX_WEB_ROUTE_UNAVAILABLE' })
  }
  const h = harness()
  for (const route of [{}, { provider: 'fixture' }, { model: 'gpt-fixture' }, { ...selected, model: 'claude-fixture' }]) {
    assert.equal(resolveResponsesRouteConfig(h.ctx, route, old), undefined)
  }
})

test('LCX OFF delegates the original stream without inspecting unsupported old history', () => {
  const h = harness({ enabled: false })
  const native = { native: true }
  assert.equal(h.handlers.get('llm/stream')({ messages: [user('[dsh-lcx-codex-v3-checkpoint:synthetic]')] }, () => native), native)
})

test('Hosted provider availability is bound to the current DSH tool execution route', async () => {
  const h = harness()
  const execute = h.handlers.get('tools/execute')
  assert.equal(h.webProvider.available(), false)
  await execute({ name: 'web_search', agent: { options: selected } }, async () => {
    assert.equal(h.webProvider.available(), true)
    await Promise.resolve()
    assert.equal(h.webProvider.available(), true)
  })
  assert.equal(h.webProvider.available(), false)
  await execute({ name: 'web_search', agent: { options: { ...selected, model: 'claude-fixture' } } }, async () => {
    assert.equal(h.webProvider.available(), false)
    await assert.rejects(h.webProvider.search({ query: 'hello' }), { code: 'LCX_WEB_ROUTE_UNAVAILABLE' })
  })
})

test('old marker-only checkpoints are rejected before network access', async () => {
  const h = harness()
  const oldFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('network must not run') }
  try {
    const message = user('[dsh-lcx-codex-v3-checkpoint:11111111-1111-1111-1111-111111111111]')
    assert.throws(() => assertSupportedCheckpointMessage(message), { code: 'LCX_CHECKPOINT_UNSUPPORTED' })
    const chunks = await collect(h.handlers.get('llm/stream')({ ...selected, messages: [message] }, () => { throw new Error('native must not run') }))
    assert.equal(chunks.at(-1).reason.failure.code, 'INVALID_REQUEST')
    assert.match(chunks.at(-1).reason.failure.message, /checkpoint.*new session/i)
  } finally { globalThis.fetch = oldFetch }
})

test('unsupported checkpoint versions cannot fall through to portable or Basic summaries', () => {
  const message = { role: 'user', source: compactCheckpointSource('checkpoint'), content: [{ type: 'text', text: 'checkpoint' }] }
  const route = { ...selected, baseURL: profile.baseURL }
  for (const version of [3, 4, 6]) {
    const block = { type: `lcx-native-compaction-v${version}`, version, compactionId: 'checkpoint', provider: selected.provider, model: selected.model, baseURLFingerprint: baseURLFingerprint(profile.baseURL), sourceSessionId: selected.sessionId, nativeOutput: [{ type: 'compaction', encrypted_content: 'synthetic' }] }
    const event = { type: 'compaction/summary', data: { compactionId: 'checkpoint', rawOutput: [block] } }
    assert.equal(stateFromSummaryEvent(event), undefined)
    assert.equal(routeCompatible(block, route), false)
    assert.throws(() => checkpointStateForMessage({ snapshotEvents: () => [event] }, message), { code: 'LCX_CHECKPOINT_UNSUPPORTED' })
  }
})

test('current v5 checkpoint survives reconstruction and Basic summaries remain valid', () => {
  const block = { type: 'lcx-native-compaction-v5', version: 5, compactionId: 'checkpoint', provider: selected.provider, model: selected.model, baseURLFingerprint: baseURLFingerprint(profile.baseURL), sourceSessionId: selected.sessionId, nativeOutput: [{ type: 'compaction', encrypted_content: 'synthetic' }], retainedInputCount: 0 }
  const event = { type: 'compaction/summary', data: { compactionId: 'checkpoint', rawOutput: [block] } }
  const message = { ...user('checkpoint'), source: compactCheckpointSource('checkpoint') }
  const restored = JSON.parse(JSON.stringify(event))
  assert.equal(checkpointStateForMessage({ snapshotEvents: () => [restored] }, message).version, 5)
  assert.equal(checkpointStateForMessage({ snapshotEvents: () => [{ ...event, data: { ...event.data, rawOutput: [{ type: 'text', text: 'Basic summary' }] } }] }, message), undefined)
})

test('current first-checkpoint retryable failure still invokes Basic fallback even with obsolete false setting', async () => {
  const session = Session.create(SessionId(selected.sessionId))
  const h = harness({ session, config: { maxAttempts: 1 }, settings: { fallbackToBasicCompaction: false } })
  const oldFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('unavailable', { status: 503 })
  let fallbacks = 0
  try {
    const chunks = await collect(h.handlers.get('llm/stream')({ ...selected, purpose: 'compaction', messages: [user('hello')] }, async function* () { fallbacks++; yield { type: 'finish', reason: { kind: 'stop' } } }))
    assert.equal(fallbacks, 1)
    assert.equal(chunks.at(-1).reason.kind, 'stop')
  } finally { globalThis.fetch = oldFetch }
})

test('DSH explicit cache opt-out overrides plugin capability and image policy resolves from DSH', () => {
  const configured = { ...profile, maxRequestImageBytes: 7, requestImagePixelBudget: 8, requestImageMaxBytes: 9, compat: { supportsExplicitPromptCacheMode: false } }
  const ctx = { settings: { get: () => ({ providers: { lcx: configured } }) } }
  const route = resolveResponsesRouteConfig(ctx, { provider: 'lcx', model: 'gpt-5.6-sol' }, { supportsExplicitPromptCacheMode: true, maxRequestImageBytes: 100 })
  assert.equal(route.responsesCompat.supportsExplicitPromptCacheMode, false)
  assert.equal(route.maxRequestImageBytes, 7)
  assert.equal(route.requestImagePixelBudget, 8)
  assert.equal(route.requestImageMaxBytes, 9)
})

test('obsolete instructions input is not forwarded as a second system-prompt channel', () => {
  const body = buildResponsesBody({ model: 'gpt-fixture', input: [], instructions: 'old prompt' })
  assert.equal(Object.hasOwn(body, 'instructions'), false)
})

test('DSH image budgets reach actual managed ordinary serialization instead of LCX defaults', async () => {
  const h = harness({ profiles: { fixture: { ...profile, requestImagePixelBudget: 123, requestImageMaxBytes: 456 } } })
  const oldFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => { requests++; return new Response('fixture ends request', { status: 400 }) }
  try {
    const message = { ...user('image'), content: [{ type: 'image', attachment: { attachmentId: 'sha256:fixture', bytes: 3, mediaType: 'image/png', width: 1, height: 1 } }] }
    await collect(h.handlers.get('llm/stream')({ ...selected, messages: [message] }, () => { throw new Error('native must not run') }))
    assert.equal(requests, 1)
    assert.deepEqual(h.imageOptions, [{ maxPixels: 123, maxBytes: 456 }])
  } finally { globalThis.fetch = oldFetch }
})

test('current non-retryable Native failure does not invoke Basic fallback', async () => {
  const session = Session.create(SessionId(selected.sessionId))
  const h = harness({ session, config: { maxAttempts: 1 } })
  const oldFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('unauthorized', { status: 401 })
  try {
    await assert.rejects(collect(h.handlers.get('llm/stream')({ ...selected, purpose: 'compaction', messages: [user('hello')] }, () => { throw new Error('Basic must not run') })), { code: 'LCX_HTTP_ERROR' })
  } finally { globalThis.fetch = oldFetch }
})
