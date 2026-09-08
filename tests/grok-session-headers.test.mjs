import test from 'node:test'
import assert from 'node:assert/strict'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-responses'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { grokNativeReplayRouteFingerprint } from '../lib/grok-native-search.js'
import { collect, grokHarness, sseResponse, user, xaiProfile } from './grok-fixture.mjs'

const builtin = getBuiltinModels('xai').find(model => model.id === 'grok-4.6')
const answer = { type: 'message', id: 'msg_identity', role: 'assistant', content: [{ type: 'output_text', text: 'fixture', annotations: [] }] }
const response = (output = [answer]) => sseResponse([{ type: 'response.completed', response: {
  id: 'resp_identity', model: 'grok-4.6', status: 'completed', output,
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
} }])
const options = (sessionId, messages = [user('fixture')]) => ({ provider: 'xai', model: 'grok-4.6', sessionId, reasoningEffort: 'high', messages })
const unexpected = () => { throw new Error('Unexpected DSH fallback') }
function hierarchy(h) {
  h.ctx.sessions.get = id => ({ id, header: id === 'parent-59' ? {} : { origin: 'subagent', parentSession: 'parent-59' } })
}
// Exact DSH alpha.2 requestHeaders contract; independent installed-source oracle
// additionally checks this projection with the actual installed resolver.
function dshHeaders(headers = {}) {
  const attribution = attributionHeaders()
  const owned = new Set(Object.keys(attribution).map(key => key.toLowerCase()))
  return { ...Object.fromEntries(Object.entries(headers).filter(([key]) => !owned.has(key.toLowerCase()))), ...attribution }
}

for (const fixture of [
  { name: 'foreground', sessionId: 'parent-59' },
  { name: 'first child', sessionId: 'child-a-59' },
  { name: 'sibling child', sessionId: 'child-b-59' },
  { name: 'cache disabled child', sessionId: 'child-a-59', retention: 'none' },
  ...['user-agent', 'User-Agent'].map(key => ({ name: key, sessionId: 'child-a-59', headers: { [key]: 'ignored-user-agent', 'x-custom': 'preserved' } })),
  ...['authorization', 'Authorization'].map(key => ({ name: key, sessionId: 'child-a-59', headers: { [key]: 'Bearer SYNTHETIC_OVERRIDE' } })),
  ...['session_id', 'Session_Id', 'x-session-id', 'Session-Id', 'x-client-request-id'].map(key => ({ name: key, sessionId: 'child-a-59', headers: { [key]: 'explicit-fixture' } })),
]) test(`Grok ${fixture.name} identity/headers match native DSH/Pi`, async t => {
  let expected, actual
  const capture = init => ({ body: JSON.parse(String(init.body)), headers: new Headers(init.headers) })
  const native = streamSimple({ ...builtin, baseUrl: 'https://fixture.invalid/v1' }, { messages: [] }, {
    apiKey: 'synthetic-test-key', maxRetries: 0, reasoning: 'high',
    sessionId: fixture.sessionId, cacheRetention: fixture.retention ?? 'short', headers: dshHeaders(fixture.headers),
    fetch: async (_url, init) => { expected = capture(init); return response() },
  })
  await native.result()
  t.mock.method(globalThis, 'fetch', async (_url, init) => { actual = capture(init); return response() })
  const h = grokHarness({ nativeX: true, profiles: { xai: { ...xaiProfile, headers: fixture.headers, cacheRetention: fixture.retention ?? 'short' } } })
  hierarchy(h)
  const chunks = await collect(h.stream(options(fixture.sessionId), unexpected))
  assert.equal(chunks.at(-1).reason.kind, 'stop')
  assert.ok(expected)
  assert.equal(actual.body.prompt_cache_key, expected.body.prompt_cache_key)
  for (const key of ['user-agent', 'authorization', 'session_id', 'session-id', 'x-session-id', 'x-client-request-id', 'x-custom'])
    assert.equal(actual.headers.get(key), expected.headers.get(key), key)
})

for (const retention of ['short', 'none'])
test(`Grok child replay ignores attribution overrides but retains child/ordinary-header binding (${retention})`, async t => {
  const call = { type: 'function_call', id: 'fc_59', call_id: 'call_59', name: 'read', arguments: '{}' }
  const original = [{ type: 'x_search_call', id: 'xs_59', status: 'completed' }, call]
  let request
  t.mock.method(globalThis, 'fetch', async (_url, init) => { request = JSON.parse(String(init.body)); return response(original) })
  const profiles = { xai: { ...xaiProfile, cacheRetention: retention, headers: { 'User-Agent': 'ignored-a', 'x-custom': 'route-a' } } }
  const h = grokHarness({ nativeX: true, profiles }); hierarchy(h)
  const chunks = await collect(h.stream(options('child-a-59'), unexpected))
  const finish = chunks.find(chunk => chunk.type === 'finish')
  assert.equal(finish.replayState.grokNative.sourceSessionId, 'child-a-59')
  assert.equal(finish.replayState.grokNative.routeAuthorityFingerprint, grokNativeReplayRouteFingerprint({
    provider: 'xai', model: 'grok-4.6', sessionId: 'child-a-59',
    baseURL: xaiProfile.baseURL, apiKeyEnv: xaiProfile.apiKeyEnv, headers: { 'x-custom': 'route-a' },
  }), 'same selected headers keep the previous v2 fingerprint; generated attribution is not selected authority')
  const assistant = { role: 'assistant', source: { kind: 'model', provider: 'xai', model: 'grok-4.6', replayState: finish.replayState }, content: chunks.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block) }
  const result = { role: 'user', source: { kind: 'tool', callId: 'call_59|fc_59' }, content: [{ type: 'tool-result', toolCallId: 'call_59|fc_59', toolName: 'read', content: [{ type: 'text', text: 'fixture' }] }] }
  const history = JSON.parse(JSON.stringify([user('fixture'), assistant, result]))
  globalThis.fetch.mock.mockImplementation(async (_url, init) => { request = JSON.parse(String(init.body)); return response() })
  profiles.xai.headers = { 'user-agent': 'ignored-b', 'x-custom': 'route-a' }
  await collect(h.stream(options('child-a-59', history), unexpected))
  assert.ok(request.input.some(item => item.type === 'x_search_call'), 'ignored UA changes must not invalidate replay')
  assert.equal(request.prompt_cache_key, retention === 'none' ? undefined : 'child-a-59')
  await collect(h.stream(options('child-b-59', history), unexpected))
  assert.equal(request.input.some(item => item.type === 'x_search_call'), false, 'sibling cannot restore opaque state')
  profiles.xai.headers = { 'user-agent': 'ignored-b', 'x-custom': 'route-b' }
  await collect(h.stream(options('child-a-59', history), unexpected))
  assert.equal(request.input.some(item => item.type === 'x_search_call'), false, 'effective custom header remains authority-bound')
})
