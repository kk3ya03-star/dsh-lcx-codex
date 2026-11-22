import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { apply as applyPi, Config as PiConfig } from '@deepseek-ai/dsh-llm-pi-ai'
import { SettingsForms } from '@deepseek-ai/dsh-settings'
import { streamSimple as piStreamSimple } from '@earendil-works/pi-ai/api/openai-responses'
import { loadHostSource } from './wp2-source.mjs'

const [route, catalog, runtime, requestMod, compactMod, dshResponsesMod] = await Promise.all([
  loadHostSource('route'),
  loadHostSource('model-catalog'),
  loadHostSource('pi-responses-runtime'),
  loadHostSource('responses-request'),
  loadHostSource('compact-v2'),
  loadHostSource('dsh-responses'),
])
const { resolveCatalogModel } = catalog
const { getCatalogModels, clampOpenAIPromptCacheKey } = runtime
const { buildResponsesBody, configurationUpdateEffort, isChatGPTSignInCredential } = requestMod
const { buildNativeCompactionBody } = compactMod
const { resolvePiResponsesModel } = dshResponsesMod
const {
  resolveResponsesRouteConfig,
  resolveGrokResponsesRouteConfig,
  isGrokModelId,
  promptCacheSessionId,
  promptCacheKey,
  promptCacheRetention,
  prepareRequestHeaders,
  authenticatedHeaders,
  authenticatedGrokHeaders,
  diagnoseGrokProfileBudget,
  diagnoseGrokContextBudget,
  diagnoseGrokContextBudgetAsync,
} = route

function makeRealDshContext(profiles, { secrets = {}, sessions = new Map(), waterfall } = {}) {
  const ctx = new Context()
  ctx.provide('loader', { await: () => Promise.resolve() }, true)
  ctx.provide('profileContext', { home: 'unused' }, true)
  ctx.provide('credentials', {
    resolve: async ref => {
      const key = String(ref?.id ?? ref ?? '')
      const value = secrets[key]
      return value === undefined ? undefined : { value }
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
  ctx.sessions = { get: id => sessions.get(String(id)) }
  if (waterfall) ctx.waterfall = waterfall
  return ctx
}

function makeRouteCtx(profiles, { secrets = {}, sessions = new Map(), namespace = 'llm-pi-ai', waterfall } = {}) {
  return {
    credentials: {
      resolve: async ref => {
        const key = String(ref?.id ?? ref ?? '')
        const value = secrets[key]
        return value === undefined ? undefined : { value }
      },
    },
    sessions: {
      get: id => sessions.get(String(id)),
    },
    llm: {
      listConfigurableProviders: () => Object.keys(profiles).map(provider => ({
        provider,
        displayName: provider,
        settingsNs: namespace,
        settingsPath: ['providers', provider],
      })),
    },
    settings: {
      describe: () => [{ ns: namespace, value: { providers: profiles } }],
    },
    ...(waterfall ? { waterfall } : {}),
  }
}

async function capturePiWireRequest(modelOverride, options, { preserveBaseUrl = false } = {}) {
  let captured = null
  if (preserveBaseUrl) {
    const baseModel = resolveCatalogModel('openai', 'gpt-5.4', true).descriptor
    const model = {
      ...baseModel,
      ...modelOverride,
      compat: { ...(baseModel.compat ?? {}), ...(modelOverride.compat ?? {}) },
    }
    const stream = piStreamSimple(model, { messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }] }, {
      apiKey: options.apiKey ?? 'sk-pi-test',
      maxRetries: 0,
      ...options,
      fetch: async (_url, init) => {
        captured = {
          headers: Object.fromEntries(new Headers(init.headers)),
          body: JSON.parse(String(init.body)),
        }
        return new Response(
          `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_probe', status: 'completed', output: [] } })}\n\n`,
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        )
      },
    })
    for await (const _ of stream) {
      // drain
    }
    return captured
  }
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      captured = {
        headers: { ...req.headers },
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'probe capture', type: 'invalid_request_error' } }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const baseModel = resolveCatalogModel('openai', 'gpt-5.4', true).descriptor
    const model = {
      ...baseModel,
      ...modelOverride,
      baseUrl: `http://127.0.0.1:${port}/v1`,
      compat: { ...(baseModel.compat ?? {}), ...(modelOverride.compat ?? {}) },
    }
    const stream = piStreamSimple(
      model,
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'probe' }], timestamp: Date.now() }] },
      { apiKey: 'sk-test-probe', ...options },
    )
    for await (const _event of stream) {
      // Drain until terminal error event from 400 probe response.
    }
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
  assert.ok(captured, 'expected HTTP request captured from Pi 1.6.0 streamSimple')
  return captured
}

