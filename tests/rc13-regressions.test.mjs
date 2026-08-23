import test from 'node:test'
import assert from 'node:assert/strict'

import { buildNativeCompactionBody } from '../lib/compact-v2.js'
import { persistNativeImageReferences, readDshPiReplayState, serializeDshMessages } from '../lib/dsh-responses.js'
import { retainedConversationInput, stateRouteCompatible } from '../lib/native-checkpoint.js'
import { replayBody, requestNativeReplay } from '../lib/responses-replay.js'
import { baseURLFingerprint, generationControlsFromHeader, generationControlsFromSession, updateRequestHeaderCache } from '../lib/route.js'

const { convertResponsesMessages, convertResponsesTools } = await import(
  '@earendil-works/pi-ai/api/openai-responses-shared',
)

const MODEL_ID = 'gpt-5.6-fixture'
const PROVIDER_ID = 'fixture-relay'
const BASE_URL = 'https://example.invalid/v1'
const SESSION_ID = 'session-rc13-fixture'
const SYSTEM_PROMPT = 'system-shape'
const TOOL_SCHEMA = {
  type: 'object',
  properties: { query: { type: 'string' } },
  required: ['query'],
  additionalProperties: false,
}
const LOOKUP_TOOL = {
  name: 'lookup',
  description: 'fixture tool',
  parameters: TOOL_SCHEMA,
  constrainedSampling: { type: 'json_schema', strict: 'require' },
}
const DEFERRED_TOOL = {
  name: 'deferred_lookup',
  description: 'deferred fixture tool',
  parameters: TOOL_SCHEMA,
}
const PLAIN_TOOL = {
  name: 'plain_lookup',
  description: 'plain fixture tool',
  parameters: TOOL_SCHEMA,
}

function textMessage(role, text) {
  return { type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] }
}

function sseResponse(events) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function sessionContext() {
  const parent = { id: 'session-parent-fixture', header: {} }
  const child = { id: 'session-child-fixture', header: { parentSession: parent.id } }
  const records = new Map([[parent.id, parent], [child.id, child]])
  return {
    sessions: { get: (id) => records.get(id) },
    get(name) { return this[name] },
  }
}

function route(sessionId) {
  return { provider: PROVIDER_ID, model: MODEL_ID, baseURL: BASE_URL, sessionId }
}

function richPiFixture() {
  const reasoningItem = {
    type: 'reasoning',
    id: 'rs_fixture',
    summary: [{ type: 'summary_text', text: 'R' }],
  }
  const piMessages = [
    { role: 'user', content: [{ type: 'text', text: 'U' }], timestamp: 1 },
    {
      role: 'assistant',
      api: 'openai-responses',
      provider: PROVIDER_ID,
      model: MODEL_ID,
      content: [
        { type: 'thinking', thinking: 'R', thinkingSignature: JSON.stringify(reasoningItem) },
        { type: 'text', text: 'A', textSignature: JSON.stringify({ v: 1, id: 'msg_fixture', phase: 'commentary' }) },
        { type: 'toolCall', id: 'call_fixture|fc_fixture', name: 'lookup', arguments: { query: 'Q' } },
      ],
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'toolUse',
      timestamp: 2,
    },
    {
      role: 'toolResult',
      toolCallId: 'call_fixture|fc_fixture',
      toolName: 'lookup',
      content: [{ type: 'text', text: 'O' }],
      addedToolNames: [DEFERRED_TOOL.name],
      isError: false,
      timestamp: 3,
    },
  ]
  const dshMessages = [
    { role: 'user', content: [{ type: 'text', text: 'U' }] },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'R', id: 'rs_fixture', phase: 'commentary' },
        { type: 'text', text: 'A', id: 'msg_fixture', phase: 'commentary' },
        { type: 'tool-call', id: 'call_fixture|fc_fixture', name: 'lookup', arguments: { query: 'Q' } },
       ],
       source: {
         kind: 'model',
         provider: PROVIDER_ID,
         model: MODEL_ID,
         replayState: {
           response: { kind: 'pi-ai', version: 2, api: 'openai-responses', provider: PROVIDER_ID, model: MODEL_ID, stopReason: 'toolUse' },
           blocks: [
             { type: 'reasoning', thinkingSignature: JSON.stringify(reasoningItem) },
             { type: 'text', textSignature: JSON.stringify({ v: 1, id: 'msg_fixture', phase: 'commentary' }) },
             { type: 'tool-call' },
           ],
         },
       },

    },
    {
      role: 'user',
      content: [{ type: 'tool-result', toolCallId: 'call_fixture|fc_fixture', content: [{ type: 'text', text: 'O' }], addedToolNames: [DEFERRED_TOOL.name] }],
    },
  ]
  const model = {
    id: MODEL_ID,
    name: 'fixture model',
    api: 'openai-responses',
    provider: PROVIDER_ID,
    baseUrl: BASE_URL,
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 32768,
    compat: { supportsDeveloperRole: true, supportsStrictMode: true, supportsToolSearch: true },
  }
  const context = { systemPrompt: SYSTEM_PROMPT, messages: piMessages, tools: [LOOKUP_TOOL, DEFERRED_TOOL] }
  return { dshMessages, model, context, deferredTools: new Map([[DEFERRED_TOOL.name, DEFERRED_TOOL]]) }
}

