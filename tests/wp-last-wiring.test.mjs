import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import QuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import { compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { loadHostSource } from './wp2-source.mjs'

const [host, checkpoint] = await Promise.all([
  loadHostSource('index'), loadHostSource('native-checkpoint'),
])

async function mountedHost(withQuery) {
  const root = new Context()
  await root.plugin(Sessions)
  for (const name of host.inject) {
    if (name === 'sessions') continue
    root.provide(name, name === 'settings' ? { configure: () => () => {} } : {})
  }
  const backend = withQuery
    ? root.plugin(QuerySqlite, { path: ':memory:', openAt: 'never' })
    : undefined
  if (backend) await backend
  const fiber = root.plugin(host.apply, {
    alphaCapabilityPath: 'unused', alphaRefPath: 'unused',
  })
  await fiber
  assert.equal(fiber.state, 2, `LCX activated with its declared injection list: ${String(fiber.error)}; ${host.inject.map(name => `${name}:${root.get(name) !== undefined}`).join(', ')}`)
  assert.equal(host.inject.includes('sessionQuery'), false)
  return { root, fiber, backend }
}

test('WIRING: real Cordis LCX context resolves optional live session query and fails closed without it', async () => {
  const present = await mountedHost(true)
  const absent = await mountedHost(false)
  try {
    const session = present.root.sessions.prepare(SessionId('wp-last-wiring'), { meta: { cwd: process.cwd() } })
    const detach = present.root.sessions.enter(session)
    try {
      present.root.sessions.announce(session)
      const compactionId = 'wiring-compact'
      const first = session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'before' }] }), { surfaceOp: 'append' })
      const start = session.append('compaction/start', { compactionId, turn: null })
      const summary = session.append('compaction/summary', {
        compactionId, shadowedSeqs: [first.seq], shadowedRange: { start: first.seq, end: first.seq },
        shadowedTokenCount: 1, summary: [{ type: 'text', text: 'summary' }],
        rawOutput: [{ type: 'text', text: 'summary' }, {
          type: checkpoint.NATIVE_BLOCK_TYPE, version: 5, compactionId,
          provider: 'lcx', model: 'gpt-fixture', baseURLFingerprint: 'fixture',
          sourceSessionId: String(session.id),
          nativeOutput: [{ type: 'compaction', encrypted_content: 'FAKE-OPAQUE-PLACEHOLDER' }],
        }], provider: 'lcx', model: 'gpt-fixture',
      })
      session.append('user/message', createUserMessage({
        source: compactCheckpointSource(compactionId),
        content: [{ type: 'text', text: 'checkpoint' }],
      }), { surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: first.seq }, sourceEventSeqs: [start.seq, summary.seq, first.seq] })
      session.append('compaction/end', { compactionId, turn: null })
      const message = session.deriveMessages().find(item => checkpoint.compactCheckpointId(item) === compactionId)
      assert.ok(message, 'checkpoint is on the real compacted session surface')
      assert.equal(typeof present.fiber.ctx.get, 'function')
      assert.equal(typeof present.fiber.ctx.get('sessionQuery')?.observeSession, 'function')
      assert.throws(() => present.fiber.ctx.sessionQuery, /without inject/, 'undeclared service is unavailable as a context property')
      assert.deepEqual(await checkpoint.compactionSummaryEvent(present.fiber.ctx, session, compactionId), summary)
      assert.equal((await checkpoint.checkpointStateForMessage(present.fiber.ctx, session, message)).compactionId, compactionId)
      assert.equal(absent.fiber.ctx.get('sessionQuery'), undefined)
      await assert.rejects(checkpoint.checkpointStateForMessage(absent.fiber.ctx, session, message), {
        code: 'LCX_SESSION_QUERY_UNAVAILABLE',
      })
    } finally { detach() }
  } finally {
    present.fiber.dispose()
    absent.fiber.dispose()
    present.backend?.dispose()
  }
})
