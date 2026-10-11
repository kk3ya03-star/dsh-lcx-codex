import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Llm from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { collect, loadSource } from './issue119-source.mjs'

// Issue 119 item 2: GPT routes must honour the profile's `reasoningEfforts` (wire mapping, `false`
// for a non-reasoning model) and must not assume `reasoning: true` for a model DSH itself resolves as
// non-reasoning. These tests run the real DSH Llm service and the real dsh-llm-pi-ai adapter; only
// fetch is mocked.

const index = await loadSource('index', 'managedResponsesStream, serializeNativeAware')
const route = await loadSource('route')
const baseURL = 'https://fixture.invalid/v1'
const PROVIDERS = {
  gw: { api: 'openai-responses', baseURL, models: [{ id: 'gpt-custom', reasoningEfforts: { high: 'gateway-high', low: 'gateway-low' } }] },
  gw0: { api: 'openai-responses', baseURL, models: [{ id: 'gpt-nothink', reasoningEfforts: false }] },
  relay: { api: 'openai-responses', baseURL, models: [{ id: 'gpt-4.1' }, { id: 'gpt-5.6-sol' }] },
  openai: {},
}

async function fixture(t) {
  const ctx = new Context()
  ctx.plugin(Llm)
  ctx.plugin(PiAi, { providers: PROVIDERS })
  await new Promise((resolve) => setTimeout(resolve, 800))
  ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-only' }) }, true)
  const bodies = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)))
    return new Response('', { status: 500 })
  })
  return { ctx, bodies }
}

// The routeConfig is what resolveResponsesRouteConfig builds from the DSH profile; run the real
// resolver over a settings fixture identical to what the plugin sees.
async function routeFor(ctx, provider, model) {
  const profiles = {
    [provider]: PROVIDERS[provider],
  }
  const routeCtx = {
    llm: { listConfigurableProviders: () => Object.keys(profiles).map((name) => ({ provider: name, displayName: name, settingsNs: 'llm-pi-ai', settingsPath: ['providers', name] })) },
    settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [name, { apiKeyEnv: 'FIXTURE_KEY', ...profile }])) } }] },
  }
  const resolved = route.resolveResponsesRouteConfig(routeCtx, { provider, model }, { timeoutMs: 5000, maxAttempts: 1 })
  assert.ok(resolved, `route resolves for ${provider}/${model}`)
  return { ...resolved, baseURL, portableReplayMaxChars: 200000 }
}

async function send(ctx, provider, model, reasoningEffort) {
  const routeConfig = await routeFor(ctx, provider, model)
  const request = {
    provider, model, sessionId: 'sid-119',
    messages: [
      { role: 'system', source: { kind: 'system' }, content: [{ type: 'text', text: 'be brief' }] },
      { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] },
    ],
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    signal: AbortSignal.timeout(5000),
  }
  const chunks = await collect(index.managedResponsesStream(request, routeConfig, ctx))
  return chunks.find((chunk) => chunk.type === 'finish')
}

test('profile reasoningEfforts mapping reaches the wire', async (t) => {
  const { ctx, bodies } = await fixture(t)
  await send(ctx, 'gw', 'gpt-custom', 'high')
  assert.deepEqual(bodies.at(-1).reasoning, { effort: 'gateway-high', summary: 'auto' })
  await send(ctx, 'gw', 'gpt-custom', 'low')
  assert.deepEqual(bodies.at(-1).reasoning, { effort: 'gateway-low', summary: 'auto' })
  // `off` is not declared, so DSH offers no off level and no default `none` effort may be invented.
  await send(ctx, 'gw', 'gpt-custom', undefined)
  assert.equal(bodies.at(-1).reasoning, undefined)
})

test('an effort the profile does not declare is refused like Grok and the DSH adapter do', async (t) => {
  const { ctx, bodies } = await fixture(t)
  const before = bodies.length
  const finish = await send(ctx, 'gw', 'gpt-custom', 'medium')
  assert.equal(finish.reason.kind, 'error')
  assert.equal(finish.reason.failure.code, 'UNSUPPORTED_OPTION')
  assert.equal(bodies.length, before, 'nothing is sent upstream')
})

test('reasoningEfforts:false means a non-reasoning model: no reasoning field, no efforts accepted', async (t) => {
  const { ctx, bodies } = await fixture(t)
  await send(ctx, 'gw0', 'gpt-nothink', undefined)
  assert.equal(bodies.at(-1).reasoning, undefined)
  assert.equal(bodies.at(-1).include, undefined)
  const before = bodies.length
  const finish = await send(ctx, 'gw0', 'gpt-nothink', 'high')
  assert.equal(finish.reason.failure.code, 'UNSUPPORTED_OPTION')
  assert.equal(bodies.length, before)
  // a non-reasoning model keeps the plain instruction role
  await send(ctx, 'gw0', 'gpt-nothink', undefined)
  const roles = bodies.at(-1).input.map((item) => item.role)
  assert.ok(roles.includes('system') && !roles.includes('developer'), `instruction role ${JSON.stringify(roles)}`)
})

test('a non-catalog model that DSH resolves as non-reasoning is not given reasoning:true', async (t) => {
  const { ctx, bodies } = await fixture(t)
  const info = await ctx.llm.resolveModelInfo('relay', 'gpt-4.1')
  assert.equal(info.reasoning, undefined, 'DSH offers no reasoning for it')
  await send(ctx, 'relay', 'gpt-4.1', undefined)
  assert.equal(bodies.at(-1).reasoning, undefined)
  const finish = await send(ctx, 'relay', 'gpt-4.1', 'high')
  assert.equal(finish.reason.failure.code, 'UNSUPPORTED_OPTION')
})

test('catalog models keep their wire behaviour', async (t) => {
  const { ctx, bodies } = await fixture(t)
  await send(ctx, 'openai', 'gpt-5.6-sol', 'high')
  assert.deepEqual(bodies.at(-1).reasoning, { effort: 'high', summary: 'auto' })
  assert.deepEqual(bodies.at(-1).include, ['reasoning.encrypted_content'])
  await send(ctx, 'openai', 'gpt-5.6-sol', undefined)
  assert.deepEqual(bodies.at(-1).reasoning, { effort: 'none' })
  const roles = bodies.at(-1).input.map((item) => item.role)
  assert.ok(roles.includes('developer'), `catalog reasoning model keeps the developer role: ${JSON.stringify(roles)}`)
  // gpt-4.1 in the catalog is non-reasoning
  await send(ctx, 'openai', 'gpt-4.1', undefined)
  assert.equal(bodies.at(-1).reasoning, undefined)
})
