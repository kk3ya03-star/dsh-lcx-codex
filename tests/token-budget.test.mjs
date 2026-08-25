import test from 'node:test'
import assert from 'node:assert/strict'

import {
  estimateBudgetItem,
  estimateTextTokens,
  portableTokenCeiling,
} from '../lib/token-budget.js'
import {
  ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP,
  portableMessagesForCheckpoint,
  retainedConversationPlan,
  stateFromSummaryEvent,
  stateRouteCompatible,
} from '../lib/native-checkpoint.js'
import { baseURLFingerprint } from '../lib/route.js'

const textMessage = (role, text) => ({
  type: 'message',
  role,
  content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }],
})

const toolCallMessage = (id, argumentsText) => ({
  role: 'assistant',
  content: [{ type: 'tool-call', id, name: 'lookup', arguments: argumentsText }],
})

const toolResultMessage = (id, text) => ({
  role: 'user',
  content: [{ type: 'tool-result', toolCallId: id, toolName: 'lookup', content: [{ type: 'text', text }] }],
})

function checkpointSession(messages, id = 'checkpoint-fixture') {
  const events = messages.map((message, seq) => ({
    seq,
    type: message.role === 'assistant' ? 'assistant/message' : message.content?.[0]?.type === 'tool-result' ? 'tool/result' : 'user/message',
    data: message.role === 'assistant' ? { message } : message.content?.[0]?.type === 'tool-result' ? { message } : message,
  }))
  events.push({ seq: events.length, type: 'compaction/summary', data: { compactionId: id, shadowedSeqs: messages.map((_, index) => index) } })
  return { events }
}

test('token fixture 1: English prose is deterministic and never cheaper than legacy /4', () => {
  const text = 'A concise English sentence has ordinary words and spaces.'
  assert.equal(estimateTextTokens(text), estimateTextTokens(text))
  assert.ok(estimateTextTokens(text) >= Math.ceil(text.length / 4))
})

test('token fixture 2: CJK-heavy text is materially more conservative than legacy /4', () => {
  const text = '中文上下文保留预算必须对高密度文字保持保守估算。'.repeat(20)
  assert.ok(estimateTextTokens(text) > Math.ceil(text.length / 4) * 2)
})

test('token fixture 3: JSON-heavy text is not cheaper than legacy /4', () => {
  const text = JSON.stringify(Array.from({ length: 30 }, (_, index) => ({ index, enabled: true, value: `item-${index}` })))
  assert.ok(estimateTextTokens(text) >= Math.ceil(text.length / 4))
})

test('token fixture 4: code and punctuation-heavy text is not cheaper than legacy /4', () => {
  const text = 'const f=(x)=>({ok:x!==null&&x?.id?.includes("/")});\n'.repeat(50)
  assert.ok(estimateTextTokens(text) >= Math.ceil(text.length / 4))
})

test('token fixture 5: URL and UUID-heavy text is not cheaper than legacy /4', () => {
  const text = 'https://api.example.test/v1/items/123e4567-e89b-12d3-a456-426614174000?trace=abc-def '.repeat(30)
  assert.ok(estimateTextTokens(text) >= Math.ceil(text.length / 4))
})

test('token fixture 6: truncated assistant item including marker and structure stays within 3k', () => {
  const plan = retainedConversationPlan([textMessage('assistant', ('中文 code::{"value":"x"};\n').repeat(3_000))])
  assert.equal(plan.assistantCount, 1)
  assert.ok(estimateBudgetItem(plan.items[0]) <= ASSISTANT_RETENTION_PER_MESSAGE_TOKEN_CAP)
  assert.match(plan.items[0].content[0].text, /LCX retained answer truncated/u)
})

test('token fixture 7: mixed client and assistant accounting honors 64k total and 24k assistant reserve', () => {
  const input = [
    textMessage('user', 'client '.repeat(25_000)),
    textMessage('assistant', 'assistant '.repeat(12_000)),
  ]
  const plan = retainedConversationPlan(input)
  assert.ok(plan.estimatedTokens <= 64_000)
  assert.ok(plan.assistantEstimatedTokens <= 24_000)
  assert.equal(plan.estimatedTokens, plan.clientEstimatedTokens + plan.assistantEstimatedTokens)
})

test('token fixture 8: native retention stays newest-first while returning original order', () => {
  const plan = retainedConversationPlan([
    textMessage('user', 'old '.repeat(4_000)),
    textMessage('user', 'middle '.repeat(4_000)),
    textMessage('user', 'newest'),
  ], { tokenBudget: 100 })
  assert.deepEqual(plan.items.map((item) => item.content[0].text), ['newest'])
})

test('token fixture 9: native retention never overshoots its hard budget', () => {
  const plan = retainedConversationPlan([
    textMessage('user', 'first '.repeat(10_000)),
    textMessage('user', 'second '.repeat(10_000)),
  ], { tokenBudget: 100 })
  assert.ok(plan.estimatedTokens <= 100)
})