test('WP1: authenticatedHeaders & authenticatedGrokHeaders align session-id with Pi 1.6.0', async () => {
  const secretEnv = 'LCX_ISSUE131_KEY'
  const ctx = makeRouteCtx({}, { secrets: { [secretEnv]: 'sk-issue131' } })
  const sessionId = 'session-131-alpha'

  // Live wire capture from real Pi 1.6.0 streamSimple on default OpenAI Responses affinity
  const piDefault = await capturePiWireRequest(
    { provider: 'openai', id: 'gpt-5.4' },
    { sessionId, cacheRetention: 'short' },
  )
  assert.equal(piDefault.headers['session-id'], sessionId)
  assert.equal(piDefault.headers.session_id, undefined)
  assert.equal(piDefault.headers['x-client-request-id'], sessionId)

  const gptHeaders = await authenticatedHeaders(
    ctx,
    { provider: 'openai', model: 'gpt-5.4', api: 'openai-responses', baseURL: 'https://api.openai.com/v1', apiKeyEnv: secretEnv, headers: {}, cacheRetention: 'short' },
    sessionId,
    undefined,
  )
  assert.equal(gptHeaders['session-id'], piDefault.headers['session-id'])
  assert.equal(gptHeaders.session_id, undefined)
  assert.equal(gptHeaders['x-client-request-id'], piDefault.headers['x-client-request-id'])

  // OpenRouter affinity uses x-session-id only
  const piOpenRouter = await capturePiWireRequest(
    { provider: 'openrouter', id: 'gpt-5.4', compat: { sessionAffinityFormat: 'openrouter' } },
    { sessionId, cacheRetention: 'short' },
  )
  assert.equal(piOpenRouter.headers['x-session-id'], sessionId)
  assert.equal(piOpenRouter.headers['session-id'], undefined)
  assert.equal(piOpenRouter.headers.session_id, undefined)

  const openrouterHeaders = await authenticatedHeaders(
    ctx,
    { provider: 'openrouter', model: 'gpt-5.4', api: 'openai-responses', baseURL: 'https://openrouter.ai/api/v1', apiKeyEnv: secretEnv, headers: {}, cacheRetention: 'short' },
    sessionId,
    undefined,
  )
  assert.equal(openrouterHeaders['x-session-id'], sessionId)
  assert.equal(openrouterHeaders['session-id'], undefined)
  assert.equal(openrouterHeaders.session_id, undefined)
  assert.equal(openrouterHeaders['x-client-request-id'], undefined)

  // openai-nosession affinity omits session-id/session_id/x-session-id while keeping correlation
  const nosessionHeaders = await authenticatedHeaders(
    ctx,
    {
      provider: 'openai',
      model: 'gpt-5.4',
      api: 'openai-responses',
      baseURL: 'https://api.openai.com/v1',
      apiKeyEnv: secretEnv,
      headers: {},
      cacheRetention: 'short',
      responsesCompat: { sessionAffinityFormat: 'openai-nosession' },
    },
    sessionId,
    undefined,
  )
  assert.equal(nosessionHeaders['session-id'], undefined)
  assert.equal(nosessionHeaders.session_id, undefined)
  assert.equal(nosessionHeaders['x-session-id'], undefined)
  assert.equal(nosessionHeaders['x-client-request-id'], sessionId)

  // Grok path emits session-id & x-client-request-id too
  const grokHeaders = await authenticatedGrokHeaders(
    ctx,
    { provider: 'xai', model: 'grok-4.7', api: 'openai-responses', baseURL: 'https://api.x.ai/v1', apiKeyEnv: secretEnv, headers: {}, cacheRetention: 'short' },
    sessionId,
  )
  assert.equal(grokHeaders['session-id'], sessionId)
  assert.equal(grokHeaders.session_id, undefined)
  assert.equal(grokHeaders['x-client-request-id'], sessionId)
})

test('WP1: OWNER_PROTECTED_HEADERS blocks contributor spoofing while allowing explicit profile Session-Id', async () => {
  const secretEnv = 'LCX_ISSUE131_WATERFALL_KEY'
  const ctx = makeRouteCtx(
    {},
    {
      secrets: { [secretEnv]: 'sk-real-secret' },
      waterfall: (_hook, _req, initial) => {
        const next = new Headers(initial)
        next.set('authorization', 'Bearer sk-spoofed')
        next.set('session-id', 'spoof-hyphen')
        next.set('session_id', 'spoof-under')
        next.set('x-session-id', 'spoof-x')
        next.set('x-client-request-id', 'spoof-corr')
        next.set('x-opencode-session', 'spoof-opencode')
        next.set('x-contributor-custom', 'kept')
        return next
      },
    },
  )

  const headers = await authenticatedHeaders(
    ctx,
    {
      provider: 'opencode',
      model: 'gpt-6.2-sol',
      api: 'openai-responses',
      baseURL: 'https://opencode.ai/zen/v1',
      apiKeyEnv: secretEnv,
      headers: {},
      cacheRetention: 'short',
    },
    'root-session',
    'req-corr',
    {},
    'child-session',
  )
  assert.equal(headers.authorization, 'Bearer sk-real-secret')
  assert.equal(headers['session-id'], 'root-session')
  assert.equal(headers.session_id, undefined)
  assert.equal(headers['x-session-id'], undefined)
  assert.equal(headers['x-client-request-id'], 'req-corr')
  assert.equal(headers['x-opencode-session'], 'child-session')
  assert.equal(headers['x-contributor-custom'], 'kept')

  // Case-insensitive explicit Session-Id in profile overrides generated session-id without duplication
  const explicitCaseHeaders = await authenticatedHeaders(
    ctx,
    {
      provider: 'openai',
      model: 'gpt-6.2-sol',
      api: 'openai-responses',
      baseURL: 'https://api.openai.com/v1',
      apiKeyEnv: secretEnv,
      headers: { 'Session-Id': 'custom-session-override' },
      cacheRetention: 'short',
    },
    'root-session',
    undefined,
  )
  const matchingKeys = Object.keys(explicitCaseHeaders).filter(k => k.toLowerCase() === 'session-id')
  assert.deepEqual(matchingKeys, ['Session-Id'])
  assert.equal(explicitCaseHeaders['Session-Id'], 'custom-session-override')
})

