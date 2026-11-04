import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Llm from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { collect, loadSource } from './issue119-source.mjs'

// Issue #129: Pi 1.3.0 parses a finished tool call's arguments strictly. Malformed final JSON no longer runs with
// the fields parsed before the error, and an invalid `\u` escape (as in `\usepackage`) no longer drops fields.
// LCX parses the stream with the bundled Pi, DSH with its own; the tool call each hands to DSH must be the same.

const index = await loadSource('index', 'managedResponsesStream')
const route = await loadSource('route')
const baseURL = 'https://fixture.invalid/v1'
const PROFILES = { openai: { apiKeyEnv: 'FIXTURE_KEY', baseURL, models: [{ id: 'gpt-5.6-sol', name: 'gpt-5.6-sol', contextWindow: 272000, maxTokens: 128000, input: ['text'] }] } }

function toolCallReply(args) {
  const item = { type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'write', arguments: args, status: 'completed' }
  const events = [
    { type: 'response.created', response: { id: 'resp_tool', model: 'fixture', status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '', status: 'in_progress' } },
    { type: 'response.function_call_arguments.delta', output_index: 0, item_id: item.id, delta: args },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'resp_tool', model: 'fixture', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 } } } },
  ]
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
}

async function fixture(t, args) {
  const ctx = new Context()
  ctx.plugin(Llm)
  ctx.plugin(PiAi, { providers: structuredClone(PROFILES) })
  await new Promise(resolve => setTimeout(resolve, 800))
  ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-only' }) }, true)
  t.mock.method(globalThis, 'fetch', async () => toolCallReply(args))
  const routeCtx = {
    llm: { listConfigurableProviders: () => [{ provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] }] },
    settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { openai: PROFILES.openai } } }] },
  }
  const routeConfig = { ...route.resolveResponsesRouteConfig(routeCtx, { provider: 'openai', model: 'gpt-5.6-sol' }, { timeoutMs: 5000, maxAttempts: 1 }), baseURL, portableReplayMaxChars: 200000 }
  return { ctx, routeConfig }
}

const tools = [{ name: 'write', description: 'write a file', parameters: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } } } }]
const messages = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'write it' }] }]
const toolCall = chunks => chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')?.block

for (const [label, args, expected] of [
  ['malformed final JSON carries no partly parsed fields', '{"path":"a.tex","text":"x"', {}],
  ['an invalid \\u escape keeps every field', '{"path":"a.tex","text":"\\usepackage{x}"}', { path: 'a.tex', text: '\\usepackage{x}' }],
]) {
  test(`${label}, through DSH's adapter and through LCX alike`, async t => {
    const { ctx, routeConfig } = await fixture(t, args)
    const host = toolCall(await collect(ctx.llm.stream({ provider: 'openai', model: 'gpt-5.6-sol', messages, tools })))
    const lcx = toolCall(await collect(index.managedResponsesStream({ provider: 'openai', model: 'gpt-5.6-sol', sessionId: 'sid-129', messages, tools, signal: AbortSignal.timeout(5000) }, routeConfig, ctx)))
    assert.ok(host && lcx, 'both paths emit the tool call')
    assert.deepEqual(JSON.parse(lcx.arguments), expected)
    assert.deepEqual(JSON.parse(lcx.arguments), JSON.parse(host.arguments))
    assert.equal(lcx.name, host.name)
  })
}
