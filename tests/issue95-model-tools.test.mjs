import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Agents, { installModelSelection } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import Sessions, { Session, SessionId } from '@deepseek-ai/dsh-session'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import QuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import apply from '../lib/index.js'
import { pluginConfig, providerContext } from './dsh02-fixture.mjs'
import { AlphaCapabilityStore, alphaCapabilityFingerprint } from '../lib/web-search-capability.js'
import { ALPHA_PROBE_VERSION, ALPHA_SCHEMA_FINGERPRINT } from '../lib/web-search-alpha.js'
import { readSelectedAgentRouteState } from '../lib/dsh-compat.js'

class FixtureAdapter extends LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, context: { contextWindow: 200000 } }
  }
  async *stream() { yield { type: 'finish', reason: { kind: 'stop' } } }
}

for (const projected of [false, true]) test(`real DSH selected model changes project the new scoped tools on the first request (projection=${projected})`, async t => {
  const root = await mkdtemp(resolve('.issue95-model-tools-'))
  const ctx = new Context()
  let handle
  t.after(async () => { await handle?.dispose(); await rm(root, { recursive: true, force: true }) })
  t.mock.method(globalThis, 'fetch', () => { assert.fail('provider calls are forbidden') })
  ctx.plugin(Llm)
  ctx.plugin(Sessions)
  ctx.plugin(Jsonl, { root: resolve(root, 'sessions') })
  ctx.plugin(QuerySqlite, { path: ':memory:', openAt: 'never' })
  ctx.plugin(Projections)
  ctx.plugin(SystemPrompt)
  ctx.plugin(Tools)
  ctx.plugin(Agents)
  ctx.plugin(AgentLoop)
  await new Promise(resolve => setTimeout(resolve, 500))
  if (projected) {
    const { installModelSelectionProjection } = await import('../node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/model-selection-projection.js')
    installModelSelectionProjection(ctx)
  }
  ctx.llm.registerAdapter(['fixture', 'xai'], new FixtureAdapter())
  const baseURL = 'https://fixture.invalid/v1'
  const capabilityPath = resolve(root, 'capabilities.json')
  const store = new AlphaCapabilityStore(capabilityPath)
  for (const [model, actions, classification] of [
    ['gpt-luna', { search_query: 'supported', open: 'supported', find: 'supported', image_query: 'unsupported' }, 'command-capable'],
    ['gpt-sol', { search_query: 'supported', open: 'supported', find: 'supported', image_query: 'supported' }, 'command-capable'],
    ['gpt-unknown', { search_query: 'supported' }, 'unknown'],
  ]) store.put(alphaCapabilityFingerprint({ provider: 'fixture', model, baseURL, profile: '', group: '', schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT }), {
    classification, actions, probedAt: '2026-09-29T00:00:00.000Z', schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT, probeVersion: ALPHA_PROBE_VERSION, provenance: 'unavailable',
  })
  const profiles = providerContext({ fixture: { api: 'openai-responses', baseURL, apiKeyEnv: 'FIXTURE_KEY' } })
  const pluginCtx = {
    llm: profiles.llm, sessions: ctx.sessions, tools: ctx.tools,
    settings: { ...profiles.settings, configure: () => () => {} },
    web: {}, credentials: {}, attachments: {}, fs: {},
    logger: { info() {}, warn(message) { assert.fail(message) } },
    get(name) { return this[name] },
    on: ctx.on.bind(ctx), effect() {}, inject() {},
  }
  apply(pluginCtx, pluginConfig({ enabled: true, webSearch: true, advancedHostedSearch: true, alphaSearch: true, alphaCapabilityPath: capabilityPath, alphaRefPath: resolve(root, 'refs.json') }))
  const requests = []
  // Observe the real request after projection and terminate locally before LCX transport.
  ctx.on('llm/stream', options => {
    requests.push(options)
    return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })()
  }, { prepend: true })
  const selection = { current: { provider: 'xai', model: 'grok-fixture' }, assembled: undefined }
  handle = await ctx.agents.create({ sessionId: SessionId('issue95-model-tools'), meta: { cwd: root }, agentOptions: selection.current,
    setup(agentCtx) { installModelSelection(agentCtx, selection) },
  })
  const { agent } = handle
  if (projected) {
    const cold = Session.create(SessionId('issue95-cold-selection'))
    const pending = { provider: 'fixture', model: 'gpt-luna' }
    cold.append('model/selection', pending)
    assert.deepEqual(readSelectedAgentRouteState({ session: cold, options: selection.current, ctx: agent.ctx }).requestConfig, pending)
  }
  const ask = async () => {
    const before = requests.length
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'fixture request' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    assert.equal(requests.length, before + 1)
    return requests.at(-1)
  }
  let request = await ask()
  assert.equal(request.tools?.some(tool => tool.name === 'websearch_alpha') ?? false, false)
  assert.equal(request.tools?.some(tool => tool.name === 'websearch_gpt_advanced') ?? false, false)
  for (const model of ['gpt-luna', 'gpt-sol', 'gpt-unknown', 'grok-fixture', 'gpt-luna']) {
    const selected = { provider: model.startsWith('gpt-') ? 'fixture' : 'xai', model }
    // Exact public session/selectModel seam: append first, then update selection.current.
    agent.session.append('model/selection', selected)
    selection.current = selected
    const oldHeader = agent.session.snapshotEvents().findLast(event => event.type === 'request/header')
    agent.session.append('request/header', oldHeader.data)
    assert.deepEqual(readSelectedAgentRouteState(agent).requestConfig, selected)
    // A settings refresh before the request must not resurrect the previous header.
    ctx.emit('settings/document-updated')
    request = await ask()
    assert.equal(request.model, model)
    const alpha = request.tools?.find(tool => tool.name === 'websearch_alpha')
    assert.equal(Boolean(alpha), ['gpt-luna', 'gpt-sol'].includes(model))
    assert.equal(request.tools?.some(tool => tool.name === 'websearch_gpt_advanced') ?? false, model.startsWith('gpt-'))
    if (alpha) assert.equal(alpha.parameters.properties.action.enum.includes('image_query'), model === 'gpt-sol')
  }
})
