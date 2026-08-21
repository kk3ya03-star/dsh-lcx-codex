import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildNativeCompactionBody,
  mergeFeatureHeader,
  parseNativeCompactionSse,
} from '../lib/compact-v2.js'
import {
  buildHostedSearchBody,
  normalizeHostedSearchArgs,
  parseHostedSearchResponse,
} from '../lib/web-search-hosted.js'
import {
  buildAlphaSearchBody,
  normalizeAlphaSearchArgs,
  parseAlphaSearchResponse,
} from '../lib/web-search-alpha.js'
import { serializeDshMessages } from '../lib/dsh-responses.js'

function sseResponse(events) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

test('Native V2 body appends exactly one compaction trigger and preserves request envelope', () => {
  const body = buildNativeCompactionBody({
    model: 'gpt-5.6-sol',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
    instructions: 'system',
    tools: [{ name: 'read', description: 'read', parameters: { type: 'object', properties: {} } }],
    promptCacheKey: 'cache-key',
  })
  assert.equal(body.model, 'gpt-5.6-sol')
  assert.equal(body.stream, true)
  assert.equal(body.store, false)
  assert.equal(body.input.filter((item) => item.type === 'compaction_trigger').length, 1)
  assert.deepEqual(body.input.at(-1), { type: 'compaction_trigger' })
  assert.equal(body.instructions, 'system')
  assert.equal(body.prompt_cache_key, 'cache-key')
  assert.equal(body.tools[0].type, 'function')
})

test('Native V2 body rejects duplicate compaction trigger', () => {
  assert.throws(() => buildNativeCompactionBody({
    model: 'gpt-5.6-sol', input: [{ type: 'compaction_trigger' }],
  }), (error) => error?.code === 'LCX_COMPACT_DUPLICATE_TRIGGER')
})

test('feature header composes without overwriting existing features', () => {
  const headers = mergeFeatureHeader({ 'X-Codex-Beta-Features': 'foo,bar' })
  assert.equal(headers['X-Codex-Beta-Features'], 'foo,bar,remote_compaction_v2')
  const twice = mergeFeatureHeader(headers)
  assert.equal(twice['X-Codex-Beta-Features'], 'foo,bar,remote_compaction_v2')
})

test('Native V2 SSE parser returns opaque compaction and disjoint cache usage', async () => {
  const response = sseResponse([
    {
      type: 'response.output_item.added', output_index: 0,
      item: { id: 'cmp_1', type: 'compaction', encrypted_content: 'opaque-state' },
    },
    {
      type: 'response.output_item.done', output_index: 0,
      item: { id: 'cmp_1', type: 'compaction', encrypted_content: 'opaque-state' },
    },
    {
      type: 'response.completed',
      response: {
        id: 'resp_1', object: 'response.compaction', status: 'completed',
        output: [{ id: 'cmp_1', type: 'compaction', encrypted_content: 'opaque-state' }],
        usage: {
          input_tokens: 120,
          input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
          output_tokens: 7,
          output_tokens_details: { reasoning_tokens: 3 },
        },
      },
    },
  ])
  const parsed = await parseNativeCompactionSse(response)
  assert.equal(parsed.compaction.encrypted_content, 'opaque-state')
  assert.equal(parsed.output.length, 1)
  assert.deepEqual(parsed.usage, {
    inputTokens: 90,
    outputTokens: 7,
    cacheReadTokens: 20,
    cacheWriteTokens: 10,
    reasoningTokens: 3,
  })
})

