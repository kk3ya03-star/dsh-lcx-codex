import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { apply as applyPi, Config as PiConfig } from '@deepseek-ai/dsh-llm-pi-ai'
import { SettingsForms } from '@deepseek-ai/dsh-settings'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { normalizeContext } from '@earendil-works/pi-ai'
import { streamSimple as piStreamSimple } from '@earendil-works/pi-ai/api/openai-responses'
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options'
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared'
import { loadSource } from './wp2-source.mjs'

const { DEFAULTS } = await loadSource('defaults')
const { planToolSurface } = await loadSource('tool-surface')
const { serializeDshMessages } = await loadSource('dsh-responses')
const {
  buildResponsesBody,
  configurationUpdateEffort,
  responsesGenerationEnvelope,
} = await loadSource('responses-request')
const { buildNativeCompactionBody, requestNativeCompaction } = await loadSource('compact-v2')
const {
  resolveResponsesRouteConfig,
  resolveGrokResponsesRouteConfig,
  resolveRouteHeaderAuthorityFingerprint,
  diagnoseGrokContextBudget,
  baseURLFingerprint,
  requestHeaderAuthorityFingerprint,
} = await loadSource('route')
const { stateRouteCompatible } = await loadSource('native-checkpoint')
const {
  default: apply,
  Config,
  serializeNativeAware,
  managedResponsesStream,
  remoteCompactionStream,
  managedGrokNativeSearchStream,
  executeHostedSearch,
  routeWithPolicies,
} = await loadSource(
  'index',
  'serializeNativeAware, managedResponsesStream, remoteCompactionStream, managedGrokNativeSearchStream, executeHostedSearch, routeWithPolicies',
)

process.env.TEST_LCX_API_KEY = 'sk-test-token'

function makeTool(name, description = `Tool ${name}`) {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  }
}

function makePiSolModel(id = 'gpt-6-sol', compatOverrides = {}) {
  return {
    id,
    name: id,
    api: 'openai-responses',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 400_000,
    maxTokens: 128_000,
    supportsDeveloperMessages: true,
    supportsMidConvoSystemMessages: true,
    supportsAdditionalTools: true,
    thinkingLevelMap:
      id === 'gpt-6.2-sol'
        ? { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' }
        : { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
    compat: {
      supportsDeveloperRole: true,
      supportsStrictMode: true,
      supportsOpenAIGrammarTools: true,
      supportsAdditionalTools: true,
      supportsToolSearch: true,
      supportsExplicitPromptCacheMode: true,
      supportsLongCacheRetention: false,
      promptCacheKeyMode: 'auto',
      ...compatOverrides,
    },
  }
}

function makeSolRouteConfig(overrides = {}) {
  return {
    provider: 'openai',
    model: 'gpt-6-sol',
    api: 'openai-responses',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'TEST_LCX_API_KEY',
    headers: {},
    cacheRetention: 'short',
    supportsLongCacheRetention: false,
    nativeCompaction: false,
    nativeCompactionKeepRecentTurns: 0,
    incrementalToolUpdates: true,
    gatewayCompatibilityFallback: false,
    timeoutMs: 5_000,
    maxAttempts: 1,
    maxRequestImages: 50,
    imageOffloadCountQuantum: 10,
    responsesCompat: {
      supportsDeveloperRole: true,
      supportsStrictMode: true,
      supportsOpenAIGrammarTools: true,
      supportsAdditionalTools: true,
      supportsToolSearch: true,
      supportsExplicitPromptCacheMode: true,
      supportsLongCacheRetention: false,
      promptCacheKeyMode: 'auto',
    },
    ...overrides,
  }
}

function makeMockCtx(extra = {}) {
  const warnings = []
  const debugs = []
  const infos = []
  const errors = []
  const listeners = new Map()
  const providers = extra.providers ?? {
    openai: {
      baseURL: 'https://api.openai.com/v1',
      apiKeyEnv: 'TEST_LCX_API_KEY',
    },
  }
  const logger = {
    warn: (...args) => warnings.push(args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    debug: (...args) => debugs.push(args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    info: (...args) => infos.push(args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    error: (...args) => errors.push(args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    trace: () => {},
  }
  const commandBuilder = () => {
    const chain = {
      subcommand: () => chain,
      option: () => chain,
      usage: () => chain,
      alias: () => chain,
      action: () => chain,
    }
    return chain
  }
  const ctx = {
    logger,
    getLogger: () => logger,
    get(name) {
      return ctx[name]
    },
    warnings,
    debugs,
    infos,
    errors,
    listeners,
    on(event, fn) {
      const list = listeners.get(event) ?? []
      list.push(fn)
      listeners.set(event, list)
      return () => {
        const current = listeners.get(event) ?? []
        listeners.set(
          event,
          current.filter((entry) => entry !== fn),
        )
      }
    },
    once(event, fn) {
      return ctx.on(event, fn)
    },
    async emitEvent(event, ...args) {
      for (const fn of listeners.get(event) ?? []) {
        await fn(...args)
      }
    },
    effect(fn) {
      return fn()
    },
    inject(deps, fn) {
      if (Array.isArray(deps) && deps.every((d) => ctx[d] !== undefined)) {
        Promise.resolve(fn(ctx)).catch((err) => {
          throw err
        })
      }
      return () => {}
    },
    credentials: {
      resolve: async () => ({ value: 'sk-test-token' }),
    },
    command: commandBuilder,
    i18n: { define() {} },
    scope: { update() {} },
    llm: {
      listConfigurableProviders: () =>
        Object.keys(providers).map((provider) => ({
          provider,
          settingsNs: 'llm-pi-ai',
          settingsPath: ['providers', provider],
        })),
      fileRequestText: (ref) => `[file:${String(ref?.name ?? 'attachment')}]`,
      resolveModelInfo: async (provider, model) => ({
        provider: provider ?? 'openai',
        id: model ?? 'gpt-6-sol',
        model: model ?? 'gpt-6-sol',
        context: { contextWindow: 400_000 },
        contextWindow: 400_000,
        defaultMaxTokens: 128_000,
        maxTokens: 128_000,
        inputModalities: ['text', 'image'],
        reasoning: {
          efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((id) => ({ id, label: id })),
        },
        systemPromptUpdate: 'in-history',
        toolUpdate: 'addition-only',
      }),
    },
    settings: {
      configure() {},
      describe: () => [{ ns: 'llm-pi-ai', value: { providers } }],
    },
    ...extra,
  }
  return ctx
}

function withMockFetch(handler, fn) {
  const originalFetch = globalThis.fetch
  const captured = []
  globalThis.fetch = async (url, init = {}) => {
    const rawBody = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
    captured.push({ url: String(url), init, body: rawBody })
    return handler(String(url), init, rawBody, captured)
  }
  return Promise.resolve()
    .then(() => fn(captured))
    .finally(() => {
      globalThis.fetch = originalFetch
    })
}

function sseCompletedResponse(id = 'resp_1', text = 'ok', model = 'gpt-6-sol') {
  const finalResponse = {
    id,
    object: 'response',
    status: 'completed',
    model,
    output: [
      {
        type: 'message',
        id: `msg_${id}`,
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 10,
      total_tokens: 110,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  }
  const events = [
    { type: 'response.created', response: { ...finalResponse, status: 'in_progress', output: [] } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'message', id: `msg_${id}`, status: 'in_progress', role: 'assistant', content: [] },
    },
    {
      type: 'response.content_part.added',
      item_id: `msg_${id}`,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    },
    {
      type: 'response.output_text.delta',
      item_id: `msg_${id}`,
      output_index: 0,
      content_index: 0,
      delta: text,
    },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: finalResponse.output[0],
    },
    { type: 'response.completed', response: finalResponse },
  ]
  const body = events.map((ev) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`).join('')
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function sseCompactionResponse(encryptedContent = 'opaque-checkpoint-blob') {
  const ev = {
    type: 'response.completed',
    response: {
      id: 'cmp_1',
      object: 'response',
      status: 'completed',
      output: [
        {
          type: 'compaction',
          id: 'cmp_item_1',
          encrypted_content: encryptedContent,
        },
      ],
    },
  }
  const body = `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function makeAssistantReplayMessage(text, { provider = 'openai', model = 'gpt-6-sol', thinkingLevel = 'low' } = {}) {
  return {
    id: `msg_asst_${Math.random().toString(36).slice(2)}`,
    role: 'assistant',
    source: {
      kind: 'model',
      provider,
      model,
      replayState: {
        response: {
          kind: 'pi-ai',
          version: 2,
          api: 'openai-responses',
          provider,
          model,
          stopReason: 'stop',
          providerThinkingLevel: thinkingLevel,
        },
        blocks: [{ type: 'text', text }],
      },
    },
    content: [{ type: 'text', text }],
  }
}

test('WP1: Pi 1.6.0 convertResponsesMessages seam works without includeSystemPrompt and preserves prelude + in-history system updates + gpt-6.2-sol off=null parity', async () => {
  assert.equal(typeof convertResponsesMessages, 'function')
  const model62 = makePiSolModel('gpt-6.2-sol')
  const toolA = makeTool('tool_a')
  const toolB = makeTool('tool_b')
  const ctx = makeMockCtx()

  const messages = [
    { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'turn 1' }] },
    makeAssistantReplayMessage('answer 1', { model: 'gpt-6.2-sol', thinkingLevel: 'low' }),
    { id: 's2', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'Updated policy v2.' }] },
    { id: 'dev_b', role: 'developer', source: { kind: 'tool' }, content: [{ type: 'tool-addition', toolName: 'tool_b' }] },
    { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'turn 2' }] },
  ]

  const serialized = await serializeDshMessages(messages, ctx, {
    route: { provider: 'openai', model: 'gpt-6.2-sol' },
    model: model62,
    responsesCompat: model62.compat,
    systemPrompt: 'Initial base instructions.',
    systemPromptUpdate: 'in-history',
    tools: [toolA, { ...toolB, deferLoading: true }],
    toolUpdate: 'addition-only',
    configurationUpdateEffort: 'high',
    gatewayCompatibilityFallback: false,
  })

  // Initial system prelude and mid-conversation system-prompt snapshot must both live inside input in-history
  const devTexts = serialized.input
    .filter((item) => item?.role === 'developer' && typeof item.content === 'string')
    .map((item) => item.content)
  assert.ok(
    devTexts.some((text) => text.includes('Initial base instructions.')),
    `Expected base instructions in-history, got ${JSON.stringify(serialized.input)}`,
  )
  assert.ok(
    devTexts.some((text) => text.includes('Updated policy v2.')),
    `Expected mid-session developer system-prompt update in-history, got ${JSON.stringify(serialized.input)}`,
  )

  const initialDeclIdx = serialized.input.findIndex((item) => item?.type === 'additional_tools')
  const midSystemIdx = serialized.input.findIndex(
    (item) => item?.role === 'developer' && typeof item.content === 'string' && item.content.includes('Updated policy v2.'),
  )
  assert.ok(initialDeclIdx >= 0, 'Expected additional_tools item in changes mode')
  assert.ok(midSystemIdx > initialDeclIdx, 'Expected in-history system update after initial turn')

  // Verify generation envelope maps gpt-6.2-sol reasoningLevel='off' safely via Pi 1.6.0 (off: null)
  const offEnvelope = responsesGenerationEnvelope({
    reasoningEffort: 'off',
    configurationUpdateEffort: undefined,
    model: model62,
  })
  assert.equal(offEnvelope.reasoning?.effort, undefined)
})

test('WP1: promptCacheKeyMode="disabled" omits prompt_cache_key across responses-request and compact-v2', () => {
  const modelAuto = makePiSolModel('gpt-6-sol', {
    promptCacheKeyMode: 'auto',
    supportsLongCacheRetention: true,
    supportsExplicitPromptCacheMode: false,
  })
  const modelDisabled = makePiSolModel('gpt-6-sol', {
    promptCacheKeyMode: 'disabled',
    supportsLongCacheRetention: true,
    supportsExplicitPromptCacheMode: false,
  })

  const bodyEnabled = buildResponsesBody({
    model: modelAuto,
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    sessionId: 'sess-cache-1',
    promptCacheKey: 'lcx:sess-cache-1',
    cacheRetention: 'long',
  })
  assert.equal(bodyEnabled.prompt_cache_key, 'lcx:sess-cache-1')
  assert.equal(bodyEnabled.prompt_cache_retention, '24h')

  const bodyDisabled = buildResponsesBody({
    model: modelDisabled,
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    sessionId: 'sess-cache-1',
    promptCacheKey: 'lcx:sess-cache-1',
    cacheRetention: 'long',
  })
  assert.equal('prompt_cache_key' in bodyDisabled, false)

  const compactEnabled = buildNativeCompactionBody({
    model: 'gpt-6-sol',
    modelDescriptor: modelAuto,
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    promptCacheKey: 'lcx:sess-cache-1',
    cacheRetention: 'short',
  })
  assert.equal(compactEnabled.prompt_cache_key, 'lcx:sess-cache-1')

  const compactDisabled = buildNativeCompactionBody({
    model: 'gpt-6-sol',
    modelDescriptor: modelDisabled,
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    promptCacheKey: 'lcx:sess-cache-1',
    cacheRetention: 'short',
  })
  assert.equal('prompt_cache_key' in compactDisabled, false)
})

test('WP1: LCX promptCacheKeyMode override suppresses prompt_cache_key across chat, compaction, Hosted Search (<=64 chars), and Grok', async () => {
  const liveSession = Session.create(SessionId('sess-cache-stream'))
  liveSession.append('request/header', {
    header: {
      config: { provider: 'openai', model: 'gpt-6.2-sol', reasoningEffort: 'high', maxTokens: 1024, temperature: 0.2 },
    },
    reason: 'initial',
  })
  liveSession.append('compaction/start', { compactionId: 'cmp-cache-stream', turn: null })
  const ctx = makeMockCtx({
    providers: {
      openai: {
        baseURL: 'https://api.openai.com/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        cacheRetention: 'long',
        compat: { supportsLongCacheRetention: true },
      },
      xai: {
        baseURL: 'https://api.x.ai/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        cacheRetention: 'short',
      },
    },
    waterfall: (_name, _request, headers) => {
      const next = new Headers(headers)
      next.set('x-grok-contributor', 'injected')
      return next
    },
    sessions: {
      get: (id) => (id === 'sess-cache-stream' ? liveSession : undefined),
    },
    sessionQuery: {
      observeSession: async () => ({
        events: liveSession.snapshotEvents(),
        [Symbol.dispose]() {},
      }),
    },
  })
  const basePolicy = {
    responsesApiProviders: ['openai'],
    cacheRetention: 'short',
    incrementalToolUpdates: true,
    gatewayCompatibilityFallback: false,
    promptCacheKeyMode: 'disabled',
  }
  const resolved = routeWithPolicies(
    resolveResponsesRouteConfig(ctx, { provider: 'openai', model: 'gpt-6.2-sol' }, basePolicy),
    basePolicy,
  )
  assert.equal(resolved.responsesCompat?.promptCacheKeyMode, 'disabled')

  // 1) Ordinary GPT chat stream
  await withMockFetch(
    async () => sseCompletedResponse('resp_cache_off', 'ok', 'gpt-6.2-sol'),
    async (captured) => {
      const chunks = []
      for await (const chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-cache-stream',
          system: 'System prompt.',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
        },
        resolved,
        ctx,
      )) {
        chunks.push(chunk)
      }
      assert.equal(captured.length, 1, `Expected fetch call, got chunks=${JSON.stringify(chunks)}`)
      assert.equal('prompt_cache_key' in captured[0].body, false)
      assert.deepEqual(captured[0].body.prompt_cache_options, { ttl: '30m' })
    },
  )

  // 2) Native V2 compaction stream
  await withMockFetch(
    async () => sseCompactionResponse('opaque-cache-off'),
    async (captured) => {
      for await (const _chunk of remoteCompactionStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          purpose: 'compaction',
          sessionId: 'sess-cache-stream',
          system: 'System prompt.',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'compact this' }] }],
        },
        resolved,
        ctx,
        () => { throw new Error('fallback must not run') },
      )) {
        // exhaust stream
      }
      assert.equal(captured.length, 1)
      assert.equal('prompt_cache_key' in captured[0].body, false)
      assert.deepEqual(captured[0].body.prompt_cache_options, { ttl: '30m' })
    },
  )

  // 3) Hosted Search across auto / enabled / disabled / retention=none, ensuring key length <= 64
  for (const [mode, retention, expectKey] of [
    ['auto', 'short', true],
    ['enabled', 'short', true],
    ['disabled', 'short', false],
    ['enabled', 'none', false],
  ]) {
    const searchRoute = routeWithPolicies(
      { ...resolved, cacheRetention: retention, responsesCompat: { ...resolved.responsesCompat, promptCacheKeyMode: mode } },
      { ...basePolicy, promptCacheKeyMode: mode },
    )
    await withMockFetch(
      async () =>
        new Response(
          JSON.stringify({
            id: 'hs_1',
            status: 'completed',
            output_text: 'Search summary.',
            output: [
              {
                type: 'web_search_call',
                id: 'ws_1',
                status: 'completed',
                action: { type: 'search', query: 'test cache key' },
              },
              {
                type: 'message',
                id: 'msg_hs_1',
                status: 'completed',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Search summary.', annotations: [] }],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      async (captured) => {
        await executeHostedSearch(ctx, searchRoute, { query: 'test cache key' }, undefined, 'sess-cache-stream')
        assert.equal(captured.length, 1)
        const key = captured[0].body.prompt_cache_key
        if (expectKey) {
          assert.equal(typeof key, 'string')
          assert.ok(key.startsWith('dsh-lcx-search:'))
          assert.ok(key.length <= 64, `Hosted Search prompt_cache_key must be <= 64 chars, got ${key.length}`)
        } else {
          assert.equal('prompt_cache_key' in captured[0].body, false, `Expected no prompt_cache_key for mode=${mode}, retention=${retention}`)
        }
      },
    )
  }

  // 4) Managed Grok native search honors promptCacheKeyMode="disabled" and request-header contributors
  const grokDisabled = routeWithPolicies(
    resolveGrokResponsesRouteConfig(ctx, { provider: 'xai', model: 'grok-4.7' }, basePolicy),
    basePolicy,
  )
  await withMockFetch(
    async () => sseCompletedResponse('resp_grok_off', 'ok', 'grok-4.7'),
    async (captured) => {
      for await (const _chunk of managedGrokNativeSearchStream(
        {
          provider: 'xai',
          model: 'grok-4.7',
          sessionId: 'sess-grok-off',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }],
        },
        grokDisabled,
        { web: true, x: false },
        ctx,
      )) {
        // exhaust
      }
      assert.equal(captured.length, 1)
      assert.equal('prompt_cache_key' in captured[0].body, false)
      assert.equal(new Headers(captured[0].init.headers).get('x-grok-contributor'), 'injected')
      assert.equal(new Headers(captured[0].init.headers).get('session-id'), 'sess-grok-off')
    },
  )
})

test('P1-7: managedResponsesStream and remoteCompactionStream omit ChatGPT Sign-In unsupported fields on live stream requests', async () => {
  const oauthToken = 'chatgpt-oauth-session-token'
  const liveSession = Session.create(SessionId('sess-chatgpt-stream'))
  liveSession.append('request/header', {
    header: {
      config: { provider: 'openai', model: 'gpt-6.2-sol', reasoningEffort: 'high', maxTokens: 777, temperature: 0.3 },
    },
    reason: 'initial',
  })
  liveSession.append('compaction/start', { compactionId: 'cmp-chatgpt-stream', turn: null })
  const ctx = makeMockCtx({
    providers: {
      openai: {
        baseURL: 'https://api.openai.com/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        cacheRetention: 'long',
      },
    },
    credentials: {
      resolve: async () => ({ value: oauthToken }),
    },
    sessions: {
      get: (id) => (id === 'sess-chatgpt-stream' ? liveSession : undefined),
    },
    sessionQuery: {
      observeSession: async () => ({
        events: liveSession.snapshotEvents(),
        [Symbol.dispose]() {},
      }),
    },
  })
  const routeCfg = routeWithPolicies(
    resolveResponsesRouteConfig(ctx, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
    { gatewayCompatibilityFallback: false },
  )
  await withMockFetch(
    async () => sseCompletedResponse('resp_oauth', 'ok', 'gpt-6.2-sol'),
    async (captured) => {
      for await (const _chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-chatgpt-stream',
          reasoningEffort: 'high',
          temperature: 0.3,
          maxTokens: 777,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello oauth' }] }],
        },
        routeCfg,
        ctx,
      )) {
        // exhaust
      }
      assert.equal(captured.length, 1)
      const body = captured[0].body
      assert.equal(body.prompt_cache_key, 'sess-chatgpt-stream')
      assert.equal('prompt_cache_retention' in body, false)
      assert.equal('prompt_cache_options' in body, false)
      assert.equal('max_output_tokens' in body, false)
      assert.equal('temperature' in body, false)
      assert.equal(body.input.some((item) => item?.type === 'configuration_update'), false)
    },
  )

  await withMockFetch(
    async () => sseCompactionResponse('opaque-oauth'),
    async (captured) => {
      for await (const _chunk of remoteCompactionStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          purpose: 'compaction',
          sessionId: 'sess-chatgpt-stream',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'compact' }] }],
        },
        routeCfg,
        ctx,
        () => { throw new Error('fallback must not run') },
      )) {
        // exhaust
      }
      assert.equal(captured.length, 1)
      const body = captured[0].body
      assert.equal(body.prompt_cache_key, 'sess-chatgpt-stream')
      assert.equal('prompt_cache_retention' in body, false)
      assert.equal('prompt_cache_options' in body, false)
      assert.equal('max_output_tokens' in body, false)
      assert.equal('temperature' in body, false)
    },
  )
})

