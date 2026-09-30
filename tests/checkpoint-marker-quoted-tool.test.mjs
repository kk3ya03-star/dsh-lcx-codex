import test from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as checkpoint from '../lib/native-checkpoint.js'
import { queryContext } from './session-query-fixture.mjs'

// Sanitized structure of QA batch 2: two native summaries, then a source-file
// excerpt returned by a tool. No real checkpoint bytes or provider calls.
test('quoted legacy marker in a DSH 0.2 tool result does not invalidate native or portable replay', async () => {
  const id = SessionId('session-qa-marker-fixture')
  const session = Session.create(id)
  const opaque = 'FAKE-OPAQUE-PLACEHOLDER-NOT-REAL-STATE'
  const appendUser = text => session.append('user/message',
    createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }),
    { surfaceOp: 'append' })
  const compact = (cid, shadowedSeqs) => {
    const start = session.append('compaction/start', { compactionId: cid, turn: null })
    const summary = session.append('compaction/summary', {
      compactionId: cid, shadowedSeqs,
      shadowedRange: { start: shadowedSeqs[0], end: shadowedSeqs.at(-1) },
      shadowedTokenCount: shadowedSeqs.length,
      summary: [{ type: 'text', text: 'summary' }],
      rawOutput: [{ type: 'text', text: 'summary' }, {
        type: checkpoint.NATIVE_BLOCK_TYPE, version: 5, compactionId: cid,
        provider: 'lcx', model: 'gpt-fixture', baseURLFingerprint: 'fixture',
        sourceSessionId: String(id), retainedInputCount: 0,
        retainedClientCount: 0, retainedAssistantCount: 0,
        nativeOutput: [{ type: 'compaction', encrypted_content: opaque }],
      }], provider: 'lcx', model: 'gpt-fixture',
    })
    session.append('user/message', createUserMessage({
      source: compactCheckpointSource(cid), content: [{ type: 'text', text: 'checkpoint' }],
    }), { surfaceOp: { op: 'replace', startSeq: shadowedSeqs[0], endSeq: shadowedSeqs.at(-1) }, sourceEventSeqs: [start.seq, summary.seq, ...shadowedSeqs] })
    session.append('compaction/end', { compactionId: cid, turn: null })
  }
  appendUser('initial turn')
  compact('cmp-1', [...session.surface.nodes])
  appendUser('continued turn')
  compact('cmp-2', [...session.surface.nodes])
  const excerpt = 'line 1: source example\nline 2: [dsh-lcx-codex-v3-checkpoint:fixture-id]\nline 3: more source'
  session.append('tool/result', {
    turn: 3, step: 2,
    message: createToolResultMessage({ callId: 'call-read', content: [{ type: 'text', text: excerpt }], isError: false }),
  }, { surfaceOp: 'append' })

  const restored = Session.fromRestore(id, session.snapshotEvents(), session.header, 0, 'detached', [])
  const surface = restored.deriveMessages()
  const replacement = surface.find(message => checkpoint.compactCheckpointId(message) === 'cmp-2')
  const tool = surface.find(message => message.role === 'tool')
  assert.ok(replacement)
  assert.ok(tool)
  assert.equal(checkpoint.stateFromSummaryEvent(await checkpoint.compactionSummaryEvent(queryContext(restored), restored, 'cmp-2')).version, 5)
  assert.doesNotThrow(() => checkpoint.assertSupportedCheckpointMessage(tool))
  assert.equal((await checkpoint.checkpointStateForMessage(queryContext(restored), restored, replacement)).version, 5)
  const portable = await checkpoint.portableMessagesForCheckpoint(queryContext(restored), restored, 'cmp-2')
  assert.ok(portable.length > 0)
  assert.deepEqual(surface.map(message => { checkpoint.assertSupportedCheckpointMessage(message); return message.role }), ['user', 'tool'])
  assert.throws(() => checkpoint.assertSupportedCheckpointMessage({
    role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '[dsh-lcx-codex-v3-checkpoint:fixture-id]' }],
  }), { code: 'LCX_CHECKPOINT_UNSUPPORTED' })
})