test('WP1: LCX promptCacheKeyMode override & real DSH catalog resolver reject invalid profile compat while keeping session affinity and retention', async () => {
  const sessionId = 'session-cache-mode-123'
  // Prove real @deepseek-ai/dsh-llm-pi-ai rejects compat.promptCacheKeyMode on llm-pi-ai profiles
  const invalidDshCtx = makeRealDshContext({
    openai: {
      baseURL: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      compat: { promptCacheKeyMode: 'disabled' },
    },
  }, { secrets: { OPENAI_API_KEY: 'sk-cache-test' } })
  await new Promise(resolve => setTimeout(resolve, 20))
  await assert.rejects(
    () => invalidDshCtx.llm.resolveModelInfo('openai', 'gpt-6.2-sol'),
    /promptCacheKeyMode/u,
    'DSH must reject unoffered compat.promptCacheKeyMode on llm-pi-ai profiles',
  )

  // Real DSH-valid profiles (using offered compat.supportsLongCacheRetention only)
  const ctx = makeRealDshContext({
    openai: {
      baseURL: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      cacheRetention: 'long',
      compat: { supportsLongCacheRetention: true },
    },
    xai: {
      baseURL: 'https://api.x.ai/v1',
      apiKeyEnv: 'XAI_API_KEY',
    },
    mockedCompatProvider: {
      api: 'openai-responses',
      baseURL: 'https://example.invalid/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
    },
  }, { secrets: { OPENAI_API_KEY: 'sk-cache-test', XAI_API_KEY: 'xai-cache-test' } })
  await new Promise(resolve => setTimeout(resolve, 20))
  const resolvedDshInfo = await ctx.llm.resolveModelInfo('openai', 'gpt-6.2-sol')
  assert.equal(resolvedDshInfo.id, 'gpt-6.2-sol')

  const disabledRoute = resolveResponsesRouteConfig(ctx, { provider: 'openai', model: 'gpt-6.2-sol' }, { promptCacheKeyMode: 'disabled' })
  assert.ok(disabledRoute)
  assert.equal(disabledRoute.responsesCompat?.promptCacheKeyMode, 'disabled')
  assert.equal(disabledRoute.cacheRetention, 'long')
  assert.equal(promptCacheKey({ sessionId }, disabledRoute, ctx), undefined)
  assert.equal(promptCacheSessionId({ sessionId }, disabledRoute, ctx), sessionId)
  // gpt-6.2-sol uses explicit prompt cache mode, so legacy promptCacheRetention stays undefined;
  // on gpt-5.4 (legacy retention model), promptCacheKeyMode=disabled still preserves 24h retention.
  assert.equal(promptCacheRetention(disabledRoute), undefined)
  const disabledLegacyRoute = resolveResponsesRouteConfig(ctx, { provider: 'openai', model: 'gpt-5.4' }, { promptCacheKeyMode: 'disabled' })
  assert.ok(disabledLegacyRoute)
  assert.equal(disabledLegacyRoute.responsesCompat?.promptCacheKeyMode, 'disabled')
  assert.equal(disabledLegacyRoute.cacheRetention, 'long')
  assert.equal(promptCacheKey({ sessionId }, disabledLegacyRoute, ctx), undefined)
  assert.equal(promptCacheRetention(disabledLegacyRoute), '24h')

  const disabledHeaders = await authenticatedHeaders(ctx, disabledRoute, sessionId, undefined)
  assert.equal(disabledHeaders['session-id'], sessionId)

  // Live Pi 1.6.0 streamSimple parity: promptCacheKeyMode=disabled drops prompt_cache_key from body but sends session-id header
  const piDisabled = await capturePiWireRequest(
    { provider: 'openai', id: 'gpt-5.4', compat: { promptCacheKeyMode: 'disabled' } },
    { sessionId, cacheRetention: 'short' },
  )
  assert.equal(piDisabled.body.prompt_cache_key, undefined)
  assert.equal(piDisabled.headers['session-id'], sessionId)

  // Enabled and auto emit clamped cache keys; cacheRetention=none still suppresses both key and session affinity
  const longId = 'p'.repeat(80)
  assert.equal(promptCacheKey({ sessionId: longId }, { cacheRetention: 'short', responsesCompat: { promptCacheKeyMode: 'enabled' } }), clampOpenAIPromptCacheKey(longId))
  assert.equal(promptCacheKey({ sessionId }, { cacheRetention: 'short', responsesCompat: { promptCacheKeyMode: 'auto' } }), sessionId)
  assert.equal(promptCacheKey({ sessionId }, { cacheRetention: 'none', responsesCompat: { promptCacheKeyMode: 'enabled' } }), undefined)

  // Grok route picks up LCX-owned promptCacheKeyMode override too
  const grokDisabled = resolveGrokResponsesRouteConfig(ctx, { provider: 'xai', model: 'grok-4.7' }, { promptCacheKeyMode: 'disabled' })
  assert.ok(grokDisabled)
  assert.equal(grokDisabled.responsesCompat?.promptCacheKeyMode, 'disabled')
  assert.equal(promptCacheKey({ sessionId }, grokDisabled, ctx), undefined)

  // Even if a synthetic non-DSH mock context carries compat.promptCacheKeyMode on a profile, LCX ignores it
  const syntheticCtx = makeRouteCtx({
    bogus: { api: 'openai-responses', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'OPENAI_API_KEY', compat: { promptCacheKeyMode: 'disabled' } },
  }, { secrets: { OPENAI_API_KEY: 'sk-cache-test' } })
  const ignoredProfileCompat = resolveResponsesRouteConfig(syntheticCtx, { provider: 'bogus', model: 'gpt-6.2-astra' }, { promptCacheKeyMode: 'auto' })
  assert.ok(ignoredProfileCompat)
  assert.equal(ignoredProfileCompat.responsesCompat?.promptCacheKeyMode, undefined)
  assert.equal(promptCacheKey({ sessionId }, ignoredProfileCompat, syntheticCtx), sessionId)
})

test('P1-6: explicit cacheRetention="long" on supported GPT routes (gpt-6.2-sol) matches Pi 1.6.0 while omitted retention stays "short"', async () => {
  const ctx = makeRealDshContext({
    openai: {
      baseURL: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      cacheRetention: 'long',
    },
    opencode: {
      baseURL: 'https://opencode.ai/zen/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
    },
  }, { secrets: { OPENAI_API_KEY: 'sk-cache-test' } })
  await new Promise(resolve => setTimeout(resolve, 20))

  const longRoute = resolveResponsesRouteConfig(ctx, { provider: 'openai', model: 'gpt-6.2-sol' }, {})
  assert.ok(longRoute)
  assert.equal(longRoute.supportsLongCacheRetention, true)
  assert.equal(longRoute.cacheRetention, 'long')
  const lcxBody = buildResponsesBody({
    model: { id: 'gpt-6.2-sol', provider: 'openai', reasoning: true, compat: longRoute.responsesCompat },
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    sessionId: 'sess-p16',
    promptCacheRetention: promptCacheRetention(longRoute),
    cacheRetention: longRoute.cacheRetention,
  })
  assert.equal(lcxBody.prompt_cache_retention, undefined)
  assert.deepEqual(lcxBody.prompt_cache_options, { ttl: '30m' })

  const compactBody = buildNativeCompactionBody({
    model: 'gpt-6.2-sol',
    modelDescriptor: { id: 'gpt-6.2-sol', provider: 'openai', reasoning: true, compat: longRoute.responsesCompat },
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    promptCacheKey: 'sess-p16',
    promptCacheRetention: promptCacheRetention(longRoute),
    cacheRetention: longRoute.cacheRetention,
  })
  assert.deepEqual(compactBody.prompt_cache_options, { ttl: '30m' })

  // Pi 1.6.0 live wire parity for cacheRetention: 'long' on gpt-6.2-sol
  const piLong = await capturePiWireRequest(
    { provider: 'openai', id: 'gpt-6.2-sol', compat: { supportsExplicitPromptCacheMode: true } },
    { sessionId: 'sess-p16', cacheRetention: 'long' },
  )
  assert.deepEqual(piLong.body.prompt_cache_options, { ttl: '30m' })

  // Inverse case: missing cacheRetention defaults to 'short' and omits prompt_cache_options/prompt_cache_retention
  const defaultRoute = resolveResponsesRouteConfig(ctx, { provider: 'opencode', model: 'gpt-6.2-sol' }, {})
  assert.ok(defaultRoute)
  assert.equal(defaultRoute.supportsLongCacheRetention, true)
  assert.equal(defaultRoute.cacheRetention, 'short')
  assert.equal(promptCacheRetention(defaultRoute), undefined)
  const defaultBody = buildResponsesBody({
    model: { id: 'gpt-6.2-sol', provider: 'opencode', reasoning: true, compat: defaultRoute.responsesCompat },
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    sessionId: 'sess-p16-short',
    cacheRetention: defaultRoute.cacheRetention,
  })
  assert.equal(defaultBody.prompt_cache_retention, undefined)
  assert.equal(defaultBody.prompt_cache_options, undefined)
})