test('WP2.1: planToolSurface performs clean zero-tool pass-through without warnings when tools & toolHistory are absent, yet warns when tools lack toolHistory', () => {
  const sampleTool = makeTool('read_file')
  const userOnly = [{ role: 'user', content: [{ type: 'text', text: 'Review this patch' }] }]
  const additionFacts = {
    resolved: true,
    toolUpdate: 'addition-only',
    systemPromptUpdate: 'in-history',
    imageSupport: 'supported',
  }
  const compat = { supportsAdditionalTools: true }

  // Case 1: tools undefined, toolHistory undefined, resolved=false -> silent pass-through
  const undefinedToolsPlan = planToolSurface({
    mode: 'addition-only',
    messages: userOnly,
    tools: undefined,
    toolHistory: undefined,
    facts: { resolved: false, reason: 'no-tool-history' },
    compat,
  })
  assert.equal(undefinedToolsPlan.anchored, false)
  assert.equal(undefinedToolsPlan.fallbackUnexpected, undefined)
  assert.equal(undefinedToolsPlan.fallbackReason, undefined)
  assert.equal(undefinedToolsPlan.tools, undefined)

  // Case 2: tools=[], toolHistory undefined -> silent pass-through
  const emptyToolsPlan = planToolSurface({
    mode: 'addition-only',
    messages: userOnly,
    tools: [],
    toolHistory: undefined,
    facts: additionFacts,
    compat,
  })
  assert.equal(emptyToolsPlan.anchored, false)
  assert.equal(emptyToolsPlan.fallbackUnexpected, undefined)
  assert.equal(emptyToolsPlan.fallbackReason, undefined)
  assert.deepEqual(emptyToolsPlan.tools, [])

  // Case 3: tools present WITHOUT toolHistory -> MUST flag fallbackUnexpected
  const missingHistoryPlan = planToolSurface({
    mode: 'addition-only',
    messages: userOnly,
    tools: [sampleTool],
    toolHistory: undefined,
    facts: additionFacts,
    compat,
  })
  assert.equal(missingHistoryPlan.anchored, false)
  assert.equal(missingHistoryPlan.fallbackUnexpected, true)
  assert.equal(missingHistoryPlan.fallbackReason, 'no DSH tool history')

  // Case 4: toolHistory present WITHOUT tools -> MUST flag "no tools"
  const orphanHistoryPlan = planToolSurface({
    mode: 'addition-only',
    messages: userOnly,
    tools: undefined,
    toolHistory: { mode: 'addition-only', initialTools: [sampleTool], updates: [] },
    facts: additionFacts,
    compat,
  })
  assert.equal(orphanHistoryPlan.anchored, false)
  assert.equal(orphanHistoryPlan.fallbackUnexpected, true)
  assert.equal(orphanHistoryPlan.fallbackReason, 'no tools')

  // Case 5: empty tools WITHOUT toolHistory, WITH developer tool-addition blocks -> MUST flag warning
  const devWithEmptyTools = planToolSurface({
    mode: 'addition-only',
    messages: [
      { role: 'developer', content: [{ type: 'tool-addition', tools: [sampleTool] }] },
      ...userOnly,
    ],
    tools: [],
    toolHistory: undefined,
    facts: additionFacts,
    compat,
  })
  assert.equal(devWithEmptyTools.anchored, false)
  assert.equal(devWithEmptyTools.fallbackUnexpected, true)
  assert.equal(devWithEmptyTools.fallbackReason, 'no DSH tool history')

  // Case 6 (P2-1): live tools with history referencing missing developer message MUST flag fallbackUnexpected
  const missingDevUpdate = planToolSurface({
    mode: 'addition-only',
    messages: userOnly,
    tools: [sampleTool, makeTool('write_file')],
    toolHistory: {
      tools: [sampleTool],
      updates: [{ messageId: 'missing_dev_id', additions: [makeTool('write_file')] }],
    },
    facts: additionFacts,
    compat,
  })
  assert.equal(missingDevUpdate.anchored, false)
  assert.equal(missingDevUpdate.fallbackUnexpected, true)
  assert.equal(missingDevUpdate.fallbackReason, 'tool history references missing developer updates')

  // Case 7 (P2-1): live tools with mismatched baseline tool name (even with empty updates) MUST flag fallbackUnexpected
  const mismatchedBaseline = planToolSurface({
    mode: 'addition-only',
    messages: userOnly,
    tools: [sampleTool],
    toolHistory: {
      tools: [makeTool('different_tool')],
      updates: [],
    },
    facts: additionFacts,
    compat,
  })
  assert.equal(mismatchedBaseline.anchored, false)
  assert.equal(mismatchedBaseline.fallbackUnexpected, true)
  assert.equal(mismatchedBaseline.fallbackReason, 'declared tools differ from the active tools')

  // Case 8 (P2-1): valid all-tools-removed turn stays silent (no unexpected fallback)
  const allRemovedPlan = planToolSurface({
    mode: 'addition-only',
    messages: [
      ...userOnly,
      { id: 'dev_remove', role: 'developer', content: [{ type: 'tool-removal', toolName: 'read_file' }] },
    ],
    tools: [],
    toolHistory: {
      tools: [sampleTool],
      updates: [{ messageId: 'dev_remove', additions: [] }],
    },
    facts: additionFacts,
    compat,
  })
  assert.equal(allRemovedPlan.anchored, false)
  assert.equal(allRemovedPlan.fallbackUnexpected, undefined)
  assert.equal(allRemovedPlan.fallbackReason, undefined)

  // Case 9 (P2-E): same-name schema drift while toolHistory holds stale schema + deferred tool triggers fallback
  const updatedAlpha = {
    name: 'alpha_tool',
    description: 'Updated alpha description',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'integer' } },
      required: ['query', 'limit'],
      additionalProperties: false,
    },
  }
  const staleAlpha = makeTool('alpha_tool', 'Old alpha description')
  const betaTool = makeTool('beta_tool')
  const schemaDriftPlan = planToolSurface({
    mode: 'addition-only',
    messages: [
      ...userOnly,
      { id: 'dev_beta', role: 'developer', content: [{ type: 'tool-addition', toolName: 'beta_tool' }] },
    ],
    tools: [updatedAlpha, betaTool],
    toolHistory: {
      tools: [staleAlpha, betaTool],
      updates: [{ messageId: 'dev_beta', additions: [betaTool] }],
    },
    facts: additionFacts,
    compat,
  })
  assert.equal(schemaDriftPlan.anchored, false)
  assert.equal(schemaDriftPlan.fallbackUnexpected, true)
  assert.equal(schemaDriftPlan.fallbackReason, 'declared tools differ from the active tools')
  assert.deepEqual(schemaDriftPlan.tools, [updatedAlpha, betaTool])

  // Case 10 (P2-6): own "__proto__" key inside JSON parameters schema is preserved in canonical signature
  const protoUpdatedAlpha = {
    name: 'alpha_tool',
    description: 'Old alpha description',
    parameters: JSON.parse('{"type":"object","properties":{"query":{"type":"string"},"__proto__":{"type":"string"}},"required":["query"],"additionalProperties":false}'),
  }
  const protoDriftPlan = planToolSurface({
    mode: 'addition-only',
    messages: [
      ...userOnly,
      { id: 'dev_beta', role: 'developer', content: [{ type: 'tool-addition', toolName: 'beta_tool' }] },
    ],
    tools: [protoUpdatedAlpha, betaTool],
    toolHistory: {
      tools: [staleAlpha, betaTool],
      updates: [{ messageId: 'dev_beta', additions: [betaTool] }],
    },
    facts: additionFacts,
    compat,
  })
  assert.equal(protoDriftPlan.anchored, false)
  assert.equal(protoDriftPlan.fallbackUnexpected, true)
  assert.equal(protoDriftPlan.fallbackReason, 'declared tools differ from the active tools')
})

test('WP2.1: managedResponsesStream emits zero tool-surface warnings for tool-less auto-review one-shot, while warning when tools are passed without toolHistory', async () => {
  const ctx = makeMockCtx()
  const routeConfig = makeSolRouteConfig()
  const toolA = makeTool('tool_a')

  await withMockFetch(
    async () => sseCompletedResponse('resp_autoreview'),
    async (captured) => {
      // One-shot auto-review shape (no tools, no toolHistory)
      const chunks1 = []
      for await (const chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6-sol',
          purpose: 'auto-review',
          sessionId: 'sess-review-1',
          system: 'Review guidelines',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'diff --git' }] }],
        },
        routeConfig,
        ctx,
      )) {
        chunks1.push(chunk)
      }

      assert.equal(captured.length, 1, `Expected fetch call, got chunks=${JSON.stringify(chunks1)}`)
      assert.equal(captured[0].body.tools, undefined)
      assert.equal(ctx.warnings.length, 0, `Unexpected warnings for tool-less one-shot: ${ctx.warnings.join('; ')}`)
      assert.equal(
        ctx.debugs.some((line) => line.includes('sending the complete tool list')),
        false,
      )

      // Now send a request WITH tools yet WITHOUT toolHistory on an addition-only route -> MUST warn
      const chunks2 = []
      for await (const chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6-sol',
          sessionId: 'sess-missing-hist',
          system: 'Normal prompt',
          tools: [toolA],
          messages: [{ role: 'user', content: [{ type: 'text', text: 'use tool' }] }],
        },
        routeConfig,
        ctx,
      )) {
        chunks2.push(chunk)
      }

      assert.equal(captured.length, 2, `Expected 2nd fetch call, got chunks=${JSON.stringify(chunks2)}`)
      assert.ok(
        ctx.warnings.some((line) => line.includes('sending the complete tool list')),
        `Expected fallback warning when tools exist without toolHistory, got warnings=${JSON.stringify(ctx.warnings)}`,
      )
    },
  )
})

test('WP3.1: gatewayCompatibilityFallback defaults to false and mounts safely with legacy partial config inputs', () => {
  assert.equal(DEFAULTS.gatewayCompatibilityFallback, false)
  assert.ok(Config.dict.gatewayCompatibilityFallback, 'Expected Config schema key gatewayCompatibilityFallback')
  const parsedDefault = Config({})
  assert.equal(parsedDefault.gatewayCompatibilityFallback.get(), false)
  const parsedEnabled = Config({ gatewayCompatibilityFallback: true })
  assert.equal(parsedEnabled.gatewayCompatibilityFallback.get(), true)

  // Simulate partial legacy mock config where gatewayCompatibilityFallback & incrementalToolUpdates are omitted
  const ctx = makeMockCtx()
  const legacyConfig = { ...Config({ responsesApiProviders: ['openai'] }) }
  delete legacyConfig.gatewayCompatibilityFallback
  delete legacyConfig.incrementalToolUpdates
  apply(ctx, legacyConfig)
  assert.ok(ctx.listeners.has('llm/stream'))
})

test('WP3.1: gatewayCompatibilityFallback OFF vs ON transforms additional_tools and configuration_update into top-level tools and reasoning.effort while preserving in-history system updates', async () => {
  const ctx = makeMockCtx()
  const model = makePiSolModel('gpt-6-sol')
  const toolA = makeTool('tool_a')
  const toolB = makeTool('tool_b')
  const route = { provider: 'openai', model: 'gpt-6-sol' }

  const rawMessages = [
    { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'first prompt' }] },
    makeAssistantReplayMessage('first reply', { model: 'gpt-6-sol', thinkingLevel: 'low' }),
    { id: 's2', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'Updated system prompt v2.' }] },
    { id: 'dev_b', role: 'developer', source: { kind: 'tool' }, content: [{ type: 'tool-addition', toolName: 'tool_b' }] },
    { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'second prompt' }] },
  ]

  const toolHistory = {
    tools: [toolA],
    updates: [{ messageId: 'dev_b', additions: [toolB] }],
  }

  // OFF (default): additional_tools + configuration_update items inside input, no top-level tools
  const routeOff = makeSolRouteConfig({ gatewayCompatibilityFallback: false })
  const offSerialized = await serializeNativeAware(rawMessages, route, routeOff, ctx, {
    tools: [toolA, toolB],
    toolSurface: { history: toolHistory },
    system: 'Base prompt.',
    configurationUpdate: (m) => configurationUpdateEffort(m, 'high', () => 'sk-test-token', { gatewayCompatibilityFallback: false }),
  })
  const offBody = buildResponsesBody({
    model: offSerialized.model,
    input: offSerialized.input,
    tools: offSerialized.tools,
    reasoningEffort: 'high',
    configurationUpdateEffort: offSerialized.configurationUpdateEffort,
    gatewayCompatibilityFallback: false,
  })
  assert.equal(offBody.tools, undefined)
  assert.ok(offBody.input.some((item) => item?.type === 'additional_tools'))
  assert.ok(offBody.input.some((item) => item?.type === 'configuration_update'))
  assert.equal(offBody.reasoning?.effort, 'medium')

  // ON: top-level tools + top-level reasoning.effort, ZERO additional_tools or configuration_update, yet system-prompt in-history stays intact
  const routeOn = makeSolRouteConfig({ gatewayCompatibilityFallback: true })
  const onSerialized = await serializeNativeAware(rawMessages, route, routeOn, ctx, {
    tools: [toolA, toolB],
    toolSurface: { history: toolHistory },
    system: 'Base prompt.',
    configurationUpdate: (m) => configurationUpdateEffort(m, 'high', () => 'sk-test-token', { gatewayCompatibilityFallback: true }),
  })
  const onBody = buildResponsesBody({
    model: onSerialized.model,
    input: onSerialized.input,
    tools: onSerialized.tools,
    reasoningEffort: 'high',
    configurationUpdateEffort: onSerialized.configurationUpdateEffort,
    gatewayCompatibilityFallback: true,
  })

  assert.ok(Array.isArray(onBody.tools))
  assert.deepEqual(
    onBody.tools.map((entry) => entry.name).sort(),
    ['tool_a', 'tool_b'],
  )
  assert.equal(
    onBody.input.some((item) => item?.type === 'additional_tools'),
    false,
    'gatewayCompatibilityFallback=true must suppress additional_tools items',
  )
  assert.equal(
    onBody.input.some((item) => item?.type === 'configuration_update'),
    false,
    'gatewayCompatibilityFallback=true must suppress configuration_update items',
  )
  assert.equal(onBody.reasoning?.effort, 'high')
  assert.equal(
    JSON.stringify(onBody.tools).includes('deferLoading') || JSON.stringify(onBody.tools).includes('defer_loading'),
    false,
  )
  assert.ok(
    onBody.input.some(
      (item) =>
        item?.role === 'developer' &&
        typeof item.content === 'string' &&
        item.content.includes('Updated system prompt v2.'),
    ),
    'in-history system-prompt updates must remain intact when gatewayCompatibilityFallback=true',
  )
  assert.equal(
    await configurationUpdateEffort(model, 'high', () => 'sk-test-token', { gatewayCompatibilityFallback: true }),
    undefined,
  )
})

test('WP3.1: live toggle OFF -> ON -> OFF, native compaction request, and cross-model portable migration stay safe', async () => {
  const ctx = makeMockCtx()
  const toolA = makeTool('tool_a')
  const toolB = makeTool('tool_b')

  const priorMessages = [
    { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'step 1' }] },
    makeAssistantReplayMessage('ok 1', { model: 'gpt-6-sol', thinkingLevel: 'low' }),
    { id: 'dev_b', role: 'developer', source: { kind: 'tool' }, content: [{ type: 'tool-addition', toolName: 'tool_b' }] },
    { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'step 2' }] },
  ]
  const toolHistory = {
    tools: [toolA],
    updates: [{ messageId: 'dev_b', additions: [toolB] }],
  }

  const routeOn = makeSolRouteConfig({ gatewayCompatibilityFallback: true })
  const routeOff = makeSolRouteConfig({ gatewayCompatibilityFallback: false })

  // 1) Start OFF
  const sOff1 = await serializeNativeAware(priorMessages, { provider: 'openai', model: 'gpt-6-sol' }, routeOff, ctx, {
    tools: [toolA, toolB],
    toolSurface: { history: toolHistory },
    system: 'Base prompt.',
    configurationUpdate: (m) => configurationUpdateEffort(m, 'high', () => 'sk-test-token', { gatewayCompatibilityFallback: false }),
  })
  const bOff1 = buildResponsesBody({
    model: sOff1.model,
    input: sOff1.input,
    tools: sOff1.tools,
    reasoningEffort: 'high',
    configurationUpdateEffort: sOff1.configurationUpdateEffort,
    gatewayCompatibilityFallback: false,
  })
  assert.ok(bOff1.input.some((item) => item?.type === 'additional_tools'))
  assert.ok(bOff1.input.some((item) => item?.type === 'configuration_update'))

  // 2) Toggle ON mid-session -> emits top-level tools + reasoning.effort, zero additional_tools/configuration_update
  const sOn = await serializeNativeAware(priorMessages, { provider: 'openai', model: 'gpt-6-sol' }, routeOn, ctx, {
    tools: [toolA, toolB],
    toolSurface: { history: toolHistory },
    system: 'Base prompt.',
    configurationUpdate: (m) => configurationUpdateEffort(m, 'high', () => 'sk-test-token', { gatewayCompatibilityFallback: true }),
  })
  const bOn = buildResponsesBody({
    model: sOn.model,
    input: sOn.input,
    tools: sOn.tools,
    reasoningEffort: 'high',
    configurationUpdateEffort: sOn.configurationUpdateEffort,
    gatewayCompatibilityFallback: true,
  })
  assert.ok(Array.isArray(bOn.tools) && bOn.tools.length === 2)
  assert.equal(bOn.reasoning?.effort, 'high')
  assert.equal(
    bOn.input.some((item) => item?.type === 'additional_tools' || item?.type === 'configuration_update'),
    false,
  )

  // 3) requestNativeCompaction under gatewayCompatibilityFallback=true sends clean tools & no configuration_update/additional_tools
  await withMockFetch(
    async (_url, _init, body) => {
      assert.ok(Array.isArray(body.tools) && body.tools.length === 2)
      assert.equal(
        body.input?.some((item) => item?.type === 'additional_tools' || item?.type === 'configuration_update'),
        false,
      )
      return sseCompactionResponse('opaque-checkpoint-blob')
    },
    async (captured) => {
      const result = await requestNativeCompaction({
        baseURL: routeOn.baseURL,
        model: 'gpt-6-sol',
        modelDescriptor: sOn.model,
        input: sOn.input,
        tools: sOn.tools,
        cacheRetention: 'short',
        promptCacheKey: 'lcx:sess-compact-fallback',
        reasoningEffort: 'high',
        gatewayCompatibilityFallback: true,
        idempotencyKey: 'idem-1',
        headers: { authorization: 'Bearer sk-test-token' },
      })
      assert.equal(captured.length, 1)
      assert.ok(result.compaction?.encrypted_content)
    },
  )

  // 4) Toggle back OFF on the same session -> cleanly restores changes/addition-only serialization
  const sOff2 = await serializeNativeAware(priorMessages, { provider: 'openai', model: 'gpt-6-sol' }, routeOff, ctx, {
    tools: [toolA, toolB],
    toolSurface: { history: toolHistory },
    system: 'Base prompt.',
    configurationUpdate: (m) => configurationUpdateEffort(m, 'high', () => 'sk-test-token', { gatewayCompatibilityFallback: false }),
  })
  const bOff2 = buildResponsesBody({
    model: sOff2.model,
    input: sOff2.input,
    tools: sOff2.tools,
    reasoningEffort: 'high',
    configurationUpdateEffort: sOff2.configurationUpdateEffort,
    gatewayCompatibilityFallback: false,
  })
  assert.ok(bOff2.input.some((item) => item?.type === 'additional_tools'))

  // 5) Cross-model portable migration under gatewayCompatibilityFallback=true stays clean without leaking opaque state
  const sMigrated = await serializeNativeAware(
    priorMessages,
    { provider: 'openai', model: 'gpt-6.2-sol' },
    routeOn,
    ctx,
    {
      tools: [toolA, toolB],
      toolSurface: { history: toolHistory },
      system: 'Base prompt.',
      configurationUpdate: (m) => configurationUpdateEffort(m, 'medium', () => 'sk-test-token', { gatewayCompatibilityFallback: true }),
    },
  )
  const bMigrated = buildResponsesBody({
    model: sMigrated.model,
    input: sMigrated.input,
    tools: sMigrated.tools,
    reasoningEffort: 'medium',
    configurationUpdateEffort: sMigrated.configurationUpdateEffort,
    gatewayCompatibilityFallback: true,
  })
  assert.ok(Array.isArray(bMigrated.tools) && bMigrated.tools.length === 2)
  assert.equal(bMigrated.reasoning?.effort, 'medium')
  assert.equal(
    bMigrated.input.some((item) => item?.type === 'additional_tools' || item?.type === 'configuration_update'),
    false,
  )

  // 6) P2-2: Real managedResponsesStream OFF high -> ON low (live reply generated while ON) -> OFF high replay
  //    preserves `providerThinkingLevel: 'low'` on the ON-stage reply so replaying it after toggling back OFF
  //    emits its historical `configuration_update` item cleanly.
  const onTurnChunks = []
  await withMockFetch(
    async () => sseCompletedResponse('resp_on_low', 'ON-stage low answer', 'gpt-6-sol'),
    async (captured) => {
      for await (const chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6-sol',
          sessionId: 'sess-toggle-replay',
          reasoningEffort: 'low',
          system: 'Base prompt.',
          tools: [toolA, toolB],
          toolHistory: { tools: [toolA, toolB], updates: [] },
          messages: [{ id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'turn while ON' }] }],
        },
        routeOn,
        ctx,
      )) {
        onTurnChunks.push(chunk)
      }
      assert.equal(captured.length, 1)
      assert.equal(captured[0].body.reasoning?.effort, 'low')
      assert.equal(captured[0].body.input.some((item) => item?.type === 'configuration_update'), false)
    },
  )
  const onFinish = onTurnChunks.find((chunk) => chunk?.type === 'finish')
  assert.equal(onFinish?.replayState?.response?.providerThinkingLevel, 'low', 'ON-stage reply must persist mapped providerThinkingLevel for future OFF replay')

  const onAssistantMsg = {
    id: 'msg_on_low',
    role: 'assistant',
    source: {
      kind: 'model',
      provider: 'openai',
      model: 'gpt-6-sol',
      replayState: onFinish.replayState,
    },
    content: [{ type: 'text', text: 'ON-stage low answer' }],
  }
  await withMockFetch(
    async () => sseCompletedResponse('resp_off_high', 'OFF-stage high answer', 'gpt-6-sol'),
    async (captured) => {
      for await (const _chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6-sol',
          sessionId: 'sess-toggle-replay',
          reasoningEffort: 'high',
          system: 'Base prompt.',
          tools: [toolA, toolB],
          toolHistory: { tools: [toolA, toolB], updates: [] },
          messages: [
            { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'turn while ON' }] },
            onAssistantMsg,
            { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'turn after OFF' }] },
          ],
        },
        routeOff,
        ctx,
      )) {
        // exhaust
      }
      assert.equal(captured.length, 1)
      const updates = captured[0].body.input.filter((item) => item?.type === 'configuration_update')
      assert.deepEqual(
        updates.map((item) => item?.reasoning?.effort),
        ['low', 'high'],
        'Historical ON-stage low reply must reconstruct its configuration_update before current high update',
      )
    },
  )
})

test('Cross-module Grok budget diagnostic hook emits deduplicated warning via ctx.logger.warn and re-warns only if diagnosis changes', async () => {
  const xaiProfileBad = {
    provider: 'xai',
    baseURL: 'https://api.x.ai/v1',
    apiKeyEnv: 'TEST_LCX_API_KEY',
    models: [
      {
        id: 'grok-4.20-experimental-beta-0304-reasoning',
        maxTokens: 2_000_000,
        contextWindow: 2_000_000,
      },
      {
        id: 'gpt-test',
        maxTokens: 128_000,
        contextWindow: 128_000,
      },
    ],
  }
  const xaiProfileFixed = {
    ...xaiProfileBad,
    models: [
      {
        id: 'grok-4.20-experimental-beta-0304-reasoning',
        maxTokens: 64_000,
        contextWindow: 2_000_000,
      },
    ],
  }

  const providers = {
    xai: xaiProfileBad,
    openrouter: {
      baseURL: 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'TEST_LCX_API_KEY',
      models: [{ id: 'x-ai/grok-4.7', maxTokens: 500_000 }],
    },
  }
  const ctx = makeMockCtx({
    providers,
    llm: {
      listConfigurableProviders: () =>
        Object.keys(providers).map((provider) => ({
          provider,
          settingsNs: 'llm-pi-ai',
          settingsPath: ['providers', provider],
        })),
      fileRequestText: (ref) => `[file:${String(ref?.name ?? 'attachment')}]`,
      resolveModelInfo: async (provider, model) => {
        const entry = providers[provider]?.models?.find((m) => m.id === model)
        const contextWindow = entry?.contextWindow ?? (provider === 'openrouter' ? 500_000 : 2_000_000)
        const defaultMaxTokens = entry?.maxTokens ?? contextWindow
        return {
          provider: provider ?? 'xai',
          id: model ?? 'grok-4.20-experimental-beta-0304-reasoning',
          context: { contextWindow },
          defaultMaxTokens,
          inputModalities: ['text'],
        }
      },
    },
  })

  const directDiag = diagnoseGrokContextBudget(ctx, {
    provider: 'xai',
    model: 'grok-4.20-experimental-beta-0304-reasoning',
  })
  assert.ok(directDiag, 'Expected diagnoseGrokContextBudget to return warning when maxTokens >= contextWindow')

  apply(ctx, Config({ responsesApiProviders: ['openai', 'xai', 'openrouter'] }))

  const badAgent = {
    options: { provider: 'xai', model: 'grok-4.20-experimental-beta-0304-reasoning' },
  }

  // Trigger agent/created twice with the same bad profile -> should warn only ONCE
  await ctx.emitEvent('agent/created', { agent: badAgent })
  await ctx.emitEvent('agent/created', { agent: badAgent })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(ctx.warnings.length, 1, `Expected deduplicated single warning, got ${JSON.stringify(ctx.warnings)}`)

  // Custom non-Grok model under xai profile MUST NOT emit any Grok budget warning
  await ctx.emitEvent('agent/created', { agent: { options: { provider: 'xai', model: 'gpt-test' } } })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(ctx.warnings.length, 1)

  // Clear diagnosis (user lowers maxTokens), re-check, then regress -> should warn a second time
  providers.xai = xaiProfileFixed
  await ctx.emitEvent('agent/created', { agent: badAgent })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(ctx.warnings.length, 1)

  providers.xai = xaiProfileBad
  await ctx.emitEvent('agent/created', { agent: badAgent })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(ctx.warnings.length, 2)

  // Qualified openrouter/x-ai/grok-4.7 resolved via ctx.llm.resolveModelInfo warns once
  await ctx.emitEvent('agent/created', { agent: { options: { provider: 'openrouter', model: 'x-ai/grok-4.7' } } })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(ctx.warnings.length, 3)
  assert.match(ctx.warnings[2], /openrouter\/x-ai\/grok-4\.7/u)
})

