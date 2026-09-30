import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { Context } from '@deepseek-ai/cordis'
import Sessions, { Session, SessionId, SessionLogOffset, buildForkSeed } from '@deepseek-ai/dsh-session'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import QuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import Llm from '@deepseek-ai/dsh-llm'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Compaction from '@deepseek-ai/dsh-compaction-basic'
import { loadHostSource } from './wp2-source.mjs'
import { queryContext } from './session-query-fixture.mjs'

const [checkpoint, routeHelpers] = await Promise.all([loadHostSource('native-checkpoint'), loadHostSource('route')])
const fixture = resolve('tests/fixtures/issue90-v3/session.v3.jsonl.zstd')
const fixtureHash = 'a2b36e94e8b603deba56eea89982db5a7cbd043140caf1a54457bd0e5160e128'
const opaque = 'FAKE-OPAQUE-PLACEHOLDER-NOT-REAL-STATE'
const oldId = 'issue90-step0a-v3'
const oldCwd = '/issue90-fixture/cwd'
const oldCwdDir = '--issue90-fixture-cwd--'
const baseURL = 'https://fixture.invalid/v1'

async function indexSource() {
  const path = resolve(`.wp5-index-${process.pid}.mjs`)
  const built = await build({ entryPoints: [resolve('src/index.ts')], bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node24', write: false, footer: { js: '\nexport { managedResponsesStream, serializeNativeAware };' } })
  await writeFile(path, built.outputFiles[0].contents)
  try { return await import(pathToFileURL(path).href) } finally { await rm(path) }
}
const index = await indexSource()

async function persistence(root) {
  const ctx = new Context()
  ctx.plugin(Sessions)
  ctx.plugin(Jsonl, { root })
  await new Promise(resolve => setTimeout(resolve, 200))
  return ctx.sessionPersistence
}

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function encryptedValues(value) {
  if (Array.isArray(value)) return value.flatMap(encryptedValues)
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => key === 'encrypted_content' ? [child] : encryptedValues(child))
}
function route(sessionId) { return { provider: 'lcx', model: 'gpt-5.6-sol', baseURL, sessionId } }
function routeConfig() { return { baseURL, portableReplayMaxChars: 200_000, maxAttempts: 1 } }
function fakeCtx(session) {
  const query = queryContext(session)
  return {
    ...query,
    sessions: { get: id => String(id) === String(session.id) ? session : undefined },
    credentials: { resolve: async () => ({ value: 'fixture-only' }) },
    get(key) { return key === 'sessionQuery' ? query.get(key) : this[key] },
  }
}

test('real DSH v3-to-v4 migration refuses checkpoint before managed transport and preserves v3 bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lcx-wp5-migrate-'))
  const source = await readFile(fixture)
  assert.equal(sha(source), fixtureHash, 'sanitized 0.1.6 writer artifact provenance')
  const originalFetch = globalThis.fetch
  let fetchCount = 0
  globalThis.fetch = async () => { fetchCount++; throw new Error('fetch blocked') }
  try {
    const sessionsRoot = join(root, 'sessions')
    const sessionDir = join(sessionsRoot, oldCwdDir, oldId)
    await mkdir(sessionDir, { recursive: true })
    const v3 = join(sessionDir, 'session.v3.jsonl.zstd')
    await copyFile(fixture, v3)
    const store = await persistence(sessionsRoot)
    const writer = await store.open(oldId, 'write')
    const { events } = await writer.read()
    await writer.close()
    assert.equal(sha(await readFile(v3)), fixtureHash, 'v3 source remains byte-identical')
    assert.deepEqual(encryptedValues(events), [opaque, opaque], 'fixture has placeholder opaque state only')
    const summary = events.find(event => event.type === 'compaction/summary')
    assert.ok(summary)
    assert.deepEqual(summary.data.rawOutput.map(block => block.type), ['text', 'plugin:lcx-native-compaction-v5'])
    assert.deepEqual(summary.data.rawOutput.filter(block => block.type.startsWith('plugin:')).map(block => block.nativeOutput.at(-1).encrypted_content), [opaque])
    const header = (await store.stat(oldId)).header
    const session = Session.create(SessionId(oldId), events, header)
    const message = session.deriveMessages().find(item => checkpoint.compactCheckpointId(item))
    assert.ok(message)
    assert.throws(() => checkpoint.assertSupportedCheckpointMessage({ role: 'user', content: [{ type: 'plugin:lcx-native-compaction-v5' }] }), { code: 'LCX_CHECKPOINT_UNSUPPORTED' })
    assert.doesNotThrow(() => checkpoint.assertSupportedCheckpointMessage({ role: 'user', content: [{ type: 'text', text: 'ordinary plugin:lcx-native-compaction-v5 mention' }] }))
    assert.throws(() => checkpoint.stateFromSummaryEvent(summary), error => error.code === 'LCX_CHECKPOINT_UNSUPPORTED' && /start a new session/i.test(error.message))
    await assert.rejects(checkpoint.checkpointStateForMessage(fakeCtx(session), session, message), { code: 'LCX_CHECKPOINT_UNSUPPORTED' })
    await assert.rejects(checkpoint.portableMessagesForCheckpoint(fakeCtx(session), session, summary.data.compactionId), { code: 'LCX_CHECKPOINT_UNSUPPORTED' })
    await assert.rejects(index.serializeNativeAware(session.deriveMessages(), route(oldId), routeConfig(), fakeCtx(session), {}), { code: 'LCX_CHECKPOINT_UNSUPPORTED' })
    const chunks = []
    for await (const chunk of index.managedResponsesStream({ provider: 'lcx', model: 'gpt-5.6-sol', sessionId: oldId, messages: session.deriveMessages(), signal: AbortSignal.timeout(3000) }, routeConfig(), fakeCtx(session))) chunks.push(chunk)
    assert.equal(chunks.at(-1).reason.failure.code, 'INVALID_REQUEST', 'managed failure maps the typed checkpoint refusal to DSH wire code')
    assert.match(JSON.stringify(chunks), /start a new session/i)
    assert.equal(fetchCount, 0, 'checkpoint refused before request serialization reaches transport')
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
})

