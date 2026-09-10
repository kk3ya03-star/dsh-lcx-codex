import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assertReleasePolicy } from './release-policy.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
const actual = readFileSync(new URL('../PUBLIC-RELEASE-MANIFEST.yml', import.meta.url), 'utf8')
const review = actual.replace(/^state: APPROVED_PRERELEASE$/m, 'state: REVIEW_ONLY')
  .replace(/^  product_owner: .+$/m, '  product_owner: PENDING_CONTROLLER_APPROVAL')
  .replace(/^  state: APPROVED_PENDING_PUBLISH$/m, '  state: BLOCKED')
const tag = `refs/tags/v${pkg.version}`
// Synthetic approval fixture; never persisted as the candidate manifest.
const approved = review.replace('state: REVIEW_ONLY', 'state: APPROVED_PRERELEASE')
  .replace('product_owner: PENDING_CONTROLLER_APPROVAL', 'product_owner: synthetic_test_approval')
  .replace('state: BLOCKED', 'state: APPROVED_PENDING_PUBLISH')
test('unpublished candidate is blocked even with a matching tag', () => {
  assert.match(review, /^state: REVIEW_ONLY$/m)
  assert.match(review, /publication:\s+state: BLOCKED/)
  assert.throws(() => assertReleasePolicy(pkg, review, tag))
})
test('matching synthetic approval validates', () => assert.doesNotThrow(() => assertReleasePolicy(pkg, approved, tag)))
for (const [label, manifest, ref] of [
  ['branch dispatch', approved, 'refs/heads/main'],
  ['wrong tag', approved, 'refs/tags/v0.4.3-pre.12'],
  ['wrong manifest version', approved.replace(/^version: .+$/m, 'version: 0.4.3-pre.12'), tag],
  ['stable dist-tag', approved.replace('npm_dist_tag: prelatest', 'npm_dist_tag: latest'), tag],
  ['wrong runtime', approved.replace('dsh: 0.1.5-alpha.2', 'dsh: 0.1.5-alpha.1'), tag],
  ['pending owner approval', approved.replace('synthetic_test_approval', 'PENDING_CONTROLLER_APPROVAL'), tag],
  ['blocked publication', approved.replace('state: APPROVED_PENDING_PUBLISH', 'state: BLOCKED'), tag],
]) test(`publication rejects ${label}`, () => assert.throws(() => assertReleasePolicy(pkg, manifest, ref)))

test('actual manifest approval state is enforced', () => {
  if (/^state: APPROVED_PRERELEASE$/m.test(actual)) {
    assert.doesNotThrow(() => assertReleasePolicy(pkg, actual, tag))
  } else {
    assert.throws(() => assertReleasePolicy(pkg, actual, tag))
  }
})
