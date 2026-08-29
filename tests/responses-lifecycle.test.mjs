import test from 'node:test'
import assert from 'node:assert/strict'

import { serializeDshMessages } from '../lib/dsh-responses.js'
import { buildCompactionResponsesBody, buildResponsesBody } from '../lib/responses-request.js'
import { managedFailure, streamResponsesRequest } from '../lib/responses-stream.js'

function model(overrides = {}) {
  return {
    id: 'gpt-5.6-sol',
    name: 'GPT 5.6 Sol',
    api: 'openai-responses',
    provider: 'lcx',
    baseUrl: 'https://example.invalid/v1',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 32768,
    thinkingLevelMap: { off: 'none', xhigh: 'xhigh' },
    compat: {},
    ...overrides,
  }
}

function sseResponse(events, status = 200) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}

async function collect(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

test('standard request builder selects current and legacy cache fields by route compatibility', () => {
  const legacy = buildResponsesBody({
    model: model({ compat: { supportsLongCacheRetention: true, supportsExplicitPromptCacheMode: true } }),
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
    sessionId: 's'.repeat(80),
    cacheRetention: 'long',
    reasoningEffort: 'xhigh',
    maxTokens: 8,
  })
  assert.equal(legacy.prompt_cache_key, 's'.repeat(64))
  assert.equal(legacy.prompt_cache_retention, '24h')
  assert.equal(legacy.prompt_cache_options, undefined, 'legacy 24h must not be mapped to 30m')
  assert.equal(legacy.max_output_tokens, 16)
  assert.deepEqual(legacy.reasoning, { effort: 'xhigh', summary: 'auto' })
  assert.deepEqual(legacy.include, ['reasoning.encrypted_content'])
  assert.equal(legacy.tool_choice, undefined)
  assert.equal(legacy.parallel_tool_calls, undefined)

  const current = buildResponsesBody({ model: model({ compat: { supportsExplicitPromptCacheMode: true } }), input: [], sessionId: 'session', cacheRetention: 'short' })
  assert.equal(current.prompt_cache_key, 'session')
  assert.equal(current.prompt_cache_retention, undefined)
  assert.deepEqual(current.prompt_cache_options, { ttl: '30m' }, 'omitting mode preserves implicit caching')

  const older = buildResponsesBody({ model: model(), input: [], sessionId: 'session', cacheRetention: 'short' })
  assert.equal(older.prompt_cache_key, 'session')
  assert.equal(older.prompt_cache_options, undefined)

  const disabled = buildResponsesBody({ model: model({ compat: { supportsExplicitPromptCacheMode: true } }), input: [], sessionId: 'session', cacheRetention: 'none' })
  assert.equal(disabled.prompt_cache_key, undefined)
  assert.deepEqual(disabled.prompt_cache_options, { mode: 'explicit' })

  const maximum = buildResponsesBody({ model: model(), input: [], reasoningEffort: 'max' })
  assert.deepEqual(maximum.reasoning, { effort: 'max', summary: 'auto' })
})

test('ordinary request serialization emits exactly one canonical developer prelude', async () => {
  const fingerprint = 'ordinary-canonical-prelude-fingerprint'
  const serialized = await serializeDshMessages([
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
  ], {}, {
    model: model(), systemPrompt: fingerprint, includeSystemPrompt: true,
  })
  assert.equal(serialized.input.filter((item) => item?.role === 'developer' && item?.content === fingerprint).length, 1)
})

test('Native Compact is the standard request plus one trigger and feature-specific tool controls', () => {
  const body = buildCompactionResponsesBody({ model: model(), input: [{ role: 'user', content: 'hello' }], cacheRetention: 'short', sessionId: 'session' })
  assert.equal(body.input.filter((item) => item.type === 'compaction_trigger').length, 1)
  assert.deepEqual(body.input.at(-1), { type: 'compaction_trigger' })
  assert.equal(body.tool_choice, 'auto')
  assert.equal(body.parallel_tool_calls, true)
  assert.throws(() => buildCompactionResponsesBody({ model: model(), input: [{ type: 'compaction_trigger' }] }), (error) => error?.code === 'LCX_COMPACT_DUPLICATE_TRIGGER')
})

test('Pi 0.84 additional_tools and tool-search definitions are preserved', async () => {
  const messages = [
    { role: 'assistant', content: [{ type: 'tool-call', id: 'call_load|fc_load', name: 'loader', arguments: '{}' }], source: { kind: 'model', provider: 'lcx', model: 'gpt-5.6-sol' } },
    { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call_load|fc_load', toolName: 'loader', content: [{ type: 'text', text: 'loaded' }], addedToolNames: ['late'] }] },
  ]
  const tools = [
    { name: 'loader', description: 'load', parameters: { type: 'object', properties: {} } },
    { name: 'late', description: 'late', parameters: { type: 'object', properties: {} } },
  ]
  const additional = await serializeDshMessages(messages, {}, { tools, model: model({ compat: { supportsAdditionalTools: true } }) })
  assert.equal(additional.deferredToolsMode, 'additional-tools')
  assert.deepEqual(additional.tools.map((tool) => tool.name), ['loader'])
  assert.equal(additional.input.some((item) => item.type === 'additional_tools' && item.tools?.some((tool) => tool.name === 'late')), true)

  const search = await serializeDshMessages(messages, {}, { tools, model: model({ compat: { supportsToolSearch: true } }) })
  assert.equal(search.deferredToolsMode, 'tool-search')
  assert.equal(search.input.some((item) => item.type === 'tool_search_call'), true)
  assert.equal(search.input.some((item) => item.type === 'tool_search_output' && item.tools?.some((tool) => tool.name === 'late')), true)
})

test('adapter-private replay metadata restores genuine tool namespace', async () => {
  const result = await serializeDshMessages([
    {
      role: 'assistant',
      content: [{ type: 'tool-call', id: 'call_1|fc_1', name: 'run', arguments: '{"value":1}' }],
      source: {
        kind: 'model', provider: 'lcx', model: 'gpt-5.6-sol',
        replayState: {
          response: { kind: 'pi-ai', version: 2, api: 'openai-responses', provider: 'lcx', model: 'gpt-5.6-sol', stopReason: 'toolUse' },
          blocks: [{ type: 'tool-call', namespace: 'functions' }],
        },
      },
    },
  ], {}, { model: model() })
  const call = result.input.find((item) => item.type === 'function_call')
  assert.equal(call.namespace, 'functions')
})

test('LCX wire ownership reuses Pi custom-tool parsing and persists namespace', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = async () => sseResponse([
    { type: 'response.created', response: { id: 'resp_1' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'custom_tool_call', id: 'ctc_1', call_id: 'call_1', name: 'shell', input: '', namespace: 'functions' } },
    { type: 'response.custom_tool_call_input.done', output_index: 0, item_id: 'ctc_1', input: 'echo hi' },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'custom_tool_call', id: 'ctc_1', call_id: 'call_1', name: 'shell', input: 'echo hi', namespace: 'functions' } },
    { type: 'response.completed', response: { id: 'resp_1', model: 'gpt-5.6-sol', status: 'completed', output: [{ type: 'custom_tool_call', id: 'ctc_1', call_id: 'call_1', name: 'shell', input: 'echo hi', namespace: 'functions' }], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } },
  ])
  try {
    const chunks = await collect(streamResponsesRequest({
      baseURL: 'https://example.invalid/v1', provider: 'lcx', model: 'gpt-5.6-sol', piModel: model({ compat: { supportsOpenAIGrammarTools: true } }),
      body: { model: 'gpt-5.6-sol', input: [], stream: true, store: false },
      grammarToolInputProperties: new Map([['shell', 'script']]), headers: { authorization: 'Bearer test' }, maxAttempts: 1,
    }))
    const block = chunks.find((chunk) => chunk.type === 'block-end')?.block
    assert.equal(block.type, 'tool-call')
    assert.equal(block.id, 'call_1|ctc_1')
    assert.equal(block.arguments, '{"script":"echo hi"}')
    const finish = chunks.find((chunk) => chunk.type === 'finish')
    assert.equal(finish.reason.kind, 'tool-calls')
    assert.equal(finish.replayState.blocks[0].namespace, 'functions')
  } finally {
    globalThis.fetch = previous
  }
})

