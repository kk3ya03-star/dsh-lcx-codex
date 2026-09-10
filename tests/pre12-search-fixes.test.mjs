import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import apply from '../lib/index.js'
import {
  hostedMediaPresentationMeta,
  parseHostedSearchResponse,
  renderHostedSearchResult,
} from '../lib/web-search-hosted.js'
import {
  ALPHA_PROBE_VERSION,
  ALPHA_SCHEMA_FINGERPRINT,
  ALPHA_STATEFUL_RETRY_MAX_ATTEMPTS,
  alphaSearchRetryOptions,
  fetchAlphaSearchJson,
  normalizeAlphaSearchArgs,
  parseAlphaSearchResponse,
  renderAlphaSearchResult,
  runWithAlphaSessionLock,
} from '../lib/web-search-alpha.js'
import {
  AlphaCapabilityStore,
  alphaActionState,
  alphaAdvertisedActions,
  alphaCapabilityFingerprint,
  alphaCapabilityUsable,
  alphaSearchParametersFor,
  assertAlphaActionAllowed,
} from '../lib/web-search-capability.js'
import { AlphaRefStore } from '../lib/web-search-ref-store.js'
import { routeFingerprint } from '../lib/route.js'

function hostedCitationFixture(maxResults) {
  const cited = 'https://cited.example/evidence'
  const parsed = parseHostedSearchResponse({
    id: 'resp_citation',
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: {
          type: 'search',
          sources: [
            { url: 'https://uncited.example/first', title: 'First consulted source' },
            { url: cited, title: 'Cited evidence' },
          ],
        },
      },
      {
        type: 'message',
        content: [{
          type: 'output_text',
          text: 'A factual claim.',
          annotations: [{ type: 'url_citation', url: cited, title: 'Cited evidence', start_index: 0, end_index: 16 }],
        }],
      },
    ],
  }, 'req-citation', maxResults, '2026-09-09T00:00:00.000Z')
  return { cited, parsed, rendered: renderHostedSearchResult(parsed)[0].text }
}

test('Hosted source quota keeps real citations when maxResults=1', () => {
  const { cited, parsed, rendered } = hostedCitationFixture(1)
  assert.equal(parsed.citations[0].url, cited)
  assert.equal(parsed.sources[0].url, cited)
  assert.equal(parsed.sources.some((source) => source.url === 'https://uncited.example/first'), false)
  assert.equal(parsed.truncated, true)
  assert.equal(rendered.includes(cited), true)
  assert.equal(rendered.includes('https://uncited.example/first'), false)
})

test('Hosted source quota fills remaining slots with unique consulted sources after citations', () => {
  const { cited, parsed, rendered } = hostedCitationFixture(2)
  assert.deepEqual(parsed.sources.map((source) => source.url), [cited, 'https://uncited.example/first'])
  assert.equal(parsed.truncated, false)
  assert.equal(rendered.includes(cited), true)
  assert.equal(rendered.includes('https://uncited.example/first'), true)
})

test('Hosted image renderer keeps imageUrl and sourceWebsiteUrl paired', () => {
  const sourcePage = 'https://science.nasa.gov/image-detail/voyager6-large/'
  const imageUrl = 'https://science.nasa.gov/wp-content/uploads/2024/04/voyager6-large.gif'
  const parsed = parseHostedSearchResponse({
    id: 'resp_image',
    status: 'completed',
    output: [{
      type: 'web_search_call',
      status: 'completed',
      action: { type: 'search', sources: [] },
      results: [{ type: 'image_result', image_url: imageUrl, source_website_url: sourcePage, caption: 'Voyager assembly' }],
    }],
  }, 'req-image')
  assert.equal(parsed.images[0].imageUrl, imageUrl)
  assert.equal(parsed.images[0].sourceWebsiteUrl, sourcePage)
  const rendered = renderHostedSearchResult(parsed)[0].text
  assert.equal(rendered.includes('图片：'), true)
  assert.equal(rendered.includes(`[Voyager assembly](${imageUrl})`), true)
  assert.equal(rendered.includes(sourcePage), true)
  assert.deepEqual(hostedMediaPresentationMeta(parsed, 'web_search', { owner: 'native' }), {
    owner: 'native',
    lcxHostedMedia: {
      version: 1,
      tool: 'web_search',
      candidates: [{ kind: 'image', url: imageUrl, sourceUrl: sourcePage, caption: 'Voyager assembly', structured: true }],
    },
  })
})