function fidelityShape(items) {
  return items.flatMap((item) => {
    if (item?.type === 'reasoning') return [{ type: 'reasoning', id: item.id }]
    if (item?.type === 'message' && item.role === 'assistant') return [{ type: 'message', id: item.id, phase: item.phase }]
    if (item?.type === 'function_call') return [{ type: 'function_call', id: item.id, call_id: item.call_id }]
    if (item?.type === 'function_call_output') return [{ type: 'function_call_output', call_id: item.call_id }]
    if (item?.type === 'tool_search_call') return [{ type: 'tool_search_call', call_id: item.call_id, execution: item.execution }]
    if (item?.type === 'tool_search_output') return [{ type: 'tool_search_output', call_id: item.call_id, execution: item.execution }]
    return []
  })
}

function toolShape(tools) {
  return tools.map((tool) => ({ type: tool.type, name: tool.name, strict: tool.strict, defer_loading: tool.defer_loading }))
}

test('parent_child_never_sends_opaque_native_state', () => {
  const ctx = sessionContext()
  const parentRoute = route('session-parent-fixture')
  const childRoute = route('session-child-fixture')
  const state = {
    version: 5,
    provider: PROVIDER_ID,
    model: MODEL_ID,
    baseURLFingerprint: baseURLFingerprint(BASE_URL),
    sourceSessionId: parentRoute.sessionId,
    nativeOutput: [textMessage('user', 'retained'), { type: 'compaction' }],
  }

  assert.equal(stateRouteCompatible(state, parentRoute, ctx), true)
  const childMayReplayNative = stateRouteCompatible(state, childRoute, ctx)
  assert.equal(childMayReplayNative, false, 'child ancestry permits portable migration only')
  assert.equal(childMayReplayNative ? state.nativeOutput : undefined, undefined, 'child request must omit parent native output')
})

test('replay_terminal_index_shift_deduplicates', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => sseResponse([
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'A' },
    {
      type: 'response.completed',
      response: {
        id: 'response-fixture',
        status: 'completed',
        output: [
          { type: 'reasoning', id: 'rs-fixture', summary: [] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A' }] },
        ],
      },
    },
  ])
  try {
    const chunks = []
    for await (const chunk of requestNativeReplay({ baseURL: BASE_URL, model: MODEL_ID, input: [], headers: {}, maxAttempts: 1 })) chunks.push(chunk)
    const textEnds = chunks.filter((chunk) => chunk.type === 'block-end' && chunk.block?.type === 'text')
    const nonEmptyTextEnds = textEnds.filter((chunk) => chunk.block.text.length > 0)
    assert.equal(textEnds.length, 1, 'terminal index drift must not create an extra text block')
    assert.equal(nonEmptyTextEnds.length, 1)
    assert.equal(nonEmptyTextEnds[0].block.text, 'A')
  } finally {
    globalThis.fetch = originalFetch
  }
})