test('P2-D: Grok budget hook defers provisional warning until async resolveModelInfo settles, deduplicates in-flight lookups, and hostRecognizedGrokStream queries once', async () => {
  let infoCalls = 0
  let releaseInfo
  const gate = new Promise((resolve) => {
    releaseInfo = resolve
  })
  const providers = {
    xai: {
      apiKeyEnv: 'TEST_LCX_API_KEY',
      defaultContextWindow: 200_000,
      models: [{ id: 'grok-host-deferred', maxTokens: 500_000 }],
    },
  }
  const ctx = makeMockCtx({
    providers,
    llm: {
      listConfigurableProviders: () => [
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
      ],
      listModels: async () => [],
      fileRequestText: (ref) => `[file:${String(ref?.name ?? 'attachment')}]`,
      resolveModelInfo: async (_provider, model) => {
        infoCalls += 1
        await gate
        return {
          provider: 'xai',
          id: model ?? 'grok-host-deferred',
          context: { contextWindow: 2_000_000 },
          defaultMaxTokens: 500_000,
          inputModalities: ['text'],
        }
      },
    },
  })
  const handlers = new Map()
  const origOn = ctx.on.bind(ctx)
  ctx.on = (event, fn) => {
    handlers.set(event, fn)
    return origOn(event, fn)
  }
  apply(ctx, Config({ responsesApiProviders: ['xai'], grokNativeWebSearch: true }))

  const agent = { options: { provider: 'xai', model: 'grok-host-deferred' } }
  await ctx.emitEvent('agent/created', { agent })
  await ctx.emitEvent('agent/created', { agent })
  // Before resolveModelInfo resolves: no spurious provisional warning was emitted and only 1 lookup is in flight
  assert.equal(ctx.warnings.length, 0)
  assert.equal(infoCalls, 1)

  releaseInfo()
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(infoCalls, 1)
  assert.equal(ctx.warnings.length, 0)

  // Now verify hostRecognizedGrokStream executes resolveModelInfo at most ONCE for an uncatalogued Grok model
  let streamInfoCalls = 0
  const streamProviders = {
    xai: {
      apiKeyEnv: 'TEST_LCX_API_KEY',
    },
  }
  const streamCtx = makeMockCtx({
    providers: streamProviders,
    llm: {
      listConfigurableProviders: () => [
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
      ],
      listModels: async () => [],
      fileRequestText: (ref) => `[file:${String(ref?.name ?? 'attachment')}]`,
      resolveModelInfo: async (_provider, model) => {
        streamInfoCalls += 1
        return {
          provider: 'xai',
          id: model ?? 'grok-host-only-9',
          context: { contextWindow: 2_000_000 },
          defaultMaxTokens: 64_000,
          inputModalities: ['text'],
          systemPromptUpdate: 'in-history',
          toolUpdate: 'addition-only',
        }
      },
    },
  })
  const streamHandlers = new Map()
  const origStreamOn = streamCtx.on.bind(streamCtx)
  streamCtx.on = (event, fn) => {
    streamHandlers.set(event, fn)
    return origStreamOn(event, fn)
  }
  apply(streamCtx, Config({ responsesApiProviders: ['xai'], grokNativeWebSearch: true }))

  await withMockFetch(
    async () => sseCompletedResponse('resp_grok_host_once', 'ok', 'grok-host-only-9'),
    async (captured) => {
      const stream = streamHandlers.get('llm/stream')(
        {
          provider: 'xai',
          model: 'grok-host-only-9',
          sessionId: 'sess-grok-once',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'search once' }] }],
        },
        () => {
          throw new Error('DSH fallback must not run for recognized Grok route')
        },
      )
      for await (const _chunk of stream) {
        // exhaust
      }
      assert.equal(captured.length, 1)
      assert.equal(streamInfoCalls, 1, `Expected single resolveModelInfo call across host recognition + stream, got ${streamInfoCalls}`)
    },
  )
})

test('P2-5: request maxTokens override stays isolated from profile Grok budget warning cache and pending profile lookups', async () => {
  let releasePendingProfile
  const pendingGate = new Promise((resolve) => {
    releasePendingProfile = resolve
  })
  const providers = {
    xai: {
      baseURL: 'https://api.x.ai/v1',
      apiKeyEnv: 'TEST_LCX_API_KEY',
      models: [{ id: 'grok-4.7', contextWindow: 500_000, maxTokens: 500_000 }],
    },
  }
  const ctx = makeMockCtx({
    providers,
    llm: {
      listConfigurableProviders: () => [
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
      ],
      listModels: async () => [],
      fileRequestText: (ref) => `[file:${String(ref?.name ?? 'attachment')}]`,
      resolveModelInfo: async (_provider, model) => {
        await pendingGate
        return {
          provider: 'xai',
          id: model ?? 'grok-4.7',
          context: { contextWindow: 500_000 },
          defaultMaxTokens: 500_000,
          inputModalities: ['text'],
        }
      },
    },
  })
  const handlers = new Map()
  const origOn = ctx.on.bind(ctx)
  ctx.on = (event, fn) => {
    handlers.set(event, fn)
    return origOn(event, fn)
  }
  apply(ctx, Config({ responsesApiProviders: ['xai'], grokNativeWebSearch: true }))

  // 1) Start async profile lookup while gated, then trigger a safe request override (maxTokens: 64000) concurrently;
  //    the request override MUST NOT supersede the pending profile lookup.
  await ctx.emitEvent('agent/created', { agent: { options: { provider: 'xai', model: 'grok-4.7' } } })
  assert.equal(ctx.warnings.length, 0)

  // Override turn runs while profile lookup is pending (using non-grok-native path so it completes immediately via next)
  const overrideStream = handlers.get('llm/stream')(
    {
      provider: 'xai',
      model: 'grok-4.7',
      purpose: 'compaction',
      maxTokens: 64_000,
      sessionId: 'sess-override',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'compact' }] }],
    },
    async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  )
  for await (const _chunk of overrideStream) {
    // exhaust
  }
  assert.equal(ctx.warnings.length, 0)

  releasePendingProfile()
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(ctx.warnings.length, 1, 'Pending profile diagnosis must still emit once after request override')

  // 2) Safe managed Grok stream with maxTokens: 64000 MUST NOT erase the profile-level warning cache
  await withMockFetch(
    async () => sseCompletedResponse('resp_grok_override', 'ok', 'grok-4.7'),
    async () => {
      const safeStream = handlers.get('llm/stream')(
        {
          provider: 'xai',
          model: 'grok-4.7',
          maxTokens: 64_000,
          sessionId: 'sess-grok-safe-override',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'safe override' }] }],
        },
        () => {
          throw new Error('unexpected fallback')
        },
      )
      for await (const _chunk of safeStream) {
        // exhaust
      }
    },
  )
  await ctx.emitEvent('agent/created', { agent: { options: { provider: 'xai', model: 'grok-4.7' } } })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(ctx.warnings.length, 1, 'Safe request override must not cause profile fault warning to re-log')

  // 3) P2-4: Concurrent managed Grok stream with maxTokens override running WHILE profile lookup is STILL pending
  //    and observing a DIFFERENT host snapshot must NEVER cancel, supersede, or mutate profile pending/warning state.
  let releaseConcurrentProfile
  const concurrentGate = new Promise((resolve) => {
    releaseConcurrentProfile = resolve
  })
  let callIndex = 0
  const concurrentProviders = {
    xai: {
      baseURL: 'https://api.x.ai/v1',
      apiKeyEnv: 'TEST_LCX_API_KEY',
      models: [{ id: 'grok-concurrent-test', contextWindow: 500_000, maxTokens: 500_000 }],
    },
  }
  const concurrentCtx = makeMockCtx({
    providers: concurrentProviders,
    llm: {
      listConfigurableProviders: () => [
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
      ],
      listModels: async () => [],
      fileRequestText: (ref) => `[file:${String(ref?.name ?? 'attachment')}]`,
      resolveModelInfo: async (_provider, model) => {
        callIndex += 1
        if (callIndex === 1) {
          // Profile lookup remains pending and resolves to unsafe 500_000 / 500_000
          await concurrentGate
          return {
            provider: 'xai',
            id: model ?? 'grok-concurrent-test',
            context: { contextWindow: 500_000 },
            defaultMaxTokens: 500_000,
            inputModalities: ['text'],
          }
        }
        // Concurrent managed Grok request receives a differing host snapshot (larger contextWindow = 1_000_000)
        return {
          provider: 'xai',
          id: model ?? 'grok-concurrent-test',
          context: { contextWindow: 1_000_000 },
          defaultMaxTokens: 64_000,
          inputModalities: ['text'],
        }
      },
    },
  })
  const concurrentHandlers = new Map()
  const origConcurrentOn = concurrentCtx.on.bind(concurrentCtx)
  concurrentCtx.on = (event, fn) => {
    concurrentHandlers.set(event, fn)
    return origConcurrentOn(event, fn)
  }
  apply(concurrentCtx, Config({ responsesApiProviders: ['xai'], grokNativeWebSearch: true }))

  await concurrentCtx.emitEvent('agent/created', {
    agent: { options: { provider: 'xai', model: 'grok-concurrent-test' } },
  })
  assert.equal(concurrentCtx.warnings.length, 0)

  await withMockFetch(
    async () => sseCompletedResponse('resp_grok_concurrent_override', 'ok', 'grok-concurrent-test'),
    async () => {
      const managedOverrideStream = concurrentHandlers.get('llm/stream')(
        {
          provider: 'xai',
          model: 'grok-concurrent-test',
          maxTokens: 64_000,
          sessionId: 'sess-concurrent-override',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'run while profile lookup pending' }] }],
        },
        () => {
          throw new Error('unexpected fallback')
        },
      )
      for await (const _chunk of managedOverrideStream) {
        // exhaust
      }
    },
  )
  // Managed safe request override must NOT emit a warning nor suppress the still-pending profile warning
  assert.equal(concurrentCtx.warnings.length, 0)

  releaseConcurrentProfile()
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(concurrentCtx.warnings.length, 1, 'Pending profile diagnosis must still emit after concurrent managed Grok override completes')
  assert.match(concurrentCtx.warnings[0], /maxTokens \(500000\) >= contextWindow \(500000\)/u)

  // 4) Round 5 P2-7: 260+ distinct request overrides MUST NOT evict/clear profile generations or warning cache
  let releaseFloodProfile
  const floodGate = new Promise((resolve) => {
    releaseFloodProfile = resolve
  })
  const floodModels = [{ id: 'grok-target', contextWindow: 500_000, maxTokens: 500_000 }]
  for (let i = 0; i < 265; i += 1) {
    floodModels.push({ id: `grok-req-${i}`, contextWindow: 500_000, maxTokens: 500_000 })
  }
  const floodCtx = makeMockCtx({
    providers: {
      xai: { baseURL: 'https://api.x.ai/v1', apiKeyEnv: 'TEST_LCX_API_KEY', models: floodModels },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
      ],
      listModels: async () => [],
      fileRequestText: (ref) => `[file:${String(ref?.name ?? 'attachment')}]`,
      resolveModelInfo: async (_provider, model) => {
        if (model === 'grok-target') {
          await floodGate
          return { provider: 'xai', id: 'grok-target', context: { contextWindow: 500_000 }, defaultMaxTokens: 500_000, inputModalities: ['text'] }
        }
        return { provider: 'xai', id: model ?? 'grok-req', context: { contextWindow: 500_000 }, defaultMaxTokens: 64_000, inputModalities: ['text'] }
      },
    },
  })
  const floodHandlers = new Map()
  const origFloodOn = floodCtx.on.bind(floodCtx)
  floodCtx.on = (event, fn) => {
    floodHandlers.set(event, fn)
    return origFloodOn(event, fn)
  }
  apply(floodCtx, Config({ responsesApiProviders: ['xai'], grokNativeWebSearch: true }))

  await floodCtx.emitEvent('agent/created', { agent: { options: { provider: 'xai', model: 'grok-target' } } })
  assert.equal(floodCtx.warnings.length, 0)

  for (let i = 0; i < 265; i += 1) {
    const reqStream = floodHandlers.get('llm/stream')(
      {
        provider: 'xai',
        model: `grok-req-${i}`,
        purpose: 'compaction',
        maxTokens: 64_000,
        sessionId: `sess-flood-${i}`,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'compact' }] }],
      },
      async function* () {
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    )
    for await (const _chunk of reqStream) {
      // exhaust
    }
  }
  assert.equal(floodCtx.warnings.length, 0)

  releaseFloodProfile()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(floodCtx.warnings.length, 1, 'Pending profile generation must survive 265 request overrides')
  await floodCtx.emitEvent('agent/created', { agent: { options: { provider: 'xai', model: 'grok-target' } } })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(floodCtx.warnings.length, 1, 'Profile warning cache must stay deduplicated after 265 request overrides')

  // 5) Round 6 P2-6:
  //    (a) 270+ ordinary non-Grok GPT routes must return early without touching resolveModelInfo or Grok maps
  //    (b) 270+ distinct same-scope (`profile`) Grok routes forcing FIFO eviction MUST NOT evict pending target generation
  let releaseNonGrokGate
  const nonGrokGate = new Promise((resolve) => {
    releaseNonGrokGate = resolve
  })
  const nonGrokResolved = []
  const gptModels = []
  for (let i = 0; i < 270; i += 1) {
    gptModels.push({ id: `gpt-ordinary-${i}`, api: 'openai-responses', contextWindow: 128_000, maxTokens: 16_384 })
  }
  const nonGrokCtx = makeMockCtx({
    providers: {
      xai: {
        baseURL: 'https://api.x.ai/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        models: [{ id: 'grok-non-grok-target', contextWindow: 500_000, maxTokens: 500_000 }],
      },
      'openai-custom': {
        baseURL: 'https://custom-gpt.example/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        api: 'openai-responses',
        models: gptModels,
      },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
        { provider: 'openai-custom', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai-custom'] },
      ],
      listModels: async () => [],
      fileRequestText: (ref) => `[file:${String(ref?.name ?? 'attachment')}]`,
      resolveModelInfo: async (provider, model) => {
        if (provider !== 'xai') {
          nonGrokResolved.push(`${provider}/${model}`)
        }
        if (model === 'grok-non-grok-target') {
          await nonGrokGate
          return { provider: 'xai', id: 'grok-non-grok-target', context: { contextWindow: 500_000 }, defaultMaxTokens: 500_000, inputModalities: ['text'] }
        }
        return { provider, id: model ?? 'gpt-ordinary', context: { contextWindow: 128_000 }, defaultMaxTokens: 16_384, inputModalities: ['text'] }
      },
    },
  })
  const nonGrokHandlers = new Map()
  const origNonGrokOn = nonGrokCtx.on.bind(nonGrokCtx)
  nonGrokCtx.on = (event, fn) => {
    nonGrokHandlers.set(event, fn)
    return origNonGrokOn(event, fn)
  }
  apply(nonGrokCtx, Config({ enabled: true, responsesApiProviders: ['xai', 'openai-custom'], grokNativeWebSearch: true }))

  await nonGrokCtx.emitEvent('agent/created', { agent: { options: { provider: 'xai', model: 'grok-non-grok-target' } } })
  for (let i = 0; i < 270; i += 1) {
    await nonGrokCtx.emitEvent('agent/created', { agent: { options: { provider: 'openai-custom', model: `gpt-ordinary-${i}` } } })
  }
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(nonGrokResolved.length, 0, 'Ordinary non-Grok GPT agent/created must return before resolveModelInfo')
  for (let i = 0; i < 270; i += 1) {
    await withMockFetch(
      async () => sseCompletedResponse(`resp_nongrok_${i}`, 'ok', `gpt-ordinary-${i}`),
      async () => {
        const s = nonGrokHandlers.get('llm/stream')(
          {
            provider: 'openai-custom',
            model: `gpt-ordinary-${i}`,
            maxTokens: 16_384,
            sessionId: `sess-nongrok-${i}`,
            messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          },
          () => {
            throw new Error('unexpected fallback')
          },
        )
        for await (const _chunk of s) {
          // exhaust
        }
      },
    )
  }
  assert.equal(nonGrokResolved.length, 270, 'Managed non-Grok GPT streams must only pay 1 resolveRouteModelFacts lookup and zero Grok diagnostic lookups')
  assert.equal(nonGrokCtx.warnings.length, 0)
  releaseNonGrokGate()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(nonGrokCtx.warnings.length, 1)
  assert.match(nonGrokCtx.warnings[0], /grok-non-grok-target/u)

  // (b) Same-scope (`profile`) flood > 256 entries while grok-prof-target lookup is pending
  let releaseProfGate
  const profGate = new Promise((resolve) => {
    releaseProfGate = resolve
  })
  const profModels = [{ id: 'grok-prof-target', contextWindow: 500_000, maxTokens: 500_000 }]
  for (let i = 0; i < 270; i += 1) {
    profModels.push({ id: `grok-prof-flood-${i}`, contextWindow: 500_000, maxTokens: 64_000 })
  }
  const profCtx = makeMockCtx({
    providers: {
      xai: { baseURL: 'https://api.x.ai/v1', apiKeyEnv: 'TEST_LCX_API_KEY', models: profModels },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
      ],
      listModels: async () => [],
      fileRequestText: (ref) => `[file:${String(ref?.name ?? 'attachment')}]`,
      resolveModelInfo: async (_provider, model) => {
        if (model === 'grok-prof-target') {
          await profGate
          return { provider: 'xai', id: 'grok-prof-target', context: { contextWindow: 500_000 }, defaultMaxTokens: 500_000, inputModalities: ['text'] }
        }
        return { provider: 'xai', id: model ?? 'grok-prof-flood', context: { contextWindow: 500_000 }, defaultMaxTokens: 64_000, inputModalities: ['text'] }
      },
    },
  })
  apply(profCtx, Config({ responsesApiProviders: ['xai'], grokNativeWebSearch: true }))

  await profCtx.emitEvent('agent/created', { agent: { options: { provider: 'xai', model: 'grok-prof-target' } } })
  for (let i = 0; i < 270; i += 1) {
    await profCtx.emitEvent('agent/created', { agent: { options: { provider: 'xai', model: `grok-prof-flood-${i}` } } })
  }
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(profCtx.warnings.length, 0)

  releaseProfGate()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(profCtx.warnings.length, 1, 'Pending profile target must survive 270 same-scope Grok profile evictions')
  assert.match(profCtx.warnings[0], /grok-prof-target/u)
  await profCtx.emitEvent('agent/created', { agent: { options: { provider: 'xai', model: 'grok-prof-target' } } })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(profCtx.warnings.length, 1, 'Pending profile target warning cache must remain deduplicated after same-scope evictions')

  // (c) Round 7 P3-2: All-pending saturation at 4,097 concurrent lookups preserves earliest admitted pending entry/generation
  let releaseSatGate
  const satGate = new Promise((resolve) => {
    releaseSatGate = resolve
  })
  let satResolveCalls = 0
  const satModels = [{ id: 'grok-sat-0', contextWindow: 500_000, maxTokens: 500_000 }]
  for (let i = 1; i < 4097; i += 1) {
    satModels.push({ id: `grok-sat-${i}`, contextWindow: 500_000, maxTokens: 64_000 })
  }
  const satCtx = makeMockCtx({
    providers: {
      xai: { baseURL: 'https://api.x.ai/v1', apiKeyEnv: 'TEST_LCX_API_KEY', models: satModels },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
      ],
      listModels: async () => [],
      fileRequestText: (ref) => `[file:${String(ref?.name ?? 'attachment')}]`,
      resolveModelInfo: async (_provider, model) => {
        satResolveCalls += 1
        await satGate
        return {
          provider: 'xai',
          id: model ?? 'grok-sat-0',
          context: { contextWindow: 500_000 },
          defaultMaxTokens: model === 'grok-sat-0' ? 500_000 : 64_000,
          inputModalities: ['text'],
        }
      },
    },
  })
  apply(satCtx, Config({ responsesApiProviders: ['xai'], grokNativeWebSearch: true }))

  for (let i = 0; i < 4097; i += 1) {
    await satCtx.emitEvent('agent/created', { agent: { options: { provider: 'xai', model: `grok-sat-${i}` } } })
  }
  assert.equal(satResolveCalls, 4096, 'Pending Grok lookup admission must cap at 4,096 without evicting earliest admitted entries')
  assert.equal(satCtx.warnings.length, 0)

  releaseSatGate()
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(satCtx.warnings.length, 1, 'Earliest admitted pending Grok lookup must survive 4,097 saturation and emit its warning')
  assert.match(satCtx.warnings[0], /grok-sat-0/u)
  await satCtx.emitEvent('agent/created', { agent: { options: { provider: 'xai', model: 'grok-sat-0' } } })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(satCtx.warnings.length, 1, 'Earliest admitted pending warning cache must remain deduplicated after saturation')

  // (d) Round 8 P3-1: Same-route saturation when requestMaxTokens varies 4,097 times concurrently
  let releaseSameRouteGate
  let sameRouteGate = new Promise((resolve) => {
    releaseSameRouteGate = resolve
  })
  let sameRouteResolveCalls = 0
  const sameRouteCtx = makeMockCtx({
    providers: {
      xai: {
        baseURL: 'https://api.x.ai/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        models: [{ id: 'grok-same-route', contextWindow: 500_000, maxTokens: 64_000 }],
      },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
      ],
      listModels: async () => [],
      fileRequestText: (ref) => `[file:${String(ref?.name ?? 'attachment')}]`,
      resolveModelInfo: async (_provider, model) => {
        sameRouteResolveCalls += 1
        await sameRouteGate
        return {
          provider: 'xai',
          id: model ?? 'grok-same-route',
          context: { contextWindow: 500_000 },
          defaultMaxTokens: 64_000,
          inputModalities: ['text'],
        }
      },
    },
  })
  const sameRouteHandlers = new Map()
  const origSameRouteOn = sameRouteCtx.on.bind(sameRouteCtx)
  sameRouteCtx.on = (event, fn) => {
    sameRouteHandlers.set(event, fn)
    return origSameRouteOn(event, fn)
  }
  apply(sameRouteCtx, Config({ responsesApiProviders: ['xai'], grokNativeWebSearch: true }))

  for (let i = 0; i < 4097; i += 1) {
    const reqStream = sameRouteHandlers.get('llm/stream')(
      {
        provider: 'xai',
        model: 'grok-same-route',
        purpose: 'compaction',
        maxTokens: 500_000 + i,
        sessionId: 'sess-same-route',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'compact' }] }],
      },
      async function* () {
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    )
    for await (const _chunk of reqStream) {
      // exhaust
    }
  }
  assert.equal(sameRouteResolveCalls, 4096, 'Same-route active in-flight lookups must cap at 4,096 even when requestMaxTokens varies')
  assert.equal(sameRouteCtx.warnings.length, 0)

  releaseSameRouteGate()
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(sameRouteCtx.warnings.length, 1, 'Settling capped same-route lookups must emit the latest admitted warning once')
  assert.match(sameRouteCtx.warnings[0], /504095/u)

  // Verify in-flight counter returned cleanly to 0 so a subsequent distinct requestMaxTokens dispatches normally
  sameRouteGate = new Promise((resolve) => {
    releaseSameRouteGate = resolve
  })
  const postSettleStream = sameRouteHandlers.get('llm/stream')(
    {
      provider: 'xai',
      model: 'grok-same-route',
      purpose: 'compaction',
      maxTokens: 504_097,
      sessionId: 'sess-same-route',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'compact' }] }],
    },
    async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  )
  for await (const _chunk of postSettleStream) {
    // exhaust
  }
  assert.equal(sameRouteResolveCalls, 4097, 'In-flight counter must decrement cleanly after prior lookups settle')
  releaseSameRouteGate()
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(sameRouteCtx.warnings.length, 2)
})

