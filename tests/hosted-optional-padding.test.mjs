import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHostedSearchBody, HOSTED_SEARCH_PARAMETERS, normalizeHostedSearchArgs } from '../lib/web-search-hosted.js'

const wire = args => buildHostedSearchBody(normalizeHostedSearchArgs({ query: 'test', ...args }), 'test-model')
const sourcesOnly = ['web_search_call.action.sources']
const paddedImages = { caption: false, maxResults: 0 }
const blankLocation = { country: '', city: '', region: '', timezone: '' }

test('Hosted empty content types are omitted just like empty domain filters', () => {
  const request = wire({ searchContentTypes: [], allowedDomains: [], blockedDomains: [] })
  assert.deepEqual(request, wire({}))
  assert.equal(Object.hasOwn(request.tools[0], 'search_content_types'), false)
})

test('Hosted recorded text-only padding drops image settings and preserves explicit text selection', () => {
  const request = wire({ searchContentTypes: ['text'], imageSettings: paddedImages })
  assert.deepEqual(request, wire({ searchContentTypes: ['text'] }))
  assert.deepEqual(request.tools[0].search_content_types, ['text'])
  assert.equal(Object.hasOwn(request.tools[0], 'image_settings'), false)
  assert.deepEqual(request.include, sourcesOnly)
})

test('Hosted recorded empty content types and image padding omit both wire fields', () => {
  const request = wire({ searchContentTypes: [], imageSettings: paddedImages })
  assert.deepEqual(request, wire({}))
  assert.equal(Object.hasOwn(request.tools[0], 'search_content_types'), false)
  assert.equal(Object.hasOwn(request.tools[0], 'image_settings'), false)
  assert.deepEqual(request.include, sourcesOnly)
})

test('Hosted recorded padding also accepts all-blank user location', () => {
  for (const searchContentTypes of [[], ['text']]) {
    const request = wire({ searchContentTypes, imageSettings: paddedImages, userLocation: blankLocation })
    assert.deepEqual(request, wire({ searchContentTypes }))
    assert.equal(Object.hasOwn(request.tools[0], 'user_location'), false)
    assert.equal(Object.hasOwn(request.tools[0], 'image_settings'), false)
    assert.deepEqual(request.include, sourcesOnly)
  }
})

test('Hosted drops structurally valid image settings when image search is absent (TL matrix)', () => {
  for (const searchContentTypes of [undefined, [], ['text'], ['text', 'text']]) {
    for (const imageSettings of [undefined, {}, paddedImages, { caption: true, maxResults: 3 }, { maxResults: 100 }, { caption: false }]) {
      const request = wire({ searchContentTypes, imageSettings })
      assert.deepEqual(request, wire({ searchContentTypes }), 'serializes exactly like imageSettings omitted')
      assert.equal(Object.hasOwn(request.tools[0], 'image_settings'), false)
      assert.deepEqual(request.include, sourcesOnly)
    }
  }
})

test('Hosted still rejects malformed image settings even when they would be inert', () => {
  for (const searchContentTypes of [undefined, [], ['text']]) {
    for (const maxResults of [-1, 101, 1.5, NaN, '1', null, false])
      assert.throws(() => wire({ searchContentTypes, imageSettings: { maxResults } }), { code: 'WEB_INVALID_REQUEST', message: 'imageSettings.maxResults is invalid' })
    for (const caption of [0, 'false', null])
      assert.throws(() => wire({ searchContentTypes, imageSettings: { caption } }), { code: 'WEB_INVALID_REQUEST', message: 'imageSettings.caption must be boolean' })
    for (const imageSettings of [null, '', 'placeholder', 0, false, []])
      assert.throws(() => wire({ searchContentTypes, imageSettings }), { code: 'WEB_INVALID_REQUEST', message: 'imageSettings must be an object' })
    assert.throws(() => wire({ searchContentTypes, imageSettings: { maxResults: 0, extra: true } }), { code: 'WEB_INVALID_REQUEST', message: 'imageSettings has unsupported fields' })
  }
  assert.throws(() => wire({ searchContentTypes: ['image'], imageSettings: { maxResults: 0 } }), { code: 'WEB_INVALID_REQUEST', message: 'imageSettings.maxResults is invalid' })
  assert.throws(() => wire({ searchContentTypes: ['image'], imageSettings: { maxResults: 3, extra: 1 } }), { code: 'WEB_INVALID_REQUEST', message: 'imageSettings has unsupported fields' })
  for (const maxResults of [1, 100])
    assert.deepEqual(wire({ searchContentTypes: ['text', 'image'], imageSettings: { maxResults } }).tools[0].image_settings, { max_results: maxResults })
})

