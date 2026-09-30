import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import QuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import { compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import apply from '../lib/index.js'
import * as cp from '../lib/native-checkpoint.js'

const opaque = 'FAKE-OPAQUE-PLACEHOLDER-NOT-REAL-STATE'
const route = id => ({ provider: 'lcx', model: 'gpt-fixture', baseURL: 'https://fixture.invalid/v1', sessionId: id })
const block = (cid, id) => ({
  type: cp.NATIVE_BLOCK_TYPE, version: 5, compactionId: cid, provider: 'lcx', model: 'gpt-fixture',
  baseURLFingerprint: 'fixture', sourceSessionId: id,
  nativeOutput: [{ type: 'compaction', encrypted_content: opaque }],
  nativeCompaction: { type: 'compaction', encrypted_content: opaque },
})

// Reduced-size version of Step 0(d)'s build-sessions fixture shape: real Session,
// JSONL writer, replacement surface nodes, and nested compactions.
async function fixture(turns, count, query = true) {
  const root = await mkdtemp(join(tmpdir(), 'lcx-query-'))
  const ctx = new Context()
  ctx.plugin(Sessions)
  ctx.plugin(Jsonl, { root: join(root, 'sessions') })
  const backend = query ? ctx.plugin(QuerySqlite, { path: ':memory:', openAt: 'never' }) : undefined
  await new Promise(r => setTimeout(r, 80))
  const id = SessionId(`wp-last-${turns}-${count}`)
  const session = ctx.sessions.prepare(id, { meta: { cwd: root } })
  await ctx.sessionPersistence.create(session.header)
  const detach = ctx.sessions.enter(session)
  ctx.sessions.announce(session)
  const checkpoints = []
  const at = Array.from({ length: count }, (_, i) => Math.floor(turns * (i + 1) / (count + 1)))
  for (let i = 0; i < turns; i++) {
    session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `turn ${i}` }] }), { surfaceOp: 'append' })
    if (at.includes(i)) {
      const seqs = [...session.surface.nodes.slice(0, -1)]
      const cid = `cmp-${i}`
      const start = session.append('compaction/start', { compactionId: cid, turn: null })
      const summary = session.append('compaction/summary', {
        compactionId: cid, shadowedSeqs: seqs, shadowedRange: { start: seqs[0], end: seqs.at(-1) },
        shadowedTokenCount: seqs.length, summary: [{ type: 'text', text: 'summary' }],
        rawOutput: [{ type: 'text', text: 'summary' }, block(cid, String(id))], provider: 'lcx', model: 'gpt-fixture',
      })
      session.append('user/message', createUserMessage({ source: compactCheckpointSource(cid), content: [{ type: 'text', text: 'checkpoint' }] }),
        { surfaceOp: { op: 'replace', startSeq: seqs[0], endSeq: seqs.at(-1) }, sourceEventSeqs: [start.seq, summary.seq, ...seqs] })
      session.append('compaction/end', { compactionId: cid, turn: null })
      checkpoints.push(cid)
    }
  }
  await ctx.sessions.flush(session)
  await ctx.sessionPersistence.flush()
  const writer = await ctx.sessionPersistence.open(String(id), 'read')
  const persisted = await writer.read()
  await writer.close()
  assert.equal(persisted.events.length, session.snapshotEvents().length)
  return { root, ctx, backend, session, checkpoints, detach, async close() { detach(); await rm(root, { recursive: true, force: true }) } }
}

function oldActive(session) {
  const ended = new Set()
  for (const e of [...session.snapshotEvents()].reverse()) {
    if (e.type === 'compaction/end') ended.add(String(e.data.compactionId))
    if (e.type === 'compaction/start' && !ended.has(String(e.data.compactionId))) return String(e.data.compactionId)
  }
}
function oldSummary(session, cid) {
  return [...session.snapshotEvents()].reverse().find(e => e.type === 'compaction/summary' && String(e.data.compactionId) === cid)
}
function oldExpanded(session, cid) {
  const summaries = new Map(session.snapshotEvents().filter(e => e.type === 'compaction/summary').map(e => [String(e.data.compactionId), e]))
  const active = new Set(), result = []
  const visit = id => {
    if (active.has(id) || !summaries.has(id)) throw Error('incomplete')
    active.add(id)
    for (const seq of summaries.get(id).data.shadowedSeqs) {
      const e = session.eventAt(seq)
      const m = session.deriveEventMessage(e)
      if (!m) continue
      const nested = cp.compactCheckpointId(m)
      if (nested) visit(nested)
      else result.push(structuredClone(m))
    }
    active.delete(id)
  }
  visit(cid)
  return result
}
function spy(ctx) {
  let calls = 0, disposed = 0
  const forbidden = ['readEvent', 'readSurface', 'readSession', 'listEvents', 'filterEvents', 'listSessions']
  const service = {
    async observeSession(id, options) {
      calls++
      assert.deepEqual(options, { projectionMode: 'none' })
      const lease = await ctx.sessionQuery.observeSession(id, options)
      return { events: lease.events, [Symbol.dispose]() { disposed++; lease[Symbol.dispose]() } }
    },
  }
  for (const name of forbidden) service[name] = () => assert.fail(`${name} called`)
  return { context: { get: name => name === 'sessionQuery' ? service : undefined }, counts: () => [calls, disposed] }
}

