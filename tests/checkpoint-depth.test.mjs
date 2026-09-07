import test from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { portableMessagesForCheckpoint, stateFromSummaryEvent } from '../lib/native-checkpoint.js'
import { parseHostedSearchResponse } from '../lib/web-search-hosted.js'

test('portable replay preserves history after 25 real DSH compaction replacements', () => {
  const session = Session.create(SessionId('checkpoint-depth'))
  let previous = session.append('user/message', { role: 'user', id: 'initial', source: { kind: 'user' }, content: [{ type: 'text', text: 'original decision' }] }, { surfaceOp: 'append' }).seq
  for (let i = 0; i < 25; i++) {
    const id = `checkpoint-${i}`
    const start = session.append('compaction/start', { compactionId: id, turn: null })
    const summary = session.append('compaction/summary', { compactionId: id, shadowedSeqs: [previous], shadowedRange: { start: previous, end: previous }, shadowedTokenCount: 10, summary: 'checkpoint', provider: 'fixture', model: 'gpt-fixture' })
    previous = session.append('user/message', { role: 'user', id, source: compactCheckpointSource(id), content: [{ type: 'text', text: 'checkpoint' }] }, {
      surfaceOp: { op: 'replace', start: previous, end: previous }, sourceEventSeqs: [start.seq, summary.seq, previous],
    }).seq
    session.append('compaction/end', { compactionId: id, turn: null })
  }
  assert.equal(session.surface.nodes.length, 1)
  assert.equal(portableMessagesForCheckpoint(session, 'checkpoint-24')[0].content[0].text, 'original decision')
  assert.throws(() => portableMessagesForCheckpoint(session, 'missing'), { code: 'LCX_CHECKPOINT_UNSUPPORTED' })
})

test('portable replay rejects cyclic checkpoint references rather than dropping them', () => {
  const summary = { type: 'compaction/summary', data: { compactionId: 'cycle', shadowedSeqs: [0] } }
  const session = { snapshotEvents: () => [summary], eventAt: () => ({}), deriveEventMessage: () => ({ role: 'user', source: compactCheckpointSource('cycle'), content: [] }) }
  assert.throws(() => portableMessagesForCheckpoint(session, 'cycle'), { code: 'LCX_CHECKPOINT_UNSUPPORTED' })
})

test('restoration rejects empty opaque state and malformed additional native items', () => {
  const block = { type: 'lcx-native-compaction-v5', version: 5, compactionId: 'id', provider: 'fixture', model: 'gpt-fixture', baseURLFingerprint: 'fixture', sourceSessionId: 'fixture' }
  for (const nativeOutput of [
    [{ type: 'compaction', encrypted_content: '' }],
    [{ type: 'compaction', encrypted_content: '   ' }],
    [{ type: 'compaction', encrypted_content: 'synthetic' }, { type: 'compaction', encrypted_content: 42 }],
    [{ type: 'compaction', encrypted_content: 'synthetic' }, { type: 'compaction', encrypted_content: '' }],
    [{ type: 'compaction', encrypted_content: 'synthetic' }, { type: 'unsupported' }],
  ]) assert.equal(stateFromSummaryEvent({ type: 'compaction/summary', data: { compactionId: 'id', rawOutput: [{ ...block, nativeOutput }] } }), undefined)
})

test('outer completed Hosted responses cannot mask unfinished search calls', () => {
  for (const status of ['failed', 'in_progress', 'searching', 'incomplete']) {
    assert.throws(() => parseHostedSearchResponse({ status: 'completed', output: [
      { type: 'web_search_call', status, action: { type: 'search' } },
      { type: 'message', content: [{ type: 'output_text', text: 'Search failed', annotations: [] }] },
    ] }, 'fixture'), { code: 'LCX_WEB_PROVIDER_ERROR' })
  }
})