test('ordinary Responses usage preserves disjoint cache reads, writes, output, and reasoning', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = async () => sseResponse([
    {
      type: 'response.completed',
      response: {
        id: 'resp_usage', model: 'gpt-5.6-sol', status: 'completed',
        output: [{ type: 'message', id: 'msg_usage', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
        usage: {
          input_tokens: 120,
          input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
          output_tokens: 7,
          output_tokens_details: { reasoning_tokens: 3 },
          total_tokens: 127,
        },
      },
    },
  ])
  try {
    const chunks = await collect(streamResponsesRequest({
      baseURL: 'https://example.invalid/v1', provider: 'lcx', model: 'gpt-5.6-sol', piModel: model(),
      body: { model: 'gpt-5.6-sol', input: [], stream: true, store: false }, headers: { authorization: 'Bearer test' }, maxAttempts: 1,
    }))
    assert.deepEqual(chunks.find((chunk) => chunk.type === 'usage')?.usage, {
      inputTokens: 90,
      outputTokens: 7,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
      reasoningTokens: 3,
    })
  } finally {
    globalThis.fetch = previous
  }
})

test('ordinary provider failures are emitted in DSH taxonomy instead of thrown middleware errors', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = async () => new Response('rate limited', { status: 429, headers: { 'content-type': 'text/plain', 'retry-after-ms': '12000' } })
  try {
    const chunks = await collect(streamResponsesRequest({
      baseURL: 'https://example.invalid/v1', provider: 'lcx', model: 'gpt-5.6-sol', piModel: model(),
      body: { model: 'gpt-5.6-sol', input: [], stream: true, store: false }, headers: { authorization: 'Bearer test' }, maxAttempts: 1,
    }))
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0].type, 'finish')
    assert.equal(chunks[0].reason.kind, 'error')
    assert.equal(chunks[0].reason.failure.code, 'RATE_LIMIT')
    assert.equal(chunks[0].reason.failure.status, 429)
    assert.equal(chunks[0].reason.failure.providerRetryAfterMs, 12000)
  } finally {
    globalThis.fetch = previous
  }
})