test('token fixture 10: unknown and unserializable content fails conservative budgeting', () => {
  const cyclic = {}
  cyclic.self = cyclic
  assert.equal(estimateBudgetItem({ role: 'user', content: [{ type: 'private_opaque', value: cyclic }] }), undefined)
})

test('token fixture 11: portable selection retains complete tool-call/result groups atomically', () => {
  const call = toolCallMessage('call-1', '{"query":"newest"}')
  const result = toolResultMessage('call-1', 'result')
  const session = checkpointSession([textMessage('user', 'old '.repeat(3_000)), call, result])
  const portable = portableMessagesForCheckpoint(session, 'checkpoint-fixture', { maxChars: 1_000 })
  assert.deepEqual(portable, [call, result])
})

test('token fixture 12: portable token ceiling can stop CJK/code before its char ceiling', () => {
  const newest = textMessage('user', 'newest')
  const dense = textMessage('user', ('中文 const x={}; ').repeat(45))
  const session = checkpointSession([dense, newest])
  assert.ok(JSON.stringify(dense).length < 1_000)
  assert.deepEqual(portableMessagesForCheckpoint(session, 'checkpoint-fixture', { maxChars: 1_000 }), [newest])
})

test('token fixture 13: portableReplayMaxChars derives the compatible token ceiling', () => {
  assert.equal(portableTokenCeiling(80_000), 20_000)
  assert.equal(portableTokenCeiling(1), 1)
  assert.equal(portableTokenCeiling(9), 3)
})

test('token fixture 14: newest oversized portable group fails closed at char or token ceiling', () => {
  const charSession = checkpointSession([textMessage('user', 'x'.repeat(1_000))])
  assert.throws(() => portableMessagesForCheckpoint(charSession, 'checkpoint-fixture', { maxChars: 100 }), (error) => error?.code === 'LCX_PORTABLE_BUDGET_EXCEEDED')

  const tokenSession = checkpointSession([textMessage('user', '中'.repeat(300))])
  assert.throws(() => portableMessagesForCheckpoint(tokenSession, 'checkpoint-fixture', { maxChars: 1_000 }), (error) => error?.code === 'LCX_PORTABLE_BUDGET_EXCEEDED')
})

test('token fixture 15: v5/v4 checkpoint readability and route safety remain unchanged', () => {
  const route = { provider: 'fixture', model: 'fixture-model', baseURL: 'https://example.test/v1', sessionId: 'session-a' }
  const base = {
    compactionId: 'checkpoint-fixture',
    provider: route.provider,
    model: route.model,
    baseURLFingerprint: baseURLFingerprint(route.baseURL),
    sourceSessionId: route.sessionId,
    nativeOutput: [{ type: 'compaction', encrypted_content: 'opaque' }],
  }
  for (const [type, version] of [['lcx-native-compaction-v5', 5], ['lcx-native-compaction-v4', 4]]) {
    const state = stateFromSummaryEvent({ type: 'compaction/summary', data: { compactionId: 'checkpoint-fixture', rawOutput: [{ ...base, type, version }] } })
    assert.equal(state?.version, version)
    assert.equal(stateRouteCompatible(state, route, { sessions: { get: () => ({ id: route.sessionId }) } }), true)
  }
})

test('review fixture 1: real DSH image blocks receive deterministic conservative cost', () => {
  const first = estimateBudgetItem({ role: 'user', content: [{ type: 'image', attachment: { id: 'image-a' } }] })
  const second = estimateBudgetItem({ role: 'user', content: [{ type: 'image', attachment: { id: 'a-different-image-reference' } }] })
  assert.equal(first, second)
  assert.ok(first >= 2_048)
})

test('review fixture 2: tool results without toolName remain serializer-compatible and budgetable', () => {
  const call = toolCallMessage('call-unnamed', '{"query":"fixture"}')
  const result = {
    role: 'user',
    content: [{ type: 'tool-result', toolCallId: 'call-unnamed', content: [{ type: 'text', text: 'result' }] }],
  }
  assert.equal(typeof estimateBudgetItem(result), 'number')
  assert.deepEqual(portableMessagesForCheckpoint(checkpointSession([call, result]), 'checkpoint-fixture', { maxChars: 2_000 }), [call, result])
})

test('review fixture 3: ordinary long visible text and opaque false positives receive numeric estimates', () => {
  const ordinaryText = 'ordinary model-visible prose remains budgetable across a long message. '.repeat(20)
  assert.ok(estimateTextTokens(ordinaryText) >= Math.ceil(ordinaryText.length / 4))
  assert.equal(typeof estimateBudgetItem(textMessage('user', ordinaryText)), 'number')
  const oversizedText = 'ordinary prose '.repeat(150_000)
  assert.equal(typeof estimateTextTokens(oversizedText), 'number')
  assert.equal(typeof estimateBudgetItem(textMessage('user', oversizedText)), 'number')

  const base64LikeText = 'A'.repeat(600)
  assert.ok(estimateTextTokens(base64LikeText) >= base64LikeText.length)
  assert.equal(typeof estimateTextTokens('data: this is ordinary model-visible prose, not a data URI'), 'number')
})