test('replay_function_call_done_without_delta_has_balanced_block', async () => {
  const originalFetch = globalThis.fetch
  const call = { type: 'function_call', id: 'fc_done', call_id: 'call_done', name: 'lookup', arguments: '{"query":"Q"}' }
  globalThis.fetch = async () => sseResponse([
    { type: 'response.output_item.done', output_index: 0, item: call },
    { type: 'response.completed', response: { id: 'response-done-fixture', status: 'completed', output: [call] } },
  ])
  try {
    const chunks = []
    for await (const chunk of requestNativeReplay({ baseURL: BASE_URL, model: MODEL_ID, input: [], headers: {}, maxAttempts: 1 })) chunks.push(chunk)
    const starts = chunks.filter((chunk) => chunk.type === 'block-start' && chunk.blockType === 'tool-call')
    const ends = chunks.filter((chunk) => chunk.type === 'block-end' && chunk.block?.type === 'tool-call')
    assert.equal(starts.length, 1)
    assert.equal(ends.length, 1)
    assert.equal(ends[0].block.id, 'call_done|fc_done', 'Native replay tool ids must match normal Pi call_id|item_id identity')
    assert.equal(ends[0].block.arguments, '{"query":"Q"}')
  } finally { globalThis.fetch = originalFetch }
})

test('canonical_role_only_messages_remain_durable_and_image_safe', () => {
  const imageUrl = 'https://image.example.invalid/request-image'
  const attachment = { id: 'attachment-fixture', mediaType: 'image/png' }
  const canonical = [
    { role: 'developer', content: 'system-shape' },
    { role: 'user', content: [{ type: 'input_image', detail: 'auto', image_url: imageUrl }] },
  ]
  const retained = retainedConversationInput(canonical)
  assert.equal(retained.length, 2, 'role-only canonical developer/user items must survive retained-history selection')
  const persisted = persistNativeImageReferences(retained, new Map([[imageUrl, attachment]]))
  assert.equal(persisted[1].content[0].type, 'dsh_image_attachment')
  assert.equal(JSON.stringify(persisted).includes(imageUrl), false, 'checkpoint must not persist request image URLs/payloads')
})

test('normal_to_compact_preserves_canonical_prefix', async () => {
  const { dshMessages, model, context, deferredTools } = richPiFixture()
  const dshSerialized = await serializeDshMessages(dshMessages, undefined, {
    imageSupport: 'unsupported',
    route: { provider: PROVIDER_ID, model: MODEL_ID, baseURL: BASE_URL },
    model,
    systemPrompt: context.systemPrompt,
    includeSystemPrompt: true,
    tools: context.tools,
  })
  const nativeBody = buildNativeCompactionBody({
    model: model.id,
    input: dshSerialized.input,
    tools: dshSerialized.tools,
    promptCacheKey: SESSION_ID,
  })
  const canonicalInput = convertResponsesMessages(model, context, new Set(['openai', 'openai-codex', 'opencode']), {
    includeSystemPrompt: true,
    deferredTools,
    toolOptions: { supportsStrictMode: true, supportsOpenAIGrammarTools: false },
  })
  const canonicalTools = convertResponsesTools([LOOKUP_TOOL], { supportsStrictMode: true, supportsOpenAIGrammarTools: false })

  assert.equal(nativeBody.input.filter((item) => item?.type === 'compaction_trigger').length, 1)
  assert.equal(canonicalInput.filter((item) => item?.type === 'compaction_trigger').length, 0)
  assert.deepEqual(nativeBody.input.slice(0, -1), canonicalInput, 'Native compact must preserve the full canonical normal-request prefix')
  assert.deepEqual(nativeBody.tools, canonicalTools, 'Native compact tools must match canonical immediate tools')
  assert.deepEqual(
    { input: fidelityShape(nativeBody.input), tools: toolShape(nativeBody.tools) },
    { input: fidelityShape(canonicalInput), tools: toolShape(canonicalTools) },
    'Native compact input/tools must preserve canonical reasoning/id/phase/linkage/strict/deferred shape',
  )
  assert.equal(nativeBody.instructions, undefined)
  assert.equal(canonicalInput[0]?.role, 'developer')
})

