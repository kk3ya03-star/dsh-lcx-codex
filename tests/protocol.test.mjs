import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  ALPHA_PROBE_VERSION,
  alphaActionCommand,
  alphaRefRequiresStore,
  buildAlphaSearchBody,
  isAlphaContinuationUrl,
  normalizeAlphaSearchArgs,
  parseAlphaSearchResponse,
  probeAlphaCapabilities,
} from '../lib/web-search-alpha.js'
import { AlphaCapabilityStore, alphaCapabilityFingerprint, alphaCapabilityUsable } from '../lib/web-search-capability.js'
import { AlphaRefStore } from '../lib/web-search-ref-store.js'
import { serializeDshMessages } from '../lib/dsh-responses.js'
import { authenticatedHeaders, promptCacheKey, promptCacheRetention } from '../lib/route.js'
import { replayBody, requestNativeReplay } from '../lib/responses-replay.js'

test('Native cache namespace matches the DSH/Pi session cache identity', async () => {
  const sessionId = 'session-19104ea5-757f-4d2f-8c02-3601a6b8de31'
  assert.equal(promptCacheKey({ sessionId }, { cacheRetention: 'short' }), sessionId)
  assert.equal(promptCacheKey({ sessionId }, { cacheRetention: 'none' }), undefined)
  assert.equal(promptCacheKey({ sessionId: 'x'.repeat(80) }, { cacheRetention: 'short' }), 'x'.repeat(64))
  assert.equal(promptCacheRetention({ cacheRetention: 'long', supportsLongCacheRetention: true }), '24h')
  assert.equal(promptCacheRetention({ cacheRetention: 'short' }), undefined)

  const envName = 'LCX_TEST_CACHE_HEADER_KEY'
  const previous = process.env[envName]
  process.env[envName] = 'redacted-test-value'
  try {
    const headers = await authenticatedHeaders(undefined, { apiKeyEnv: envName, headers: {} }, sessionId)
    assert.equal(headers['x-client-request-id'], sessionId)
    assert.equal(headers.session_id, sessionId)
    assert.equal(headers['session-id'], undefined)
    const noAffinity = await authenticatedHeaders(undefined, { apiKeyEnv: envName, headers: {} }, undefined, null)
    assert.equal(noAffinity['x-client-request-id'], undefined)
    assert.equal(noAffinity.session_id, undefined)
    assert.equal(noAffinity['session-id'], undefined)
    const openrouter = await authenticatedHeaders(undefined, { apiKeyEnv: envName, provider: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', headers: {} }, sessionId)
    assert.equal(openrouter['x-session-id'], sessionId)
    assert.equal(openrouter.session_id, undefined)
    assert.equal(openrouter['x-client-request-id'], undefined)
  } finally {
    if (previous === undefined) delete process.env[envName]
    else process.env[envName] = previous
  }
})

test('Native compaction and replay carry the same cache retention envelope', () => {
  const compact = buildNativeCompactionBody({ model: 'gpt-5.6-luna', input: [], promptCacheKey: 'session-x', promptCacheRetention: '24h' })
  const replay = replayBody({ model: 'gpt-5.6-luna', input: [], promptCacheKey: 'session-x', promptCacheRetention: '24h' })
  assert.equal(compact.prompt_cache_key, 'session-x')
  assert.equal(compact.prompt_cache_retention, '24h')
  assert.equal(replay.prompt_cache_key, 'session-x')
  assert.equal(replay.prompt_cache_retention, '24h')
})

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

  const directUrl = normalizeAlphaSearchArgs({ action: 'open', refId: 'https://example.com/docs' })
  const directUrlBody = buildAlphaSearchBody(directUrl, 'gpt-5.6-sol', 'session-1')
  assert.deepEqual(directUrlBody.commands.open, [{ ref_id: 'https://example.com/docs' }])
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


test('Alpha parser persists refs that appear only in rendered web-run output', () => {
  const parsed = parseAlphaSearchResponse({
    id: 'alpha_click_1',
    output: 'Destination (https://example.com/next)\nciteturn2view0 [wordlim: 200] Crawled: today; Content type: text/html; Total lines: 20',
    results: [],
  }, { action: 'click', capability: 'native', requestId: 'req-click', retrievedAt: '2026-08-22T00:00:00.000Z' })
  assert.equal(parsed.refs.includes('turn2view0'), true)
  assert.equal(parsed.refRecords.some((record) => record.refId === 'turn2view0'), true)
})

test('Alpha URL-only search output remains a source, not a synthetic provider ref', () => {
  const parsed = parseAlphaSearchResponse({
    id: 'alpha_url_only',
    output: 'Example (https://example.com/docs)',
    results: [{ ref_id: 'https://example.com/docs', url: 'https://example.com/docs', title: 'Example' }],
  }, { action: 'search_query', capability: 'command-capable', requestId: 'req-url', retrievedAt: '2026-08-23T00:00:00.000Z' })
  assert.deepEqual(parsed.refs, [])
  assert.deepEqual(parsed.refRecords, [])
  assert.equal(parsed.sources[0].url, 'https://example.com/docs')

  const refOnly = parseAlphaSearchResponse({
    output: 'Example',
    results: [{ ref_id: 'https://example.com/ref-only', title: 'Example' }],
  }, { action: 'search_query', capability: 'command-capable', requestId: 'req-url-ref-only', retrievedAt: '2026-08-23T00:00:00.000Z' })
  assert.deepEqual(refOnly.refs, [])
  assert.equal(refOnly.sources[0].url, 'https://example.com/ref-only')
})

test('Alpha parser and ref store retain real opaque refs only in the originating session and route', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-alpha-'))
  try {
    const parsed = parseAlphaSearchResponse({
      id: 'alpha_real_ref',
      output: 'Example (https://example.com/docs)\nciteturn0search1',
      results: [{ ref_id: 'turn0search1', url: 'https://example.com/docs' }],
    }, { action: 'search_query', capability: 'command-capable', requestId: 'req-real', retrievedAt: '2026-08-23T00:00:00.000Z' })
    const store = new AlphaRefStore(join(directory, 'refs.json'))
    store.record('session-a', 'route-a', parsed.refRecords)
    assert.deepEqual(store.assertUsable('session-a', 'route-a', 'turn0search1'), { refId: 'turn0search1', url: 'https://example.com/docs' })
    assert.throws(() => store.assertUsable('session-b', 'route-a', 'turn0search1'), (error) => error?.code === 'LCX_ALPHA_REF_UNAVAILABLE')
    assert.throws(() => store.assertUsable('session-a', 'route-b', 'turn0search1'), (error) => error?.code === 'LCX_ALPHA_REF_UNAVAILABLE')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Alpha continuation forwards only contract-valid URLs without weakening opaque ref or click gates', () => {
  const url = 'https://example.com/docs'
  assert.equal(isAlphaContinuationUrl(url), true)
  assert.equal(isAlphaContinuationUrl('ftp://example.com/docs'), false)
  assert.equal(isAlphaContinuationUrl('https://user:pass@example.com/docs'), false)
  assert.equal(isAlphaContinuationUrl(' https://example.com/docs'), false)
  for (const action of ['open', 'find', 'screenshot']) assert.equal(alphaRefRequiresStore(action, url), false)
  assert.equal(alphaRefRequiresStore('open', 'turn0search1'), true)
  assert.equal(alphaRefRequiresStore('find', 'not-a-url'), true)
  assert.equal(alphaRefRequiresStore('click', url), true)
  assert.equal(alphaRefRequiresStore('click', 'turn0view0'), true)
})

test('Alpha click rejects URL-shaped refs even if a stale ref store contains them', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-alpha-stale-url-'))
  try {
    const url = 'https://example.com/docs'
    const store = new AlphaRefStore(join(directory, 'refs.json'))
    store.record('session-a', 'route-a', [{ refId: url, url }])
    assert.equal(store.assertUsable('session-a', 'route-a', url).refId, url)
    assert.throws(
      () => normalizeAlphaSearchArgs({ action: 'click', refId: url, linkId: 7 }),
      (error) => error?.code === 'LCX_ALPHA_REF_REQUIRED',
    )
    assert.throws(
      () => alphaActionCommand({ action: 'click', refId: url, linkId: 7 }),
      (error) => error?.code === 'LCX_ALPHA_REF_REQUIRED',
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
test('Alpha continuation accepts only public HTTP(S) targets and filters private URL sources', () => {
  for (const url of [
    'http://localhost/',
    'http://service.localhost/',
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://100.64.0.1/',
    'http://169.254.1.1/',
    'http://172.16.0.1/',
    'http://192.168.0.1/',
    'http://192.0.2.1/',
    'http://198.51.100.1/',
    'http://203.0.113.1/',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[fec0::1]/',
    'http://[feff::1]/',
    'http://[64:ff9b:1::1]/',
    'http://[2001:db8::1]/',
    'http://[3fff::1]/',
    'http://[4000::1]/',
    'http://[5f00::1]/',
    'http://[8000::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:8.8.8.8]/',
    'https://printer.local/',
    'https://router.home.arpa/',
    'https://foo.ipv4only.arpa/',
    'https://x.in-addr.arpa/',
    'https://x.ip6.arpa/',
    'https://metadata.google.internal/',
    'https://intranet/',
  ]) assert.equal(isAlphaContinuationUrl(url), false, url)
  for (const url of ['https://example.com/docs', 'https://8.8.8.8/dns-query', 'https://[2606:4700:4700::1111]/dns-query']) assert.equal(isAlphaContinuationUrl(url), true, url)

  const parsed = parseAlphaSearchResponse({
    output: 'Loopback (http://127.0.0.1/internal)',
    results: [{ ref_id: 'http://127.0.0.1/internal', url: 'http://127.0.0.1/internal' }],
  }, { action: 'search_query', capability: 'command-capable', requestId: 'req-private-url', retrievedAt: '2026-08-23T00:00:00.000Z' })
  assert.deepEqual(parsed.refs, [])
  assert.deepEqual(parsed.sources, [])
  assert.equal(parsed.results[0].url, undefined)
})

function parseAlphaProbeFixture(action, response) {
  return parseAlphaSearchResponse(response, {
    action,
    capability: 'command-capable',
    requestId: `probe-${action}`,
    retrievedAt: '2026-08-24T00:00:00.000Z',
  })
}
test('Alpha capability probe continues a URL-only search through open and find', async () => {
  const calls = []
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    invoke: async (args) => {
      calls.push(args)
      if (args.action === 'search_query') return { refs: [], sources: [{ url: 'https://example.com/docs' }] }
      if (args.action === 'open') {
        assert.equal(args.refId, 'https://example.com/docs')
        return { results: [{ ref_id: 'turn0view1', url: 'https://example.com/docs' }], refs: ['turn0view1'], sources: [{ url: 'https://example.com/docs' }], links: [] }
      }
      if (args.action === 'find') {
        assert.equal(args.refId, 'https://example.com/docs')
        return { results: [{ ref_id: 'turn0find1', url: 'https://example.com/docs' }], refs: ['turn0find1'], sources: [{ url: 'https://example.com/docs' }] }
      }
      throw new Error(`Unexpected action: ${args.action}`)
    },
  })
  assert.equal(result.classification, 'command-capable')
  assert.equal(result.actions.open, 'supported')
  assert.equal(result.actions.find, 'supported')
  assert.equal(result.probeVersion, ALPHA_PROBE_VERSION)
  assert.deepEqual(calls.map((call) => call.action), ['search_query', 'open', 'find'])
})

test('Alpha URL continuation failure cannot classify the route as usable', async () => {
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    invoke: async (args) => {
      if (args.action === 'search_query') return { refs: [], sources: [{ url: 'https://example.com/docs' }] }
      const error = new Error('not found')
      error.status = 404
      throw error
    },
  })
  assert.equal(result.classification, 'emulated-search-only')
  assert.equal(result.actions.open, 'unsupported')
  assert.equal(alphaCapabilityUsable(result), false)
})

test('Alpha probe cannot classify a failed URL continuation through an unrelated click probe', async () => {
  const calls = []
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    clickProbeRef: 'turn0unrelated',
    invoke: async (args) => {
      calls.push(args)
      if (args.action === 'search_query') return { refs: [], sources: [{ url: 'https://example.com/docs' }] }
      if (args.action === 'open' && args.refId === 'https://example.com/docs') return { results: [{ ref_id: 'turn0view1', url: 'https://example.com/docs' }], refs: ['turn0view1'], sources: [{ url: 'https://example.com/docs' }], links: [] }
      if (args.action === 'find') {
        const error = new Error('not found')
        error.status = 404
        throw error
      }
      if (args.action === 'open' && args.refId === 'turn0unrelated') return { results: [{ ref_id: 'turn0unrelated-page' }], refs: ['turn0unrelated-page'], links: [{ id: 7 }] }
      if (args.action === 'click') return { results: [{ ref_id: 'turn0destination' }], refs: ['turn0destination'] }
      throw new Error(`Unexpected action: ${args.action}`)
    },
  })
  assert.equal(result.actions.find, 'unsupported')
  assert.equal(result.actions.click, 'supported')
  assert.notEqual(result.classification, 'command-capable')
  assert.notEqual(result.classification, 'native')
  assert.equal(alphaCapabilityUsable(result), false)
  assert.deepEqual(calls.map((call) => call.action), ['search_query', 'open', 'find', 'open', 'click'])
})

