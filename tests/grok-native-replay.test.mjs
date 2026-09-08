import test from 'node:test'
import assert from 'node:assert/strict'
import { serializeDshMessages } from '../lib/dsh-responses.js'
import {
  collect,
  functionTools,
  grokHarness,
  sseResponse,
  user,
  xaiProfile,
} from './grok-fixture.mjs'

const provider = 'xai'
const model = 'grok-4.6'
const sessionId = 'grok-native-replay-59'
const clientCall = {
  type: 'function_call', id: 'fc_local_59', call_id: 'call_local_59',
  name: 'workspace_read', arguments: '{"path":"README.md"}', status: 'completed',
}
const reasoningItem = {
  type: 'reasoning', id: 'rs_native_59', encrypted_content: 'SYNTHETIC_ENCRYPTED_59',
  summary: [{ type: 'summary_text', text: 'Checked native sources' }],
}

function serverItem(type, index) {
  return type === 'web_search_call'
    ? {
        type, id: `ws_native_${index}`, status: 'completed',
        action: { type: 'search', query: 'fixture', sources: [{ url: `https://example.com/source-${index}`, title: `Source ${index}` }] },
      }
    : { type, id: `xs_native_${index}`, status: 'completed', action: { type: 'search', query: 'fixture' } }
}

function completed(output, id = 'resp_native_first') {
  return {
    type: 'response.completed',
    response: {
      id, model, status: 'completed', output,
      usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
    },
  }
}

function finalAnswer() {
  return sseResponse([completed([{
    type: 'message', id: 'msg_native_final', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'final answer', annotations: [] }],
  }], 'resp_native_final')])
}

function options(messages, overrides = {}) {
  return {
    provider, model, sessionId, messages, tools: functionTools,
    reasoningEffort: 'high',
    ...overrides,
  }
}

function assistantFrom(chunks) {
  const finish = chunks.find(chunk => chunk.type === 'finish')
  assert.equal(finish.reason.kind, 'tool-calls')
  return {
    role: 'assistant',
    source: { kind: 'model', provider, model, replayState: finish.replayState },
    content: chunks
      .filter(chunk => chunk.type === 'block-end')
      .map(chunk => structuredClone(chunk.block)),
  }
}

function toolResult() {
  return {
    role: 'user', source: { kind: 'tool', callId: `${clientCall.call_id}|${clientCall.id}` },
    content: [{
      type: 'tool-result', toolCallId: `${clientCall.call_id}|${clientCall.id}`,
      toolName: clientCall.name, content: [{ type: 'text', text: 'synthetic local result' }],
    }],
  }
}

async function twoHop(t, serverTypes, { cold = false, firstEvents } = {}) {
  const originalOutput = [reasoningItem, ...serverTypes.map(serverItem), clientCall]
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(String(init.body)))
    if (requests.length === 1)
      return sseResponse(firstEvents?.(originalOutput) ?? [completed(originalOutput)])
    return finalAnswer()
  })
  const h = grokHarness({
    nativeWeb: serverTypes.includes('web_search_call'),
    nativeX: serverTypes.includes('x_search_call'),
  })
  const prompt = user('native search then read')
  const first = await collect(h.stream(options([prompt]), () => { throw new Error('DSH adapter must not run') }))
  assert.deepEqual(
    first.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block.type),
    ['reasoning', 'tool-call', ...(serverTypes.includes('web_search_call') ? ['text'] : [])],
  )
  let history = [prompt, assistantFrom(first), toolResult()]
  if (cold) history = JSON.parse(JSON.stringify(history))
  const second = await collect(h.stream(options(history), () => { throw new Error('DSH adapter must not run') }))
  assert.equal(second.at(-1).reason.kind, 'stop')
  assert.equal(requests.length, 2)
  return { originalOutput, first, secondBody: requests[1] }
}

