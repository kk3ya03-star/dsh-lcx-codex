import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { recentAlphaInput } from '../lib/web-search-alpha-history.js'
import { buildAlphaSearchBody, normalizeAlphaSearchArgs, remapAlphaResultRefs } from '../lib/web-search-alpha.js'
import { AlphaRefStore } from '../lib/web-search-ref-store.js'

test('real DSH surface produces bounded visible Alpha history in conversation order', () => {
  const session = Session.create(SessionId('issue95-history'))
  const user = (text) => session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' })
  user('old request')
  user('browse documentation')
  session.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({
    source: { provider: 'lcx', model: 'gpt-fixture' },
    content: [{ type: 'text', text: 'I will search.' }, { type: 'reasoning', text: 'private thought' },
      { type: 'tool-call', id: 'call-search', name: 'websearch_alpha', arguments: '{"action":"search_query","query":"docs"}' }],
  }) }, { surfaceOp: 'append' })
  session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({
    callId: 'call-search', content: [{ type: 'text', text: 'Result opaqueRef=turn0search0 lcx-alpha-local-handle' }], isError: false,
  }) }, { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 1, step: 2, message: createAssistantMessage({
    source: { provider: 'lcx', model: 'gpt-fixture' },
    content: [{ type: 'tool-call', id: 'call-open', name: 'websearch_alpha', arguments: '{"action":"open","refId":"turn0search0"}' }],
  }) }, { surfaceOp: 'append' })
  user('continue')
  const input = recentAlphaInput(session.deriveMessages())
  assert.deepEqual(input.map((item) => item.role), ['user', 'assistant', 'user'])
  assert.deepEqual(input.map((item) => item.content[0].type), ['input_text', 'output_text', 'input_text'])
  assert.doesNotMatch(JSON.stringify(input), /old request|private thought|call-open|call-search|turn0search0|lcx-alpha-local-handle|function_call/)
  const body = buildAlphaSearchBody(normalizeAlphaSearchArgs({ action: 'open', refId: 'turn0search0' }), 'gpt-fixture', String(session.id), true, 2500, input)
  assert.equal(body.id, String(session.id))
  assert.deepEqual(body.commands.open, [{ ref_id: 'turn0search0' }])
  for (const forbidden of ['previous_response_id', 'encrypted_content', 'Session_ID', 'Conversation_ID', 'X-Codex-Turn-State'])
    assert.equal(JSON.stringify(body).includes(forbidden), false)
})

test('history keeps two real user text messages and an earliest-first 1000-token assistant budget', () => {
  const history = [
    createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'old' }] }),
    createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'x'.repeat(30000) }, { type: 'image', data: 'image-only' }] }),
    createAssistantMessage({ source: { provider: 'lcx', model: 'gpt-fixture' }, content: [{ type: 'text', text: 'a'.repeat(3000) }, { type: 'text', text: 'b'.repeat(3000) }] }),
    createToolResultMessage({ callId: 'unrelated', content: [{ type: 'text', text: 'private unrelated result' }], isError: false }),
    createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'latest' }] }),
    createAssistantMessage({ source: { provider: 'lcx', model: 'gpt-fixture' }, content: [{ type: 'text', text: 'after latest user' }] }),
  ]
  const input = recentAlphaInput(history)
  assert.deepEqual(input.map((item) => item.role), ['user', 'assistant', 'user'])
  assert.equal(input[0].content[0].text.length, 30000)
  assert.equal(input[0].content.length, 1)
  assert.equal(input[1].content[0].text.length, 3000)
  assert.match(input[1].content[1].text, /^b+…500 tokens truncated…b+$/)
  assert.doesNotMatch(JSON.stringify(input), /old|image-only|private unrelated result|after latest user/)
  assert.equal(recentAlphaInput([history[2], history[3]]), undefined)
})

test('reused raw ref gets a new handle; old observation never rebinds across reload or scope', t => {
  const directory = mkdtempSync(join(tmpdir(), 'issue95-refs-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const store = new AlphaRefStore(join(directory, 'refs.json'))
  const observe = (fingerprint, url) => ({ refId: 'turn0search0', url, provenance: { action: 'search_query', originKind: 'request', originFingerprint: fingerprint.repeat(64) } })
  store.record('parent', 'route-a', [observe('a', 'https://example.com/one')])
  const original = store.assertUsable('parent', 'route-a', 'turn0search0')
  const handles = store.record('parent', 'route-a', [observe('b', 'https://example.com/two')], true)
  const handle = handles.turn0search0
  assert.match(handle, /^lcx-alpha-[a-f0-9]{64}$/)
  assert.notEqual(handle, 'turn0search0')
  const cold = new AlphaRefStore(join(directory, 'refs.json'))
  assert.deepEqual(cold.store.data.sessions.parent.refs.turn0search0, original)
  assert.equal(cold.assertUsable('parent', 'route-a', handle).rawRefId, 'turn0search0')
  assert.throws(() => cold.assertUsable('parent', 'route-a', 'turn0search0'), { code: 'LCX_ALPHA_REF_UNAVAILABLE' })
  for (const [session, route] of [['child', 'route-a'], ['parent', 'route-b']])
    assert.throws(() => cold.assertUsable(session, route, handle), { code: 'LCX_ALPHA_REF_UNAVAILABLE' })
  const visible = remapAlphaResultRefs({ content: 'citeturn0search0', refs: ['turn0search0'], sources: [{ refId: 'turn0search0', url: 'https://example.com/turn0search0' }] }, handles)
  assert.match(visible.content, new RegExp(handle))
  assert.deepEqual(visible.refs, [handle])
  assert.equal(visible.sources[0].refId, handle)
  assert.equal(visible.sources[0].url, 'https://example.com/turn0search0')
  const third = cold.record('parent', 'route-a', [observe('c', 'https://example.com/three')], true).turn0search0
  assert.notEqual(third, handle)
  assert.throws(() => cold.assertUsable('parent', 'route-a', handle), { code: 'LCX_ALPHA_REF_UNAVAILABLE' })
  assert.equal(cold.assertUsable('parent', 'route-a', third).url, 'https://example.com/three')
  const returned = cold.record('parent', 'route-a', [observe('a', 'https://example.com/one')], true).turn0search0
  assert.notEqual(returned, 'turn0search0')
  assert.equal(cold.assertUsable('parent', 'route-a', returned).url, 'https://example.com/one')
})
