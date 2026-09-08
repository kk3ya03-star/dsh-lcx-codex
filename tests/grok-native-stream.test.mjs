import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collect,
  functionTools,
  grokHarness,
  sseResponse,
  user,
  xaiProfile,
} from './grok-fixture.mjs'

function answerResponse(id = 'resp_answer') {
  return sseResponse([{
    type: 'response.completed',
    response: {
      id,
      model: 'grok-4.6',
      status: 'completed',
      output: [{
        type: 'message', id: `msg_${id}`, role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: 'done', annotations: [] }],
      }],
      usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
    },
  }])
}

function requestOptions(content) {
  return {
    provider: 'xai',
    model: 'grok-4.6',
    sessionId: 'session-grok-native',
    messages: [user('search', content)],
    tools: functionTools,
    reasoningEffort: 'high',
    temperature: 0.25,
    maxTokens: 77,
  }
}

test('ordinary Grok bridge emits exact native tools and preserves DSH controls', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url, body: JSON.parse(String(init.body)), headers: Object.fromEntries(new Headers(init.headers)) })
    return answerResponse(`resp_${requests.length}`)
  })
  const image = { attachmentId: 'sha256:fixture', bytes: 3, mediaType: 'image/png', width: 1, height: 1 }
  for (const [nativeWeb, nativeX] of [[true, false], [false, true], [true, true]]) {
    const h = grokHarness({ nativeWeb, nativeX })
    const signal = new AbortController().signal
    const chunks = await collect(h.stream(
      { ...requestOptions([{ type: 'text', text: 'search' }, { type: 'image', attachment: image }]), signal },
      () => { throw new Error('DSH adapter must not run') },
    ))
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    assert.deepEqual(h.imageOptions, [{ maxPixels: 40_000_000, maxBytes: 4_000_000 }])
  }
  assert.equal(requests.length, 3)
  for (let index = 0; index < requests.length; index += 1) {
    const body = requests[index].body
    const [nativeWeb, nativeX] = [[true, false], [false, true], [true, true]][index]
    assert.equal(requests[index].url, 'https://gateway.example/v1/responses')
    assert.equal(requests[index].headers['x-fixture-route'], 'xai')
    assert.equal(body.tools.some(tool => tool.type === 'function' && tool.name === 'web_search'), false)
    assert.deepEqual(body.tools.filter(tool => tool.type === 'function').map(tool => tool.name), ['web_fetch', 'workspace_read'])
    assert.equal(body.tools.filter(tool => tool.type === 'web_search').length, nativeWeb ? 1 : 0)
    assert.equal(body.tools.filter(tool => tool.type === 'x_search').length, nativeX ? 1 : 0)
    assert.deepEqual(body.reasoning, { effort: 'gateway-high', summary: 'auto' })
    assert.deepEqual(body.include, [
      'reasoning.encrypted_content',
      ...(nativeWeb ? ['web_search_call.action.sources'] : []),
    ])
    assert.equal(body.max_output_tokens, 77)
    assert.equal(body.temperature, 0.25)
    assert.equal(body.prompt_cache_key, 'session-grok-native')
    assert.equal(body.previous_response_id, undefined)
    assert.equal(JSON.stringify(body.input).includes('input_image'), true)
  }
})

