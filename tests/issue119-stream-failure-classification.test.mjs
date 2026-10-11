import test from 'node:test'
import assert from 'node:assert/strict'
import { streamResponsesRequest } from '../lib/responses-stream.js'
import { collect, sseResponse } from './issue119-source.mjs'
import { grokHarness, user, xaiProfile } from './grok-fixture.mjs'

// Issue 119 item 9: a failure that arrives inside a 200 SSE stream (`response.failed`, `error`,
// `response.incomplete`, or a `response.completed` carrying status failed) must be classified from
// its structured `error.code` / `error.type`, not left as the generic RESPONSES_ERROR that DSH never
// retries. Retryable DSH codes are EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT and TRANSPORT.

const piModel = {
  id: 'gpt-5.6-sol', name: 'x', api: 'openai-responses', provider: 'lcx', baseUrl: 'https://f.invalid/v1',
  reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 262144, maxTokens: 32768, compat: {},
}
const SECRET = 'SECRET-PROVIDER-BODY'
const usage = { input_tokens: 100, output_tokens: 68, total_tokens: 168, input_tokens_details: { cached_tokens: 0 } }
const head = [
  { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } },
  { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1', role: 'assistant', status: 'in_progress', content: [] } },
  { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_1', delta: 'partial answer text' },
]
const failed = (error) => ({ type: 'response.failed', response: { id: 'resp_1', status: 'failed', ...(error === undefined ? {} : { error }), usage, output: [] } })
const errorEvent = (code, extra = {}) => ({ type: 'error', code, message: SECRET, param: null, ...extra })
const incomplete = (reason) => ({ type: 'response.incomplete', response: { id: 'resp_1', status: 'incomplete', ...(reason === undefined ? {} : { incomplete_details: { reason } }), usage, output: [] } })
const completedFailed = (error) => ({ type: 'response.completed', response: { id: 'resp_1', status: 'failed', ...(error === undefined ? {} : { error }), usage, output: [] } })

async function run(events, { prefix = head, onFailure } = {}) {
  const previous = globalThis.fetch
  globalThis.fetch = async () => sseResponse([...prefix, ...events])
  try {
    return await collect(streamResponsesRequest({
      baseURL: 'https://f.invalid/v1', provider: 'lcx', model: 'gpt-5.6-sol', piModel,
      body: { model: 'x', input: [], stream: true }, headers: {}, signal: AbortSignal.timeout(8000), timeoutMs: 8000, onFailure,
    }))
  } finally {
    globalThis.fetch = previous
  }
}
const finishOf = (chunks) => chunks.find((chunk) => chunk.type === 'finish')

const CASES = [
  // server-side, retryable
  ['failed server_error', failed({ code: 'server_error', message: SECRET }), 'SERVER'],
  ['failed internal_error', failed({ code: 'internal_error', message: SECRET }), 'SERVER'],
  ['failed server_is_overloaded', failed({ code: 'server_is_overloaded', message: SECRET }), 'SERVER'],
  ['failed overloaded_error type only', failed({ type: 'overloaded_error', message: SECRET }), 'SERVER'],
  ['failed overloaded code', failed({ code: 'overloaded', message: SECRET }), 'SERVER'],
  ['failed service_unavailable', failed({ code: 'service_unavailable', message: SECRET }), 'SERVER'],
  ['failed bad_response_status_code', failed({ code: 'bad_response_status_code', message: SECRET }), 'SERVER'],
  ['failed type server_error', failed({ type: 'server_error', message: SECRET }), 'SERVER'],
  ['failed without an error object', failed(undefined), 'SERVER'],
  ['error event server_error', errorEvent('server_error'), 'SERVER'],
  ['error event type only', errorEvent('some_gateway_code', { error: { type: 'server_error' } }), 'SERVER'],
  ['structured code outranks timeout wording', failed({ code: 'server_error', message: 'upstream request timeout' }), 'SERVER'],
  ['completed with status failed server_error', completedFailed({ code: 'server_error', message: SECRET }), 'SERVER'],
  ['completed with status failed, no error object', completedFailed(undefined), 'SERVER'],
  // rate limit / quota
  ['failed rate_limit_exceeded', failed({ code: 'rate_limit_exceeded', message: SECRET }), 'RATE_LIMIT'],
  ['error event rate_limit_exceeded', errorEvent('rate_limit_exceeded'), 'RATE_LIMIT'],
  ['completed with status failed rate limit', completedFailed({ code: 'rate_limit_exceeded', message: SECRET }), 'RATE_LIMIT'],
  ['failed insufficient_quota', failed({ code: 'insufficient_quota', message: SECRET }), 'INSUFFICIENT_QUOTA'],
  ['error event insufficient_quota', errorEvent('insufficient_quota'), 'INSUFFICIENT_QUOTA'],
  // not retryable
  ['failed context_length_exceeded', failed({ code: 'context_length_exceeded', message: SECRET }), 'CONTEXT_WINDOW_EXCEEDED'],
  ['failed invalid_prompt', failed({ code: 'invalid_prompt', message: SECRET }), 'INVALID_REQUEST'],
  ['failed content_filter', failed({ code: 'content_filter', message: SECRET }), 'INVALID_REQUEST'],
  ['error event invalid_request_error type', errorEvent('bad_param', { error: { type: 'invalid_request_error' } }), 'INVALID_REQUEST'],
  ['incomplete content_filter', incomplete('content_filter'), 'INVALID_REQUEST'],
  // preserved behaviour
  ['unknown code keeps the generic fallback', failed({ code: 'weird_vendor_code', message: SECRET }), 'RESPONSES_ERROR'],
  ['unknown code with timeout wording keeps TIMEOUT', failed({ code: 'upstream_error', message: 'upstream request timeout' }), 'TIMEOUT'],
  ['incomplete without a reason keeps the generic fallback', incomplete(undefined), 'RESPONSES_ERROR'],
]

for (const [label, terminal, expected] of CASES) {
  test(`in-stream failure classification: ${label} -> ${expected}`, async () => {
    const chunks = await run([terminal])
    const finish = finishOf(chunks)
    assert.equal(finish.reason.kind, 'error')
    assert.equal(finish.reason.failure.code, expected)
    assert.ok(!JSON.stringify(chunks).includes(SECRET), 'the provider message body must never leave the wire boundary')
  })
}

test('truncated streams and max_output_tokens keep their existing handling', async () => {
  const eof = finishOf(await run([]))
  assert.equal(eof.reason.failure.code, 'TRANSPORT')
  const max = finishOf(await run([incomplete('max_output_tokens')]))
  assert.equal(max.reason.kind, 'max-tokens')
})

test('structured failure facts reach the diagnostics callback without the message body', async () => {
  const seen = []
  const chunks = await run([failed({ code: 'server_is_overloaded', type: 'overloaded_error', message: SECRET })], { onFailure: (info) => seen.push(info) })
  assert.equal(finishOf(chunks).reason.failure.code, 'SERVER')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].code, 'SERVER')
  assert.equal(seen[0].providerCode, 'server_is_overloaded')
  assert.equal(seen[0].providerType, 'overloaded_error')
  assert.equal(seen[0].event, 'response.failed')
  assert.equal(seen[0].contentEmitted, true)
  assert.ok(!JSON.stringify(seen).includes(SECRET))

  const early = []
  await run([failed({ code: 'server_error', message: SECRET })], { prefix: [head[0]], onFailure: (info) => early.push(info) })
  assert.equal(early[0].contentEmitted, false)

  const reason = []
  await run([incomplete('content_filter')], { onFailure: (info) => reason.push(info) })
  assert.equal(reason[0].incompleteReason, 'content_filter')
  assert.equal(reason[0].event, 'response.incomplete')
})

