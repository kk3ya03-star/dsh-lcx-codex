import test from 'node:test'
import assert from 'node:assert/strict'
import apply from '../lib/index.js'
import { serializeDshMessages } from '../lib/dsh-responses.js'
import { portableMessagesForCheckpoint } from '../lib/native-checkpoint.js'
import { managedFailureChunk } from '../lib/responses-stream.js'

const profile = { api: 'openai-responses', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'FIXTURE_KEY' }

// --- P0 image offload: the budget is measured once, not twice -----------------

// `requiredImageOffload` expands base64 itself for a base64 representation, so the
// LCX version-byte callback must report RAW bytes. Reporting expanded bytes made the
// effective budget 3/4 of the configured bound and offloaded images that still fit.
function imageCtx(requestBytes) {
  let readImageRequestCalls = 0
  const ref = { attachmentId: 'sha256:budget', mediaType: 'image/png', bytes: requestBytes, width: 8, height: 8 }
  return {
    ref,
    readImageRequestCalls: () => readImageRequestCalls,
    ctx: {
      attachments: {
        imageHostPath() { return 'F:/dsh/attachments/budget.png' },
        async readImageRequest(input) {
          readImageRequestCalls += 1
          return {
            variantId: 'variant:budget', attachment: input,
            data: new Uint8Array(requestBytes), mediaType: 'image/png',
            bytes: requestBytes, width: 8, height: 8, depth: 'uchar', space: 'srgb', hasAlpha: false,
          }
        },
      },
      fs: { processPathFromHostPath() { return '/sandbox/attachments/budget.png' } },
      get(name) { return this[name] },
    },
  }
}

const budgetOptions = maxRequestImageBytes => ({
  imageSupport: 'supported', requestImagePixelBudget: 123456, requestImageMaxBytes: 654321, maxRequestImageBytes,
})

test('request-image budget expands base64 exactly once at the offload boundary', async () => {
  // 3 raw bytes -> base64 length 4. A single expansion fits a 4-byte bound;
  // a second expansion would measure 8 and offload a request that fits.
  const { ref, ctx } = imageCtx(3)
  const message = { role: 'user', content: [{ type: 'image', attachment: ref }] }

  const fits = await serializeDshMessages([message], ctx, budgetOptions(4))
  assert.equal(
    JSON.stringify(fits.input).includes('image omitted to fit request image limits'),
    false,
    'an image whose base64 length equals the bound must not be offloaded',
  )
  assert.equal(fits.imageMap.size, 1)

  await assert.rejects(
    serializeDshMessages([message], ctx, budgetOptions(3)),
    { code: 'IMAGE_OFFLOAD_REQUIRED' },
    'one byte below the base64 length must still require offload',
  )
})

// Raising IMAGE_OFFLOAD_REQUIRED is only half the contract: DSH's image-offload
// owner matches on the exact code AND `offloadImages`. LCX's failure normalizer
// owns a closed taxonomy that has neither, so without an explicit passthrough the
// host never records the durable decision and the whole turn fails instead.
test('image-offload failures reach DSH intact instead of collapsing into the LCX taxonomy', () => {
  const error = Object.assign(new Error('LCX request images exceed the configured base64 bound'), {
    code: 'IMAGE_OFFLOAD_REQUIRED',
    failure: { message: 'LCX request images exceed the configured base64 bound', code: 'IMAGE_OFFLOAD_REQUIRED', offloadImages: 2 },
  })
  const chunk = managedFailureChunk(error, undefined)
  assert.equal(chunk.type, 'finish')
  assert.equal(chunk.reason.kind, 'error')
  assert.equal(chunk.reason.failure.code, 'IMAGE_OFFLOAD_REQUIRED')
  assert.equal(chunk.reason.failure.offloadImages, 2)
  assert.notEqual(chunk.reason.failure.code, 'RESPONSES_ERROR')
})

test('only a well-formed offload contract bypasses failure normalization', () => {
  for (const bad of [
    Object.assign(new Error('x'), { code: 'IMAGE_OFFLOAD_REQUIRED' }),
    Object.assign(new Error('x'), { code: 'IMAGE_OFFLOAD_REQUIRED', offloadImages: 0 }),
    Object.assign(new Error('x'), { code: 'IMAGE_OFFLOAD_REQUIRED', offloadImages: -1 }),
    Object.assign(new Error('x'), { code: 'IMAGE_OFFLOAD_REQUIRED', offloadImages: 1.5 }),
    Object.assign(new Error('x'), { code: 'LCX_COMPACT_IMAGE_TOO_LARGE', offloadImages: 2 }),
  ]) {
    const chunk = managedFailureChunk(bad, undefined)
    assert.notEqual(chunk.reason.failure.code, 'IMAGE_OFFLOAD_REQUIRED', `must not forge a contract from ${JSON.stringify({ code: bad.code, offloadImages: bad.offloadImages })}`)
  }
})

test('offload requirement reports the count DSH needs to record a durable decision', async () => {
  const { ref, ctx } = imageCtx(3)
  const message = { role: 'user', content: [{ type: 'image', attachment: ref }, { type: 'image', attachment: ref }] }
  await assert.rejects(
    serializeDshMessages([message], ctx, budgetOptions(4)),
    error => {
      assert.equal(error.code, 'IMAGE_OFFLOAD_REQUIRED')
      assert.equal(error.failure?.code, 'IMAGE_OFFLOAD_REQUIRED')
      assert.equal(Number.isSafeInteger(error.failure?.offloadImages), true)
      assert.equal(error.failure.offloadImages > 0, true)
      return true
    },
  )
})