test('Hosted image search retains valid settings, bounds, deduplication and results include', () => {
  for (const searchContentTypes of [['image'], ['text', 'image'], ['image', 'image']]) {
    for (const maxResults of [1, 100]) {
      for (const caption of [false, true]) {
        const request = wire({ searchContentTypes, imageSettings: { maxResults, caption } })
        assert.deepEqual(request.tools[0].search_content_types, [...new Set(searchContentTypes)])
        assert.deepEqual(request.tools[0].image_settings, { max_results: maxResults, caption })
        assert.deepEqual(request.include, [...sourcesOnly, 'web_search_call.results'])
      }
    }
  }
  assert.equal(Object.hasOwn(wire({ searchContentTypes: ['image'] }).tools[0], 'image_settings'), false)
  assert.deepEqual(wire({ searchContentTypes: ['image'], imageSettings: {} }).tools[0].image_settings, {})
  assert.throws(() => wire({ searchContentTypes: ['image'], imageSettings: { caption: false, extra: true } }), { code: 'WEB_INVALID_REQUEST', message: 'imageSettings has unsupported fields' })
  assert.deepEqual(wire({ searchContentTypes: ['image'], imageSettings: { maxResults: 3 } }).tools[0].image_settings, { max_results: 3 })
})

test('Hosted image search still fails closed on invalid settings', () => {
  for (const searchContentTypes of [['image'], ['text', 'image']]) {
    for (const maxResults of [0, -1, 101, 1.5, NaN, Infinity, '1', null, false, [], {}]) {
      assert.throws(() => wire({ searchContentTypes, imageSettings: { maxResults } }), { code: 'WEB_INVALID_REQUEST', message: 'imageSettings.maxResults is invalid' })
    }
    for (const caption of [0, 1, 'false', null, [], {}]) {
      assert.throws(() => wire({ searchContentTypes, imageSettings: { caption } }), { code: 'WEB_INVALID_REQUEST', message: 'imageSettings.caption must be boolean' })
    }
    for (const imageSettings of [null, '', 'placeholder', 0, false, []]) {
      assert.throws(() => wire({ searchContentTypes, imageSettings }), { code: 'WEB_INVALID_REQUEST' })
    }
  }
})

test('Hosted invalid content types still fail closed even with inert image padding', () => {
  for (const searchContentTypes of [['video'], ['text', 'video'], ['image', 'video'], ['text', 'image', 'text'], [1], [null], ['text', false], 'image', null, {}]) {
    assert.throws(() => wire({ searchContentTypes, imageSettings: paddedImages }), { code: 'WEB_INVALID_REQUEST', message: 'searchContentTypes is invalid' })
  }
})

test('Hosted schema describes optional image controls without changing its shape', () => {
  for (const field of ['searchContentTypes', 'imageSettings']) {
    assert.match(HOSTED_SEARCH_PARAMETERS.properties[field].description, /^Optional .*Omit unless/)
  }
  assert.match(HOSTED_SEARCH_PARAMETERS.properties.searchContentTypes.description, /\[\] means no explicit content-type override/)
  assert.deepEqual(HOSTED_SEARCH_PARAMETERS.required, ['query'])
  assert.equal(HOSTED_SEARCH_PARAMETERS.additionalProperties, false)
  assert.equal(HOSTED_SEARCH_PARAMETERS.properties.imageSettings.additionalProperties, false)
  assert.deepEqual(HOSTED_SEARCH_PARAMETERS.properties.searchContentTypes.items.enum, ['text', 'image'])
})