test('Round 10 P2-4: managed GPT and Grok streams materialize DSH defaultMaxTokens and reasoning.defaultEffort in fallback OFF/ON and preserve explicit overrides & OAuth suppression', async () => {
  const makeDefaultCtx = (modelInfoOverride = {}, extra = {}) =>
    makeMockCtx({
      providers: {
        openai: {
          baseURL: 'https://api.openai.com/v1',
          apiKeyEnv: 'TEST_LCX_API_KEY',
        },
        xai: {
          baseURL: 'https://api.x.ai/v1',
          apiKeyEnv: 'TEST_LCX_API_KEY',
        },
      },
      llm: {
        listConfigurableProviders: () => [
          { provider: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
          { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
        ],
        fileRequestText: (ref) => `[file:${String(ref?.name ?? 'attachment')}]`,
        resolveModelInfo: async (provider, model) => ({
          provider: provider ?? 'openai',
          id: model ?? 'gpt-6.2-sol',
          model: model ?? 'gpt-6.2-sol',
          context: { contextWindow: 400_000 },
          contextWindow: 400_000,
          defaultMaxTokens: 1024,
          maxTokens: 1024,
          inputModalities: ['text', 'image'],
          reasoning: {
            efforts: ['low', 'medium', 'high'].map((id) => ({ id, label: id })),
            defaultEffort: 'high',
          },
          systemPromptUpdate: 'in-history',
          toolUpdate: 'addition-only',
          ...modelInfoOverride,
        }),
      },
      ...extra,
    })

  // 1) GPT fallback OFF: DSH defaultEffort='high' + defaultMaxTokens=1024
  const ctxOff = makeDefaultCtx()
  const gptOffRoute = routeWithPolicies(
    resolveResponsesRouteConfig(ctxOff, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
    { gatewayCompatibilityFallback: false },
  )
  await withMockFetch(
    async () => sseCompletedResponse('resp_def_off', 'ok', 'gpt-6.2-sol'),
    async (captured) => {
      const chunks = []
      for await (const chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-def-off',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello defaults' }] }],
        },
        gptOffRoute,
        ctxOff,
      )) {
        chunks.push(chunk)
      }
      assert.equal(captured.length, 1)
      const body = captured[0].body
      assert.equal(body.max_output_tokens, 1024)
      assert.equal(body.reasoning?.effort, 'medium')
      assert.deepEqual(body.input.at(-1), { type: 'configuration_update', reasoning: { effort: 'high' } })
      const finishChunk = chunks.find((c) => c.type === 'finish')
      assert.equal(finishChunk?.replayState?.response?.providerThinkingLevel, 'high')
    },
  )

  // 2) GPT fallback ON: omits configuration_update, sends reasoning.effort='high', max_output_tokens=1024, persists thinkingLevel='high'
  const gptOnRoute = routeWithPolicies(
    resolveResponsesRouteConfig(ctxOff, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
    { gatewayCompatibilityFallback: true },
  )
  await withMockFetch(
    async () => sseCompletedResponse('resp_def_on', 'ok', 'gpt-6.2-sol'),
    async (captured) => {
      const chunks = []
      for await (const chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-def-on',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello fallback defaults' }] }],
        },
        gptOnRoute,
        ctxOff,
      )) {
        chunks.push(chunk)
      }
      assert.equal(captured.length, 1)
      const body = captured[0].body
      assert.equal(body.max_output_tokens, 1024)
      assert.equal(body.reasoning?.effort, 'high')
      assert.equal(body.input.some((item) => item?.type === 'configuration_update'), false)
      const finishChunk = chunks.find((c) => c.type === 'finish')
      assert.equal(finishChunk?.replayState?.response?.providerThinkingLevel, 'high')
    },
  )

  // 3) Explicit caller overrides beat DSH defaults
  await withMockFetch(
    async () => sseCompletedResponse('resp_def_override', 'ok', 'gpt-6.2-sol'),
    async (captured) => {
      for await (const _chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-def-override',
          reasoningEffort: 'low',
          maxTokens: 2048,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'override defaults' }] }],
        },
        gptOffRoute,
        ctxOff,
      )) {
        // exhaust
      }
      assert.equal(captured.length, 1)
      assert.equal(captured[0].body.max_output_tokens, 2048)
      assert.deepEqual(captured[0].body.input.at(-1), { type: 'configuration_update', reasoning: { effort: 'low' } })
    },
  )

  // 4) ChatGPT Sign-In still suppresses max_output_tokens and configuration_update even when DSH supplies defaults
  const ctxOAuth = makeDefaultCtx({}, {
    credentials: { resolve: async () => ({ value: 'chatgpt-oauth-session-token' }) },
  })
  const gptOAuthRoute = routeWithPolicies(
    resolveResponsesRouteConfig(ctxOAuth, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
    { gatewayCompatibilityFallback: false },
  )
  await withMockFetch(
    async () => sseCompletedResponse('resp_def_oauth', 'ok', 'gpt-6.2-sol'),
    async (captured) => {
      for await (const _chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-def-oauth',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'oauth defaults' }] }],
        },
        gptOAuthRoute,
        ctxOAuth,
      )) {
        // exhaust
      }
      assert.equal(captured.length, 1)
      assert.equal('max_output_tokens' in captured[0].body, false)
      assert.equal(captured[0].body.input.some((item) => item?.type === 'configuration_update'), false)
      assert.equal(captured[0].body.reasoning?.effort, 'high')
    },
  )

  // 5) Invalid DSH defaultEffort yields managed UNSUPPORTED_OPTION error chunk without issuing fetch
  const ctxBadEffort = makeDefaultCtx({
    reasoning: {
      efforts: [{ id: 'low', label: 'low' }, { id: 'medium', label: 'medium' }],
      defaultEffort: 'bogus',
    },
  })
  await withMockFetch(
    async () => { throw new Error('fetch must not be called when defaultEffort is unsupported') },
    async (captured) => {
      const badGptChunks = []
      for await (const chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-def-invalid',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'invalid default effort' }] }],
        },
        gptOffRoute,
        ctxBadEffort,
      )) {
        badGptChunks.push(chunk)
      }
      assert.equal(captured.length, 0)
      const gptErr = badGptChunks.find((c) => c.type === 'finish')
      assert.equal(gptErr?.reason?.kind, 'error')
      assert.equal(gptErr?.reason?.failure?.code, 'UNSUPPORTED_OPTION')
      assert.equal(gptErr?.reason?.failure?.message, 'LCX Responses does not support this request option')
    },
  )

  // 6) Grok native search stream materializes DSH defaultEffort='high' + defaultMaxTokens=1024, honors overrides, and rejects invalid defaultEffort
  const grokRoute = routeWithPolicies(
    resolveGrokResponsesRouteConfig(ctxOff, { provider: 'xai', model: 'grok-4.7' }, {}),
    {},
  )
  await withMockFetch(
    async () => sseCompletedResponse('resp_grok_def', 'ok', 'grok-4.7'),
    async (captured) => {
      for await (const _chunk of managedGrokNativeSearchStream(
        {
          provider: 'xai',
          model: 'grok-4.7',
          sessionId: 'sess-grok-def',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'grok defaults' }] }],
        },
        grokRoute,
        { web: true, x: false },
        ctxOff,
      )) {
        // exhaust
      }
      assert.equal(captured.length, 1)
      assert.equal(captured[0].body.max_output_tokens, 1024)
      assert.equal(captured[0].body.reasoning?.effort, 'high')

      for await (const _chunk of managedGrokNativeSearchStream(
        {
          provider: 'xai',
          model: 'grok-4.7',
          sessionId: 'sess-grok-override',
          reasoningEffort: 'low',
          maxTokens: 2048,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'grok override' }] }],
        },
        grokRoute,
        { web: true, x: false },
        ctxOff,
      )) {
        // exhaust
      }
      assert.equal(captured.length, 2)
      assert.equal(captured[1].body.max_output_tokens, 2048)
      assert.equal(captured[1].body.reasoning?.effort, 'low')
    },
  )
  await withMockFetch(
    async () => { throw new Error('fetch must not be called for invalid Grok defaultEffort') },
    async (captured) => {
      const badGrokChunks = []
      for await (const chunk of managedGrokNativeSearchStream(
        {
          provider: 'xai',
          model: 'grok-4.7',
          sessionId: 'sess-grok-bad-effort',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'bad grok default effort' }] }],
        },
        grokRoute,
        { web: true, x: false },
        ctxBadEffort,
      )) {
        badGrokChunks.push(chunk)
      }
      assert.equal(captured.length, 0)
      const grokErr = badGrokChunks.find((c) => c.type === 'finish')
      assert.equal(grokErr?.reason?.kind, 'error')
      assert.equal(grokErr?.reason?.failure?.code, 'UNSUPPORTED_OPTION')
      assert.equal(grokErr?.reason?.failure?.message, 'LCX Responses does not support this request option')
    },
  )
})

test('Round 11 P2-1 & P2-2: model.maxTokens fallback + clampMaxTokensToContext, GPT profileReasoning, Grok DSH matrix, and compaction reasoning validation', async () => {
  const ctxNoDefaultMax = makeMockCtx({
    providers: {
      openai: {
        baseURL: 'https://api.openai.com/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
      },
      xai: {
        baseURL: 'https://api.x.ai/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
      },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
      ],
      fileRequestText: (ref) => `[file:${String(ref?.name ?? 'attachment')}]`,
      resolveModelInfo: async (provider, model) => ({
        provider: provider ?? 'openai',
        id: model ?? 'gpt-6.2-sol',
        model: model ?? 'gpt-6.2-sol',
        context: { contextWindow: provider === 'xai' ? 500_000 : 272_000 },
        contextWindow: provider === 'xai' ? 500_000 : 272_000,
        inputModalities: ['text', 'image'],
        reasoning: {
          efforts: ['low', 'medium', 'high'].map((id) => ({ id, label: id })),
        },
        systemPromptUpdate: 'in-history',
        toolUpdate: 'addition-only',
      }),
    },
  })

  // 1) P2-1 GPT fallback to model.maxTokens (128000) when defaultMaxTokens omitted, and clamps near full context
  const gptRoute = routeWithPolicies(
    resolveResponsesRouteConfig(ctxNoDefaultMax, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
    { gatewayCompatibilityFallback: false },
  )
  await withMockFetch(
    async () => sseCompletedResponse('resp_p21_gpt', 'ok', 'gpt-6.2-sol'),
    async (captured) => {
      for await (const _chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-p21-short',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'short' }] }],
        },
        gptRoute,
        ctxNoDefaultMax,
      )) {
        // exhaust
      }
      assert.equal(captured[0].body.max_output_tokens, 128_000)

      // Near-full context (~260k tokens = ~910k chars) clamps max_output_tokens well below 128000
      for await (const _chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-p21-clamp',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(910_000) }] }],
        },
        gptRoute,
        ctxNoDefaultMax,
      )) {
        // exhaust
      }
      assert.equal(captured.length, 2)
      assert.ok(captured[1].body.max_output_tokens < 128_000, `expected clamped max_output_tokens < 128000, got ${captured[1].body.max_output_tokens}`)
      assert.ok(captured[1].body.max_output_tokens >= 16)
    },
  )

  // 2) P2-1 Grok fallback to catalog model.maxTokens (500000) + context clamping while pre-flight budget diagnostic stays intact
  const grokRoute = routeWithPolicies(
    resolveGrokResponsesRouteConfig(ctxNoDefaultMax, { provider: 'xai', model: 'grok-4.7' }, {}),
    {},
  )
  await withMockFetch(
    async () => sseCompletedResponse('resp_p21_grok', 'ok', 'grok-4.7'),
    async (captured) => {
      for await (const _chunk of managedGrokNativeSearchStream(
        {
          provider: 'xai',
          model: 'grok-4.7',
          sessionId: 'sess-p21-grok',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(700_000) }] }],
        },
        grokRoute,
        { web: true, x: false },
        ctxNoDefaultMax,
      )) {
        // exhaust
      }
      assert.equal(captured.length, 1)
      assert.ok(captured[0].body.max_output_tokens < 500_000)
      assert.ok(captured[0].body.max_output_tokens >= 16)
    },
  )
  // Unclamped Grok budget diagnostic still warns when profile/request maxTokens >= contextWindow
  const ctxBudget = makeMockCtx({
    providers: {
      xai: {
        baseURL: 'https://api.x.ai/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        models: [{ id: 'grok-4.7', maxTokens: 500_000 }],
      },
    },
  })
  const grokDiag = diagnoseGrokContextBudget(ctxBudget, { provider: 'xai', model: 'grok-4.7' })
  assert.match(grokDiag ?? '', /maxTokens \(500000\) >= contextWindow/u)

  // 3) P2-2 GPT profileReasoning='off' on gpt-6.2-sol (lacking 'off' in DSH efforts) fails BEFORE fetch
  const ctxOffProfile = makeMockCtx({
    providers: {
      openai: {
        baseURL: 'https://api.openai.com/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        reasoning: 'off',
      },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
      ],
      fileRequestText: () => '[file]',
      resolveModelInfo: async () => ({
        provider: 'openai',
        id: 'gpt-6.2-sol',
        model: 'gpt-6.2-sol',
        context: { contextWindow: 272_000 },
        inputModalities: ['text'],
        reasoning: {
          efforts: ['low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({ id, label: id })),
        },
        systemPromptUpdate: 'in-history',
        toolUpdate: 'addition-only',
      }),
    },
  })
  const offProfileGptRoute = routeWithPolicies(
    resolveResponsesRouteConfig(ctxOffProfile, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
    { gatewayCompatibilityFallback: false },
  )
  assert.equal(offProfileGptRoute.profileReasoning, 'off')
  await withMockFetch(
    async () => { throw new Error('fetch must not run when profileReasoning="off" is unsupported by DSH efforts') },
    async (captured) => {
      const chunks = []
      for await (const chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-p22-off-profile',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        },
        offProfileGptRoute,
        ctxOffProfile,
      )) {
        chunks.push(chunk)
      }
      assert.equal(captured.length, 0)
      assert.equal(chunks.at(-1)?.reason?.failure?.code, 'UNSUPPORTED_OPTION')
    },
  )

  // 4) P2-2 Grok: omitOff does NOT bypass DSH efforts when DSH omits 'off'; non-reasoning DSH allows only 'off'
  const ctxGrokRestrictive = makeMockCtx({
    providers: {
      xai: {
        baseURL: 'https://api.x.ai/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        models: [{ id: 'grok-4.7', reasoningEfforts: { off: null, high: 'high' } }],
      },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
      ],
      fileRequestText: () => '[file]',
      resolveModelInfo: async () => ({
        provider: 'xai',
        id: 'grok-4.7',
        model: 'grok-4.7',
        context: { contextWindow: 500_000 },
        inputModalities: ['text'],
        reasoning: { efforts: [{ id: 'high', label: 'high' }] },
      }),
    },
  })
  const grokRestrictRoute = routeWithPolicies(
    resolveGrokResponsesRouteConfig(ctxGrokRestrictive, { provider: 'xai', model: 'grok-4.7' }, {}),
    {},
  )
  await withMockFetch(
    async () => { throw new Error('fetch must not run when DSH efforts forbid off even with offOmitsReasoning') },
    async (captured) => {
      const chunks = []
      for await (const chunk of managedGrokNativeSearchStream(
        {
          provider: 'xai',
          model: 'grok-4.7',
          sessionId: 'sess-p22-grok-no-off',
          reasoningEffort: 'off',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }],
        },
        grokRestrictRoute,
        { web: true, x: false },
        ctxGrokRestrictive,
      )) {
        chunks.push(chunk)
      }
      assert.equal(captured.length, 0)
      assert.equal(chunks.at(-1)?.reason?.failure?.code, 'UNSUPPORTED_OPTION')
    },
  )

  const ctxGrokNonReasoning = makeMockCtx({
    providers: {
      xai: {
        baseURL: 'https://api.x.ai/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        models: [{ id: 'grok-4.7', reasoningEfforts: { off: null, high: 'high' } }],
      },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
      ],
      fileRequestText: () => '[file]',
      resolveModelInfo: async () => ({
        provider: 'xai',
        id: 'grok-4.7',
        model: 'grok-4.7',
        context: { contextWindow: 500_000 },
        inputModalities: ['text'],
      }),
    },
  })
  const grokNonReasonRoute = routeWithPolicies(
    resolveGrokResponsesRouteConfig(ctxGrokNonReasoning, { provider: 'xai', model: 'grok-4.7' }, {}),
    {},
  )
  await withMockFetch(
    async () => sseCompletedResponse('resp_grok_nr', 'ok', 'grok-4.7'),
    async (captured) => {
      // 'high' rejected when DSH reasoning === undefined; 'off' accepted
      const badChunks = []
      for await (const chunk of managedGrokNativeSearchStream(
        {
          provider: 'xai',
          model: 'grok-4.7',
          sessionId: 'sess-p22-grok-nr-high',
          reasoningEffort: 'high',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }],
        },
        grokNonReasonRoute,
        { web: true, x: false },
        ctxGrokNonReasoning,
      )) {
        badChunks.push(chunk)
      }
      assert.equal(captured.length, 0)
      assert.equal(badChunks.at(-1)?.reason?.failure?.code, 'UNSUPPORTED_OPTION')

      const okChunks = []
      for await (const chunk of managedGrokNativeSearchStream(
        {
          provider: 'xai',
          model: 'grok-4.7',
          sessionId: 'sess-p22-grok-nr-off',
          reasoningEffort: 'off',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }],
        },
        grokNonReasonRoute,
        { web: true, x: false },
        ctxGrokNonReasoning,
      )) {
        okChunks.push(chunk)
      }
      assert.equal(captured.length, 1)
      assert.equal(okChunks.at(-1)?.reason?.kind, 'stop')
    },
  )

  // 5) P2-2 remoteCompactionStream also validates effective reasoning effort against DSH efforts
  const compactSession = Session.create(SessionId('sess-p22-compact'))
  compactSession.append('request/header', {
    header: { config: { provider: 'openai', model: 'gpt-6.2-sol', reasoningEffort: 'off' } },
    reason: 'initial',
  })
  const ctxCompactOff = makeMockCtx({
    providers: {
      openai: {
        baseURL: 'https://api.openai.com/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
      },
    },
    sessions: { get: (id) => (id === 'sess-p22-compact' ? compactSession : undefined) },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
      ],
      fileRequestText: () => '[file]',
      resolveModelInfo: async () => ({
        provider: 'openai',
        id: 'gpt-6.2-sol',
        model: 'gpt-6.2-sol',
        context: { contextWindow: 272_000 },
        inputModalities: ['text'],
        reasoning: { efforts: [{ id: 'low', label: 'low' }, { id: 'high', label: 'high' }] },
        systemPromptUpdate: 'in-history',
        toolUpdate: 'addition-only',
      }),
    },
  })
  const compactRoute = routeWithPolicies(
    resolveResponsesRouteConfig(ctxCompactOff, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
    { gatewayCompatibilityFallback: false },
  )
  await withMockFetch(
    async () => { throw new Error('fetch must not run when compaction session reasoningEffort is unsupported') },
    async (captured) => {
      await assert.rejects(
        async () => {
          for await (const _chunk of remoteCompactionStream(
            {
              provider: 'openai',
              model: 'gpt-6.2-sol',
              purpose: 'compaction',
              sessionId: 'sess-p22-compact',
              messages: [{ role: 'user', content: [{ type: 'text', text: 'compact' }] }],
            },
            compactRoute,
            ctxCompactOff,
            () => { throw new Error('fallback must not run') },
          )) {
            // unreachable
          }
        },
        (err) => err?.code === 'LCX_RESPONSES_UNSUPPORTED_OPTION',
      )
      assert.equal(captured.length, 0)
    },
  )
})

