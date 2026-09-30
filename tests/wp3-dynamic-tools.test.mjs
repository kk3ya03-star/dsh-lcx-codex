import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, createUserMessage, projectToolUpdates } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset, buildForkSeed } from '@deepseek-ai/dsh-session'
import Llm from '@deepseek-ai/dsh-llm'
import Sessions from '@deepseek-ai/dsh-session'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import QuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Compaction from '@deepseek-ai/dsh-compaction-basic'
import { loadHostSource } from './wp2-source.mjs'

const [checkpoint, responses] = await Promise.all([
  loadHostSource('native-checkpoint'), loadHostSource('dsh-responses'),
])
const baseURL = 'https://fixture.invalid/v1'
const routeConfig = { baseURL, portableReplayMaxChars: 200000 }
const tool = (name, description, properties = {}) => ({ name, description, parameters: { type: 'object', properties, additionalProperties: false } })

async function loadIndexInternals() {
  const output = resolve(`.wp3-index-${process.pid}.mjs`)
  const result = await build({ entryPoints: [resolve('src/index.ts')], bundle: true, packages: 'external', format: 'esm', platform: 'node', target: 'node24', write: false, footer: { js: '\nexport { serializeNativeAware, managedResponsesStream, remoteCompactionStream, managedGrokNativeSearchStream };' } })
  await writeFile(output, result.outputFiles[0].contents)
  try { return await import(pathToFileURL(output).href) } finally { await rm(output) }
}

