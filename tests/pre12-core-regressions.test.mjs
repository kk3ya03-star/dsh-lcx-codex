import test from 'node:test'
import assert from 'node:assert/strict'

import { deriveTurnTokenUsage } from '../node_modules/@deepseek-ai/dsh-token-meter/lib/types/turn-usage.js'
import { serializeDshMessages } from '../lib/dsh-responses.js'
import { managedFailure, streamResponsesRequest } from '../lib/responses-stream.js'
import {
  collect,
  functionTools,
  grokHarness,
  sseResponse,
  user,
} from './grok-fixture.mjs'

function model(provider = 'lcx', id = 'gpt-5.6-sol', overrides = {}) {
  return {
    id,
    name: id,
    api: 'openai-responses',
    provider,
    baseUrl: 'https://example.invalid/v1',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 32768,
    compat: {},
    ...overrides,
  }
}

function completed(output, extra = {}) {
  return {
    type: 'response.completed',
    response: {
      id: extra.id ?? 'resp_pre12',
      model: extra.model ?? 'grok-4.6',
      status: 'completed',
      output,
      usage: extra.usage ?? { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      ...(extra.citations ? { citations: extra.citations } : {}),
    },
  }
}

function messageItem(text, annotations = [], id = 'msg_pre12') {
  return {
    type: 'message', id, role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text, annotations }],
  }
}

function grokOptions(messages, tools = functionTools) {
  return {
    provider: 'xai', model: 'grok-4.6', sessionId: 'pre12-core-session',
    messages, tools, reasoningEffort: 'high',
  }
}

function canonicalMessageEvents(item) {
  const part = item.content[0]
  return [
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: item.id, part: { ...part, text: '' } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: part.text },
    { type: 'response.output_text.done', output_index: 0, content_index: 0, item_id: item.id, text: part.text },
    { type: 'response.content_part.done', output_index: 0, content_index: 0, item_id: item.id, part },
    { type: 'response.output_item.done', output_index: 0, item },
    completed([item]),
  ]
}

test('subagent-settled reasoning is omitted as child-only thought while conclusion text reaches GPT and Grok', async () => {
  const settlement = {
    role: 'user',
    source: { kind: 'subagent-settled', form: 'notice', summary: 'completed', senderSessionId: 'synthetic-child' },
    content: [
      { type: 'text', text: 'Subagent finished.\n' },
      { type: 'reasoning', text: 'Synthetic child reasoning must not become parent reasoning.' },
      { type: 'text', text: 'Keep the child conclusion.' },
    ],
  }
  for (const [provider, id] of [['lcx', 'gpt-5.6-sol'], ['xai', 'grok-4.6']]) {
    const serialized = await serializeDshMessages([settlement], undefined, { model: model(provider, id), tools: functionTools })
    const wire = JSON.stringify(serialized.input)
    assert.match(wire, /Keep the child conclusion/)
    assert.doesNotMatch(wire, /Synthetic child reasoning/)
    assert.equal(serialized.input.some(item => item.type === 'reasoning'), false)
  }
})

