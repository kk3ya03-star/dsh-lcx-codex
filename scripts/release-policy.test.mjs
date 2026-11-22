import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assertInstallRange, assertReleasePolicy, parseReleaseManifest } from './release-policy.mjs'
import { compareSemver, parseStrictSemver } from './semver-range.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
const recorded = readFileSync(new URL('../PUBLIC-RELEASE-MANIFEST.yml', import.meta.url), 'utf8')
const parsedRecorded = parseReleaseManifest(recorded)
const prerelease = pkg.version.includes('-')
const approvedState = prerelease ? 'APPROVED_PRERELEASE' : 'APPROVED_STABLE'
const expectedDistTag = prerelease ? 'prelatest' : 'latest'
const otherDistTag = prerelease ? 'latest' : 'prelatest'
const tag = `refs/tags/v${pkg.version}`
const declaredDsh = pkg.devDependencies['@deepseek-ai/dsh']
const escapedVersion = pkg.version.replace(/[.\\+*?[^\]$(){}=!<>|:#-]/gu, '\\$&')
const recordedMatchesPackage = parsedRecorded.top.get('version') === pkg.version

function setYamlSectionField(yamlText, sectionName, keyName, valueText) {
  const lines = yamlText.split(/\r?\n/u)
  let inSection = false
  let sectionLineIdx = -1
  let existingIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^[A-Za-z0-9_]+:/u.test(line)) {
      if (inSection) break
      if (line.trim() === `${sectionName}:`) {
        inSection = true
        sectionLineIdx = i
      }
      continue
    }
    if (inSection && new RegExp(`^  ${keyName}:(?:[ \\t]|$)`, 'u').test(line)) {
      existingIdx = i
      break
    }
  }
  const formatted = `  ${keyName}: ${valueText}`
  if (existingIdx !== -1) {
    lines[existingIdx] = formatted
    return lines.join('\n')
  }
  assert.ok(sectionLineIdx !== -1, `Fixture manifest is missing section "${sectionName}:"`)
  lines.splice(sectionLineIdx + 1, 0, formatted)
  return lines.join('\n')
}

function removeYamlSectionField(yamlText, sectionName, keyName) {
  const lines = yamlText.split(/\r?\n/u)
  let inSection = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^[A-Za-z0-9_]+:/u.test(line)) {
      if (inSection) break
      if (line.trim() === `${sectionName}:`) inSection = true
      continue
    }
    if (inSection && new RegExp(`^  ${keyName}:(?:[ \\t]|$)`, 'u').test(line)) {
      lines.splice(i, 1)
      break
    }
  }
  return lines.join('\n')
}

function applySyntheticApproval(manifest, overrides = {}) {
  const commit = overrides.commit ?? '0123456789abcdef0123456789abcdef01234567'
  const sourceCommit = overrides.sourceCommit ?? commit
  let out = setYamlSectionField(manifest, 'approval', 'product_owner', overrides.productOwner ?? 'private-issue-131-po-approved-2026-11-22')
  out = setYamlSectionField(out, 'approval', 'controller_review', overrides.controllerReview ?? 'TL_ACCEPTED_ENGINEERING_REVIEW_2026-11-22')
  out = setYamlSectionField(out, 'approval', 'tl_reviewed_product_commit', commit)
  out = setYamlSectionField(out, 'approval', 'approved_version', overrides.approvedVersion ?? pkg.version)
  out = setYamlSectionField(out, 'approval', 'final_irreversible_confirmation', overrides.finalConfirmation ?? 'RECORDED_2026-11-22')
  out = setYamlSectionField(out, 'approval', 'public_export_review', overrides.publicExportReview ?? 'TL_PASSED_REVISION_1_2026-11-22')
  out = setYamlSectionField(out, 'verification', 'state', overrides.verificationState ?? 'ENGINEERING_GATES_AND_RUNTIME_QA_PASSED_TL_ACCEPTED')
  if (overrides.runtimeQa === null) {
    out = removeYamlSectionField(out, 'verification', 'runtime_qa')
  } else {
    out = setYamlSectionField(out, 'verification', 'runtime_qa', overrides.runtimeQa ?? 'PASSED')
  }
  const manifestBasisDsh = /^ {2}dsh:\s*"?([^"\s#]+)"?/m.exec(out)?.[1]
  if (overrides.verificationDsh === null) {
    out = removeYamlSectionField(out, 'verification', 'dsh')
  } else {
    out = setYamlSectionField(out, 'verification', 'dsh', overrides.verificationDsh ?? manifestBasisDsh ?? declaredDsh)
  }
  if (overrides.verificationCommit !== null) {
    out = setYamlSectionField(out, 'verification', 'product_commit', overrides.verificationCommit ?? sourceCommit)
  }
  const hasSeededVerifiedCommit = /^ {2}verified_commit:/m.test(out)
  if (overrides.verificationVerifiedCommit === null) {
    out = removeYamlSectionField(out, 'verification', 'verified_commit')
  } else if (overrides.verificationVerifiedCommit !== undefined || hasSeededVerifiedCommit) {
    out = setYamlSectionField(out, 'verification', 'verified_commit', overrides.verificationVerifiedCommit ?? sourceCommit)
  }
  if (overrides.verificationPolicy !== null) {
    out = setYamlSectionField(
      out,
      'verification',
      'policy',
      overrides.verificationPolicy ?? '"Engineering gates + runtime QA completed under docs/qa/issue-131/RUNTIME-QA-STABLE.md"',
    )
  }
  out = setYamlSectionField(out, 'source', 'product_commit', sourceCommit)
  out = setYamlSectionField(out, 'publication', 'state', overrides.publicationState ?? 'APPROVED_PENDING_PUBLISH')
  return out
}

// Controller owns persisted governance; exercise the new candidate only in memory when the
// manifest still describes an earlier release or stays under review.
const persisted = recorded
  .replace(/^version: .+$/m, `version: ${pkg.version}`)
  .replace(/^  tag: .+$/m, `  tag: v${pkg.version}`)
  .replace(/^  npm_dist_tag: .+$/m, `  npm_dist_tag: ${expectedDistTag}`)
  .replace(/^  host_pi: .+$/m, `  host_pi: ${pkg.lcxCompatibility.verifiedHostPi}`)
  .replace(/^  plugin_pi: .+$/m, `  plugin_pi: ${pkg.devDependencies['@earendil-works/pi-ai']}`)
  .replace(/^  dsh: .+$/m, `  dsh: ${declaredDsh}`)

const underReview = parsedRecorded.top.get('state') === 'REVIEW_ONLY'

const normalizeApprovalChannel = (manifest, channel = prerelease ? 'prerelease' : 'main') => {
  const parsed = parseReleaseManifest(manifest)
  const targetState = channel === 'prerelease' ? 'APPROVED_PRERELEASE' : 'APPROVED_STABLE'
  let out = manifest.replace(/^state: .+$/m, `state: ${targetState}`)
  const hasRemain = parsed.sections.get('public_target')?.has('stable_latest_must_remain') ?? false
  const hasPrev = parsed.sections.get('public_target')?.has('previous_latest_must_be') ?? false
  if (channel === 'prerelease' || channel === 'maintenance') {
    if (!hasRemain) {
      out = hasPrev
        ? out.replace(/^ {2}previous_latest_must_be: .+$/m, '  stable_latest_must_remain: 0.6.0')
        : out.replace(/^ {2}npm_dist_tag: .+$/m, '$&\n  stable_latest_must_remain: 0.6.0')
    }
    if (channel === 'prerelease') {
      out = out.replace(/^ {2}npm_dist_tag: .+$/m, '  npm_dist_tag: prelatest')
    }
    return out
  }
  if (!hasPrev) {
    out = hasRemain
      ? out.replace(/^ {2}stable_latest_must_remain: .+$/m, '  previous_latest_must_be: 0.6.0')
      : out.replace(/^ {2}npm_dist_tag: .+$/m, '$&\n  previous_latest_must_be: 0.6.0')
  }
  return out.replace(/^ {2}npm_dist_tag: .+$/m, '  npm_dist_tag: latest')
}

/**
 * The approved manifest the publication guard is tested against.
 *
 * Under review (or before Controller updates the manifest for a new candidate) this is a
 * **synthetic in-memory fixture** and is never written to disk.
 */
const approved = (underReview || !recordedMatchesPackage)
  ? applySyntheticApproval(normalizeApprovalChannel(persisted))
  : persisted

/** The review-only manifest, persisted under review and synthesized after approval. */
const review = underReview
  ? persisted
  : persisted
    .replace(/^state: (?:APPROVED_PRERELEASE|APPROVED_STABLE)$/m, 'state: REVIEW_ONLY')
    .replace(/^ {2}product_owner: .+$/m, '  product_owner: PENDING_CONTROLLER_APPROVAL')
    .replace(/^ {2}controller_review: .+$/m, '  controller_review: PENDING')
    .replace(/^ {2}tl_reviewed_product_commit: .+$/m, '  tl_reviewed_product_commit: PENDING')
    .replace(/^ {2}approved_version: .+$/m, '  approved_version: PENDING')
    .replace(/^ {2}state: APPROVED_PENDING_PUBLISH$/m, '  state: BLOCKED')

test('the candidate policy fixture matches the package it describes', () => {
  assert.match(persisted, new RegExp(`^version: ${escapedVersion}$`, 'm'))
  assert.match(persisted, new RegExp(`^ {2}dsh: ${declaredDsh.replace(/[.\\+*?[^\]$(){}=!<>|:#-]/gu, '\\$&')}$`, 'm'))
})

test('a candidate under review carries no persisted approval', () => {
  if (!underReview) return
  assert.match(recorded, /^state: REVIEW_ONLY$/m)
  assert.match(recorded, /^ {2}product_owner: PENDING_CONTROLLER_APPROVAL$/m)
  assert.match(recorded, /publication:\s*\n\s+state: BLOCKED\s*$/m)
  assert.doesNotMatch(recorded, /APPROVED_PENDING_PUBLISH/u, 'approval must never be persisted while under review')
  assert.doesNotMatch(recorded, new RegExp(`^state: ${approvedState}$`, 'm'))
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
  ['quoted pending owner approval', approved.replace(/^ {2}product_owner: .+$/m, '  product_owner: "PENDING_CONTROLLER_APPROVAL" # pending'), tag],
  ['single-quoted pending owner approval', approved.replace(/^ {2}product_owner: .+$/m, "  product_owner: 'PENDING_CONTROLLER_APPROVAL'"), tag],
  ['blocked publication', approved.replace(/^publication:\s*\n\s+state: APPROVED_PENDING_PUBLISH$/m, 'publication:\n  state: "BLOCKED"'), tag],
  ['misplaced publication state', approved.replace(/^publication:\s*\n\s+state: APPROVED_PENDING_PUBLISH$/m, 'publication:\n  state: BLOCKED').replace(/^source:\s*$/m, 'source:\n  state: APPROVED_PENDING_PUBLISH'), tag],
]) test(`publication rejects ${label}`, () => assert.throws(() => assertReleasePolicy(pkg, manifest, ref)))