test('Hosted parser projects Responses usage without forging chat-turn meter fields', () => {
  const parsed = parseHostedSearchResponse({
    id: 'resp_search_audit',
    status: 'completed',
    output_text: 'Search result',
    output: [{
      type: 'web_search_call',
      status: 'completed',
      action: { type: 'search', sources: [{ url: 'https://example.com/source' }] },
    }],
    usage: {
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
      input_tokens_details: { cached_tokens: 4 },
      server_side_tool_usage_details: { web_search_calls: 3 },
    },
  }, 'req-usage')
  assert.deepEqual(parsed.usage, {
    inputTokens: 20,
    outputTokens: 10,
    totalTokens: 30,
    cachedInputTokens: 4,
    actionCount: 1,
    serverWebSearchCalls: 3,
  })
  const rendered = renderHostedSearchResult(parsed)[0].text
  assert.equal(rendered.includes('cachedInput=4'), true)
  assert.equal(rendered.includes('serverWebSearchCalls=3'), true)
  assert.equal(Object.hasOwn(parsed, 'cacheRead'), false)
  assert.equal(Object.hasOwn(parsed, 'totalTokens'), false)
})

test('Alpha renderer projects parsed opaque refs and numeric link ids without inventing ids', () => {
  const parsed = parseAlphaSearchResponse({
    id: 'alpha_ref_hidden',
    output: 'Opened page without machine reference markers.',
    results: [{
      ref_id: 'turn0view7',
      url: 'https://example.com/docs',
      encrypted_content: 'server-secret',
      links: [{ id: 3, label: 'API', domain: 'example.com', url: 'https://example.com/docs/api' }],
    }],
  }, {
    action: 'open',
    capability: 'command-capable',
    requestId: 'req-alpha-ref',
    retrievedAt: '2026-09-09T00:00:00.000Z',
  })
  assert.deepEqual(parsed.refs, ['turn0view7'])
  assert.equal(parsed.results[0].encrypted_content, undefined)
  assert.equal(parsed.links.some((link) => link.id === 3), true)
  const rendered = renderAlphaSearchResult(parsed)[0].text
  assert.equal(rendered.includes('turn0view7'), true)
  assert.equal(rendered.includes('https://example.com/docs'), true)
  assert.equal(rendered.includes('linkId=3'), true)
  assert.equal(rendered.includes('https://example.com/docs/api'), true)
  assert.equal(rendered.includes('server-secret'), false)
  assert.equal(rendered.includes('linkId=99'), false)
})

