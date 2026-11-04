import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Llm from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { collect, loadSource } from './issue119-source.mjs'
import { buildResponsesBody } from '../lib/responses-request.js'
import { serializeDshMessages } from '../lib/dsh-responses.js'

// Resolve Pi from the real host adapter, independently of LCX's bundled runtime.
const hostRequire = createRequire(import.meta.resolve('@deepseek-ai/dsh-llm-pi-ai'))
const hostRoot = hostRequire.resolve.paths('@earendil-works/pi-ai').map(path => join(path, '@earendil-works/pi-ai/dist')).find(path => existsSync(join(path, 'index.js')))
const hostPi = await import(pathToFileURL(join(hostRoot, 'index.js')).href)
const api = await import(pathToFileURL(join(hostRoot, 'api/openai-responses.js')).href)
const { getBuiltinModels } = await import(pathToFileURL(join(hostRoot, 'providers/all.js')).href)
const index = await loadSource('index', 'serializeNativeAware, managedResponsesStream')
const baseURL = 'https://fixture.invalid/v1'
const tool = (name, description = name, deferLoading = false) => ({ name, description, parameters: { type: 'object', properties: {}, additionalProperties: false }, ...(deferLoading ? { deferLoading: true } : {}) })
const user = text => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
const system = { role: 'system', content: [{ type: 'text', text: 'be brief' }], source: { kind: 'system' } }
const update = (...content) => ({ role: 'developer', content, source: { kind: 'tool-registry' } })
const add = toolName => ({ type: 'tool-addition', toolName })
const remove = toolName => ({ type: 'tool-removal', toolName })
const wire = body => JSON.parse(JSON.stringify({ tools: body.tools, input: body.input }))
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

async function fixture(t, mode, id = 'gpt-6-sol') {
  const original = getBuiltinModels('openai').find(model => model.id === id)
  const compat = mode === 'catalog' ? original.compat : {
    ...original.compat,
    supportsMidConvoSystemMessages: true,
    supportsAdditionalTools: mode === 'changes',
    supportsToolSearch: mode === 'additions',
  }
  const model = { ...original, baseUrl: baseURL, compat }
  const provider = hostPi.createProvider({ id: 'openai', models: [model], auth: { apiKey: { resolve: async () => ({ auth: { apiKey: 'fixture-only' }, source: 'fixture' }) } }, api })
  const profile = { provider: 'openai', displayName: 'fixture', piProvider: provider, modelErrors: new Map(), configuredMaxTokens: new Map(), streamIdleTimeoutMs: 5000 }
  const profiles = new Map([['openai', profile]])
  const adapter = new PiAiAdapter({ profiles: () => profiles, resolveApiKey: async () => 'fixture-only' })
  const ctx = new Context()
  ctx.plugin(Llm)
  await new Promise(resolve => setTimeout(resolve, 50))
  ctx.llm.registerAdapter(['openai'], adapter)
  ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-only' }) }, true)
  const bodies = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)))
    return reply('fixture')
  })
  const route = { provider: 'openai', model: id, baseURL, sessionId: 'sid-tool-parity' }
  const config = { baseURL, responsesCompat: compat, modelDefaults: model, portableReplayMaxChars: 200000, maxAttempts: 1 }
  return { ctx, adapter, bodies, route, config, model }
}