test('Round 12 P2-1, P2-2 & P2-3: marker-free PiContext parity with streamSimple (ordinary, native, Grok native, portable), descriptor reasoning matrix, and compaction option inheritance', async () => {
  // 1) P2-1 Ordinary call parity with host Models.streamSimple: normalizeContext includes systemPrompt + tools before clamping
  const smallWindowCtx = makeMockCtx({
    providers: {
      openai: {
        baseURL: 'https://api.openai.com/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
      },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
      ],
      fileRequestText: () => '[file]',
      resolveModelInfo: async (provider, model) => ({
        provider: provider ?? 'openai',
        id: model ?? 'gpt-6.2-sol',
        model: model ?? 'gpt-6.2-sol',
        context: { contextWindow: 8192 },
        contextWindow: 8192,
        inputModalities: ['text'],
        reasoning: { efforts: ['low', 'medium', 'high'].map((id) => ({ id, label: id })) },
        systemPromptUpdate: 'in-history',
        toolUpdate: 'addition-only',
      }),
    },
  })
  const smallWindowRoute = routeWithPolicies(
    resolveResponsesRouteConfig(smallWindowCtx, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
    { gatewayCompatibilityFallback: false },
  )
  const longSystem = 'S'.repeat(7000)
  const probeTool = makeTool('probe_tool')
  const basePiModel = makePiSolModel('gpt-6.2-sol')
  const piBudgetModel = { ...basePiModel, contextWindow: 8192, maxTokens: 16384 }
  const normalizedBudgetContext = normalizeContext({
    systemPrompt: longSystem,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 0 }],
    tools: [probeTool],
  })

  let piStreamMaxOutput
  await withMockFetch(
    async () => sseCompletedResponse('resp_pi_parity', 'ok', 'gpt-6.2-sol'),
    async (captured) => {
      const piStream = piStreamSimple(
        piBudgetModel,
        normalizedBudgetContext,
        { apiKey: 'sk-test-token', maxTokens: 16384 },
      )
      for await (const _ev of piStream) {
        // exhaust
      }
      piStreamMaxOutput = captured[0].body.max_output_tokens

      for await (const _chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-p21-ordinary',
          system: longSystem,
          tools: [probeTool],
          maxTokens: 16384,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        },
        smallWindowRoute,
        smallWindowCtx,
      )) {
        // exhaust
      }
      assert.equal(piStreamMaxOutput, clampMaxTokensToContext(piBudgetModel, normalizedBudgetContext, 16384))
      assert.ok(piStreamMaxOutput < 4095, `Expected normalized context to count systemPrompt + tools, got ${piStreamMaxOutput}`)
      assert.equal(captured[1].body.max_output_tokens, piStreamMaxOutput)
    },
  )

  // Marker-free serialized.piContext on in-history prompt snapshots & developer tool updates
  const markerCheck = await serializeDshMessages(
    [
      { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] },
      { id: 's2', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'Updated prompt' }] },
      { id: 'dev1', role: 'developer', source: { kind: 'tool' }, content: [{ type: 'tool-addition', toolName: 'probe_tool' }] },
    ],
    smallWindowCtx,
    {
      route: { provider: 'openai', model: 'gpt-6.2-sol' },
      model: piBudgetModel,
      systemPrompt: longSystem,
      tools: [probeTool],
      systemPromptUpdate: 'in-history',
      toolUpdate: 'addition-only',
    },
  )
  assert.equal(markerCheck.piContext.systemPrompt, longSystem)
  assert.equal(markerCheck.piContext.tools.length, 1)
  const serializedContextJson = JSON.stringify(markerCheck.piContext)
  assert.equal(serializedContextJson.includes('lcx-prompt-snapshot:'), false)
  assert.equal(serializedContextJson.includes('lcx-tool-update:'), false)
  assert.equal(markerCheck.piContext.messages[0].role, 'user')

  // 2) P2-1 Native replay & Portable replay budget contexts
  const ckptSession = Session.create(SessionId('sess-p21-ckpt'))
  ckptSession.append(
    'system/message',
    {
      message: {
        role: 'system',
        source: { kind: 'system-prompt' },
        content: [{ type: 'text', text: '' }],
        id: 's-head',
      },
      reason: 'initial',
    },
    { surfaceOp: 'append' },
  )
  const shadowedUser1 = ckptSession.append(
    'user/message',
    {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'P'.repeat(4200) }],
      id: 'u-shadowed-1',
    },
    { surfaceOp: 'append' },
  )
  const shadowedSysMid = ckptSession.append(
    'system/message',
    {
      message: {
        role: 'system',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Q'.repeat(4200) }],
        id: 's-shadowed-mid',
      },
      reason: 'update',
    },
    { surfaceOp: 'append' },
  )
  ckptSession.append('compaction/start', { compactionId: 'cmp-p21', turn: null })
  const ckptCtx = makeMockCtx({
    providers: smallWindowCtx.settings.describe()[0].value.providers,
    sessions: { get: (id) => (id === 'sess-p21-ckpt' ? ckptSession : undefined) },
    sessionQuery: {
      observeSession: async () => ({ events: ckptSession.snapshotEvents(), [Symbol.dispose]() {} }),
    },
    llm: smallWindowCtx.llm,
  })
  const ckptAuthority = await resolveRouteHeaderAuthorityFingerprint(
    ckptCtx,
    { provider: 'openai', model: 'gpt-6.2-sol', baseURL: 'https://api.openai.com/v1', sessionId: 'sess-p21-ckpt' },
    smallWindowRoute,
  )
  const ckptBlock = {
    type: 'lcx-native-compaction-v5',
    version: 5,
    compactionId: 'cmp-p21',
    provider: 'openai',
    model: 'gpt-6.2-sol',
    baseURLFingerprint: baseURLFingerprint('https://api.openai.com/v1'),
    sourceSessionId: 'sess-p21-ckpt',
    headerAuthorityFingerprint: ckptAuthority,
    nativeOutput: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'N'.repeat(10500) }] },
      { type: 'compaction', encrypted_content: 'opaque-p21' },
    ],
    nativeCompaction: { type: 'compaction', encrypted_content: 'opaque-p21' },
  }
  ckptSession.append('compaction/summary', {
    compactionId: 'cmp-p21',
    summary: [{ type: 'text', text: 'summary' }],
    rawOutput: [{ type: 'text', text: 'summary' }, ckptBlock],
    shadowedRange: { start: shadowedUser1.seq, end: shadowedSysMid.seq },
    shadowedSeqs: [shadowedUser1.seq, shadowedSysMid.seq],
    shadowedTokenCount: 2400,
    provider: 'openai',
    model: 'gpt-6.2-sol',
  })
  ckptSession.append(
    'user/message',
    {
      role: 'user',
      source: { kind: 'compact-checkpoint', compactionId: 'cmp-p21' },
      content: [{ type: 'text', text: 'summary' }],
      id: 'u-ckpt',
    },
    {
      sourceEventSeqs: [shadowedUser1.seq, shadowedSysMid.seq],
      surfaceOp: { op: 'replace', startSeq: shadowedUser1.seq, endSeq: shadowedSysMid.seq },
    },
  )
  ckptSession.append('compaction/end', { compactionId: 'cmp-p21', turn: null })

  const surfaceWithCkpt = [
    ...ckptSession.deriveMessages(),
    { id: 'u-after', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] },
  ]
  const nativePrepared = await serializeNativeAware(
    surfaceWithCkpt,
    { provider: 'openai', model: 'gpt-6.2-sol', baseURL: 'https://api.openai.com/v1', sessionId: 'sess-p21-ckpt' },
    smallWindowRoute,
    ckptCtx,
    {},
  )
  // 10500 chars => 3000 tokens + 'next' (2 tokens) = 3002; 8192 - 3002 - 4096 = 1094
  const nativeClamped = clampMaxTokensToContext(
    { ...basePiModel, contextWindow: 8192, maxTokens: 16384 },
    nativePrepared.piContext,
    16384,
  )
  assert.equal(nativeClamped, 1094)

  const portableRoute = routeWithPolicies(
    resolveResponsesRouteConfig(ckptCtx, { provider: 'openai', model: 'gpt-6-sol' }, {}),
    { gatewayCompatibilityFallback: false },
  )
  const portablePrepared = await serializeNativeAware(
    surfaceWithCkpt,
    { provider: 'openai', model: 'gpt-6-sol', baseURL: 'https://api.openai.com/v1', sessionId: 'sess-p21-ckpt' },
    portableRoute,
    ckptCtx,
    {},
  )
  // 4200 user (1200) + wrapped <system-reminder> 4236 chars (1211) + 'next' (2) = 2413; 8192 - 2413 - 4096 = 1683
  const portableClamped = clampMaxTokensToContext(
    { ...makePiSolModel('gpt-6-sol'), contextWindow: 8192, maxTokens: 16384 },
    portablePrepared.piContext,
    16384,
  )
  assert.equal(portableClamped, 1683)

  // 3) P2-1 Grok native replay accounts for restored wire items (encrypted reasoning / web_search_call)
  const grokReplayCtx = makeMockCtx({
    providers: {
      xai: { baseURL: 'https://api.x.ai/v1', apiKeyEnv: 'TEST_LCX_API_KEY' },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
      ],
      fileRequestText: () => '[file]',
      resolveModelInfo: async () => ({
        provider: 'xai',
        id: 'grok-4.7',
        model: 'grok-4.7',
        context: { contextWindow: 12000 },
        contextWindow: 12000,
        inputModalities: ['text'],
        reasoning: { efforts: [{ id: 'low', label: 'low' }, { id: 'high', label: 'high' }] },
        systemPromptUpdate: 'in-history',
        toolUpdate: 'addition-only',
      }),
    },
  })
  const grokReplayRoute = routeWithPolicies(
    resolveGrokResponsesRouteConfig(grokReplayCtx, { provider: 'xai', model: 'grok-4.7' }, {}),
    {},
  )
  await withMockFetch(
    async (_url, _init, body) => {
      if (body.input.length === 1) {
        const ev = {
          type: 'response.completed',
          response: {
            id: 'resp_grok_turn1',
            object: 'response',
            model: 'grok-4.7',
            status: 'completed',
            output: [
              { type: 'web_search_call', id: 'ws_p21', status: 'completed', action: { type: 'search', query: 'R'.repeat(14000) } },
              { type: 'message', id: 'msg_p21', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] },
            ],
          },
        }
        return new Response(`event: response.completed\ndata: ${JSON.stringify(ev)}\n\n`, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      return sseCompletedResponse('resp_grok_replay', 'done', 'grok-4.7')
    },
    async (captured) => {
      const turn1Chunks = []
      for await (const chunk of managedGrokNativeSearchStream(
        {
          provider: 'xai',
          model: 'grok-4.7',
          sessionId: 'sess-p21-grok-replay',
          maxTokens: 10000,
          messages: [{ id: 'u_grok_1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'search' }] }],
        },
        grokReplayRoute,
        { web: true, x: false },
        grokReplayCtx,
      )) {
        turn1Chunks.push(chunk)
      }
      const turn1Finish = turn1Chunks.find((c) => c.type === 'finish')
      assert.ok(turn1Finish?.replayState?.grokNative)

      for await (const _chunk of managedGrokNativeSearchStream(
        {
          provider: 'xai',
          model: 'grok-4.7',
          sessionId: 'sess-p21-grok-replay',
          maxTokens: 10000,
          messages: [
            { id: 'u_grok_1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'search' }] },
            {
              id: 'asst_grok_1',
              role: 'assistant',
              source: {
                kind: 'model',
                provider: 'xai',
                model: 'grok-4.7',
                replayState: turn1Finish.replayState,
              },
              content: [{ type: 'text', text: 'ok' }],
            },
            { id: 'u_grok_2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'follow up' }] },
          ],
        },
        grokReplayRoute,
        { web: true, x: false },
        grokReplayCtx,
      )) {
        // exhaust
      }
      assert.equal(captured.length, 2)
      assert.ok(captured[1].body.input.some((item) => item?.type === 'web_search_call'))
      // Visible text alone would leave 12000 - ~5 - 4096 = ~7899; restored 14k web_search_call consumes ~4000+ tokens -> < 4500
      assert.ok(
        captured[1].body.max_output_tokens < 4500,
        `expected Grok native replay wire items to tighten max_output_tokens < 4500, got ${captured[1].body.max_output_tokens}`,
      )
    },
  )

  // 4) P2-2 Descriptor-aware validator rejects gpt-6.2-sol 'off' across fallback OFF/ON, unresolved facts, DSH mock claiming 'off', and compaction
  for (const [label, resolveInfoImpl] of [
    ['DSH claims off allowed', async () => ({
      provider: 'openai',
      id: 'gpt-6.2-sol',
      model: 'gpt-6.2-sol',
      context: { contextWindow: 272_000 },
      inputModalities: ['text'],
      reasoning: { efforts: [{ id: 'off', label: 'off' }, { id: 'low', label: 'low' }] },
      systemPromptUpdate: 'in-history',
      toolUpdate: 'addition-only',
    })],
    ['DSH facts unresolved', async () => undefined],
  ]) {
    const offCtx = makeMockCtx({
      providers: {
        openai: { baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'TEST_LCX_API_KEY' },
      },
      llm: {
        listConfigurableProviders: () => [
          { provider: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
        ],
        fileRequestText: () => '[file]',
        resolveModelInfo: resolveInfoImpl,
      },
    })
    for (const fallback of [false, true]) {
      const offRoute = routeWithPolicies(
        resolveResponsesRouteConfig(offCtx, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
        { gatewayCompatibilityFallback: fallback },
      )
      await withMockFetch(
        async () => { throw new Error(`fetch must not run for gpt-6.2-sol off (${label}, fallback=${fallback})`) },
        async (captured) => {
          const chunks = []
          for await (const chunk of managedResponsesStream(
            {
              provider: 'openai',
              model: 'gpt-6.2-sol',
              sessionId: `sess-p22-off-${fallback}`,
              reasoningEffort: 'off',
              messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
            },
            offRoute,
            offCtx,
          )) {
            chunks.push(chunk)
          }
          assert.equal(captured.length, 0)
          assert.equal(chunks.at(-1)?.reason?.failure?.code, 'UNSUPPORTED_OPTION', `expected UNSUPPORTED_OPTION for ${label}, fallback=${fallback}`)
        },
      )
    }

    await assert.rejects(
      async () => {
        for await (const _chunk of remoteCompactionStream(
          {
            provider: 'openai',
            model: 'gpt-6.2-sol',
            purpose: 'compaction',
            sessionId: 'sess-p22-compact-off',
            reasoningEffort: 'off',
            messages: [{ role: 'user', content: [{ type: 'text', text: 'compact' }] }],
          },
          routeWithPolicies(
            resolveResponsesRouteConfig(offCtx, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
            { gatewayCompatibilityFallback: false },
          ),
          offCtx,
          () => { throw new Error('fallback must not run') },
        )) {
          // unreachable
        }
      },
      (err) => err?.code === 'LCX_RESPONSES_UNSUPPORTED_OPTION',
    )
  }

  // Custom profile with declared off: null (offOmitsReasoning === true) STILL allows 'off' when DSH allows it
  const omitOffCtx = makeMockCtx({
    providers: {
      relay: {
        api: 'openai-responses',
        baseURL: 'https://relay.example/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        models: [{ id: 'grok-custom-omit', reasoningEfforts: { off: null, high: 'relay-high' } }],
      },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'relay', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'relay'] },
      ],
      fileRequestText: () => '[file]',
      resolveModelInfo: async () => ({
        provider: 'relay',
        id: 'grok-custom-omit',
        model: 'grok-custom-omit',
        context: { contextWindow: 128_000 },
        inputModalities: ['text'],
        reasoning: { efforts: [{ id: 'off', label: 'off' }, { id: 'high', label: 'high' }] },
        systemPromptUpdate: 'in-history',
        toolUpdate: 'addition-only',
      }),
    },
  })
  const omitOffRoute = routeWithPolicies(
    resolveGrokResponsesRouteConfig(omitOffCtx, { provider: 'relay', model: 'grok-custom-omit' }, {}),
    {},
  )
  await withMockFetch(
    async () => sseCompletedResponse('resp_omit_off', 'ok', 'grok-custom-omit'),
    async (captured) => {
      for await (const _chunk of managedGrokNativeSearchStream(
        {
          provider: 'relay',
          model: 'grok-custom-omit',
          sessionId: 'sess-omit-off',
          reasoningEffort: 'off',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        },
        omitOffRoute,
        { web: true, x: false },
        omitOffCtx,
      )) {
        // exhaust
      }
      assert.equal(captured.length, 1)
      assert.equal(captured[0].body.reasoning, undefined)
    },
  )

  // 5) P2-3 remoteCompactionStream inherits caller options > session header > profile/DSH defaults and clamps maxTokens
  const p23Session = Session.create(SessionId('sess-p23-compact'))
  p23Session.append('request/header', {
    header: { config: { provider: 'openai', model: 'gpt-6.2-sol', reasoningEffort: 'low', temperature: 0.4, maxTokens: 4096 } },
    reason: 'initial',
  })
  p23Session.append('compaction/start', { compactionId: 'cmp-p23-1', turn: null })
  const p23NoHeaderSession = Session.create(SessionId('sess-p23-no-header'))
  p23NoHeaderSession.append('compaction/start', { compactionId: 'cmp-p23-2', turn: null })
  const p23Ctx = makeMockCtx({
    providers: {
      openai: { baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'TEST_LCX_API_KEY', reasoning: 'medium' },
    },
    sessions: {
      get: (id) =>
        id === 'sess-p23-compact'
          ? p23Session
          : id === 'sess-p23-no-header'
            ? p23NoHeaderSession
            : undefined,
    },
    sessionQuery: {
      observeSession: async (id) => ({
        events: (id === 'sess-p23-compact' ? p23Session : p23NoHeaderSession).snapshotEvents(),
        [Symbol.dispose]() {},
      }),
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
      ],
      fileRequestText: () => '[file]',
      resolveModelInfo: async () => ({
        provider: 'openai',
        id: 'gpt-6.2-sol',
        model: 'gpt-6.2-sol',
        context: { contextWindow: 8192 },
        contextWindow: 8192,
        defaultMaxTokens: 10000,
        inputModalities: ['text'],
        reasoning: { defaultEffort: 'medium', efforts: [{ id: 'low', label: 'low' }, { id: 'medium', label: 'medium' }, { id: 'high', label: 'high' }] },
        systemPromptUpdate: 'in-history',
        toolUpdate: 'addition-only',
      }),
    },
  })
  const p23Route = routeWithPolicies(
    resolveResponsesRouteConfig(p23Ctx, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
    { gatewayCompatibilityFallback: false },
  )
  await withMockFetch(
    async () => sseCompactionResponse('opaque-p23'),
    async (captured) => {
      // Caller options override session header and clamp against 8192 window
      for await (const _chunk of remoteCompactionStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          purpose: 'compaction',
          sessionId: 'sess-p23-compact',
          reasoningEffort: 'high',
          temperature: 0.7,
          maxTokens: 16384,
          messages: [
            { id: 'u-p23-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'T'.repeat(7000) }] },
            { role: 'user', content: [{ type: 'text', text: 'compact directive' }] },
          ],
        },
        p23Route,
        p23Ctx,
        () => { throw new Error('fallback must not run') },
      )) {
        // exhaust
      }
      assert.equal(captured[0].body.reasoning?.effort, 'high')
      assert.equal(captured[0].body.temperature, 0.7)
      // 7000 chars => 2000 tokens; 8192 - 2000 - 4096 = 2096
      assert.equal(captured[0].body.max_output_tokens, 2096)

      // Omitted caller options fall back to session header ('low', 0.4, 4096)
      for await (const _chunk of remoteCompactionStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          purpose: 'compaction',
          sessionId: 'sess-p23-compact',
          messages: [
            { id: 'u-p23-2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'compact' }] },
            { role: 'user', content: [{ type: 'text', text: 'compact directive' }] },
          ],
        },
        p23Route,
        p23Ctx,
        () => { throw new Error('fallback must not run') },
      )) {
        // exhaust
      }
      assert.equal(captured[1].body.reasoning?.effort, 'low')
      assert.equal(captured[1].body.temperature, 0.4)
      assert.equal(captured[1].body.max_output_tokens, 4094) // 8192 - ceil(7/3.5)=2 - 4096 = 4094

      // No caller options and no session header falls back to profileReasoning / DSH defaultMaxTokens + clamps
      for await (const _chunk of remoteCompactionStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          purpose: 'compaction',
          sessionId: 'sess-p23-no-header',
          messages: [
            { id: 'u-p23-3', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'compact' }] },
            { role: 'user', content: [{ type: 'text', text: 'compact directive' }] },
          ],
        },
        p23Route,
        p23Ctx,
        () => { throw new Error('fallback must not run') },
      )) {
        // exhaust
      }
      assert.equal(captured[2].body.reasoning?.effort, 'medium')
      assert.equal(captured[2].body.max_output_tokens, 4094)
    },
  )
})

test('Round 13 P2-1, P2-2 & P2-3: explicit null thinkingLevelMap / unresolved facts fail closed, option validation runs before resolveApiKey, and Grok encrypted reasoning does not inflate token clamp', async () => {
  // 1) P2-1: gpt-6.2-sol with facts.resolved=true & reasoning=undefined still rejects 'off' in GPT & compaction streams
  const solNoReasoningFactsCtx = makeMockCtx({
    providers: {
      openai: { baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'TEST_LCX_API_KEY' },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
      ],
      fileRequestText: () => '[file]',
      resolveModelInfo: async () => ({
        provider: 'openai',
        id: 'gpt-6.2-sol',
        model: 'gpt-6.2-sol',
        context: { contextWindow: 272_000 },
        inputModalities: ['text'],
        systemPromptUpdate: 'in-history',
        toolUpdate: 'addition-only',
      }),
    },
  })
  const solNoFactsRoute = routeWithPolicies(
    resolveResponsesRouteConfig(solNoReasoningFactsCtx, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
    { gatewayCompatibilityFallback: false },
  )
  await withMockFetch(
    async () => { throw new Error('fetch must not run for gpt-6.2-sol off with reasoning=undefined') },
    async (captured) => {
      const gptChunks = []
      for await (const chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-r13-p21-sol-off',
          reasoningEffort: 'off',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        },
        solNoFactsRoute,
        solNoReasoningFactsCtx,
      )) {
        gptChunks.push(chunk)
      }
      assert.equal(captured.length, 0)
      assert.equal(gptChunks.at(-1)?.reason?.failure?.code, 'UNSUPPORTED_OPTION')

      await assert.rejects(
        async () => {
          for await (const _chunk of remoteCompactionStream(
            {
              provider: 'openai',
              model: 'gpt-6.2-sol',
              purpose: 'compaction',
              sessionId: 'sess-r13-p21-compact-off',
              reasoningEffort: 'off',
              messages: [{ role: 'user', content: [{ type: 'text', text: 'compact' }] }],
            },
            solNoFactsRoute,
            solNoReasoningFactsCtx,
            () => { throw new Error('fallback must not run') },
          )) {
            // unreachable
          }
        },
        (err) => err?.code === 'LCX_RESPONSES_UNSUPPORTED_OPTION',
      )
    },
  )

  // Custom profile with reasoningEfforts { off: null, high: ... } MUST reject 'off' when facts.resolved === false
  const unresolvedOmitOffCtx = makeMockCtx({
    providers: {
      relay: {
        api: 'openai-responses',
        baseURL: 'https://relay.example/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        models: [{ id: 'grok-custom-omit', reasoningEfforts: { off: null, high: 'relay-high' } }],
      },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'relay', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'relay'] },
      ],
      fileRequestText: () => '[file]',
      resolveModelInfo: async () => undefined,
    },
  })
  const unresolvedRelayGrokRoute = routeWithPolicies(
    resolveGrokResponsesRouteConfig(unresolvedOmitOffCtx, { provider: 'relay', model: 'grok-custom-omit' }, {}),
    {},
  )
  await withMockFetch(
    async () => { throw new Error('fetch must not run for unresolved facts with off: null') },
    async (captured) => {
      const relayChunks = []
      for await (const chunk of managedGrokNativeSearchStream(
        {
          provider: 'relay',
          model: 'grok-custom-omit',
          sessionId: 'sess-r13-p21-unresolved-off',
          reasoningEffort: 'off',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }],
        },
        unresolvedRelayGrokRoute,
        { web: true, x: false },
        unresolvedOmitOffCtx,
      )) {
        relayChunks.push(chunk)
      }
      assert.equal(captured.length, 0)
      assert.equal(relayChunks.at(-1)?.reason?.failure?.code, 'UNSUPPORTED_OPTION')
    },
  )

  // 2) P2-2: invalid reasoningEffort / temperature / maxTokens fail BEFORE resolveApiKey (0 credentials.resolve calls)
  let credCalls = 0
  const spyCredCtx = makeMockCtx({
    providers: {
      openai: { baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'TEST_LCX_API_KEY' },
      xai: { baseURL: 'https://api.x.ai/v1', apiKeyEnv: 'TEST_LCX_API_KEY' },
    },
    credentials: {
      resolve: async () => {
        credCalls += 1
        return { value: 'sk-test-token' }
      },
    },
  })
  const spyGptRoute = routeWithPolicies(
    resolveResponsesRouteConfig(spyCredCtx, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
    { gatewayCompatibilityFallback: false },
  )
  const spyGrokRoute = routeWithPolicies(
    resolveGrokResponsesRouteConfig(spyCredCtx, { provider: 'xai', model: 'grok-4.7' }, {}),
    {},
  )

  await withMockFetch(
    async () => sseCompletedResponse('resp_r13_p22_ok', 'ok', 'gpt-6.2-sol'),
    async (captured) => {
      for (const badOpts of [
        { reasoningEffort: 'off' },
        { temperature: Number.NaN },
        { temperature: Number.POSITIVE_INFINITY },
        { maxTokens: 1.5 },
        { maxTokens: 0 },
      ]) {
        const before = credCalls
        const gptChunks = []
        for await (const chunk of managedResponsesStream(
          {
            provider: 'openai',
            model: 'gpt-6.2-sol',
            sessionId: 'sess-r13-p22-gpt',
            ...badOpts,
            messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          },
          spyGptRoute,
          spyCredCtx,
        )) {
          gptChunks.push(chunk)
        }
        assert.equal(credCalls, before, `managedResponsesStream must not resolveApiKey on ${JSON.stringify(badOpts)}`)
        assert.ok(gptChunks.at(-1)?.reason?.failure, `managedResponsesStream must fail on ${JSON.stringify(badOpts)}`)

        const grokBad = badOpts.reasoningEffort === 'off' ? { reasoningEffort: 'bogus-effort' } : badOpts
        const grokChunks = []
        for await (const chunk of managedGrokNativeSearchStream(
          {
            provider: 'xai',
            model: 'grok-4.7',
            sessionId: 'sess-r13-p22-grok',
            ...grokBad,
            messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }],
          },
          spyGrokRoute,
          { web: true, x: false },
          spyCredCtx,
        )) {
          grokChunks.push(chunk)
        }
        assert.equal(credCalls, before, `managedGrokNativeSearchStream must not resolveApiKey on ${JSON.stringify(grokBad)}`)
        assert.ok(grokChunks.at(-1)?.reason?.failure, `managedGrokNativeSearchStream must fail on ${JSON.stringify(grokBad)}`)

        await assert.rejects(async () => {
          for await (const _chunk of remoteCompactionStream(
            {
              provider: 'openai',
              model: 'gpt-6.2-sol',
              purpose: 'compaction',
              sessionId: 'sess-r13-p22-compact',
              ...badOpts,
              messages: [{ role: 'user', content: [{ type: 'text', text: 'compact' }] }],
            },
            spyGptRoute,
            spyCredCtx,
            () => { throw new Error('fallback must not run') },
          )) {
            // unreachable
          }
        })
        assert.equal(credCalls, before, `remoteCompactionStream must not resolveApiKey on ${JSON.stringify(badOpts)}`)
      }
      assert.equal(captured.length, 0)

      // Positive sanity check: valid options DO invoke credentials.resolve exactly once
      for await (const _chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-r13-p22-valid',
          reasoningEffort: 'low',
          temperature: 0.5,
          maxTokens: 1024,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        },
        spyGptRoute,
        spyCredCtx,
      )) {
        // exhaust
      }
      assert.equal(credCalls, 1)
      assert.equal(captured.length, 1)
    },
  )

  // 3) P2-3: restored Grok reasoning item encrypted_content does not inflate max_output_tokens clamp while wire encrypted_content stays intact
  const grokP23Ctx = makeMockCtx({
    providers: { xai: { baseURL: 'https://api.x.ai/v1', apiKeyEnv: 'TEST_LCX_API_KEY' } },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
      ],
      fileRequestText: () => '[file]',
      resolveModelInfo: async () => ({
        provider: 'xai',
        id: 'grok-4.7',
        model: 'grok-4.7',
        context: { contextWindow: 12_000 },
        contextWindow: 12_000,
        inputModalities: ['text'],
        reasoning: { efforts: [{ id: 'low', label: 'low' }, { id: 'high', label: 'high' }] },
        systemPromptUpdate: 'in-history',
        toolUpdate: 'addition-only',
      }),
    },
  })
  const grokP23Route = routeWithPolicies(
    resolveGrokResponsesRouteConfig(grokP23Ctx, { provider: 'xai', model: 'grok-4.7' }, {}),
    {},
  )

  async function runGrokEncryptedReasoningClamp({ sessionId, encryptedLen, includeSummary }) {
    let clampMaxTokens
    let wireReasoning
    await withMockFetch(
      async (_url, _init, body) => {
        if (body.input.length === 1) {
          const reasoningItem = includeSummary
            ? {
                type: 'reasoning',
                id: 'rs_p23',
                summary: [{ type: 'summary_text', text: 'thought' }],
                encrypted_content: 'E'.repeat(encryptedLen),
              }
            : {
                type: 'reasoning',
                id: 'rs_p23_opaque',
                summary: [],
                encrypted_content: 'E'.repeat(encryptedLen),
              }
          const ev = {
            type: 'response.completed',
            response: {
              id: `resp_${sessionId}_1`,
              object: 'response',
              model: 'grok-4.7',
              status: 'completed',
              output: [
                reasoningItem,
                { type: 'message', id: `msg_${sessionId}_1`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] },
              ],
            },
          }
          return new Response(`event: response.completed\ndata: ${JSON.stringify(ev)}\n\n`, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          })
        }
        return sseCompletedResponse(`resp_${sessionId}_2`, 'done', 'grok-4.7')
      },
      async (captured) => {
        const turn1Chunks = []
        for await (const chunk of managedGrokNativeSearchStream(
          {
            provider: 'xai',
            model: 'grok-4.7',
            sessionId,
            maxTokens: 10_000,
            messages: [{ id: `u_${sessionId}_1`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'search' }] }],
          },
          grokP23Route,
          { web: true, x: false },
          grokP23Ctx,
        )) {
          turn1Chunks.push(chunk)
        }
        const turn1Finish = turn1Chunks.find((c) => c.type === 'finish')
        assert.ok(turn1Finish?.replayState?.grokNative)

        for await (const _chunk of managedGrokNativeSearchStream(
          {
            provider: 'xai',
            model: 'grok-4.7',
            sessionId,
            maxTokens: 10_000,
            messages: [
              { id: `u_${sessionId}_1`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'search' }] },
              {
                id: `a_${sessionId}_1`,
                role: 'assistant',
                source: {
                  kind: 'model',
                  provider: 'xai',
                  model: 'grok-4.7',
                  replayState: turn1Finish.replayState,
                },
                content: includeSummary
                  ? [{ type: 'reasoning', text: 'thought' }, { type: 'text', text: 'ok' }]
                  : [{ type: 'text', text: 'ok' }],
              },
              { id: `u_${sessionId}_2`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'follow up' }] },
            ],
          },
          grokP23Route,
          { web: true, x: false },
          grokP23Ctx,
        )) {
          // exhaust
        }
        assert.equal(captured.length, 2)
        clampMaxTokens = captured[1].body.max_output_tokens
        wireReasoning = captured[1].body.input.find((item) => item?.type === 'reasoning')
      },
    )
    return { clampMaxTokens, wireReasoning }
  }

  const shortEnc = await runGrokEncryptedReasoningClamp({
    sessionId: 'sess-r13-p23-short',
    encryptedLen: 100,
    includeSummary: true,
  })
  const longEnc = await runGrokEncryptedReasoningClamp({
    sessionId: 'sess-r13-p23-long',
    encryptedLen: 14_000,
    includeSummary: true,
  })
  const opaqueOnly = await runGrokEncryptedReasoningClamp({
    sessionId: 'sess-r13-p23-opaque',
    encryptedLen: 14_000,
    includeSummary: false,
  })
  assert.equal(shortEnc.wireReasoning?.encrypted_content, 'E'.repeat(100))
  assert.equal(longEnc.wireReasoning?.encrypted_content, 'E'.repeat(14_000))
  assert.equal(opaqueOnly.wireReasoning?.encrypted_content, 'E'.repeat(14_000))
  assert.equal(
    longEnc.clampMaxTokens,
    shortEnc.clampMaxTokens,
    `encrypted_content must not shrink max_output_tokens (${longEnc.clampMaxTokens} vs ${shortEnc.clampMaxTokens})`,
  )
  assert.ok(longEnc.clampMaxTokens > 7500, `expected > 7500 when ciphertext excluded, got ${longEnc.clampMaxTokens}`)
  assert.ok(opaqueOnly.clampMaxTokens >= longEnc.clampMaxTokens)
})