test('compact_to_replay1_starts_new_epoch', () => {
  const normalInput = [textMessage('user', 'U')]
  const compact = buildNativeCompactionBody({
    model: MODEL_ID,
    input: normalInput,
    instructions: SYSTEM_PROMPT,
    tools: [PLAIN_TOOL],
    promptCacheKey: SESSION_ID,
  })
  assert.equal(compact.input.at(-1)?.type, 'compaction_trigger')

  const replay1 = replayBody({
    model: MODEL_ID,
    input: [...compact.input.slice(0, -1), textMessage('user', 'R1')],
    system: SYSTEM_PROMPT,
    tools: [PLAIN_TOOL],
    promptCacheKey: SESSION_ID,
  })
  assert.equal(replay1.stream, true)
  assert.equal(replay1.store, false)
  assert.equal(replay1.input.filter((item) => item?.type === 'compaction_trigger').length, 0, 'compaction trigger belongs to the compact epoch only')
  assert.equal(replay1.input.at(-1)?.type, 'message')
  assert.equal(replay1.instructions, SYSTEM_PROMPT)
  assert.equal(replay1.prompt_cache_key, SESSION_ID)
})

test('replay1_to_replay2_is_append_only', () => {
  const compact = buildNativeCompactionBody({ model: MODEL_ID, input: [textMessage('user', 'U')], tools: [PLAIN_TOOL], promptCacheKey: SESSION_ID })
  const replay1 = replayBody({ model: MODEL_ID, input: [...compact.input.slice(0, -1), textMessage('assistant', 'R1')], promptCacheKey: SESSION_ID })
  const replay2 = replayBody({ model: MODEL_ID, input: [...replay1.input, textMessage('user', 'R2')], promptCacheKey: SESSION_ID })
  const stablePrefix = replay1.input.filter((item) => item?.type !== 'compaction_trigger')

  assert.deepEqual(replay2.input.slice(0, stablePrefix.length), stablePrefix, 'replay2 must retain replay1 canonical prefix')
  assert.equal(replay2.input.length, stablePrefix.length + 1)
  assert.equal(replay2.prompt_cache_key, replay1.prompt_cache_key)
})


test('invalid_replay_state_degrades_without_reusing_signatures', async () => {
  const sentinel = 'msg_should_not_replay'
  const messages = [{
    role: 'assistant',
    content: [{ type: 'text', text: 'A' }],
    source: {
      kind: 'model', provider: PROVIDER_ID, model: MODEL_ID,
      replayState: {
        response: { kind: 'pi-ai', version: 2, api: 'openai-responses', provider: 'different-provider', model: MODEL_ID, stopReason: 'stop' },
        blocks: [{ type: 'text', textSignature: JSON.stringify({ v: 1, id: sentinel }) }],
      },
    },
  }]
  const model = { id: MODEL_ID, name: MODEL_ID, api: 'openai-responses', provider: PROVIDER_ID, baseUrl: BASE_URL, reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 262144, maxTokens: 32768 }
  const serialized = await serializeDshMessages(messages, undefined, { imageSupport: 'unsupported', route: { provider: PROVIDER_ID, model: MODEL_ID, baseURL: BASE_URL }, model })
  assert.equal(serialized.input.some((item) => item?.id === sentinel), false, 'mismatched replay metadata must not inject its native signature')
})

test('tool_search_defaults_off_without_trusted_compat', async () => {
  const messages = [{ role: 'user', content: [{ type: 'tool-result', toolCallId: 'call_fixture', toolName: LOOKUP_TOOL.name, content: [{ type: 'text', text: 'O' }], addedToolNames: [DEFERRED_TOOL.name] }] }]
  const serialized = await serializeDshMessages(messages, undefined, {
    imageSupport: 'unsupported',
    route: { provider: PROVIDER_ID, model: MODEL_ID, baseURL: BASE_URL },
    tools: [PLAIN_TOOL, DEFERRED_TOOL],
  })
  assert.equal(serialized.tools.length, 2)
  assert.equal(serialized.tools.some((tool) => tool.defer_loading === true), false)
  assert.equal(serialized.input.some((item) => item?.type === 'tool_search_call' || item?.type === 'tool_search_output'), false)
})