test('server search items stay opaque inside additive replay while citations and client calls survive', async t => {
  const serverItem = { type: 'web_search_call', id: 'ws_server_1', status: 'completed' }
  t.mock.method(globalThis, 'fetch', async () => sseResponse([
    { type: 'response.output_item.added', output_index: 0, item: serverItem },
    { type: 'response.output_item.done', output_index: 0, item: serverItem },
    {
      type: 'response.completed',
      response: {
        id: 'resp_server_tools', model: 'grok-4.6', status: 'completed',
        output: [
          serverItem,
          {
            type: 'message', id: 'msg_answer', role: 'assistant', status: 'completed',
            content: [{
              type: 'output_text', text: 'Current result',
              annotations: [{ type: 'url_citation', url: 'https://example.com/source', title: 'Example' }],
            }],
          },
          {
            type: 'function_call', id: 'fc_client_1', call_id: 'call_client_1',
            name: 'workspace_read', arguments: '{}', status: 'completed',
          },
        ],
        usage: {
          input_tokens: 10, output_tokens: 4, total_tokens: 14,
          server_side_tool_usage_details: { web_search_calls: 1, x_search_calls: 0 },
          num_server_side_tools_used: 1,
        },
      },
    },
  ]))
  const h = grokHarness({ nativeWeb: true })
  const chunks = await collect(h.stream(
    requestOptions([{ type: 'text', text: 'search and read' }]),
    () => { throw new Error('DSH adapter must not run') },
  ))
  const text = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
  const clientCall = chunks.find(chunk => chunk.type === 'block-end' && chunk.block?.type === 'tool-call')?.block
  const finish = chunks.find(chunk => chunk.type === 'finish')
  assert.match(text, /https:\/\/example\.com\/source/)
  assert.equal(clientCall.name, 'workspace_read')
  assert.equal(clientCall.id, 'call_client_1|fc_client_1')
  assert.equal(finish.reason.kind, 'tool-calls')
  assert.doesNotMatch(JSON.stringify(finish.replayState.blocks), /web_search_call|ws_server_1/)
  assert.deepEqual(
    finish.replayState.grokNative.output.map(item => item.type),
    ['web_search_call', 'message', 'function_call'],
  )
  assert.equal(finish.replayState.grokNative.visibleAdditions.length, 1)
  assert.match(finish.replayState.grokNative.visibleAdditions[0].textSha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(h.logs, ['[lcx-codex] Grok native search used 1 server-side tool call(s) (web=1, x=0)'])
})

test('X usage is reported once from terminal aggregate without x_search_call events', async t => {
  t.mock.method(globalThis, 'fetch', async () => sseResponse([{
    type: 'response.completed',
    response: {
      id: 'resp_x_usage', model: 'grok-4.6', status: 'completed',
      output: [{
        type: 'message', id: 'msg_x_usage', role: 'assistant', status: 'completed',
        content: [{
          type: 'output_text',
          text: 'Recent X result [source](https://x.com/example/status/1)',
          annotations: [{
            type: 'url_citation', url: 'https://x.com/example/status/1', title: 'X post',
          }],
        }],
      }],
      usage: {
        input_tokens: 9, output_tokens: 3, total_tokens: 12,
        server_side_tool_usage_details: { web_search_calls: 0, x_search_calls: 4 },
        num_server_side_tools_used: 4,
      },
    },
  }]))
  const h = grokHarness({ nativeX: true })
  const chunks = await collect(h.stream(
    requestOptions([{ type: 'text', text: 'recent X posts' }]),
    () => { throw new Error('DSH adapter must not run') },
  ))
  const text = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
  assert.match(text, /https:\/\/x\.com\/example\/status\/1/)
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.deepEqual(h.logs, ['[lcx-codex] Grok native search used 4 server-side tool call(s) (web=0, x=4)'])
})

test('Grok reasoning wire matches Pi built-ins, profile defaults, aliases, and disabled custom models', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(String(init.body))
    requests.push(body)
    return answerResponse(`resp_reasoning_${requests.length}`)
  })
  const cases = [
    {
      name: 'grok-4.3 default off', model: 'grok-4.3', profile: { ...xaiProfile, models: [{ id: 'grok-4.3' }] },
      expected: { effort: 'none' },
    },
    {
      name: 'grok-4.5 provider default', model: 'grok-4.5', profile: { ...xaiProfile, models: [{ id: 'grok-4.5' }] },
      expected: undefined,
    },
    {
      name: 'grok-4.6 provider default', model: 'grok-4.6', profile: { ...xaiProfile, models: [{ id: 'grok-4.6' }] },
      expected: undefined,
    },
    {
      name: 'profile medium alias', model: 'grok-custom-reasoning',
      profile: {
        ...xaiProfile, reasoning: 'medium',
        models: [{ id: 'grok-custom-reasoning', reasoningEfforts: { off: null, medium: 'gateway-medium', high: 'gateway-high' } }],
      },
      expected: { effort: 'gateway-medium', summary: 'auto' },
    },
    {
      name: 'explicit overrides profile', model: 'grok-custom-override', effort: 'high',
      profile: {
        ...xaiProfile, reasoning: 'medium',
        models: [{ id: 'grok-custom-override', reasoningEfforts: { off: null, medium: 'gateway-medium', high: 'gateway-high' } }],
      },
      expected: { effort: 'gateway-high', summary: 'auto' },
    },
    {
      name: 'custom reasoning disabled', model: 'grok-custom-no-reasoning',
      profile: { ...xaiProfile, models: [{ id: 'grok-custom-no-reasoning', reasoningEfforts: false }] },
      expected: undefined, include: [],
    },
  ]
  for (const fixture of cases) {
    const h = grokHarness({ nativeX: true, profiles: { xai: fixture.profile } })
    const chunks = await collect(h.stream({
      provider: 'xai', model: fixture.model, sessionId: `reasoning-${fixture.model}`,
      messages: [user(fixture.name)], tools: functionTools,
      ...(fixture.effort ? { reasoningEffort: fixture.effort } : {}),
    }, () => { throw new Error('DSH adapter must not run') }))
    assert.equal(chunks.at(-1).reason.kind, 'stop', fixture.name)
    const body = requests.at(-1)
    assert.deepEqual(body.reasoning, fixture.expected, fixture.name)
    assert.deepEqual(body.include ?? [], fixture.include ?? ['reasoning.encrypted_content'], fixture.name)
  }
})