test('HTTP-status failures keep status and request id in the diagnostics callback', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: SECRET } }), { status: 503, headers: { 'content-type': 'application/json', 'x-request-id': 'req_abc123' } })
  const seen = []
  try {
    const chunks = await collect(streamResponsesRequest({
      baseURL: 'https://f.invalid/v1', provider: 'lcx', model: 'gpt-5.6-sol', piModel,
      body: { model: 'x', input: [], stream: true }, headers: {}, signal: AbortSignal.timeout(8000), timeoutMs: 8000, maxAttempts: 1,
      onFailure: (info) => seen.push(info),
    }))
    assert.equal(finishOf(chunks).reason.failure.code, 'SERVER')
  } finally {
    globalThis.fetch = previous
  }
  assert.equal(seen.length, 1)
  assert.equal(seen[0].status, 503)
  assert.equal(seen[0].contentEmitted, false)
  assert.ok(!JSON.stringify(seen).includes(SECRET))
})

test('aborted requests are not reported as failures', async () => {
  const previous = globalThis.fetch
  const controller = new AbortController()
  globalThis.fetch = async () => { controller.abort(new Error('user cancel')); throw new Error('aborted') }
  const seen = []
  try {
    await collect(streamResponsesRequest({
      baseURL: 'https://f.invalid/v1', provider: 'lcx', model: 'gpt-5.6-sol', piModel,
      body: { model: 'x', input: [], stream: true }, headers: {}, signal: controller.signal, maxAttempts: 1,
      onFailure: (info) => seen.push(info),
    }))
  } finally {
    globalThis.fetch = previous
  }
  assert.deepEqual(seen, [])
})

test('the Grok native stream logs one redacted line with the classified failure', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => sseResponse([
    ...head,
    failed({ code: 'server_error', type: 'server_error', message: SECRET }),
  ]))
  const h = grokHarness({ nativeWeb: true })
  const chunks = await collect(h.stream({
    provider: 'xai', model: 'grok-4.6', sessionId: 'session-119', messages: [user('hello')], tools: [],
  }, () => { throw new Error('Unexpected adapter') }))
  assert.equal(finishOf(chunks).reason.failure.code, 'SERVER')
  const lines = h.warnLogs.filter((line) => line.includes('responses stream failed'))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /route=grok-native/u)
  assert.match(lines[0], /code=SERVER/u)
  assert.match(lines[0], /providerCode=server_error/u)
  assert.match(lines[0], /providerType=server_error/u)
  assert.match(lines[0], /emitted=true/u)
  assert.ok(!lines[0].includes(SECRET))
  assert.ok(!lines[0].toLowerCase().includes('synthetic-test-key'))
})