for (const [name, types] of [
  ['Web', ['web_search_call']],
  ['X', ['x_search_call']],
  ['Web and X', ['web_search_call', 'x_search_call']],
]) {
  test(`two-hop ${name} replay restores ordered native items before local output`, async t => {
    const { originalOutput, secondBody } = await twoHop(t, types)
    const firstOriginalIndex = secondBody.input.findIndex(item => item?.id === reasoningItem.id)
    assert.ok(firstOriginalIndex >= 0)
    assert.deepEqual(
      secondBody.input.slice(firstOriginalIndex, firstOriginalIndex + originalOutput.length),
      originalOutput,
    )
    const outputIndex = secondBody.input.findIndex(item => item?.type === 'function_call_output')
    assert.equal(outputIndex, firstOriginalIndex + originalOutput.length)
    assert.equal(secondBody.input.some(item => item?.id?.startsWith('msg_lcx_sources_')), false)
    assert.equal(secondBody.input[outputIndex].call_id, clientCall.call_id)
    assert.equal(secondBody.input.filter(item => item?.type === 'function_call' && item.call_id === clientCall.call_id).length, 1)
    assert.equal(secondBody.store, false)
    assert.equal(Object.hasOwn(secondBody, 'previous_response_id'), false)
  })
}

test('JSON-persisted cold reopen retains native replay on the exact route and session', async t => {
  const { originalOutput, secondBody } = await twoHop(t, ['web_search_call', 'x_search_call'], { cold: true })
  const restored = secondBody.input.filter(item => originalOutput.some(original => original.id === item?.id))
  assert.deepEqual(restored, originalOutput)
})

for (const [framed, reportedSearch] of [[false, true], [true, true], [false, false], [true, false]])
test(`gateway ${reportedSearch ? 'Web' : 'opaque X'} repeated reasoning IDs survive cold replay (${framed ? 'framed' : 'terminal-only'})`, async t => {
  const originalOutput = [
    { ...reasoningItem, summary: [] },
    ...(reportedSearch ? [serverItem('web_search_call', 31)] : []),
    { ...reasoningItem, id: 'rs_middle_59', summary: [], encrypted_content: 'SYNTHETIC_MIDDLE' },
    { ...reasoningItem, summary: [], encrypted_content: 'SYNTHETIC_REPEATED_ID_DIFFERENT_STATE' },
    clientCall,
  ]
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(String(init.body)))
    const frames = framed ? originalOutput.flatMap((item, output_index) => [
      { type: 'response.output_item.added', output_index, item },
      { type: 'response.output_item.done', output_index, item },
    ]) : []
    return requests.length === 1 ? sseResponse([...frames, completed(originalOutput)]) : finalAnswer()
  })
  const h = grokHarness({ nativeWeb: reportedSearch, nativeX: !reportedSearch })
  const prompt = user('native search then local tool with repeated reasoning IDs')
  const first = await collect(h.stream(options([prompt]), () => { throw new Error('Unexpected native adapter') }))
  const assistant = assistantFrom(first)
  assert.ok(assistant.source.replayState.grokNative)
  const history = JSON.parse(JSON.stringify([prompt, assistant, toolResult()]))
  const second = await collect(h.stream(options(history), () => { throw new Error('Unexpected native adapter') }))
  assert.equal(second.at(-1).reason.kind, 'stop')
  const start = requests[1].input.findIndex(item => item.id === reasoningItem.id)
  assert.ok(start >= 0)
  assert.deepEqual(requests[1].input.slice(start, start + originalOutput.length), originalOutput)
  assert.equal(requests[1].input[start + originalOutput.length].type, 'function_call_output')
  assert.deepEqual(assistant.source.replayState.grokNative.output, originalOutput)
  assert.equal(requests[1].input.filter(item => item.type === 'function_call').length, 1)
  assert.equal(requests[1].input.filter(item => item.type === 'function_call_output').length, 1)
})

test('done-item fallback captures ordered native replay when terminal output is empty', async t => {
  const { originalOutput, secondBody } = await twoHop(t, ['web_search_call'], {
    firstEvents: output => [
      ...output.map((item, output_index) => ({ type: 'response.output_item.done', output_index, item })),
      completed([], 'resp_terminal_output_omitted'),
    ],
  })
  const restored = secondBody.input.filter(item => originalOutput.some(original => original.id === item?.id))
  assert.deepEqual(restored, originalOutput)
})