test('Alpha probe can classify a searched real-ref page click when find is unavailable', async () => {
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    invoke: async (args) => {
      if (args.action === 'search_query') return { refs: ['turn0search1'], sources: [] }
      if (args.action === 'open') return { results: [{ ref_id: 'turn0view1' }], refs: ['turn0view1'], links: [{ id: 7 }] }
      if (args.action === 'find') {
        const error = new Error('not found')
        error.status = 404
        throw error
      }
      if (args.action === 'click') {
        assert.equal(args.refId, 'turn0view1')
        assert.equal(args.linkId, 7)
        return { results: [{ ref_id: 'turn0destination' }], refs: ['turn0destination'] }
      }
      throw new Error(`Unexpected action: ${args.action}`)
    },
  })
  assert.equal(result.actions.click, 'supported')
  assert.equal(result.classification, 'command-capable')
  assert.equal(alphaCapabilityUsable(result), true)
})

test('Alpha probe rejects HTTP-200 semantic ref failures and prefers a usable source URL', async () => {
  const calls = []
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    invoke: async (args) => {
      calls.push(args)
      if (args.action === 'search_query') return { refs: ['turn0search0'], sources: [{ url: 'https://example.com/docs' }] }
      if (args.action === 'open') {
        assert.equal(args.refId, 'https://example.com/docs')
        return { results: [{ ref_id: 'turn0view0', url: 'https://example.com/docs' }], refs: ['turn0view0'], sources: [{ url: 'https://example.com/docs' }], links: [] }
      }
      if (args.action === 'find') {
        assert.equal(args.refId, 'https://example.com/docs')
        return { results: [{ ref_id: 'turn0find0', url: 'https://example.com/docs' }], refs: ['turn0find0'], sources: [{ url: 'https://example.com/docs' }] }
      }
      throw new Error(`Unexpected action: ${args.action}`)
    },
  })
  assert.equal(result.classification, 'command-capable')
  assert.deepEqual(calls.map(({ action, refId }) => ({ action, refId })), [
    { action: 'search_query', refId: undefined },
    { action: 'open', refId: 'https://example.com/docs' },
    { action: 'find', refId: 'https://example.com/docs' },
  ])
})