test('P1-7: ChatGPT Sign-In suppresses prompt_cache_retention, prompt_cache_options, max_output_tokens, and temperature matching Pi 1.6.0', async () => {
  const oauthToken = 'chatgpt-oauth-session-token'
  const gptModel = {
    id: 'gpt-6.2-sol',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reasoning: true,
    compat: { supportsExplicitPromptCacheMode: true, supportsLongCacheRetention: true, supportsMaxOutputTokens: true },
  }
  assert.equal(isChatGPTSignInCredential(gptModel, oauthToken), true)
  assert.equal(isChatGPTSignInCredential(gptModel, 'sk-real-key'), false)
  assert.equal(isChatGPTSignInCredential({ provider: 'openai', baseUrl: 'https://proxy.example/v1' }, oauthToken), false)

  const piWire = await capturePiWireRequest(
    { provider: 'openai', id: 'gpt-6.2-sol', baseUrl: 'https://api.openai.com/v1', compat: { supportsExplicitPromptCacheMode: true } },
    { sessionId: 'sess-chatgpt', cacheRetention: 'long', apiKey: oauthToken, temperature: 0.4, maxTokens: 512 },
    { preserveBaseUrl: true },
  )
  assert.equal('prompt_cache_retention' in piWire.body, false)
  assert.equal('prompt_cache_options' in piWire.body, false)
  assert.equal('max_output_tokens' in piWire.body, false)
  assert.equal('temperature' in piWire.body, false)
  assert.equal(piWire.body.prompt_cache_key, 'sess-chatgpt')

  const lcxBody = buildResponsesBody({
    model: gptModel,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    sessionId: 'sess-chatgpt',
    cacheRetention: 'long',
    temperature: 0.4,
    maxTokens: 512,
    apiKey: oauthToken,
  })
  assert.equal('prompt_cache_retention' in lcxBody, false)
  assert.equal('prompt_cache_options' in lcxBody, false)
  assert.equal('max_output_tokens' in lcxBody, false)
  assert.equal('temperature' in lcxBody, false)
  assert.equal(lcxBody.prompt_cache_key, 'sess-chatgpt')

  const compactBody = buildNativeCompactionBody({
    model: 'gpt-6.2-sol',
    modelDescriptor: gptModel,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    promptCacheKey: 'sess-chatgpt',
    cacheRetention: 'long',
    temperature: 0.4,
    maxTokens: 512,
    apiKey: oauthToken,
  })
  assert.equal('prompt_cache_retention' in compactBody, false)
  assert.equal('prompt_cache_options' in compactBody, false)
  assert.equal('max_output_tokens' in compactBody, false)
  assert.equal('temperature' in compactBody, false)
})

