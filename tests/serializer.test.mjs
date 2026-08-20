import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  offloadDshRequestImages,
  resolveModelImageSupport,
  serializeDshResponsesInput,
} from '../lib/dsh-pi-responses.js'

const route = {
  provider: 'lcx',
  model: 'gpt-5.6-sol',
  baseURL: 'https://api.lcxbot.com/v1',
  sessionId: 'serializer-test',
}

function replaySource(blocks, overrides = {}) {
  return {
    kind: 'model',
    provider: route.provider,
    model: route.model,
    replayState: {
      response: {
        kind: 'pi-ai',
        version: 2,
        api: 'openai-responses',
        provider: route.provider,
        model: route.model,
        stopReason: 'toolUse',
        ...overrides,
      },
      blocks,
    },
  }
}

test('Pi serializer restores native reasoning, message identity, phase, and tool linkage from DSH replayState v2', async () => {
  const reasoning = {
    type: 'reasoning',
    id: 'rs_test',
    summary: [],
    encrypted_content: 'fixture-opaque-reasoning',
  }
  const messages = [
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: '' },
        { type: 'text', text: 'answer' },
        { type: 'tool-call', id: 'call_test|fc_test', name: 'lookup', arguments: '{"q":"x"}' },
      ],
      source: replaySource([
        { type: 'reasoning', thinkingSignature: JSON.stringify(reasoning) },
        { type: 'text', textSignature: JSON.stringify({ v: 1, id: 'msg_test', phase: 'final_answer' }) },
        { type: 'tool-call' },
      ]),
    },
    {
      role: 'user',
      content: [{
        type: 'tool-result',
        toolCallId: 'call_test|fc_test',
        content: [{ type: 'text', text: 'tool output' }],
      }],
    },
  ]

  assert.deepEqual(await serializeDshResponsesInput(messages, { route, imageSupport: 'supported' }), [
    reasoning,
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'answer', annotations: [] }],
      status: 'completed',
      id: 'msg_test',
      phase: 'final_answer',
    },
    {
      type: 'function_call',
      id: 'fc_test',
      call_id: 'call_test',
      name: 'lookup',
      arguments: '{"q":"x"}',
    },
    { type: 'function_call_output', call_id: 'call_test', output: 'tool output' },
  ])
})

test('invalid replayState degrades only that assistant message and reports a safe diagnostic', async () => {
  const diagnostics = []
  const input = await serializeDshResponsesInput([{
    role: 'assistant',
    content: [{ type: 'text', text: 'durable answer' }],
    source: replaySource([], { version: 1 }),
  }], {
    route,
    imageSupport: 'supported',
    onReplayDegrade: (reason) => diagnostics.push(reason),
  })

  assert.equal(diagnostics.length, 1)
  assert.match(diagnostics[0], /unsupported version/u)
  assert.equal(input.length, 1)
  assert.equal(input[0].type, 'message')
  assert.equal(input[0].content[0].text, 'durable answer')
  assert.equal(JSON.stringify(input).includes('replayState'), false)
})

test('Pi serializer hydrates user and tool-result images for an image-capable target', async () => {
  const input = await serializeDshResponsesInput([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'inspect' },
        { type: 'image', attachment: { attachmentId: 'sha256:test-user', mediaType: 'image/png' } },
      ],
    },
    {
      role: 'user',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-image',
        content: [{ type: 'image', attachment: { attachmentId: 'sha256:test-tool', mediaType: 'image/png' } }],
      }],
    },
  ], {
    route,
    imageSupport: 'supported',
    resolveImage: async () => ({ data: Uint8Array.from([1, 2, 3]), mediaType: 'image/png' }),
  })

  assert.deepEqual(input[0].content, [
    { type: 'input_text', text: 'inspect' },
    { type: 'input_image', image_url: 'data:image/png;base64,AQID' },
  ])
  assert.deepEqual(input[1], {
    type: 'function_call_output',
    call_id: 'call-image',
    output: [{ type: 'input_image', image_url: 'data:image/png;base64,AQID' }],
  })
})