for (const mode of ['changes', 'additions', 'none']) {
  test(`${mode}: real host and LCX agree on the first turn and every incremental tool transition`, async t => {
    const { adapter, bodies, route, config, model } = await fixture(t, mode)
    const tools = [tool('a'), tool('b', 'latest b', true), tool('c', 'c', true), tool('d', 'd', true)]
    // Includes removal, same-name redeclaration, remove/re-add and a subsequent addition while b
    // is still unavailable. No copied Pi notices or state machine appears in the expected body.
    const transcript = [user('one'), update(add('b')), user('two'), update(remove('a')),
      update(add('b')), user('three'), update(remove('b')), update(add('c')), user('four'),
      update(add('a')), update(add('d')), { role: 'assistant', source: { kind: 'model', provider: 'foreign', model: 'foreign' }, content: [{ type: 'text', text: 'portable reply without a signature' }] }, user('five')]
    for (const end of [1, 3, 6, 9, transcript.length]) {
      const messages = [system, ...transcript.slice(0, end)]
      const chunks = await collect(adapter.stream({ ...route, messages, tools, signal: AbortSignal.timeout(5000) }))
      assert.equal(chunks.at(-1)?.reason?.kind, 'stop', JSON.stringify(chunks.at(-1)))
      const expected = bodies.at(-1)
      const prepared = await serializeDshMessages(messages.slice(1), undefined, {
        route, model, responsesCompat: config.responsesCompat, systemPrompt: 'be brief',
        includeSystemPrompt: true, systemPromptUpdate: 'in-history', toolUpdate: 'addition-only', tools,
      })
      const actual = buildResponsesBody({ model: prepared.model, input: prepared.input, tools: prepared.tools })
      assert.deepEqual(wire(actual), wire(expected), `transition ${end}`)
      if (mode === 'changes') assert.equal(Object.hasOwn(actual, 'tools'), false)
    }
    if (mode === 'changes') {
      const final = bodies.at(-1)
      assert.ok(JSON.stringify(final.input).includes('Still unavailable: b'))
      assert.equal(final.input[0].type, 'additional_tools')
    }
  })
}

for (const id of ['gpt-6-sol', 'gpt-5.4', 'gpt-5.5']) {
  test(`${id}: real Llm runtime and LCX request-global assembly agree on plain first turns with different session IDs`, async t => {
    const { ctx, bodies, route, config } = await fixture(t, 'catalog', id)
    const request = { ...route, messages: [system, user('one')], tools: [tool('a')] }
    await collect(ctx.llm.stream(request))
    const expected = wire(bodies.at(-1))
    for (const sessionId of ['sid-tool-parity', 'restarted', 'fork-child']) {
      await collect(index.managedResponsesStream({ ...request, sessionId, signal: AbortSignal.timeout(5000) }, config, ctx))
      assert.deepEqual(wire(bodies.at(-1)), expected)
    }
  })
}


for (const mode of ['changes', 'additions', 'none']) {
  test(`${mode}: request-global LCX assembly matches real Llm across several tool boundaries and a prompt snapshot`, async t => {
    const { ctx, bodies, route, config } = await fixture(t, mode)
    const tools = ['a', 'b', 'c', 'd'].map(name => tool(name))
    const changes = ['b', 'c', 'd'].map((name, i) => ({ ...update(add(name)), id: `dev_${i}` }))
    const messages = [system, user('one'), changes[0], user('two'),
      { ...system, source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'updated prompt' }] },
      changes[1], { role: 'assistant', source: { kind: 'model', provider: 'foreign', model: 'foreign' }, content: [{ type: 'text', text: 'portable reply' }] },
      user('three'), changes[2], user('four')]
    const toolHistory = { tools: [tools[0]], updates: changes.map((message, i) => ({ messageId: message.id, additions: [tools[i + 1]] })) }
    const request = { ...route, messages, tools, toolHistory, signal: AbortSignal.timeout(5000) }
    await collect(ctx.llm.stream(request))
    const expected = wire(bodies.at(-1))
    await collect(index.managedResponsesStream(request, config, ctx))
    assert.deepEqual(wire(bodies.at(-1)), expected)
  })
}

test('the first deferred load has no orphan incremental notice or prelude provenance', async t => {
  const { adapter, bodies, route, model } = await fixture(t, 'changes')
  const tools = [tool('b', 'b', true)]
  const messages = [system, update(add('b')), user('go')]
  await collect(adapter.stream({ ...route, messages, tools }))
  const prepared = await serializeDshMessages(messages.slice(1), undefined, { route, model, systemPrompt: 'be brief', includeSystemPrompt: true, tools, systemPromptUpdate: 'in-history', toolUpdate: 'addition-only', tracePrelude: true })
  assert.deepEqual(wire(prepared), wire(bodies.at(-1)))
  assert.equal(prepared.preludeItemCount, 1)
  assert.deepEqual(prepared.supersededInstructionItems, [], 'the genuine prompt is never classified as a Pi notice')
})