test('P1-9 & P2-3: authenticatedGrokHeaders runs request-header contributors and prepareRequestHeaders overwrites mixed-case profile aliases', async () => {
  let receivedRequest
  const ctx = makeRouteCtx(
    {
      xai: {
        baseURL: 'https://api.x.ai/v1',
        apiKeyEnv: 'XAI_KEY',
        headers: { 'X-Ext': 'a', 'x-ext': 'b', 'User-Agent': 'ignored-ua' },
      },
    },
    {
      secrets: { XAI_KEY: 'xai-secret' },
      waterfall: (_name, request, headers) => {
        receivedRequest = request
        assert.equal(headers.get('x-ext'), 'b', 'sequential Headers.set must overwrite mixed-case profile aliases without joining')
        const next = new Headers(headers)
        next.set('x-gateway-token', 'gw-123')
        next.set('authorization', 'Bearer spoofed')
        next.set('session-id', 'spoofed-sid')
        next.set('x-client-request-id', 'spoofed-cid')
        return next
      },
    },
  )
  const routeCfg = resolveGrokResponsesRouteConfig(ctx, { provider: 'xai', model: 'grok-4.7' }, {})
  assert.ok(routeCfg)

  const gptPrepared = prepareRequestHeaders(ctx, { ...routeCfg, headers: { 'X-Ext': 'a', 'x-ext': 'b' } }, { sessionId: 's-1' })
  assert.equal(gptPrepared['x-ext'], 'b')

  const grokHeaders = await authenticatedGrokHeaders(ctx, routeCfg, 'grok-sess', {}, 'grok-sess', { sessionId: 'grok-sess', purpose: 'web-search' })
  assert.deepEqual(receivedRequest, {
    provider: 'xai',
    model: 'grok-4.7',
    baseURL: 'https://api.x.ai/v1',
    sessionId: 'grok-sess',
    purpose: 'web-search',
  })
  assert.equal(grokHeaders['x-ext'], 'b')
  assert.equal(grokHeaders['x-gateway-token'], 'gw-123')
  assert.equal(grokHeaders.authorization, 'Bearer xai-secret')
  assert.equal(grokHeaders['session-id'], 'grok-sess')
  assert.equal(grokHeaders['x-client-request-id'], 'grok-sess')
  assert.notEqual(grokHeaders['user-agent'], 'ignored-ua')

  let seenXApiKey
  let seenApiKey
  const grokApiKeyCtx = makeRouteCtx(
    {
      xai: {
        baseURL: 'https://api.x.ai/v1',
        apiKeyEnv: 'XAI_KEY',
        headers: { 'X-Api-Key': 'xai-profile-key', 'Api-Key': 'api-profile-key', 'x-custom': 'keep' },
      },
    },
    {
      secrets: { XAI_KEY: 'xai-secret' },
      waterfall: (_name, _request, headers) => {
        seenXApiKey = headers.get('x-api-key')
        seenApiKey = headers.get('api-key')
        assert.equal(headers.get('x-custom'), 'keep')
        const next = new Headers(headers)
        next.set('x-api-key', 'spoofed-x-api-key')
        next.set('api-key', 'spoofed-api-key')
        return next
      },
    },
  )
  const grokKeyCfg = resolveGrokResponsesRouteConfig(grokApiKeyCtx, { provider: 'xai', model: 'grok-4.7' }, {})
  const grokKeyHeaders = await authenticatedGrokHeaders(grokApiKeyCtx, grokKeyCfg, 'grok-sess-key', {}, 'grok-sess-key')
  const normalizedGrokKeyHeaders = new Headers(grokKeyHeaders)
  assert.equal(seenXApiKey, null)
  assert.equal(seenApiKey, null)
  assert.equal(normalizedGrokKeyHeaders.get('x-api-key'), 'xai-profile-key')
  assert.equal(normalizedGrokKeyHeaders.get('api-key'), 'api-profile-key')
  assert.equal(normalizedGrokKeyHeaders.get('x-custom'), 'keep')
})

