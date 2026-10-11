import test from 'node:test'
import assert from 'node:assert/strict'
import { withAuxiliaryUsage, recordHostedUsage } from '../lib/auxiliary-usage.js'

// Issue 119 item 5: the main Responses path (Pi) accounts the three input classes disjointly:
// input = input_tokens - cached_tokens - cache_write_tokens, cacheRead = cached_tokens,
// cacheWrite = cache_write_tokens. The hosted-search collector dropped cache_write_tokens and
// reported the cache-write share as ordinary input.

const tool = (execute) => withAuxiliaryUsage({
  name: 'fixture', description: 'fixture', parameters: { type: 'object' },
  output: { schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, render: () => [], presentationMeta: () => ({}) },
  execute,
})
const record = async (response) => {
  const definition = tool(async () => { recordHostedUsage(response, 'r', 'p', 'm'); return { text: 'x' } })
  return (await definition.execute({}, {})).auxiliaryUsage?.[0]?.usage
}
const usage = (input, details, output = 7) => ({ usage: { input_tokens: input, output_tokens: output, total_tokens: input + output, input_tokens_details: details } })

test('cache-write tokens are accounted separately from ordinary input', async () => {
  assert.deepEqual(await record(usage(120, { cached_tokens: 20, cache_write_tokens: 10 })), {
    inputTokens: 90, cacheReadTokens: 20, cacheWriteTokens: 10, outputTokens: 7, totalTokens: 127,
  })
})

test('a response without cache_write_tokens keeps its existing accounting', async () => {
  assert.deepEqual(await record(usage(120, { cached_tokens: 20 })), {
    inputTokens: 100, cacheReadTokens: 20, cacheWriteTokens: 0, outputTokens: 7, totalTokens: 127,
  })
  assert.equal((await record(usage(120, { cached_tokens: 20, cache_write_tokens: 0 }))).inputTokens, 100)
  assert.equal((await record(usage(120, { cached_tokens: 20, cache_write_tokens: null }))).cacheWriteTokens, 0)
})

test('contradictory cache counters are still not invented', async () => {
  assert.equal(await record(usage(120, { cached_tokens: 100, cache_write_tokens: 30 })), undefined)
  assert.equal(await record(usage(120, { cached_tokens: 20, cache_write_tokens: -1 })), undefined)
  assert.equal(await record(usage(120, { cached_tokens: 20, cache_write_tokens: 1.5 })), undefined)
  assert.equal(await record(usage(120, { cached_tokens: 20, cache_write_tokens: '10' })), undefined)
})