// Lifecycle-aware like the rest of this suite: a record under review or for another version must
// be refused, and once the release is approved for this version the persisted record is accepted.
test('persisted record publishes the candidate only once approved', () => {
  if (underReview || !recordedMatchesPackage) assert.throws(() => assertReleasePolicy(pkg, recorded, tag))
  else assert.doesNotThrow(() => assertReleasePolicy(pkg, recorded, tag))
})

test('install range ceilings exclude next-version prereleases and reject malformed/compound ranges', () => {
  for (const range of [
    '>=0.2.1-rc.5 <0.2.2',
    '>=0.2.2-rc.5 <0.2.3',
    '>=0.2.2-rc.5 <=0.2.3-0',
    '>=0.2.2-rc.5 <0.2.3-rc.1',
    '>=1.0.0 <2.0.0',
  ]) {
    assert.throws(() => assertInstallRange(range), /<X\.Y\.Z-0/u)
  }
  for (const bad of [
    '',
    '   ',
    '*',
    '^0.2.2-rc.5',
    '~0.2.2-rc.5',
    '0.2.x',
    '0.2.X',
    '0.2.2 - 0.2.3',
    '>0.2.2 <0.2.3-0',
    '>=0.2.2-rc.5 < 0.2.3',
    '>=0.2.2-rc.5 <= 0.2.3',
    '>=0.2.2-rc.5 < 0.2.3-0',
    '>=0.2.2-rc.5 <0.2.3-0 || >=0.2.3',
    '>=0.2.2-rc.5 <0.2.3-0 || bogus',
    '>=0.2.2-rc.5 <0.2.3-0 bogus',
    '>=0.2.3-0 <0.2.3-0',
  ]) {
    assert.throws(() => assertInstallRange(bad), undefined, bad)
  }
  assert.throws(() => assertInstallRange('>=0.2.2-rc.6 <0.2.3-0', '0.2.2-rc.5'), /must satisfy verified DSH/u)
  assert.throws(() => assertInstallRange('>=0.2.2-rc.5 <1.0.0-0', '0.2.2-rc.5'), /approved ceiling/u)
  for (const range of ['>=0.2.1-rc.5 <0.2.2-0', '>=0.2.2-rc.5 <0.2.3-0', '>=0.2.2-alpha.3', '>=1.0.0-experimental.5 <1.0.1-0'])
    assert.doesNotThrow(() => assertInstallRange(range))
  assert.doesNotThrow(() => assertInstallRange('>=0.2.2-rc.5 <0.2.3-0', '0.2.2-rc.5'))
  assert.doesNotThrow(() => assertInstallRange('>=1.0.0-experimental.5 <1.0.1-0', '1.0.0-experimental.5'))
})

test('stable release policy requires <X.Y.Z-0 minor ceiling, exact peer parity, and aligned dist-tag channel rules', () => {
  const stablePkg = {
    ...structuredClone(pkg),
    version: '0.7.0',
    devDependencies: { ...pkg.devDependencies, '@deepseek-ai/dsh': '0.2.2-rc.5' },
    lcxCompatibility: { ...pkg.lcxCompatibility, dshInstallRange: '>=0.2.2-rc.5 <0.2.3-0', verifiedDsh: '0.2.2-rc.5' },
    peerDependencies: Object.fromEntries(
      Object.entries(pkg.peerDependencies).map(([name, value]) => [
        name,
        name.startsWith('@deepseek-ai/dsh-') ? '>=0.2.2-rc.5 <0.2.3-0' : value,
      ]),
    ),
  }
  const stableManifest = applySyntheticApproval(
    normalizeApprovalChannel(
      persisted
        .replace(/^version: .+$/m, 'version: 0.7.0')
        .replace(/^  tag: .+$/m, '  tag: v0.7.0')
        .replace(/^  npm_dist_tag: .+$/m, '  npm_dist_tag: latest')
        .replace(/^  dsh: .+$/m, '  dsh: 0.2.2-rc.5'),
      'main',
    ),
    { approvedVersion: '0.7.0' },
  )
  // Ensure previous_latest_must_be exists even if recorded already had it
  const stableApproved = /^ {2}previous_latest_must_be:/m.test(stableManifest)
    ? stableManifest
    : stableManifest.replace(/^ {2}npm_dist_tag: latest$/m, '  npm_dist_tag: latest\n  previous_latest_must_be: 0.6.0')

  assert.doesNotThrow(() => assertReleasePolicy(stablePkg, stableApproved, 'refs/tags/v0.7.0'))

  for (const badRange of [
    '>=0.2.2-rc.5',
    '>=0.2.2-rc.5 <0.2.3',
    '>=0.2.2-rc.5 < 0.2.3',
    '>=0.2.2-rc.5 < 0.2.3-0',
    '>=0.2.2-rc.5 <=0.2.3',
    '>=0.2.2-rc.5 <1.0.0-0',
    '>=0.2.2-rc.5 <0.3.0-0',
    '^0.2.2-rc.5',
    '0.2.x',
    '0.2.2 - 0.2.3',
    '<0.2.3-0',
    '>=0.2.1-rc.5 <0.2.3-0',
    '>=0.2.2-rc.6 <0.2.3-0',
    '>=0.2.3-0 <0.2.3-0',
    '>=0.2.2-rc.5 <0.2.3-0 || >=0.2.3',
    '>=0.2.2-rc.5 <0.2.3-0 || bogus',
    '>=0.2.2-rc.5 <0.2.3-0 bogus',
  ]) {
    const badInstall = structuredClone(stablePkg)
    badInstall.lcxCompatibility.dshInstallRange = badRange
    assert.throws(() => assertReleasePolicy(badInstall, stableApproved, 'refs/tags/v0.7.0'), undefined, badRange)

    const badPeer = structuredClone(stablePkg)
    badPeer.peerDependencies['@deepseek-ai/dsh-llm'] = badRange
    assert.throws(() => assertReleasePolicy(badPeer, stableApproved, 'refs/tags/v0.7.0'), undefined, badRange)
  }

  // Maintenance branch stable/0.6.x -> stable-0.6 allowed only with stable_latest_must_remain; main/stable mismatch rejected
  const maintPkg = {
    ...structuredClone(stablePkg),
    version: '0.6.1',
  }
  const maintManifest = stableApproved
    .replace(/^version: .+$/m, 'version: 0.6.1')
    .replace(/^ {2}approved_version: .+$/m, '  approved_version: 0.6.1')
    .replace(/^  branch: .+$/m, '  branch: stable/0.6.x')
    .replace(/^  tag: .+$/m, '  tag: v0.6.1')
    .replace(/^  npm_dist_tag: .+$/m, '  npm_dist_tag: stable-0.6')
    .replace(/^ {2}previous_latest_must_be: .+$/m, '  stable_latest_must_remain: 0.7.0')
  const maintPolicy = assertReleasePolicy(maintPkg, maintManifest, 'refs/tags/v0.6.1')
  assert.equal(maintPolicy.branch, 'stable/0.6.x')
  assert.equal(maintPolicy.distTag, 'stable-0.6')
  assert.equal(maintPolicy.stableLatestMustRemain, '0.7.0')
  assert.throws(() => assertReleasePolicy(maintPkg, maintManifest.replace('npm_dist_tag: stable-0.6', 'npm_dist_tag: latest'), 'refs/tags/v0.6.1'))
  assert.throws(() => assertReleasePolicy(maintPkg, maintManifest.replace(/^ {2}stable_latest_must_remain: .+$/m, '  previous_latest_must_be: 0.6.0'), 'refs/tags/v0.6.1'))
  assert.throws(() => assertReleasePolicy(stablePkg, stableApproved.replace('npm_dist_tag: latest', 'npm_dist_tag: stable-0.7'), 'refs/tags/v0.7.0'))

  // Prerelease validation also rejects bare/spaced/mismatched peer ranges
  const prePkg = {
    ...structuredClone(pkg),
    version: '0.7.0-pre.2',
    devDependencies: { ...pkg.devDependencies, '@deepseek-ai/dsh': '0.2.2-rc.5' },
    lcxCompatibility: { ...pkg.lcxCompatibility, dshInstallRange: '>=0.2.2-rc.5', verifiedDsh: '0.2.2-rc.5' },
    peerDependencies: Object.fromEntries(
      Object.entries(pkg.peerDependencies).map(([name, value]) => [
        name,
        name.startsWith('@deepseek-ai/dsh-') ? '>=0.2.2-rc.5 <0.2.3' : value,
      ]),
    ),
  }
  const preManifest = normalizeApprovalChannel(
    stableManifest
      .replace(/^version: .+$/m, 'version: 0.7.0-pre.2')
      .replace(/^ {2}approved_version: .+$/m, '  approved_version: 0.7.0-pre.2')
      .replace(/^  tag: .+$/m, '  tag: v0.7.0-pre.2')
      .replace(/^  npm_dist_tag: .+$/m, '  npm_dist_tag: prelatest'),
    'prerelease',
  )
  assert.throws(() => assertReleasePolicy(prePkg, preManifest, 'refs/tags/v0.7.0-pre.2'), /<X\.Y\.Z-0/u)
  const preMismatch = structuredClone(prePkg)
  preMismatch.peerDependencies = Object.fromEntries(
    Object.entries(pkg.peerDependencies).map(([name, value]) => [
      name,
      name.startsWith('@deepseek-ai/dsh-') ? '>=0.2.2-rc.5 <0.2.3-0' : value,
    ]),
  )
  assert.throws(() => assertReleasePolicy(preMismatch, preManifest, 'refs/tags/v0.7.0-pre.2'), /must match lcxCompatibility\.dshInstallRange/u)
})