function makeRealPiAiCtx(profiles) {
  const ctx = new Context()
  ctx.provide('loader', { await: () => Promise.resolve() }, true)
  ctx.provide('profileContext', { home: 'unused' }, true)
  ctx.provide('credentials', {
    resolve: async (ref) => {
      const key = String(ref?.id ?? ref ?? '')
      return key === 'TEST_LCX_API_KEY' ? { value: 'sk-test-token' } : undefined
    },
  }, true)
  const raw = { providers: profiles }
  const entry = {
    options: { id: 'llm-pi-ai', config: raw },
    fiber: { uid: 1, state: 2, runtime: { Config: PiConfig }, effectiveConfig: PiConfig(raw), ctx },
  }
  ctx.provide('configEditor', {
    configuration: () => [{ entry, inherited: {}, override: raw }],
    entries: () => [entry],
    async edit() {},
  }, true)
  new SettingsForms(ctx)
  new LlmRuntime(ctx)
  ctx.plugin(applyPi, PiConfig(raw))
  const sessionMap = new Map()
  const getOrCreateSession = (id) => {
    const key = String(id)
    if (!sessionMap.has(key)) {
      const s = Session.create(SessionId(key))
      s.append('compaction/start', { compactionId: `cmp_${key}`, turn: null })
      sessionMap.set(key, s)
    }
    return sessionMap.get(key)
  }
  ctx.provide('sessions', { get: getOrCreateSession }, true)
  ctx.provide('sessionQuery', {
    observeSession: async (id) => ({
      events: getOrCreateSession(id).snapshotEvents(),
      [Symbol.dispose]() {},
    }),
  }, true)
  return ctx
}

test('Round 14 P2-1: provider defaultMaxTokens and unresolved entry.maxTokens match real @deepseek-ai/dsh-llm-pi-ai PiAiAdapter precedence across GPT, Grok, and Native V2 compaction', async () => {

  const realProfiles = {
    openai: {
      api: 'openai-responses',
      baseURL: 'https://api.openai.com/v1',
      apiKeyEnv: 'TEST_LCX_API_KEY',
      defaultContextWindow: 200_000,
      defaultMaxTokens: 4096,
      models: [
        { id: 'gpt-6.2-sol' },
        { id: 'gpt-6-custom', reasoningEfforts: { off: 'none', low: 'low', high: 'high' } },
      ],
    },
    xai: {
      api: 'openai-responses',
      baseURL: 'https://api.x.ai/v1',
      apiKeyEnv: 'TEST_LCX_API_KEY',
      defaultContextWindow: 200_000,
      defaultMaxTokens: 4096,
      models: [
        { id: 'grok-4.7' },
        { id: 'grok-custom', reasoningEfforts: { off: null, low: 'low', high: 'high' } },
      ],
    },
  }
  const realCtx = makeRealPiAiCtx(realProfiles)
  await new Promise((resolve) => setTimeout(resolve, 40))

  try {
    const customGptRoute = routeWithPolicies(
      resolveResponsesRouteConfig(realCtx, { provider: 'openai', model: 'gpt-6-custom' }, {}),
      { gatewayCompatibilityFallback: false },
    )
    const catalogGptRoute = routeWithPolicies(
      resolveResponsesRouteConfig(realCtx, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
      { gatewayCompatibilityFallback: false },
    )
    const customGrokRoute = routeWithPolicies(
      resolveGrokResponsesRouteConfig(realCtx, { provider: 'xai', model: 'grok-custom' }, {}),
      {},
    )
    const catalogGrokRoute = routeWithPolicies(
      resolveGrokResponsesRouteConfig(realCtx, { provider: 'xai', model: 'grok-4.7' }, {}),
      {},
    )
    assert.equal(customGptRoute.profileDefaultMaxTokens, 4096)
    assert.equal(customGrokRoute.profileDefaultMaxTokens, 4096)

    await withMockFetch(
      async (_url, init, body) => {
        const features = String(init?.headers?.['x-codex-beta-features'] ?? '')
        if (features.includes('compact')) return sseCompactionResponse()
        return sseCompletedResponse(`resp_${body?.model ?? 'x'}`, 'ok', String(body?.model ?? 'gpt-6-custom'))
      },
      async (captured) => {
        // 1) Uncatalogued GPT: host PiAiAdapter uses provider defaultMaxTokens (4096); LCX ordinary + compaction match 4096
        for await (const _chunk of realCtx.llm.stream({
          provider: 'openai',
          model: 'gpt-6-custom',
          sessionId: 'sess-r14-host-gpt-custom',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        })) {
          // exhaust
        }
        const hostCustomGptMax = captured.at(-1).body.max_output_tokens
        assert.equal(hostCustomGptMax, 4096)

        for await (const _chunk of managedResponsesStream(
          {
            provider: 'openai',
            model: 'gpt-6-custom',
            sessionId: 'sess-r14-lcx-gpt-custom',
            messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          },
          customGptRoute,
          realCtx,
        )) {
          // exhaust
        }
        assert.equal(captured.at(-1).body.max_output_tokens, hostCustomGptMax)

        for await (const _chunk of remoteCompactionStream(
          {
            provider: 'openai',
            model: 'gpt-6-custom',
            purpose: 'compaction',
            sessionId: 'sess-r14-lcx-gpt-custom-cmp',
            messages: [
              { id: 'u-r14-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
              { role: 'user', content: [{ type: 'text', text: 'compact directive' }] },
            ],
          },
          customGptRoute,
          realCtx,
          () => { throw new Error('fallback must not run') },
        )) {
          // exhaust
        }
        assert.equal(captured.at(-1).body.max_output_tokens, 4096)

        // 2) Catalogued GPT: catalog maxTokens (128000) beats provider defaultMaxTokens (4096) on host + LCX
        for await (const _chunk of realCtx.llm.stream({
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-r14-host-gpt-cat',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        })) {
          // exhaust
        }
        const hostCatGptMax = captured.at(-1).body.max_output_tokens
        assert.equal(hostCatGptMax, 128_000)

        for await (const _chunk of managedResponsesStream(
          {
            provider: 'openai',
            model: 'gpt-6.2-sol',
            sessionId: 'sess-r14-lcx-gpt-cat',
            messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          },
          catalogGptRoute,
          realCtx,
        )) {
          // exhaust
        }
        assert.equal(captured.at(-1).body.max_output_tokens, hostCatGptMax)

        for await (const _chunk of remoteCompactionStream(
          {
            provider: 'openai',
            model: 'gpt-6.2-sol',
            purpose: 'compaction',
            sessionId: 'sess-r14-lcx-gpt-cat-cmp',
            messages: [
              { id: 'u-r14-2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
              { role: 'user', content: [{ type: 'text', text: 'compact directive' }] },
            ],
          },
          catalogGptRoute,
          realCtx,
          () => { throw new Error('fallback must not run') },
        )) {
          // exhaust
        }
        assert.equal(captured.at(-1).body.max_output_tokens, 128_000)

        // 3) Uncatalogued Grok: host PiAiAdapter uses provider defaultMaxTokens (4096); LCX Grok matches 4096
        for await (const _chunk of realCtx.llm.stream({
          provider: 'xai',
          model: 'grok-custom',
          sessionId: 'sess-r14-host-grok-custom',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }],
        })) {
          // exhaust
        }
        const hostCustomGrokMax = captured.at(-1).body.max_output_tokens
        assert.equal(hostCustomGrokMax, 4096)

        for await (const _chunk of managedGrokNativeSearchStream(
          {
            provider: 'xai',
            model: 'grok-custom',
            sessionId: 'sess-r14-lcx-grok-custom',
            messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }],
          },
          customGrokRoute,
          { web: true, x: false },
          realCtx,
        )) {
          // exhaust
        }
        assert.equal(captured.at(-1).body.max_output_tokens, hostCustomGrokMax)

        // 4) Catalogued Grok: catalog maxTokens beats provider defaultMaxTokens (4096) on BOTH host & LCX
        for await (const _chunk of realCtx.llm.stream({
          provider: 'xai',
          model: 'grok-4.7',
          sessionId: 'sess-r14-host-grok-cat',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }],
        })) {
          // exhaust
        }
        const hostCatGrokMax = captured.at(-1).body.max_output_tokens
        assert.notEqual(hostCatGrokMax, 4096)

        for await (const _chunk of managedGrokNativeSearchStream(
          {
            provider: 'xai',
            model: 'grok-4.7',
            sessionId: 'sess-r14-lcx-grok-cat',
            messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }],
          },
          catalogGrokRoute,
          { web: true, x: false },
          realCtx,
        )) {
          // exhaust
        }
        assert.equal(captured.at(-1).body.max_output_tokens, hostCatGrokMax)
      },
    )
  } finally {
    await realCtx.stop?.()
  }

  // 5) facts.resolved === false fallback: per-model entry.maxTokens (8192) beats defaultMaxTokens (4096), which beats 32768, while caller (2048) beats all
  const unresolvedSessions = new Map()
  const getUnresolvedSession = (id) => {
    const key = String(id)
    if (!unresolvedSessions.has(key)) {
      const s = Session.create(SessionId(key))
      s.append('compaction/start', { compactionId: `cmp_${key}`, turn: null })
      unresolvedSessions.set(key, s)
    }
    return unresolvedSessions.get(key)
  }
  const unresolvedPrecedenceCtx = makeMockCtx({
    sessions: { get: getUnresolvedSession },
    sessionQuery: {
      observeSession: async (id) => ({
        events: getUnresolvedSession(id).snapshotEvents(),
        [Symbol.dispose]() {},
      }),
    },
    providers: {
      openai: {
        api: 'openai-responses',
        baseURL: 'https://api.openai.com/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        defaultMaxTokens: 4096,
        models: [
          { id: 'gpt-6-entry', maxTokens: 8192 },
          { id: 'gpt-6-default-only' },
        ],
      },
      xai: {
        api: 'openai-responses',
        baseURL: 'https://api.x.ai/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        defaultMaxTokens: 4096,
        models: [
          { id: 'grok-entry', maxTokens: 8192 },
          { id: 'grok-default-only' },
        ],
      },
    },
    llm: {
      listConfigurableProviders: () => [
        { provider: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
        { provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] },
      ],
      fileRequestText: () => '[file]',
      resolveModelInfo: async () => undefined,
    },
  })
  const gptEntryRoute = routeWithPolicies(
    resolveResponsesRouteConfig(unresolvedPrecedenceCtx, { provider: 'openai', model: 'gpt-6-entry' }, {}),
    { gatewayCompatibilityFallback: false },
  )
  const gptDefaultRoute = routeWithPolicies(
    resolveResponsesRouteConfig(unresolvedPrecedenceCtx, { provider: 'openai', model: 'gpt-6-default-only' }, {}),
    { gatewayCompatibilityFallback: false },
  )
  const grokEntryRoute = routeWithPolicies(
    resolveGrokResponsesRouteConfig(unresolvedPrecedenceCtx, { provider: 'xai', model: 'grok-entry' }, {}),
    {},
  )
  const grokDefaultRoute = routeWithPolicies(
    resolveGrokResponsesRouteConfig(unresolvedPrecedenceCtx, { provider: 'xai', model: 'grok-default-only' }, {}),
    {},
  )

  await withMockFetch(
    async (_url, init, body) => {
      const features = String(init?.headers?.['x-codex-beta-features'] ?? '')
      if (features.includes('compact')) return sseCompactionResponse()
      return sseCompletedResponse('resp_r14_unres', 'ok', String(body?.model ?? 'gpt-6-entry'))
    },
    async (captured) => {
      for await (const _c of managedResponsesStream(
        { provider: 'openai', model: 'gpt-6-entry', sessionId: 's-r14-u1', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
        gptEntryRoute,
        unresolvedPrecedenceCtx,
      )) {}
      assert.equal(captured.at(-1).body.max_output_tokens, 8192)

      for await (const _c of remoteCompactionStream(
        {
          provider: 'openai',
          model: 'gpt-6-entry',
          purpose: 'compaction',
          sessionId: 's-r14-u2',
          messages: [
            { id: 'u-r14-u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] },
            { role: 'user', content: [{ type: 'text', text: 'compact' }] },
          ],
        },
        gptEntryRoute,
        unresolvedPrecedenceCtx,
        () => { throw new Error('fallback must not run') },
      )) {}
      assert.equal(captured.at(-1).body.max_output_tokens, 8192)

      for await (const _c of managedResponsesStream(
        { provider: 'openai', model: 'gpt-6-entry', sessionId: 's-r14-u3', maxTokens: 2048, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
        gptEntryRoute,
        unresolvedPrecedenceCtx,
      )) {}
      assert.equal(captured.at(-1).body.max_output_tokens, 2048)

      for await (const _c of managedResponsesStream(
        { provider: 'openai', model: 'gpt-6-default-only', sessionId: 's-r14-u4', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] },
        gptDefaultRoute,
        unresolvedPrecedenceCtx,
      )) {}
      assert.equal(captured.at(-1).body.max_output_tokens, 4096)

      for await (const _c of managedGrokNativeSearchStream(
        { provider: 'xai', model: 'grok-entry', sessionId: 's-r14-u5', messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }] },
        grokEntryRoute,
        { web: true, x: false },
        unresolvedPrecedenceCtx,
      )) {}
      assert.equal(captured.at(-1).body.max_output_tokens, 8192)

      for await (const _c of managedGrokNativeSearchStream(
        { provider: 'xai', model: 'grok-default-only', sessionId: 's-r14-u6', messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }] },
        grokDefaultRoute,
        { web: true, x: false },
        unresolvedPrecedenceCtx,
      )) {}
      assert.equal(captured.at(-1).body.max_output_tokens, 4096)
    },
  )

  // 6) Grok pre-flight budget diagnostic semantics stay intact (defaultMaxTokens alone does not warn; explicit entry.maxTokens >= contextWindow warns)
  assert.equal(
    diagnoseGrokContextBudget(realCtx, { provider: 'xai', model: 'grok-custom' }),
    undefined,
  )
  const diagWarnCtx = makeMockCtx({
    providers: {
      xai: {
        baseURL: 'https://api.x.ai/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        defaultContextWindow: 200_000,
        models: [{ id: 'grok-custom', maxTokens: 200_000 }],
      },
    },
  })
  assert.match(
    diagnoseGrokContextBudget(diagWarnCtx, { provider: 'xai', model: 'grok-custom' }) ?? '',
    /MODEL_SWITCH_COMPACTION_FAILED/u,
  )
})