class StubAdapter extends LlmAdapter {
  constructor(toolCalls = []) { super(); this.toolCalls = toolCalls }
  resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 200000 } }) }
  async *stream() {
    if (this.toolCalls.length) {
      for (const [index, name] of this.toolCalls.entries()) {
        const id = `call-abort-${index}`
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index, id, name, argumentsDelta: '{}' }
        yield { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: '{}' } }
      }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'stub reply' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'stub reply' } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function harness(root, index, adapter = new StubAdapter()) {
  const ctx = new Context()
  ctx.plugin(Llm)
  ctx.plugin(Sessions)
  ctx.plugin(Jsonl, { root: resolve(root, 'sessions') })
  ctx.plugin(QuerySqlite, { path: ':memory:', openAt: 'never' })
  ctx.plugin(Projections)
  ctx.plugin(SystemPrompt)
  ctx.plugin(Tools)
  ctx.plugin(Agents)
  ctx.plugin(AgentLoop)
  ctx.plugin(TokenMeter)
  ctx.plugin(Compaction, { auto: false })
  await new Promise(resolve => setTimeout(resolve, 500))
  ctx.llm.registerAdapter(['lcx'], adapter)
  const raw = []
  ctx.on('llm/stream', (options, next) => {
    raw.push(options)
    if (options.purpose !== 'compaction') return next()
    return (async function* () {
      const route = { provider: options.provider, model: options.model, baseURL, sessionId: String(options.sessionId) }
      const projected = projectToolUpdates(options.messages, options.tools, undefined, options.toolHistory)
      const prepared = await index.serializeNativeAware(projected.messages, route, routeConfig, ctx, { tools: [...(projected.tools ?? [])] })
      const session = ctx.sessions.get(SessionId(String(options.sessionId)))
      const result = { compaction: { type: 'compaction', encrypted_content: 'FAKE-OPAQUE-PLACEHOLDER' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      const block = await checkpoint.createNativeCheckpointBlock({ ctx, session, route, result, input: prepared.input, ephemeralPreludeItemCount: prepared.ephemeralPreludeItemCount, imageMap: prepared.imageMap, retentionOptions: {} })
      yield* checkpoint.nativeCheckpointChunks(block, result.usage)
    })()
  })
  const state = { tools: [] }
  ctx.systemPrompt.tools(() => ({ schemas: state.tools.map(tool => structuredClone(tool)) }))
  return { ctx, raw, state }
}

test('real agent-loop tool updates project on managed paths and preserve complete portable history', async () => {
  const root = await mkdtemp(resolve('.wp3-loop-'))
  const originalFetch = globalThis.fetch
  let fetchAttempts = 0
  globalThis.fetch = async () => { fetchAttempts++; throw new Error('fixture fetch blocked') }
  try {
    const index = await loadIndexInternals()
    const { ctx, raw, state } = await harness(root, index)
    ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-only' }) }, true)
    const handle = await ctx.agents.create({ sessionId: SessionId('wp3-tools'), meta: { cwd: root }, agentOptions: { provider: 'lcx', model: 'gpt-5.6-sol' } })
    const { agent } = handle
    const a = tool('tool_a', 'A')
    const b1 = tool('tool_b', 'B v1', { x: { type: 'string' } })
    const b2 = tool('tool_b', 'B v2', { x: { type: 'number' } })
    const ask = async (schemas, text) => {
      state.tools = schemas
      const before = agent.session.snapshotEvents().filter(event => event.type === 'developer/message').length
      agent.followup(createUserMessage({ content: [{ type: 'text', text: text.repeat(1000) }], source: { kind: 'user' } }))
      await agent.whenIdle()
      return agent.session.snapshotEvents().filter(event => event.type === 'developer/message').length - before
    }
    await ask([a], 'one')
    assert.equal(await ask([a, b1], 'two'), 1)
    assert.equal(await ask([b1], 'three'), 1)
    const compactA = await ctx.compaction.compactNow(agent, new AbortController().signal)
    assert.ok(compactA, 'real DSH compaction creates a checkpoint')
    assert.equal(await ask([b2], 'four'), 0, 'same-name re-declare changes only the request header')
    const headers = agent.session.snapshotEvents().filter(event => event.type === 'request/header')
    assert.ok(headers.some(event => JSON.stringify(event.data).includes('B v2')))
    assert.ok(raw.at(-1).tools.some(schema => schema.name === 'tool_b' && schema.description === 'B v2'))
    const change = raw.find(request => request.messages.some(message => message.role === 'developer'))
    assert.ok(change)
    assert.ok(change.messages.some(message => message.content.some(block => block.type === 'tool-addition')))
    assert.ok(raw.at(-1).toolHistory)
    const projection = projectToolUpdates(change.messages, change.tools, undefined, change.toolHistory)
    assert.equal(projection.messages.some(message => message.role === 'developer'), false)
    assert.equal(projection.tools.some(tool => tool.deferLoading === true), false)
    const route = { provider: 'lcx', model: 'gpt-5.6-sol', baseURL, sessionId: String(agent.session.id) }
    const serialized = await index.serializeNativeAware(projection.messages, route, routeConfig, ctx, { tools: [...projection.tools] })
    assert.ok(serialized.input.length > 0)
    assert.doesNotMatch(JSON.stringify(serialized.input), /tool-addition|tool-removal|deferLoading/)
    assert.equal(await responses.serializeDshMessages(projection.messages, ctx, { route }).then(() => true), true)
    const chunks = []
    for await (const chunk of index.managedResponsesStream({ ...change, signal: AbortSignal.timeout(3000) }, routeConfig, ctx)) chunks.push(chunk)
    assert.equal(chunks.some(chunk => JSON.stringify(chunk).includes('LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT')), false)
    assert.ok(fetchAttempts > 0, 'managed path reaches its blocked transport after projection')
    const compactionRequest = raw.find(request => request.purpose === 'compaction')
    assert.ok(compactionRequest)
    const beforeRemote = fetchAttempts
    let remoteError
    try {
      for await (const chunk of index.remoteCompactionStream({ ...compactionRequest, signal: AbortSignal.timeout(3000) }, routeConfig, ctx, () => (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })())) {
        assert.doesNotMatch(JSON.stringify(chunk), /LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT/)
      }
    } catch (error) { remoteError = error }
    assert.notEqual(remoteError?.code, 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT')
    assert.ok(fetchAttempts > beforeRemote, 'Native compaction reaches blocked transport after projection')
    const beforeGrok = fetchAttempts
    const grokChunks = []
    for await (const chunk of index.managedGrokNativeSearchStream({ ...change, provider: 'xai', model: 'grok-4.6', signal: AbortSignal.timeout(3000) }, routeConfig, { web: true, x: false }, ctx)) grokChunks.push(chunk)
    assert.equal(grokChunks.some(chunk => JSON.stringify(chunk).includes('LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT')), false)
    assert.ok(fetchAttempts > beforeGrok, 'Grok path reaches blocked transport after projection')
    const deferred = await ctx.agents.create({ sessionId: SessionId('wp3-deferred'), meta: { cwd: root }, agentOptions: { provider: 'lcx', model: 'gpt-5.6-sol' } })
    state.tools = [{ ...tool('tool_later', 'deferred'), deferLoading: true }]
    deferred.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'deferred tool' }], source: { kind: 'user' } }))
    await deferred.agent.whenIdle()
    const deferredRequest = raw.at(-1)
    assert.ok(deferredRequest.tools.some(schema => schema.deferLoading === true))
    const deferredProjection = projectToolUpdates(deferredRequest.messages, deferredRequest.tools, undefined, deferredRequest.toolHistory)
    assert.equal(deferredProjection.tools.some(schema => schema.deferLoading === true), false)
    await index.serializeNativeAware(deferredProjection.messages, { provider: 'lcx', model: 'gpt-5.6-sol', baseURL, sessionId: String(deferred.agent.session.id) }, routeConfig, ctx, { tools: [...deferredProjection.tools] })
    await deferred.dispose()

    const session = agent.session
    const summaryA = session.snapshotEvents().find(event => event.type === 'compaction/summary')
    assert.ok(summaryA)
    const shadowA = summaryA.data.shadowedSeqs.map(seq => session.eventAt(seq)).filter(event => event && (event.type.endsWith('/message') || event.type === 'tool/result'))
    assert.equal(shadowA.at(-1).type, 'developer/message', 'newest shadowed entry is a tool update')
    const expandedA = await checkpoint.shadowedMessagesForCheckpoint(ctx, session, summaryA.data.compactionId)
    assert.equal(expandedA.length, shadowA.length - shadowA.filter(event => event.type === 'developer/message').length)
    const portableA = await checkpoint.portableMessagesForCheckpoint(ctx, session, summaryA.data.compactionId, { maxChars: 200000 })
    assert.equal(portableA.length, expandedA.length)
    assert.equal(portableA[0].role, expandedA[0].role)

    const other = await ctx.agents.create({ sessionId: SessionId('wp3-tools-mid'), meta: { cwd: root }, agentOptions: { provider: 'lcx', model: 'gpt-5.6-sol' } })
    const otherAgent = other.agent
    const askOther = async (schemas, text) => {
      state.tools = schemas
      otherAgent.followup(createUserMessage({ content: [{ type: 'text', text: text.repeat(1000) }], source: { kind: 'user' } }))
      await otherAgent.whenIdle()
    }
    await askOther([a], 'one')
    await askOther([a, b1], 'two')
    await askOther([b1], 'three')
    await askOther([b1], 'four')
    assert.ok(await ctx.compaction.compactNow(otherAgent, new AbortController().signal))
    const otherSession = otherAgent.session
    const summaryB = otherSession.snapshotEvents().find(event => event.type === 'compaction/summary')
    const shadowB = summaryB.data.shadowedSeqs.map(seq => otherSession.eventAt(seq)).filter(event => event && (event.type.endsWith('/message') || event.type === 'tool/result'))
    assert.notEqual(shadowB.at(-1).type, 'developer/message', 'tool update is mid-history')
    const expandedB = await checkpoint.shadowedMessagesForCheckpoint(ctx, otherSession, summaryB.data.compactionId)
    const portableB = await checkpoint.portableMessagesForCheckpoint(ctx, otherSession, summaryB.data.compactionId, { maxChars: 200000 })
    assert.equal(portableB.length, expandedB.length)
    assert.equal(portableB.length, shadowB.length - shadowB.filter(event => event.type === 'developer/message').length)
    assert.equal(portableB[0].role, expandedB[0].role)
    await ctx.sessions.flush(otherSession)
    await other.dispose()
    await handle.dispose()
    const reopened = await harness(root, index)
    const resumed = await reopened.ctx.agents.resume({ resumeSessionId: SessionId('wp3-tools-mid'), agentOptions: { provider: 'lcx', model: 'gpt-5.6-sol' } })
    const restored = resumed.agent.session
    assert.ok(restored.toolHistory().updates.length > 0)
    const coldSummary = restored.snapshotEvents().find(event => event.type === 'compaction/summary')
    const coldPortable = await checkpoint.portableMessagesForCheckpoint(ctx, restored, coldSummary.data.compactionId, { maxChars: 200000 })
    assert.equal(coldPortable.length, expandedB.length)
    assert.equal(coldPortable[0].role, expandedB[0].role)
    reopened.ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-only' }) }, true)
    reopened.state.tools = [a, b1]
    resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'cold reopened request' }], source: { kind: 'user' } }))
    await resumed.agent.whenIdle()
    const reopenedRequest = reopened.raw.at(-1)
    assert.ok(reopenedRequest.messages.some(message => message.role === 'developer'))
    const beforeReopenTransport = fetchAttempts
    const reopenChunks = []
    for await (const chunk of index.managedResponsesStream({ ...reopenedRequest, signal: AbortSignal.timeout(3000) }, routeConfig, reopened.ctx)) reopenChunks.push(chunk)
    assert.equal(reopenChunks.some(chunk => JSON.stringify(chunk).includes('LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT')), false)
    assert.ok(fetchAttempts > beforeReopenTransport)
    const events = restored.snapshotEvents()
    const boundary = events.at(-1).seq
    const fork = await reopened.ctx.agents.create({
      sessionId: SessionId('wp3-tools-fork'),
      seed: buildForkSeed(events, boundary),
      inheritedEventCount: SessionLogOffset(boundary + 1),
      meta: { cwd: root, parentSession: restored.id, isSeeded: true },
      agentOptions: { provider: 'lcx', model: 'gpt-5.6-sol' },
    })
    const forked = fork.agent.session
    const forkSummary = forked.snapshotEvents().find(event => event.type === 'compaction/summary')
    const forkPortable = await checkpoint.portableMessagesForCheckpoint(ctx, forked, forkSummary.data.compactionId, { maxChars: 200000 })
    assert.equal(forkPortable.length, expandedB.length)
    assert.equal(forkPortable[0].role, expandedB[0].role)
    const forkProjection = projectToolUpdates(forked.deriveMessages(), [a, b1], undefined, forked.toolHistory())
    const forkSerialized = await index.serializeNativeAware(forkProjection.messages, { provider: 'lcx', model: 'gpt-5.6-sol', baseURL, sessionId: String(forked.id) }, routeConfig, reopened.ctx, { tools: [...forkProjection.tools] })
    assert.ok(forkSerialized.input.length > 0)
    assert.doesNotMatch(JSON.stringify(forkSerialized.input), /tool-addition|tool-removal|deferLoading/)
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
})