test('P1-2, P1-4, P1-5 & P3-2: supports quoted/commented persisted manifests, maintenance 0.7.x, strict YAML/downgrade rejection, and BigInt/<0.0.0-0 semver', () => {
  const stablePkg = {
    ...structuredClone(pkg),
    version: '0.7.0',
    devDependencies: { ...pkg.devDependencies, '@deepseek-ai/dsh': '0.2.2-rc.5' },
    lcxCompatibility: { ...pkg.lcxCompatibility, dshInstallRange: '>=0.2.2-rc.5 <0.2.3-0', verifiedDsh: '0.2.2-rc.5' },
    peerDependencies: Object.fromEntries(
      Object.entries(pkg.peerDependencies).map(([name, value]) => [
        name,
        name.startsWith('@deepseek-ai/dsh-') ? '>=0.2.2-rc.5 <0.2.3-0' : value,
      ]),
    ),
  }

  // Quoted + commented scalars in persisted-style manifest decode cleanly and detect REVIEW_ONLY vs APPROVED_STABLE
  const quotedApproved = applySyntheticApproval(
    normalizeApprovalChannel(
      persisted
        .replace(/^version: .+$/m, 'version: "0.7.0" # candidate')
        .replace(/^ {2}branch: .+$/m, "  branch: 'main' # target")
        .replace(/^ {2}tag: .+$/m, '  tag: "v0.7.0" # release tag')
        .replace(/^ {2}npm_dist_tag: .+$/m, "  npm_dist_tag: 'latest'")
        .replace(/^ {2}dsh: .+$/m, '  dsh: "0.2.2-rc.5"'),
      'main',
    ),
    {
      productOwner: '"po-approved" # ok',
      controllerReview: '"TL_ACCEPTED_2026-11-22" # ok',
      commit: '"0123456789abcdef0123456789abcdef01234567"',
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      approvedVersion: '"0.7.0"',
      finalConfirmation: '"RECORDED_2026-11-22"',
      publicExportReview: '"TL_PASSED_REVISION_1_2026-11-22"',
      publicationState: '"APPROVED_PENDING_PUBLISH" # ready',
    },
  )
  const parsedQuoted = parseReleaseManifest(quotedApproved)
  assert.equal(parsedQuoted.top.get('version'), '0.7.0')
  assert.equal(parsedQuoted.top.get('state'), 'APPROVED_STABLE')
  assert.doesNotThrow(() => assertReleasePolicy(stablePkg, quotedApproved, 'refs/tags/v0.7.0'))

  // Maintenance fixture stable/0.7.x -> stable-0.7 preserves maintenance dist-tag cleanly
  const maint07Pkg = { ...structuredClone(stablePkg), version: '0.7.1' }
  const maint07Manifest = normalizeApprovalChannel(
    quotedApproved
      .replace(/^version: .+$/m, 'version: 0.7.1')
      .replace(/^ {2}approved_version: .+$/m, '  approved_version: 0.7.1')
      .replace(/^ {2}branch: .+$/m, '  branch: stable/0.7.x')
      .replace(/^ {2}tag: .+$/m, '  tag: v0.7.1')
      .replace(/^ {2}npm_dist_tag: .+$/m, '  npm_dist_tag: stable-0.7')
      .replace(/^ {2}previous_latest_must_be: .+$/m, '  stable_latest_must_remain: 0.8.0'),
    'maintenance',
  )
  const maint07Policy = assertReleasePolicy(maint07Pkg, maint07Manifest, 'refs/tags/v0.7.1')
  assert.equal(maint07Policy.branch, 'stable/0.7.x')
  assert.equal(maint07Policy.distTag, 'stable-0.7')
  assert.equal(maint07Policy.stableLatestMustRemain, '0.8.0')

  // Round 6 P2-3: disallow inactive channel baseline fields and require explicit SemVer on all runtime fields
  assert.throws(
    () =>
      assertReleasePolicy(
        stablePkg,
        quotedApproved.replace(/^ {2}previous_latest_must_be: .+$/m, '  previous_latest_must_be: 0.6.0\n  stable_latest_must_remain: 0.6.0'),
        'refs/tags/v0.7.0',
      ),
    /stable_latest_must_remain/u,
  )
  assert.throws(
    () =>
      assertReleasePolicy(
        maint07Pkg,
        maint07Manifest.replace(/^ {2}stable_latest_must_remain: .+$/m, '  stable_latest_must_remain: 0.8.0\n  previous_latest_must_be: 0.6.0'),
        'refs/tags/v0.7.1',
      ),
    /previous_latest_must_be/u,
  )
  const pre07Pkg = {
    ...structuredClone(stablePkg),
    version: '0.7.0-pre.2',
    lcxCompatibility: { ...stablePkg.lcxCompatibility, dshInstallRange: '>=0.2.2-rc.5' },
    peerDependencies: Object.fromEntries(
      Object.entries(stablePkg.peerDependencies).map(([name, value]) => [
        name,
        name.startsWith('@deepseek-ai/dsh-') ? '>=0.2.2-rc.5' : value,
      ]),
    ),
  }
  const pre07Manifest = normalizeApprovalChannel(
    quotedApproved
      .replace(/^version: .+$/m, 'version: 0.7.0-pre.2')
      .replace(/^ {2}approved_version: .+$/m, '  approved_version: 0.7.0-pre.2')
      .replace(/^ {2}tag: .+$/m, '  tag: v0.7.0-pre.2')
      .replace(/^ {2}install_range: .+$/m, '  install_range: ">=0.2.2-rc.5"'),
    'prerelease',
  )
  assert.doesNotThrow(() => assertReleasePolicy(pre07Pkg, pre07Manifest, 'refs/tags/v0.7.0-pre.2'))
  assert.throws(
    () =>
      assertReleasePolicy(
        pre07Pkg,
        pre07Manifest.replace(/^ {2}stable_latest_must_remain: .+$/m, '  stable_latest_must_remain: 0.6.0\n  previous_latest_must_be: 0.6.0'),
        'refs/tags/v0.7.0-pre.2',
      ),
    /previous_latest_must_be/u,
  )

  const noHostPiPkg = structuredClone(stablePkg)
  delete noHostPiPkg.lcxCompatibility.verifiedHostPi
  assert.throws(
    () => assertReleasePolicy(noHostPiPkg, quotedApproved.replace(/^ {2}host_pi: .+\r?\n/m, ''), 'refs/tags/v0.7.0'),
    /verifiedHostPi|host_pi/iu,
  )
  const noPluginPiPkg = structuredClone(stablePkg)
  delete noPluginPiPkg.lcxCompatibility.verifiedPluginPi
  assert.throws(
    () => assertReleasePolicy(noPluginPiPkg, quotedApproved.replace(/^ {2}plugin_pi: .+\r?\n/m, ''), 'refs/tags/v0.7.0'),
    /verifiedPluginPi|plugin_pi/iu,
  )
  assert.throws(
    () => assertReleasePolicy(stablePkg, quotedApproved.replace(/^ {2}host_pi: .+$/m, '  host_pi: not-a-semver'), 'refs/tags/v0.7.0'),
    /host_pi/u,
  )
  const noDshDepPkg = structuredClone(stablePkg)
  delete noDshDepPkg.devDependencies['@deepseek-ai/dsh']
  assert.throws(() => assertReleasePolicy(noDshDepPkg, quotedApproved, 'refs/tags/v0.7.0'))
  const noDshAnyPkg = structuredClone(noDshDepPkg)
  delete noDshAnyPkg.lcxCompatibility.verifiedDsh
  assert.throws(
    () => assertReleasePolicy(noDshAnyPkg, quotedApproved.replace(/^ {2}dsh: .+\r?\n/m, ''), 'refs/tags/v0.7.0'),
    /is required|SemVer|dsh|verifiedDsh/iu,
  )
  const noPiDepPkg = structuredClone(stablePkg)
  delete noPiDepPkg.devDependencies['@earendil-works/pi-ai']
  assert.throws(() => assertReleasePolicy(noPiDepPkg, quotedApproved, 'refs/tags/v0.7.0'))
  const noPiAnyPkg = structuredClone(noPiDepPkg)
  delete noPiAnyPkg.lcxCompatibility.verifiedPluginPi
  assert.throws(
    () => assertReleasePolicy(noPiAnyPkg, quotedApproved.replace(/^ {2}plugin_pi: .+\r?\n/m, ''), 'refs/tags/v0.7.0'),
    /is required|SemVer|plugin_pi|verifiedPluginPi/iu,
  )

  // P1-4: reject duplicate keys, null/~/booleans, inline/block collections, blank owner, and tabs
  for (const [label, badYaml, expectedErr] of [
    ['duplicate top-level key', `${quotedApproved}\nstate: REVIEW_ONLY`],
    ['duplicate section key', quotedApproved.replace(/^publication:\s*\n\s+state: .+$/m, 'publication:\n  state: BLOCKED\n  state: APPROVED_PENDING_PUBLISH')],
    ['duplicate inline list key in source', quotedApproved.replace(/^ {2}engineering_issues: .+$/m, '  engineering_issues: [131]\n  engineering_issues: [132]')],
    ['null scalar', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: null')],
    ['tilde null scalar', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: ~')],
    ['boolean scalar', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: true')],
    ['inline mapping collection', quotedApproved.replace(/^publication:\s*\n\s+state: .+$/m, 'publication:\n  state: { ok: true }')],
    ['inline sequence collection', quotedApproved.replace(/^ {2}branch: .+$/m, '  branch: [main]')],
    ['blank quoted product_owner', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: "   "')],
    ['pending-prefixed product_owner', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: PENDING'), /Explicit positive Product Owner approval required/u],
    ['list item inside control section', quotedApproved.replace(/^approval:\s*$/m, 'approval:\n  - unexpected')],
    ['control top-level key as section', quotedApproved.replace(/^version: .+$/m, 'version:\n  nested: 0.7.0')],
    ['tab indentation', quotedApproved.replace(/^ {2}branch: .+$/m, '\tbranch: main')],
    ['missing separator after top-level colon', quotedApproved.replace(/^state: .+$/m, 'state:APPROVED_STABLE')],
    ['missing separator after nested colon', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner:Reviewer approved')],
    ['NBSP after top-level colon', quotedApproved.replace(/^state: .+$/m, 'state:\u00a0APPROVED_STABLE')],
    ['NBSP after nested colon', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner:\u00a0po-approved')],
    ['NBSP indentation', quotedApproved.replace(/^ {2}branch: .+$/m, '\u00a0\u00a0branch: main')],
    ['NBSP before unquoted scalar', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: \u00a0po-approved')],
    ['NEL U+0085 after top-level colon', quotedApproved.replace(/^state: .+$/m, 'state:\u0085APPROVED_STABLE')],
    ['NEL U+0085 after nested colon', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner:\u0085po-approved')],
    ['NEL U+0085 indentation', quotedApproved.replace(/^ {2}branch: .+$/m, '\u0085\u0085branch: main')],
    ['NEL U+0085 before unquoted scalar', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: \u0085po-approved')],
    ['BOM U+FEFF before unquoted scalar', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: \ufeffpo-approved')],
    ['BOM U+FEFF at file start', `\ufeff${quotedApproved}`],
    ['BOM-only quoted product_owner', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: "\ufeff"')],
    ['Unicode whitespace-only quoted product_owner', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: "\u0085\u00a0"')],
    ['template placeholder required product_owner', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: required')],
    ['APPROVED_REQUIRED product_owner', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: APPROVED_REQUIRED')],
    ['po-never-approved product_owner', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: po-never-approved')],
    ['explicit REJECTED product_owner', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: REJECTED')],
    ['explicit UNAPPROVED product_owner', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: UNAPPROVED')],
    ['negated po-not-approved', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: po-not-approved')],
    ['stale issue in product_owner', quotedApproved.replace(/^ {2}product_owner: .+$/m, '  product_owner: private-issue-129-po-approved-2026-11-04')],
    ['stale #129 approval without issue fields', quotedApproved.replace(/^ {2}engineering_issue: 131\r?\n/m, '').replace(/^ {2}product_owner: .+$/m, '  product_owner: private-issue-129-po-approved-2026-11-04')],
    ['stale issue in approval_reference', quotedApproved.replace(/^approval:\s*$/m, 'approval:\n  approval_reference: docs/qa/issue-129/PRODUCT-OWNER-APPROVAL.md')],
    ['pending controller_review', quotedApproved.replace(/^ {2}controller_review: .+$/m, '  controller_review: PENDING')],
    ['missing controller_review', quotedApproved.replace(/^ {2}controller_review: .+\r?\n/m, '')],
    ['TL_ACCEPTED_HOLD controller_review', quotedApproved.replace(/^ {2}controller_review: .+$/m, '  controller_review: TL_ACCEPTED_HOLD')],
    ['rejected controller_review', quotedApproved.replace(/^ {2}controller_review: .+$/m, '  controller_review: TL_REJECTED')],
    ['pending tl_reviewed_product_commit', quotedApproved.replace(/^ {2}tl_reviewed_product_commit: .+$/m, '  tl_reviewed_product_commit: PENDING')],
    ['missing tl_reviewed_product_commit', quotedApproved.replace(/^ {2}tl_reviewed_product_commit: .+\r?\n/m, '')],
    ['short tl_reviewed_product_commit', setYamlSectionField(quotedApproved, 'approval', 'tl_reviewed_product_commit', 'deadbeef')],
    ['missing source.product_commit', removeYamlSectionField(quotedApproved, 'source', 'product_commit')],
    ['mismatched source.product_commit', setYamlSectionField(quotedApproved, 'source', 'product_commit', 'ffffffffffffffffffffffffffffffffffffffff')],
    ['source.product_commit flow-list bypass', setYamlSectionField(quotedApproved, 'source', 'product_commit', '[abc]')],
    ['missing final_irreversible_confirmation', removeYamlSectionField(quotedApproved, 'approval', 'final_irreversible_confirmation')],
    ['FAILED final_irreversible_confirmation', setYamlSectionField(quotedApproved, 'approval', 'final_irreversible_confirmation', 'FAILED')],
    ['PENDING final_irreversible_confirmation', setYamlSectionField(quotedApproved, 'approval', 'final_irreversible_confirmation', 'PENDING')],
    ['missing public_export_review', removeYamlSectionField(quotedApproved, 'approval', 'public_export_review')],
    ['FAILED public_export_review', setYamlSectionField(quotedApproved, 'approval', 'public_export_review', 'FAILED')],
    ['PENDING public_export_review', setYamlSectionField(quotedApproved, 'approval', 'public_export_review', 'PENDING')],
    ['escaped BOM in quoted product_owner', setYamlSectionField(quotedApproved, 'approval', 'product_owner', '"\\ufeff"'), /must be a non-empty string/u],
    ['trailing escaped BOM in quoted product_owner', setYamlSectionField(quotedApproved, 'approval', 'product_owner', '"po-approved\\ufeff"'), /Unsupported invisible\/BOM format character/u],
    ['invisible zero-width space in quoted work_branch', setYamlSectionField(setYamlSectionField(quotedApproved, 'approval', 'work_branch', '"work/\\u200b"'), 'source', 'work_branch', '"work/\\u200b"'), /Unsupported invisible\/BOM format character/u],
    ['invisible zero-width space after valid work_branch', setYamlSectionField(setYamlSectionField(quotedApproved, 'approval', 'work_branch', '"work/131-stable\\u200b"'), 'source', 'work_branch', '"work/131-stable\\u200b"'), /Unsupported invisible\/BOM format character/u],
    ['escaped BOM in quoted work_branch', setYamlSectionField(setYamlSectionField(quotedApproved, 'approval', 'work_branch', '"work/131\\ufeff"'), 'source', 'work_branch', '"work/131\\ufeff"'), /Unsupported invisible\/BOM format character/u],
    ['whitespace-only quoted work_branch', setYamlSectionField(setYamlSectionField(quotedApproved, 'approval', 'work_branch', '"   "'), 'source', 'work_branch', '"   "'), /must be a non-empty string/u],
    ['non-ref work_branch', setYamlSectionField(setYamlSectionField(quotedApproved, 'approval', 'work_branch', 'feature/invalid'), 'source', 'work_branch', 'feature/invalid'), /valid Git branch ref/u],
    ['pending runtime-QA verification.state', setYamlSectionField(quotedApproved, 'verification', 'state', 'ENGINEERING_GATES_PASSED_RUNTIME_QA_PENDING'), /Explicit positive verification\.state/u],
    ['PENDING verification.state', setYamlSectionField(quotedApproved, 'verification', 'state', 'PENDING'), /Explicit positive verification\.state/u],
    ['RUNTIME_QA_PASSED_FAILED verification.state', setYamlSectionField(quotedApproved, 'verification', 'state', 'RUNTIME_QA_PASSED_FAILED'), /Explicit positive verification\.state/u],
    ['missing verification.state', removeYamlSectionField(quotedApproved, 'verification', 'state'), /Explicit positive verification\.state/u],
    ['FAILED verification.state', setYamlSectionField(quotedApproved, 'verification', 'state', 'FAILED'), /Explicit positive verification\.state/u],
    ['BLOCKED verification.state', setYamlSectionField(quotedApproved, 'verification', 'state', 'BLOCKED'), /Explicit positive verification\.state/u],
    ['missing verification commits', removeYamlSectionField(removeYamlSectionField(quotedApproved, 'verification', 'product_commit'), 'verification', 'verified_commit'), /verification\.product_commit or verification\.verified_commit is required/u],
    ['mismatched verification.product_commit', setYamlSectionField(quotedApproved, 'verification', 'product_commit', 'ffffffffffffffffffffffffffffffffffffffff'), /verification\.product_commit must match source\.product_commit/u],
    ['mismatched verification.verified_commit', setYamlSectionField(quotedApproved, 'verification', 'verified_commit', 'ffffffffffffffffffffffffffffffffffffffff'), /verification\.verified_commit must match source\.product_commit/u],
    ['missing verification.policy', removeYamlSectionField(quotedApproved, 'verification', 'policy'), /verification\.policy is required/u],
    ['pending wording in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Engineering gates passed; runtime QA remain pending; no runtime claim is made."'), /verification\.policy must not contain pending/u],
    ['No runtime QA was run in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"No runtime QA was run."'), /verification\.policy must not contain pending/u],
    ['Runtime QA has not been completed in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA has not been completed."'), /verification\.policy must not contain pending/u],
    ['mixed affirmative and negated runtime QA in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed, except no runtime QA was run."'), /verification\.policy must not contain pending/u],
    ['Runtime QA did not pass in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA did not pass"'), /verification\.policy must not contain pending/u],
    ['Runtime QA will be completed tomorrow in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA will be completed tomorrow"'), /verification\.policy must not contain pending/u],
    ['Post-release verification did not pass in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Post-release verification did not pass"'), /verification\.policy must not contain pending/u],
    ['mixed Engineering gates passed + did not pass in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Engineering gates passed; runtime QA did not pass"'), /verification\.policy must not contain pending/u],
    ['No evidence that runtime QA passed in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"No evidence that runtime QA passed"'), /verification\.policy must not contain pending/u],
    ['Runtime QA could be completed tomorrow in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA could be completed tomorrow"'), /verification\.policy must not contain pending/u],
    ['Engineering gates passed, runtime QA status remains unknown in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Engineering gates passed, runtime QA status remains unknown"'), /verification\.policy must not contain pending/u],
    ['no affirmative runtime QA claim in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Engineering gates passed."'), /must affirmatively state completed runtime QA/u],
    ['embedded mismatched SHA in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Verified product commit deadbeefdeadbeefdeadbeefdeadbeefdeadbeef under docs/qa/issue-131/RUNTIME-QA-STABLE.md"'), /Mismatched commit SHA/u],
    ['embedded short Verified commit SHA in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed; Verified commit deadbeef under docs/qa/issue-131/RUNTIME-QA-STABLE.md"'), /Mismatched(?: product)? commit SHA/u],
    ['embedded bare commit SHA in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed; commit deadbeef"'), /Mismatched(?: product)? commit SHA/u],
    ['Markdown backtick Verified commit SHA in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA completed. Verified commit `deadbeef`"'), /Mismatched(?: product)? commit SHA/u],
    ['parenthesized backtick commit SHA in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA completed; commit (`deadbeef`)"'), /Mismatched(?: product)? commit SHA/u],
    ['curly-quoted verified commit SHA in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA completed; verified commit “deadbeef”"'), /Mismatched(?: product)? commit SHA/u],
    ['Markdown bold **Commit** SHA in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA completed; **Commit** `deadbeef`"'), /Mismatched(?: product)? commit SHA/u],
    ['verified commit SHA label in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA completed; verified commit SHA deadbeef"'), /Mismatched(?: product)? commit SHA/u],
    ['stale Private Issue #129 in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Verified under Private Issue #129"'), /Stale or mismatched issue reference #129 in verification\.policy/u],
    ['stale private-issue in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Verified private-issue-129 and docs/qa/issue-129/RUNTIME-QA.md"'), /Stale or mismatched issue reference #129 in verification\.policy/u],
    ['missing verification.runtime_qa for issue >= 131', removeYamlSectionField(quotedApproved, 'verification', 'runtime_qa'), /Explicit verification\.runtime_qa: PASSED is required/u],
    ['PENDING verification.runtime_qa for issue >= 131', setYamlSectionField(quotedApproved, 'verification', 'runtime_qa', 'PENDING'), /Explicit verification\.runtime_qa: PASSED is required/u],
    ['FAILED verification.runtime_qa for issue >= 131', setYamlSectionField(quotedApproved, 'verification', 'runtime_qa', 'FAILED'), /Explicit verification\.runtime_qa: PASSED is required/u],
    ['Once runtime QA completed future sign-off in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Once the runtime QA is completed, we can sign off"'), /verification\.policy must not contain pending/u],
    ['When runtime QA completed in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"When runtime QA is completed, ship it"'), /verification\.policy must not contain pending/u],
    ['Engineering review passed for runtime QA plan in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Engineering review passed for the runtime QA plan"'), /verification\.policy must not contain pending/u],
    ['Engineering review passed for runtime QA checklist in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Engineering review passed for the runtime QA checklist"'), /must affirmatively state completed runtime QA/u],
    ['Runtime QA plan passed in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA plan passed"'), /verification\.policy must not contain pending/u],
    ['No sign yet runtime QA example in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"No sign yet, runtime QA passed only in the example"'), /verification\.policy must not contain pending/u],
    ['Dry-run runtime QA in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed in dry-run"'), /verification\.policy must not contain pending/u],
    ['Issue 131 historical mask ENGINEERING_PASS not VERIFIED disallowed', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed; ENGINEERING_PASS, not VERIFIED."'), /verification\.policy must not contain pending/u],
    ['Issue 131 historical mask not npm payload disallowed', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed; not npm payload."'), /verification\.policy must not contain pending/u],
    ['colon commit:deadbeef in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed; verified commit:deadbeef"'), /Mismatched(?: product)? commit SHA/u],
    ['equals commit=deadbeef in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed; commit=deadbeef"'), /Mismatched(?: product)? commit SHA/u],
    ['labeled commit SHA=deadbeef in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed; commit SHA=deadbeef"'), /Mismatched(?: product)? commit SHA/u],
    ['plural commits deadbeef and cafebabe in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed; commits deadbeef and cafebabe"'), /Mismatched product commit SHA/u],
    ['mixed plural commits 0123456 and deadbeef in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed; commits 0123456 and deadbeef"'), /Mismatched product commit SHA deadbeef/u],
    ['missing verification.dsh for non-legacy', removeYamlSectionField(quotedApproved, 'verification', 'dsh'), /verification\.dsh must match runtime_basis\.dsh/u],
    ['wrong verification.dsh for non-legacy', setYamlSectionField(quotedApproved, 'verification', 'dsh', '0.2.1-rc.5'), /verification\.dsh must match runtime_basis\.dsh/u],
    ['POST_RELEASE_VERIFIED disallowed on non-legacy 0.7.0', setYamlSectionField(quotedApproved, 'verification', 'state', 'POST_RELEASE_VERIFIED'), /Explicit positive verification\.state/u],
    ['POST_RELEASE_CHECKED disallowed on non-legacy 0.7.0', setYamlSectionField(quotedApproved, 'verification', 'state', 'POST_RELEASE_CHECKED'), /Explicit positive verification\.state/u],
    ['simulator runtime QA prose disallowed', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed in a simulator."'), /verification\.policy must not contain pending/u],
    ['test double runtime QA prose disallowed', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed in a test double."'), /verification\.policy must not contain pending/u],
    ['mismatched DSH version 0.2.1-rc.5 in verification.policy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA on DSH 0.2.1-rc.5 has passed."'), /Mismatched DSH version 0\.2\.1-rc\.5/u],
    ['standalone Post-release verification passed disallowed on non-legacy', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Post-release verification passed."'), /verification\.policy must not contain pending/u],
    ['unparenthesized stop-condition not mask disallowed on non-legacy 0.7.0', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed, both stop conditions not hit."'), /verification\.policy must not contain pending/u],
    ['engineering gates stop-condition not paren disallowed on non-legacy 0.7.0', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Engineering gates passed (both stop conditions not hit); Runtime QA passed."'), /verification\.policy must not contain pending/u],
    ['engineering gates custom parens disallowed on non-legacy 0.7.0', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Engineering gates passed (custom note); Runtime QA passed."'), /verification\.policy contains unrecognized clause/u],
    ['unrecognized trailing clause only replayed fixtures disallowed', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed; only replayed fixtures."'), /verification\.policy contains unrecognized clause/u],
    ['unrecognized parenthesized mismatched DSH clause disallowed', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed; (on DSH 0.2.1-rc.5)."'), /Mismatched DSH version 0\.2\.1-rc\.5/u],
    ['unrecognized parenthesized matching DSH clause disallowed', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed; (on DSH 0.2.2-rc.5)."'), /verification\.policy contains unrecognized clause/u],
    ['comma-and commit list deadbeef bypass disallowed', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed; commits 0123456, and deadbeef"'), /Mismatched product commit SHA deadbeef/u],
    ['Oxford-comma commit list deadbeef bypass disallowed', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed; commits 0123456, deadbeef, and cafebabe"'), /Mismatched product commit SHA deadbeef/u],
    ['glued parenthesized commitdeadbeef disallowed', setYamlSectionField(quotedApproved, 'verification', 'policy', '"Runtime QA passed (commitdeadbeef)."'), /Malformed commit SHA reference|Mismatched(?: product)? commit SHA/u],
    ['synthetic 0.7.0 claiming engineering_issue 129 with work/131 rejected', setYamlSectionField(setYamlSectionField(quotedApproved, 'approval', 'engineering_issue', '129'), 'source', 'engineering_issue', '129'), /source\.work_branch .* must match engineering_issue #129/u],
    ['synthetic 0.7.0 claiming engineering_issue 129 and work/129-stable-0.7.0 without runtime_qa/dsh rejected', removeYamlSectionField(removeYamlSectionField(setYamlSectionField(setYamlSectionField(setYamlSectionField(setYamlSectionField(quotedApproved, 'approval', 'engineering_issue', '129'), 'source', 'engineering_issue', '129'), 'approval', 'work_branch', 'work/129-stable-0.7.0'), 'source', 'work_branch', 'work/129-stable-0.7.0'), 'verification', 'runtime_qa'), 'verification', 'dsh'), /Explicit verification\.runtime_qa: PASSED is required/u],
    ['400-digit engineering_issue rejected by bounded digit guard', setYamlSectionField(setYamlSectionField(quotedApproved, 'approval', 'engineering_issue', '9'.repeat(400)), 'source', 'engineering_issue', '9'.repeat(400)), /positive integer without leading zeros/u],
    ['aligned 400-digit engineering_issue and work_branch rejected', setYamlSectionField(setYamlSectionField(setYamlSectionField(setYamlSectionField(setYamlSectionField(setYamlSectionField(quotedApproved, 'approval', 'product_owner', 'po-approved-2026-11-22'), 'approval', 'engineering_issue', '9'.repeat(400)), 'source', 'engineering_issue', '9'.repeat(400)), 'approval', 'work_branch', `work/${'9'.repeat(400)}-stable`), 'source', 'work_branch', `work/${'9'.repeat(400)}-stable`), 'verification', 'policy', '"Runtime QA passed"'), /positive integer without leading zeros/u],
    ['leading-zero engineering_issue rejected', setYamlSectionField(setYamlSectionField(quotedApproved, 'approval', 'engineering_issue', '0131'), 'source', 'engineering_issue', '0131'), /positive integer without leading zeros/u],
    ['stale approved_version', setYamlSectionField(quotedApproved, 'approval', 'approved_version', '0.6.0'), /approved_version must match package\.json/u],
    ['missing approved_version', removeYamlSectionField(quotedApproved, 'approval', 'approved_version'), /approved_version is required/u],
    ['missing approval.work_branch', removeYamlSectionField(quotedApproved, 'approval', 'work_branch'), /work_branch is required/u],
    ['mismatched approval.engineering_issue', setYamlSectionField(quotedApproved, 'approval', 'engineering_issue', '129'), /engineering_issue must match/u],
  ]) {
    assert.throws(() => assertReleasePolicy(stablePkg, badYaml, 'refs/tags/v0.7.0'), expectedErr ?? undefined, `Expected rejection for ${label}`)
  }

  // Round 10 P1-3 & Round 12 P2-7: synthetic fixtures overwrite pre-seeded real-shaped SHAs across approval/source/verification
  const persistedWithRealCommit = setYamlSectionField(
    setYamlSectionField(
      setYamlSectionField(
        persisted
          .replace(/^version: .+$/m, 'version: 0.7.0')
          .replace(/^  tag: .+$/m, '  tag: v0.7.0')
          .replace(/^  npm_dist_tag: .+$/m, '  npm_dist_tag: latest')
          .replace(/^  dsh: .+$/m, '  dsh: 0.2.2-rc.5'),
        'source',
        'product_commit',
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      ),
      'verification',
      'product_commit',
      'cafebabecafebabecafebabecafebabecafebabe',
    ),
    'verification',
    'verified_commit',
    'feedfacefeedfacefeedfacefeedfacefeedface',
  )
  const syntheticFromRealBase = applySyntheticApproval(
    normalizeApprovalChannel(persistedWithRealCommit, 'main'),
    { approvedVersion: '0.7.0' },
  )
  assert.doesNotThrow(() => assertReleasePolicy(stablePkg, syntheticFromRealBase, 'refs/tags/v0.7.0'))

  // Round 12 P1-1: valid upstream issue notes (Upstream issue-105, Issue #105, #62) and closed non-legacy verification.state enum values pass
  for (const validState of ['ENGINEERING_GATES_AND_RUNTIME_QA_PASSED_TL_ACCEPTED', 'RUNTIME_QA_PASSED']) {
    const validUpstreamManifest = setYamlSectionField(
      setYamlSectionField(quotedApproved, 'verification', 'state', validState),
      'verification',
      'policy',
      '"Runtime QA passed for #131; Upstream issue-105 and Issue #105 / #62 remain tracked."',
    )
    assert.doesNotThrow(() => assertReleasePolicy(stablePkg, validUpstreamManifest, 'refs/tags/v0.7.0'))
  }

  // Round 13-19 P1-1/P1-2/P1-3/P2-1: verify immutable archived 0.6.0 and 0.7.0-pre.1 commits (via git cat-file -e, NEVER mutable main/dev branch refs) plus complete inline fallbacks pass while rejecting altered records
  const readGitShowOptional = (spec) => {
    try {
      return execFileSync('git', ['show', spec], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return null
    }
  }
  const hasGitCommit = (commitSha) => {
    try {
      execFileSync('git', ['cat-file', '-e', `${commitSha}^{commit}`], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
  const legacyGitSpecs = [
    ['be8d90bd70e3a6ec576dd7bf4fad7e5310797589', 'refs/tags/v0.6.0', '0.6.0', 'stable/0.6.x', 'latest'],
    ['c4211438b4a0c2c390080fc7838876264feeeccb', 'refs/tags/v0.7.0-pre.1', '0.7.0-pre.1', 'main', 'prelatest'],
  ]
  for (const [legacyCommit, legacyTag, expectedVer, expectedBranch, expectedDist] of legacyGitSpecs) {
    if (!hasGitCommit(legacyCommit)) continue
    const legacyManifest = readGitShowOptional(`${legacyCommit}:PUBLIC-RELEASE-MANIFEST.yml`)
    const legacyPkgRaw = readGitShowOptional(`${legacyCommit}:package.json`)
    assert.ok(legacyManifest && legacyPkgRaw, `Expected manifest & package.json on immutable commit ${legacyCommit}`)
    const legacyPkg = JSON.parse(legacyPkgRaw)
    const legacyRes = assertReleasePolicy(legacyPkg, legacyManifest, legacyTag)
    assert.equal(legacyRes.version, expectedVer)
    assert.equal(legacyRes.branch, expectedBranch)
    assert.equal(legacyRes.distTag, expectedDist)
    assert.throws(
      () =>
        assertReleasePolicy(
          legacyPkg,
          setYamlSectionField(legacyManifest, 'verification', 'policy', '"Runtime QA passed; commits d913800dead and 7a22654dead"'),
          legacyTag,
        ),
      /Mismatched product commit SHA|approval\.engineering_issue|approval\.approved_version|Explicit verification\.runtime_qa/u,
    )
  }
  // Always also validate immutable 0.6.0 and 0.7.0-pre.1 release records independent of shallow CI checkout refs
  const mainLegacyPkgFallback = {
    ...structuredClone(pkg),
    version: '0.6.0',
    devDependencies: { ...pkg.devDependencies, '@deepseek-ai/dsh': '0.2.1-rc.5', '@earendil-works/pi-ai': '1.5.0' },
    peerDependencies: Object.fromEntries(
      Object.entries(pkg.peerDependencies).map(([k, v]) => [k, k.startsWith('@deepseek-ai/dsh-') ? '>=0.2.1-rc.5 <0.2.2-0' : v]),
    ),
    lcxCompatibility: {
      dshInstallRange: '>=0.2.1-rc.5 <0.2.2-0',
      verifiedDsh: '0.2.1-rc.5',
      verifiedHostPi: '1.5.0',
      verifiedPluginPi: '1.5.0',
    },
  }
  const mainLegacyManifestFallback = [
    `version: 0.6.0`,
    `state: APPROVED_STABLE`,
    `approval:`,
    `  product_owner: private-issue-129-po-approved-2026-11-04`,
    `  controller_review: TL_ACCEPTED_ENGINEERING_REVIEW_2026-11-04`,
    `  public_export_review: TL_PASSED_REVISION_2_2026-11-04`,
    `  approval_reference: docs/qa/issue-129/PRODUCT-OWNER-APPROVAL.md`,
    `  final_irreversible_confirmation: RECORDED_2026-11-04`,
    `  tl_reviewed_product_commit: 397dce88e31274e086dc2f610afdc535d8154438`,
    `  reference: Issue 129 stable candidate, re-baselined by the Product Owner on 2026-11-03 to DSH 0.2.1-rc.5 (npm latest) with host and plugin Pi 1.5.0. Version decision (Product Owner 2026-10-22, confirmed 2026-11-03) - stable 0.6.0 for DSH latest (npm latest, after 0.5.2); the pre line becomes 0.7.0-pre.1 on DSH 0.2.2-alpha.3 on work/129-pre-0.7.0, and 0.6.0-pre.3 is abandoned unpublished. The Technical Lead agreed with the plan on 2026-11-03. The version decision is not a release approval, which stays pending. Release layout and order (Product Owner decisions 2026-11-04, given to the Controller) - public branch layout - this stable 0.6.0 goes to a new public branch stable/0.6.x created from v0.6.0-pre.2 (e53bf21), the pre line 0.7.0-pre.1 to public main; release order - this stable 0.6.0 first, then 0.7.0-pre.1 the same day (the pre guard stable_latest_must_remain becomes 0.6.0; this guard previous_latest_must_be stays 0.5.2). These decisions are not a release approval either. Release approval (Product Owner 2026-11-04, in the Local Controller conversation, after the Technical Lead passed Revision 2 of the public export) - the whole chain is approved and recorded as the final irreversible confirmation - open the public PRs, merge, tag and npm publish, this stable 0.6.0 first, then 0.7.0-pre.1 the same day; see approval_reference.`,
    `source:`,
    `  repository: kk3ya03-star/dsh-lcx-codex-private`,
    `  engineering_issue: 129`,
    `  engineering_issues: [129]`,
    `  trigger_issue: 128`,
    `  work_branch: work/129-stable-0.6.0`,
    `  prerelease_sibling: 0.7.0-pre.1 on work/129-pre-0.7.0 (DSH 0.2.2-alpha.3; separate branch; 0.6.0-pre.3 on work/129-dsh021-rc2-alpha5 is abandoned unpublished)`,
    `  product_commit: 397dce88e31274e086dc2f610afdc535d8154438`,
    `  export_source_commit: f9aa546a84e1623fc1aec9623588e709a699e2a1`,
    `  frozen_tag: frozen/v0.6.0`,
    `  frozen_tag_state: CREATED_ON_EXPORTED_SOURCE_COMMIT`,
    `  policy: Release candidate approved by the Product Owner on 2026-11-04 (approval.approval_reference). The public export is the Technical Lead reviewed Revision 2 plus the optional README wording note (DSH 0.2.2 prerelease series); published on 2026-11-04; the frozen tag frozen/v0.6.0 was created afterwards on the export source commit f9aa546 (exported files byte-identical to the public merge tree; runtime identical to the product commit 397dce8, later commits on that path change scripts/tests only, never npm payload). The stable line has its own source branch (the DSH 0.2.1 API; 0.2.2 adaptations live on the pre branch). It shares the Pi 1.5.0 common commits (bundled Pi 1.5.0, request-global tool declarations) with the pre line, and differs by stable-only commits - the single exact DSH 0.2.1-rc.5 runtime fixture, the bounded install range >=0.2.1-rc.5 <0.2.2-0 and the release-policy rule that a bounded ceiling must end in <X.Y.Z-0.`,
    `public_target:`,
    `  repository: kk3ya03-star/dsh-lcx-codex`,
    `  branch: stable/0.6.x`,
    `  tag: v0.6.0`,
    `  qualification: Release approved by the Product Owner on 2026-11-04; public tag v0.6.0 created and published on 2026-11-04 (see published). Stable line branch (Product Owner decision 2026-11-04) - the stable 0.6.x line (DSH 0.2.1) lives on a new public branch stable/0.6.x, created from the published tag v0.6.0-pre.2 (e53bf21), next to stable/0.5.x; the pre line (0.7.x, DSH 0.2.2) lives on public main. The tag is created on the merge commit into stable/0.6.x. The finalize-stable-release workflow only listens on main, so the GitHub Release for v0.6.0 is created manually, as for v0.5.2. Released first, before 0.7.0-pre.1 the same day.`,
    `  npm_dist_tag: latest`,
    `  previous_latest_must_be: 0.5.2`,
    `verification:`,
    `  state: POST_RELEASE_VERIFIED`,
    `  release_tarball: dsh-lcx-codex-0.6.0.tgz, 42 files, SHA-256 a6bedda05b12959bbbb1d0dc34cceeb6875930ff01fae0f39263aeac01fe5110 (npm pack --ignore-scripts of the exact public export tree; the release manifest is not npm payload)`,
    `  record_paths: The docs/qa/** and releases/** paths cited in this manifest are internal audit records in the private source repository (source.repository); they are not published and are not accessible publicly.`,
    `  policy: Static impact review of DSH 0.2.1-rc.2 -> 0.2.1-rc.5 and Pi 1.3.0 -> 1.5.0 (docs/qa/issue-129/REBASELINE-2026-11-03.md; the earlier docs/qa/issue-129/COMPATIBILITY-REVIEW.md is superseded for this line) and the full engineering gate set on the exact DSH 0.2.1-rc.5 runtime (host Pi 1.5.0 = plugin Pi 1.5.0). Real DSH runtime QA (required for an L3 change) is complete on exact DSH 0.2.1-rc.5 (docs/qa/issue-129/RUNTIME-QA-STABLE.md; commits d913800 and 397dce8; both stop conditions not hit; plugin suite 750/750 on 397dce8). The Technical Lead accepted the engineering and runtime QA evidence on 2026-11-04 (product commit 397dce8; exact DSH 0.2.1-rc.5, host and plugin Pi 1.5.0 only; ENGINEERING_PASS, not VERIFIED). Public export (Technical Lead Revision 2 PASS 2026-11-04, plus the README wording note) - parity 0 violations, the 102 runtime files (src, lib, cordis.patch.yml) and every other exported file blob-identical to the private source (only scripts/extract-cache-baseline.mjs differs from the QA'd 397dce8, not npm payload), 41 of 42 packed files byte-identical to the QA'd 397dce8 tarball (only README.md, now the public README), gates rerun on the exact export tree. The Product Owner approved the release on 2026-11-04 (approval.approval_reference). The exact candidate was published on 2026-11-04 and the post-release verification is complete (releases/0.6.0/POST-RELEASE-VERIFICATION.md); the compatibility row is VERIFIED for the exact baseline only (promotion forced by governance as for 0.5.1 and 0.5.2, flagged for Technical Lead confirmation).`,
    `runtime_basis:`,
    `  dsh: 0.2.1-rc.5`,
    `  host_pi: 1.5.0`,
    `  plugin_pi: 1.5.0`,
    `  qualification: ENGINEERING_PASS for the exact baseline only (plugin 0.6.0 x DSH 0.2.1-rc.5 x host Pi 1.5.0 x plugin Pi 1.5.0) - contract and engineering gates pass on the exact DSH 0.2.1-rc.5 runtime, real DSH runtime QA is complete (docs/qa/issue-129/RUNTIME-QA-STABLE.md) and the Technical Lead accepted both on 2026-11-04 (product commit 397dce8). Not VERIFIED; no claim for later DSH versions. Publication approved by the Product Owner on 2026-11-04 (APPROVED_PENDING_PUBLISH). A fresh DSH install resolves host Pi 1.5.0 (DSH ships no shrinkwrap); a changed resolved host Pi is itself a reassessment trigger, and link fails closed when the host Pi differs from the bundled Pi.`,
    `  install_range: ">=0.2.1-rc.5 <0.2.2-0 (Product Owner re-baseline 2026-11-03; a bounded stable ceiling must end in <X.Y.Z-0 because DSH compares with includePrerelease, so <0.2.2 would admit 0.2.2-alpha.*). Admits DSH 0.2.1-rc.5 and later DSH 0.2.1 builds; the verified claim, once earned, is the exact DSH 0.2.1-rc.5 baseline only."`,
    `  remaining: "Post-publication verification is complete (releases/0.6.0/POST-RELEASE-VERIFICATION.md). Before publication this read: Only the public steps and post-release verification remain - the public PR into stable/0.6.x, merge, tag v0.6.0, npm publication through the public workflow, the manually created GitHub Release, then post-release verification (registry package, install, SHA-256, version display, latest/prelatest). Stable 0.6.0 is published first; 0.7.0-pre.1 follows the same day. Coverage boundaries accepted by the Product Owner with the release approval (not PASS, not blockers; stated in the public README, CHANGELOG and ARCHITECTURE) - model-switch compaction from GPT to a non-GPT model; a GPT to GPT switch that needs a summary; an actual GPT to Grok turn under a Grok profile whose maxTokens equals contextWindow; the gpt-5.6-sol first turn, the gpt-5.4 / gpt-5.5 mode-none models and gpt-6-sol effort switching without separate full runtime evidence; xai/grok-4.7 without a gateway channel (grok-4.6 suffices); native X Search not separately re-verified in this release. Open non-blockers from the runtime QA record - DSH session-log-deepseek upload carrying GPT opaque state (outside LCX scope, not pursued by Product Owner decision 2026-11-04), log noise for tool-less one-shot requests, the unreachable later-system-message residual. The earlier pre-approval checklist (export review, tarball, release order and layout, ranges and known limits, approval) is complete; its history is in the Git log of this file."`,
    `publication:`,
    `  state: APPROVED_PENDING_PUBLISH`,
    `  policy: Product Owner approval and final irreversible confirmation are recorded (2026-11-04) for this exact candidate. Public PR release/0.6.0 into the new public stable/0.6.x (from e53bf21), tag v0.6.0 on the merge commit, npm latest publication through the public workflow (latest must be 0.5.2 before, 0.6.0 after) and a manually created GitHub Release are authorized for this exact candidate only, before 0.7.0-pre.1 the same day.`,
  ].join('\n')
  assert.doesNotThrow(() => assertReleasePolicy(mainLegacyPkgFallback, mainLegacyManifestFallback, 'refs/tags/v0.6.0'))
  // Mutating a single identity or verification field off the exact immutable 0.6.0 record immediately disables the legacy path
  assert.throws(
    () => assertReleasePolicy(mainLegacyPkgFallback, mainLegacyManifestFallback.replace('397dce88e31274e086dc2f610afdc535d8154438', '0123456789abcdef0123456789abcdef01234567').replace('397dce88e31274e086dc2f610afdc535d8154438', '0123456789abcdef0123456789abcdef01234567'), 'refs/tags/v0.6.0'),
    /approval\.engineering_issue must be a positive integer|approval\.approved_version is required/u,
  )
  assert.throws(
    () => assertReleasePolicy(mainLegacyPkgFallback, mainLegacyManifestFallback.replace('commits d913800 and 397dce8', 'commits d913800dead and 397dce8'), 'refs/tags/v0.6.0'),
    /approval\.engineering_issue must be a positive integer|Mismatched product commit SHA/u,
  )

  const preLegacyPkgFallback = {
    ...structuredClone(pkg),
    version: '0.7.0-pre.1',
    devDependencies: { ...pkg.devDependencies, '@deepseek-ai/dsh': '0.2.2-alpha.3', '@earendil-works/pi-ai': '1.5.0' },
    peerDependencies: Object.fromEntries(
      Object.entries(pkg.peerDependencies).map(([k, v]) => [k, k.startsWith('@deepseek-ai/dsh-') ? '>=0.2.2-alpha.3' : v]),
    ),
    lcxCompatibility: {
      dshInstallRange: '>=0.2.2-alpha.3',
      verifiedDsh: '0.2.2-alpha.3',
      verifiedHostPi: '1.5.0',
      verifiedPluginPi: '1.5.0',
    },
  }
  const preLegacyManifestFallback = [
    `version: 0.7.0-pre.1`,
    `state: APPROVED_PRERELEASE`,
    `approval:`,
    `  product_owner: private-issue-129-po-approved-2026-11-04`,
    `  controller_review: TL_ACCEPTED_ENGINEERING_REVIEW_2026-11-04`,
    `  public_export_review: TL_PASSED_REVISION_2_2026-11-04`,
    `  dsh_022_rc1_static_review: TL_STATIC_PASS_2026-11-04_NOT_RUNTIME_VERIFIED`,
    `  approval_reference: docs/qa/issue-129/PRODUCT-OWNER-APPROVAL.md`,
    `  final_irreversible_confirmation: RECORDED_2026-11-04`,
    `  tl_reviewed_product_commit: 3440cec38fbf3b343c05259b175158c1530cf91f`,
    `  reference: Issue 129 pre-line candidate, re-baselined by the Product Owner on 2026-11-03 to DSH 0.2.2-alpha.3 (npm alpha) with host and plugin Pi 1.5.0. Version decision (Product Owner 2026-11-03) - pre line 0.7.0-pre.1 (npm prelatest, after 0.6.0-pre.2) on this branch; stable 0.6.0 on DSH 0.2.1-rc.5 on work/129-stable-0.6.0; 0.6.0-pre.3 is abandoned unpublished. The Technical Lead agreed with the plan on 2026-11-03. The version decision is not a release approval, which stays pending. Release layout and order (Product Owner decisions 2026-11-04, given to the Controller) - public branch layout - this pre line 0.7.0-pre.1 goes to public main, the stable 0.6.0 to a new public branch stable/0.6.x created from v0.6.0-pre.2 (e53bf21); release order - stable 0.6.0 first, then this prerelease the same day, so npm latest is 0.6.0 when this prerelease publishes (stable_latest_must_remain changed from 0.5.2 to 0.6.0). These decisions are not a release approval either. Release approval (Product Owner 2026-11-04, in the Local Controller conversation, after the Technical Lead passed Revision 2 of the public export) - the whole chain is approved and recorded as the final irreversible confirmation - open the public PRs, merge, tag and npm publish, stable 0.6.0 first, then 0.7.0-pre.1 the same day; see approval_reference.`,
    `source:`,
    `  repository: kk3ya03-star/dsh-lcx-codex-private`,
    `  engineering_issue: 129`,
    `  engineering_issues: [129]`,
    `  trigger_issue: 128`,
    `  work_branch: work/129-pre-0.7.0`,
    `  stable_sibling: 0.6.0 on work/129-stable-0.6.0 (DSH 0.2.1-rc.5; separate branch)`,
    `  product_commit: 3440cec38fbf3b343c05259b175158c1530cf91f`,
    `  export_source_commit: f0a50afb8e1a1d34a0b6be014aaf029f7ad6f904`,
    `  frozen_tag: frozen/v0.7.0-pre.1`,
    `  frozen_tag_state: CREATED_ON_EXPORTED_SOURCE_COMMIT`,
    `  policy: Release candidate approved by the Product Owner on 2026-11-04 (approval.approval_reference). The public export is the Technical Lead reviewed Revision 2 plus the optional README wording note (DSH 0.2.2 prerelease series); published on 2026-11-04; the frozen tag frozen/v0.7.0-pre.1 was created afterwards on the export source commit f0a50af (exported files byte-identical to the public merge tree; runtime identical to the product commit 3440cec, later commits on that path change scripts/tests only, never npm payload). The pre line has its own source branch (the DSH 0.2.2 host contract). It shares the Pi 1.5.0 common commits (bundled Pi 1.5.0, request-global tool declarations) with the stable line, and differs by pre-only commits - the single exact DSH 0.2.2-alpha.3 runtime fixture, the lower-bound-only install range >=0.2.2-alpha.3 and the 0.2.2 host adaptations (web_search arity, PTC and projection types, host adapter parity, request-headers contributors, token-meter digest). The bounded-ceiling release-policy rule (a bounded ceiling must end in <X.Y.Z-0, assertInstallRange) is stable-only - this line uses a lower-bound-only range and its scripts/release-policy.mjs does not carry that rule (corrected 2026-11-04 after the Technical Lead public-export review; wording only, no code ported). 0.6.0-pre.3 on work/129-dsh021-rc2-alpha5 is abandoned unpublished.`,
    `public_target:`,
    `  repository: kk3ya03-star/dsh-lcx-codex`,
    `  branch: main`,
    `  tag: v0.7.0-pre.1`,
    `  qualification: Release approved by the Product Owner on 2026-11-04; public tag v0.7.0-pre.1 created and published on 2026-11-04 (see published). Public main carries the pre line (Product Owner decision 2026-11-04); the stable 0.6.0 goes to the new public branch stable/0.6.x (from v0.6.0-pre.2, e53bf21) and is released first, the same day. publish.yml asserts npm latest equals stable_latest_must_remain before publishing this prerelease and that latest is unchanged afterwards.`,
    `  npm_dist_tag: prelatest`,
    `  stable_latest_must_remain: 0.6.0`,
    `verification:`,
    `  state: POST_RELEASE_CHECKED`,
    `  release_tarball: dsh-lcx-codex-0.7.0-pre.1.tgz, 42 files, SHA-256 53533009f520b656b16fb50ff26881ddc0755beb676b50bf21d4be2d71912a5a (npm pack --ignore-scripts of the exact public export tree; the release manifest is not npm payload)`,
    `  record_paths: The docs/qa/** and releases/** paths cited in this manifest are internal audit records in the private source repository (source.repository); they are not published and are not accessible publicly.`,
    `  policy: Static impact review of DSH 0.2.1-alpha.5 -> 0.2.2-alpha.3 and Pi 1.3.0 -> 1.5.0 (docs/qa/issue-129/REBASELINE-2026-11-03-PRE.md; the earlier docs/qa/issue-129/COMPATIBILITY-REVIEW.md is superseded) and the full engineering gate set on the exact DSH 0.2.2-alpha.3 runtime (host Pi 1.5.0 = plugin Pi 1.5.0). Real DSH runtime QA (required for an L3 change) is complete on exact DSH 0.2.2-alpha.3 (docs/qa/issue-129/RUNTIME-QA-PRE.md; commits 7a22654 and 3440cec; both stop conditions not hit; plugin suite 770/770 on 3440cec). The Technical Lead accepted the engineering and runtime QA evidence on 2026-11-04 (product commit 3440cec; exact DSH 0.2.2-alpha.3, host and plugin Pi 1.5.0 only; ENGINEERING_PASS, not VERIFIED). Public export (Technical Lead Revision 2 PASS 2026-11-04, plus the README wording note) - parity 0 violations, the 102 runtime files (src, lib, cordis.patch.yml) and every other exported file blob-identical to the private source (only scripts/extract-cache-baseline.mjs and scripts/release-policy.test.mjs differ from the QA'd 3440cec, neither is npm payload; the test change f0a50af, made after the approval, keeps the persisted-record release-policy test passing for the approved record and is flagged for Technical Lead / Controller sign-off before merge), 41 of 42 packed files byte-identical to the QA'd 3440cec tarball (only README.md, now the public README), gates rerun on the exact export tree. The Product Owner approved the release on 2026-11-04 (approval.approval_reference). The exact candidate was published on 2026-11-04 and the post-release check is complete (releases/0.7.0-pre.1/POST-RELEASE-VERIFICATION.md); the compatibility status stays ENGINEERING_PASS (VERIFIED is a Technical Lead decision).`,
    `runtime_basis:`,
    `  dsh: 0.2.2-alpha.3`,
    `  host_pi: 1.5.0`,
    `  plugin_pi: 1.5.0`,
    `  qualification: ENGINEERING_PASS for the exact baseline only (plugin 0.7.0-pre.1 x DSH 0.2.2-alpha.3 x host Pi 1.5.0 x plugin Pi 1.5.0) - contract and engineering gates pass on the exact DSH 0.2.2-alpha.3 runtime, real DSH runtime QA is complete (docs/qa/issue-129/RUNTIME-QA-PRE.md) and the Technical Lead accepted both on 2026-11-04 (product commit 3440cec). Not VERIFIED; no claim for later DSH versions. Publication approved by the Product Owner on 2026-11-04 (APPROVED_PENDING_PUBLISH). A fresh DSH install resolves host Pi 1.5.0 (DSH ships no shrinkwrap); a changed resolved host Pi is itself a reassessment trigger, and link fails closed when the host Pi differs from the bundled Pi.`,
    `  install_range: ">=0.2.2-alpha.3 (lower bound only, no ceiling; Product Owner decision 2026-10-10). Admits DSH 0.2.2-alpha.3 and later builds, which are installable but unverified; the verified claim, once earned, is the exact DSH 0.2.2-alpha.3 baseline only."`,
    `  remaining: "Post-publication verification is complete (releases/0.7.0-pre.1/POST-RELEASE-VERIFICATION.md). Before publication this read: Only the public steps and post-release verification remain - the public PR into main, merge, tag v0.7.0-pre.1, npm publication through the public workflow, the GitHub prerelease, then post-release verification (registry package, install, SHA-256, version display, latest/prelatest). Stable 0.6.0 is published first, so npm latest is 0.6.0 when this prerelease publishes (stable_latest_must_remain 0.6.0). DSH 0.2.2-rc.1 (Technical Lead static compatibility assessment 2026-11-04) - PASS, no LCX adaptation needed; static only, not runtime VERIFIED; DSH 0.2.2-alpha.3 stays the only verified baseline of this line. Coverage boundaries accepted by the Product Owner with the release approval (not PASS, not blockers; stated in the public README, CHANGELOG and ARCHITECTURE) - model-switch compaction from GPT to a non-GPT model; a GPT to GPT switch that needs a summary; an actual GPT to Grok turn under a Grok profile whose maxTokens equals contextWindow; the gpt-5.6-sol first turn, the gpt-5.4 / gpt-5.5 mode-none models and gpt-6-sol effort switching without separate full runtime evidence; xai/grok-4.7 without a gateway channel (grok-4.6 suffices); native X Search not separately re-verified in this release. Open non-blockers from the runtime QA record - DSH session-log-deepseek upload carrying GPT opaque state (outside LCX scope, not pursued by Product Owner decision 2026-11-04), log noise for tool-less one-shot requests, the unreachable later-system-message residual. The earlier pre-approval checklist (export review, tarball, release order and layout, ranges and known limits, approval) is complete; its history is in the Git log of this file."`,
    `publication:`,
    `  state: APPROVED_PENDING_PUBLISH`,
    `  policy: Product Owner approval and final irreversible confirmation are recorded (2026-11-04) for this exact candidate. Public PR release/0.7.0-pre.1 into public main, tag v0.7.0-pre.1 on the merge commit, npm prelatest publication through the public workflow and a GitHub prerelease are authorized for this exact candidate only, after stable 0.6.0 is published; npm latest must be and stay 0.6.0.`,
  ].join('\n')
  assert.doesNotThrow(() => assertReleasePolicy(preLegacyPkgFallback, preLegacyManifestFallback, 'refs/tags/v0.7.0-pre.1'))
  assert.throws(
    () => assertReleasePolicy(preLegacyPkgFallback, preLegacyManifestFallback.replace('commits 7a22654 and 3440cec', 'commits 7a22654dead and 3440cec'), 'refs/tags/v0.7.0-pre.1'),
    /approval\.engineering_issue must be a positive integer|Mismatched product commit SHA/u,
  )

  assert.throws(
    () => assertReleasePolicy({ ...structuredClone(stablePkg), version: ['0.7.0'] }, quotedApproved, 'refs/tags/v0.7.0'),
    /package\.json version must be a string/u,
  )

  // Round 15-19 P1-1/P1-2/P2-1/P2-2: decimal version inside clause, mixed commit separators, comma-separated upstream tracking, parenthesized stop-condition note, and uppercase 40-char SHA pass on 0.7.0
  for (const validR17Policy of [
    '"Runtime QA on DSH 0.2.2-rc.5 has passed (commit 0123456789ABCDEF0123456789ABCDEF01234567)."',
    '"Runtime QA passed for #131; commit:0123456; commit SHA=0123456."',
    '"Runtime QA passed (both stop conditions not hit); commit:0123456; commit SHA=0123456."',
    '"Runtime QA passed (commit:0123456; both stop conditions not hit)."',
    '"Runtime QA passed; commits 0123456, 01234567, and 0123456789abcdef."',
    '"Runtime QA passed; commits 0123456 & 01234567, and 012345678."',
    '"Runtime QA passed; upstream issue #105, and #62 remain open."',
  ]) {
    const validR17Manifest = setYamlSectionField(quotedApproved, 'verification', 'policy', validR17Policy)
    assert.doesNotThrow(() => assertReleasePolicy(stablePkg, validR17Manifest, 'refs/tags/v0.7.0'))
  }

  // Round 12 P2-6: reject SemVer +build metadata in previous_latest_must_be and stable_latest_must_remain
  assert.throws(
    () =>
      assertReleasePolicy(
        stablePkg,
        setYamlSectionField(quotedApproved, 'public_target', 'previous_latest_must_be', '0.6.0+build.1'),
        'refs/tags/v0.7.0',
      ),
    /must not contain build metadata/u,
  )
  assert.throws(
    () =>
      assertReleasePolicy(
        maint07Pkg,
        setYamlSectionField(maint07Manifest, 'public_target', 'stable_latest_must_remain', '0.8.0+build.1'),
        'refs/tags/v0.7.1',
      ),
    /must not contain build metadata/u,
  )

  // Round 7 P2-1: reject mismatched valid SemVer host_pi vs plugin_pi
  const piMismatchPkg = structuredClone(stablePkg)
  piMismatchPkg.lcxCompatibility.verifiedHostPi = '1.6.1'
  assert.throws(
    () =>
      assertReleasePolicy(
        piMismatchPkg,
        quotedApproved.replace(/^ {2}host_pi: .+$/m, '  host_pi: 1.6.1'),
        'refs/tags/v0.7.0',
      ),
    /verifiedHostPi must match plugin Pi/u,
  )

  // P1-5: reject downgrades & prerelease in previous_latest_must_be
  const downgradePkg = { ...structuredClone(stablePkg), version: '0.5.0' }
  const downgradeManifest = quotedApproved
    .replace(/^version: .+$/m, 'version: 0.5.0')
    .replace(/^ {2}approved_version: .+$/m, '  approved_version: 0.5.0')
    .replace(/^ {2}tag: .+$/m, '  tag: v0.5.0')
    .replace(/^ {2}previous_latest_must_be: .+$/m, '  previous_latest_must_be: 0.6.0')
  assert.throws(() => assertReleasePolicy(downgradePkg, downgradeManifest, 'refs/tags/v0.5.0'), /must advance latest/u)
  const prevPreManifest = quotedApproved.replace(/^ {2}previous_latest_must_be: .+$/m, '  previous_latest_must_be: 0.7.0-pre.1')
  assert.throws(() => assertReleasePolicy(stablePkg, prevPreManifest, 'refs/tags/v0.7.0'), /must be a stable SemVer/u)

  // P3-2 & P3-3: reject <0.0.0-0, reject leading-zero SemVer, and compare large core & prerelease numbers via BigInt
  assert.throws(() => assertInstallRange('<0.0.0-0'), /admits no SemVer/u)
  assert.throws(() => parseStrictSemver('01.0.0'), /not valid strict SemVer/u)
  assert.equal(compareSemver(parseStrictSemver('1.0.0-9007199254740993'), parseStrictSemver('1.0.0-9007199254740992')), 1)
  assert.equal(compareSemver(parseStrictSemver('1.0.0-9007199254740992'), parseStrictSemver('1.0.0-9007199254740993')), -1)
  assert.equal(compareSemver(parseStrictSemver('9007199254740993.0.0'), parseStrictSemver('9007199254740992.0.0')), 1)
  assert.doesNotThrow(() => assertInstallRange('>=1.0.9007199254740993 <1.0.9007199254740994-0', '1.0.9007199254740993'))
})