test('unsupported merge-extension content remains a diagnostic local content failure', async () => {
  await assert.rejects(
    serializeDshMessages([{ role: 'user', source: { kind: 'user' }, content: [{ type: 'future-block', value: 1 }] }], undefined, { model: model() }),
    error => error?.code === 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT',
  )
  assert.equal(managedFailure(Object.assign(new Error('unsupported'), { code: 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT' })).code, 'UNSUPPORTED_CONTENT')
})

test('historical tool call restores grammar tool name for custom output pairing without changing JSON tools', async () => {
  const grammar = {
    name: 'shell', description: 'Execute constrained input',
    parameters: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'], additionalProperties: false },
    constrainedSampling: { type: 'grammar', variants: { openai_regex: '.+' } },
  }
  const json = { name: 'read', description: 'Read JSON input', parameters: { type: 'object', properties: {} } }
  const history = [
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', id: 'call_custom|ctc_custom', name: 'shell', arguments: '{"script":"echo ok"}' },
        { type: 'tool-call', id: 'call_json|fc_json', name: 'read', arguments: '{}' },
      ],
      source: {
        kind: 'model', provider: 'lcx', model: 'gpt-5.6-sol',
        replayState: {
          response: { kind: 'pi-ai', version: 2, api: 'openai-responses', provider: 'lcx', model: 'gpt-5.6-sol', stopReason: 'toolUse' },
          blocks: [{ type: 'tool-call', namespace: 'functions' }, { type: 'tool-call', namespace: 'functions' }],
        },
      },
    },
    { role: 'user', source: { kind: 'tool', callId: 'call_custom|ctc_custom' }, content: [{ type: 'tool-result', toolCallId: 'call_custom|ctc_custom', content: [{ type: 'text', text: 'custom ok' }] }] },
    { role: 'user', source: { kind: 'tool', callId: 'call_json|fc_json' }, content: [{ type: 'tool-result', toolCallId: 'call_json|fc_json', content: [{ type: 'text', text: 'json ok' }] }] },
  ]
  const serialized = await serializeDshMessages(history, undefined, {
    model: model('lcx', 'gpt-5.6-sol', { compat: { supportsOpenAIGrammarTools: true, supportsStrictMode: true } }),
    tools: [grammar, json],
  })
  const custom = serialized.input.find(item => item.type === 'custom_tool_call')
  const customOutput = serialized.input.find(item => item.call_id === custom.call_id && item !== custom)
  const jsonCall = serialized.input.find(item => item.type === 'function_call' && item.name === 'read')
  const jsonOutput = serialized.input.find(item => item.call_id === jsonCall.call_id && item !== jsonCall)
  assert.equal(customOutput.type, 'custom_tool_call_output')
  assert.equal(jsonOutput.type, 'function_call_output')
})

test('same-provider model switch keeps assistant phase but drops nonportable reasoning identity', async () => {
  const serialized = await serializeDshMessages([{
    role: 'assistant',
    content: [
      { type: 'reasoning', text: 'Portable visible summary.' },
      { type: 'text', text: 'I will inspect the logs.' },
    ],
    source: {
      kind: 'model', provider: 'lcx', model: 'gpt-5.6-sol',
      replayState: {
        response: { kind: 'pi-ai', version: 2, api: 'openai-responses', provider: 'lcx', model: 'gpt-5.6-sol', stopReason: 'stop' },
        blocks: [
          { type: 'reasoning', thinkingSignature: JSON.stringify({ type: 'reasoning', id: 'rs_old', encrypted_content: 'SYNTHETIC_OPAQUE', summary: [] }) },
          { type: 'text', textSignature: JSON.stringify({ v: 1, id: 'msg_commentary', phase: 'commentary' }) },
        ],
      },
    },
  }], undefined, {
    model: model('lcx', 'gpt-5.6-terra'),
    route: { provider: 'lcx', model: 'gpt-5.6-terra', baseURL: 'https://example.invalid/v1' },
  })
  const commentary = serialized.input.find(item => item.type === 'message' && item.content?.[0]?.text === 'I will inspect the logs.')
  assert.equal(commentary?.phase, 'commentary')
  assert.equal(serialized.input.some(item => item.type === 'reasoning' || JSON.stringify(item).includes('SYNTHETIC_OPAQUE')), false)
})

test('cross-model phase restoration follows ordered assistant blocks when text repeats', async () => {
  const replay = (sourceModel, blocks, stopReason = 'stop') => ({
    kind: 'model', provider: 'lcx', model: sourceModel,
    replayState: {
      response: { kind: 'pi-ai', version: 2, api: 'openai-responses', provider: 'lcx', model: sourceModel, stopReason },
      blocks,
    },
  })
  const serialized = await serializeDshMessages([
    {
      role: 'assistant', content: [{ type: 'text', text: 'OK' }],
      source: replay('gpt-5.6-terra', [{ type: 'text', textSignature: JSON.stringify({ v: 1, id: 'msg_same', phase: 'commentary' }) }]),
    },
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] },
    {
      role: 'assistant',
      content: [{ type: 'reasoning', text: 'Visible cross-model summary.' }, { type: 'text', text: 'OK' }, { type: 'text', text: 'More' }],
      source: replay('gpt-5.6-sol', [
        { type: 'reasoning', thinkingSignature: JSON.stringify({ type: 'reasoning', id: 'rs_old', encrypted_content: 'SYNTHETIC_ORDERED', summary: [] }) },
        { type: 'text', textSignature: JSON.stringify({ v: 1, id: 'msg_cross_one', phase: 'final_answer' }) },
        { type: 'text', textSignature: JSON.stringify({ v: 1, id: 'msg_cross_two', phase: 'commentary' }) },
      ]),
    },
  ], undefined, { model: model('lcx', 'gpt-5.6-terra') })
  const assistant = serialized.input.filter(item => item.type === 'message' && item.role === 'assistant')
  assert.deepEqual(assistant.map(item => [item.content[0].text, item.phase]), [
    ['OK', 'commentary'],
    ['Visible cross-model summary.', undefined],
    ['OK', 'final_answer'],
    ['More', 'commentary'],
  ])
  assert.equal(JSON.stringify(serialized.input).includes('SYNTHETIC_ORDERED'), false)
})