test('Alpha probe fails closed on HTTP-200 continuation responses with no consumable evidence', async () => {
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    invoke: async (args) => {
      if (args.action === 'search_query') return { refs: ['turn0search0'], sources: [] }
      if (args.action === 'open') return { results: [], refs: [], sources: [], links: [], content: 'reference unavailable' }
      throw new Error(`Unexpected action: ${args.action}`)
    },
  })
  assert.equal(result.classification, 'emulated-search-only')
  assert.equal(result.actions.open, 'unsupported')
  assert.equal(alphaCapabilityUsable(result), false)
})

test('Alpha production parser rejects explicit continuation semantic failures even with opaque refs', () => {
  assert.throws(() => parseAlphaSearchResponse({
    output: 'reference unavailable',
    results: [{ ref_id: 'turn0view0', url: 'https://example.com/docs' }],
  }, { action: 'open', capability: 'command-capable', requestId: 'req-semantic', retrievedAt: '2026-08-24T00:00:00.000Z' }), (error) => error?.code === 'LCX_ALPHA_ACTION_FAILED')
})

test('Alpha semantic failure matcher does not reject successful content that quotes failure phrases', () => {
  for (const [action, output] of [
    ['open', 'Status guide (https://example.com/503)\nciteturn0view0\nL1: HTTP 503 means Service Unavailable.'],
    ['find', 'API errors (https://example.com/errors)\nciteturn0find0\nL12: The literal message is reference unavailable.'],
    ['open', 'Troubleshooting (https://example.com/help)\nciteturn0view1\nL3: Users may be unable to access requested content during maintenance.'],
  ]) assert.doesNotThrow(() => parseAlphaSearchResponse({ output, results: [{ ref_id: 'turn0real', url: 'https://example.com/docs' }] }, { action, capability: 'command-capable', requestId: 'req-content', retrievedAt: '2026-08-24T00:00:00.000Z' }))
})