test('Hosted advanced search validates and emits native Responses web_search controls', () => {
  const args = normalizeHostedSearchArgs({
    query: 'recent OpenAI docs',
    searchContextSize: 'high',
    allowedDomains: ['openai.com'],
    userLocation: { country: 'us', city: 'San Francisco', timezone: 'America/Los_Angeles' },
    searchContentTypes: ['text', 'image'],
    imageSettings: { maxResults: 3, caption: true },
  })
  const body = buildHostedSearchBody(args, 'gpt-5.6-sol', { promptCacheKey: 'search-cache-key' })
  assert.equal(body.tools[0].type, 'web_search')
  assert.deepEqual(body.tools[0].filters.allowed_domains, ['openai.com'])
  assert.equal(body.tools[0].search_context_size, 'high')
  assert.equal(body.tools[0].user_location.country, 'US')
  assert.deepEqual(body.tools[0].search_content_types, ['text', 'image'])
  assert.equal(body.tool_choice, 'required')
  assert.equal(body.prompt_cache_key, 'search-cache-key')
})

test('Hosted search parser produces DSH-portable source records', () => {
  const parsed = parseHostedSearchResponse({
    id: 'resp_search', status: 'completed',
    output: [
      { type: 'web_search_call', action: { type: 'search', sources: [{ url: 'https://openai.com/research/', title: 'Research' }] } },
      { type: 'message', content: [{ type: 'output_text', text: 'Answer', annotations: [{ type: 'url_citation', url: 'https://openai.com/research/', title: 'Research' }] }] },
    ],
  }, 'req_1', 8, '2026-08-21T00:00:00.000Z')
  assert.equal(parsed.content, 'Answer')
  assert.equal(parsed.sources.length, 1)
  assert.equal(parsed.sources[0].url, 'https://openai.com/research/')
  assert.equal(parsed.truncated, false)
})

test('Alpha body preserves stateful session id and command action', () => {
  const args = normalizeAlphaSearchArgs({ action: 'open', refId: 'turn0search1', lineNumber: 12, responseLength: 'short' })
  const body = buildAlphaSearchBody(args, 'gpt-5.6-sol', 'session-1')
  assert.equal(body.id, 'session-1')
  assert.deepEqual(body.commands.open, [{ ref_id: 'turn0search1', lineno: 12 }])
  assert.equal(body.settings.external_web_access, true)
})

test('Alpha response parser strips encrypted fields and keeps refs', () => {
  const parsed = parseAlphaSearchResponse({
    id: 'alpha_1',
    output: 'Example (https://example.com)\nL1: hello citeturn0search1',
    results: [{ ref_id: 'turn0search1', url: 'https://example.com', title: 'Example', encrypted_content: 'secret' }],
  }, { action: 'search_query', capability: 'native', requestId: 'req-a', retrievedAt: '2026-08-21T00:00:00.000Z' })
  assert.equal(parsed.refs.includes('turn0search1'), true)
  assert.equal(parsed.results[0].encrypted_content, undefined)
  assert.equal(parsed.sources[0].url, 'https://example.com/')
})

test('DSH 0.1.1 request-image projection is used for Native serialization', async () => {
  let policy
  let readImageCalls = 0
  const ref = { attachmentId: 'sha256:test', mediaType: 'image/png', bytes: 2_000_000, width: 2048, height: 2048 }
  const ctx = {
    attachments: {
      async readImageRequest(input, nextPolicy) {
        assert.equal(input, ref)
        policy = nextPolicy
        return {
          variantId: 'variant:test', attachment: ref,
          data: new Uint8Array([1,2,3]), mediaType: 'image/png', bytes: 3, width: 10, height: 10, depth: 'uchar', space: 'srgb', hasAlpha: false,
        }
      },
      async readImage() { readImageCalls += 1; throw new Error('legacy readImage must not be used') },
    },
    get(name) { return this[name] },
  }
  const result = await serializeDshMessages([{ role:'user', content:[{ type:'image', attachment:ref }] }], ctx, {
    imageSupport:'supported', requestImagePixelBudget:123456, requestImageMaxBytes:654321, maxRequestImageBytes:20*1024*1024,
  })
  assert.deepEqual(policy, { maxPixels:123456, maxBytes:654321 })
  assert.equal(readImageCalls, 0)
  assert.equal(result.input[0].content[0].type, 'input_image')
})