test('failed and aborted identical-text assistants do not shift later phase slots', async () => {
  const source = (sourceModel, stopReason, phase) => ({
    kind: 'model', provider: 'lcx', model: sourceModel,
    replayState: {
      response: { kind: 'pi-ai', version: 2, api: 'openai-responses', provider: 'lcx', model: sourceModel, stopReason },
      blocks: [{ type: 'text', textSignature: JSON.stringify({ v: 1, id: `msg_${stopReason}`, phase }) }],
    },
  })
  const serialized = await serializeDshMessages([
    { role: 'assistant', content: [{ type: 'text', text: 'OK' }], source: source('gpt-5.6-sol', 'error', 'commentary') },
    { role: 'assistant', content: [{ type: 'text', text: 'OK' }], source: source('gpt-5.6-sol', 'aborted', 'commentary') },
    { role: 'assistant', content: [{ type: 'text', text: 'OK' }], source: source('gpt-5.6-sol', 'stop', 'final_answer') },
  ], undefined, { model: model('lcx', 'gpt-5.6-terra') })
  const assistant = serialized.input.filter(item => item.type === 'message' && item.role === 'assistant')
  assert.deepEqual(assistant.map(item => [item.content[0].text, item.phase]), [['OK', 'final_answer']])
})

test('Responses usage exposes exact total and zero cache buckets for complete DSH turn accounting', async t => {
  t.mock.method(globalThis, 'fetch', async () => sseResponse([completed([messageItem('ok')], {
    model: 'gpt-5.6-sol',
    usage: {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 2,
      output_tokens_details: { reasoning_tokens: 1 },
      total_tokens: 12,
    },
  })]))
  const chunks = await collect(streamResponsesRequest({
    baseURL: 'https://example.invalid/v1', provider: 'lcx', model: 'gpt-5.6-sol', piModel: model(),
    body: { model: 'gpt-5.6-sol', input: [], stream: true, store: false }, headers: { authorization: 'Bearer synthetic' }, maxAttempts: 1,
  }))
  const usage = chunks.find(chunk => chunk.type === 'usage')?.usage
  assert.deepEqual(usage, {
    inputTokens: 10, outputTokens: 2, totalTokens: 12,
    cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 1,
  })
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', source: { kind: 'model', provider: 'lcx', model: 'gpt-5.6-sol' }, content: [{ type: 'text', text: 'ok' }] }, usage } },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1 } },
  ]
  assert.deepEqual(deriveTurnTokenUsage(events), {
    uncachedInputTokens: 10, outputTokens: 2, totalTokens: 12,
    cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 1,
    routes: [{ provider: 'lcx', model: 'gpt-5.6-sol' }],
  })
})

