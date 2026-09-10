import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assertReleasePolicy } from './release-policy.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
const actual = readFileSync(new URL('../PUBLIC-RELEASE-MANIFEST.yml', import.meta.url), 'utf8')
const prerelease = pkg.version.includes('-')
const approvedState = prerelease ? 'APPROVED_PRERELEASE' : 'APPROVED_STABLE'
const expectedDistTag = prerelease ? 'prelatest' : 'latest'
const otherDistTag = prerelease ? 'latest' : 'prelatest'
const tag = `refs/tags/v${pkg.version}`
const review = actual.replace(new RegExp(`^state: ${approvedState}$`, 'm'), 'state: REVIEW_ONLY')
  .replace(/^  product_owner: .+$/m, '  product_owner: PENDING_CONTROLLER_APPROVAL')
  .replace(/^  state: APPROVED_PENDING_PUBLISH$/m, '  state: BLOCKED')

test('actual approved release manifest validates', () => {
  assert.doesNotThrow(() => assertReleasePolicy(pkg, actual, tag))
})

test('review-only metadata cannot authorize publication', () => {
  assert.match(review, /^state: REVIEW_ONLY$/m)
  assert.match(review, /publication:\s+state: BLOCKED/)
  assert.throws(() => assertReleasePolicy(pkg, review, tag))
})

for (const [label, manifest, ref] of [
  ['branch dispatch', actual, 'refs/heads/main'],
  ['wrong tag', actual, 'refs/tags/v0.0.0'],
  ['wrong manifest version', actual.replace(/^version: .+$/m, 'version: 0.0.0'), tag],
  ['wrong dist-tag', actual.replace(`npm_dist_tag: ${expectedDistTag}`, `npm_dist_tag: ${otherDistTag}`), tag],
  ['wrong release state', actual.replace(`state: ${approvedState}`, `state: ${prerelease ? 'APPROVED_STABLE' : 'APPROVED_PRERELEASE'}`), tag],
  ['wrong runtime', actual.replace('dsh: 0.1.5-rc.1', 'dsh: 0.1.5-alpha.2'), tag],
  ['pending owner approval', actual.replace(/^  product_owner: .+$/m, '  product_owner: PENDING_CONTROLLER_APPROVAL'), tag],
  ['blocked publication', actual.replace('state: APPROVED_PENDING_PUBLISH', 'state: BLOCKED'), tag],
]) test(`publication rejects ${label}`, () => assert.throws(() => assertReleasePolicy(pkg, manifest, ref)))