test('empty reasoning, split output text, and source fallback remain replayable end to end', async t => {
  const message = {
    type: 'message', id: 'msg_split_59', role: 'assistant', status: 'completed',
    content: [
      { type: 'output_text', text: 'Part A', annotations: [] },
      { type: 'output_text', text: ' and B', annotations: [] },
    ],
  }
  const emptyReasoning = { type: 'reasoning', id: 'rs_empty_59', encrypted_content: 'SYNTHETIC_EMPTY_59', summary: [] }
  const web = serverItem('web_search_call', 7)
  const originalOutput = [emptyReasoning, web, message, clientCall]
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(String(init.body)))
    return requests.length === 1 ? sseResponse([completed(originalOutput)]) : finalAnswer()
  })
  const h = grokHarness({ nativeWeb: true })
  const prompt = user('split fixture')
  const first = await collect(h.stream(options([prompt]), () => { throw new Error('DSH adapter must not run') }))
  const assistant = assistantFrom(first)
  assert.deepEqual(assistant.content.map(block => [block.type, block.text ?? block.name]), [
    ['reasoning', ''], ['text', 'Part A and B'], ['tool-call', 'workspace_read'],
    ['text', '\n\nSources:\n- Source 7: https://example.com/source-7'],
  ])
  await collect(h.stream(options([prompt, JSON.parse(JSON.stringify(assistant)), toolResult()]), () => { throw new Error('DSH adapter must not run') }))
  const second = requests[1].input
  const start = second.findIndex(item => item?.id === emptyReasoning.id)
  assert.deepEqual(second.slice(start, start + originalOutput.length), originalOutput)
  assert.equal(second[start + originalOutput.length].type, 'function_call_output')
  assert.equal(second.some(item => item?.id?.startsWith('msg_lcx_sources_')), false)
  assert.deepEqual(assistant.source.replayState.grokNative.output, originalOutput)
  assert.equal(assistant.source.replayState.grokNative.version, 2)
})

async function capturedHistory(t) {
  const output = [reasoningItem, serverItem('web_search_call', 9), clientCall]
  t.mock.method(globalThis, 'fetch', async () => sseResponse([completed(output)]))
  const h = grokHarness({ nativeWeb: true })
  const prompt = user('capture history')
  const chunks = await collect(h.stream(options([prompt]), () => { throw new Error('DSH adapter must not run') }))
  return [prompt, assistantFrom(chunks), toolResult()]
}

test('legacy v1 citation items migrate to display-only anchors on cold continuation', async t => {
  const history = await capturedHistory(t)
  const assistant = history[1]
  const envelope = assistant.source.replayState.grokNative
  const originalOutput = structuredClone(envelope.output)
  const sourceText = assistant.content.find(block => block.type === 'text').text
  envelope.version = 1
  delete envelope.visibleAdditions
  envelope.output.push({
    type: 'message', id: 'msg_lcx_sources_resp_native_first', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: sourceText, annotations: [] }],
  })
  let request
  globalThis.fetch.mock.mockImplementation(async (_url, init) => {
    request = JSON.parse(String(init.body))
    return finalAnswer()
  })
  const h = grokHarness({ nativeWeb: true })
  const chunks = await collect(h.stream(options(JSON.parse(JSON.stringify(history))), () => { throw new Error('Unexpected fallback') }))
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  const start = request.input.findIndex(item => item.id === reasoningItem.id)
  assert.ok(start >= 0)
  assert.deepEqual(request.input.slice(start, start + originalOutput.length), originalOutput)
  assert.equal(request.input[start + originalOutput.length].type, 'function_call_output')
  assert.equal(request.input.some(item => item.id?.startsWith('msg_lcx_sources_')), false)
  assert.equal(assistant.content.find(block => block.type === 'text').text, sourceText)
})