test('native_generation_envelope_matches_normal_pi_controls', () => {
  const compact = buildNativeCompactionBody({
    model: MODEL_ID,
    input: [textMessage('user', 'U')],
    tools: [PLAIN_TOOL],
    promptCacheKey: SESSION_ID,
    reasoningEffort: 'xhigh',
    temperature: 0.25,
    maxTokens: 1234,
  })
  const replay = replayBody({
    model: MODEL_ID,
    input: [textMessage('user', 'U')],
    tools: [PLAIN_TOOL],
    promptCacheKey: SESSION_ID,
    reasoningEffort: 'xhigh',
    temperature: 0.25,
    maxTokens: 1234,
  })
  const expected = {
    reasoning: { effort: 'xhigh', summary: 'auto' },
    include: ['reasoning.encrypted_content'],
    temperature: 0.25,
    max_output_tokens: 1234,
  }
  for (const body of [compact, replay]) {
    assert.deepEqual(body.reasoning, expected.reasoning)
    assert.deepEqual(body.include, expected.include)
    assert.equal(body.temperature, expected.temperature)
    assert.equal(body.max_output_tokens, expected.max_output_tokens)
  }
})


test('compaction_generation_controls_come_from_matching_session_header', () => {
  const route = { provider: PROVIDER_ID, model: MODEL_ID, sessionId: SESSION_ID }
  const session = {
    requestHeader() {
      return {
        config: {
          provider: PROVIDER_ID,
          model: MODEL_ID,
          reasoningEffort: 'xhigh',
          temperature: 0.2,
          maxTokens: 4321,
        },
        adapterDefaults: {},
      }
    },
  }
  assert.deepEqual(generationControlsFromSession(session, route), {
    reasoningEffort: 'xhigh',
    temperature: 0.2,
    maxTokens: 4321,
  })

  const mismatched = {
    requestHeader() {
      return { config: { provider: 'other-provider', model: MODEL_ID, reasoningEffort: 'max' } }
    },
  }
  assert.deepEqual(generationControlsFromSession(mismatched, route), {})

  const adapterDefaults = {
    requestHeader() {
      return {
        config: { provider: PROVIDER_ID, model: MODEL_ID, reasoningEffort: 'high', maxTokens: 9999 },
        adapterDefaults: { reasoningEffort: true, maxTokens: true },
      }
    },
  }
  assert.deepEqual(generationControlsFromSession(adapterDefaults, route), { reasoningEffort: 'high', maxTokens: 9999 }, 'effective adapter defaults are still part of the ordinary Pi request envelope')
})


test('session_event_cache_refreshes_header_before_compaction', () => {
  const route = { provider: PROVIDER_ID, model: MODEL_ID, sessionId: SESSION_ID }
  const first = { config: { provider: PROVIDER_ID, model: MODEL_ID, reasoningEffort: 'high' }, adapterDefaults: {} }
  const second = { config: { provider: PROVIDER_ID, model: MODEL_ID, reasoningEffort: 'xhigh', temperature: 0.1, maxTokens: 32768 }, adapterDefaults: { reasoningEffort: true, maxTokens: true } }
  let current = second
  const session = { id: SESSION_ID, requestHeader: () => current }
  const cache = new Map()
  assert.equal(updateRequestHeaderCache(cache, session, { type: 'request/header', data: { header: first } }), true)
  assert.equal(cache.get(SESSION_ID), first)
  assert.deepEqual(generationControlsFromHeader(cache.get(SESSION_ID), route), { reasoningEffort: 'high' })
  assert.equal(updateRequestHeaderCache(cache, session, { type: 'compaction/start', data: {} }), true)
  assert.equal(cache.get(SESSION_ID), second, 'compaction/start must synchronously refresh from live Session.requestHeader()')
  assert.deepEqual(generationControlsFromHeader(cache.get(SESSION_ID), route), { reasoningEffort: 'xhigh', temperature: 0.1, maxTokens: 32768 })
  current = undefined
  assert.equal(updateRequestHeaderCache(cache, session, { type: 'compaction/start', data: {} }), false)
  assert.equal(cache.get(SESSION_ID), second, 'a missing refresh must not destroy the last known good header')
})

