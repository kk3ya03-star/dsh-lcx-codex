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

// Issue #129: DSH's GenerateOptions carries a request-level `system` text. The host adapter joins it with every
// leading system message into the prompt ("\n\n"), on every route. LCX answered GPT turns with only the first
// leading system message, so a caller that passes `system` (DSH's auto-review reviewer) lost its policy. Everything
// below runs the real DSH Llm service and the real llm-pi-ai adapter (the host) next to LCX; only fetch is captured.

const hostRequire = createRequire(import.meta.resolve('@deepseek-ai/dsh-llm-pi-ai'))
const hostRoot = hostRequire.resolve.paths('@earendil-works/pi-ai').map(path => join(path, '@earendil-works/pi-ai/dist')).find(path => existsSync(join(path, 'index.js')))
const hostPi = await import(pathToFileURL(join(hostRoot, 'index.js')).href)
const api = await import(pathToFileURL(join(hostRoot, 'api/openai-responses.js')).href)
const { getBuiltinModels } = await import(pathToFileURL(join(hostRoot, 'providers/all.js')).href)
const index = await loadSource('index', 'managedResponsesStream')
const baseURL = 'https://fixture.invalid/v1'
const user = text => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
const system = (text, kind = 'system') => ({ role: 'system', content: [{ type: 'text', text }], source: { kind } })
const instructions = body => body.input.filter(item => (item.role === 'developer' || item.role === 'system') && typeof item.content === 'string').map(item => item.content)
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

async function fixture(t, id) {
  const model = { ...getBuiltinModels('openai').find(candidate => candidate.id === id), baseUrl: baseURL }
  const provider = hostPi.createProvider({ id: 'openai', models: [model], auth: { apiKey: { resolve: async () => ({ auth: { apiKey: 'fixture-only' }, source: 'fixture' }) } }, api })
  const profile = { provider: 'openai', displayName: 'fixture', piProvider: provider, modelErrors: new Map(), configuredMaxTokens: new Map(), streamIdleTimeoutMs: 5000 }
  const profiles = new Map([['openai', profile]])
  const ctx = new Context()
  ctx.plugin(Llm)
  await new Promise(resolve => setTimeout(resolve, 50))
  ctx.llm.registerAdapter(['openai'], new PiAiAdapter({ profiles: () => profiles, resolveApiKey: async () => 'fixture-only' }))
  ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-only' }) }, true)
  const bodies = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)))
    return reply('fixture')
  })
  const route = { provider: 'openai', model: id, sessionId: 'sid-system-parity' }
  const config = { baseURL, responsesCompat: model.compat, modelDefaults: model, portableReplayMaxChars: 200000, maxAttempts: 1 }
  /** One request through the real host and through LCX: both wire bodies, in that order. */
  const both = async request => {
    await collect(ctx.llm.stream({ ...route, ...request }))
    const host = bodies.at(-1)
    const chunks = await collect(index.managedResponsesStream({ ...route, ...request, signal: AbortSignal.timeout(5000) }, config, ctx))
    assert.equal(chunks.at(-1)?.reason?.kind, 'stop', JSON.stringify(chunks.at(-1)))
    return [host, bodies.at(-1)]
  }
  return { both, ctx }
}

const replay = { kind: 'model', provider: 'foreign', model: 'foreign' }
const cases = {
  'system only': { system: 'request policy', messages: [user('one')], prompt: 'request policy' },
  'system and a leading system message': { system: 'request policy', messages: [system('be brief'), user('one')], prompt: 'request policy\n\nbe brief' },
  'two leading system messages': { messages: [system('be brief'), system('and exact'), user('one')], prompt: 'be brief\n\nand exact' },
  'no system (unchanged)': { messages: [system('be brief'), user('one')], prompt: 'be brief' },
}
// DSH writes a changed prompt into history only on in-history routes; it stays in place there, after the prompt.
const snapshot = {
  system: 'request policy',
  messages: [system('be brief'), user('one'), { role: 'assistant', source: replay, content: [{ type: 'text', text: 'a' }] }, system('updated prompt', 'system-prompt'), user('two')],
  prompt: 'request policy\n\nbe brief',
  later: ['updated prompt'],
}

// gpt-6.1-sol is a `changes`-mode, in-history route; gpt-5.2 has no in-history system prompt updates.
for (const [id, inHistory] of [['gpt-6.1-sol', true], ['gpt-5.2', false]]) {
  test(`${id}: LCX composes the system prompt exactly like the real host`, async t => {
    const { both } = await fixture(t, id)
    const tools = [{ name: 'a', description: 'a', parameters: { type: 'object', properties: {}, additionalProperties: false } }]
    const all = inHistory ? { ...cases, 'system and an in-history prompt snapshot': snapshot } : cases
    for (const [name, { prompt, later = [], ...request }] of Object.entries(all)) {
      const [host, lcx] = await both({ ...request, tools })
      assert.deepEqual(wire(lcx), wire(host), name)
      assert.deepEqual(instructions(host), [prompt, ...later], name)
    }
  })
}

test('an auto-review-shaped call (purpose, system policy, no tools) reaches the model with its policy', async t => {
  const { both } = await fixture(t, 'gpt-6.1-sol')
  const policy = 'REVIEW_POLICY\nAnswer with exactly one JSON object.'
  const [host, lcx] = await both({ purpose: 'auto-review', system: policy, messages: [user('Pending action: run `ls`')], temperature: 0 })
  assert.deepEqual(wire(lcx), wire(host))
  assert.equal(lcx.tools, undefined)
  assert.deepEqual(instructions(lcx), [policy])
  assert.deepEqual(lcx.input.at(-1), { role: 'user', content: [{ type: 'input_text', text: 'Pending action: run `ls`' }] })
})