test('unsupported profile reasoning fails before Grok network dispatch', async t => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => { requests += 1; return answerResponse() })
  const profile = {
    ...xaiProfile, reasoning: 'medium',
    models: [{ id: 'grok-restricted', reasoningEfforts: { off: null, high: 'gateway-high' } }],
  }
  const h = grokHarness({ nativeWeb: true, profiles: { xai: profile } })
  const chunks = await collect(h.stream({
    provider: 'xai', model: 'grok-restricted', sessionId: 'reasoning-invalid',
    messages: [user('invalid profile effort')], tools: functionTools,
  }, () => { throw new Error('DSH adapter must not run') }))
  assert.equal(requests, 0)
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'UNSUPPORTED_OPTION')
})

for (const model of ['grok-hand-declared-59', 'grok-4.6'])
for (const reasoning of [undefined, 'medium'])
test(`arbitrary provider ${model} without reasoningEfforts uses DSH non-reasoning semantics (${reasoning ?? 'default'})`, async t => {
  let body
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    body = JSON.parse(String(init.body))
    return answerResponse()
  })
  const profile = { ...xaiProfile, models: [{ id: model }], ...(reasoning ? { reasoning } : {}) }
  const h = grokHarness({ nativeX: true, profiles: { relay: profile } })
  const chunks = await collect(h.stream({
    provider: 'relay', model, sessionId: 'undeclared-reasoning', messages: [user('fixture')],
  }, () => { throw new Error('Unexpected DSH adapter') }))
  if (reasoning) {
    assert.equal(body, undefined)
    assert.equal(chunks.at(-1).reason.failure.code, 'UNSUPPORTED_OPTION')
  } else {
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    assert.equal(body.reasoning, undefined)
    assert.equal(body.include, undefined)
  }
})