test('Round 15 P2-1: non-Responses Pi catalog models preserve PiAiAdapter maxTokens over provider defaultMaxTokens across Grok, Responses, and Native V2 compaction', async () => {
  const { resolveCatalogModel } = await loadSource('model-catalog')
  const openrouterFacts = resolveCatalogModel('openrouter', 'x-ai/grok-4.7')
  assert.equal(openrouterFacts.source, 'unknown')
  assert.equal(openrouterFacts.maxTokens, 450_000)

  const azureFacts = resolveCatalogModel('azure', 'gpt-4.1')
  assert.equal(azureFacts.source, 'unknown')
  assert.equal(azureFacts.maxTokens, 32_768)

  const bundledNonResponsesFacts = resolveCatalogModel('github-copilot', 'gemini-3.8-flash')
  assert.equal(bundledNonResponsesFacts.source, 'catalog-model')
  assert.equal(bundledNonResponsesFacts.api, 'openai-completions')
  assert.equal(bundledNonResponsesFacts.descriptor, undefined)
  assert.equal(bundledNonResponsesFacts.maxTokens, 64_000)

  const realCtx = makeRealPiAiCtx({
    openrouter: {
      api: 'openai-responses',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'TEST_LCX_API_KEY',
      defaultContextWindow: 200_000,
      defaultMaxTokens: 4096,
      models: [{ id: 'x-ai/grok-4.7' }],
    },
    azure: {
      api: 'openai-responses',
      baseURL: 'https://example.openai.azure.com/openai/v1',
      apiKeyEnv: 'TEST_LCX_API_KEY',
      defaultContextWindow: 200_000,
      defaultMaxTokens: 4096,
      models: [{ id: 'gpt-4.1' }],
    },
  })
  const explicitCtx = makeRealPiAiCtx({
    azure: {
      api: 'openai-responses',
      baseURL: 'https://example.openai.azure.com/openai/v1',
      apiKeyEnv: 'TEST_LCX_API_KEY',
      defaultContextWindow: 200_000,
      defaultMaxTokens: 4096,
      models: [{ id: 'gpt-4.1', maxTokens: 16_000 }],
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 40))

  try {
    const grokRoute = routeWithPolicies(
      resolveGrokResponsesRouteConfig(realCtx, { provider: 'openrouter', model: 'x-ai/grok-4.7' }, {}),
      {},
    )
    assert.equal(grokRoute.catalogMaxTokens, 450_000)
    assert.equal(grokRoute.profileDefaultMaxTokens, 4096)

    const azureRoute = routeWithPolicies(
      resolveResponsesRouteConfig(realCtx, { provider: 'azure', model: 'gpt-4.1' }, {}),
      { gatewayCompatibilityFallback: false },
    )
    assert.equal(azureRoute.catalogMaxTokens, 32_768)
    assert.equal(azureRoute.profileDefaultMaxTokens, 4096)

    const azureExplicitRoute = routeWithPolicies(
      resolveResponsesRouteConfig(explicitCtx, { provider: 'azure', model: 'gpt-4.1' }, {}),
      { gatewayCompatibilityFallback: false },
    )
    assert.equal(azureExplicitRoute.catalogMaxTokens, 32_768)
    assert.equal(azureExplicitRoute.profileDefaultMaxTokens, 4096)

    assert.equal(
      diagnoseGrokContextBudget(realCtx, { provider: 'openrouter', model: 'x-ai/grok-4.7' }),
      undefined,
    )

    await withMockFetch(
      async (_url, init, body) => {
        const features = String(init?.headers?.['x-codex-beta-features'] ?? '')
        if (features.includes('compact')) return sseCompactionResponse()
        return sseCompletedResponse(`resp_${body?.model ?? 'x'}`, 'ok', String(body?.model ?? 'gpt-4.1'))
      },
      async (captured) => {
        // 1) Unbundled non-Responses Grok catalog model (openrouter x-ai/grok-4.7 -> 450000 beats defaultMaxTokens 4096)
        for await (const _c of realCtx.llm.stream({
          provider: 'openrouter',
          model: 'x-ai/grok-4.7',
          sessionId: 'sess-r15-host-or-grok',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }],
        })) {}
        assert.equal(captured.at(-1).body.max_output_tokens, 450_000)

        for await (const _c of managedGrokNativeSearchStream(
          {
            provider: 'openrouter',
            model: 'x-ai/grok-4.7',
            sessionId: 'sess-r15-lcx-or-grok',
            messages: [{ role: 'user', content: [{ type: 'text', text: 'search' }] }],
          },
          grokRoute,
          { web: true, x: false },
          realCtx,
        )) {}
        assert.equal(captured.at(-1).body.max_output_tokens, 450_000)

        // 2) Unbundled non-Responses GPT catalog model (azure gpt-4.1 -> 32768 beats defaultMaxTokens 4096 across stream + compaction)
        for await (const _c of realCtx.llm.stream({
          provider: 'azure',
          model: 'gpt-4.1',
          sessionId: 'sess-r15-host-az-gpt',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        })) {}
        assert.equal(captured.at(-1).body.max_output_tokens, 32_768)

        for await (const _c of managedResponsesStream(
          {
            provider: 'azure',
            model: 'gpt-4.1',
            sessionId: 'sess-r15-lcx-az-gpt',
            messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          },
          azureRoute,
          realCtx,
        )) {}
        assert.equal(captured.at(-1).body.max_output_tokens, 32_768)

        for await (const _c of remoteCompactionStream(
          {
            provider: 'azure',
            model: 'gpt-4.1',
            purpose: 'compaction',
            sessionId: 'sess-r15-lcx-az-cmp',
            messages: [
              { id: 'u-r15-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
              { role: 'user', content: [{ type: 'text', text: 'compact directive' }] },
            ],
          },
          azureRoute,
          realCtx,
          () => { throw new Error('fallback must not run') },
        )) {}
        assert.equal(captured.at(-1).body.max_output_tokens, 32_768)

        // 3) Caller options.maxTokens overrides catalogMaxTokens
        for await (const _c of managedResponsesStream(
          {
            provider: 'azure',
            model: 'gpt-4.1',
            sessionId: 'sess-r15-lcx-az-opt',
            maxTokens: 2048,
            messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          },
          azureRoute,
          realCtx,
        )) {}
        assert.equal(captured.at(-1).body.max_output_tokens, 2048)

        // 4) Explicit entry.maxTokens (16000) beats catalogMaxTokens (32768) on host + LCX
        for await (const _c of explicitCtx.llm.stream({
          provider: 'azure',
          model: 'gpt-4.1',
          sessionId: 'sess-r15-host-az-exp',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        })) {}
        assert.equal(captured.at(-1).body.max_output_tokens, 16_000)

        for await (const _c of managedResponsesStream(
          {
            provider: 'azure',
            model: 'gpt-4.1',
            sessionId: 'sess-r15-lcx-az-exp',
            messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          },
          azureExplicitRoute,
          explicitCtx,
        )) {}
        assert.equal(captured.at(-1).body.max_output_tokens, 16_000)

        for await (const _c of remoteCompactionStream(
          {
            provider: 'azure',
            model: 'gpt-4.1',
            purpose: 'compaction',
            sessionId: 'sess-r15-lcx-az-exp-cmp',
            messages: [
              { id: 'u-r15-2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] },
              { role: 'user', content: [{ type: 'text', text: 'compact directive' }] },
            ],
          },
          azureExplicitRoute,
          explicitCtx,
          () => { throw new Error('fallback must not run') },
        )) {}
        assert.equal(captured.at(-1).body.max_output_tokens, 16_000)
      },
    )
  } finally {
    await realCtx.stop?.()
    await explicitCtx.stop?.()
  }
})

test('Astra regression: GPT assistant replayState isolates encrypted reasoning across foreign sessions, seeded forks, and changed baseURL while keeping portable phase', async () => {
  const originBaseURL = 'https://api.openai.com/v1'
  const relayBaseURL = 'https://relay.example/v1'
  const originSessionId = 'sess-astra-origin'
  const childForkId = 'sess-astra-fork-child'

  const parentSeed = Session.create(SessionId('sess-parent-root'))
  parentSeed.append(
    'assistant/message',
    {
      turn: 1,
      step: 0,
      stream: [],
      message: {
        id: 'a_inherited_1',
        role: 'assistant',
        source: { kind: 'model', provider: 'openai', model: 'gpt-6.2-sol' },
        content: [{ type: 'text', text: 'ok' }],
      },
    },
    { surfaceOp: 'append' },
  )
  const forkedHistoryEvents = parentSeed.snapshotEvents()
  const seededForkSession = Session.fromRestore(
    SessionId(childForkId),
    forkedHistoryEvents,
    {
      ...parentSeed.header,
      id: SessionId(childForkId),
      isSeeded: true,
      parentSession: SessionId('sess-parent-root'),
    },
    forkedHistoryEvents.length,
  )

  const originCtx = makeMockCtx({
    providers: { openai: { baseURL: originBaseURL, apiKeyEnv: 'TEST_LCX_API_KEY' } },
  })
  const forkCtx = makeMockCtx({
    providers: { openai: { baseURL: originBaseURL, apiKeyEnv: 'TEST_LCX_API_KEY' } },
    sessions: { get: (id) => (String(id) === childForkId ? seededForkSession : undefined) },
    get: (name) =>
      name === 'sessionQuery'
        ? {
            observeSession: async () => ({
              events: forkedHistoryEvents,
              [Symbol.dispose]: () => {},
            }),
          }
        : undefined,
  })
  const forkNoQueryCtx = makeMockCtx({
    providers: { openai: { baseURL: originBaseURL, apiKeyEnv: 'TEST_LCX_API_KEY' } },
    sessions: { get: (id) => (String(id) === childForkId ? seededForkSession : undefined) },
  })
  const relayCtx = makeMockCtx({
    providers: { openai: { baseURL: relayBaseURL, apiKeyEnv: 'TEST_LCX_API_KEY' } },
  })

  const originRoute = routeWithPolicies(
    resolveResponsesRouteConfig(originCtx, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
    { gatewayCompatibilityFallback: false },
  )
  const relayRoute = routeWithPolicies(
    resolveResponsesRouteConfig(relayCtx, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
    { gatewayCompatibilityFallback: false },
  )

  const sseTurn1 = () => {
    const items = [
      {
        type: 'reasoning',
        id: 'rs_astra_enc_1',
        summary: [{ type: 'summary_text', text: 'checking clues' }],
        encrypted_content: 'OPAQUE_ENCRYPTED_BLOB_123',
      },
      {
        type: 'message',
        id: 'msg_origin_commentary_1',
        role: 'assistant',
        phase: 'commentary',
        status: 'completed',
        content: [{ type: 'output_text', text: 'working on it', annotations: [] }],
      },
      {
        type: 'function_call',
        id: 'fc_origin_call_1',
        call_id: 'call_origin_1',
        status: 'completed',
        name: 'probe_tool',
        arguments: '{"query":"hello"}',
      },
    ]
    const completed = {
      type: 'response.completed',
      response: {
        id: 'resp_astra_enc_1',
        object: 'response',
        status: 'completed',
        model: 'gpt-6.2-sol',
        output: items,
        usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
      },
    }
    const events = [
      { type: 'response.created', response: { ...completed.response, status: 'in_progress', output: [] } },
      ...items.flatMap((item, output_index) => [
        { type: 'response.output_item.added', output_index, item: { ...item, ...(item.type === 'message' ? { content: [], status: 'in_progress' } : {}) } },
        { type: 'response.output_item.done', output_index, item },
      ]),
      completed,
    ]
    const body = events.map((ev) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`).join('')
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }

  await withMockFetch(
    async (_url, _init, _body, capturedList) => (capturedList.length === 1 ? sseTurn1() : sseCompletedResponse('resp_astra_next', 'done', 'gpt-6.2-sol')),
    async (captured) => {
      const turn1Chunks = []
      for await (const chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: originSessionId,
          tools: [makeTool('probe_tool')],
          messages: [{ id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'start' }] }],
        },
        originRoute,
        originCtx,
      )) {
        turn1Chunks.push(chunk)
      }
      const turn1Finish = turn1Chunks.find((c) => c.type === 'finish')
      assert.equal(turn1Finish?.reason?.kind, 'tool-calls')
      assert.equal(turn1Finish?.replayState?.lcxReplay?.version, 1)
      assert.equal(turn1Finish?.replayState?.lcxReplay?.sourceSessionId, originSessionId)
      assert.equal(turn1Finish?.replayState?.lcxReplay?.baseURLFingerprint, baseURLFingerprint(originBaseURL))

      const buildReplayMessages = (assistantId, replayState = turn1Finish.replayState) => [
        { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'start' }] },
        {
          id: assistantId,
          role: 'assistant',
          source: {
            kind: 'model',
            provider: 'openai',
            model: 'gpt-6.2-sol',
            replayState,
          },
          content: turn1Chunks
            .filter((chunk) => chunk.type === 'block-end')
            .map((chunk) => structuredClone(chunk.block)),
        },
        {
          id: 't1',
          role: 'tool',
          source: { kind: 'tool', callId: 'call_origin_1|fc_origin_call_1' },
          toolCallId: 'call_origin_1|fc_origin_call_1',
          content: [{ type: 'text', text: 'ok' }],
        },
        { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'continue' }] },
      ]

      const collectStream = async (stream) => {
        const chunks = []
        for await (const c of stream) chunks.push(c)
        assert.equal(chunks.at(-1)?.reason?.kind, 'stop')
        return chunks
      }

      // 1) Exact same session + same baseURL retains encrypted reasoning and raw fc_* id
      await collectStream(managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: originSessionId,
          tools: [makeTool('probe_tool')],
          messages: buildReplayMessages('a_origin_1'),
        },
        originRoute,
        originCtx,
      ))
      const sameBody = captured.at(-1).body
      assert.ok(sameBody.input.some((item) => item?.type === 'reasoning' && item.encrypted_content === 'OPAQUE_ENCRYPTED_BLOB_123'))
      assert.ok(sameBody.input.some((item) => item?.type === 'function_call' && item.id === 'fc_origin_call_1'))

      // 2) Foreign session strips encrypted reasoning, hashes fc_*, preserves portable phase
      await collectStream(managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-astra-foreign',
          tools: [makeTool('probe_tool')],
          messages: buildReplayMessages('a_origin_1'),
        },
        originRoute,
        originCtx,
      ))
      const foreignBody = captured.at(-1).body
      assert.equal(foreignBody.input.some((item) => item?.type === 'reasoning' || 'encrypted_content' in (item ?? {})), false)
      assert.equal(foreignBody.input.some((item) => item?.type === 'function_call' && item.id === 'fc_origin_call_1'), false)
      assert.ok(foreignBody.input.some((item) => item?.type === 'function_call' && String(item.id).startsWith('fc_')))
      assert.ok(foreignBody.input.some((item) => item?.type === 'message' && item.role === 'assistant' && item.phase === 'commentary'))

      const { lcxReplay: _omitLcxReplay, ...unstampedReplayState } = turn1Finish.replayState

      // 3a) Seeded fork strips encrypted reasoning for stamped replay state on child fork sessionId
      await collectStream(managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: childForkId,
          tools: [makeTool('probe_tool')],
          messages: buildReplayMessages('a_inherited_1'),
        },
        originRoute,
        forkCtx,
      ))
      const forkBody = captured.at(-1).body
      assert.equal(forkBody.input.some((item) => item?.type === 'reasoning' || 'encrypted_content' in (item ?? {})), false)
      assert.equal(forkBody.input.some((item) => item?.type === 'function_call' && item.id === 'fc_origin_call_1'), false)

      // 3b) Seeded fork strips legacy unstamped replay state for inherited parent message id while preserving own unstamped child messages
      await collectStream(managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: childForkId,
          tools: [makeTool('probe_tool')],
          messages: buildReplayMessages('a_inherited_1', unstampedReplayState),
        },
        originRoute,
        forkCtx,
      ))
      const forkUnstampedInheritedBody = captured.at(-1).body
      assert.equal(forkUnstampedInheritedBody.input.some((item) => item?.type === 'reasoning' || 'encrypted_content' in (item ?? {})), false)

      // 4) Seeded fork without sessionQuery fails closed even on legacy unstamped replay state
      await collectStream(managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: childForkId,
          tools: [makeTool('probe_tool')],
          messages: buildReplayMessages('a_origin_1', unstampedReplayState),
        },
        originRoute,
        forkNoQueryCtx,
      ))
      const forkNoQueryBody = captured.at(-1).body
      assert.equal(forkNoQueryBody.input.some((item) => item?.type === 'reasoning' || 'encrypted_content' in (item ?? {})), false)

      // 5) Changed baseURL strips encrypted reasoning even on matching sessionId
      await collectStream(managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId: originSessionId,
          tools: [makeTool('probe_tool')],
          messages: buildReplayMessages('a_origin_1'),
        },
        relayRoute,
        relayCtx,
      ))
      const relayBody = captured.at(-1).body
      assert.equal(relayBody.input.some((item) => item?.type === 'reasoning' || 'encrypted_content' in (item ?? {})), false)

      // 6) Unstamped legacy GPT history fails closed (strips encrypted reasoning & raw fc_*) across both changed baseURL and matching route
      for (const [label, targetRoute, targetCtx] of [
        ['changed-baseurl', relayRoute, relayCtx],
        ['same-route-unstamped', originRoute, originCtx],
      ]) {
        await collectStream(managedResponsesStream(
          {
            provider: 'openai',
            model: 'gpt-6.2-sol',
            sessionId: originSessionId,
            tools: [makeTool('probe_tool')],
            messages: buildReplayMessages('a_legacy_unstamped', unstampedReplayState),
          },
          targetRoute,
          targetCtx,
        ))
        const body = captured.at(-1).body
        assert.equal(body.input.some((item) => item?.type === 'reasoning' || 'encrypted_content' in (item ?? {})), false, `${label} must omit unstamped native reasoning`)
        assert.equal(body.input.some((item) => item?.type === 'function_call' && item.id === 'fc_origin_call_1'), false, `${label} must hash raw fc_* id`)
        assert.ok(body.input.some((item) => item?.type === 'function_call' && /^fc_[0-9a-f]{16}$/u.test(String(item.id))), `${label} expected hashed fc_* id`)
        assert.ok(body.input.some((item) => item?.type === 'message' && item.role === 'assistant' && item.phase === 'commentary'), `${label} must keep portable phase`)
      }

      // 7) Two consecutive sessionless GPT calls never stamp lcxReplay or restore native reasoning
      const sessionlessTurn1 = []
      for await (const chunk of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          tools: [makeTool('probe_tool')],
          messages: [{ id: 'u-sls-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'sessionless start' }] }],
        },
        originRoute,
        originCtx,
      )) {
        sessionlessTurn1.push(chunk)
      }
      const slsFinish = sessionlessTurn1.find((c) => c.type === 'finish')
      assert.equal(slsFinish?.replayState?.lcxReplay, undefined)
      await collectStream(managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          tools: [makeTool('probe_tool')],
          messages: [
            { id: 'u-sls-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'sessionless start' }] },
            {
              id: 'a-sls-1',
              role: 'assistant',
              source: {
                kind: 'model',
                provider: 'openai',
                model: 'gpt-6.2-sol',
                replayState: turn1Finish.replayState,
              },
              content: turn1Chunks.filter((c) => c.type === 'block-end').map((c) => structuredClone(c.block)),
            },
            {
              id: 't-sls-1',
              role: 'tool',
              source: { kind: 'tool', callId: 'call_origin_1|fc_origin_call_1' },
              toolCallId: 'call_origin_1|fc_origin_call_1',
              content: [{ type: 'text', text: 'ok' }],
            },
            { id: 'u-sls-2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] },
          ],
        },
        originRoute,
        originCtx,
      ))
      const sessionlessNoSidBody = captured.at(-1).body
      assert.equal(sessionlessNoSidBody.input.some((item) => item?.type === 'reasoning' || 'encrypted_content' in (item ?? {})), false)

      // 8a) Cross-provider migration to a custom relay provider strips raw fc_origin_call_1 from call_id AND preserves portable phase
      const customProviderCtx = makeMockCtx({
        providers: {
          relay: { baseURL: relayBaseURL, apiKeyEnv: 'TEST_LCX_API_KEY', api: 'openai-responses', models: [{ id: 'gpt-6.2-sol' }] },
        },
      })
      const customProviderRoute = routeWithPolicies(
        resolveResponsesRouteConfig(customProviderCtx, { provider: 'relay', model: 'gpt-6.2-sol' }, {}),
        { gatewayCompatibilityFallback: false },
      )
      await collectStream(managedResponsesStream(
        {
          provider: 'relay',
          model: 'gpt-6.2-sol',
          sessionId: 'sess-custom-relay',
          tools: [makeTool('probe_tool')],
          messages: buildReplayMessages('a_cross_provider_unstamped', unstampedReplayState),
        },
        customProviderRoute,
        customProviderCtx,
      ))
      const customBody = captured.at(-1).body
      const customCall = customBody.input.find((item) => item?.type === 'function_call')
      const customOut = customBody.input.find((item) => item?.type === 'function_call_output')
      assert.ok(customCall && customOut && customCall.call_id === customOut.call_id)
      assert.equal(customCall.id, undefined)
      assert.equal(JSON.stringify(customBody.input).includes('fc_origin_call_1'), false, 'raw item id must not leak into call_id or id on custom providers')
      assert.equal(JSON.stringify(customBody.input).includes('_fc_'), false, 'compound item suffix must not leak into normalized call_id on custom providers')
      assert.ok(customBody.input.some((item) => item?.type === 'message' && item.role === 'assistant' && item.phase === 'commentary'), 'cross-provider portable migration must preserve assistant phase')

      // 8b) Stamped lcxReplay on the EXACT same sessionId + originBaseURL across provider switch (openai -> relay)
      // must also fail closed from native replay and strip raw fc_origin_call_1 without creating call_origin_1_fc_*
      const sameUrlRelayCtx = makeMockCtx({
        providers: {
          relay: { baseURL: originBaseURL, apiKeyEnv: 'TEST_LCX_API_KEY', api: 'openai-responses', models: [{ id: 'gpt-6.2-sol' }] },
        },
      })
      const sameUrlRelayRoute = routeWithPolicies(
        resolveResponsesRouteConfig(sameUrlRelayCtx, { provider: 'relay', model: 'gpt-6.2-sol' }, {}),
        { gatewayCompatibilityFallback: false },
      )
      await collectStream(managedResponsesStream(
        {
          provider: 'relay',
          model: 'gpt-6.2-sol',
          sessionId: originSessionId,
          tools: [makeTool('probe_tool')],
          messages: buildReplayMessages('a_same_url_cross_provider_stamped', turn1Finish.replayState),
        },
        sameUrlRelayRoute,
        sameUrlRelayCtx,
      ))
      const sameUrlRelayBody = captured.at(-1).body
      const sameUrlRelayCall = sameUrlRelayBody.input.find((item) => item?.type === 'function_call')
      const sameUrlRelayOut = sameUrlRelayBody.input.find((item) => item?.type === 'function_call_output')
      assert.equal(sameUrlRelayBody.input.some((item) => item?.type === 'reasoning' || 'encrypted_content' in (item ?? {})), false)
      assert.ok(sameUrlRelayCall && sameUrlRelayOut && sameUrlRelayCall.call_id === sameUrlRelayOut.call_id)
      assert.equal(sameUrlRelayCall.call_id, 'call_origin_1')
      assert.equal(sameUrlRelayCall.id, undefined)
      assert.equal(JSON.stringify(sameUrlRelayBody.input).includes('fc_origin_call_1'), false)
      assert.equal(JSON.stringify(sameUrlRelayBody.input).includes('_fc_'), false)
      assert.ok(sameUrlRelayBody.input.some((item) => item?.type === 'message' && item.role === 'assistant' && item.phase === 'commentary'))
    },
  )
})

test('Astra Round-4 regression: GPT replay and Native V2 compaction invalidate on gateway tenant header change', async () => {
  const gatewayBaseURL = 'https://tenant-gateway.invalid/v1'
  const sessionId = 'sess-gpt-tenant-isolation'
  let activeTenant = 'tenant-a'

  const fakeSession = Session.create(SessionId(sessionId))
  const makeTenantCtx = () =>
    makeMockCtx({
      providers: { openai: { baseURL: gatewayBaseURL, apiKeyEnv: 'TEST_LCX_API_KEY' } },
      sessions: { get: (id) => (String(id) === sessionId ? fakeSession : undefined) },
      get: (name) =>
        name === 'sessionQuery'
          ? {
              observeSession: async () => ({
                events: fakeSession.snapshotEvents(),
                [Symbol.dispose]: () => {},
              }),
            }
          : undefined,
      waterfall(_event, _request, headers, next) {
        if (activeTenant !== null) headers.set('x-tenant', activeTenant)
        return next()
      },
    })

  const sseTenantTurn1 = () => {
    const items = [
      {
        type: 'reasoning',
        id: 'rs_tenant_a',
        summary: [{ type: 'summary_text', text: 'tenant-a thought' }],
        encrypted_content: 'OPAQUE_TENANT_A_BLOB',
      },
      {
        type: 'message',
        id: 'msg_tenant_a',
        role: 'assistant',
        phase: 'commentary',
        status: 'completed',
        content: [{ type: 'output_text', text: 'tenant a working', annotations: [] }],
      },
      {
        type: 'function_call',
        id: 'fc_tenant_a_1',
        call_id: 'call_tenant_a_1',
        status: 'completed',
        name: 'probe_tool',
        arguments: '{"query":"tenant"}',
      },
    ]
    const completed = {
      type: 'response.completed',
      response: {
        id: 'resp_tenant_a_1',
        object: 'response',
        status: 'completed',
        model: 'gpt-6.2-sol',
        output: items,
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    }
    const events = [
      { type: 'response.created', response: { ...completed.response, status: 'in_progress', output: [] } },
      ...items.flatMap((item, output_index) => [
        { type: 'response.output_item.added', output_index, item: { ...item, ...(item.type === 'message' ? { content: [], status: 'in_progress' } : {}) } },
        { type: 'response.output_item.done', output_index, item },
      ]),
      completed,
    ]
    return new Response(
      events.map((ev) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`).join(''),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )
  }

  await withMockFetch(
    async (_url, init, _body, capturedList) => {
      if (new Headers(init?.headers).has('idempotency-key')) {
        const compactEvent = {
          type: 'response.completed',
          response: {
            id: 'cmp_tenant_a',
            object: 'response.compaction',
            status: 'completed',
            output: [{ type: 'compaction', encrypted_content: 'COMPACT_TENANT_A_OPAQUE' }],
            usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 },
          },
        }
        return new Response(
          `event: response.completed\ndata: ${JSON.stringify(compactEvent)}\n\n`,
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        )
      }
      return capturedList.length === 1
        ? sseTenantTurn1()
        : new Response(
            `event: response.completed\ndata: ${JSON.stringify({
              type: 'response.completed',
              response: {
                id: 'resp_tenant_next',
                object: 'response',
                status: 'completed',
                model: 'gpt-6.2-sol',
                output: [
                  {
                    type: 'message',
                    id: 'msg_tenant_next',
                    role: 'assistant',
                    status: 'completed',
                    content: [{ type: 'output_text', text: 'done', annotations: [] }],
                  },
                ],
                usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
              },
            })}\n\n`,
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          )
    },
    async (captured) => {
      const ctx = makeTenantCtx()
      const tenantRoute = routeWithPolicies(
        resolveResponsesRouteConfig(ctx, { provider: 'openai', model: 'gpt-6.2-sol' }, {}),
        { gatewayCompatibilityFallback: false },
      )
      const collectStream = async (stream) => {
        const chunks = []
        for await (const c of stream) chunks.push(c)
        assert.equal(chunks.at(-1)?.reason?.kind, 'stop')
        return chunks
      }

      // 1) Initial turn under tenant-a stamps headerAuthorityFingerprint
      const t1Chunks = []
      for await (const c of managedResponsesStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId,
          tools: [makeTool('probe_tool')],
          messages: [{ id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'start' }] }],
        },
        tenantRoute,
        ctx,
      )) {
        t1Chunks.push(c)
      }
      const t1Finish = t1Chunks.find((c) => c.type === 'finish')
      assert.equal(
        t1Finish?.replayState?.lcxReplay?.headerAuthorityFingerprint,
        requestHeaderAuthorityFingerprint({ 'x-tenant': 'tenant-a' }, { apiKeyEnv: 'TEST_LCX_API_KEY', effectiveAuthorization: 'Bearer sk-test-token' }),
      )

      const historyMessages = [
        { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'start' }] },
        {
          id: 'a1',
          role: 'assistant',
          source: { kind: 'model', provider: 'openai', model: 'gpt-6.2-sol', replayState: t1Finish.replayState },
          content: t1Chunks.filter((c) => c.type === 'block-end').map((c) => structuredClone(c.block)),
        },
        {
          id: 't1',
          role: 'tool',
          source: { kind: 'tool', callId: 'call_tenant_a_1|fc_tenant_a_1' },
          toolCallId: 'call_tenant_a_1|fc_tenant_a_1',
          content: [{ type: 'text', text: 'ok' }],
        },
        { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'continue' }] },
      ]

      // 2) Same tenant-a keeps native encrypted reasoning + raw fc_*
      await collectStream(
        managedResponsesStream(
          { provider: 'openai', model: 'gpt-6.2-sol', sessionId, tools: [makeTool('probe_tool')], messages: historyMessages },
          tenantRoute,
          ctx,
        ),
      )
      const sameTenantReq = captured.at(-1)
      assert.equal(new Headers(sameTenantReq.init.headers).get('x-tenant'), 'tenant-a')
      assert.ok(sameTenantReq.body.input.some((item) => item?.type === 'reasoning' && item.encrypted_content === 'OPAQUE_TENANT_A_BLOB'))
      assert.ok(sameTenantReq.body.input.some((item) => item?.type === 'function_call' && item.id === 'fc_tenant_a_1'))

      // 3) Switching to tenant-b (and removing x-tenant) degrades to portable replay on identical session/model/baseURL
      for (const nextTenant of ['tenant-b', null]) {
        activeTenant = nextTenant
        await collectStream(
          managedResponsesStream(
            { provider: 'openai', model: 'gpt-6.2-sol', sessionId, tools: [makeTool('probe_tool')], messages: historyMessages },
            tenantRoute,
            ctx,
          ),
        )
        const nextReq = captured.at(-1)
        assert.equal(new Headers(nextReq.init.headers).get('x-tenant'), nextTenant)
        assert.equal(
          nextReq.body.input.some((item) => item?.type === 'reasoning' || 'encrypted_content' in (item ?? {})),
          false,
          `tenant=${String(nextTenant)} must not replay opaque reasoning`,
        )
        assert.equal(
          nextReq.body.input.some((item) => item?.type === 'function_call' && item.id === 'fc_tenant_a_1'),
          false,
          `tenant=${String(nextTenant)} must hash fc_tenant_a_1`,
        )
        assert.ok(nextReq.body.input.some((item) => item?.type === 'message' && item.role === 'assistant' && item.phase === 'commentary'))
      }

      // 4) Native V2 compaction checkpoint binds headerAuthorityFingerprint and fails closed on tenant switch
      activeTenant = 'tenant-a'
      const shadowedSeq = fakeSession.append(
        'user/message',
        { role: 'user', id: 'u_shadow', source: { kind: 'user' }, content: [{ type: 'text', text: 'shadowed secret question' }] },
        { surfaceOp: 'append' },
      ).seq
      fakeSession.append('compaction/start', { compactionId: 'cmp_tenant_a', turn: null })
      const compactChunks = await collectStream(
        remoteCompactionStream(
          {
            provider: 'openai',
            model: 'gpt-6.2-sol',
            sessionId,
            messages: [
              { id: 'u_shadow', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'shadowed secret question' }] },
              { role: 'user', content: [{ type: 'text', text: 'compact now' }] },
            ],
          },
          tenantRoute,
          ctx,
          async () => (async function* () { throw new Error('fallback should not run') })(),
        ),
      )
      const realCompactBlock = compactChunks.find((c) => c.type === 'block-end' && c.block?.type === 'lcx-native-compaction-v5')?.block
      assert.ok(realCompactBlock)
      const tenantACredAuth = { apiKeyEnv: 'TEST_LCX_API_KEY', effectiveAuthorization: 'Bearer sk-test-token' }
      assert.equal(realCompactBlock.headerAuthorityFingerprint, requestHeaderAuthorityFingerprint({ 'x-tenant': 'tenant-a' }, tenantACredAuth))

      fakeSession.append('compaction/summary', {
        compactionId: 'cmp_tenant_a',
        shadowedSeqs: [shadowedSeq],
        shadowedRange: { start: shadowedSeq, end: shadowedSeq },
        shadowedTokenCount: 8,
        summary: 'compact summary',
        provider: 'openai',
        model: 'gpt-6.2-sol',
        rawOutput: [{ type: 'text', text: 'compact summary' }, realCompactBlock],
      })
      fakeSession.append('compaction/end', { compactionId: 'cmp_tenant_a', turn: null })

      const checkpointMessages = [
        {
          id: 'cmp-msg-1',
          role: 'user',
          source: { kind: 'compact-checkpoint', compactionId: 'cmp_tenant_a' },
          content: [{ type: 'text', text: 'compact summary' }],
        },
        { id: 'u3', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'after compact' }] },
      ]

      // Direct checkpoint compatibility check across tenants
      assert.equal(
        stateRouteCompatible(
          {
            version: 5,
            provider: 'openai',
            model: 'gpt-6.2-sol',
            baseURLFingerprint: baseURLFingerprint(gatewayBaseURL),
            sourceSessionId: sessionId,
            headerAuthorityFingerprint: requestHeaderAuthorityFingerprint({ 'x-tenant': 'tenant-a' }, tenantACredAuth),
          },
          {
            provider: 'openai',
            model: 'gpt-6.2-sol',
            baseURL: gatewayBaseURL,
            sessionId,
            headerAuthorityFingerprint: requestHeaderAuthorityFingerprint({ 'x-tenant': 'tenant-a' }, tenantACredAuth),
          },
          ctx,
        ),
        true,
      )
      assert.equal(
        stateRouteCompatible(
          {
            version: 5,
            provider: 'openai',
            model: 'gpt-6.2-sol',
            baseURLFingerprint: baseURLFingerprint(gatewayBaseURL),
            sourceSessionId: sessionId,
            headerAuthorityFingerprint: requestHeaderAuthorityFingerprint({ 'x-tenant': 'tenant-a' }, tenantACredAuth),
          },
          {
            provider: 'openai',
            model: 'gpt-6.2-sol',
            baseURL: gatewayBaseURL,
            sessionId,
            headerAuthorityFingerprint: requestHeaderAuthorityFingerprint({ 'x-tenant': 'tenant-b' }, tenantACredAuth),
          },
          ctx,
        ),
        false,
      )

      // End-to-end stream with persisted checkpoint message under tenant-a vs tenant-b
      activeTenant = 'tenant-a'
      await collectStream(
        managedResponsesStream(
          { provider: 'openai', model: 'gpt-6.2-sol', sessionId, tools: [makeTool('probe_tool')], messages: checkpointMessages },
          tenantRoute,
          ctx,
        ),
      )
      assert.ok(
        captured.at(-1).body.input.some((item) => item?.type === 'compaction' && item.encrypted_content === 'COMPACT_TENANT_A_OPAQUE'),
        'matching tenant-a must keep native compaction item',
      )

      activeTenant = 'tenant-b'
      await collectStream(
        managedResponsesStream(
          { provider: 'openai', model: 'gpt-6.2-sol', sessionId, tools: [makeTool('probe_tool')], messages: checkpointMessages },
          tenantRoute,
          ctx,
        ),
      )
      const switchedCompactBody = captured.at(-1).body
      assert.equal(
        JSON.stringify(switchedCompactBody.input).includes('COMPACT_TENANT_A_OPAQUE'),
        false,
        'tenant-b switch must drop native compaction checkpoint and degrade to portable messages',
      )
      assert.equal(
        switchedCompactBody.input.some((item) => JSON.stringify(item).includes('shadowed secret question')),
        true,
      )
    },
  )
})

