import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAlphaSearchResponse, probeAlphaCapabilities } from '../lib/web-search-alpha.js'

const parse = (action, output, results = []) => parseAlphaSearchResponse(
  { output, results }, { action, capability: 'command-capable', requestId: 'synthetic-ref-failure' },
)

const failures = [
  ['open', 'Unable to open `turn0view0`: the reference ID is invalid or unavailable in this browsing session.'],
  ['find', '**Result:** Unable to execute `find` because `turn0view0` is not available in this session.'],
  ['click', 'Unable to execute click: reference ID is unresolved.'],
  ['screenshot', 'Unable to screenshot turn0view0: reference unavailable.'],
]

test('Alpha rejects action-specific reference failure envelopes, even with echoed references', () => {
  for (const [action, output] of failures) {
    for (const results of [[], [{ ref_id: 'turn0view0' }]]) {
      assert.throws(() => parse(action, output, results), { code: 'LCX_ALPHA_ACTION_FAILED' })
    }
  }
})

const OPEN_FETCH_FAILURE = [
  'Internal Error ()',
  '\uE200cite\uE202turn1view0\uE201 [wordlim: 200] Source: open({"ref_id":"turn0search0","lineno":null}); Total lines: 1',
  'L0: Failed to fetch https://platform.openai.com/docs/quickstart/make-your-first-api-request: (404) Not Found',
].join('\n')

test('Alpha rejects the top-level open fetch-failure envelope before returning refs', () => {
  for (const results of [[], [{ ref_id: 'turn1view0' }]]) {
    assert.throws(
      () => parse('open', OPEN_FETCH_FAILURE, results),
      { code: 'LCX_ALPHA_ACTION_FAILED' },
    )
  }
})

test('Alpha does not mistake quoted page content, other actions or no-match results for failures', () => {
  for (const [action, output] of [
    ['open', 'Reference troubleshooting\nL1: Unable to open turn0view0: reference unavailable.'],
    ['open', '> Unable to open turn0view0: reference unavailable.'],
    ['open', '````text\nUnable to open turn0view0: reference unavailable.\n````'],
    ['find', 'No matches found for "reference unavailable" in turn0view0.'],
    ['open', 'Unable to open a window is the title of this guide.'],
    ['click', failures[0][1]],
    ['search_query', failures[0][1]],
    ['open', 'Opened docs (https://example.com/errors)\n\uE200cite\uE202turn0view0\uE201\nL1: Internal Error ()\nL2: Failed to fetch https://example.com: (404) Not Found'],
    ['open', '> Internal Error ()\n> Source: open({"ref_id":"turn0search0","lineno":null}); Total lines: 1\n> L0: Failed to fetch https://example.com: (404) Not Found'],
    ['open', '```text\nInternal Error ()\nSource: open({"ref_id":"turn0search0","lineno":null}); Total lines: 1\nL0: Failed to fetch https://example.com: (404) Not Found\n```'],
    ['open', 'Internal Error ()\nThis runbook quotes Failed to fetch https://example.com: (404) Not Found for operators.'],
    ['find', OPEN_FETCH_FAILURE],
    ['click', OPEN_FETCH_FAILURE],
    ['search_query', OPEN_FETCH_FAILURE],
  ]) assert.doesNotThrow(() => parse(action, output, [{ ref_id: 'turn0real' }]))
})

test('Alpha probe rejects the same reference error envelope without requiring a production parser', async () => {
  const result = await probeAlphaCapabilities({
    schemaFingerprint: 'fixture',
    invoke: async args => {
      if (args.action === 'search_query') return { refs: [], sources: [{ url: 'https://example.com/' }] }
      if (args.action === 'open') return {
        content: failures[0][1], refs: ['turn0view0'], results: [{ ref_id: 'turn0view0' }],
      }
      assert.fail('Failed open must not be promoted to follow-up actions')
    },
  })
  assert.equal(result.actions.open, 'unsupported')
  assert.equal(result.classification, 'emulated-search-only')
})
