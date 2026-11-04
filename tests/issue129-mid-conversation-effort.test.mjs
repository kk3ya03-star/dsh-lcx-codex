import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Llm from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { collect, loadSource } from './issue119-source.mjs'
import { resolveCatalogModel } from '../lib/model-catalog.js'

// Issue #129: Pi 1.3.0 sends a GPT-6 model's reasoning effort as `configuration_update` input items, so an effort
// change keeps the cached prefix: the request's `reasoning.effort` stays `medium`, every same-model reply that
// recorded a level is preceded by it, and the request's own level ends the input. DSH runs on that Pi, so LCX,
// which answers GPT turns before the DSH adapter does, must send the same request. Everything below runs the real
// DSH Llm service and the real llm-pi-ai adapter (the host) next to LCX; only the network is captured.

const [index, request] = await Promise.all([
  loadSource('index', 'managedResponsesStream, serializeNativeAware'),
  loadSource('responses-request'),
])
const { readDshPiReplayState, serializeDshMessages } = await loadSource('dsh-responses')
const route = await loadSource('route')
const baseURL = 'https://fixture.invalid/v1'
const entry = id => ({ id, name: id, contextWindow: 272000, maxTokens: 128000, input: ['text', 'image'] })
const PROFILES = { openai: { apiKeyEnv: 'FIXTURE_KEY', baseURL, models: [entry('gpt-6-sol'), entry('gpt-5.6-sol')] } }