// --- P0/P1 missing message projection normalization --------------------------

const shadowedSummary = { type: 'compaction/summary', data: { compactionId: 'offloaded', shadowedSeqs: [0] } }

test('portable expansion normalizes a missing message projection and fails closed', () => {
  const cause = new Error('session message projection "image/offload" was removed or replaced; restore the session with its owning plugin')
  const session = {
    snapshotEvents: () => [shadowedSummary],
    eventAt: () => ({ type: 'user/message' }),
    deriveEventMessage() {
      // Exact DSH 0.1.6 SurfaceManager._assertProjections wording.
      throw cause
    },
  }
  assert.throws(
    () => portableMessagesForCheckpoint(session, 'offloaded'),
    error => {
      assert.equal(error.code, 'LCX_CHECKPOINT_PROJECTION_UNAVAILABLE')
      assert.equal(error.code === 'LCX_CHECKPOINT_UNSUPPORTED', false, 'must not be confused with an unreadable checkpoint format')
      assert.equal(error.cause, cause, 'the original projection error is retained for diagnostics')
      assert.equal(/image projection|projection/i.test(error.message), true)
      return true
    },
  )
})

test('portable expansion keeps unrelated read failures in the generic checkpoint class', () => {
  const cause = new Error('projection evaluation failed')
  const session = {
    snapshotEvents: () => [shadowedSummary],
    eventAt: () => ({ type: 'user/message' }),
    deriveEventMessage() {
      throw cause
    },
  }
  assert.throws(
    () => portableMessagesForCheckpoint(session, 'offloaded'),
    error => {
      assert.equal(error.code, 'LCX_CHECKPOINT_UNSUPPORTED')
      assert.equal(error.cause, cause, 'the original history error is retained for diagnostics')
      return true
    },
  )
})

test('portable expansion returns projected content while the projection owner is present', () => {
  const projected = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '[image offloaded]' }] }
  const session = {
    snapshotEvents: () => [shadowedSummary],
    eventAt: () => ({ type: 'user/message' }),
    deriveEventMessage: () => projected,
  }
  const messages = portableMessagesForCheckpoint(session, 'offloaded')
  assert.equal(messages.length, 1)
  assert.equal(messages[0].content[0].text, '[image offloaded]')
})

// --- P1 Agent lifecycle containment ------------------------------------------

function lifecycleHarness() {
  const handlers = new Map()
  const warnings = []
  const ctx = {
    logger: { info() {}, warn(message) { warnings.push(String(message)) } },
    sessions: { get: () => undefined },
    credentials: { resolve: async () => ({ value: 'synthetic-test-key' }) },
    llm: { resolveModelInfo: async () => ({ input: ['text'] }), fileRequestText: () => '' },
    attachments: { imageHostPath() { return '' }, async readImageRequest() { throw new Error('unused') } },
    web: { searchProviderId: 'native', registerSearchProvider() { throw new Error('global provider registration is forbidden') } },
    tools: { register: () => () => {} },
    settings: {
      get: () => ({ providers: { fixture: profile } }),
      installSection(_owner, _namespace, _schema, value, hooks) {
        hooks.setSource(() => ({ ...value, enabled: true, webSearch: true }))
        hooks.onChange()
      },
    },
    on(event, handler) { handlers.set(event, handler) },
    inject(names, callback) { if (names.every(name => ctx[name])) callback(ctx) },
    get(name) { return ctx[name] },
    effect() {},
  }
  apply(ctx, {})
  return { handlers, warnings }
}

// DSH 0.1.6 awaits `agent/created` serially, so an escaping failure makes an
// otherwise valid Agent uncreatable. LCX instrumentation is optional capability
// and must fail closed locally instead.
const hostileAgent = () => ({
  options: { provider: 'fixture', model: 'gpt-fixture' },
  get session() { throw new Error('synthetic instrumentation failure') },
  ctx: { get() { throw new Error('synthetic instrumentation failure') } },
})

test('agent/created contains LCX instrumentation failure instead of vetoing creation', () => {
  const { handlers, warnings } = lifecycleHarness()
  const created = handlers.get('agent/created')
  assert.equal(typeof created, 'function')
  assert.doesNotThrow(() => created({ agent: hostileAgent(), source: 'startup' }))
  assert.equal(warnings.some(line => line.includes('agent instrumentation skipped')), true)
})

test('agent/created records the lifecycle source without branching on it', () => {
  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    const { handlers, warnings } = lifecycleHarness()
    handlers.get('agent/created')({ agent: hostileAgent(), source })
    const line = warnings.find(entry => entry.includes('agent instrumentation skipped'))
    assert.equal(typeof line, 'string')
    assert.equal(line.includes(`agent/created(${source})`), true, `source ${source} must be recorded`)
  }
})

test('agent/created tolerates an absent or unexpected lifecycle source', () => {
  const { handlers, warnings } = lifecycleHarness()
  assert.doesNotThrow(() => handlers.get('agent/created')({ agent: hostileAgent() }))
  assert.equal(warnings.some(line => line.includes('agent/created(unknown)')), true)
})

test('agent/status stays a contained emit path and is never fatal', () => {
  const { handlers, warnings } = lifecycleHarness()
  const status = handlers.get('agent/status')
  assert.equal(typeof status, 'function')
  assert.doesNotThrow(() => status({ agent: hostileAgent(), status: 'running' }))
  assert.equal(warnings.some(line => line.includes('agent/status(running)')), true)
  // A non-running status must not instrument at all.
  const before = warnings.length
  assert.doesNotThrow(() => status({ agent: hostileAgent(), status: 'idle' }))
  assert.equal(warnings.length, before)
})
