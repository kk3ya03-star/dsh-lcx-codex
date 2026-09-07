import test from 'node:test'
import assert from 'node:assert/strict'
import { stream as streamOpenAIResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { buildResponsesBody, buildCompactionResponsesBody } from '../lib/responses-request.js'
import { buildNativeCompactionBody, parseNativeCompactionSse } from '../lib/compact-v2.js'

test('Pi public stream accepts a V2 payload hook but does not expose opaque compaction output', async () => {
  const model = {
    id: 'gpt-fixture', name: 'fixture', provider: 'openai', api: 'openai-responses',
    baseUrl: 'https://example.invalid/v1', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 32768,
  }
  const item = { id: 'cmp_fixture', type: 'compaction', encrypted_content: 'SYNTHETIC_OPAQUE_STATE' }
  const events = [
    { type: 'response.created', response: { id: 'resp_fixture' } },
    { type: 'response.output_item.added', output_index: 0, item },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', output: [item] } },
  ]
  const makeResponse = () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } })
  let request
  const stream = streamOpenAIResponses(model, { messages: [] }, {
    apiKey: 'synthetic-test-key', maxRetries: 0,
    onPayload: body => ({ ...body, input: [{ type: 'compaction_trigger' }] }),
    fetch: async (_url, init) => { request = JSON.parse(init.body); return makeResponse() },
  })
  const result = await stream.result()
  assert.deepEqual(request.input, [{ type: 'compaction_trigger' }])
  assert.equal(result.stopReason, 'stop')
  assert.deepEqual(result.content, [])
  assert.equal(JSON.stringify(result).includes(item.encrypted_content), false)
  const native = await parseNativeCompactionSse(makeResponse())
  assert.deepEqual(native.compaction, item)
})

test('ordinary, Compact and Replay cache/output-token fields match the actual Pi 0.85.1 payload', async () => {
  for (const explicit of [true, false]) for (const supportsLong of [true, false]) for (const retention of ['long', 'short', 'none']) {
    const model = {
      id: 'gpt-5.6-sol', name: 'fixture', provider: 'openai', api: 'openai-responses',
      baseUrl: 'https://example.invalid/v1', reasoning: true, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 32768,
      compat: { supportsLongCacheRetention: supportsLong, supportsExplicitPromptCacheMode: explicit, supportsMaxOutputTokens: !explicit },
    }
    let expected
    const stream = streamOpenAIResponses(model, { messages: [] }, {
      apiKey: 'synthetic-test-key', sessionId: 'cache-fixture', cacheRetention: retention, maxTokens: 64,
      onPayload(payload) { expected = payload; throw new Error('fixture stops before network') },
      fetch() { throw new Error('network must not run') },
    })
    for await (const _ of stream) { /* Drain the intentionally stopped provider stream. */ }
    assert.ok(expected, 'Pi must build its real request payload')
    const options = { model, input: [], sessionId: 'cache-fixture', cacheRetention: retention, maxTokens: 64 }
    const replay = [{ type: 'compaction', encrypted_content: 'synthetic' }]
    const fields = ['prompt_cache_key', 'prompt_cache_retention', 'prompt_cache_options', 'max_output_tokens']
    for (const body of [
      buildResponsesBody(options),
      buildResponsesBody({ ...options, input: replay }),
      buildCompactionResponsesBody(options),
      buildNativeCompactionBody({ ...options, model: model.id, modelDescriptor: model, promptCacheKey: retention === 'none' ? undefined : 'cache-fixture' }),
    ]) {
      for (const field of fields) assert.deepEqual(body[field], expected[field], `${field}: explicit=${explicit}, supportsLong=${supportsLong}, retention=${retention}`)
    }
  }
})

test('an old 24h override cannot reintroduce conflicting fields on explicit-mode routes', () => {
  for (const retention of ['long', 'short', 'none']) {
    const body = buildResponsesBody({
      model: { id: 'gpt-5.6-sol', provider: 'openai', compat: { supportsLongCacheRetention: true, supportsExplicitPromptCacheMode: true } },
      input: [], promptCacheRetention: '24h', cacheRetention: retention,
    })
    assert.equal(body.prompt_cache_retention, undefined)
    assert.deepEqual(body.prompt_cache_options, retention === 'long' ? { ttl: '30m' } : retention === 'none' ? { mode: 'explicit' } : undefined)
  }
})