test('Alpha click/open continue to require the originating session and route ref store', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-pre12-ref-'))
  try {
    const parsed = parseAlphaSearchResponse({
      output: 'Opened page without machine reference markers.',
      results: [{ ref_id: 'turn0view7', url: 'https://example.com/docs' }],
    }, {
      action: 'open',
      capability: 'command-capable',
      requestId: 'req-store',
      retrievedAt: '2026-09-09T00:00:00.000Z',
    })
    const store = new AlphaRefStore(join(directory, 'refs.json'))
    store.record('session-a', 'route-a', parsed.refRecords)
    const accepted = store.assertUsable('session-a', 'route-a', 'turn0view7')
    assert.equal(accepted.refId, 'turn0view7')
    assert.equal(accepted.url, 'https://example.com/docs')
    assert.equal(accepted.provenance.action, 'open')
    assert.match(accepted.provenance.originFingerprint, /^[a-f0-9]{64}$/)
    assert.throws(() => store.assertUsable('session-b', 'route-a', 'turn0view7'), (error) => error?.code === 'LCX_ALPHA_REF_UNAVAILABLE')
    assert.throws(() => store.assertUsable('session-a', 'route-b', 'turn0view7'), (error) => error?.code === 'LCX_ALPHA_REF_UNAVAILABLE')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

function commandCapableRecord(actions) {
  return {
    classification: 'command-capable',
    actions,
    probedAt: '2026-09-09T00:00:00.000Z',
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    probeVersion: ALPHA_PROBE_VERSION,
    provenance: 'unavailable',
  }
}

test('Alpha execution helpers refuse unsupported actions without claiming unknown is supported', () => {
  const record = commandCapableRecord({
    search_query: 'supported',
    open: 'supported',
    find: 'supported',
    image_query: 'unsupported',
    weather: 'unknown',
  })
  assert.equal(alphaCapabilityUsable(record), true)
  assert.equal(alphaActionState(record, 'image_query'), 'unsupported')
  assert.equal(alphaActionState(record, 'weather'), 'unknown')
  assert.notEqual(alphaActionState(record, 'weather'), 'supported')
  assert.throws(() => assertAlphaActionAllowed(record, 'image_query'), (error) => error?.code === 'LCX_ALPHA_ACTION_UNSUPPORTED')
  assert.doesNotThrow(() => assertAlphaActionAllowed(record, 'weather'))
  assert.doesNotThrow(() => assertAlphaActionAllowed(record, 'search_query'))
  assert.equal(alphaAdvertisedActions(record).includes('image_query'), false)
  assert.equal(alphaAdvertisedActions(record).includes('weather'), true)
  assert.equal(alphaSearchParametersFor(record).properties.action.enum.includes('image_query'), false)
})

test('Alpha action gating still requires matching schema fingerprint, probe version and route identity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-pre12-cap-'))
  try {
    assert.equal(ALPHA_PROBE_VERSION, 12)
    const store = new AlphaCapabilityStore(join(directory, 'capabilities.json'))
    const verifiedRoute = {
      baseURL: 'https://alpha.example/v1',
      provider: 'relay',
      model: 'gpt-5.6-sol',
      profile: 'oauth',
      group: 'alpha',
      schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    }
    const otherRoute = { ...verifiedRoute, model: 'gpt-5.6-terra' }
    const record = commandCapableRecord({
      search_query: 'supported',
      open: 'supported',
      find: 'supported',
      image_query: 'unsupported',
    })
    store.put(alphaCapabilityFingerprint(verifiedRoute), record)
    const cached = store.get(alphaCapabilityFingerprint(verifiedRoute))
    assert.equal(alphaCapabilityUsable(cached), true)
    assert.throws(() => assertAlphaActionAllowed(cached, 'image_query'), (error) => error?.code === 'LCX_ALPHA_ACTION_UNSUPPORTED')
    assert.equal(store.get(alphaCapabilityFingerprint(otherRoute)), undefined)
    const stale = { ...record, probeVersion: ALPHA_PROBE_VERSION - 1 }
    assert.equal(alphaCapabilityUsable(stale), false)
    const otherSchema = { ...record, schemaFingerprint: 'other-schema' }
    assert.equal(otherSchema.schemaFingerprint === ALPHA_SCHEMA_FINGERPRINT, false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Alpha rejects impossible calendar dates before a network body is built', () => {
  assert.throws(
    () => normalizeAlphaSearchArgs({ action: 'weather', location: 'Houston', start: '2026-02-31' }),
    (error) => error?.code === 'WEB_INVALID_REQUEST',
  )
  assert.throws(
    () => normalizeAlphaSearchArgs({ action: 'sports', fn: 'schedule', league: 'nba', dateFrom: '2026-02-31' }),
    (error) => error?.code === 'WEB_INVALID_REQUEST',
  )
  assert.throws(
    () => normalizeAlphaSearchArgs({ action: 'sports', fn: 'schedule', league: 'nba', dateTo: '2025-02-29' }),
    (error) => error?.code === 'WEB_INVALID_REQUEST',
  )
  assert.throws(
    () => normalizeAlphaSearchArgs({ action: 'weather', location: 'Houston', start: '2026-04-31' }),
    (error) => error?.code === 'WEB_INVALID_REQUEST',
  )
  assert.throws(
    () => normalizeAlphaSearchArgs({ action: 'weather', location: 'Houston', start: '2100-02-29' }),
    (error) => error?.code === 'WEB_INVALID_REQUEST',
  )
  assert.equal(normalizeAlphaSearchArgs({ action: 'weather', location: 'Houston', start: '2024-02-29' }).start, '2024-02-29')
  assert.equal(normalizeAlphaSearchArgs({ action: 'weather', location: 'Houston', start: '2000-02-29' }).start, '2000-02-29')
  assert.equal(normalizeAlphaSearchArgs({ action: 'weather', location: 'Houston', start: '2026-01-31' }).start, '2026-01-31')
  assert.equal(normalizeAlphaSearchArgs({ action: 'sports', fn: 'schedule', league: 'nba', dateFrom: '2026-04-30', dateTo: '2026-12-31' }).dateTo, '2026-12-31')
})

test('Alpha stateful helper never auto-retries a POST that may already have executed', async (t) => {
  assert.equal(ALPHA_STATEFUL_RETRY_MAX_ATTEMPTS, 1)
  assert.equal(alphaSearchRetryOptions(1024).maxAttempts, 1)
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push({ headers: new Headers(init.headers), body: JSON.parse(init.body) })
    return new Response('retry', { status: 500, headers: { 'retry-after-ms': '0' } })
  })
  await assert.rejects(() => fetchAlphaSearchJson({
    url: 'https://gateway.example/v1/alpha/search',
    body: { id: 'session-search-audit', commands: { time: [{ utc_offset: '+00:00' }] } },
    headers: { authorization: 'Bearer synthetic' },
    sessionId: 'session-search-audit',
    timeoutMs: 1000,
  }))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].body.id, 'session-search-audit')
  assert.equal(requests[0].headers.has('idempotency-key'), false)
  assert.equal(requests[0].headers.has('Idempotency-Key'), false)
})