test('Alpha probe rejects production-parsed HTTP-200 open prose failures', async () => {
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    invoke: async (args) => {
      if (args.action === 'search_query') return parseAlphaProbeFixture('search_query', {
        output: 'Example (https://example.com/docs)',
        results: [{ ref_id: 'turn0search0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'open') return parseAlphaProbeFixture('open', { output: 'reference unavailable', results: [] })
      throw new Error(`Unexpected action: ${args.action}`)
    },
  })
  assert.equal(result.actions.open, 'unsupported')
  assert.equal(result.classification, 'emulated-search-only')
  assert.equal(alphaCapabilityUsable(result), false)
})

test('Alpha probe rejects production-parsed semantic error prose even when it contains a public URL', async () => {
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    invoke: async (args) => {
      if (args.action === 'search_query') return parseAlphaProbeFixture('search_query', {
        output: 'Example (https://example.com/docs)',
        results: [{ ref_id: 'turn0search0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'open') return parseAlphaProbeFixture('open', {
        output: 'reference unavailable (https://example.com/docs)',
        results: [],
      })
      throw new Error(`Unexpected action: ${args.action}`)
    },
  })
  assert.equal(result.actions.open, 'unsupported')
  assert.equal(result.classification, 'emulated-search-only')
  assert.equal(alphaCapabilityUsable(result), false)
})

test('Alpha probe rejects arbitrary production-parsed prose-only URL blocks for all continuation actions', async () => {
  const prose = 'Unable to access requested content (https://example.com/docs)'
  const openFind = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    invoke: async (args) => {
      if (args.action === 'search_query') return parseAlphaProbeFixture('search_query', {
        output: 'Example (https://example.com/docs)',
        results: [{ ref_id: 'turn0search0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'open') return parseAlphaProbeFixture('open', { output: prose, results: [] })
      if (args.action === 'find') return parseAlphaProbeFixture('find', { output: prose, results: [] })
      throw new Error(`Unexpected action: ${args.action}`)
    },
  })
  assert.equal(openFind.actions.open, 'unsupported')
  assert.equal(openFind.actions.find, 'unknown')
  assert.equal(openFind.classification, 'emulated-search-only')

  const click = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    invoke: async (args) => {
      if (args.action === 'search_query') return parseAlphaProbeFixture('search_query', {
        output: 'Search result\nciteturn0search0',
        results: [{ ref_id: 'turn0search0' }],
      })
      if (args.action === 'open') return parseAlphaProbeFixture('open', {
        output: 'Opened page\nciteturn0view0\n\uE200cite\uE2027\u2020Next\u2020example.com\uE201',
        results: [{ ref_id: 'turn0view0' }],
      })
      if (args.action === 'find') { const error = new Error('not found'); error.status = 404; throw error }
      if (args.action === 'click') return parseAlphaProbeFixture('click', { output: prose, results: [] })
      throw new Error(`Unexpected action: ${args.action}`)
    },
  })
  assert.equal(click.actions.click, 'unsupported')
  assert.notEqual(click.classification, 'command-capable')

  const screenshot = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    screenshotProbeRef: 'turn0pdfseed',
    invoke: async (args) => {
      if (args.action === 'search_query') return parseAlphaProbeFixture('search_query', {
        output: 'Example (https://example.com/docs)',
        results: [{ ref_id: 'turn0search0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'open' && args.refId === 'https://example.com/docs') return parseAlphaProbeFixture('open', {
        output: 'Example (https://example.com/docs)\nciteturn0view0\nL1: OpenAI documentation',
        results: [{ ref_id: 'turn0view0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'find') return parseAlphaProbeFixture('find', {
        output: 'Example (https://example.com/docs)\nL1: OpenAI documentation',
        results: [{ ref_id: 'turn0find0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'open' && args.refId === 'turn0pdfseed') return parseAlphaProbeFixture('open', {
        output: 'PDF (https://example.com/doc.pdf)\n\uE200cite\uE202turn0pdf0\uE201 [wordlim: 200] Crawled: today; Content type: application/pdf; Number of pages: 2',
        results: [{ ref_id: 'turn0pdf0', url: 'https://example.com/doc.pdf' }],
      })
      if (args.action === 'screenshot') return parseAlphaProbeFixture('screenshot', { output: prose, results: [] })
      throw new Error(`Unexpected action: ${args.action}`)
    },
  })
  assert.equal(screenshot.actions.screenshot, 'unsupported')
})
test('Alpha probe rejects URL-only result objects as continuation evidence', async () => {
  const prose = 'Unable to access requested content (https://example.com/docs)'
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    invoke: async (args) => {
      if (args.action === 'search_query') return parseAlphaProbeFixture('search_query', {
        output: 'Example (https://example.com/docs)',
        results: [{ ref_id: 'turn0search0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'open') return parseAlphaProbeFixture('open', {
        output: prose,
        results: [{ url: 'https://example.com/docs' }],
      })
      throw new Error('Unexpected action: ' + args.action)
    },
  })
  assert.equal(result.actions.open, 'unsupported')
  assert.equal(result.classification, 'emulated-search-only')
  assert.equal(alphaCapabilityUsable(result), false)
})

test('Alpha generic structured probes do not treat any resolved response as supported', async () => {
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    actionProbes: { finance: { ticker: 'MSFT', assetType: 'equity' } },
    invoke: async (args) => {
      if (args.action === 'search_query') return parseAlphaProbeFixture('search_query', {
        output: 'Example (https://example.com/docs)',
        results: [{ ref_id: 'turn0search0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'open') return parseAlphaProbeFixture('open', {
        output: 'Opened page',
        results: [{ ref_id: 'turn0view0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'find') return parseAlphaProbeFixture('find', {
        output: 'Found match',
        results: [{ ref_id: 'turn0find0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'finance') return parseAlphaProbeFixture('finance', { output: 'service unavailable', results: [] })
      throw new Error('Unexpected action: ' + args.action)
    },
  })
  assert.equal(result.classification, 'command-capable')
  assert.equal(result.actions.finance, 'unknown')
})
test('Alpha generic action probes cannot bypass click semantic evidence checks', async () => {
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    actionProbes: { click: { refId: 'turn0view0', linkId: 7 } },
    invoke: async (args) => {
      if (args.action === 'search_query') return parseAlphaProbeFixture('search_query', {
        output: 'Example (https://example.com/docs)',
        results: [{ ref_id: 'turn0search0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'open') return parseAlphaProbeFixture('open', {
        output: 'Opened page\nciteturn0view0',
        results: [{ ref_id: 'turn0view0' }],
      })
      if (args.action === 'find') return parseAlphaProbeFixture('find', { output: 'reference unavailable', results: [] })
      if (args.action === 'click') return parseAlphaProbeFixture('click', { output: 'reference unavailable', results: [] })
      throw new Error(`Unexpected action: ${args.action}`)
    },
  })
  assert.equal(result.actions.click, 'unknown')
  assert.notEqual(result.classification, 'command-capable')
  assert.equal(alphaCapabilityUsable(result), false)
})
test('Alpha probe rejects production-parsed HTTP-200 find prose failures', async () => {
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    invoke: async (args) => {
      if (args.action === 'search_query') return parseAlphaProbeFixture('search_query', {
        output: 'Example (https://example.com/docs)',
        results: [{ ref_id: 'turn0search0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'open') return parseAlphaProbeFixture('open', {
        output: 'Example (https://example.com/docs)\nciteturn0view0\nL1: OpenAI documentation',
        results: [{ ref_id: 'turn0view0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'find') return parseAlphaProbeFixture('find', { output: 'reference unavailable', results: [] })
      throw new Error(`Unexpected action: ${args.action}`)
    },
  })
  assert.equal(result.actions.open, 'supported')
  assert.equal(result.actions.find, 'unsupported')
  assert.notEqual(result.classification, 'command-capable')
  assert.notEqual(result.classification, 'native')
  assert.equal(alphaCapabilityUsable(result), false)
})

test('Alpha probe rejects production-parsed HTTP-200 click prose failures', async () => {
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    invoke: async (args) => {
      if (args.action === 'search_query') return parseAlphaProbeFixture('search_query', {
        output: 'Search result\nciteturn0search0',
        results: [{ ref_id: 'turn0search0' }],
      })
      if (args.action === 'open') return parseAlphaProbeFixture('open', {
        output: 'Opened page\nciteturn0view0\n\uE200cite\uE2027\u2020Next\u2020example.com\uE201',
        results: [{ ref_id: 'turn0view0' }],
      })
      if (args.action === 'find') {
        const error = new Error('not found')
        error.status = 404
        throw error
      }
      if (args.action === 'click') return parseAlphaProbeFixture('click', { output: 'reference unavailable', results: [] })
      throw new Error(`Unexpected action: ${args.action}`)
    },
  })
  assert.equal(result.actions.find, 'unsupported')
  assert.equal(result.actions.click, 'unsupported')
  assert.notEqual(result.classification, 'command-capable')
  assert.notEqual(result.classification, 'native')
  assert.equal(alphaCapabilityUsable(result), false)
})
test('Alpha probe rejects production-parsed HTTP-200 screenshot prose failures', async () => {
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'alpha-schema',
    screenshotProbeRef: 'turn0pdfseed',
    invoke: async (args) => {
      if (args.action === 'search_query') return parseAlphaProbeFixture('search_query', {
        output: 'Example (https://example.com/docs)',
        results: [{ ref_id: 'turn0search0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'open' && args.refId === 'https://example.com/docs') return parseAlphaProbeFixture('open', {
        output: 'Example (https://example.com/docs)\nciteturn0view0\nL1: OpenAI documentation',
        results: [{ ref_id: 'turn0view0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'find') return parseAlphaProbeFixture('find', {
        output: 'Example (https://example.com/docs)\nL1: OpenAI documentation',
        results: [{ ref_id: 'turn0find0', url: 'https://example.com/docs' }],
      })
      if (args.action === 'open' && args.refId === 'turn0pdfseed') return parseAlphaProbeFixture('open', {
        output: 'PDF (https://example.com/doc.pdf)\n\uE200cite\uE202turn0pdf0\uE201 [wordlim: 200] Crawled: today; Content type: application/pdf; Number of pages: 2',
        results: [{ ref_id: 'turn0pdf0', url: 'https://example.com/doc.pdf' }],
      })
      if (args.action === 'screenshot') return parseAlphaProbeFixture('screenshot', { output: 'reference unavailable', results: [] })
      throw new Error(`Unexpected action: ${args.action}`)
    },
  })
  assert.equal(result.classification, 'command-capable')
  assert.equal(result.actions.screenshot, 'unsupported')
})
test('Alpha capability store rejects older records after anchored semantic-evidence hardening moves the probe to v10', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-alpha-'))
  try {
    assert.equal(ALPHA_PROBE_VERSION, 10)
    const fingerprint = 'a'.repeat(64)
    const v7Record = {
      classification: 'command-capable',
      actions: { search_query: 'supported', open: 'supported', find: 'supported' },
      probedAt: '2026-08-22T00:00:00.000Z',
      schemaFingerprint: 'alpha-schema',
      probeVersion: 7,
      provenance: 'unavailable',
    }
    const file = join(directory, 'capabilities.json')
    writeFileSync(file, `${JSON.stringify({ version: 1, capabilities: { [fingerprint]: v7Record } })}\n`)
    const store = new AlphaCapabilityStore(file)
    assert.equal(store.get(fingerprint), undefined)
    const v10Record = { ...v7Record, probeVersion: ALPHA_PROBE_VERSION }
    store.put(fingerprint, v10Record)
    assert.deepEqual(store.get(fingerprint), v10Record)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})


test('Alpha capability records are not usable for a different route fingerprint', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-alpha-'))
  try {
    const store = new AlphaCapabilityStore(join(directory, 'capabilities.json'))
    const schemaFingerprint = 'alpha-schema'
    const verifiedRoute = { baseURL: 'https://alpha.example/v1', provider: 'relay', model: 'gpt-5.6-sol', profile: 'oauth', group: 'alpha', schemaFingerprint }
    const activeRoute = { ...verifiedRoute, model: 'gpt-5.6-terra' }
    const record = {
      classification: 'command-capable',
      actions: { search_query: 'supported', open: 'supported', find: 'supported' },
      probedAt: '2026-08-23T00:00:00.000Z',
      schemaFingerprint,
      probeVersion: ALPHA_PROBE_VERSION,
      provenance: 'unavailable',
    }
    store.put(alphaCapabilityFingerprint(verifiedRoute), record)
    assert.equal(alphaCapabilityUsable(store.get(alphaCapabilityFingerprint(verifiedRoute))), true)
    assert.equal(store.get(alphaCapabilityFingerprint(activeRoute)), undefined)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Native compaction requires response.completed and completed status', async () => {
  const validOutput = [{ id: 'cmp_done', type: 'compaction', encrypted_content: 'opaque' }]
  await assert.rejects(
    parseNativeCompactionSse(sseResponse([{ type: 'response.done', response: { id: 'resp_done', status: 'completed', output: validOutput } }])),
    (error) => error?.code === 'LCX_COMPACT_INCOMPLETE_SSE',
  )
  await assert.rejects(
    parseNativeCompactionSse(sseResponse([{ type: 'response.completed', response: { id: 'resp_bad_status', status: 'in_progress', output: validOutput } }])),
    (error) => error?.code === 'LCX_COMPACT_INCOMPLETE_SSE' || error?.code === 'LCX_COMPACT_INVALID_RESPONSE',
  )
})

test('Native compaction rejects orphan function_call_output', async () => {
  const response = sseResponse([{
    type: 'response.completed',
    response: {
      id: 'resp_orphan', status: 'completed',
      output: [
        { type: 'function_call_output', call_id: 'orphan', output: 'x' },
        { id: 'cmp_orphan', type: 'compaction', encrypted_content: 'opaque' },
      ],
    },
  }])
  await assert.rejects(parseNativeCompactionSse(response), (error) => error?.code === 'LCX_COMPACT_INVALID_RESPONSE')
})

test('Native replay requires response.completed', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => sseResponse([{
    type: 'response.done',
    response: { id: 'resp_replay_done', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'x' }] }] },
  }])
  try {
    await assert.rejects(async () => {
      for await (const _chunk of requestNativeReplay({ baseURL: 'https://example.invalid/v1', model: 'gpt-5.6-terra', input: [], headers: {}, maxAttempts: 1 })) { /* consume */ }
    }, (error) => error?.code === 'LCX_RESPONSES_INCOMPLETE')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Native compaction exposes only safe upstream machine fields', async () => {
  const response = sseResponse([{
    type: 'response.failed',
    response: {
      error: {
        code: 'invalid_request_error',
        type: 'invalid_request_error',
        param: 'parallel_tool_calls',
        message: 'SECRET provider detail must not escape',
      },
    },
  }])
  await assert.rejects(parseNativeCompactionSse(response), (error) => {
    assert.equal(error?.code, 'LCX_COMPACT_UPSTREAM_ERROR')
    assert.equal(error?.providerCode, 'invalid_request_error')
    assert.equal(error?.providerType, 'invalid_request_error')
    assert.equal(error?.providerParam, 'parallel_tool_calls')
    assert.match(String(error?.message ?? ''), /providerCode=invalid_request_error/u)
    assert.match(String(error?.message ?? ''), /providerType=invalid_request_error/u)
    assert.match(String(error?.message ?? ''), /providerParam=parallel_tool_calls/u)
    assert.doesNotMatch(String(error?.message ?? ''), /SECRET|provider detail/u)
    return true
  })
})