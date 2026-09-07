import test from 'node:test'
import assert from 'node:assert/strict'

import { buildNativeCompactionBody } from '../lib/compact-v2.js'
import { persistNativeImageReferences, readDshPiReplayState, serializeDshMessages } from '../lib/dsh-responses.js'
import { nativeCheckpointChunks, retainedConversationInput, stateRouteCompatible } from '../lib/native-checkpoint.js'
import { baseURLFingerprint, generationControlsFromHeader, generationControlsFromSession, promptCacheSessionId } from '../lib/route.js'

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

test('normal_to_compact_preserves_serialized_public_prefix', async () => {
  const { dshMessages, model, context } = richPiFixture()
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
  assert.equal(nativeBody.input.filter((item) => item?.type === 'compaction_trigger').length, 1)
  assert.deepEqual(
    nativeBody.input.slice(0, -1),
    dshSerialized.input,
    'Native compact must preserve the serialized DSH request prefix',
  )
  assert.deepEqual(
    nativeBody.tools,
    dshSerialized.tools,
    'Native compact tools must match the serialized ordinary request tools',
  )
  assert.equal(
    dshSerialized.input.some((item) => item?.type === 'tool_search_call' || item?.type === 'tool_search_output'),
    false,
    'payload-free DSH tool results must not infer dynamic-tool provenance',
  )
  assert.equal(nativeBody.instructions, undefined)
  assert.equal(dshSerialized.input[0]?.role, 'developer')
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


test('Session.requestHeader is the sole generation-control authority', () => {
  const route = { provider: PROVIDER_ID, model: MODEL_ID, sessionId: SESSION_ID }
  let current = {
    config: { provider: PROVIDER_ID, model: MODEL_ID, reasoningEffort: 'high', maxTokens: 1000 },
  }
  const session = { id: SESSION_ID, requestHeader: () => current }

  assert.deepEqual(generationControlsFromSession(session, route), {
    reasoningEffort: 'high', maxTokens: 1000,
  })
  current = {
    config: { provider: PROVIDER_ID, model: MODEL_ID, reasoningEffort: 'xhigh', temperature: 0.1, maxTokens: 2000 },
  }
  assert.deepEqual(generationControlsFromSession(session, route), {
    reasoningEffort: 'xhigh', temperature: 0.1, maxTokens: 2000,
  })
})

test('root and subagent request headers remain owner-scoped while sharing the parent cache identity', () => {
  const root = { id: 'session-root-state', header: {} }
  const child = { id: 'session-child-state', header: { origin: 'subagent', parentSession: root.id } }
  const sessions = new Map([[root.id, root], [child.id, child]])
  const ctx = { sessions: { get: id => sessions.get(id) } }
  const rootRoute = { provider: PROVIDER_ID, model: MODEL_ID, sessionId: root.id }
  const childRoute = { provider: PROVIDER_ID, model: MODEL_ID, sessionId: child.id }
  const rootHeader = { config: { provider: PROVIDER_ID, model: MODEL_ID, reasoningEffort: 'high', maxTokens: 1000 }, adapterDefaults: {} }
  const childHeader = { config: { provider: PROVIDER_ID, model: MODEL_ID, reasoningEffort: 'xhigh', maxTokens: 3000 }, adapterDefaults: {} }
  assert.deepEqual(generationControlsFromHeader(rootHeader, rootRoute), { reasoningEffort: 'high', maxTokens: 1000 })
  assert.deepEqual(generationControlsFromHeader(childHeader, childRoute), { reasoningEffort: 'xhigh', maxTokens: 3000 })
  assert.equal(promptCacheSessionId(rootRoute, { cacheRetention: 'long' }, ctx), root.id)
  assert.equal(promptCacheSessionId(childRoute, { cacheRetention: 'long' }, ctx), root.id)
})

async function projectedInput(messages) {
  const serialized = await serializeDshMessages(messages, {
    llm: { fileRequestText: ref => `[file:${ref.name}]` },
  }, {
    imageSupport: 'unsupported',
    route: { provider: PROVIDER_ID, model: MODEL_ID, baseURL: BASE_URL },
  })
  return serialized.input
}

test('generic file-only user content remains model-visible', async () => {
  const input = await projectedInput([
    { role: 'user', content: [{ type: 'file', attachment: { name: 'only.txt' } }] },
  ])
  assert.match(JSON.stringify(input), /\[file:only\.txt\]/u)
})

test('generic file projection preserves text, multiple files, and nested tool results', async () => {
  const input = await projectedInput([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'before' },
        { type: 'file', attachment: { name: 'one.txt' } },
        { type: 'file', attachment: { name: 'two.csv' } },
        {
          type: 'tool-result', toolCallId: 'call_files', toolName: 'read',
          content: [
            { type: 'text', text: 'nested' },
            { type: 'file', attachment: { name: 'nested.json' } },
          ],
        },
      ],
    },
  ])
  const wire = JSON.stringify(input)
  for (const expected of ['before', '[file:one.txt]', '[file:two.csv]', 'nested', '[file:nested.json]'])
    assert.equal(wire.includes(expected), true, `wire output must include ${expected}`)
})

test('unrecognized DSH content fails closed rather than disappearing', async () => {
  await assert.rejects(
    projectedInput([{ role: 'user', content: [{ type: 'future-extension', value: 'unsafe' }] }]),
    error => error?.code === 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT',
  )
})

test('Session-v2 custom checkpoint is emitted as a DSH content block', () => {
  const block = {
    type: 'lcx-native-compaction-v5',
    version: 5,
    retentionPolicy: 'conversation-fidelity-v1',
    compactionId: 'checkpoint-v2-fixture',
    provider: PROVIDER_ID,
    model: MODEL_ID,
    baseURLFingerprint: 'f'.repeat(64),
    sourceSessionId: SESSION_ID,
    nativeOutput: [],
  }
  const chunks = nativeCheckpointChunks(block, undefined)
  assert.deepEqual(chunks[3], {
    type: 'block-start', index: 1, blockType: 'lcx-native-compaction-v5',
  })
  assert.deepEqual(chunks[4], {
    type: 'block-end', index: 1, block,
  })
})