test('agent-loop aborted-before-dispatch producer serializes its real error result', async () => {
  const root = await mkdtemp(resolve('.wp3-abort-'))
  try {
    const index = await loadIndexInternals()
    const { ctx, state } = await harness(root, index, new StubAdapter(['read_a', 'read_b']))
    state.tools = [tool('read_a', 'A'), tool('read_b', 'B')]
    const handle = await ctx.agents.create({ sessionId: SessionId('wp3-abort'), meta: { cwd: root }, agentOptions: { provider: 'lcx', model: 'gpt-5.6-sol' } })
    const { agent } = handle
    const append = agent.session.append.bind(agent.session)
    agent.session.append = (type, data, ...options) => {
      const event = append(type, data, ...options)
      if (type === 'assistant/message' && data.message.content.some(block => block.type === 'tool-call')) agent.cancel({ kind: 'user' })
      return event
    }
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'call both tools' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const events = agent.session.snapshotEvents()
    const aborted = events.filter(event => event.type === 'tool/result' && event.data.message.content.some(block => block.type === 'text' && block.text === 'Error: tool call aborted before dispatch'))
    assert.ok(aborted.length > 0, 'real agent loop records skipped tool calls')
    const assistant = events.find(event => event.type === 'assistant/message' && event.data.message.content.some(block => block.type === 'tool-call')).data.message
    const serialized = await responses.serializeDshMessages([assistant, ...aborted.map(event => event.data.message)], undefined, { route: { provider: 'lcx', model: 'gpt-5.6-sol', baseURL } })
    const outputs = serialized.input.filter(item => item.type === 'function_call_output')
    assert.equal(outputs.length, aborted.length)
    for (const output of outputs) assert.equal(output.output, 'Error: tool call aborted before dispatch')
    assert.equal(serialized.input.some(item => item.role === 'user'), false)
    await handle.dispose()
  } finally { await rm(root, { recursive: true, force: true }) }
})
