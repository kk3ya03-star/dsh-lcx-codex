import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collect, functionTools, grokHarness, sseResponse, user, xaiProfile } from './grok-fixture.mjs'

function completed(model) {
  return sseResponse([{ type: 'response.completed', response: {
    id: 'resp_media_invariant', model, status: 'completed',
    output: [{
      type: 'message', id: 'msg_media_invariant', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'identical answer', annotations: [] }],
    }],
    usage: { input_tokens: 11, output_tokens: 3, total_tokens: 14 },
  } }])
}

function projections(chunks) {
  return chunks.filter(chunk => chunk.type === 'usage' || chunk.type === 'finish')
}

test('media preview ON/OFF preserves exact GPT and Grok model-facing requests', async t => {
  const requests = []
  let activeModel = ''
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(String(init.body))
    return completed(activeModel)
  })

  for (const fixture of [
    {
      model: 'gpt-invariant',
      harness: () => grokHarness({
        enabled: true,
        profiles: { relay: { ...xaiProfile, models: [{ id: 'gpt-invariant' }] } },
      }),
      options: { provider: 'relay', model: 'gpt-invariant', sessionId: 'gpt-media-invariant' },
    },
    {
      model: 'grok-4.6',
      harness: () => grokHarness({ nativeWeb: true, nativeX: true }),
      options: { provider: 'xai', model: 'grok-4.6', sessionId: 'grok-media-invariant', reasoningEffort: 'high' },
    },
  ]) {
    activeModel = fixture.model
    const h = fixture.harness()
    const bodies = [], results = []
    for (const enabled of [false, true]) {
      h.setMediaPreview(enabled)
      const before = requests.length
      results.push(await collect(h.stream({
        ...fixture.options,
        messages: [user('same user input')],
        tools: functionTools,
      }, () => { throw new Error('managed request unexpectedly fell through') })))
      assert.equal(requests.length, before + 1)
      bodies.push(requests.at(-1))
    }
    assert.equal(bodies[1], bodies[0], `${fixture.model} request bytes changed`)
    assert.deepEqual(JSON.parse(bodies[1]), JSON.parse(bodies[0]))
    assert.equal(JSON.parse(bodies[0]).prompt_cache_key, fixture.options.sessionId)
    assert.deepEqual(projections(results[1]), projections(results[0]))
  }

  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /withMediaGuidance|MEDIA_GUIDANCE|state\.searchMediaPreview/u)
  assert.match(source, /managedGrokNativeSearchStream\(\s*options,/u)
  assert.match(source, /managedResponsesStream\(\s*options,/u)
})