for (const framed of [false, true])
test(`opaque X without client call preserves every original item after cold reopen (${framed ? 'framed' : 'terminal-only'})`, async t => {
  const originalOutput = [
    { ...reasoningItem, summary: [] },
    { ...reasoningItem, id: 'rs_middle_no_client', summary: [], encrypted_content: 'SYNTHETIC_MIDDLE' },
    { ...reasoningItem, summary: [], encrypted_content: 'SYNTHETIC_REPEATED' },
    { type: 'message', id: 'msg_no_client', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'X answer', annotations: [] }] },
  ]
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(String(init.body)))
    const frames = framed ? originalOutput.flatMap((item, output_index) => [
      { type: 'response.output_item.added', output_index, item },
      { type: 'response.output_item.done', output_index, item },
    ]) : []
    return requests.length === 1 ? sseResponse([...frames, completed(originalOutput)]) : finalAnswer()
  })
  const h = grokHarness({ nativeX: true })
  const prompt = user('Search X without any local function')
  const chunks = await collect(h.stream(options([prompt]), () => { throw new Error('Unexpected fallback') }))
  const finish = chunks.find(chunk => chunk.type === 'finish')
  assert.equal(finish.reason.kind, 'stop')
  assert.equal(finish.replayState.grokNative.version, 2)
  assert.deepEqual(finish.replayState.grokNative.output, originalOutput)
  const assistant = {
    role: 'assistant', source: { kind: 'model', provider, model, replayState: finish.replayState },
    content: chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block),
  }
  const history = JSON.parse(JSON.stringify([prompt, assistant, user('Recall after reopen')]))
  const second = await collect(h.stream(options(history), () => { throw new Error('Unexpected fallback') }))
  assert.equal(second.at(-1).reason.kind, 'stop')
  const start = requests[1].input.findIndex(item => item.id === reasoningItem.id)
  assert.ok(start >= 0)
  assert.deepEqual(requests[1].input.slice(start, start + originalOutput.length), originalOutput)
  assert.equal(requests[1].input[start + originalOutput.length].role, 'user')
  assert.equal(requests[1].input.some(item => item.type === 'function_call'), false)
})

for (const fixture of [
  { name: 'foreign session', overrides: { sessionId: 'foreign-session-59' } },
  { name: 'foreign provider', overrides: { provider: 'relay' }, profiles: { relay: xaiProfile } },
  { name: 'changed model', overrides: { model: 'grok-4.5' } },
  { name: 'changed endpoint authority', profile: { ...xaiProfile, baseURL: 'https://other-gateway.example/v1' } },
  { name: 'changed credential authority', profile: { ...xaiProfile, apiKeyEnv: 'OTHER_FIXTURE_KEY' } },
  { name: 'changed selected headers', profile: { ...xaiProfile, headers: { 'x-fixture-route': 'changed' } } },
]) {
  test(`${fixture.name} does not restore Grok opaque replay`, async t => {
    const history = await capturedHistory(t)
    globalThis.fetch.mock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init.body))
      assert.equal(body.input.some(item => item?.type === 'web_search_call'), false)
      assert.equal(body.input.filter(item => item?.type === 'function_call').length, 1)
      return finalAnswer()
    })
    const profiles = fixture.profiles ?? { xai: fixture.profile ?? xaiProfile }
    const h = grokHarness({ nativeWeb: true, profiles })
    const chunks = await collect(h.stream(options(history, fixture.overrides), () => { throw new Error('DSH adapter must not run') }))
    assert.equal(chunks.at(-1).reason.kind, 'stop')
  })
}

