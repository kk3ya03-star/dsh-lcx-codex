import test from 'node:test'
import assert from 'node:assert/strict'
import { createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, ToolCallRecovery, buildForkSeed, interruptedTurnClosers } from '@deepseek-ai/dsh-session'
import { loadHostSource } from './wp2-source.mjs'

const { serializeDshMessages } = await loadHostSource('dsh-responses')
const { modelVisibleBudgetView } = await loadHostSource('token-budget')
const route = { provider: 'lcx', model: 'gpt-5.6-sol', baseURL: 'https://fixture.invalid/v1' }

function assistant(...calls) {
  return createAssistantMessage({
    content: calls.map(([id, name]) => ({ type: 'tool-call', id, name, arguments: '{}' })),
    source: { provider: route.provider, model: route.model },
  })
}

async function outputs(messages, options = {}) {
  const serialized = await serializeDshMessages(messages, options.ctx, { route, imageSupport: options.imageSupport ?? 'unsupported' })
  assert.equal(serialized.input.filter(item => item.role === 'user').length, 0)
  return serialized.input.filter(item => item.type === 'function_call_output')
}

test('real DSH tool messages pair multi-step text and errors by call id', async () => {
  const history = [
    assistant(['call-1', 'read'], ['call-2', 'run']),
    createToolResultMessage({ callId: 'call-1', content: [{ type: 'text', text: 'actual first result' }], isError: false }),
    createToolResultMessage({ callId: 'call-2', content: [{ type: 'text', text: 'actual error result' }], isError: true }),
    assistant(['call-3', 'read']),
    createToolResultMessage({ callId: 'call-3', content: [{ type: 'text', text: 'actual third result' }], isError: false }),
  ]
  const actual = await outputs(history)
  assert.deepEqual(actual.map(item => item.call_id), ['call-1', 'call-2', 'call-3'])
  assert.deepEqual(actual.map(item => item.output), ['actual first result', 'actual error result', 'actual third result'])
  assert.doesNotMatch(JSON.stringify(actual), /No result provided/)
  assert.deepEqual(modelVisibleBudgetView(history[1]), {
    role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: 'actual first result' }],
  })
})

test('real DSH tool image result remains function_call_output image content', async () => {
  const ref = { attachmentId: 'sha256:fixture', mediaType: 'image/png', bytes: 3, width: 1, height: 1 }
  const ctx = {
    attachments: {
      imageHostPath: () => 'C:/fixture.png',
      readImageRequest: async () => ({ variantId: 'fixture', attachment: ref, data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', bytes: 3, width: 1, height: 1, depth: 'uchar', space: 'srgb', hasAlpha: false }),
    },
    fs: { processPathFromHostPath: () => '/fixture.png' },
    get(name) { return this[name] },
  }
  const result = createToolResultMessage({ callId: 'call-image', content: [{ type: 'text', text: 'image ready' }, { type: 'image', attachment: ref }], isError: false })
  const actual = await outputs([assistant(['call-image', 'read_image']), result], { ctx, imageSupport: 'supported' })
  assert.equal(actual.length, 1)
  assert.equal(actual[0].call_id, 'call-image')
  assert.match(JSON.stringify(actual[0].output), /image ready/)
  assert.match(JSON.stringify(actual[0].output), /data:image\/png;base64,AQID/)
})

test('real session repair and fork closers retain their synthetic tool output', async () => {
  const session = Session.create(SessionId('wp3-recovery'))
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', { turn: 1, step: 1, message: assistant(['call-recover', 'read']) }, { surfaceOp: 'append' })
  const events = session.snapshotEvents()
  const repair = interruptedTurnClosers(events).find(event => event.type === 'tool/result')
  const fork = buildForkSeed(events, events.at(-1).seq).find(event => event.type === 'tool/result')
  assert.ok(repair)
  assert.ok(fork)
  for (const closer of [repair, fork]) {
    assert.equal(closer.data.message.role, 'tool')
    const actual = await outputs([assistant(['call-recover', 'read']), closer.data.message])
    assert.equal(actual[0].call_id, 'call-recover')
    assert.match(actual[0].output, /tool call|history inherited/i)
    assert.doesNotMatch(actual[0].output, /No result provided/)
  }
  const recovery = new ToolCallRecovery()
  for (const event of events) recovery.observe(event)
  assert.equal(recovery.results()[0].data.message.toolCallId, 'call-recover')
})

test('unsupported budget blocks and serializer tool updates fail with typed errors', async () => {
  const future = { role: 'user', content: [{ type: 'future-content', value: 1 }] }
  assert.throws(() => modelVisibleBudgetView(future), error => error.code === 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT')
  await assert.rejects(serializeDshMessages([future], undefined, { route }), error => error.code === 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT')
  await assert.rejects(serializeDshMessages([], undefined, { route, tools: [{ name: 'later', deferLoading: true }] }), error => error.code === 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT')
})
