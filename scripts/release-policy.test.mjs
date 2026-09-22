import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assertReleasePolicy } from './release-policy.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
const persisted = readFileSync(new URL('../PUBLIC-RELEASE-MANIFEST.yml', import.meta.url), 'utf8')
const prerelease = pkg.version.includes('-')
const approvedState = prerelease ? 'APPROVED_PRERELEASE' : 'APPROVED_STABLE'
const expectedDistTag = prerelease ? 'prelatest' : 'latest'
const otherDistTag = prerelease ? 'latest' : 'prelatest'
const tag = `refs/tags/v${pkg.version}`
const declaredDsh = pkg.devDependencies['@deepseek-ai/dsh']

// The manifest has two lifecycle states, and this suite has to hold in both.
// While a candidate is under review it is REVIEW_ONLY / BLOCKED with approval
// pending; once a release is approved it carries the approval itself.
const underReview = /^state: REVIEW_ONLY$/m.test(persisted)

/**
 * The approved manifest the publication guard is tested against.
 *
 * Under review this is a **synthetic in-memory fixture** and is never written
 * to disk: a candidate under review must not carry a persisted approval, but
 * the guard still has to be proven to accept a correctly approved candidate,
 * so the approval exists only for the duration of this process.
 */
const approved = underReview
  ? persisted
    .replace(/^state: REVIEW_ONLY$/m, `state: ${approvedState}`)
    .replace(/^ {2}product_owner: PENDING_CONTROLLER_APPROVAL$/m, '  product_owner: synthetic-in-memory-approval-not-persisted')
    .replace(/^ {2}state: BLOCKED$/m, '  state: APPROVED_PENDING_PUBLISH')
  : persisted

/** The review-only manifest, persisted under review and synthesized after approval. */
const review = underReview
  ? persisted
  : persisted
    .replace(new RegExp(`^state: ${approvedState}$`, 'm'), 'state: REVIEW_ONLY')
    .replace(/^ {2}product_owner: .+$/m, '  product_owner: PENDING_CONTROLLER_APPROVAL')
    .replace(/^ {2}state: APPROVED_PENDING_PUBLISH$/m, '  state: BLOCKED')

test('the persisted manifest matches the package it describes', () => {
  assert.match(persisted, new RegExp(`^version: ${pkg.version.replace(/[.\\+*?[^\]$(){}=!<>|:#-]/gu, '\\$&')}$`, 'm'))
  assert.match(persisted, new RegExp(`^ {2}dsh: ${declaredDsh.replace(/[.\\+*?[^\]$(){}=!<>|:#-]/gu, '\\$&')}$`, 'm'))
})

test('a candidate under review carries no persisted approval', () => {
  if (!underReview) return
  assert.match(persisted, /^state: REVIEW_ONLY$/m)
  assert.match(persisted, /^ {2}product_owner: PENDING_CONTROLLER_APPROVAL$/m)
  assert.match(persisted, /publication:\s*\n\s+state: BLOCKED\s*$/m)
  assert.doesNotMatch(persisted, /APPROVED_PENDING_PUBLISH/u, 'approval must never be persisted while under review')
  assert.doesNotMatch(persisted, new RegExp(`^state: ${approvedState}$`, 'm'))
})

test('review-only metadata cannot authorize publication', () => {
  assert.match(review, /^state: REVIEW_ONLY$/m)
  assert.match(review, /publication:\s*\n\s+state: BLOCKED\s*$/m)
  assert.throws(() => assertReleasePolicy(pkg, review, tag))
})

test('the publication guard accepts a correctly approved candidate', () => {
  // Under review this proves the guard on a synthetic approval, so a review
  // state cannot hide a guard that would reject a real approval later.
  assert.doesNotThrow(() => assertReleasePolicy(pkg, approved, tag))
})

// Every rejection below is derived from the approved fixture, so each one fails
// for the reason it names rather than because the base manifest is under review.
for (const [label, manifest, ref] of [
  ['branch dispatch', approved, 'refs/heads/main'],
  ['wrong tag', approved, 'refs/tags/v0.0.0'],
  ['wrong manifest version', approved.replace(/^version: .+$/m, 'version: 0.0.0'), tag],
  ['wrong dist-tag', approved.replace(`npm_dist_tag: ${expectedDistTag}`, `npm_dist_tag: ${otherDistTag}`), tag],
  ['wrong release state', approved.replace(`state: ${approvedState}`, `state: ${prerelease ? 'APPROVED_STABLE' : 'APPROVED_PRERELEASE'}`), tag],
  ['wrong runtime', approved.replace(`dsh: ${declaredDsh}`, 'dsh: 0.1.5-alpha.2'), tag],
  ['pending owner approval', approved.replace(/^ {2}product_owner: .+$/m, '  product_owner: PENDING_CONTROLLER_APPROVAL'), tag],
  ['blocked publication', approved.replace('state: APPROVED_PENDING_PUBLISH', 'state: BLOCKED'), tag],
]) test(`publication rejects ${label}`, () => assert.throws(() => assertReleasePolicy(pkg, manifest, ref)))
