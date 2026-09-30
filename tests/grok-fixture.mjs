import apply from '../lib/index.js'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import { pluginConfig, providerContext } from './dsh02-fixture.mjs'

export const xaiProfile = {
  api: 'openai-responses',
  baseURL: 'https://gateway.example/v1',
  apiKeyEnv: 'XAI_FIXTURE_KEY',
  headers: { 'x-fixture-route': 'xai' },
  maxRequestImageBytes: 20_000_000,
  requestImagePixelBudget: 40_000_000,
  requestImageMaxBytes: 4_000_000,
  models: [{
    id: 'grok-4.6',
    reasoningEfforts: { high: 'gateway-high' },
  }],
}

export const functionTools = [
  { name: 'web_search', description: 'DSH search', parameters: { type: 'object', properties: {} } },
  { name: 'websearch_gpt_advanced', description: 'GPT hosted search', parameters: { type: 'object', properties: {} } },
  { name: 'websearch_alpha', description: 'GPT Alpha search', parameters: { type: 'object', properties: {} } },
  { name: 'web_fetch', description: 'Fetch URL', parameters: { type: 'object', properties: {} } },
  { name: 'workspace_read', description: 'Read workspace', parameters: { type: 'object', properties: {} } },
]

export function user(text, content = [{ type: 'text', text }]) {
  return { role: 'user', source: { kind: 'user' }, content }
}

export function sseResponse(events) {
  const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

export async function collect(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

export function grokHarness({
  enabled = false,
  nativeWeb = false,
  nativeX = false,
  profiles = { xai: xaiProfile },
} = {}) {
  const handlers = new Map()
  const logs = []
  const imageOptions = []
  const modelInfoRequests = []
  const config = pluginConfig({ enabled, grokNativeWebSearch: nativeWeb, grokNativeXSearch: nativeX, maxAttempts: 1 })
  const provider = providerContext(profiles)
  const ctx = {
    logger: { info(message) { logs.push(message) }, warn() {} },
    sessions: { get: () => undefined },
    credentials: { resolve: async () => ({ value: 'synthetic-test-key' }) },
    llm: {
      ...provider.llm,
      resolveModelInfo: async (provider, model) => {
        modelInfoRequests.push({ provider, model })
        return {
          inputModalities: ['text', 'image'],
          context: { contextWindow: 500000 },
        }
      },
      fileRequestText: () => 'file fixture',
    },
    attachments: {
      imageHostPath: () => 'D:/synthetic/image.png',
      async readImageRequest(ref, options) {
        imageOptions.push(options)
        return { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', attachment: ref, bytes: 3, width: 1, height: 1 }
      },
    },
    fs: { processPathFromHostPath: path => path },
    web: { searchProviderId: 'native', registerSearchProvider() {} },
    tools: { register: () => () => {} },
    settings: { ...provider.settings, configure: () => () => {} },
    on(event, handler) { handlers.set(event, handler) },
    inject() {},
    get(name) { return ctx[name] },
    effect() {},
  }
  apply(ctx, config)
  return {
    ctx, handlers, logs, imageOptions, modelInfoRequests,
    stream: handlers.get('llm/stream'),
    setMediaPreview(value) {
      updateVolatile(config.searchMediaPreview, pluginConfig({ searchMediaPreview: Boolean(value) }).searchMediaPreview)
      handlers.get('loader/volatile-update')()
    },
  }
}
