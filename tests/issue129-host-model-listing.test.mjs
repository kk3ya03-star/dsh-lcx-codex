import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Llm from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { warmHostRecognizedModels } from '../lib/route.js'

// Issue #129: since DSH 0.2.1-alpha.5 `llm.listModels` resolves the route's credential first and answers `[]`
// when the profile's credential reference is not set. LCX's pre-warm asks it which models DSH serves on bare
// profiles; a listing that is empty or fails for one provider must neither throw nor stop the other providers.

const baseURL = 'https://fixture.invalid/v1'
const directory = names => names.map(provider => ({ provider, displayName: provider, settingsNs: 'llm-pi-ai', settingsPath: ['providers', provider] }))
const settings = providers => ({ describe: () => [{ ns: 'llm-pi-ai', value: { providers } }] })

test('the real host lists nothing while the credential is missing, and LCX pre-warm stays quiet', async () => {
  const ctx = new Context()
  ctx.plugin(Llm)
  ctx.plugin(PiAi, { providers: { openai: { apiKeyEnv: 'FIXTURE_UNSET_KEY', baseURL } } })
  await new Promise(resolve => setTimeout(resolve, 800))
  let stored
  ctx.provide('credentials', { resolve: async () => stored === undefined ? undefined : { value: stored } }, true)
  assert.deepEqual(await ctx.llm.listModels('openai'), [])
  const routeCtx = { llm: ctx.llm, settings: settings({ openai: { apiKeyEnv: 'FIXTURE_UNSET_KEY', baseURL } }) }
  assert.equal(await warmHostRecognizedModels(routeCtx), false)
  // With the credential the host lists its catalog again; every model there is one LCX's bundled catalog
  // describes (the host and LCX run the same Pi), so nothing needs remembering either.
  stored = 'fixture-only'
  assert.ok((await ctx.llm.listModels('openai')).some(model => model.id === 'gpt-6-sol'))
  assert.equal(await warmHostRecognizedModels(routeCtx), false)
})

test('a provider whose listing fails is skipped and the others are still read', async () => {
  const listed = []
  const routeCtx = {
    llm: {
      listConfigurableProviders: () => directory(['broken', 'relay']),
      listModels: async provider => {
        listed.push(provider)
        if (provider === 'broken') throw new LlmError('fixture credential refused', 'INVALID_CREDENTIAL')
        return [{ provider, id: 'gpt-9-future', name: 'gpt-9-future', inputModalities: ['text'] }]
      },
    },
    settings: settings({ broken: { apiKeyEnv: 'K', baseURL }, relay: { apiKeyEnv: 'K', baseURL } }),
  }
  assert.equal(await warmHostRecognizedModels(routeCtx), true)
  assert.deepEqual(listed, ['broken', 'relay'])
})