test('nine real v4 fixture shapes preserve all four deprecated-read results with one disposed lease', async () => {
  for (const turns of [12, 40, 100]) for (const count of [0, 1, 3]) {
    const f = await fixture(turns, count)
    try {
      const { context, counts } = spy(f.ctx)
      const last = f.checkpoints.at(-1)
      const message = f.session.deriveMessages().find(m => cp.compactCheckpointId(m))
      if (message) {
        const cid = cp.compactCheckpointId(message)
        assert.deepEqual(await cp.compactionSummaryEvent(context, f.session, cid), oldSummary(f.session, cid))
        assert.deepEqual(await cp.checkpointStateForMessage(context, f.session, message), cp.stateFromSummaryEvent(oldSummary(f.session, cid)))
        assert.deepEqual(await cp.shadowedMessagesForCheckpoint(context, f.session, last), oldExpanded(f.session, last))
        assert.deepEqual(await cp.portableMessagesForCheckpoint(context, f.session, last, { maxChars: 100000 }), oldExpanded(f.session, last))
      } else {
        assert.equal(cp.checkpointStateForMessage({}, f.session, f.session.deriveMessages()[0]), undefined)
      }
      f.session.append('compaction/start', { compactionId: 'open', turn: null })
      assert.equal(await cp.activeCompactionId(context, f.session), oldActive(f.session))
      assert.deepEqual(counts(), [count ? 5 : 1, count ? 5 : 1])
    } finally { await f.close() }
  }
})

test('absent and disposed backend fail closed only on checkpoint reads; plugin still activates', async () => {
  const f = await fixture(12, 1)
  try {
    const m = f.session.deriveMessages().find(x => cp.compactCheckpointId(x))
    const cid = cp.compactCheckpointId(m)
    for (const context of [{ get: () => undefined }]) {
      assert.equal(cp.checkpointStateForMessage(context, f.session, createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'ordinary' }] })), undefined)
      await assert.rejects(cp.checkpointStateForMessage(context, f.session, m), { code: 'LCX_SESSION_QUERY_UNAVAILABLE' })
      await assert.rejects(cp.activeCompactionId(context, f.session), { code: 'LCX_SESSION_QUERY_UNAVAILABLE' })
      await assert.rejects(cp.portableMessagesForCheckpoint(context, f.session, cid), { code: 'LCX_SESSION_QUERY_UNAVAILABLE' })
      await assert.rejects(cp.createNativeCheckpointBlock({ ctx: context, session: f.session, route: route(String(f.session.id)), result: { compaction: { type: 'compaction', encrypted_content: opaque } } }), { code: 'LCX_SESSION_QUERY_UNAVAILABLE' })
    }
    assert.ok(await cp.checkpointStateForMessage(f.ctx, f.session, m))
    f.backend.dispose()
    await new Promise(r => setTimeout(r, 50))
    assert.equal(f.ctx.sessionQuery, undefined)
    await assert.rejects(cp.checkpointStateForMessage(f.ctx, f.session, m), { code: 'LCX_SESSION_QUERY_UNAVAILABLE' })
    await assert.rejects(cp.activeCompactionId(f.ctx, f.session), { code: 'LCX_SESSION_QUERY_UNAVAILABLE' })
    await assert.rejects(cp.portableMessagesForCheckpoint(f.ctx, f.session, cid), { code: 'LCX_SESSION_QUERY_UNAVAILABLE' })
    const plugin = await import('../lib/index.js')
    assert.equal(plugin.inject.includes('sessionQuery'), false)
    assert.equal(typeof apply, 'function')
  } finally { await f.close() }
})

test('LCX source contains no deprecated Session reads or full-log query calls', async () => {
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.endsWith('.ts')) {
        const source = await readFile(path, 'utf8')
        assert.doesNotMatch(source, /\b(?:snapshotEvents|eventAt|readEvent|readSurface|readSession|listEvents|filterEvents|listSessions)\s*\(/, path)
      }
    }
  }
  await walk(resolve('src'))
})