test('Pi serializer applies the rc.8 image limit to base64 payload length', async () => {
  await assert.rejects(
    serializeDshResponsesInput([{
      role: 'user',
      content: [{ type: 'image', attachment: { attachmentId: 'sha256:test-boundary', mediaType: 'image/png' } }],
    }], {
      route,
      imageSupport: 'supported',
      maxRequestImageBytes: 4,
      resolveImage: async () => ({ data: Uint8Array.from([1, 2, 3, 4]), mediaType: 'image/png' }),
    }),
    { code: 'LCX_COMPACT_IMAGE_TOO_LARGE' },
  )
})

test('Pi serializer uses visible placeholders for a non-image target and fails closed when capability is unknown', async () => {
  const messages = [{
    role: 'user',
    content: [
      { type: 'image', attachment: { attachmentId: 'sha256:test', mediaType: 'image/png' } },
      {
        type: 'tool-result',
        toolCallId: 'call-image',
        content: [{ type: 'image', attachment: { attachmentId: 'sha256:test-tool', mediaType: 'image/png' } }],
      },
    ],
  }]
  const input = await serializeDshResponsesInput(messages, { route, imageSupport: 'unsupported' })
  assert.equal(input[0].content[0].text, '(image omitted: model does not support images)')
  assert.equal(input[1].output, '(tool image omitted: model does not support images)')
  await assert.rejects(
    serializeDshResponsesInput(messages, { route, imageSupport: 'unknown' }),
    { code: 'LCX_COMPACT_IMAGE_CAPABILITY_UNKNOWN' },
  )
})

test('target image capability is resolved from the public DSH model metadata seam', async () => {
  assert.equal(await resolveModelImageSupport({
    resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }),
  }, route), 'supported')
  assert.equal(await resolveModelImageSupport({
    resolveModelInfo: async () => ({ inputModalities: ['text'] }),
  }, route), 'unsupported')
  assert.equal(await resolveModelImageSupport({
    resolveModelInfo: async () => ({}),
  }, route), 'unknown')
  assert.equal(await resolveModelImageSupport({}, route), 'unknown')
})

test('image request offload follows rc.8 default bound and replaces oldest images visibly', () => {
  assert.equal(DEFAULT_MAX_REQUEST_IMAGE_BYTES, 20 * 1024 * 1024)
  const messages = [{
    role: 'user',
    content: [
      { type: 'image', attachment: { bytes: 12 * 1024 * 1024, mediaType: 'image/png' } },
      { type: 'text', text: 'keep this context' },
      { type: 'image', attachment: { bytes: 12 * 1024 * 1024, mediaType: 'image/png' } },
    ],
  }]
  const offloaded = offloadDshRequestImages(messages)
  assert.equal(offloaded[0].content[0].type, 'text')
  assert.match(offloaded[0].content[0].text, /image omitted/u)
  assert.equal(offloaded[0].content[2].type, 'image')
  assert.equal(messages[0].content[0].type, 'image')
})

test('image offload handles nested tool results, exact bounds, and immutable input', () => {
  const first = { type: 'image', attachment: { bytes: 3, mediaType: 'image/png' } }
  const second = { type: 'image', attachment: { bytes: 3, mediaType: 'image/png' } }
  const messages = [{
    role: 'user',
    content: [{ type: 'tool-result', toolCallId: 'call-1', content: [first, second] }],
  }]

  assert.equal(offloadDshRequestImages(messages, 8), messages)
  const offloaded = offloadDshRequestImages(messages, 4)
  assert.equal(offloaded[0].content[0].content[0].type, 'text')
  assert.equal(offloaded[0].content[0].content[1], second)
  assert.equal(messages[0].content[0].content[0], first)
  assert.throws(() => offloadDshRequestImages(messages, 0), { code: 'LCX_COMPACT_IMAGE_LIMIT_INVALID' })
})