test('aliased mixed-case custom Grok preserves selected route controls, images, and replay identity', async t => {
  const profile = {
    ...xaiProfile,
    apiKeyEnv: 'RELAY_FIXTURE_KEY',
    headers: { 'x-route-owner': 'relay' },
    models: [{
      id: 'GrOkCustomPreview',
      reasoningEfforts: { off: null, high: 'relay-high' },
    }],
  }
  let request
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    request = {
      url,
      body: JSON.parse(String(init.body)),
      headers: Object.fromEntries(new Headers(init.headers)),
    }
    return sseResponse([{
      type: 'response.completed',
      response: {
        id: 'resp_relay', model: 'GrOkCustomPreview', status: 'completed',
        output: [
          {
            type: 'reasoning', id: 'rs_relay',
            summary: [{ type: 'summary_text', text: 'Checked sources' }],
          },
          {
            type: 'message', id: 'msg_relay', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: 'Relay answer', annotations: [] }],
          },
        ],
        usage: { input_tokens: 6, output_tokens: 3, total_tokens: 9 },
      },
    }])
  })
  const image = {
    attachmentId: 'sha256:relay-fixture', bytes: 3,
    mediaType: 'image/png', width: 1, height: 1,
  }
  const h = grokHarness({ nativeX: true, profiles: { relay: profile } })
  const chunks = await collect(h.stream({
    provider: 'relay', model: 'GrOkCustomPreview', sessionId: 'relay-session',
    messages: [user('search relay', [
      { type: 'text', text: 'search relay' }, { type: 'image', attachment: image },
    ])],
    tools: functionTools, reasoningEffort: 'high', temperature: 0.4, maxTokens: 91,
  }, () => { throw new Error('DSH adapter must not run') }))
  assert.equal(request.url, 'https://gateway.example/v1/responses')
  assert.equal(request.headers['x-route-owner'], 'relay')
  assert.equal(request.body.model, 'GrOkCustomPreview')
  assert.deepEqual(request.body.reasoning, { effort: 'relay-high', summary: 'auto' })
  assert.deepEqual(request.body.include, ['reasoning.encrypted_content'])
  assert.equal(request.body.max_output_tokens, 91)
  assert.equal(request.body.temperature, 0.4)
  assert.equal(request.body.prompt_cache_key, 'relay-session')
  assert.equal(JSON.stringify(request.body.input).includes('input_image'), true)
  assert.equal(request.body.tools.some(tool => tool.type === 'x_search'), true)
  assert.equal(request.body.tools.some(tool => tool.name === 'web_search'), false)
  assert.deepEqual(h.modelInfoRequests, [{ provider: 'relay', model: 'GrOkCustomPreview' }])
  const reasoning = chunks.find(chunk => chunk.type === 'block-end' && chunk.block?.type === 'reasoning')
  const finish = chunks.find(chunk => chunk.type === 'finish')
  assert.equal(reasoning.block.text, 'Checked sources')
  assert.equal(finish.replayState.response.provider, 'relay')
  assert.equal(finish.replayState.response.model, 'GrOkCustomPreview')
})

for (const mode of ['uncited', 'cited', 'inline', 'discarded-stream-citation']) {
  test(`Grok sources display only actual answer citations: ${mode}`, async t => {
    const cited = { type: 'url_citation', url: 'https://example.com/cited', title: 'Cited' }
    const server = {
      type: 'web_search_call', id: 'ws_candidates', status: 'completed',
      action: { type: 'search', sources: Array.from({ length: 20 }, (_, n) => ({ url: `https://example.com/unused-${n}` })) },
    }
    const message = {
      type: 'message', id: 'msg_cited', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: mode === 'inline' ? 'Answer https://example.com/cited' : 'Answer',
        annotations: ['cited', 'inline'].includes(mode) ? [cited, cited] : [] }],
    }
    const output = [server, message]
    t.mock.method(globalThis, 'fetch', async () => sseResponse([
      ...(mode === 'discarded-stream-citation' ? [{ type: 'response.output_item.done', output_index: 1,
        item: { ...message, content: [{ type: 'output_text', text: 'Draft', annotations: [cited] }] } }] : []),
      { type: 'response.completed', response: {
        id: 'resp_sources', model: 'grok-4.6', status: 'completed', output,
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      } },
    ]))
    const h = grokHarness({ nativeWeb: true })
    const chunks = await collect(h.stream(requestOptions([{ type: 'text', text: 'search' }]), () => { throw new Error('Unexpected adapter') }))
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    const text = chunks.filter(c => c.type === 'text-delta').map(c => c.text).join('')
    assert.doesNotMatch(text, /unused-/)
    assert.equal(text.includes('Sources:'), mode === 'cited')
    assert.equal(text.split('https://example.com/cited').length - 1, ['cited', 'inline'].includes(mode) ? 1 : 0)
    assert.deepEqual(chunks.at(-1).replayState.grokNative.output, output, 'Provider replay retains complete original search data')
  })
}
