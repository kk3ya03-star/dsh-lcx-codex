import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ALPHA_PROBE_QUERY, parseAlphaSearchResponse, probeAlphaCapabilities } from '../lib/web-search-alpha.js'
import { alphaCapabilityUsable } from '../lib/web-search-capability.js'

const recorded = JSON.parse(readFileSync(new URL('./fixtures/issue95-page-fetch-failed.json', import.meta.url), 'utf8'))
const parse = (action, response) => parseAlphaSearchResponse(response, { action, capability: 'command-capable', requestId: 'synthetic' })

test('recorded empty cited error view is page_fetch_failed for open and click', () => {
  for (const action of ['open', 'click']) {
    assert.throws(() => parse(action, recorded), error => {
      assert.equal(error.code, 'LCX_ALPHA_PAGE_FETCH_FAILED')
      assert.match(error.message, /page could not be fetched; try another result/)
      return true
    })
  }
  for (const output of ['Error ()', 'Error ()\nciteturn0search0', 'Docs\nciteturn1view0\nL0: Error ()']) {
    assert.doesNotThrow(() => parse('open', { output }))
  }
  assert.throws(() => parse('open', { output: 'reference unavailable' }), { code: 'LCX_ALPHA_ACTION_FAILED' })
})

test('page fetch fallback requires two independent opaque chains and never repeats a candidate', async () => {
  for (const rawEnvelope of [false, true]) {
    let chain
    const calls = []
    const result = await probeAlphaCapabilities({
      startChain: index => { chain = index; return `chain-${index}` },
      schemaFingerprint: 'fixture',
      invoke: async args => {
        calls.push([chain, args.action, args.refId])
        if (args.action === 'search_query') {
          assert.equal(args.query, ALPHA_PROBE_QUERY)
          return { refs: ['turn0search0', 'turn0search0', 'turn0search1'] }
        }
        if (args.action === 'open' && args.refId === 'turn0search0') {
          if (rawEnvelope) return { content: recorded.output, refs: ['turn1view0'] }
          return parse('open', recorded)
        }
        if (args.action === 'open') return { refs: ['turn2view0'] }
        assert.equal(args.refId, 'turn2view0')
        assert.equal(args.pattern, 'Python')
        return { refs: ['turn3find0'] }
      },
    })
    assert.equal(result.classification, 'command-capable')
    assert.equal(alphaCapabilityUsable(result), true)
    assert.equal(calls.length, 8)
    for (const index of [0, 1]) assert.deepEqual(calls.filter(c => c[0] === index).map(c => c[1]), ['search_query', 'open', 'open', 'find'])
  }
})

test('all candidate fetch failures are unknown and bounded to three opens in either chain', async () => {
  for (const failingChain of [0, 1]) {
    let chain
    const calls = []
    const result = await probeAlphaCapabilities({
      startChain: index => { chain = index; return `chain-${index}` },
      schemaFingerprint: 'fixture',
      invoke: async args => {
        calls.push([chain, args.action])
        if (args.action === 'search_query') return { refs: Array.from({ length: 10 }, (_, i) => `turn0search${i}`) }
        if (args.action === 'open' && chain === failingChain) return parse('open', recorded)
        return { refs: ['turn2view0'] }
      },
    })
    assert.equal(result.classification, 'unknown')
    assert.equal(result.actions.open, 'unknown')
    assert.equal(alphaCapabilityUsable(result), false)
    assert.equal(calls.filter(c => c[0] === failingChain).length, 4)
    assert.equal(calls.length, failingChain === 0 ? 4 : 7)
  }
})

test('genuine unsupported and invalid reference failures do not trigger candidate fallback', async () => {
  for (const error of [Object.assign(new Error('unsupported action'), { status: 405 }), Object.assign(new Error('channel does not support'), {}), Object.assign(new Error('reference unavailable'), { code: 'LCX_ALPHA_ACTION_FAILED' })]) {
    let calls = 0
    const result = await probeAlphaCapabilities({
      startChain: index => `chain-${index}`, schemaFingerprint: 'fixture',
      invoke: async args => {
        calls++
        if (args.action === 'search_query') return { refs: ['turn0search0', 'turn0search1'] }
        throw error
      },
    })
    assert.equal(calls, 2)
    assert.equal(result.actions.open, 'unsupported')
    assert.equal(result.classification, 'emulated-search-only')
  }
})

test('full probe is bounded to 19 calls including every optional check', async () => {
  let calls = 0
  const result = await probeAlphaCapabilities({
    startChain: index => `chain-${index}`, schemaFingerprint: 'fixture',
    clickProbeRef: 'https://example.com/click', screenshotProbeRef: 'https://example.com/pdf',
    actionProbes: Object.fromEntries(['image_query', 'finance', 'weather', 'sports', 'time'].map(action => [action, {}])),
    invoke: async args => {
      calls++
      if (args.action === 'search_query') return { refs: ['turn0search0', 'turn0search1', 'turn0search2', 'turn0search3'] }
      if (args.action === 'open' && ['turn0search0', 'turn0search1'].includes(args.refId)) return parse('open', recorded)
      if (args.refId === 'https://example.com/click') return { refs: ['turn4view0'], links: [{ id: 1 }] }
      if (args.refId === 'https://example.com/pdf') return { pdfRefs: ['turn5view0'] }
      return { refs: ['turn3view0'] }
    },
  })
  assert.equal(result.classification, 'command-capable')
  assert.equal(calls, 19)
})


test('runtime internal-error and notice-only views fail without matching page bodies', () => {
  const internal = JSON.parse(readFileSync(new URL('./fixtures/issue95-page-fetch-internal-error.json', import.meta.url), 'utf8'))
  const notice = JSON.parse(readFileSync(new URL('./fixtures/issue95-page-fetch-notice.json', import.meta.url), 'utf8'))
  for (const response of [internal, notice, { output: notice.output.replace('\n', ': ') }, { output: `\uE200cite\uE202turn2view0\uE201 [wordlim: 200]\n${notice.output}` }]) {
    assert.throws(() => parse('open', response), { code: 'LCX_ALPHA_PAGE_FETCH_FAILED' })
    assert.doesNotThrow(() => parse('search_query', response))
    assert.doesNotThrow(() => parse('find', response))
    for (const output of [`Docs\n${response.output}`, `${response.output}\nL0: Real page body`, `> ${response.output}`, `\`\`\`text\n${response.output}\n\`\`\``]) {
      assert.doesNotThrow(() => parse('open', { output }))
    }
  }
  assert.throws(() => parse('click', internal), { code: 'LCX_ALPHA_PAGE_FETCH_FAILED' })
  assert.doesNotThrow(() => parse('click', notice))
  assert.doesNotThrow(() => parse('open', { output: 'Failed to fetch is discussed in this article.\nActual page text.' }))
})