function productionAlphaHarness(directory, actions, { maxAttempts = 3 } = {}) {
  const route = {
    provider: 'fixture',
    model: 'gpt-fixture',
    baseURL: 'https://gateway.example/v1',
  }
  const capabilityPath = join(directory, 'capabilities.json')
  const refPath = join(directory, 'refs.json')
  new AlphaCapabilityStore(capabilityPath).put(alphaCapabilityFingerprint({
    ...route,
    profile: '',
    group: '',
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
  }), commandCapableRecord(actions))
  const handlers = new Map()
  const ctx = {
    logger: { info() {}, warn() {} },
    llm: {},
    sessions: {},
    credentials: { resolve: async () => ({ value: 'synthetic-key' }) },
    attachments: {},
    fs: {},
    web: { searchProviderId: 'native', registerSearchProvider() {} },
    tools: { register() { throw new Error('global tool registration is forbidden') } },
    settings: {
      get: () => ({ providers: { fixture: { api: 'openai-responses', baseURL: route.baseURL, apiKeyEnv: 'FIXTURE_KEY' } } }),
      installSection(_owner, _key, _schema, _base, hooks) {
        hooks.setSource(() => ({ enabled: true, webSearch: true, advancedHostedSearch: false, alphaSearch: true }))
        hooks.onChange()
      },
    },
    on(name, handler) { handlers.set(name, handler) },
    get(name) { return this[name] },
    inject() {},
    effect() {},
  }
  apply(ctx, { alphaCapabilityPath: capabilityPath, alphaRefPath: refPath, maxAttempts })
  const createAgent = (sessionId) => {
    const local = new Map()
    const tools = {
      get(name) { return local.get(name) },
      register(definition) {
        local.set(definition.name, definition)
        return () => {
          if (local.get(definition.name) === definition) local.delete(definition.name)
        }
      },
    }
    const agent = {
      options: route,
      session: Session.create(SessionId(sessionId)),
      ctx: { get: (name) => name === 'tools' ? tools : undefined },
    }
    handlers.get('agent/created')({ agent })
    return { agent, tool: local.get('websearch_alpha'), sessionId }
  }
  return { createAgent, refPath, route }
}