test('Grok preserves official inline citations and fenced YAML while removing only a terminal Sources list', async t => {
  const text = 'Fact [[1]](https://example.com/cited).  Exact spacing.\n```yaml\nSources: -1\nvalue: "a  b"\n```\n```python\nif ready:\n    print("a  b")\n```\nExplanation remains.\nSources:\n- https://example.com/consulted'
  const item = messageItem(text, [], 'msg_citation_stream')
  t.mock.method(globalThis, 'fetch', async () => sseResponse(canonicalMessageEvents(item)))
  const chunks = await collect(grokHarness({ nativeWeb: true }).stream(grokOptions([user('cite')]), () => { throw new Error('Unexpected fallback') }))
  const streamed = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
  const terminal = chunks.find(chunk => chunk.type === 'block-end' && chunk.block?.type === 'text')?.block.text
  const expected = 'Fact [[1]](https://example.com/cited).  Exact spacing.\n```yaml\nSources: -1\nvalue: "a  b"\n```\n```python\nif ready:\n    print("a  b")\n```\nExplanation remains.'
  assert.equal(streamed, expected)
  assert.equal(terminal, expected)
})

test('Grok resolves citation_id placeholders only from matching output annotations and ignores consulted citations', async t => {
  const annotation = { type: 'url_citation', citation_id: 2, url: 'https://example.com/actual', title: 'Actual' }
  const item = messageItem('Fact {render_inline_citation:citation_id=2}; unresolved {render_inline_citation:citation_id=9}.', [annotation], 'msg_placeholder')
  t.mock.method(globalThis, 'fetch', async () => sseResponse([completed([item], {
    citations: [{ id: 9, url: 'https://example.com/consulted-only' }],
  })]))
  const chunks = await collect(grokHarness({ nativeWeb: true }).stream(grokOptions([user('cite')]), () => { throw new Error('Unexpected fallback') }))
  const text = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
  assert.equal(text, 'Fact [[2]](https://example.com/actual); unresolved.')
  assert.doesNotMatch(text, /consulted-only/)
})

test('sanitized Grok visible history restores exact raw native sequence, but edited visible text does not', async t => {
  const reasoning = { type: 'reasoning', id: 'rs_replay', encrypted_content: 'SYNTHETIC_REPLAY', summary: [{ type: 'summary_text', text: 'Checked sources' }] }
  const server = { type: 'web_search_call', id: 'ws_replay', status: 'completed', action: { type: 'search', query: 'fixture', sources: [{ url: 'https://example.com/consulted' }] } }
  const rawMessage = messageItem('Answer [[1]](https://example.com/cited).\nSources:\n- https://example.com/consulted', [], 'msg_replay')
  const serverEcho = { type: 'custom_tool_call', id: 'ctc_replay_search', call_id: 'xs_call-replay', name: 'x_semantic_search', input: 'fixture', status: 'completed' }
  const terminalReasoning = { type: 'reasoning', id: 'tco_replay', encrypted_content: 'SYNTHETIC_TCO_REPLAY', summary: [] }
  const local = { type: 'function_call', id: 'fc_replay', call_id: 'call_replay', name: 'workspace_read', arguments: '{}', status: 'completed' }
  const original = [reasoning, server, rawMessage, serverEcho, terminalReasoning, local]
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(String(init.body)))
    return requests.length === 1 ? sseResponse([completed(original, { id: 'resp_replay_first' })]) : sseResponse([completed([messageItem('continued', [], `msg_next_${requests.length}`)], { id: `resp_next_${requests.length}` })])
  })
  const harness = grokHarness({ nativeWeb: true, nativeX: true })
  const prompt = user('search and read')
  const first = await collect(harness.stream(grokOptions([prompt]), () => { throw new Error('Unexpected fallback') }))
  const assistant = {
    role: 'assistant',
    source: { kind: 'model', provider: 'xai', model: 'grok-4.6', replayState: first.find(chunk => chunk.type === 'finish').replayState },
    content: first.filter(chunk => chunk.type === 'block-end').map(chunk => structuredClone(chunk.block)),
  }
  assert.equal(assistant.content.find(block => block.type === 'text').text, 'Answer [[1]](https://example.com/cited).')
  const result = { role: 'user', source: { kind: 'tool', callId: 'call_replay|fc_replay' }, content: [{ type: 'tool-result', toolCallId: 'call_replay|fc_replay', content: [{ type: 'text', text: 'ok' }] }] }
  await collect(harness.stream(grokOptions(JSON.parse(JSON.stringify([prompt, assistant, result]))), () => { throw new Error('Unexpected fallback') }))
  const start = requests[1].input.findIndex(item => item.id === reasoning.id)
  assert.deepEqual(requests[1].input.slice(start, start + original.length), original)
  assert.equal(requests[1].input[start + original.length].type, 'function_call_output')

  const edited = JSON.parse(JSON.stringify(assistant))
  edited.content.find(block => block.type === 'text').text += ' edited'
  await collect(harness.stream(grokOptions([prompt, edited, result]), () => { throw new Error('Unexpected fallback') }))
  assert.equal(requests[2].input.some(item => item.type === 'web_search_call'), false)
  assert.equal(requests[2].input.some(item => item.encrypted_content === 'SYNTHETIC_REPLAY'), true, 'Pi may retain valid same-model reasoning independently')
})