function reply(text) {
  const item = { type: 'message', id: `msg_${text}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
  const events = [
    { type: 'response.created', response: { id: `resp_${text}`, model: 'fixture', status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: text },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: `resp_${text}`, model: 'fixture', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 } } } },
  ]
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
}

async function fixture(t) {
  const ctx = new Context()
  ctx.plugin(Llm)
  ctx.plugin(PiAi, { providers: structuredClone(PROFILES) })
  await new Promise(resolve => setTimeout(resolve, 800))
  ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-only' }) }, true)
  const bodies = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)))
    return reply(`r${bodies.length}`)
  })
  const routeCtx = {
    llm: { listConfigurableProviders: () => [{ provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] }] },
    settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { openai: PROFILES.openai } } }] },
  }
  const routeFor = model => {
    const resolved = route.resolveResponsesRouteConfig(routeCtx, { provider: 'openai', model }, { timeoutMs: 5000, maxAttempts: 1 })
    assert.ok(resolved, model)
    return { ...resolved, baseURL, portableReplayMaxChars: 200000 }
  }
  return { ctx, bodies, routeFor }
}

const system = { role: 'system', source: { kind: 'system' }, content: [{ type: 'text', text: 'be brief' }] }
const user = text => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const assistant = (model, text, finish) => ({ role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'openai', model, replayState: finish.replayState } })
const finishOf = chunks => {
  const finish = chunks.find(chunk => chunk.type === 'finish')
  assert.equal(finish?.reason?.kind, 'stop', JSON.stringify(finish?.reason))
  return finish
}
/** The conversation turns and every effort update, in input order. */
const shape = body => body.input
  .filter(item => item.type === 'configuration_update' || item.role === 'user' || item.role === 'assistant')
  .map(item => item.type === 'configuration_update' ? `effort:${item.reasoning.effort}` : item.role)

const host = async (ctx, model, messages, reasoningEffort) =>
  finishOf(await collect(ctx.llm.stream({ provider: 'openai', model, messages, reasoningEffort })))
const lcx = async (ctx, routeConfig, model, messages, reasoningEffort) =>
  finishOf(await collect(index.managedResponsesStream({ provider: 'openai', model, sessionId: 'sid-129', messages, reasoningEffort, signal: AbortSignal.timeout(5000) }, routeConfig, ctx)))

test('the effort travels as configuration_update exactly when Pi sends it that way', async () => {
  const sol = { ...resolveCatalogModel('openai', 'gpt-6-sol').descriptor, baseUrl: baseURL }
  const legacy = { ...resolveCatalogModel('openai', 'gpt-5.6-sol').descriptor, baseUrl: baseURL }
  assert.equal(sol.compat.supportsMidConvoEffort, true)
  let reads = 0
  const key = value => async () => { reads += 1; return value }
  assert.equal(await request.configurationUpdateEffort(sol, 'high', key('fixture-only')), 'high')
  assert.equal(await request.configurationUpdateEffort(sol, 'xhigh', key('fixture-only')), 'xhigh')
  // No level, `off` (DSH and Pi both send no effort for it), and a model without the capability.
  assert.equal(await request.configurationUpdateEffort(sol, undefined, key('fixture-only')), undefined)
  assert.equal(await request.configurationUpdateEffort(sol, 'off', key('fixture-only')), undefined)
  assert.equal(await request.configurationUpdateEffort(legacy, 'high', key('fixture-only')), undefined)
  // A level the model maps to null is unsupported; DSH refuses it before dispatch.
  assert.equal(await request.configurationUpdateEffort(sol, 'minimal', key('fixture-only')), undefined)
  assert.equal(reads, 0, 'the key is read only when the Sign in with ChatGPT rule can apply')
  // Sign in with ChatGPT (the official endpoint with a key that is not an API key) rejects the items.
  const official = { ...sol, baseUrl: 'https://api.openai.com/v1' }
  assert.equal(await request.configurationUpdateEffort(official, 'high', key('chatgpt-session-token')), undefined)
  assert.equal(await request.configurationUpdateEffort(official, 'high', key('sk-fixture')), 'high')
  assert.equal(reads, 2)
})

test('LCX sends the request the host sends: fixed medium effort, each reply preceded by its level, the request level last', async t => {
  const { ctx, bodies, routeFor } = await fixture(t)
  const routeConfig = routeFor('gpt-6-sol')
  // Turn one on the host at low: the host records the level it sent with the reply.
  const first = await host(ctx, 'gpt-6-sol', [system, user('one')], 'low')
  assert.equal(readDshPiReplayState(first.replayState).response.providerThinkingLevel, 'low')
  assert.deepEqual(bodies.at(-1).reasoning, { effort: 'medium', summary: 'auto' })
  assert.deepEqual(shape(bodies.at(-1)), ['user', 'effort:low'])
  // Turn two at high, once through the host and once through LCX, over the same history.
  const history = [system, user('one'), assistant('gpt-6-sol', 'r1', first), user('two')]
  await host(ctx, 'gpt-6-sol', history, 'high')
  const hostBody = bodies.at(-1)
  const second = await lcx(ctx, routeConfig, 'gpt-6-sol', history, 'high')
  const lcxBody = bodies.at(-1)
  assert.deepEqual(shape(hostBody), ['user', 'effort:low', 'assistant', 'user', 'effort:high'])
  assert.deepEqual(shape(lcxBody), shape(hostBody))
  assert.deepEqual(lcxBody.reasoning, hostBody.reasoning)
  assert.deepEqual(lcxBody.input.at(-1), { type: 'configuration_update', reasoning: { effort: 'high' } })
  assert.equal(lcxBody.input.filter(item => item.type === 'configuration_update').length, 2, 'one tail item, however many batches')
  // LCX records the level like the host, so the host replays an LCX reply the same way (and the reverse above).
  assert.equal(readDshPiReplayState(second.replayState).response.providerThinkingLevel, 'high')
  const third = [...history, assistant('gpt-6-sol', 'r3', second), user('three')]
  await host(ctx, 'gpt-6-sol', third, 'low')
  assert.deepEqual(shape(bodies.at(-1)), ['user', 'effort:low', 'assistant', 'user', 'effort:high', 'assistant', 'user', 'effort:low'])
  await lcx(ctx, routeConfig, 'gpt-6-sol', third, 'low')
  assert.deepEqual(shape(bodies.at(-1)), shape(bodies.at(-2)))
})

test('without a level, and for a model without the capability, the effort stays in reasoning.effort like the host', async t => {
  const { ctx, bodies, routeFor } = await fixture(t)
  for (const [model, effort] of [['gpt-5.6-sol', 'high'], ['gpt-6-sol', undefined]]) {
    await host(ctx, model, [system, user('one')], effort)
    const hostBody = bodies.at(-1)
    await lcx(ctx, routeFor(model), model, [system, user('one')], effort)
    const lcxBody = bodies.at(-1)
    assert.equal(lcxBody.input.some(item => item.type === 'configuration_update'), false, model)
    assert.equal(hostBody.input.some(item => item.type === 'configuration_update'), false, model)
    assert.deepEqual(lcxBody.reasoning, hostBody.reasoning, model)
  }
})

test('callers that do not opt in (compaction, Grok) serialize no update, and a recorded level replays nothing there', async t => {
  const { ctx, routeFor } = await fixture(t)
  const first = await host(ctx, 'gpt-6-sol', [system, user('one')], 'low')
  const history = [system, user('one'), assistant('gpt-6-sol', 'r1', first), user('two')]
  const prepared = await index.serializeNativeAware(history, { provider: 'openai', model: 'gpt-6-sol', baseURL, sessionId: 'sid-129' }, routeFor('gpt-6-sol'), ctx, { tools: [] })
  assert.equal(prepared.configurationUpdateEffort, undefined)
  assert.equal(prepared.input.some(item => item.type === 'configuration_update'), false)
  assert.ok(prepared.input.some(item => item.role === 'assistant'), 'the reply itself is still replayed')
})

test('one serialization batch keeps its per-reply levels and leaves the tail to the caller', async () => {
  const replay = level => ({ kind: 'model', provider: 'openai', model: 'gpt-6-sol', replayState: { response: { kind: 'pi-ai', version: 2, api: 'openai-responses', provider: 'openai', model: 'gpt-6-sol', stopReason: 'stop', ...(level ? { providerThinkingLevel: level } : {}) }, blocks: [{ type: 'text' }] } })
  const messages = [user('one'), { role: 'assistant', content: [{ type: 'text', text: 'a' }], source: replay('low') }, user('two'), { role: 'assistant', content: [{ type: 'text', text: 'b' }], source: replay(undefined) }]
  const options = { route: { provider: 'openai', model: 'gpt-6-sol', baseURL } }
  const plain = await serializeDshMessages(messages, undefined, options)
  assert.deepEqual(shape(plain), ['user', 'assistant', 'user', 'assistant'])
  const updated = await serializeDshMessages(messages, undefined, { ...options, configurationUpdateEffort: 'high' })
  // Only the reply that recorded a level gets one; the request's own level is not appended per batch.
  assert.deepEqual(shape(updated), ['user', 'effort:low', 'assistant', 'user', 'assistant'])
})

test('a replay state whose recorded level is not a string is refused like the host refuses it', () => {
  const state = level => ({ response: { kind: 'pi-ai', version: 2, api: 'openai-responses', provider: 'openai', model: 'gpt-6-sol', stopReason: 'stop', providerThinkingLevel: level }, blocks: [] })
  assert.equal(readDshPiReplayState(state('high')).response.providerThinkingLevel, 'high')
  assert.throws(() => readDshPiReplayState(state(3)), /providerThinkingLevel must be a string/u)
})