test('production Alpha execute refuses unsupported actions with zero network calls', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-pre12-exec-unsup-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const { createAgent } = productionAlphaHarness(directory, {
    search_query: 'supported',
    open: 'supported',
    find: 'supported',
    image_query: 'unsupported',
    time: 'supported',
  })
  const { agent, tool } = createAgent('session-unsupported')
  assert.ok(tool)
  assert.equal(tool.parameters.properties.action.enum.includes('image_query'), false)
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1
    return new Response(JSON.stringify({ output: 'should not run', results: [] }), { headers: { 'content-type': 'application/json' } })
  })
  await assert.rejects(
    tool.execute({ action: 'image_query', query: 'Voyager' }, { agent, signal: new AbortController().signal }),
    (error) => error?.code === 'LCX_ALPHA_ACTION_UNSUPPORTED',
  )
  assert.equal(requests, 0)
})

test('production Alpha execute does not retry a stateful POST after a retryable network error', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-pre12-exec-retry-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const { createAgent } = productionAlphaHarness(directory, { time: 'supported' }, { maxAttempts: 3 })
  const { agent, tool, sessionId } = createAgent('session-retry')
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push({ headers: new Headers(init.headers), body: JSON.parse(init.body) })
    return new Response('retry', { status: 500, headers: { 'retry-after-ms': '0' } })
  })
  await assert.rejects(
    tool.execute({ action: 'time', utcOffset: '+00:00' }, { agent, signal: new AbortController().signal }),
    (error) => error?.code === 'LCX_ALPHA_PROVIDER_ERROR',
  )
  assert.equal(requests.length, 1)
  assert.equal(requests[0].body.id, sessionId)
  assert.equal(requests[0].headers.has('idempotency-key'), false)
})

test('production Alpha execute serializes one session and does not block another session', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-pre12-exec-lock-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const { createAgent } = productionAlphaHarness(directory, { time: 'supported' })
  const same = createAgent('session-same')
  const left = createAgent('session-left')
  const right = createAgent('session-right')
  let active = 0
  let maximumSame = 0
  let releaseSame
  const sameGate = new Promise((resolve) => { releaseSame = resolve })
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.id === 'session-same') {
      active += 1
      maximumSame = Math.max(maximumSame, active)
      await sameGate
      active -= 1
    }
    return new Response(JSON.stringify({
      output: `UTC ${body.commands.time[0].utc_offset}`,
      results: [{ ref_id: `turn-time-${body.id}-${body.commands.time[0].utc_offset.replace(/\W/gu, '')}` }],
    }), { headers: { 'content-type': 'application/json' } })
  })
  const first = same.tool.execute({ action: 'time', utcOffset: '+00:00' }, { agent: same.agent, signal: new AbortController().signal })
  const second = same.tool.execute({ action: 'time', utcOffset: '+01:00' }, { agent: same.agent, signal: new AbortController().signal })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(maximumSame, 1)
  releaseSame()
  await Promise.all([first, second])

  let crossActive = 0
  let maximumCross = 0
  let releaseCross
  const crossGate = new Promise((resolve) => { releaseCross = resolve })
  globalThis.fetch.mock.mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.id === 'session-left' || body.id === 'session-right') {
      crossActive += 1
      maximumCross = Math.max(maximumCross, crossActive)
      await crossGate
      crossActive -= 1
    }
    return new Response(JSON.stringify({
      output: 'UTC',
      results: [{ ref_id: `turn-time-${body.id}-${body.commands.time[0].utc_offset.replace(/\W/gu, '')}` }],
    }), { headers: { 'content-type': 'application/json' } })
  })
  const leftCall = left.tool.execute({ action: 'time', utcOffset: '+00:00' }, { agent: left.agent, signal: new AbortController().signal })
  const rightCall = right.tool.execute({ action: 'time', utcOffset: '+02:00' }, { agent: right.agent, signal: new AbortController().signal })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(maximumCross, 2)
  releaseCross()
  await Promise.all([leftCall, rightCall])
})