test('matching Grok native custom search extension is server-completed and never dispatched locally', async t => {
  const serverEcho = { type: 'custom_tool_call', id: 'ctc_x_server', call_id: 'xs_call-fixture', name: 'x_keyword_search', input: '{"query":"from:xai"}', status: 'completed' }
  const terminalReasoning = { type: 'reasoning', id: 'tco_fixture', encrypted_content: 'SYNTHETIC_TCO', summary: [] }
  t.mock.method(globalThis, 'fetch', async () => sseResponse([
    { type: 'response.output_item.added', output_index: 1, item: { ...serverEcho, status: 'in_progress', input: '' } },
    { type: 'response.custom_tool_call_input.delta', output_index: 1, item_id: serverEcho.id, call_id: serverEcho.call_id, delta: serverEcho.input },
    { type: 'response.custom_tool_call_input.done', output_index: 1, item_id: serverEcho.id, input: serverEcho.input },
    { type: 'response.output_item.done', output_index: 1, item: serverEcho },
    completed([messageItem('Search complete.'), serverEcho, terminalReasoning], { id: 'resp_x_server' }),
  ]))
  const chunks = await collect(grokHarness({ nativeX: true }).stream(grokOptions([user('search X')]), () => { throw new Error('Unexpected fallback') }))
  assert.equal(chunks.some(chunk => chunk.type === 'block-end' && chunk.block?.type === 'tool-call'), false)
  assert.equal(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), 'Search complete.')
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.deepEqual(chunks.at(-1).replayState.grokNative.output, [messageItem('Search complete.'), serverEcho, terminalReasoning])
  assert.deepEqual(chunks.at(-1).replayState.grokNative.serverSearchEchoCallIds, ['xs_call-fixture'])
})

