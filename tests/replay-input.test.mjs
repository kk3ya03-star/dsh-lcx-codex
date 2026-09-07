import test from 'node:test'
import assert from 'node:assert/strict'
import { responseInputItems, serializeDshMessages } from '../lib/dsh-responses.js'
import { createNativeCheckpointBlock } from '../lib/native-checkpoint.js'

test('actual Pi easy input messages survive Native checkpoint validation without a type discriminator', async () => {
  const route = { provider: 'lcx', model: 'gpt-5.6-terra', baseURL: 'https://example.invalid/v1', sessionId: 'qa' }
  const serialized = await serializeDshMessages([{ role: 'user', content: [{ type: 'text', text: 'retain this fact' }] }], undefined, { route })
  assert.ok(serialized.input.some(item => item.role === 'user' && item.type === undefined), 'exercise the actual Pi wire shape')
  const checkpoint = createNativeCheckpointBlock({
    session: { snapshotEvents: () => [{ type: 'compaction/start', seq: 0, data: { compactionId: 'qa' } }] },
    route, input: serialized.input, result: { compaction: { type: 'compaction', encrypted_content: 'synthetic' } },
  })
  assert.deepEqual(responseInputItems(checkpoint.nativeOutput), checkpoint.nativeOutput)
})

test('easy-message validation keeps role and content requirements and rejects unknown discriminators', () => {
  for (const role of ['user', 'assistant', 'system', 'developer']) {
    const input = [{ role, content: 'text' }, { role, content: [{ type: 'input_text', text: 'text' }] }]
    assert.deepEqual(responseInputItems(input), input)
  }
  for (const item of [{}, { role: 'tool', content: 'x' }, { role: 'user' }, { role: 'user', content: 1 }, { type: 'unknown', role: 'user', content: 'x' }, { type: null, role: 'user', content: 'x' }]) {
    assert.throws(() => responseInputItems([item]), { code: 'LCX_COMPACT_INVALID_RESPONSE' })
  }
})