test('production Alpha execute keeps ref check, fetch and store write in one session transaction', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-pre12-exec-tx-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const { createAgent } = productionAlphaHarness(directory, {
    search_query: 'supported',
    open: 'supported',
    time: 'supported',
  })
  const { agent, tool, sessionId } = createAgent('session-tx')
  let releaseSearch
  const searchGate = new Promise((resolve) => { releaseSearch = resolve })
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body)
    requests.push(body)
    if (body.commands.search_query) {
      await searchGate
      return new Response(JSON.stringify({
        output: 'Opened page without machine reference markers.',
        results: [{ ref_id: 'turn0view7', url: 'https://example.com/docs' }],
      }), { headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({
      output: 'Follow-up open',
      results: [{ ref_id: 'turn0view8', url: 'https://example.com/docs' }],
    }), { headers: { 'content-type': 'application/json' } })
  })
  const search = tool.execute({ action: 'search_query', query: 'docs' }, { agent, signal: new AbortController().signal })
  await new Promise((resolve) => setImmediate(resolve))
  let openFailed
  const open = tool.execute({ action: 'open', refId: 'turn0view7' }, { agent, signal: new AbortController().signal }).catch((error) => {
    openFailed = error
    throw error
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(openFailed, undefined)
  assert.equal(requests.length, 1)
  assert.equal(Object.hasOwn(requests[0].commands, 'search_query'), true)
  releaseSearch()
  const [searchResult, openResult] = await Promise.all([search, open])
  assert.deepEqual(searchResult.refs, ['turn0view7'])
  assert.ok(openResult.refs.includes('turn0view8') || openResult.refs.includes('turn0view7'))
  assert.equal(requests.length, 2)
  assert.equal(requests[1].id, sessionId)
  assert.equal(requests[1].commands.open[0].ref_id, 'turn0view7')
})

test('production Alpha continuation echo inherits accepted origin only without URL or artifact conflict', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-issue67-continuation-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const { createAgent, refPath, route } = productionAlphaHarness(directory, {
    search_query: 'supported', open: 'supported',
  })
  const { agent, tool, sessionId } = createAgent('session-continuation')
  let openResponse = { id: 'response-open-echo', output: 'Echo', results: [{ ref_id: 'turn0search0' }] }
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body)
    const value = body.commands.search_query ? {
      id: 'response-search-origin', output: 'Search',
      results: [{ ref_id: 'turn0search0', url: 'https://example.com/docs', provenance: { source: 'original' } }],
    } : openResponse
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
  })
  await tool.execute({ action: 'search_query', query: 'docs' }, { agent })
  const fingerprint = routeFingerprint({ ...route, sessionId })
  const before = new AlphaRefStore(refPath).assertUsable(sessionId, fingerprint, 'turn0search0')
  await assert.doesNotReject(tool.execute({ action: 'open', refId: 'turn0search0' }, { agent }))
  assert.deepEqual(new AlphaRefStore(refPath).assertUsable(sessionId, fingerprint, 'turn0search0'), before)

  openResponse = {
    id: 'response-open-url-conflict', output: 'Changed URL',
    results: [{ ref_id: 'turn0search0', url: 'https://example.com/other' }],
  }
  await assert.rejects(tool.execute({ action: 'open', refId: 'turn0search0' }, { agent }),
    (error) => error?.code === 'LCX_ALPHA_REF_COLLISION')
  openResponse = {
    id: 'response-open-provenance-conflict', output: 'Changed provenance',
    results: [{ ref_id: 'turn0search0', provenance: { source: 'different' } }],
  }
  await assert.rejects(tool.execute({ action: 'open', refId: 'turn0search0' }, { agent }),
    (error) => error?.code === 'LCX_ALPHA_REF_COLLISION')
  assert.deepEqual(new AlphaRefStore(refPath).assertUsable(sessionId, fingerprint, 'turn0search0'), before)
})