test('same-name declared custom tool remains local, while disabled X capability does not swallow it', async t => {
  const serverShape = { type: 'custom_tool_call', id: 'ctc_x_shape', call_id: 'xs_call-shape', name: 'x_keyword_search', input: 'from:xai', status: 'completed' }
  let response = sseResponse([completed([serverShape], { id: 'resp_x_declared' })])
  t.mock.method(globalThis, 'fetch', async () => response)
  const declared = {
    name: 'x_keyword_search', description: 'Explicit local constrained tool',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    constrainedSampling: { type: 'grammar', variants: { openai_regex: '.+' } },
  }
  const accepted = await collect(grokHarness({ nativeX: true }).stream(grokOptions([user('run declared local tool')], [...functionTools, declared]), () => { throw new Error('Unexpected fallback') }))
  assert.equal(accepted.at(-1).reason.kind, 'tool-calls')
  assert.equal(accepted.find(chunk => chunk.type === 'block-end' && chunk.block?.type === 'tool-call')?.block.name, 'x_keyword_search')

  response = sseResponse([completed([serverShape], { id: 'resp_x_disabled' })])
  const rejected = await collect(grokHarness({ nativeWeb: true, nativeX: false }).stream(grokOptions([user('X is disabled')]), () => { throw new Error('Unexpected fallback') }))
  assert.equal(rejected.at(-1).reason.kind, 'error')
  assert.equal(rejected.at(-1).reason.failure.code, 'GROK_NATIVE_PROTOCOL_ERROR')
})

test('native-shaped Grok custom search must be terminally completed before it is hidden', async t => {
  const incomplete = { type: 'custom_tool_call', id: 'ctc_incomplete', call_id: 'xs_call-incomplete', name: 'x_user_search', input: '{}', status: 'incomplete' }
  t.mock.method(globalThis, 'fetch', async () => sseResponse([completed([incomplete], { id: 'resp_incomplete_echo' })]))
  const chunks = await collect(grokHarness({ nativeX: true }).stream(grokOptions([user('incomplete')]), () => { throw new Error('Unexpected fallback') }))
  assert.equal(chunks.some(chunk => chunk.type === 'block-end' && chunk.block?.type === 'tool-call'), false)
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'GROK_NATIVE_PROTOCOL_ERROR')
})

test('unknown Grok client custom tool is a diagnostic protocol error', async t => {
  const unknown = { type: 'custom_tool_call', id: 'ctc_unknown', call_id: 'call-unknown', name: 'not_declared', input: '{}', status: 'completed' }
  t.mock.method(globalThis, 'fetch', async () => sseResponse([completed([unknown], { id: 'resp_unknown' })]))
  const chunks = await collect(grokHarness({ nativeX: true }).stream(grokOptions([user('unknown')]), () => { throw new Error('Unexpected fallback') }))
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'GROK_NATIVE_PROTOCOL_ERROR')
})

test('Grok preserves bare Sources URL lists inside complete and unfinished code fences', async t => {
  let current
  t.mock.method(globalThis, 'fetch', async () => sseResponse(canonicalMessageEvents(current)))
  for (const body of [
    'Example:\n```yaml\nSources:\n- https://example.com/code-data\n```\nProse remains.',
    'Example:\n~~~yaml\nSources:\n- https://example.com/code-data',
  ]) {
    current = messageItem(body)
    const chunks = await collect(grokHarness({ nativeWeb: true }).stream(grokOptions([user('show code')]), () => { throw new Error('Unexpected fallback') }))
    assert.equal(chunks.filter(c => c.type === 'text-delta').map(c => c.text).join(''), body)
    assert.equal(chunks.at(-1).reason.kind, 'stop')
  }
})

test('completed browse_page Web extension stays native and never creates a local tool call', async t => {
  const server = { type: 'custom_tool_call', id: 'ctc_web_echo', call_id: 'ws_call-fixture', name: 'browse_page', input: '{"url":"https://example.com"}', status: 'completed' }
  const answer = messageItem('Evidence [[1]](https://example.com).')
  t.mock.method(globalThis, 'fetch', async () => sseResponse([completed([server, answer])]))
  const chunks = await collect(grokHarness({ nativeWeb: true, nativeX: false }).stream(grokOptions([user('browse')]), () => { throw new Error('Unexpected fallback') }))
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.equal(chunks.some(c => c.type === 'block-end' && c.block?.type === 'tool-call'), false)
  assert.deepEqual(chunks.at(-1).replayState.grokNative.serverSearchEchoCallIds, ['ws_call-fixture'])
  assert.deepEqual(chunks.at(-1).replayState.grokNative.output, [server, answer])
})