test('Astra regression: executeHostedSearch omits session-id and prompt_cache_key when cacheRetention is none', async () => {
  const ctx = makeMockCtx({
    providers: {
      openai: {
        baseURL: 'https://api.openai.com/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        cacheRetention: 'none',
      },
    },
  })
  const searchRoute = routeWithPolicies(
    resolveResponsesRouteConfig(ctx, { provider: 'openai', model: 'gpt-6.2-sol' }, { cacheRetention: 'none' }),
    { promptCacheKeyMode: 'auto', gatewayCompatibilityFallback: false },
  )
  await withMockFetch(
    async () =>
      new Response(
        JSON.stringify({
          id: 'resp_hs_no_cache',
          status: 'completed',
          output: [
            { type: 'web_search_call', id: 'ws_hs_nc', status: 'completed', action: { type: 'search', query: 'privacy check', sources: [] } },
            { type: 'message', id: 'msg_hs_nc', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'ok', annotations: [] }] },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    async (captured) => {
      await executeHostedSearch(ctx, searchRoute, { query: 'privacy check' }, undefined, 'sess-hosted-no-cache')
      assert.equal(captured.length, 1)
      const hdrs = new Headers(captured[0].init.headers)
      assert.equal(hdrs.get('session-id'), null)
      assert.equal(hdrs.get('x-session-id'), null)
      assert.match(hdrs.get('x-client-request-id') ?? '', /^[0-9a-f-]{16,}$/i)
      assert.equal('prompt_cache_key' in captured[0].body, false)
    },
  )
})

test('Astra regression: throwing ctx.logger.warn inside recordGrokBudgetWarning does not abort managedGrokNativeSearchStream', async () => {
  const ctx = makeMockCtx({
    providers: {
      xai: {
        baseURL: 'https://api.x.ai/v1',
        apiKeyEnv: 'TEST_LCX_API_KEY',
        defaultContextWindow: 200_000,
        models: [{ id: 'grok-4.7', maxTokens: 500_000 }],
      },
    },
  })
  ctx.logger.warn = () => {
    throw new Error('logger sink failed')
  }
  const grokRoute = resolveGrokResponsesRouteConfig(ctx, { provider: 'xai', model: 'grok-4.7' }, {})
  await withMockFetch(
    async () => sseCompletedResponse('resp_grok_logger_throw', 'still ok', 'grok-4.7'),
    async () => {
      const chunks = []
      for await (const c of managedGrokNativeSearchStream(
        {
          provider: 'xai',
          model: 'grok-4.7',
          sessionId: 'sess-grok-warn-throw',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        },
        grokRoute,
        { web: true, x: false },
        ctx,
      )) {
        chunks.push(c)
      }
      assert.equal(chunks.at(-1)?.reason?.kind, 'stop')
    },
  )
})

test('Astra Round-5 regression: effective credential authority, explicit empty-header persistence, and Grok prompt validation order', async () => {
  const gatewayBaseURL = 'https://credential-gateway.invalid/v1'
  const sessionId = 'sess-round5-cred-auth'
  const secrets = {
    KEY_A: 'sk-account-alpha-secret',
    KEY_B: 'sk-account-beta-secret',
  }
  let activeEnv = 'KEY_A'
  const makeJwtWithAccount = (acct, jti) => {
    const hdr = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const pay = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: acct }, jti })).toString('base64url')
    return `${hdr}.${pay}.sig`
  }

  const realSession = Session.create(SessionId(sessionId))
  const credResolve = async (ref) => {
    const env = typeof ref === 'string' ? ref : ref?.env ?? ref?.name ?? ref?.id ?? activeEnv
    const val = secrets[env]
    return val ? { value: val } : undefined
  }
  const makeExactCredCtx = () =>
    makeMockCtx({
      providers: {
        openai: {
          baseURL: gatewayBaseURL,
          get apiKeyEnv() {
            return activeEnv
          },
        },
      },
      credentials: { resolve: credResolve },
      sessions: { get: (id) => (String(id) === sessionId ? realSession : undefined) },
      get: (name) =>
        name === 'sessionQuery'
          ? { observeSession: async () => ({ events: realSession.snapshotEvents(), [Symbol.dispose]: () => {} }) }
          : undefined,
    })

  const sseTurn1 = () =>
    new Response(
      [
        `event: response.completed\ndata: ${JSON.stringify({
          type: 'response.completed',
          response: {
            id: 'resp_cred_1',
            object: 'response',
            status: 'completed',
            model: 'gpt-6.2-sol',
            output: [
              { type: 'reasoning', id: 'rs_cred_1', summary: [{ type: 'summary_text', text: 'acct thought' }], encrypted_content: 'OPAQUE_ACCOUNT_ALPHA' },
              { type: 'message', id: 'msg_cred_1', role: 'assistant', phase: 'commentary', status: 'completed', content: [{ type: 'output_text', text: 'acct answer', annotations: [] }] },
              { type: 'function_call', id: 'fc_cred_1', call_id: 'call_cred_1', status: 'completed', name: 'probe_tool', arguments: '{"query":"a"}' },
            ],
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          },
        })}\n\n`,
      ].join(''),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )

  await withMockFetch(
    async (_url, init, _body, captured) => {
      if (new Headers(init?.headers).has('idempotency-key')) {
        return new Response(
          `event: response.completed\ndata: ${JSON.stringify({
            type: 'response.completed',
            response: {
              id: 'cmp_cred_1',
              object: 'response.compaction',
              status: 'completed',
              output: [{ type: 'compaction', encrypted_content: 'COMPACT_ACCOUNT_ALPHA' }],
              usage: { input_tokens: 6, output_tokens: 2, total_tokens: 8 },
            },
          })}\n\n`,
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        )
      }
      if (captured.length === 1) return sseTurn1()
      return sseCompletedResponse('resp_cred_next', 'ok', 'gpt-6.2-sol')
    },
    async (captured) => {
      const ctx = makeExactCredCtx()
      const routeA = routeWithPolicies(resolveResponsesRouteConfig(ctx, { provider: 'openai', model: 'gpt-6.2-sol' }, {}), { gatewayCompatibilityFallback: false })
      const t1Chunks = []
      for await (const c of managedResponsesStream(
        { provider: 'openai', model: 'gpt-6.2-sol', sessionId, tools: [makeTool('probe_tool')], messages: [{ id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }] },
        routeA,
        ctx,
      )) {
        t1Chunks.push(c)
      }
      const t1Finish = t1Chunks.find((c) => c.type === 'finish')
      const fpA = t1Finish?.replayState?.lcxReplay?.headerAuthorityFingerprint
      assert.ok(typeof fpA === 'string' && fpA.length > 0, 'empty-header turn stamps explicit headerAuthorityFingerprint')
      assert.equal(JSON.stringify(t1Finish.replayState).includes('sk-account-alpha-secret'), false)

      const historyMsgs = [
        { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] },
        { id: 'a1', role: 'assistant', source: { kind: 'model', provider: 'openai', model: 'gpt-6.2-sol', replayState: t1Finish.replayState }, content: t1Chunks.filter((c) => c.type === 'block-end').map((c) => structuredClone(c.block)) },
        { id: 't1', role: 'tool', source: { kind: 'tool', callId: 'call_cred_1|fc_cred_1' }, toolCallId: 'call_cred_1|fc_cred_1', content: [{ type: 'text', text: 'ok' }] },
        { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] },
      ]

      // 1a) Switching apiKeyEnv (KEY_A -> KEY_B) invalidates native reasoning
      activeEnv = 'KEY_B'
      const routeB = routeWithPolicies(resolveResponsesRouteConfig(ctx, { provider: 'openai', model: 'gpt-6.2-sol' }, {}), { gatewayCompatibilityFallback: false })
      for await (const c of managedResponsesStream({ provider: 'openai', model: 'gpt-6.2-sol', sessionId, tools: [makeTool('probe_tool')], messages: historyMsgs }, routeB, ctx)) void c
      assert.equal(captured.at(-1).body.input.some((item) => item?.type === 'reasoning' || 'encrypted_content' in (item ?? {})), false, 'switching apiKeyEnv must invalidate native replay')

      // 1b) Rotating static Bearer credential under the SAME apiKeyEnv (KEY_A) invalidates native reasoning
      activeEnv = 'KEY_A'
      secrets.KEY_A = 'sk-account-alpha-rotated-secret'
      for await (const c of managedResponsesStream({ provider: 'openai', model: 'gpt-6.2-sol', sessionId, tools: [makeTool('probe_tool')], messages: historyMsgs }, routeA, ctx)) void c
      assert.equal(captured.at(-1).body.input.some((item) => item?.type === 'reasoning' || 'encrypted_content' in (item ?? {})), false, 'rotating static Bearer key under same apiKeyEnv must invalidate native replay')

      // 1c) ChatGPT OAuth JWT: same chatgpt_account_id token refresh stays compatible; different chatgpt_account_id invalidates
      secrets.KEY_OAUTH = makeJwtWithAccount('acct-111', 'jti-1')
      activeEnv = 'KEY_OAUTH'
      const oauthCtx = makeMockCtx({
        providers: { openai: { baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'KEY_OAUTH' } },
        credentials: { resolve: credResolve },
      })
      const oauthRoute = routeWithPolicies(resolveResponsesRouteConfig(oauthCtx, { provider: 'openai', model: 'gpt-6.2-sol' }, {}), { gatewayCompatibilityFallback: false })
      const oauthChunks = []
      for await (const c of managedResponsesStream(
        { provider: 'openai', model: 'gpt-6.2-sol', sessionId: 'sess-oauth-acct', messages: [{ id: 'uo1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }] },
        oauthRoute,
        oauthCtx,
      )) {
        oauthChunks.push(c)
      }
      const oauthReplay = oauthChunks.find((c) => c.type === 'finish')?.replayState
      const oauthMsgs = [
        { id: 'uo1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] },
        { id: 'ao1', role: 'assistant', source: { kind: 'model', provider: 'openai', model: 'gpt-6.2-sol', replayState: { ...oauthReplay, lcxReplay: { ...oauthReplay.lcxReplay, sourceSessionId: 'sess-oauth-acct' } } }, content: [{ type: 'reasoning', text: 'acct thought' }, { type: 'text', text: 'acct answer' }] },
        { id: 'uo2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] },
      ]
      // Give assistant encrypted reasoning signature from turn 1
      oauthMsgs[1].source.replayState.blocks = [
        { type: 'reasoning', thinkingSignature: JSON.stringify({ type: 'reasoning', id: 'rs_oa', encrypted_content: 'OAUTH_ENC_1' }) },
        { type: 'text' },
      ]
      secrets.KEY_OAUTH = makeJwtWithAccount('acct-111', 'jti-2')
      for await (const _ of managedResponsesStream({ provider: 'openai', model: 'gpt-6.2-sol', sessionId: 'sess-oauth-acct', messages: oauthMsgs }, oauthRoute, oauthCtx)) void _
      assert.equal(captured.at(-1).body.input.some((item) => item?.type === 'reasoning' && item.encrypted_content === 'OAUTH_ENC_1'), true, 'same-account OAuth token refresh keeps native replay')
      secrets.KEY_OAUTH = makeJwtWithAccount('acct-222', 'jti-3')
      for await (const _ of managedResponsesStream({ provider: 'openai', model: 'gpt-6.2-sol', sessionId: 'sess-oauth-acct', messages: oauthMsgs }, oauthRoute, oauthCtx)) void _
      assert.equal(captured.at(-1).body.input.some((item) => item?.type === 'reasoning' || 'encrypted_content' in (item ?? {})), false, 'cross-account OAuth switch invalidates native replay')

      // 2) Explicit empty-header checkpoint persistence & legacy unstamped checkpoint/replay portable degradation
      activeEnv = 'KEY_B'
      const shadowedSeq = realSession.append('user/message', { role: 'user', id: 'u_leg_shadow', source: { kind: 'user' }, content: [{ type: 'text', text: 'shadowed legacy content' }] }, { surfaceOp: 'append' }).seq
      realSession.append('compaction/start', { compactionId: 'cmp_explicit_empty', turn: null })
      const cmpChunks = []
      for await (const c of remoteCompactionStream(
        {
          provider: 'openai',
          model: 'gpt-6.2-sol',
          sessionId,
          messages: [
            { id: 'u_leg_shadow', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'shadowed legacy content' }] },
            { role: 'user', content: [{ type: 'text', text: 'compact' }] },
          ],
        },
        routeB,
        ctx,
        async () => (async function* () { throw new Error('fallback unused') })(),
      )) {
        cmpChunks.push(c)
      }
      const explicitEmptyBlock = cmpChunks.find((c) => c.type === 'block-end' && c.block?.type === 'lcx-native-compaction-v5')?.block
      assert.ok(typeof explicitEmptyBlock?.headerAuthorityFingerprint === 'string' && explicitEmptyBlock.headerAuthorityFingerprint.length > 0, 'empty-header checkpoint must explicitly persist headerAuthorityFingerprint')
      assert.equal(JSON.stringify(explicitEmptyBlock).includes('sk-account-beta-secret'), false)

      // Legacy V5 checkpoint lacking headerAuthorityFingerprint degrades safely to portable replay without throwing LCX_CHECKPOINT_UNSUPPORTED
      realSession.append('compaction/start', { compactionId: 'cmp_legacy_no_fp', turn: null })
      realSession.append('compaction/summary', {
        compactionId: 'cmp_legacy_no_fp',
        shadowedSeqs: [shadowedSeq],
        shadowedRange: { start: shadowedSeq, end: shadowedSeq },
        shadowedTokenCount: 5,
        summary: 'legacy compact',
        provider: 'openai',
        model: 'gpt-6.2-sol',
        rawOutput: [
          { type: 'text', text: 'legacy compact' },
          {
            type: 'lcx-native-compaction-v5',
            version: 5,
            compactionId: 'cmp_legacy_no_fp',
            provider: 'openai',
            model: 'gpt-6.2-sol',
            baseURLFingerprint: baseURLFingerprint(gatewayBaseURL),
            sourceSessionId: sessionId,
            nativeOutput: [{ type: 'compaction', encrypted_content: 'COMPACT_LEGACY_UNSTAMPED' }],
            retainedInputCount: 0,
            retainedClientCount: 0,
            retainedAssistantCount: 0,
          },
        ],
      })
      realSession.append('compaction/end', { compactionId: 'cmp_legacy_no_fp', turn: null })
      const legacyCkptMsgs = [
        { id: 'cmp-leg', role: 'user', source: { kind: 'compact-checkpoint', compactionId: 'cmp_legacy_no_fp' }, content: [{ type: 'text', text: 'legacy compact' }] },
        { id: 'u-after-leg', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'continue' }] },
      ]
      const legacyRespChunks = []
      for await (const c of managedResponsesStream({ provider: 'openai', model: 'gpt-6.2-sol', sessionId, tools: [makeTool('probe_tool')], messages: legacyCkptMsgs }, routeB, ctx)) {
        legacyRespChunks.push(c)
      }
      assert.equal(legacyRespChunks.at(-1)?.reason?.kind, 'stop')
      const legacyWireJson = JSON.stringify(captured.at(-1).body.input)
      assert.equal(legacyWireJson.includes('COMPACT_LEGACY_UNSTAMPED'), false, 'legacy V5 checkpoint missing headerAuthorityFingerprint must not replay opaque compaction')
      assert.equal(legacyWireJson.includes('shadowed legacy content'), true, 'legacy V5 checkpoint must degrade to portable shadowed messages')

      // Legacy lcxReplay lacking headerAuthorityFingerprint also degrades to portable replay on empty-header route
      const { headerAuthorityFingerprint: _omitFp, ...legacyLcxReplay } = t1Finish.replayState.lcxReplay
      const legacyMsgHistory = structuredClone(historyMsgs)
      legacyMsgHistory[1].source.replayState.lcxReplay = legacyLcxReplay
      for await (const c of managedResponsesStream({ provider: 'openai', model: 'gpt-6.2-sol', sessionId, tools: [makeTool('probe_tool')], messages: legacyMsgHistory }, routeB, ctx)) void c
      assert.equal(captured.at(-1).body.input.some((item) => item?.type === 'reasoning' || 'encrypted_content' in (item ?? {})), false)
    },
  )

  // 3) Grok native search rejects unresolved in-history mid-history prompt snapshot BEFORE resolveApiKey and header hooks
  let grokCredCalls = 0
  let grokHookCalls = 0
  const grokBrokenCtx = makeMockCtx({
    providers: { xai: { baseURL: 'https://api.x.ai/v1', apiKeyEnv: 'XAI_FIXTURE_KEY', models: [{ id: 'grok-4.7' }] } },
    credentials: { resolve: async () => { grokCredCalls += 1; return { value: 'sk-grok-never-called' } } },
    waterfall(_ev, _req, _h, next) { grokHookCalls += 1; return next() },
    llm: {
      listConfigurableProviders: () => [{ provider: 'xai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'xai'] }],
      fileRequestText: () => '[file]',
      resolveModelInfo: async () => { throw new Error('model registry unavailable') },
    },
  })
  const grokBrokenRoute = resolveGrokResponsesRouteConfig(grokBrokenCtx, { provider: 'xai', model: 'grok-4.7' }, {})
  await withMockFetch(
    async () => { throw new Error('network must not run') },
    async () => {
      const chunks = []
      for await (const c of managedGrokNativeSearchStream(
        {
          provider: 'xai',
          model: 'grok-4.7',
          sessionId: 'sess-grok-mid-snapshot',
          messages: [
            { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] },
            { id: 's2', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'mid-history prompt update' }] },
          ],
        },
        grokBrokenRoute,
        { web: true, x: false },
        grokBrokenCtx,
      )) {
        chunks.push(c)
      }
      const finish = chunks.at(-1)
      assert.equal(finish?.reason?.kind, 'error')
      assert.equal(finish?.reason?.failure?.code, 'NO_ADAPTER')
      assert.match(finish?.reason?.failure?.message ?? '', /model information.*in-history system prompt updates/u)
      assert.equal(grokCredCalls, 0)
      assert.equal(grokHookCalls, 0)
    },
  )
})
