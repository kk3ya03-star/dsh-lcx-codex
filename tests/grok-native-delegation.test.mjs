import test from 'node:test'
import assert from 'node:assert/strict'
import { grokHarness, user, xaiProfile } from './grok-fixture.mjs'

function options(overrides = {}) {
  return {
    provider: 'xai', model: 'grok-4.6',
    messages: [user('delegate')], ...overrides,
  }
}

function assertDelegates(harness, request) {
  const sentinel = { delegated: request }
  assert.equal(harness.stream(request, () => sentinel), sentinel)
}

test('disabled, non-Grok, and unresolved profiles delegate unchanged to DSH', () => {
  assertDelegates(grokHarness(), options())
  assertDelegates(
    grokHarness({ nativeX: true }),
    options({ model: 'agrok-4.6' }),
  )
  assertDelegates(
    grokHarness({ nativeWeb: true, profiles: { relay: { ...xaiProfile, api: 'anthropic-messages' } } }),
    options({ provider: 'relay' }),
  )
  assertDelegates(
    grokHarness({ nativeWeb: true, profiles: { relay: { ...xaiProfile, apiKeyEnv: undefined } } }),
    options({ provider: 'relay' }),
  )
  assertDelegates(
    grokHarness({ nativeX: true, profiles: {} }),
    options({ provider: 'relay', model: 'grokCustom' }),
  )
})

test('Grok native search never owns title or compaction auxiliary calls', () => {
  const h = grokHarness({ nativeWeb: true, nativeX: true })
  assertDelegates(h, options({ purpose: 'session-title' }))
  assertDelegates(h, options({ purpose: 'compaction' }))
})

test('GPT lifecycle enabled still delegates non-GPT routes when native search is disabled', () => {
  const h = grokHarness({ enabled: true })
  for (const request of [
    options(),
    options({ provider: 'anthropic', model: 'claude-fixture' }),
    { messages: [user('unknown')] },
  ]) assertDelegates(h, request)
})
