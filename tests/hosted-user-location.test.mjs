import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHostedSearchBody, HOSTED_SEARCH_PARAMETERS, normalizeHostedSearchArgs } from '../lib/web-search-hosted.js'

const fields = ['country', 'city', 'region', 'timezone']
const valid = { country: ' us ', city: ' Seattle ', region: ' Washington ', timezone: 'America/Los_Angeles' }
const normalized = { country: 'US', city: 'Seattle', region: 'Washington', timezone: 'America/Los_Angeles' }
const wire = args => buildHostedSearchBody(args, 'test-model')

test('Hosted location omits the recorded model shape with every optional field empty', () => {
  const args = normalizeHostedSearchArgs({ query: 'test', userLocation: { country: '', city: '', region: '', timezone: '' } })
  assert.equal(Object.hasOwn(args, 'userLocation'), false)
  assert.equal(Object.hasOwn(wire(args).tools[0], 'user_location'), false)
  assert.deepEqual(wire(args), wire(normalizeHostedSearchArgs({ query: 'test' })))
})

test('Hosted location omits all whitespace-only fields and an empty object', () => {
  for (const userLocation of [{}, { country: ' \t', city: '\n ', region: '\r\n', timezone: '\t ' }]) {
    const args = normalizeHostedSearchArgs({ query: 'test', userLocation })
    assert.deepEqual(args, { query: 'test' })
    assert.equal(Object.hasOwn(wire(args).tools[0], 'user_location'), false)
  }
})

for (const field of fields) {
  test(`Hosted location omits optional blank ${field} alongside valid fields`, () => {
    for (const blank of ['', ' \t\r\n ']) {
      const args = normalizeHostedSearchArgs({ query: 'test', userLocation: { ...valid, [field]: blank } })
      const expected = { ...normalized }
      delete expected[field]
      assert.deepEqual(args.userLocation, expected)
      assert.deepEqual(wire(args).tools[0].user_location, { type: 'approximate', ...expected })
    }
  })

  test(`Hosted location retains valid ${field} when every other field is blank`, () => {
    const userLocation = Object.fromEntries(fields.map(key => [key, key === field ? valid[key] : ' \t ']))
    const args = normalizeHostedSearchArgs({ query: 'test', userLocation })
    assert.deepEqual(args.userLocation, { [field]: normalized[field] })
    assert.deepEqual(wire(args).tools[0].user_location, { type: 'approximate', [field]: normalized[field] })
  })

  test(`Hosted location still rejects invalid nonblank or nonstring ${field}`, () => {
    const invalid = field === 'country' ? ['USA', '1x']
      : field === 'timezone' ? ['Invalid/Timezone', ' America/Los_Angeles ']
        : ['x'.repeat(201)]
    for (const value of [...invalid, null, 1, false, [], {}]) {
      const userLocation = Object.fromEntries(fields.map(key => [key, key === field ? value : '']))
      assert.throws(() => normalizeHostedSearchArgs({ query: 'test', userLocation }), error => {
        assert.equal(error.code, 'WEB_INVALID_REQUEST')
        assert.match(error.message, new RegExp(`userLocation\\.${field}`))
        return true
      })
    }
  })
}

test('Hosted location preserves existing valid normalization and allowlists wire fields', () => {
  const args = normalizeHostedSearchArgs({ query: 'test', userLocation: { ...valid, type: 'exact', latitude: 47 } })
  assert.deepEqual(args.userLocation, normalized)
  assert.deepEqual(wire(args).tools[0].user_location, { type: 'approximate', ...normalized })
  assert.equal(HOSTED_SEARCH_PARAMETERS.properties.userLocation.additionalProperties, false)
})

test('Hosted location still requires an object', () => {
  for (const userLocation of [null, '', [], 1, false]) {
    assert.throws(() => normalizeHostedSearchArgs({ query: 'test', userLocation }), { code: 'WEB_INVALID_REQUEST' })
  }
})

test('Hosted blank location leaves other Hosted search controls unchanged', () => {
  const controls = {
    query: ' test ', searchContextSize: 'high', allowedDomains: ['openai.com'], blockedDomains: ['example.com'],
    externalWebAccess: false, returnTokenBudget: 'unlimited', searchContentTypes: ['text', 'image'],
    imageSettings: { maxResults: 3, caption: true },
  }
  const args = normalizeHostedSearchArgs({ ...controls, userLocation: Object.fromEntries(fields.map(field => [field, ''])) })
  assert.deepEqual(args, normalizeHostedSearchArgs(controls))
  assert.deepEqual(wire(args), wire(normalizeHostedSearchArgs(controls)))
})
