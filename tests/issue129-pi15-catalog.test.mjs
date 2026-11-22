import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCatalogModel } from '../lib/model-catalog.js'
import { getResponsesToolSupport } from '@earendil-works/pi-ai/api/openai-responses-shared'
import { getSupportedThinkingLevels } from '../lib/pi-responses-runtime.js'

const model = (provider, id) => resolveCatalogModel(provider, id)?.descriptor

test('Pi 1.5 catalog additions and removals remain separate from ownership policy', () => {
  for (const provider of ['openai', 'github-copilot', 'cloudflare-ai-gateway'])
    assert.ok(model(provider, 'gpt-6.1-terra'), provider)
  assert.ok(model('openai', 'gpt-5.6-cyber'))
  for (const id of ['gpt-5.2-chat-latest', 'gpt-5.3-chat-latest', 'gpt-realtime-2.1'])
    assert.equal(model('openai', id), undefined, id)
  for (const id of ['gpt-5-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5'])
    assert.equal(model('github-copilot', id), undefined, id)
})

test('Pi 1.5 Responses compat chooses none for GPT 5.4/5.5 and changes for modern GPT', () => {
  for (const provider of ['openai', 'opencode', 'cloudflare-ai-gateway']) {
    for (const id of ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4-pro', 'gpt-5.5', 'gpt-5.5-pro'])
      assert.equal(getResponsesToolSupport(model(provider, id).compat ?? {}), 'none', `${provider}/${id}`)
    assert.equal(getResponsesToolSupport(model(provider, 'gpt-6-sol').compat), provider === 'cloudflare-ai-gateway' ? 'none' : 'changes', provider)
  }
  assert.equal(model('openai', 'gpt-6.1-terra').compat.supportsMidConvoEffort, true)
})

test('OpenCode Responses endpoint includes the OpenAI path', () => {
  assert.equal(model('opencode', 'gpt-6-sol').baseUrl, 'https://opencode.ai/inference/openai/v1')
})

test('Grok 4.3/4.5 thinking levels now offer xhigh', () => {
  for (const id of ['grok-4.3', 'grok-4.5'])
    assert.ok(getSupportedThinkingLevels(model('xai', id)).includes('xhigh'), id)
})

test('Pi 1.6.0 catalog adds gpt-6.2-sol/astra, gpt-6-cyber, and Copilot Grok strict mode', () => {
  for (const provider of ['openai', 'github-copilot', 'cloudflare-ai-gateway', 'opencode']) {
    for (const id of ['gpt-6.2-sol', 'gpt-6.2-astra']) {
      const descriptor = model(provider, id)
      assert.ok(descriptor, `${provider}/${id}`)
      assert.equal(descriptor.compat?.supportsOpenAIGrammarTools, true, `${provider}/${id}`)
      assert.equal(descriptor.compat?.supportsStrictMode, provider === 'opencode' ? undefined : true, `${provider}/${id}`)
    }
  }
  assert.equal(model('opencode', 'gpt-6.2-sol').compat?.sessionAffinityFormat, 'openai-nosession')
  assert.equal(model('opencode', 'gpt-6.2-sol').compat?.supportsAdditionalTools, true)
  const cyber6 = model('openai', 'gpt-6-cyber')
  assert.ok(cyber6)
  assert.equal(cyber6.contextWindow, 1_050_000)
  assert.equal(cyber6.compat?.supportsExplicitPromptCacheMode, true)
  for (const id of ['grok-4.5', 'grok-4.6', 'grok-4.7']) {
    assert.equal(model('github-copilot', id).compat?.supportsStrictMode, true, `github-copilot/${id}`)
    assert.equal(model('github-copilot', id).compat?.supportsOpenAIGrammarTools, undefined, `github-copilot/${id}`)
  }
})