test('production Alpha continuation preserves a migrated legacy-unattributed input ref', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-issue67-legacy-continuation-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const sessionId = 'session-legacy-continuation'
  const route = { provider: 'fixture', model: 'gpt-fixture', baseURL: 'https://gateway.example/v1' }
  const refPath = join(directory, 'refs.json')
  writeFileSync(refPath, `${JSON.stringify({
    version: 1,
    sessions: {
      [sessionId]: {
        routeFingerprint: routeFingerprint({ ...route, sessionId }),
        updatedAt: '2026-09-09T00:00:00.000Z',
        refs: { turn0search0: { refId: 'turn0search0', url: 'https://example.com/docs' } },
      },
    },
  }, null, 2)}\n`)
  const { createAgent } = productionAlphaHarness(directory, { open: 'supported' })
  const { agent, tool } = createAgent(sessionId)
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    id: 'new-response-must-not-replace-legacy-origin',
    output: 'Opened legacy reference',
    results: [{ ref_id: 'turn0search0' }],
  }), { headers: { 'content-type': 'application/json' } }))
  await assert.doesNotReject(tool.execute({ action: 'open', refId: 'turn0search0' }, { agent }))
  const accepted = new AlphaRefStore(refPath).assertUsable(
    sessionId, routeFingerprint({ ...route, sessionId }), 'turn0search0',
  )
  assert.equal(accepted.url, 'https://example.com/docs')
  assert.equal(accepted.provenance.action, 'legacy-unattributed')
  assert.equal(accepted.provenance.originKind, 'legacy-unattributed')
})

test('production Alpha execute does not register refs from a top-level open fetch-failure envelope', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-lcx-pre12-exec-fetchfail-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const { createAgent, refPath, route } = productionAlphaHarness(directory, {
    search_query: 'supported',
    open: 'supported',
  })
  const { agent, tool, sessionId } = createAgent('session-fetch-fail')
  const live = [
    'Internal Error ()',
    '\uE200cite\uE202turn1view0\uE201 [wordlim: 200] Source: open({"ref_id":"turn0search0","lineno":null}); Total lines: 1',
    'L0: Failed to fetch https://platform.openai.com/docs/quickstart/make-your-first-api-request: (404) Not Found',
  ].join('\n')
  const opens = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.commands.search_query) {
      return new Response(JSON.stringify({
        output: 'Docs\n\uE200cite\uE202turn0search0\uE201',
        results: [{ ref_id: 'turn0search0', url: 'https://platform.openai.com/docs/quickstart/make-your-first-api-request' }],
      }), { headers: { 'content-type': 'application/json' } })
    }
    opens.push(body)
    return new Response(JSON.stringify({
      output: live,
      results: [{ ref_id: 'turn1view0' }],
    }), { headers: { 'content-type': 'application/json' } })
  })
  await tool.execute({ action: 'search_query', query: 'quickstart' }, { agent, signal: new AbortController().signal })
  await assert.rejects(
    tool.execute({ action: 'open', refId: 'turn0search0' }, { agent, signal: new AbortController().signal }),
    (error) => error?.code === 'LCX_ALPHA_ACTION_FAILED',
  )
  assert.equal(opens.length, 1)
  const store = new AlphaRefStore(refPath)
  const fingerprint = routeFingerprint({ ...route, sessionId })
  assert.doesNotThrow(() => store.assertUsable(sessionId, fingerprint, 'turn0search0'))
  assert.throws(() => store.assertUsable(sessionId, fingerprint, 'turn1view0'))
})

test('Alpha session lock serializes one session without blocking another session', async () => {
  let active = 0
  let maximumSame = 0
  let maximumCross = 0
  let releaseSame
  const sameGate = new Promise((resolve) => { releaseSame = resolve })
  const sameTask = async () => {
    active += 1
    maximumSame = Math.max(maximumSame, active)
    await sameGate
    active -= 1
  }
  const first = runWithAlphaSessionLock('session-a', new AbortController().signal, sameTask)
  const second = runWithAlphaSessionLock('session-a', new AbortController().signal, sameTask)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(maximumSame, 1)
  releaseSame()
  await Promise.all([first, second])

  let crossActive = 0
  let releaseCross
  const crossGate = new Promise((resolve) => { releaseCross = resolve })
  const crossTask = async () => {
    crossActive += 1
    maximumCross = Math.max(maximumCross, crossActive)
    await crossGate
    crossActive -= 1
  }
  const left = runWithAlphaSessionLock('session-left', new AbortController().signal, crossTask)
  const right = runWithAlphaSessionLock('session-right', new AbortController().signal, crossTask)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(maximumCross, 2)
  releaseCross()
  await Promise.all([left, right])
})