for (const [name, corrupt] of [
  ['duplicate function call', envelope => envelope.output.push(structuredClone(clientCall))],
  ['server-only output', envelope => { envelope.output = [serverItem('web_search_call', 12)] }],
  ['invalid native item', envelope => envelope.output.push({ type: 'function_call', id: 'broken' })],
  ['corrupt visible addition hash', envelope => { envelope.visibleAdditions[0].textSha256 = '0'.repeat(64) }],
  ['unknown envelope version', envelope => { envelope.version = 99 }],
]) {
  test(`corrupt replay guard rejects ${name} without duplicate execution`, async t => {
    const history = await capturedHistory(t)
    const envelope = history[1].source.replayState.grokNative
    corrupt(envelope)
    globalThis.fetch.mock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init.body))
      assert.equal(body.input.some(item => item?.type === 'web_search_call'), false)
      assert.equal(body.input.filter(item => item?.type === 'function_call' && item.call_id === clientCall.call_id).length, 1)
      return finalAnswer()
    })
    const h = grokHarness({ nativeWeb: true })
    const chunks = await collect(h.stream(options(history), () => { throw new Error('DSH adapter must not run') }))
    assert.equal(chunks.at(-1).reason.kind, 'stop')
  })
}

test('incomplete native output never persists a partial Grok replay envelope', async t => {
  const output = [reasoningItem, serverItem('x_search_call', 4), clientCall]
  t.mock.method(globalThis, 'fetch', async () => sseResponse([{
    type: 'response.incomplete',
    response: {
      id: 'resp_incomplete_59', model, status: 'incomplete', output,
      incomplete_details: { reason: 'max_output_tokens' },
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  }]))
  const h = grokHarness({ nativeX: true })
  const chunks = await collect(h.stream(options([user('incomplete')]), () => { throw new Error('DSH adapter must not run') }))
  const finish = chunks.find(chunk => chunk.type === 'finish')
  assert.equal(finish.reason.kind, 'max-tokens')
  assert.equal(finish.replayState.grokNative, undefined)
})

test('ordinary GPT Pi parsing ignores the additive Grok field', async () => {
  const message = {
    role: 'assistant',
    content: [{ type: 'tool-call', id: 'call_gpt|fc_gpt', name: 'run', arguments: '{}' }],
    source: {
      kind: 'model', provider: 'lcx', model: 'gpt-5.6-sol',
      replayState: {
        response: { kind: 'pi-ai', version: 2, api: 'openai-responses', provider: 'lcx', model: 'gpt-5.6-sol', stopReason: 'toolUse' },
        blocks: [{ type: 'tool-call' }],
        grokNative: { kind: 'xai-responses-native-search', version: 1, output: [serverItem('web_search_call', 15)] },
      },
    },
  }
  const serialized = await serializeDshMessages([message], {}, {
    model: {
      id: 'gpt-5.6-sol', name: 'GPT fixture', api: 'openai-responses', provider: 'lcx',
      baseUrl: 'https://example.invalid/v1', reasoning: true, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 32768,
    },
  })
  assert.deepEqual(serialized.input.map(item => item.type), ['function_call', 'function_call_output'])
  assert.equal(serialized.input.some(item => item.type === 'web_search_call' || item.type === 'x_search_call'), false)
})

test('ordinary DSH Pi Grok history conversion ignores extra native state', async () => {
  const message = {
    role: 'assistant',
    content: [{ type: 'tool-call', id: 'call_grok|fc_grok', name: 'run', arguments: '{}' }],
    source: {
      kind: 'model', provider: 'xai', model: 'grok-4.6',
      replayState: {
        response: { kind: 'pi-ai', version: 2, api: 'openai-responses', provider: 'xai', model: 'grok-4.6', stopReason: 'toolUse' },
        blocks: [{ type: 'tool-call' }],
        grokNative: { kind: 'xai-responses-native-search', version: 1, output: [serverItem('x_search_call', 16)] },
      },
    },
  }
  const serialized = await serializeDshMessages([message], {}, {
    model: {
      id: 'grok-4.6', name: 'Grok fixture', api: 'openai-responses', provider: 'xai',
      baseUrl: 'https://api.x.ai/v1', reasoning: true, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 32768,
    },
  })
  assert.deepEqual(serialized.input.map(item => item.type), ['function_call', 'function_call_output'])
  assert.equal(serialized.input.some(item => item.type === 'web_search_call' || item.type === 'x_search_call'), false)
})