test('WP1: Pi 1.6.0 catalog additions and github-copilot grok strictMode delta resolve cleanly', () => {
  const gpt62Providers = ['cloudflare-ai-gateway', 'github-copilot', 'openai', 'opencode']
  for (const provider of gpt62Providers) {
    const ids = new Set(getCatalogModels(provider).filter(m => m.api === 'openai-responses').map(m => m.id))
    assert.ok(ids.has('gpt-6.2-sol'), `${provider} missing gpt-6.2-sol`)
    assert.ok(ids.has('gpt-6.2-astra'), `${provider} missing gpt-6.2-astra`)
    for (const modelId of ['gpt-6.2-sol', 'gpt-6.2-astra']) {
      const resolved = resolveCatalogModel(provider, modelId, true)
      assert.equal(resolved.source, 'catalog-model', `${provider}/${modelId}`)
      assert.equal(resolved.api, 'openai-responses', `${provider}/${modelId}`)
    }
  }

  assert.equal(resolveCatalogModel('openai', 'gpt-6-cyber', true).source, 'catalog-model')
  assert.equal(resolveCatalogModel('openai', 'gpt-6-cyber', true).api, 'openai-responses')

  const ctx = makeRouteCtx({
    openai: { baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY' },
    'github-copilot': { baseURL: 'https://api.githubcopilot.com', apiKeyEnv: 'COPILOT_API_KEY' },
  })
  for (const model of ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6-cyber']) {
    const routeConfig = resolveResponsesRouteConfig(ctx, { provider: 'openai', model }, {}, true)
    assert.ok(routeConfig, `openai/${model} should resolve`)
    assert.equal(routeConfig.api, 'openai-responses')
  }

  for (const grokModel of ['grok-4.5', 'grok-4.6', 'grok-4.7']) {
    const entry = resolveCatalogModel('github-copilot', grokModel, true)
    assert.equal(entry.descriptor?.compat?.supportsStrictMode, true, `github-copilot/${grokModel} strictMode`)
    assert.equal(entry.descriptor?.compat?.supportsOpenAIGrammarTools, undefined, `github-copilot/${grokModel} grammar`)
    const grokRoute = resolveGrokResponsesRouteConfig(ctx, { provider: 'github-copilot', model: grokModel }, {})
    assert.ok(grokRoute, `github-copilot/${grokModel} route`)
    assert.equal(grokRoute.responsesCompat?.supportsStrictMode, true)
    assert.equal(grokRoute.responsesCompat?.supportsOpenAIGrammarTools, undefined)
  }
})

test('WP3.3: diagnoseGrokProfileBudget & diagnoseGrokContextBudget catch MODEL_SWITCH_COMPACTION_FAILED budgets', async () => {
  // Exact discovered xAI shape from DSH 0.2.2-rc.5: contextWindow=500000, maxTokens=500000
  const equalCtx = makeRouteCtx({
    xai: {
      baseURL: 'https://api.x.ai/v1',
      apiKeyEnv: 'XAI_API_KEY',
      apiKey: 'sk-should-never-appear-in-diagnostic',
      models: [{ id: 'grok-4.6', contextWindow: 500000, maxTokens: 500000 }],
    },
  })
  const equalDiag = diagnoseGrokContextBudget(equalCtx, { provider: 'xai', model: 'grok-4.6' })
  assert.ok(equalDiag)
  assert.match(equalDiag, /MODEL_SWITCH_COMPACTION_FAILED/u)
  assert.match(equalDiag, /xai\/grok-4\.6/u)
  assert.match(equalDiag, /maxTokens \(500000\) >= contextWindow \(500000\)/u)
  assert.doesNotMatch(equalDiag, /sk-should-never-appear|api\.x\.ai/u)

  // maxTokens > contextWindow via catalog contextWindow fallback (models[] omits contextWindow)
  const greaterCatalogDiag = diagnoseGrokProfileBudget(
    { models: [{ id: 'grok-4.7', maxTokens: 600000 }] },
    { provider: 'xai', model: 'grok-4.7' },
  )
  assert.ok(greaterCatalogDiag)
  assert.match(greaterCatalogDiag, /maxTokens \(600000\) >= contextWindow \(500000\)/u)

  // Custom uncatalogued Grok model falls back to profile.contextWindow / profile.defaultContextWindow
  const defaultWindowDiag = diagnoseGrokProfileBudget(
    { defaultContextWindow: 256000, models: [{ id: 'grok-custom', maxTokens: 256000 }] },
    { provider: 'xai', model: 'grok-custom' },
  )
  assert.ok(defaultWindowDiag)
  assert.match(defaultWindowDiag, /xai\/grok-custom/u)
  assert.match(defaultWindowDiag, /256000/u)

  // modelOverrides applies when models[] is absent or empty
  const overrideDiag = diagnoseGrokProfileBudget(
    { models: [], defaultContextWindow: 500000, modelOverrides: { 'grok-4.7': { maxTokens: 500000 } } },
    { provider: 'xai', model: 'grok-4.7' },
  )
  assert.ok(overrideDiag)
  assert.match(overrideDiag, /MODEL_SWITCH_COMPACTION_FAILED/u)

  // DSH ignores unused top-level profile.maxTokens / profile.contextWindow -> must NOT trigger warning
  assert.equal(
    diagnoseGrokProfileBudget(
      { maxTokens: 500000, defaultContextWindow: 500000 },
      { provider: 'xai', model: 'grok-4.6' },
    ),
    undefined,
  )

  // Qualified Grok IDs on non-xai providers (e.g. openrouter + x-ai/grok-4.7) ARE detected
  const openRouterSyncDiag = diagnoseGrokProfileBudget(
    { models: [{ id: 'x-ai/grok-4.7', contextWindow: 500000, maxTokens: 500000 }] },
    { provider: 'openrouter', model: 'x-ai/grok-4.7' },
  )
  assert.ok(openRouterSyncDiag)
  assert.match(openRouterSyncDiag, /openrouter\/x-ai\/grok-4\.7/u)

  // Custom non-Grok model under xai profile MUST NOT trigger Grok budget warning
  assert.equal(
    diagnoseGrokProfileBudget(
      { models: [{ id: 'gpt-test', contextWindow: 128000, maxTokens: 128000 }] },
      { provider: 'xai', model: 'gpt-test' },
    ),
    undefined,
  )

  // Request maxTokens precedence matches dsh-compaction-basic reservedCompletionTokens
  assert.equal(
    diagnoseGrokProfileBudget(
      { models: [{ id: 'grok-4.7', contextWindow: 500000, maxTokens: 500000 }] },
      { provider: 'xai', model: 'grok-4.7' },
      { requestMaxTokens: 64000 },
    ),
    undefined,
  )
  const requestCapDiag = diagnoseGrokProfileBudget(
    { models: [{ id: 'grok-4.7', contextWindow: 500000 }] },
    { provider: 'xai', model: 'grok-4.7' },
    { requestMaxTokens: 500000 },
  )
  assert.ok(requestCapDiag)

  // Async host resolution via ctx.llm.resolveModelInfo catches openrouter/x-ai/grok-4.7 when profile omits contextWindow
  const asyncOpenRouterCtx = makeRouteCtx({
    openrouter: {
      baseURL: 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      models: [{ id: 'x-ai/grok-4.7', maxTokens: 500000 }],
    },
  })
  asyncOpenRouterCtx.llm.resolveModelInfo = async () => ({
    provider: 'openrouter',
    id: 'x-ai/grok-4.7',
    context: { contextWindow: 500000 },
    defaultMaxTokens: 500000,
  })
  const asyncDiag = await diagnoseGrokContextBudgetAsync(asyncOpenRouterCtx, {
    provider: 'openrouter',
    model: 'x-ai/grok-4.7',
  })
  assert.ok(asyncDiag)
  assert.match(asyncDiag, /openrouter\/x-ai\/grok-4\.7/u)
  assert.equal(
    await diagnoseGrokContextBudgetAsync(asyncOpenRouterCtx, {
      provider: 'openrouter',
      model: 'x-ai/grok-4.7',
    }, { requestMaxTokens: 64000 }),
    undefined,
  )

  // Non-xai provider running a Grok model id is covered too
  const copilotGrokDiag = diagnoseGrokProfileBudget(
    { modelOverrides: { 'grok-4.7': { contextWindow: 128000, maxTokens: 128000 } } },
    { provider: 'github-copilot', model: 'grok-4.7' },
  )
  assert.ok(copilotGrokDiag)
  assert.match(copilotGrokDiag, /github-copilot\/grok-4\.7/u)

  // Valid budgets and non-matching cases return undefined
  assert.equal(
    diagnoseGrokProfileBudget({ models: [{ id: 'grok-4.7', contextWindow: 500000, maxTokens: 128000 }] }, { provider: 'xai', model: 'grok-4.7' }),
    undefined,
  )
  // DSH SettingsForms defaultMaxTokens alone (without models[].maxTokens / modelOverrides) is ignored by resolveRouteModels -> no false positive
  assert.equal(
    diagnoseGrokProfileBudget({ defaultContextWindow: 500000, defaultMaxTokens: 500000 }, { provider: 'xai', model: 'grok-4.7' }),
    undefined,
  )
  assert.equal(
    diagnoseGrokProfileBudget({ defaultContextWindow: 1000000, defaultMaxTokens: 128000 }, { provider: 'xai', model: 'grok-4.7' }),
    undefined,
  )
  // Excluded by nonempty models[] -> undefined
  assert.equal(
    diagnoseGrokProfileBudget({ maxTokens: 500000, defaultContextWindow: 500000, models: [{ id: 'grok-4.6', contextWindow: 500000, maxTokens: 64000 }] }, { provider: 'xai', model: 'grok-4.7' }),
    undefined,
  )
  // Missing / non-positive / non-finite bounds -> undefined
  assert.equal(diagnoseGrokProfileBudget({ models: [{ id: 'grok-4.7', contextWindow: 500000, maxTokens: 0 }] }, { provider: 'xai', model: 'grok-4.7' }), undefined)
  assert.equal(diagnoseGrokProfileBudget({ models: [{ id: 'grok-4.7', contextWindow: 500000, maxTokens: Number.NaN }] }, { provider: 'xai', model: 'grok-4.7' }), undefined)
  // Non-Grok route -> undefined even if provider profile looks overloaded
  assert.equal(
    diagnoseGrokProfileBudget({ models: [{ id: 'gpt-6.2-sol', contextWindow: 128000, maxTokens: 128000 }] }, { provider: 'openai', model: 'gpt-6.2-sol' }),
    undefined,
  )
  // Wrong settings namespace or missing ctx -> undefined
  const wrongNsCtx = makeRouteCtx({ xai: { models: [{ id: 'grok-4.6', contextWindow: 500000, maxTokens: 500000 }] } }, { namespace: 'other-plugin' })
  assert.equal(diagnoseGrokContextBudget(wrongNsCtx, { provider: 'xai', model: 'grok-4.6' }), undefined)
  assert.equal(diagnoseGrokContextBudget(undefined, { provider: 'xai', model: 'grok-4.6' }), undefined)
})

test('P2-B, P2-C, P2-D & P3-A: Grok long retention default, trailing-slash Sign-In parity, unified Grok IDs, and 4-field profile compat gate', async () => {
  // P2-B: Undeclared supportsLongCacheRetention defaults to true (Pi 1.6.0 parity), preserving long retention when requested,
  // defaulting omitted retention to "short", and respecting explicit compat false downgrade.
  const customLongCtx = makeRouteCtx({
    xai: {
      api: 'openai-responses',
      baseURL: 'https://api.x.ai/v1',
      apiKeyEnv: 'SYNTHETIC_KEY',
      cacheRetention: 'long',
      models: [{ id: 'grok-custom' }],
    },
  })
  const grokCustomLong = resolveGrokResponsesRouteConfig(customLongCtx, { provider: 'xai', model: 'grok-custom' }, {})
  assert.equal(grokCustomLong.supportsLongCacheRetention, true)
  assert.equal(grokCustomLong.cacheRetention, 'long')

  const customOmittedCtx = makeRouteCtx({
    xai: {
      api: 'openai-responses',
      baseURL: 'https://api.x.ai/v1',
      apiKeyEnv: 'SYNTHETIC_KEY',
      models: [{ id: 'grok-custom' }],
    },
  })
  const grokCustomOmitted = resolveGrokResponsesRouteConfig(customOmittedCtx, { provider: 'xai', model: 'grok-custom' }, {})
  assert.equal(grokCustomOmitted.supportsLongCacheRetention, true)
  assert.equal(grokCustomOmitted.cacheRetention, 'short')

  const customOptOutCtx = makeRouteCtx({
    xai: {
      api: 'openai-responses',
      baseURL: 'https://api.x.ai/v1',
      apiKeyEnv: 'SYNTHETIC_KEY',
      cacheRetention: 'long',
      compat: { supportsLongCacheRetention: false },
      models: [{ id: 'grok-custom' }],
    },
  })
  const grokOptOut = resolveGrokResponsesRouteConfig(customOptOutCtx, { provider: 'xai', model: 'grok-custom' }, {})
  assert.equal(grokOptOut.supportsLongCacheRetention, false)
  assert.equal(grokOptOut.cacheRetention, 'short')

  // P2-C & Round 5 P2-9: DSH/Pi literal `https://api.openai.com/v1` parity (rawBaseURL preserved on model.baseUrl while route.baseURL stays transport-normalized)
  const literalDirectModel = {
    id: 'gpt-6-sol',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    compat: { supportsMidConvoEffort: true, supportsLongCacheRetention: true, supportsMaxOutputTokens: true },
    thinkingLevelMap: { high: 'high' },
  }
  const slashConfiguredCtx = makeRouteCtx({
    openai: {
      api: 'openai-responses',
      baseURL: 'https://api.openai.com/v1/',
      apiKeyEnv: 'OPENAI_API_KEY',
    },
  })
  const slashResolved = resolveResponsesRouteConfig(slashConfiguredCtx, { provider: 'openai', model: 'gpt-6.2-sol' }, {})
  assert.equal(slashResolved.baseURL, 'https://api.openai.com/v1')
  assert.equal(slashResolved.rawBaseURL, 'https://api.openai.com/v1/')
  const slashPiModel = resolvePiResponsesModel({ imageSupport: 'supported', route: slashResolved, responsesCompat: slashResolved.responsesCompat })
  assert.equal(slashPiModel.baseUrl, 'https://api.openai.com/v1/')

  assert.equal(isChatGPTSignInCredential(literalDirectModel, 'oauth-token'), true)
  assert.equal(isChatGPTSignInCredential(slashPiModel, 'oauth-token'), false)
  assert.equal(
    await configurationUpdateEffort(literalDirectModel, 'high', async () => 'oauth-token'),
    undefined,
  )
  assert.equal(
    await configurationUpdateEffort(literalDirectModel, 'high', async () => 'sk-api-key'),
    'high',
  )
  assert.equal(
    await configurationUpdateEffort({ ...literalDirectModel, baseUrl: 'https://api.openai.com/v1/' }, 'high', async () => 'oauth-token'),
    'high',
  )
  // Upstream Pi 1.6.0 wire parity on trailing-slash URL vs literal https://api.openai.com/v1 with non-sk- token
  const piSlashWire = await capturePiWireRequest(
    { provider: 'openai', id: 'gpt-6.2-sol', baseUrl: 'https://api.openai.com/v1/', compat: { supportsExplicitPromptCacheMode: true, supportsMidConvoEffort: true } },
    { sessionId: 'sess-slash', cacheRetention: 'long', apiKey: 'oauth-token', temperature: 0.4, maxTokens: 512 },
    { preserveBaseUrl: true },
  )
  const lcxSlashBody = buildResponsesBody({
    model: slashPiModel,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    sessionId: 'sess-slash',
    cacheRetention: 'long',
    temperature: 0.4,
    maxTokens: 512,
    apiKey: 'oauth-token',
  })
  assert.equal(piSlashWire.body.max_output_tokens, 512)
  assert.equal(lcxSlashBody.max_output_tokens, 512)
  assert.equal(piSlashWire.body.temperature, 0.4)
  assert.equal(lcxSlashBody.temperature, 0.4)
  assert.equal('prompt_cache_options' in piSlashWire.body || 'prompt_cache_retention' in piSlashWire.body, true)
  assert.equal('prompt_cache_options' in lcxSlashBody || 'prompt_cache_retention' in lcxSlashBody, true)

  let proxyKeyCalls = 0
  assert.equal(
    await configurationUpdateEffort(
      { ...literalDirectModel, baseUrl: 'https://relay.example/v1' },
      'high',
      async () => {
        proxyKeyCalls += 1
        return 'oauth-token'
      },
    ),
    'high',
  )
  assert.equal(proxyKeyCalls, 0)

  // Round 5 P2-10: PI_CACHE_RETENTION=long env fallback honored when profile & capability cacheRetention are omitted (subject to supportsLongCacheRetention)
  const prevPiCacheRetention = process.env.PI_CACHE_RETENTION
  try {
    process.env.PI_CACHE_RETENTION = 'long'
    const envCtx = makeRouteCtx({
      opencode: { api: 'openai-responses', apiKeyEnv: 'OPENCODE_API_KEY' },
      xai: { api: 'openai-responses', baseURL: 'https://api.x.ai/v1', apiKeyEnv: 'XAI_API_KEY', models: [{ id: 'grok-custom' }, { id: 'grok-4.7' }] },
    })
    assert.equal(resolveResponsesRouteConfig(envCtx, { provider: 'opencode', model: 'gpt-6.2-sol' }, {}).cacheRetention, 'long')
    assert.equal(resolveGrokResponsesRouteConfig(envCtx, { provider: 'xai', model: 'grok-custom' }, {}).cacheRetention, 'long')
    // Catalog xai/grok-4.7 sets supportsLongCacheRetention: false, so PI_CACHE_RETENTION=long still clamps to short
    assert.equal(resolveGrokResponsesRouteConfig(envCtx, { provider: 'xai', model: 'grok-4.7' }, {}).cacheRetention, 'short')

    const explicitShortCtx = makeRouteCtx({
      opencode: { api: 'openai-responses', apiKeyEnv: 'OPENCODE_API_KEY', cacheRetention: 'short' },
      xai: { api: 'openai-responses', baseURL: 'https://api.x.ai/v1', apiKeyEnv: 'XAI_API_KEY', compat: { supportsLongCacheRetention: false }, models: [{ id: 'grok-custom' }] },
    })
    assert.equal(resolveResponsesRouteConfig(explicitShortCtx, { provider: 'opencode', model: 'gpt-6.2-sol' }, {}).cacheRetention, 'short')
    assert.equal(resolveGrokResponsesRouteConfig(explicitShortCtx, { provider: 'xai', model: 'grok-custom' }, {}).cacheRetention, 'short')
  } finally {
    if (prevPiCacheRetention === undefined) delete process.env.PI_CACHE_RETENTION
    else process.env.PI_CACHE_RETENTION = prevPiCacheRetention
  }

  // P2-D & P2-4: Unified Grok model ID predicate matches x-ai/grok-4.7 & grokCustom while rejecting agrok-4.7 & vendor/grokking
  assert.equal(isGrokModelId('grok-4.7'), true)
  assert.equal(isGrokModelId('x-ai/grok-4.7'), true)
  assert.equal(isGrokModelId('grokCustom'), true)
  assert.equal(isGrokModelId('agrok-4.7'), false)
  assert.equal(isGrokModelId('vendor/grokking'), false)
  assert.equal(isGrokModelId('grokking'), false)
  const openRouterResponsesCtx = makeRouteCtx({
    openrouter: {
      api: 'openai-responses',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      models: [{ id: 'x-ai/grok-4.7' }, { id: 'agrok-4.7' }, { id: 'vendor/grokking', contextWindow: 128000, maxTokens: 128000 }],
    },
  })
  assert.ok(resolveGrokResponsesRouteConfig(openRouterResponsesCtx, { provider: 'openrouter', model: 'x-ai/grok-4.7' }, {}))
  assert.equal(resolveGrokResponsesRouteConfig(openRouterResponsesCtx, { provider: 'openrouter', model: 'agrok-4.7' }, {}), undefined)
  assert.equal(resolveGrokResponsesRouteConfig(openRouterResponsesCtx, { provider: 'openrouter', model: 'vendor/grokking' }, {}), undefined)
  assert.equal(diagnoseGrokContextBudget(openRouterResponsesCtx, { provider: 'openrouter', model: 'vendor/grokking' }), undefined)

  // P3-A: Only DSH RESPONSES_COMPAT_GATE's 4 offered fields are accepted from profile.compat / modelOverrides.compat
  const compatGateCtx = makeRouteCtx({
    relay: {
      api: 'openai-responses',
      baseURL: 'https://relay.example/v1',
      apiKeyEnv: 'SYNTHETIC_KEY',
      compat: {
        supportsDeveloperRole: false,
        supportsMaxOutputTokens: false,
        supportsStrictMode: false,
        supportsLongCacheRetention: false,
        supportsAdditionalTools: true,
        supportsToolSearch: true,
        supportsOpenAIGrammarTools: true,
        supportsExplicitPromptCacheMode: true,
        sessionAffinityFormat: 'openrouter',
      },
      models: [{ id: 'gpt-6-sol' }],
    },
  })
  const gatedRoute = resolveResponsesRouteConfig(compatGateCtx, { provider: 'relay', model: 'gpt-6-sol' }, {})
  assert.equal(gatedRoute.responsesCompat.supportsDeveloperRole, false)
  assert.equal(gatedRoute.responsesCompat.supportsMaxOutputTokens, false)
  assert.equal(gatedRoute.responsesCompat.supportsStrictMode, false)
  assert.equal(gatedRoute.responsesCompat.supportsLongCacheRetention, false)
  assert.equal(gatedRoute.responsesCompat.supportsAdditionalTools, undefined)
  assert.equal(gatedRoute.responsesCompat.supportsToolSearch, undefined)
  assert.equal(gatedRoute.responsesCompat.supportsOpenAIGrammarTools, undefined)
  assert.equal(gatedRoute.responsesCompat.supportsExplicitPromptCacheMode, undefined)
  assert.equal(gatedRoute.responsesCompat.sessionAffinityFormat, undefined)
})