test('remote_v2_body_includes_explicit_tool_controls', () => {
  const compact = buildNativeCompactionBody({
    model: MODEL_ID,
    input: [textMessage('user', 'U')],
    tools: [PLAIN_TOOL],
    promptCacheKey: SESSION_ID,
    reasoningEffort: 'xhigh',
  })
  const replay = replayBody({
    model: MODEL_ID,
    input: [textMessage('user', 'U')],
    tools: [PLAIN_TOOL],
    promptCacheKey: SESSION_ID,
    reasoningEffort: 'xhigh',
  })
  for (const body of [compact, replay]) {
    assert.equal(body.tool_choice, 'auto', 'Remote Responses must explicitly keep automatic tool choice')
    assert.equal(body.parallel_tool_calls, true, 'plain openai-responses Remote V2 must preserve the default parallel-tool capability explicitly')
  }
})
test('native_replay_finish_preserves_pi_replay_state', async () => {
  const originalFetch = globalThis.fetch
  const reasoning = {
    type: 'reasoning',
    id: 'rs_replay_fixture',
    summary: [{ type: 'summary_text', text: 'R' }],
    encrypted_content: 'encrypted-fixture',
  }
  const message = {
    type: 'message',
    id: 'msg_replay_fixture',
    role: 'assistant',
    status: 'completed',
    phase: 'final_answer',
    content: [{ type: 'output_text', text: 'A', annotations: [] }],
  }
  const call = {
    type: 'function_call',
    id: 'fc_replay_fixture',
    call_id: 'call_replay_fixture',
    name: 'lookup',
    arguments: '{"query":"Q"}',
    status: 'completed',
  }
  globalThis.fetch = async () => sseResponse([{
    type: 'response.completed',
    response: {
      id: 'resp_replay_fixture',
      model: 'gpt-5.6-response-fixture',
      status: 'completed',
      output: [reasoning, message, call],
      usage: { input_tokens: 20, input_tokens_details: { cached_tokens: 4 }, output_tokens: 3 },
    },
  }])
  try {
    const chunks = []
    for await (const chunk of requestNativeReplay({
      baseURL: BASE_URL,
      provider: PROVIDER_ID,
      model: MODEL_ID,
      input: [],
      headers: {},
      maxAttempts: 1,
    })) chunks.push(chunk)
    const finish = chunks.find((chunk) => chunk.type === 'finish')
    assert.ok(finish?.replayState, 'successful Native replay must persist Pi replay metadata')
    const state = readDshPiReplayState(finish.replayState)
    assert.equal(state.response.kind, 'pi-ai')
    assert.equal(state.response.version, 2)
    assert.equal(state.response.api, 'openai-responses')
    assert.equal(state.response.provider, PROVIDER_ID)
    assert.equal(state.response.model, MODEL_ID)
    assert.equal(state.response.responseModel, 'gpt-5.6-response-fixture')
    assert.equal(state.response.responseId, 'resp_replay_fixture')
    assert.equal(state.response.stopReason, 'toolUse')
    const ends = chunks.filter((chunk) => chunk.type === 'block-end')
    assert.equal(state.blocks.length, ends.length, 'replay metadata must align 1:1 with persisted DSH blocks')
    assert.deepEqual(JSON.parse(state.blocks[0].thinkingSignature), reasoning)
    assert.deepEqual(JSON.parse(state.blocks[1].textSignature), { v: 1, id: 'msg_replay_fixture', phase: 'final_answer' })
    assert.deepEqual(state.blocks[2], { type: 'tool-call' })
    assert.equal(ends[2].block.id, 'call_replay_fixture|fc_replay_fixture')
  } finally {
    globalThis.fetch = originalFetch
  }
})
test('replay_function_call_delta_preserves_full_pi_identity', async () => {
  const originalFetch = globalThis.fetch
  const call = { type: 'function_call', id: 'fc_delta', call_id: 'call_delta', name: 'lookup', arguments: '{"query":"Q"}', status: 'completed' }
  globalThis.fetch = async () => sseResponse([
    { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_delta', call_id: 'call_delta', name: 'lookup', delta: '{"query":"' },
    { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_delta', call_id: 'call_delta', name: 'lookup', delta: 'Q"}' },
    { type: 'response.completed', response: { id: 'resp_delta', status: 'completed', output: [call] } },
  ])
  try {
    const chunks = []
    for await (const chunk of requestNativeReplay({ baseURL: BASE_URL, provider: PROVIDER_ID, model: MODEL_ID, input: [], headers: {}, maxAttempts: 1 })) chunks.push(chunk)
    const deltas = chunks.filter((chunk) => chunk.type === 'tool-call-delta')
    const end = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block?.type === 'tool-call')
    assert.ok(deltas.length >= 2)
    assert.ok(deltas.every((chunk) => chunk.id === 'call_delta|fc_delta'))
    assert.equal(end?.block.id, 'call_delta|fc_delta')
  } finally { globalThis.fetch = originalFetch }
})