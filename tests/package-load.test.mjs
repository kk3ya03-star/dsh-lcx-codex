import test from 'node:test'
import assert from 'node:assert/strict'

// Regression for 0.4.0-rc.8: the package test suite was green while lib/index.js
// imported symbols that the Alpha store modules no longer exported. This test
// exercises the actual server entry point so export-contract drift fails CI.
test('server entry point imports successfully', async () => {
  const entry = await import('../lib/index.js')
  assert.equal(typeof entry.default, 'function')
  assert.ok(Array.isArray(entry.inject))
  assert.ok(entry.Config)
})

test('Alpha store modules expose the contracts consumed by the entry point', async () => {
  const capability = await import('../lib/web-search-capability.js')
  const refs = await import('../lib/web-search-ref-store.js')
  assert.equal(typeof capability.AlphaCapabilityStore, 'function')
  assert.equal(typeof capability.alphaCapabilityFingerprint, 'function')
  assert.equal(typeof capability.alphaCapabilityUsable, 'function')
  assert.equal(typeof refs.AlphaRefStore, 'function')
})
