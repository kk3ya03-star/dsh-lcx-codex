import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AlphaRefStore } from '../lib/web-search-ref-store.js'

const provenance = { action: 'search_query', originKind: 'response', originFingerprint: 'a'.repeat(64) }
const observation = () => ({ refId: 'turn0search0', url: 'https://example.com/original', provenance: { ...provenance } })
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lcx-issue67-refs-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'refs.json')
  const store = new AlphaRefStore(file)
  store.record('session-a', 'route-a', [observation()])
  return { file, store }
}
const collision = { code: 'LCX_ALPHA_REF_COLLISION' }

test('issue67 ref store identical observation is idempotent and owns its provenance copy', t => {
  const { store } = fixture(t)
  const same = observation()
  store.record('session-a', 'route-a', [same])
  same.provenance.originFingerprint = 'b'.repeat(64)
  const accepted = store.assertUsable('session-a', 'route-a', same.refId)
  assert.deepEqual(accepted, observation())
  accepted.provenance.action = 'find'
  assert.deepEqual(store.assertUsable('session-a', 'route-a', same.refId), observation())
})

test('issue67 different URL fails closed without changing original file bytes', t => {
  const { file, store } = fixture(t)
  const before = readFileSync(file)
  assert.throws(() => store.record('session-a', 'route-a', [{ ...observation(), url: 'https://example.com/reused' }]), collision)
  assert.deepEqual(readFileSync(file), before)
  assert.deepEqual(store.assertUsable('session-a', 'route-a', 'turn0search0'), observation())
})

test('issue67 same URL with conflicting origin or artifact provenance fails closed', t => {
  const { file, store } = fixture(t)
  const before = readFileSync(file)
  for (const conflict of [
    { ...provenance, action: 'open' },
    { ...provenance, originKind: 'request' },
    { ...provenance, originFingerprint: 'b'.repeat(64) },
    { ...provenance, artifactFingerprint: 'c'.repeat(64) },
  ]) {
    assert.throws(() => store.record('session-a', 'route-a', [{ ...observation(), provenance: conflict }]), collision)
    assert.deepEqual(readFileSync(file), before)
  }
})

test('issue67 missing or malformed provenance cannot silently bypass an existing ref collision', t => {
  const { file, store } = fixture(t)
  const before = readFileSync(file)
  for (const bad of [undefined, {}, { ...provenance, originFingerprint: 'invalid' }]) {
    const changed = { refId: 'turn0search0', url: 'https://example.com/reused', ...(bad === undefined ? {} : { provenance: bad }) }
    assert.throws(() => store.record('session-a', 'route-a', [
      { ...observation(), refId: 'turn1search0' }, changed,
    ]), collision)
    assert.deepEqual(readFileSync(file), before)
    assert.throws(() => store.assertUsable('session-a', 'route-a', 'turn1search0'), { code: 'LCX_ALPHA_REF_UNAVAILABLE' })
  }
})

test('issue67 failed batch is atomic even when a fresh ref precedes collision', t => {
  const { file, store } = fixture(t)
  const before = readFileSync(file)
  assert.throws(() => store.record('session-a', 'route-a', [
    { ...observation(), refId: 'turn1search0' },
    { ...observation(), url: 'https://example.com/reused' },
  ]), collision)
  assert.deepEqual(readFileSync(file), before)
  assert.throws(() => store.assertUsable('session-a', 'route-a', 'turn1search0'), { code: 'LCX_ALPHA_REF_UNAVAILABLE' })
})

test('issue67 duplicate conflicting refs in one new batch cannot silently replace each other', t => {
  const { file, store } = fixture(t)
  const before = readFileSync(file)
  assert.throws(() => store.record('session-a', 'route-a', [
    { ...observation(), refId: 'turn1search0' },
    { ...observation(), refId: 'turn1search0', provenance: { ...provenance, originFingerprint: 'b'.repeat(64) } },
  ]), collision)
  assert.deepEqual(readFileSync(file), before)
})

test('issue67 cold store reload retains identity and collision protection', t => {
  const { file } = fixture(t)
  const cold = new AlphaRefStore(file)
  assert.deepEqual(cold.assertUsable('session-a', 'route-a', 'turn0search0'), observation())
  cold.record('session-a', 'route-a', [observation()])
  const before = readFileSync(file)
  assert.throws(() => cold.record('session-a', 'route-a', [{ ...observation(), provenance: { ...provenance, originFingerprint: 'b'.repeat(64) } }]), collision)
  assert.deepEqual(readFileSync(file), before)
})

test('issue67 foreign sessions and routes remain isolated for the same ref ID', t => {
  const { store } = fixture(t)
  const other = { ...observation(), url: 'https://example.com/other', provenance: { ...provenance, originFingerprint: 'b'.repeat(64) } }
  store.record('session-b', 'route-b', [other])
  assert.deepEqual(store.assertUsable('session-a', 'route-a', 'turn0search0'), observation())
  assert.deepEqual(store.assertUsable('session-b', 'route-b', 'turn0search0'), other)
  for (const [session, route] of [['session-a', 'route-b'], ['session-b', 'route-a'], ['session-c', 'route-a']]) {
    assert.throws(() => store.assertUsable(session, route, 'turn0search0'), { code: 'LCX_ALPHA_REF_UNAVAILABLE' })
  }
})

test('issue67 valid V1 store cold-loads as explicitly unattributed without rewriting history', t => {
  const { file } = fixture(t)
  const old = JSON.stringify({ version: 1, sessions: { 'session-a': { routeFingerprint: 'route-a', updatedAt: '2026-09-09T00:00:00Z', refs: { turn0search0: { refId: 'turn0search0', url: 'https://example.com/original' } } } } })
  writeFileSync(file, old)
  const migrated = new AlphaRefStore(file)
  const accepted = migrated.assertUsable('session-a', 'route-a', 'turn0search0')
  assert.equal(accepted.refId, observation().refId)
  assert.equal(accepted.url, observation().url)
  assert.equal(accepted.provenance.originKind, 'legacy-unattributed')
  assert.match(accepted.provenance.originFingerprint, /^[a-f0-9]{64}$/u)
  assert.equal(accepted.provenance.artifactFingerprint, undefined)
  assert.deepEqual(new AlphaRefStore(file).assertUsable('session-a', 'route-a', 'turn0search0'), accepted)
  assert.throws(() => migrated.record('session-a', 'route-a', [observation()]), collision)
  assert.throws(() => migrated.record('session-a', 'route-a', [{ refId: 'turn0search0', url: 'https://example.com/reused', provenance: {} }]), collision)
  assert.equal(readFileSync(file, 'utf8'), old)
  migrated.record('session-a', 'route-a', [{ ...observation(), refId: 'turn1search0' }])
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 2)
  assert.deepEqual(new AlphaRefStore(file).assertUsable('session-a', 'route-a', 'turn0search0'), accepted)
})

test('issue67 malformed V1 stores remain corrupt and are never rewritten or promoted', t => {
  const { file } = fixture(t)
  const old = JSON.stringify({ version: 1, sessions: { 'session-a': { routeFingerprint: 'route-a', updatedAt: '2026-09-09T00:00:00Z', refs: { turn0search0: { refId: 'DIFFERENT', url: 'https://example.com/original' } } } } })
  writeFileSync(file, old)
  assert.throws(() => new AlphaRefStore(file), { code: 'LCX_ALPHA_REF_STORE_CORRUPT' })
  assert.equal(readFileSync(file, 'utf8'), old)
})