test('managed failure taxonomy keeps DSH retry ownership precise', () => {
  assert.equal(managedFailure(Object.assign(new Error('timeout'), { status: 408 })).code, 'TIMEOUT')
  assert.equal(managedFailure(Object.assign(new Error('conflict'), { status: 409 })).code, 'TRANSPORT')
  assert.equal(managedFailure(Object.assign(new Error('too early'), { status: 425 })).code, 'TRANSPORT')
  assert.equal(managedFailure(Object.assign(new Error('route'), { code: 'LCX_RESPONSES_ROUTE_UNAVAILABLE' })).code, 'NO_ADAPTER')
  assert.equal(managedFailure(Object.assign(new Error('stop'), { code: 'LCX_RESPONSES_UNSUPPORTED_OPTION' })).code, 'UNSUPPORTED_OPTION')
  assert.equal(managedFailure(Object.assign(new Error('credential'), { code: 'LCX_CREDENTIAL_UNAVAILABLE' })).code, 'AUTH')
  assert.equal(managedFailure(Object.assign(new Error("This model's maximum context length is 128000 tokens"), { status: 400 })).code, 'CONTEXT_WINDOW_EXCEEDED')
  assert.equal(managedFailure(Object.assign(new Error('request failed'), { status: 400, code: 'context_length_exceeded' })).code, 'CONTEXT_WINDOW_EXCEEDED')
})
