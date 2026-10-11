import test from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { portableMessagesForCheckpoint } from '../lib/native-checkpoint.js'
import { serializeDshMessages } from '../lib/dsh-responses.js'
import { queryContext } from './session-query-fixture.mjs'

// Issue 119 item 3: `groupMessages` left the cursor in front of the tool results it had already put into
// an incomplete group, so portable replay (fork / route migration) rendered them a second time and, under a
// tight budget, could start the replay with a tool result whose call was cut off. The sessions below are
// real DSH sessions with real compaction events.

const call = (id) => ({ type: 'tool-call', id: ToolCallId(id), name: 'probe_tool', arguments: '{}' })
let counter = 0

/**
 * user, assistant(calls), results, optional user messages, user, all shadowed by one compaction.
 * `results` entries may be `[id, afterBetween]` to place a result after the `between` messages.
 */
function sessionWith({ calls, results, late = [], between = [] }) {
  const session = Session.create(SessionId(`i119-groups-${counter++}`))
  const seqs = []
  const user = (text) => seqs.push(session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' }).seq)
  const result = (id) => seqs.push(session.append('tool/result', {
    turn: 1, step: 1,
    message: createToolResultMessage({ callId: ToolCallId(id), content: [{ type: 'text', text: `result-${id} ${'x'.repeat(200)}` }], isError: false }),
  }, { surfaceOp: 'append' }).seq)
  user('go')
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  seqs.push(session.append('assistant/message', {
    turn: 1, step: 1,
    message: createAssistantMessage({ source: { provider: 'lcx', model: 'gpt-fixture' }, content: calls.map(call) }),
  }, { surfaceOp: 'append' }).seq)
  for (const id of results) result(id)
  for (const text of between) user(text)
  for (const id of late) result(id)
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  user('next')
  const start = session.append('compaction/start', { compactionId: 'c1', turn: null })
  const summary = session.append('compaction/summary', {
    compactionId: 'c1', shadowedSeqs: seqs, shadowedRange: { start: seqs[0], end: seqs.at(-1) },
    shadowedTokenCount: seqs.length, summary: [{ type: 'text', text: 'summary' }], provider: 'lcx', model: 'gpt-fixture',
  })
  session.append('user/message', createUserMessage({ source: compactCheckpointSource('c1'), content: [{ type: 'text', text: 'checkpoint' }] }), {
    surfaceOp: { op: 'replace', startSeq: seqs[0], endSeq: seqs.at(-1) }, sourceEventSeqs: [start.seq, summary.seq, ...seqs],
  })
  session.append('compaction/end', { compactionId: 'c1', turn: null })
  return session
}

const shape = (messages) => messages.map((m) => m.role === 'tool'
  ? `tool:${m.toolCallId}`
  : m.role === 'assistant'
    ? `assistant:${m.content.filter((b) => b.type === 'tool-call').map((b) => b.id).join(',')}`
    : m.role)
const portableOf = (session, maxChars = 100000) => portableMessagesForCheckpoint(queryContext(session), session, 'c1', { maxChars })

/** Every tool result must follow a message that issued its call. */
function assertNoOrphans(messages) {
  const issued = new Set()
  for (const message of messages) {
    if (message.role === 'assistant') for (const block of message.content) if (block.type === 'tool-call') issued.add(String(block.id))
    if (message.role === 'tool') assert.ok(issued.has(String(message.toolCallId)), `tool result ${message.toolCallId} has no call before it in ${shape(messages)}`)
  }
}

test('an incomplete tool-call group is replayed once, with the results it has', async () => {
  const session = sessionWith({ calls: ['A', 'B'], results: ['A'] })
  const portable = await portableOf(session)
  assert.deepEqual(shape(portable), ['user', 'assistant:A,B', 'tool:A', 'user'])
  const wire = await serializeDshMessages(portable, {}, { model: { id: 'gpt-5.6-sol', provider: 'openai', api: 'openai-responses', reasoning: true, input: ['text'] }, imageSupport: 'unsupported' })
  const outputs = wire.input.filter((item) => item.type === 'function_call_output').map((item) => item.call_id)
  const calls = wire.input.filter((item) => item.type === 'function_call').map((item) => item.call_id)
  assert.equal(new Set(outputs).size, outputs.length, `a call id has two outputs: ${outputs}`)
  assert.deepEqual([...outputs].sort(), [...calls].sort(), 'every call has exactly one output')
})

test('a complete group and a call without results stay as they were', async () => {
  const complete = sessionWith({ calls: ['A', 'B'], results: ['A', 'B'] })
  assert.deepEqual(shape(await portableOf(complete)), ['user', 'assistant:A,B', 'tool:A', 'tool:B', 'user'])
  const none = sessionWith({ calls: ['A'], results: [] })
  assert.deepEqual(shape(await portableOf(none)), ['user', 'assistant:A', 'user'])
})

test('budget truncation never leaves a tool result without its call', async () => {
  for (const [label, session] of [
    ['incomplete group', sessionWith({ calls: ['A', 'B'], results: ['A'] })],
    ['complete group', sessionWith({ calls: ['A', 'B'], results: ['A', 'B'] })],
    ['late result after other messages', sessionWith({ calls: ['A', 'B'], results: ['A'], between: ['aside'], late: ['B'] })],
  ]) {
    let truncated = false
    for (let maxChars = 100; maxChars <= 2400; maxChars += 50) {
      let portable
      try {
        portable = await portableOf(session, maxChars)
      } catch (error) {
        assert.match(String(error.code), /LCX_/u, `${label}: ${error.message}`)
        continue
      }
      assertNoOrphans(portable)
      if (portable.length > 0 && portable.length < 4) truncated = true
    }
    assert.ok(truncated, `${label}: the sweep exercised at least one truncated replay`)
  }
})

test('a tool result that no call can claim is dropped from portable replay', async () => {
  // Result B arrives after an unrelated user message, so it cannot join the group of its call.
  const session = sessionWith({ calls: ['A', 'B'], results: ['A'], between: ['aside'], late: ['B'] })
  const portable = await portableOf(session)
  assertNoOrphans(portable)
  assert.deepEqual(shape(portable), ['user', 'assistant:A,B', 'tool:A', 'user', 'user'])
})
