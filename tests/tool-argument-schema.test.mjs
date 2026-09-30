import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { serializeDshMessages } from '../lib/dsh-responses.js'
import { convertResponsesTools } from '../lib/pi-responses-runtime.js'
import { ALPHA_SEARCH_PARAMETERS, alphaActionCommand, normalizeAlphaSearchArgs } from '../lib/web-search-alpha.js'
import { alphaSearchParametersFor } from '../lib/web-search-capability.js'
import { HOSTED_SEARCH_PARAMETERS, buildHostedSearchBody, normalizeHostedSearchArgs } from '../lib/web-search-hosted.js'

const alphaRecord = {
  classification: 'command-capable', actions: { search_query: 'supported', open: 'supported', find: 'supported', click: 'unknown', screenshot: 'unknown' },
  probedAt: '2026-09-30T00:48:48.000Z', schemaFingerprint: 'fixture', probeVersion: 12, provenance: 'unavailable',
}

test('Luna receives the DSH-projected, non-strict LCX web tool schemas', async (t) => {
  const definitions = [
    { name: 'websearch_alpha', description: 'Alpha', parameters: alphaSearchParametersFor(alphaRecord) },
    { name: 'websearch_gpt_advanced', description: 'Hosted', parameters: HOSTED_SEARCH_PARAMETERS },
  ]
  const ctx = new Context()
  const fibers = [await ctx.plugin(SystemPrompt), await ctx.plugin(ToolRuntime)]
  t.after(() => { for (const fiber of fibers.reverse()) fiber.dispose() })
  for (const definition of definitions) ctx.tools.register({
    ...definition,
    output: { schema: { type: 'object', properties: {}, additionalProperties: false }, render: () => [] },
    execute: async () => ({}),
  })
  const projected = ctx.tools.schemas()
  assert.deepEqual(projected.map(({ name, parameters }) => [name, parameters.required]), [
    ['websearch_alpha', ['action']], ['websearch_gpt_advanced', ['query']],
  ])
  const serialized = await serializeDshMessages([], undefined, {
    route: { provider: 'lcx', model: 'gpt-5.6-luna', baseURL: 'https://fixture.invalid/v1' },
    tools: projected,
  })
  assert.deepEqual(serialized.tools.map(({ name, strict, parameters }) => ({
    name, strict, required: parameters.required, fields: Object.keys(parameters.properties),
    oneOf: parameters.oneOf, additionalProperties: parameters.additionalProperties,
  })), projected.map(({ name, parameters }) => ({
    name, strict: undefined, required: parameters.required, fields: Object.keys(parameters.properties),
    oneOf: undefined, additionalProperties: false,
  })))
  assert.match(serialized.tools[0].parameters.properties.action.description, /Other declared fields are ignored/)
  assert.equal(serialized.model.compat?.supportsStrictMode, undefined)
  const strictCapable = convertResponsesTools(projected, { supportsStrictMode: true, supportsOpenAIGrammarTools: false })
  assert.deepEqual(strictCapable.map(({ strict, parameters }) => [strict, parameters.required]), [
    [false, ['action']], [false, ['query']],
  ])
})

test('Alpha accepts a schema-valid model call filling every optional field, but forwards only search fields', () => {
  const args = { action: 'search_query', query: 'fixture' }
  for (const [name, schema] of Object.entries(ALPHA_SEARCH_PARAMETERS.properties)) {
    if (name in args) continue
    args[name] = schema.type === 'integer' ? 1 : schema.type === 'array' ? ['example.com'] : schema.enum?.[0] ?? 'fixture'
  }
  assert.deepEqual(validateJsonSchemaValue(ALPHA_SEARCH_PARAMETERS, args), [])
  const normalized = normalizeAlphaSearchArgs(args)
  assert.deepEqual(normalized, { action: 'search_query', query: 'fixture', domains: ['example.com'], recency: 1, responseLength: 'short' })
  assert.deepEqual(alphaActionCommand(normalized), { search_query: [{ q: 'fixture', recency: 1, domains: ['example.com'] }], response_length: 'short' })
  assert.deepEqual(normalizeAlphaSearchArgs({ action: 'search_query', query: 'fixture', domains: [] }), { action: 'search_query', query: 'fixture' })
  assert.throws(() => normalizeAlphaSearchArgs({ action: 'search_query', query: 'fixture', invented: 'x' }), /unrelated field/)
  assert.throws(() => normalizeAlphaSearchArgs({ action: 'search_query', query: '' }), /query is invalid/)
  assert.throws(() => normalizeAlphaSearchArgs({ action: 'search_query', query: 'fixture', domains: ['bad/domain'] }), /invalid domain/)
})

test('Hosted empty optional domain filters are schema-valid no-ops; real filters remain checked', () => {
  const args = { query: 'fixture', allowedDomains: [], blockedDomains: [] }
  assert.deepEqual(validateJsonSchemaValue(HOSTED_SEARCH_PARAMETERS, args), [])
  const normalized = normalizeHostedSearchArgs(args)
  assert.deepEqual(normalized, { query: 'fixture' })
  assert.equal(buildHostedSearchBody(normalized, 'gpt-5.6-luna').tools[0].filters, undefined)
  assert.throws(() => normalizeHostedSearchArgs({ query: 'fixture', allowedDomains: ['bad/domain'] }), /invalid domain/)
  assert.throws(() => normalizeHostedSearchArgs({ query: 'fixture', allowedDomains: ['example.com'], blockedDomains: ['example.com'] }), /domain filters conflict/)
})