test('new v4 session persists unprefixed checkpoint and reads it back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lcx-wp5-v4-'))
  try {
    const id = SessionId('wp5-new-v4')
    const session = Session.create(id, undefined, { version: 4, id, createdAt: Date.now(), cwd: root, isSeeded: false, delegationDepth: 0 })
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'before checkpoint' }] })
    const userEvent = session.append('user/message', user, { surfaceOp: 'append' })
    const compactionId = 'wp5-new-compaction'
    session.append('compaction/start', { compactionId, turn: null })
    const block = { type: checkpoint.NATIVE_BLOCK_TYPE, version: 5, compactionId, provider: 'lcx', model: 'gpt-5.6-sol', baseURLFingerprint: routeHelpers.baseURLFingerprint(baseURL), sourceSessionId: String(session.id), nativeOutput: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'before checkpoint' }] }, { type: 'compaction', encrypted_content: opaque }], nativeCompaction: { type: 'compaction', encrypted_content: opaque }, retainedInputCount: 1, retainedClientCount: 1, retainedAssistantCount: 0 }
    session.append('compaction/summary', { compactionId, summary: [{ type: 'text', text: 'checkpoint saved' }], rawOutput: [{ type: 'text', text: 'checkpoint saved' }, block], shadowedRange: { start: userEvent.seq, end: userEvent.seq }, shadowedSeqs: [userEvent.seq], shadowedTokenCount: 1, provider: 'lcx', model: 'gpt-5.6-sol' })
    session.append('user/message', { role: 'user', source: { kind: 'compact-checkpoint', compactionId }, content: [{ type: 'text', text: 'checkpoint saved' }], id: 'wp5-compact-message' }, { sourceEventSeqs: [userEvent.seq], surfaceOp: { op: 'replace', startSeq: userEvent.seq, endSeq: userEvent.seq } })
    session.append('compaction/end', { compactionId, turn: null })
    const store = await persistence(join(root, 'sessions'))
    const writer = await store.create(session.header)
    await writer.append(session.snapshotEvents())
    await writer.close()
    const reader = await store.open(String(session.id), 'read')
    const { events } = await reader.read()
    await reader.close()
    const restored = Session.create(session.id, events, session.header)
    const summary = events.find(event => event.type === 'compaction/summary')
    assert.equal(summary.data.rawOutput[1].type, 'lcx-native-compaction-v5')
    assert.equal(checkpoint.stateFromSummaryEvent(summary).nativeCompaction.encrypted_content, opaque)
    const message = restored.deriveMessages().find(item => checkpoint.compactCheckpointId(item))
    assert.equal((await checkpoint.checkpointStateForMessage(fakeCtx(restored), restored, message)).sourceSessionId, String(session.id))
    let body
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (_url, init) => { body = JSON.parse(init.body); return new Response('fixture denied', { status: 401 }) }
    try {
      for await (const _chunk of index.managedResponsesStream({ provider: 'lcx', model: 'gpt-5.6-sol', sessionId: String(restored.id), messages: restored.deriveMessages(), signal: AbortSignal.timeout(3000) }, routeConfig(), fakeCtx(restored))) {}
      assert.ok(body, 'new v4 checkpoint reaches blocked transport')
      assert.match(JSON.stringify(body.input), /FAKE-OPAQUE-PLACEHOLDER-NOT-REAL-STATE/)
    } finally { globalThis.fetch = originalFetch }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('real DSH mid-turn v4 fork serializes synthetic result and only portable parent history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lcx-wp5-fork-'))
  const originalFetch = globalThis.fetch
  let body
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body)
    return new Response('fixture denied', { status: 401 })
  }
  try {
    const ctx = new Context()
    ctx.plugin(Llm)
    ctx.plugin(Sessions)
    ctx.plugin(Jsonl, { root: join(root, 'sessions') })
    ctx.plugin(QuerySqlite, { path: ':memory:', openAt: 'never' })
    ctx.plugin(Projections)
    ctx.plugin(SystemPrompt)
    ctx.plugin(Tools)
    ctx.plugin(Agents)
    ctx.plugin(AgentLoop)
    ctx.plugin(TokenMeter)
    ctx.plugin(Compaction, { auto: false })
    await new Promise(resolve => setTimeout(resolve, 500))
    ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-only' }) }, true)
    const parentHandle = await ctx.agents.create({ sessionId: SessionId('wp5-parent'), meta: { cwd: root }, agentOptions: { provider: 'lcx', model: 'gpt-5.6-sol' } })
    const parent = parentHandle.agent.session
    const first = parent.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'portable parent history' }] }), { surfaceOp: 'append' })
    const compactionId = 'wp5-fork-checkpoint'
    parent.append('compaction/start', { compactionId, turn: null })
    const native = { type: checkpoint.NATIVE_BLOCK_TYPE, version: 5, compactionId, provider: 'lcx', model: 'gpt-5.6-sol', baseURLFingerprint: routeHelpers.baseURLFingerprint(baseURL), sourceSessionId: String(parent.id), nativeOutput: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'portable parent history' }] }, { type: 'compaction', encrypted_content: opaque }], nativeCompaction: { type: 'compaction', encrypted_content: opaque }, retainedInputCount: 1, retainedClientCount: 1, retainedAssistantCount: 0 }
    parent.append('compaction/summary', { compactionId, summary: [{ type: 'text', text: 'checkpoint saved' }], rawOutput: [{ type: 'text', text: 'checkpoint saved' }, native], shadowedRange: { start: first.seq, end: first.seq }, shadowedSeqs: [first.seq], shadowedTokenCount: 1, provider: 'lcx', model: 'gpt-5.6-sol' })
    parent.append('user/message', { role: 'user', source: { kind: 'compact-checkpoint', compactionId }, content: [{ type: 'text', text: 'checkpoint saved' }], id: 'wp5-fork-compact-message' }, { sourceEventSeqs: [first.seq], surfaceOp: { op: 'replace', startSeq: first.seq, endSeq: first.seq } })
    parent.append('compaction/end', { compactionId, turn: null })
    parent.append('turn/start', { turn: 1 })
    parent.append('step/start', { turn: 1, step: 1 })
    const callId = 'wp5-open-tool'
    const assistant = createAssistantMessage({ source: { provider: 'lcx', model: 'gpt-5.6-sol' }, content: [{ type: 'tool-call', id: callId, name: 'read_file', arguments: '{}' }] })
    parent.append('assistant/message', { turn: 1, step: 1, message: assistant, stream: [] }, { surfaceOp: 'append' })
    parent.append('tool/call', { turn: 1, step: 1, callId, name: 'read_file', arguments: '{}' })
    const parentEvents = parent.snapshotEvents()
    const boundary = parentEvents.at(-1).seq
    assert.equal(parentEvents.some(event => event.type === 'turn/end'), false, 'fork cut is inside the open turn')
    const childHandle = await ctx.agents.create({
      sessionId: SessionId('wp5-child'), seed: buildForkSeed(parentEvents, boundary),
      inheritedEventCount: SessionLogOffset(boundary + 1),
      meta: { cwd: root, parentSession: parent.id, isSeeded: true },
      agentOptions: { provider: 'lcx', model: 'gpt-5.6-sol' },
    })
    const child = childHandle.agent.session
    assert.notEqual(String(child.id), native.sourceSessionId)
    const childEvents = child.snapshotEvents()
    assert.ok(childEvents.some(event => event.type === 'turn/end' && event.data.reason.kind === 'forked'))
    const synthetic = childEvents.find(event => event.type === 'tool/result' && event.data.message.toolCallId === callId)
    assert.ok(synthetic, 'real fork primitive inserted synthetic tool result')
    assert.equal(synthetic.data.message.role, 'tool')
    const childSummary = childEvents.find(event => event.type === 'compaction/summary')
    assert.equal(childSummary.data.rawOutput[1].nativeOutput.at(-1).encrypted_content, opaque, 'child log inherits checkpoint artifact')
    assert.equal(checkpoint.stateRouteCompatible(checkpoint.stateFromSummaryEvent(childSummary), route(String(child.id)), ctx), false)
    const chunks = []
    for await (const chunk of index.managedResponsesStream({ provider: 'lcx', model: 'gpt-5.6-sol', sessionId: String(child.id), messages: child.deriveMessages(), signal: AbortSignal.timeout(3000) }, routeConfig(), ctx)) chunks.push(chunk)
    assert.ok(body, `managed path should reach blocked fetch: ${JSON.stringify(chunks)}`)
    const serialized = JSON.stringify(body)
    assert.doesNotMatch(serialized, /FAKE-OPAQUE-PLACEHOLDER-NOT-REAL-STATE|encrypted_content/)
    assert.match(serialized, /portable parent history/)
    const output = body.input.find(item => item.type === 'function_call_output' && item.call_id === callId)
    assert.ok(output)
    assert.match(JSON.stringify(output.output), /history inherited|tool call/i)
    assert.doesNotMatch(JSON.stringify(output.output), /No result provided/)
    await childHandle.dispose()
    await parentHandle.dispose()
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
})
