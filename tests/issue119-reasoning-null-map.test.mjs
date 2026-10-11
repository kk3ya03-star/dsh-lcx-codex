import test from 'node:test'
import assert from 'node:assert/strict'
import { buildResponsesBody, responsesGenerationEnvelope } from '../lib/responses-request.js'
import { getBuiltinModels } from '../lib/pi-responses-runtime.js'

// Issue 119 item 4: in a Pi `thinkingLevelMap` an unmapped level means "send the level as is" while an
// explicit `null` means "this level is unsupported". `?? requested` collapsed the two and sent a level
// the model declared unsupported. The DSH adapter refuses such a level before it reaches the wire; this
// helper has no error channel (compaction and replay share it), so it omits the option instead.

const model = (thinkingLevelMap) => ({ id: 'gpt-x', provider: 'lcx', api: 'openai-responses', reasoning: true, thinkingLevelMap })

test('an explicit null mapping is not sent', () => {
  const envelope = responsesGenerationEnvelope({ model: model({ high: null }), reasoningEffort: 'high' })
  assert.equal(envelope.reasoning, undefined)
  assert.equal(envelope.include, undefined)
})

test('an unmapped level is sent as requested and a mapped one is translated', () => {
  assert.deepEqual(responsesGenerationEnvelope({ model: model({}), reasoningEffort: 'high' }).reasoning, { effort: 'high', summary: 'auto' })
  assert.deepEqual(responsesGenerationEnvelope({ model: model({ high: 'gateway-high' }), reasoningEffort: 'high' }).reasoning, { effort: 'gateway-high', summary: 'auto' })
  assert.deepEqual(responsesGenerationEnvelope({ model: model(undefined), reasoningEffort: 'low' }).reasoning, { effort: 'low', summary: 'auto' })
})

test('a null-mapped level also suppresses the default off effort', () => {
  const body = buildResponsesBody({ model: model({ high: null }), input: [], reasoningEffort: 'high' })
  assert.equal(body.reasoning, undefined)
})

test('a real catalog model with a null-mapped level omits it (gpt-5.4-pro has no low or minimal)', () => {
  const pro = getBuiltinModels('openai').find((entry) => entry.id === 'gpt-5.4-pro')
  assert.ok(pro, 'catalog entry exists')
  assert.equal(pro.thinkingLevelMap.low, null)
  assert.equal(responsesGenerationEnvelope({ model: pro, reasoningEffort: 'low' }).reasoning, undefined)
  assert.deepEqual(responsesGenerationEnvelope({ model: pro, reasoningEffort: 'high' }).reasoning, { effort: 'high', summary: 'auto' })
})

test('off:null keeps suppressing the default effort', () => {
  assert.equal(responsesGenerationEnvelope({ model: model({ off: null }), includeDefaultReasoning: true }).reasoning, undefined)
  assert.deepEqual(responsesGenerationEnvelope({ model: model({}), includeDefaultReasoning: true }).reasoning, { effort: 'none' })
})
