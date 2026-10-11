import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import Registry from '@deepseek-ai/dsh-session-projection'
import * as LlmRetry from '@deepseek-ai/dsh-llm-retry'
import { streamResponsesRequest } from '../lib/responses-stream.js'
import { collect, sseResponse } from './issue119-source.mjs'

// Issue 121 (backport of Issue 119 item 9): the in-stream failure classification only helps if the
// installed DSH retries the class LCX now emits. This pins that contract against the real DSH
// 0.2.0-rc.2 `dsh-llm` retry policy and the real `dsh-llm-retry` recovery listener, fed with the
// failure that LCX's real stream produces for an in-stream `server_error`.

const piModel = {
  id: 'gpt-5.6-sol', name: 'x', api: 'openai-responses', provider: 'lcx', baseUrl: 'https://f.invalid/v1',
  reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 262144, maxTokens: 32768, compat: {},
}
const head = [
  { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } },
  { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1', role: 'assistant', status: 'in_progress', content: [] } },
  { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_1', delta: 'partial' },
]

async function failureFor(errorEvent) {
  const previous = globalThis.fetch
  globalThis.fetch = async () => sseResponse([...head, errorEvent])
  try {
    const chunks = await collect(streamResponsesRequest({
      baseURL: 'https://f.invalid/v1', provider: 'lcx', model: 'gpt-5.6-sol', piModel,
      body: { model: 'x', input: [], stream: true }, headers: {}, signal: AbortSignal.timeout(8000), timeoutMs: 8000,
    }))
    const finish = chunks.find((chunk) => chunk.type === 'finish')
    assert.equal(finish.reason.kind, 'error')
    return finish.reason.failure
  } finally {
    globalThis.fetch = previous
  }
}

test('DSH 0.2.0-rc.2 default retry policy retries the class LCX emits for transient in-stream failures', () => {
  const policy = resolveRetryPolicy(undefined, 'provider.lcx')
  assert.equal(policy.mode, 'normal')
  for (const code of ['SERVER', 'RATE_LIMIT', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE']) assert.ok(policy.retryableCodes.includes(code), code)
  for (const code of ['RESPONSES_ERROR', 'INSUFFICIENT_QUOTA', 'INVALID_REQUEST', 'CONTEXT_WINDOW_EXCEEDED']) assert.ok(!policy.retryableCodes.includes(code), code)
})

test('real dsh-llm-retry retries an in-stream server_error after text had streamed, and ends the turn for the rest', async (t) => {
  const ctx = new Context()
  const fibers = []
  for (const [plugin, config] of [[SessionStore], [Registry]]) fibers.push(await ctx.plugin(plugin, config))
  // The retry listener only reads `agents` as an injection gate; the recovery path never touches it.
  ctx.provide('agents')
  ctx.set('agents', {})
  fibers.push(await ctx.plugin(LlmRetry))
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  const session = ctx.sessions.create()
  const retryPolicy = resolveRetryPolicy({ mode: 'normal', backoff: { initialDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 } }, 'provider.lcx')
  const decide = (failure) => ctx.waterfall('agent/request-error', {
    agent: { session }, turn: 1, step: 1, provider: 'lcx', failure, retryPolicy, signal: new AbortController().signal,
  }, () => Promise.resolve(undefined))

  const serverFailure = await failureFor({ type: 'response.failed', response: { id: 'resp_1', status: 'failed', error: { code: 'server_error', message: 'boom' }, output: [] } })
  assert.equal(serverFailure.code, 'SERVER')
  assert.deepEqual(await decide(serverFailure), { kind: 'retry' })

  // TL review follow-up: an error object without a usable code is a provider-side failure, so it is retried too.
  const codeless = await failureFor({ type: 'response.failed', response: { id: 'resp_1', status: 'failed', error: { message: 'boom' }, output: [] } })
  assert.equal(codeless.code, 'SERVER')
  assert.deepEqual(await decide(codeless), { kind: 'retry' })

  const quota = await failureFor({ type: 'response.failed', response: { id: 'resp_1', status: 'failed', error: { code: 'insufficient_quota', message: 'boom' }, output: [] } })
  assert.equal(quota.code, 'INSUFFICIENT_QUOTA')
  assert.equal(await decide(quota), undefined)

  const unknown = await failureFor({ type: 'response.failed', response: { id: 'resp_1', status: 'failed', error: { code: 'weird_vendor_code', message: 'boom' }, output: [] } })
  assert.equal(unknown.code, 'RESPONSES_ERROR')
  assert.equal(await decide(unknown), undefined)
})
