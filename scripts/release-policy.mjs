import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  assertNoBareUpperBounds,
  assertNonEmptyBounds,
  compareSemver,
  isExclusivePrereleaseZeroCeiling,
  isExpectedReleaseCeiling,
  parseStrictComparatorSet,
  parseStrictSemver,
  satisfiesStrictRange,
} from './semver-range.mjs'

const CONTROL_TOP_KEYS = new Set(['version', 'state'])
const CONTROL_SECTIONS = new Set(['approval', 'verification', 'public_target', 'runtime_basis', 'publication'])
const YAML_NULL_OR_BOOL_RE = /^(?:null|Null|NULL|~|true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/u
const UNSUPPORTED_UNQUOTED_PREFIX_RE = /^[|>{}[\]*&!@`%?]/u
const UNSUPPORTED_UNQUOTED_TOKENS_RE = /[{}[\]]/u
const DISALLOWED_INVISIBLE_RE = /[\ufeff\p{Cf}]/u
const ISSUE_NUMBER_RE = /^[1-9]\d{0,8}$/u
const WORK_BRANCH_REF_RE = /^(?:work\/[1-9]\d{0,8}-[A-Za-z0-9][A-Za-z0-9._-]*|main|stable\/\d+\.\d+\.x)$/u
const LEGACY_060_CANONICAL_SHA256 = '0a94f091c30fc8103087903c18133fc86f4c22a55735b6ad620811b5ef93e322'
const LEGACY_070_PRE1_CANONICAL_SHA256 = '34d811a23421225444fae17bb2f5c5811051433ffe501be936fc7d804c373c76'
const COMMIT_LIST_SEP_SRC = '(?:[ \\t]*,[ \\t]*(?:and\\b[ \\t]*)?|[ \\t]*(?:&|\\/|\\band\\b)[ \\t]*|[ \\t]+)'
const COMMIT_LABEL_RE =
  /^(?:(?:product|verified|reviewed|tl[\s_-]*reviewed|candidate|release|source|target)[\s_-]+)*commits?\b(?:(?:\s*[:=]\s*|\s+)(?:shas?|hashes|ids|refs|are|were|is|at|was|equals))*(?:\s*[:=]\s*|\s+)/iu
const COMMIT_LIST_SEP_START_RE = new RegExp(`^${COMMIT_LIST_SEP_SRC}`, 'iu')
const COMMIT_SCAN_RE = new RegExp(
  `(?:\\b(?:product|verified|reviewed|tl[\\s_-]*reviewed|candidate|release|source|target)[\\s_-]+)*\\bcommits?\\b(?:(?:\\s*[:=]\\s*|\\s+)(?:shas?|hashes|ids|refs|are|were|is|at|was|equals))*(?:\\s*[:=]\\s*|\\s+)([0-9a-f]{7,40}(?:${COMMIT_LIST_SEP_SRC}[0-9a-f]{7,40})*)\\b`,
  'giu',
)
const ACTIVE_COMMIT_LIST_LEFT_RE = new RegExp(
  `^(?:(?:product|verified|reviewed|tl[\\s_-]*reviewed|candidate|release|source|target)[\\s_-]+)*commits?\\b(?:(?:\\s*[:=]\\s*|\\s+)(?:shas?|hashes|ids|refs|are|were|is|at|was|equals))*(?:\\s*[:=]\\s*|\\s+)[0-9a-f]{7,40}(?:${COMMIT_LIST_SEP_SRC}[0-9a-f]{7,40})*$`,
  'iu',
)
const UPSTREAM_LEAD_SRC = '(?:upstream|dsh|pi(?:-ai)?|openai|xai)\\s+(?:issue[-\\s#]*\\d+|#\\d+)'
const UPSTREAM_TAIL_ITEM_SRC = '(?:(?:upstream|dsh|pi(?:-ai)?|openai|xai)\\s+)?(?:issue[-\\s#]*\\d+|#\\d+)'
const UPSTREAM_LIST_SEP_SRC = '(?:[ \\t]*,[ \\t]*(?:and\\b[ \\t]*)?|[ \\t]*(?:&|\\/|\\band\\b)[ \\t]*)'
const ACTIVE_UPSTREAM_LIST_LEFT_RE = new RegExp(
  `^${UPSTREAM_LEAD_SRC}(?:${UPSTREAM_LIST_SEP_SRC}${UPSTREAM_TAIL_ITEM_SRC})*$`,
  'iu',
)
const ACTIVE_UPSTREAM_LIST_RIGHT_RE = new RegExp(`^[ \\t]*(?:and\\b[ \\t]*)?${UPSTREAM_TAIL_ITEM_SRC}\\b`, 'iu')
const sanitizeValidatedQaClauseForDenylist = (clause) =>
  clause.replace(/\(([^)]*)\)/gu, (_m, inner) => {
    const sanitizedItems = inner
      .split(';')
      .map((item) => (/^\s*both\s+stop\s+conditions\s+not\s+hit\s*$/iu.test(item) ? ' ' : item))
      .join(';')
    return `(${sanitizedItems})`
  })
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

function parseAndVerifyCommitExpression(rawText, verifyShaFn) {
  const s = rawText.replace(/[*_~`"'‘’“”«»]+/gu, ' ').replace(/[ \t]+/gu, ' ').trim()
  const headMatch = COMMIT_LABEL_RE.exec(s)
  if (!headMatch) return false
  let rest = s.slice(headMatch[0].length)
  const firstMatch = /^([0-9a-f]{7,40})(?![0-9a-zA-Z_-])/iu.exec(rest)
  if (!firstMatch) return false
  verifyShaFn(firstMatch[1])
  rest = rest.slice(firstMatch[1].length)
  while (rest.length > 0) {
    const sepMatch = COMMIT_LIST_SEP_START_RE.exec(rest)
    if (!sepMatch) return false
    rest = rest.slice(sepMatch[0].length)
    const nextMatch = /^([0-9a-f]{7,40})(?![0-9a-zA-Z_-])/iu.exec(rest)
    if (!nextMatch) return false
    verifyShaFn(nextMatch[1])
    rest = rest.slice(nextMatch[1].length)
  }
  return true
}

function splitTopLevelVerificationClauses(policyText) {
  let depth = 0
  for (let i = 0; i < policyText.length; i += 1) {
    const c = policyText[i]
    if (c === '(') {
      depth += 1
      if (depth > 1) assert.fail('verification.policy must not contain nested parentheses')
    } else if (c === ')') {
      depth -= 1
      if (depth < 0) assert.fail('verification.policy contains unbalanced parentheses')
    }
  }
  assert.equal(depth, 0, 'verification.policy contains unclosed parentheses')

  const clauses = []
  let start = 0
  let parenDepth = 0
  const flush = (endIdx) => {
    const chunk = policyText.slice(start, endIdx).trim().replace(/^(?:and|plus)\s+/iu, '').replace(/\s+/gu, ' ')
    if (chunk.length > 0) clauses.push(chunk)
  }
  for (let i = 0; i < policyText.length; i += 1) {
    const ch = policyText[i]
    if (ch === '(') {
      parenDepth += 1
      continue
    }
    if (ch === ')') {
      parenDepth -= 1
      continue
    }
    if (parenDepth !== 0) continue
    if (ch === '\r' || ch === '\n' || ch === ';') {
      flush(i)
      start = i + 1
      continue
    }
    if (ch === '.') {
      const next = policyText[i + 1]
      if (next === undefined || /\s/u.test(next)) {
        flush(i)
        start = i + 1
      }
      continue
    }
    if (ch === ',') {
      const leftTrimmed = policyText.slice(start, i).trim().replace(/^(?:and|plus)\s+/iu, '')
      const rightTail = policyText.slice(i + 1)
      const isActiveCommitList =
        ACTIVE_COMMIT_LIST_LEFT_RE.test(leftTrimmed) && /^[ \t]*(?:and\b[ \t]*)?[0-9a-f]{7,40}\b/iu.test(rightTail)
      const isActiveUpstreamList =
        ACTIVE_UPSTREAM_LIST_LEFT_RE.test(leftTrimmed) && ACTIVE_UPSTREAM_LIST_RIGHT_RE.test(rightTail)
      if (!isActiveCommitList && !isActiveUpstreamList) {
        flush(i)
        start = i + 1
      }
    }
  }
  flush(policyText.length)
  return clauses
}

const trimAscii = (value) => value.replace(/^[ \t]+|[ \t]+$/gu, '')
const hasVisibleNonWhitespace = (value) => value.replace(/[\p{White_Space}\ufeff\p{Cf}]+/gu, '').length > 0
const assertValidWorkBranch = (branch, fieldLabel) => {
  assert.ok(
    typeof branch === 'string' &&
      WORK_BRANCH_REF_RE.test(branch) &&
      !branch.includes('..') &&
      !branch.endsWith('.lock') &&
      !branch.endsWith('.'),
    `${fieldLabel} must be a valid Git branch ref (work/<issue>-<slug>, main, or stable/<x>.<y>.x): ${branch}`,
  )
}

export function decodeYamlScalar(raw, fieldLabel = 'YAML field') {
  assert.ok(typeof raw === 'string' && !DISALLOWED_INVISIBLE_RE.test(raw), `Unsupported BOM/invisible format character in YAML scalar for ${fieldLabel}: ${raw}`)
  const trimmed = trimAscii(raw)
  assert.ok(trimmed && !trimmed.startsWith('#'), `Empty or null YAML scalar for ${fieldLabel}: ${raw}`)
  if (trimmed.startsWith('"')) {
    let end = -1
    let escaped = false
    for (let i = 1; i < trimmed.length; i += 1) {
      const ch = trimmed[i]
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        end = i
        break
      }
    }
    assert.ok(end !== -1, `Unterminated double-quoted YAML scalar for ${fieldLabel}: ${raw}`)
    const trailing = trimmed.slice(end + 1)
    assert.ok(trailing === '' || /^[ \t]+(?:#.*)?$/u.test(trailing), `Unexpected trailing token in YAML scalar for ${fieldLabel}: ${raw}`)
    const decoded = JSON.parse(trimmed.slice(0, end + 1))
    assert.ok(typeof decoded === 'string' && hasVisibleNonWhitespace(decoded), `YAML scalar for ${fieldLabel} must be a non-empty string`)
    assert.ok(!DISALLOWED_INVISIBLE_RE.test(decoded), `Unsupported invisible/BOM format character in decoded YAML scalar for ${fieldLabel}: ${raw}`)
    return decoded
  }
  if (trimmed.startsWith("'")) {
    let end = -1
    for (let i = 1; i < trimmed.length; i += 1) {
      if (trimmed[i] === "'") {
        if (trimmed[i + 1] === "'") {
          i += 1
          continue
        }
        end = i
        break
      }
    }
    assert.ok(end !== -1, `Unterminated single-quoted YAML scalar for ${fieldLabel}: ${raw}`)
    const trailing = trimmed.slice(end + 1)
    assert.ok(trailing === '' || /^[ \t]+(?:#.*)?$/u.test(trailing), `Unexpected trailing token in YAML scalar for ${fieldLabel}: ${raw}`)
    const decoded = trimmed.slice(1, end).replace(/''/gu, "'")
    assert.ok(hasVisibleNonWhitespace(decoded), `YAML scalar for ${fieldLabel} must be a non-empty string`)
    assert.ok(!DISALLOWED_INVISIBLE_RE.test(decoded), `Unsupported invisible/BOM format character in decoded YAML scalar for ${fieldLabel}: ${raw}`)
    return decoded
  }
  const commentMatch = /[ \t]+#/u.exec(trimmed)
  const scalar = trimAscii(commentMatch ? trimmed.slice(0, commentMatch.index) : trimmed)
  assert.ok(scalar.length > 0, `Empty YAML scalar for ${fieldLabel}: ${raw}`)
  assert.ok(!/[^\P{White_Space} \t]|[\ufeff\p{Cf}]/u.test(scalar), `Unsupported non-ASCII whitespace or invisible format character in YAML scalar for ${fieldLabel}: ${raw}`)
  assert.ok(!YAML_NULL_OR_BOOL_RE.test(scalar), `Unquoted YAML null/boolean literal is forbidden for ${fieldLabel}: ${raw}`)
  assert.ok(!UNSUPPORTED_UNQUOTED_PREFIX_RE.test(scalar), `Unsupported YAML syntax for ${fieldLabel}: ${raw}`)
  assert.ok(!UNSUPPORTED_UNQUOTED_TOKENS_RE.test(scalar), `Unsupported YAML collection token for ${fieldLabel}: ${raw}`)
  assert.ok(scalar !== '-' && !scalar.startsWith('- '), `Unexpected sequence item syntax for ${fieldLabel}: ${raw}`)
  assert.ok(!scalar.startsWith(':') && !/:[ \t]/u.test(scalar) && !/:\p{White_Space}/u.test(scalar), `Unexpected mapping syntax in scalar for ${fieldLabel}: ${raw}`)
  return scalar
}

export function parseReleaseManifest(text) {
  assert.equal(typeof text, 'string', 'Release manifest must be a string')
  assert.ok(!DISALLOWED_INVISIBLE_RE.test(text), 'Unsupported BOM/invisible format character in release manifest')
  const top = new Map()
  const sections = new Map()
  const nestedSectionKeys = new Map()
  let currentSection = null
  let currentNestedKey = null
  for (const rawLine of text.split(/\r?\n/u)) {
    if (/^[ \t]*$/u.test(rawLine)) continue
    assert.ok(!/^ *\t/u.test(rawLine), `Tab indentation is forbidden in release manifest: ${rawLine}`)
    const indent = /^( *)/u.exec(rawLine)[1].length
    const trimmed = rawLine.slice(indent).replace(/[ \t]+$/u, '')
    assert.ok(!/^\p{White_Space}/u.test(trimmed), `Invalid non-ASCII whitespace in indentation for release manifest: ${rawLine}`)
    if (trimmed.startsWith('#')) continue
    if (indent === 0) {
      currentSection = null
      currentNestedKey = null
      const match = /^([A-Za-z0-9_]+):(?:[ \t]+(.*))?$/u.exec(trimmed)
      assert.ok(match, `Malformed top-level YAML line in release manifest: ${rawLine}`)
      const key = match[1]
      const rest = trimAscii(match[2] ?? '')
      assert.ok(!top.has(key) && !sections.has(key), `Duplicate YAML top-level key "${key}"`)
      if (!rest || rest.startsWith('#')) {
        assert.ok(!CONTROL_TOP_KEYS.has(key), `Control field "${key}" must be a non-empty scalar`)
        currentSection = key
        sections.set(key, new Map())
        nestedSectionKeys.set(key, new Set())
      } else {
        top.set(key, decodeYamlScalar(rest, key))
      }
      continue
    }
    assert.ok(currentSection !== null, `Unexpected indented YAML line outside section: ${rawLine}`)
    const inControlSection = CONTROL_SECTIONS.has(currentSection)
    if (indent === 2) {
      if (trimmed.startsWith('-')) {
        assert.ok(!inControlSection && currentSection !== 'source', `YAML list items are forbidden in section "${currentSection}": ${rawLine}`)
        continue
      }
      const match = /^([A-Za-z0-9_]+):(?:[ \t]+(.*))?$/u.exec(trimmed)
      assert.ok(match, `Malformed YAML entry in section "${currentSection}": ${rawLine}`)
      const key = match[1]
      const rest = trimAscii(match[2] ?? '')
      const sec = sections.get(currentSection)
      const nested = nestedSectionKeys.get(currentSection)
      assert.ok(!sec.has(key) && !nested.has(key), `Duplicate YAML key "${currentSection}.${key}"`)
      nested.add(key)
      const allowListInSection = !inControlSection && (currentSection !== 'source' || key === 'engineering_issues')
      if (!rest || rest.startsWith('#')) {
        assert.ok(allowListInSection, `Empty or null YAML value for scalar field "${currentSection}.${key}"`)
        currentNestedKey = key
      } else {
        currentNestedKey = null
        if (!allowListInSection) {
          sec.set(key, decodeYamlScalar(rest, `${currentSection}.${key}`))
        } else if (!/^\[.*\]$/u.test(trimAscii(rest.replace(/[ \t]+#.*$/u, '')))) {
          sec.set(key, decodeYamlScalar(rest, `${currentSection}.${key}`))
        }
      }
      continue
    }
    assert.ok(!inControlSection && (currentSection !== 'source' || currentNestedKey === 'engineering_issues'), `Unexpected nested indentation in section "${currentSection}": ${rawLine}`)
    assert.ok(currentNestedKey !== null && trimmed.startsWith('-'), `Unsupported nested YAML line in "${currentSection}": ${rawLine}`)
  }
  return { top, sections }
}

// DSH includes prereleases in range evaluation; a release ceiling admits its prereleases.
export function assertInstallRange(range, verifiedDsh = undefined) {
  const comparators = parseStrictComparatorSet(range, 'install range')
  assertNoBareUpperBounds(comparators, 'install range')
  const { uppers } = assertNonEmptyBounds(comparators, 'install range')
  if (verifiedDsh !== undefined) {
    const verified = parseStrictSemver(verifiedDsh, 'verifiedDsh')
    assert.ok(
      satisfiesStrictRange(verified, comparators),
      `install range "${range}" must satisfy verified DSH ${verifiedDsh}`,
    )
    for (const upper of uppers) {
      assert.ok(
        isExpectedReleaseCeiling(upper.semver, verified),
        `install range "${range}" upper bound ${upper.raw} must match the approved ceiling <${verified.major}.${verified.minor}.${verified.patch + 1n}-0`,
      )
    }
  }
}

function assertStableBoundedRange(range, label, verifiedDsh = undefined) {
  const comparators = parseStrictComparatorSet(range, label)
  assertNoBareUpperBounds(comparators, label)
  const { exacts, lowers, uppers } = assertNonEmptyBounds(comparators, label)
  assert.equal(exacts.length, 0, `${label} must use bounded >= ... <X.Y.Z-0 range rather than exact comparator`)
  assert.ok(lowers.length > 0, `${label} must include an approved lower bound for stable releases`)
  assert.ok(
    uppers.length > 0 && uppers.every((comparator) => isExclusivePrereleaseZeroCeiling(comparator)),
    `${label} must include a bounded <X.Y.Z-0 ceiling for stable releases`,
  )
  if (verifiedDsh !== undefined) {
    const verified = parseStrictSemver(verifiedDsh, 'verifiedDsh')
    assert.ok(
      satisfiesStrictRange(verified, comparators),
      `${label} "${range}" must satisfy verified DSH ${verifiedDsh}`,
    )
    for (const lower of lowers) {
      assert.ok(
        compareSemver(lower.semver, verified) >= 0,
        `${label} lower bound ${lower.raw} must not drop below verified DSH ${verifiedDsh}`,
      )
    }
    for (const upper of uppers) {
      assert.ok(
        isExpectedReleaseCeiling(upper.semver, verified),
        `${label} upper bound ${upper.raw} must match approved ceiling <${verified.major}.${verified.minor}.${verified.patch + 1n}-0`,
      )
    }
  }
}

// Runs before registry access or publication. Review metadata cannot authorize release.
export function assertReleasePolicy(pkg, manifest, ref) {
  const verifiedDsh = pkg.lcxCompatibility?.verifiedDsh ?? pkg.devDependencies?.['@deepseek-ai/dsh']
  assert.equal(pkg.lcxCompatibility?.verifiedDsh, pkg.devDependencies['@deepseek-ai/dsh'])
  const installRange = pkg.lcxCompatibility?.dshInstallRange
  assertInstallRange(installRange, verifiedDsh)

  const doc = parseReleaseManifest(manifest)
  const approval = doc.sections.get('approval')
  const sourceSection = doc.sections.get('source')
  const publicTarget = doc.sections.get('public_target')
  const runtimeBasis = doc.sections.get('runtime_basis')
  const publication = doc.sections.get('publication')

  assert.equal(pkg.name, 'dsh-lcx-codex')
  assert.equal(typeof pkg.version, 'string', 'package.json version must be a string')
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/, 'Semantic release version required')
  const parsedVersion = parseStrictSemver(pkg.version, 'package.version')
  const prerelease = parsedVersion.prerelease.length > 0
  const expectedState = prerelease ? 'APPROVED_PRERELEASE' : 'APPROVED_STABLE'
  assert.equal(ref, `refs/tags/v${pkg.version}`)
  assert.equal(doc.top.get('version'), pkg.version)
  assert.equal(doc.top.get('state'), expectedState, prerelease ? 'Explicit prerelease approval required' : 'Explicit stable approval required')
  assert.equal(publication?.get('state'), 'APPROVED_PENDING_PUBLISH', 'Publication must be explicitly approved')

  const denialOrPlaceholderRe = /(?<![A-Za-z0-9])(?:required|hold|never|not|no|without|tbd|todo|pending|blocked|rejected|denied|refused|revoked|cancelled|canceled|withdrawn|unapproved|disapproved|unaccepted|template|placeholder|draft|mock|fake)(?![A-Za-z0-9])/iu
  const positivePoRe = /^(?:private-issue-\d+-po-approved-\d{4}-\d{2}-\d{2}|po[-_]approved(?:[-_]\d{4}-\d{2}-\d{2})?|approved[-_]by[-_]product[-_]owner)$/iu
  const positiveControllerRe = /^(?:TL_ACCEPTED(?:_ENGINEERING_REVIEW)?_\d{4}-\d{2}-\d{2}|TL_(?:ACCEPTED|APPROVED|PASSED)(?:_\d{4}-\d{2}-\d{2})?|controller_(?:accepted|approved|passed))$/iu

  const productOwner = typeof approval?.get('product_owner') === 'string' ? trimAscii(approval.get('product_owner')) : ''
  assert.ok(
    productOwner.length > 0 &&
      !denialOrPlaceholderRe.test(productOwner) &&
      positivePoRe.test(productOwner),
    'Explicit positive Product Owner approval required',
  )
  const controllerReview = typeof approval?.get('controller_review') === 'string' ? trimAscii(approval.get('controller_review')) : ''
  assert.ok(
    controllerReview.length > 0 &&
      !denialOrPlaceholderRe.test(controllerReview) &&
      positiveControllerRe.test(controllerReview),
    'Explicit positive controller_review approval required',
  )
  const tlCommit = approval?.get('tl_reviewed_product_commit')
  assert.ok(
    typeof tlCommit === 'string' && /^[0-9a-f]{40}$/u.test(tlCommit),
    'approval.tl_reviewed_product_commit must be a 40-char hex commit SHA',
  )
  const sourceProductCommit = sourceSection?.get('product_commit')
  assert.ok(
    typeof sourceProductCommit === 'string' && /^[0-9a-f]{40}$/u.test(sourceProductCommit),
    'source.product_commit must be a 40-char hex commit SHA',
  )
  assert.equal(tlCommit, sourceProductCommit, 'approval.tl_reviewed_product_commit must match source.product_commit')

  const approvalIssue = approval?.get('engineering_issue')
  const sourceIssue = sourceSection?.get('engineering_issue')
  assert.ok(
    typeof sourceIssue === 'string' && ISSUE_NUMBER_RE.test(sourceIssue),
    'source.engineering_issue must be a positive integer without leading zeros (at most 9 digits)',
  )
  for (const [fieldName, fieldVal] of [
    ['approval.product_owner', productOwner],
    ['approval.controller_review', controllerReview],
    ['approval.approval_reference', approval?.get('approval_reference')],
  ]) {
    if (typeof fieldVal !== 'string') continue
    for (const issueMatch of fieldVal.matchAll(/(?:private-)?issue[-_#\s/]+(\d+)/giu)) {
      assert.equal(issueMatch[1], sourceIssue, `Stale or mismatched issue reference #${issueMatch[1]} in ${fieldName} (expected #${sourceIssue})`)
    }
  }
  const approvalBranch = approval?.get('work_branch')
  const sourceBranch = sourceSection?.get('work_branch')
  assert.ok(typeof sourceBranch === 'string' && sourceBranch.length > 0, 'source.work_branch is required')
  assertValidWorkBranch(sourceBranch, 'source.work_branch')
  const branchIssueMatch = /^work\/(\d+)-/u.exec(sourceBranch)
  if (branchIssueMatch) {
    assert.equal(branchIssueMatch[1], sourceIssue, `source.work_branch ${sourceBranch} must match engineering_issue #${sourceIssue}`)
  }

  const verification = doc.sections.get('verification')
  const manifestControlSha256 = createHash('sha256')
    .update(
      JSON.stringify({
        version: doc.top.get('version'),
        state: doc.top.get('state'),
        approval: Object.fromEntries(approval ?? []),
        source: Object.fromEntries(sourceSection ?? []),
        verification: Object.fromEntries(verification ?? []),
        public_target: Object.fromEntries(publicTarget ?? []),
        runtime_basis: Object.fromEntries(runtimeBasis ?? []),
        publication: Object.fromEntries(publication ?? []),
      }),
    )
    .digest('hex')

  const isLegacy060 =
    pkg.version === '0.6.0' &&
    verifiedDsh === '0.2.1-rc.5' &&
    doc.top.get('state') === 'APPROVED_STABLE' &&
    sourceIssue === '129' &&
    sourceBranch === 'work/129-stable-0.6.0' &&
    sourceProductCommit === '397dce88e31274e086dc2f610afdc535d8154438' &&
    publicTarget?.get('branch') === 'stable/0.6.x' &&
    publicTarget?.get('tag') === 'v0.6.0' &&
    publicTarget?.get('npm_dist_tag') === 'latest' &&
    manifestControlSha256 === LEGACY_060_CANONICAL_SHA256
  const isLegacy070Pre1 =
    pkg.version === '0.7.0-pre.1' &&
    verifiedDsh === '0.2.2-alpha.3' &&
    doc.top.get('state') === 'APPROVED_PRERELEASE' &&
    sourceIssue === '129' &&
    sourceBranch === 'work/129-pre-0.7.0' &&
    sourceProductCommit === '3440cec38fbf3b343c05259b175158c1530cf91f' &&
    publicTarget?.get('branch') === 'main' &&
    publicTarget?.get('tag') === 'v0.7.0-pre.1' &&
    publicTarget?.get('npm_dist_tag') === 'prelatest' &&
    manifestControlSha256 === LEGACY_070_PRE1_CANONICAL_SHA256
  const isLegacyImmutableRelease = isLegacy060 || isLegacy070Pre1

  if (!isLegacyImmutableRelease || approvalIssue !== undefined) {
    assert.ok(
      typeof approvalIssue === 'string' && ISSUE_NUMBER_RE.test(approvalIssue),
      'approval.engineering_issue must be a positive integer without leading zeros (at most 9 digits)',
    )
    assert.equal(approvalIssue, sourceIssue, 'approval.engineering_issue must match source.engineering_issue')
  }
  if (!isLegacyImmutableRelease || approvalBranch !== undefined) {
    assert.ok(typeof approvalBranch === 'string' && approvalBranch.length > 0, 'approval.work_branch is required')
    assertValidWorkBranch(approvalBranch, 'approval.work_branch')
    assert.equal(approvalBranch, sourceBranch, 'approval.work_branch must match source.work_branch')
  }

  const approvedVersion = approval?.get('approved_version')
  if (!isLegacyImmutableRelease || approvedVersion !== undefined) {
    assert.ok(typeof approvedVersion === 'string' && approvedVersion.length > 0, 'approval.approved_version is required')
    assert.equal(approvedVersion, pkg.version, 'approval.approved_version must match package.json version')
  }

  const positiveFinalConfirmationRe = /^RECORDED_\d{4}-\d{2}-\d{2}$/u
  const positivePublicExportReviewRe = /^TL_PASSED(?:_REVISION_\d+)?_\d{4}-\d{2}-\d{2}$/u
  const finalConfirmation = typeof approval?.get('final_irreversible_confirmation') === 'string'
    ? trimAscii(approval.get('final_irreversible_confirmation'))
    : ''
  assert.ok(
    finalConfirmation.length > 0 &&
      !denialOrPlaceholderRe.test(finalConfirmation) &&
      positiveFinalConfirmationRe.test(finalConfirmation),
    'Explicit positive approval.final_irreversible_confirmation (RECORDED_YYYY-MM-DD) is required',
  )
  const publicExportReview = typeof approval?.get('public_export_review') === 'string'
    ? trimAscii(approval.get('public_export_review'))
    : ''
  assert.ok(
    publicExportReview.length > 0 &&
      !denialOrPlaceholderRe.test(publicExportReview) &&
      positivePublicExportReviewRe.test(publicExportReview),
    'Explicit positive approval.public_export_review (TL_PASSED[_REVISION_N]_YYYY-MM-DD) is required',
  )

  const pkgDsh = pkg.devDependencies?.['@deepseek-ai/dsh']
  const pkgPluginPi = pkg.devDependencies?.['@earendil-works/pi-ai']
  const pkgHostPi = pkg.lcxCompatibility?.verifiedHostPi
  const pkgVerifiedPluginPi = pkg.lcxCompatibility?.verifiedPluginPi
  assert.ok(typeof pkgDsh === 'string' && pkgDsh.length > 0, 'package.json devDependencies.@deepseek-ai/dsh is required')
  assert.ok(typeof pkgPluginPi === 'string' && pkgPluginPi.length > 0, 'package.json devDependencies.@earendil-works/pi-ai is required')
  assert.ok(typeof pkgHostPi === 'string' && pkgHostPi.length > 0, 'package.json lcxCompatibility.verifiedHostPi is required')
  assert.ok(typeof pkgVerifiedPluginPi === 'string' && pkgVerifiedPluginPi.length > 0, 'package.json lcxCompatibility.verifiedPluginPi is required')
  parseStrictSemver(pkgDsh, 'package.json devDependencies.@deepseek-ai/dsh')
  parseStrictSemver(pkgPluginPi, 'package.json devDependencies.@earendil-works/pi-ai')
  parseStrictSemver(pkgHostPi, 'package.json lcxCompatibility.verifiedHostPi')
  parseStrictSemver(pkgVerifiedPluginPi, 'package.json lcxCompatibility.verifiedPluginPi')

  const basisDsh = runtimeBasis?.get('dsh')
  const basisPluginPi = runtimeBasis?.get('plugin_pi')
  const basisHostPi = runtimeBasis?.get('host_pi')
  assert.ok(typeof basisDsh === 'string' && basisDsh.length > 0, 'runtime_basis.dsh is required')
  assert.ok(typeof basisPluginPi === 'string' && basisPluginPi.length > 0, 'runtime_basis.plugin_pi is required')
  assert.ok(typeof basisHostPi === 'string' && basisHostPi.length > 0, 'runtime_basis.host_pi is required')
  parseStrictSemver(basisDsh, 'runtime_basis.dsh')
  parseStrictSemver(basisPluginPi, 'runtime_basis.plugin_pi')
  parseStrictSemver(basisHostPi, 'runtime_basis.host_pi')

  assert.equal(basisDsh, pkgDsh)
  assert.equal(basisPluginPi, pkgPluginPi)
  assert.equal(basisHostPi, pkgHostPi)
  assert.equal(pkgVerifiedPluginPi, pkgPluginPi)
  assert.equal(pkgHostPi, pkgPluginPi, 'lcxCompatibility.verifiedHostPi must match plugin Pi version')

  const runtimeQaRaw = verification?.get('runtime_qa')
  if (!isLegacyImmutableRelease || runtimeQaRaw !== undefined) {
    const runtimeQa = typeof runtimeQaRaw === 'string' ? trimAscii(runtimeQaRaw) : ''
    assert.equal(
      runtimeQa,
      'PASSED',
      'Explicit verification.runtime_qa: PASSED is required',
    )
  }
  const verificationDshRaw = verification?.get('dsh')
  if (!isLegacyImmutableRelease || verificationDshRaw !== undefined) {
    const verificationDsh = typeof verificationDshRaw === 'string' ? trimAscii(verificationDshRaw) : ''
    assert.equal(
      verificationDsh,
      basisDsh,
      `verification.dsh must match runtime_basis.dsh (${basisDsh})`,
    )
  }
  const positiveVerificationStateRe = isLegacyImmutableRelease
    ? /^(?:ENGINEERING_GATES_AND_RUNTIME_QA_PASSED_TL_ACCEPTED|RUNTIME_QA_PASSED|POST_RELEASE_VERIFIED|POST_RELEASE_CHECKED)$/u
    : /^(?:ENGINEERING_GATES_AND_RUNTIME_QA_PASSED_TL_ACCEPTED|RUNTIME_QA_PASSED)$/u
  const negativeVerificationStateRe = /(?<![A-Za-z0-9])(?:failed|unverified|incomplete|skipped|partial)(?![A-Za-z0-9])/iu
  const verificationState = typeof verification?.get('state') === 'string'
    ? trimAscii(verification.get('state'))
    : ''
  assert.ok(
    verificationState.length > 0 &&
      !denialOrPlaceholderRe.test(verificationState) &&
      !negativeVerificationStateRe.test(verificationState) &&
      positiveVerificationStateRe.test(verificationState),
    isLegacyImmutableRelease
      ? 'Explicit positive verification.state (ENGINEERING_GATES_AND_RUNTIME_QA_PASSED_TL_ACCEPTED, RUNTIME_QA_PASSED, POST_RELEASE_VERIFIED, or POST_RELEASE_CHECKED) is required'
      : 'Explicit positive verification.state (ENGINEERING_GATES_AND_RUNTIME_QA_PASSED_TL_ACCEPTED or RUNTIME_QA_PASSED) is required',
  )
  const verificationProductCommit = verification?.get('product_commit')
  const verificationVerifiedCommit = verification?.get('verified_commit')
  if (!isLegacyImmutableRelease) {
    assert.ok(
      verificationProductCommit !== undefined || verificationVerifiedCommit !== undefined,
      'verification.product_commit or verification.verified_commit is required',
    )
  }
  for (const [commitKey, vCommit] of [
    ['product_commit', verificationProductCommit],
    ['verified_commit', verificationVerifiedCommit],
  ]) {
    if (vCommit !== undefined) {
      assert.ok(
        typeof vCommit === 'string' && /^[0-9a-f]{40}$/u.test(vCommit),
        `verification.${commitKey} must be a 40-char hex commit SHA`,
      )
      assert.equal(vCommit, sourceProductCommit, `verification.${commitKey} must match source.product_commit`)
    }
  }
  const verificationPolicyRaw = verification?.get('policy')
  const verificationPolicy = typeof verificationPolicyRaw === 'string' ? trimAscii(verificationPolicyRaw) : ''
  assert.ok(verificationPolicy.length > 0, 'verification.policy is required')
  const pendingOrBlockedVerificationPolicyRe =
    /(?<![A-Za-z0-9])(?:pending|blocked|unapproved|disapproved|unaccepted|rejected|denied|refused|revoked|cancelled|canceled|withdrawn|failed|unverified|incomplete|skipped|partial|draft|placeholder|tbd|todo|wip|mock|mocks|mocked|fake|awaiting|outstanding|deferred|missing|absent|lacks?|unknown|unclear|unconfirmed|unproven|untested|uncertain|undetermined|inconclusive|speculative|tentative|projected|scheduled|planned|expected|upcoming|tomorrow|later|soon|waived|bypassed|omitted|neither|nor|none|zero|once|when|if|unless|until|whether|assuming|plan|plans|planning|proposal|proposed|hypothetical|hypothetically|example|examples|sample|samples|dry[\s-]+run|simulator|simulators|simulation|simulated|emulator|emulators|emulated|synthetic|stub|stubs|stubbed|double|doubles|caveat|caveats|nominal|except|however|but|although|despite|harness[\s-]+only|illustrative|can|cannot|could|would|should|might|may|will|shall)(?![A-Za-z0-9])|remain(?:s|ing)?\s+pending|only[\s-]+in|no[\s-]+sign|no[\s-]+evidence|lack(?:s|ing)?[\s-]+evidence|without[\s-]+evidence|no[\s-]+proof|without[\s-]+proof|no[\s-]+runtime(?:[\s-]+(?:qa|acceptance))?(?:[\s-]+claim)?|\bno\s+(?:runtime\s+qa|post[\s_-]+release)\b|\bwithout\s+(?:runtime\s+qa|post[\s_-]+release)\b|\bnot\s+(?:yet\s+|been\s+)?(?:verified|pass|passed|complete|completed|accepted|done|run|executed|confirmed|proven)\b|\b(?:has|have|was|were|is|are)\s+not\s+(?:yet\s+|been\s+)?(?:verified|complete|completed|passed|done|run|executed|confirmed|proven)\b|not[\s-]+runtime[\s-]*(?:qa|verified)|runtime[\s-]+qa(?:[^.;,\n]|\.(?=[A-Za-z0-9_-]))*\b(?:not|never|no|without)\b|\bpost[\s_-]+release[\s-]+(?:verification|check)\b(?:[^.;,\n]|\.(?=[A-Za-z0-9_-]))*\b(?:not|never|no|without|did|didn't|doesn't|hasn't|haven't|isn't|wasn't|won't|will|shall|could|would|should|might|may)\b|\b(?:did|do|does|can|cannot|can't|couldn't|didn't|doesn't|hasn't|haven't|isn't|aren't|wasn't|weren't|won't|will\s+not|would\s+not|should\s+not|may\s+not|might\s+not)\b(?:[^.;\n]|\.(?=[A-Za-z0-9_-]))*\b(?:pass(?:ed)?|complete(?:d)?|verif(?:y|ied)|finish(?:ed)?|succeed(?:ed)?|accept(?:ed)?|run|executed|done)\b/iu
  const verificationPolicyWithoutBenignHistorical = verificationPolicy
    .replace(/\bboth stop conditions not hit\b/giu, ' ')
    .replace(/\bENGINEERING_PASS,\s*not VERIFIED\b/giu, ' ')
    .replace(/\b(?:neither is|not|never)\s+npm payload\b/giu, ' ')
    .replace(/\bnot accessible publicly\b/giu, ' ')
    .replace(/\bnot published\b/giu, ' ')
  if (isLegacyImmutableRelease) {
    assert.ok(
      !pendingOrBlockedVerificationPolicyRe.test(verificationPolicyWithoutBenignHistorical),
      'verification.policy must not contain pending, blocked, failed, unverified, incomplete, or no-runtime-claim language',
    )
  }
  for (const shaMatch of verificationPolicy.matchAll(/(?<![0-9a-fA-F])([0-9a-fA-F]{40})(?![0-9a-fA-F])/gu)) {
    assert.equal(
      shaMatch[1].toLowerCase(),
      sourceProductCommit.toLowerCase(),
      `Mismatched commit SHA ${shaMatch[1]} in verification.policy (expected ${sourceProductCommit})`,
    )
  }
  const legacyAllowedCommits = isLegacy060
    ? ['d913800', '397dce8']
    : isLegacy070Pre1
      ? ['7a22654', '3440cec']
      : []
  const assertPolicyCommitSha = (rawSha) => {
    const shaLower = rawSha.toLowerCase()
    const matchesProduct = sourceProductCommit.toLowerCase().startsWith(shaLower)
    const matchesLegacy = isLegacyImmutableRelease && legacyAllowedCommits.includes(shaLower)
    assert.ok(
      matchesProduct || matchesLegacy,
      `Mismatched product commit SHA ${rawSha} in verification.policy (expected ${sourceProductCommit})`,
    )
  }
  for (const gluedMatch of verificationPolicy.matchAll(/\bcommits?([0-9a-f]{7,40})\b/giu)) {
    assert.fail(
      `Malformed commit SHA reference "${gluedMatch[0]}" in verification.policy (separator required before ${gluedMatch[1]}; expected ${sourceProductCommit})`,
    )
  }
  const normalizedCommitText = verificationPolicy
    .replace(/[*_~`"'‘’“”«»()[\]{}]+/gu, ' ')
    .replace(/[ \t]+/gu, ' ')
  for (const listMatch of normalizedCommitText.matchAll(COMMIT_SCAN_RE)) {
    for (const shaToken of listMatch[1].matchAll(/\b([0-9a-f]{7,40})\b/giu)) {
      assertPolicyCommitSha(shaToken[1])
    }
  }
  if (!isLegacyImmutableRelease) {
    for (const dshMatch of verificationPolicy.matchAll(
      /\bdsh\b(?:(?:\s*[:=/(-]\s*|\s+)(?:version|runtime|baseline|is|at|on|build))*[ \t]*[:=/(-]?[ \t]*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/giu,
    )) {
      assert.equal(
        dshMatch[1],
        basisDsh,
        `Mismatched DSH version ${dshMatch[1]} in verification.policy (expected ${basisDsh})`,
      )
    }
  }
  for (const issueMatch of verificationPolicy.matchAll(/(?:private[\s_-]+issue[\s_#:/-]*|docs\/(?:qa|handoff)\/issue[-_/]*)(\d+)/giu)) {
    assert.equal(
      issueMatch[1],
      sourceIssue,
      `Stale or mismatched issue reference #${issueMatch[1]} in verification.policy (expected #${sourceIssue})`,
    )
  }
  const nonUpstreamPolicy = verificationPolicy.replace(
    /\b(?:upstream|dsh|pi(?:-ai)?|openai|xai)\s+(?:issue[-\s#]*\d+|#\d+)\b/giu,
    ' ',
  )
  for (const issueMatch of nonUpstreamPolicy.matchAll(/\bissue-(\d+)\b/giu)) {
    assert.equal(
      issueMatch[1],
      sourceIssue,
      `Stale or mismatched issue reference #${issueMatch[1]} in verification.policy (expected #${sourceIssue})`,
    )
  }
  const escapedBasisDsh = escapeRegExp(basisDsh)
  const escapedSourceIssue = escapeRegExp(sourceIssue)
  const escapedPkgVersion = escapeRegExp(pkg.version)
  const clauseNegationOrFutureRe =
    /\b(?:not|never|no|without|neither|nor|none|zero|did|do|does|can|cannot|will|shall|could|would|should|might|may|once|when|if|unless|until|whether|assuming|plan|plans|planning|proposal|proposed|hypothetical|hypothetically|example|examples|sample|samples|dry[\s-]+run|simulator|simulators|simulation|simulated|emulator|emulators|emulated|synthetic|stub|stubs|stubbed|double|doubles|caveat|caveats|nominal|except|however|but|although|despite|harness[\s-]+only|illustrative|unknown|unclear|unconfirmed|unproven|untested|uncertain|undetermined|pending|blocked|failed|skipped|incomplete|partial|awaiting|outstanding|deferred|missing|absent|lacks?|tomorrow|later|soon|expected|scheduled|upcoming|yet|todo|tbd|wip|draft|mock|mocks|mocked|fake|placeholder|waived|bypassed|omitted)\b|\bonly[\s-]+in\b|\bno[\s-]+sign\b|\b[A-Za-z]+n't\b/iu
  if (isLegacyImmutableRelease) {
    const legacyAffirmativeRe =
      /^(?:(?:(?:the\s+)?(?:real|isolated|full|manual)\s+(?:dsh\s+)?(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\s+)?|(?:the\s+)?exact\s+dsh\s+\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\s+|(?:the\s+)?engineering\s+gates\s*(?:\+|&|and)\s*|the\s+)?(?:runtime[\s-]+qa|post[\s_-]+(?:release|publication)[\s-]+(?:verification|check))(?:\s*\([^)]*\))?(?:\s+(?:on|for|under|with|in|of|at)\s+[^,;()]+)?\s+(?:(?:is|was|are|were|has\s+been|have\s+been|has|have)\s+)?(?:passed|complete(?:d)?|verified|accepted|checked)(?:\s+(?:on|for|under|with|in|of|at)\s+[^,;()]+)?(?:\s*\([^)]*\)?)?|(?:passed|completed|verified|accepted|checked)\s+(?:the\s+)?(?:(?:real|isolated|full|manual)\s+)?(?:dsh\s+(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\s+)?)?(?:runtime[\s-]+qa|post[\s_-]+(?:release|publication)[\s-]+(?:verification|check))(?:\s+(?:on|for|under|with|in|of|at)\s+[^,;()]+)?(?:\s*\([^)]*\)?)?)$/iu
    const hasLegacyCompleted = verificationPolicyWithoutBenignHistorical
      .replace(/\(\s*\)/gu, ' ')
      .split(/[\r\n;,]+|\.(?!\d)(?=\s|$|\))/u)
      .some((rawClause) => {
        const clause = rawClause.trim().replace(/^(?:and|plus)\s+/iu, '').replace(/\s+/gu, ' ')
        return clause.length > 0 && legacyAffirmativeRe.test(clause) && !clauseNegationOrFutureRe.test(clause)
      })
    assert.ok(hasLegacyCompleted, 'verification.policy must affirmatively state completed runtime QA')
  } else {
    const qaDocPathSrc = `docs\\/qa\\/issue-${escapedSourceIssue}\\/[A-Za-z0-9._-]+`
    const issueRefSrc = `(?:private[\\s_-]+issue[\\s_-]*#?${escapedSourceIssue}|issue[\\s_-]*#?${escapedSourceIssue}|#${escapedSourceIssue})`
    const dshRefSrc = `(?:(?:the\\s+)?(?:exact|real|isolated)\\s+dsh\\s+${escapedBasisDsh}|dsh\\s+${escapedBasisDsh})`
    const qaDocPathExactRe = new RegExp(`^${qaDocPathSrc}$`, 'u')
    const qaDshExactRe = new RegExp(`^(?:exact\\s+)?dsh\\s+${escapedBasisDsh}$`, 'iu')
    const qaIssueExactRe = new RegExp(`^${issueRefSrc}$`, 'iu')
    const isValidQaParentheticalItem = (rawItem) => {
      const item = rawItem.trim().replace(/\s+/gu, ' ')
      if (!item) return false
      if (/^both stop conditions not hit$/iu.test(item)) return true
      if (qaDocPathExactRe.test(item) || qaDshExactRe.test(item) || qaIssueExactRe.test(item)) return true
      return parseAndVerifyCommitExpression(item, assertPolicyCommitSha)
    }

    const scopePrepPhraseSrc = `(?:\\s+(?:(?:on|for|under|with)\\s+${dshRefSrc}|(?:for|under|in)\\s+(?:${issueRefSrc}|${qaDocPathSrc})|on\\s+\\d{4}-\\d{2}-\\d{2}|(?:for|of)\\s+(?:v?${escapedPkgVersion}|this\\s+(?:candidate|release)))){0,3}`
    const directClausePrefixSrc = `(?:(?:the\\s+)?(?:real|isolated|full|manual)\\s+(?:dsh\\s+)?(?:${escapedBasisDsh}\\s+)?|(?:the\\s+)?exact\\s+dsh\\s+${escapedBasisDsh}\\s+|(?:the\\s+)?engineering\\s+gates\\s*(?:\\+|&|and)\\s*|the\\s+)?`
    const affirmativeQaCoreRe = new RegExp(
      `^(?:${directClausePrefixSrc}runtime[\\s-]+qa${scopePrepPhraseSrc}\\s+(?:(?:is|was|are|were|has\\s+been|have\\s+been|has|have)\\s+)?(?:passed|complete(?:d)?|verified|accepted|checked)${scopePrepPhraseSrc}|(?:passed|completed|verified|accepted|checked)\\s+(?:the\\s+)?(?:(?:real|isolated|full|manual)\\s+)?(?:dsh\\s+(?:${escapedBasisDsh}\\s+)?)?runtime[\\s-]+qa${scopePrepPhraseSrc})$`,
      'iu',
    )
    const isRuntimeQaCompletionClause = (clause) => {
      let core = clause
      while (core.endsWith(')')) {
        const openIdx = core.lastIndexOf('(')
        if (openIdx === -1) return false
        const inner = core.slice(openIdx + 1, -1).trim()
        if (!inner) return false
        const items = inner.split(';')
        if (!items.every(isValidQaParentheticalItem)) return false
        core = core.slice(0, openIdx).trim()
      }
      if (!core || core.includes('(') || core.includes(')')) return false
      return affirmativeQaCoreRe.test(core) && !clauseNegationOrFutureRe.test(core)
    }

    const commitScopeSuffixRe = new RegExp(
      `(?:\\s+(?:under|for|on)\\s+(?:${qaDocPathSrc}|${issueRefSrc}|${dshRefSrc}))+$`,
      'iu',
    )
    const isCommitAttestationClause = (clause) => {
      if (clause.includes('(') || clause.includes(')')) return false
      const stripped = clause.replace(commitScopeSuffixRe, '').trim()
      return stripped.length > 0 && parseAndVerifyCommitExpression(stripped, assertPolicyCommitSha)
    }

    const qaDocRefClauseRe = new RegExp(
      `^(?:(?:recorded|verified|documented|see)\\s+(?:under|in|at)\\s+)?(?:(?:${issueRefSrc}(?:\\s+(?:and|under))?\\s*)|${qaDocPathSrc})+$`,
      'iu',
    )
    const engineeringGatesClauseRe = new RegExp(
      `^(?:all\\s+)?(?:engineering(?:\\s+and\\s+contract)?\\s+gates|tl\\s+(?:engineering\\s+)?review|technical\\s+lead\\s+(?:acceptance|review))(?:\\s+(?:on|for)\\s+(?:${dshRefSrc}|${issueRefSrc}|v?${escapedPkgVersion}))*\\s+(?:passed|complete(?:d)?|accepted|verified)(?:\\s+(?:on|for|under)\\s+(?:${dshRefSrc}|${issueRefSrc}|${qaDocPathSrc}|v?${escapedPkgVersion}))*$`,
      'iu',
    )
    const upstreamTrackingClauseRe = new RegExp(
      `^${UPSTREAM_LEAD_SRC}(?:${UPSTREAM_LIST_SEP_SRC}${UPSTREAM_TAIL_ITEM_SRC})*\\s+(?:remains?|are|is)\\s+(?:tracked|open|non-blocking|out-of-scope)(?:\\s+upstream)?$`,
      'iu',
    )
    const isAllowedClosedClause = (clause) =>
      isRuntimeQaCompletionClause(clause) ||
      isCommitAttestationClause(clause) ||
      qaDocRefClauseRe.test(clause) ||
      engineeringGatesClauseRe.test(clause) ||
      upstreamTrackingClauseRe.test(clause)

    let clauses = null
    let parenParseErr = null
    try {
      clauses = splitTopLevelVerificationClauses(verificationPolicy)
    } catch (err) {
      parenParseErr = err
    }
    const verificationPolicyForDenylist = clauses
      ? clauses
          .map((clause) => (isRuntimeQaCompletionClause(clause) ? sanitizeValidatedQaClauseForDenylist(clause) : clause))
          .join(' ; ')
      : verificationPolicy
    assert.ok(
      !pendingOrBlockedVerificationPolicyRe.test(verificationPolicyForDenylist) &&
        !/\bnot\b/iu.test(verificationPolicyForDenylist) &&
        !/\bpost[\s_-]+release\b/iu.test(verificationPolicyForDenylist),
      'verification.policy must not contain pending, blocked, failed, unverified, incomplete, or no-runtime-claim language',
    )
    if (parenParseErr) throw parenParseErr

    assert.ok(
      clauses.length > 0 && clauses.some(isRuntimeQaCompletionClause),
      'verification.policy must affirmatively state completed runtime QA',
    )
    const invalidClauses = clauses.filter((clause) => !isAllowedClosedClause(clause))
    assert.equal(
      invalidClauses.length,
      0,
      `verification.policy contains unrecognized clause: ${invalidClauses[0]}`,
    )
  }
  assert.equal(publicTarget?.get('tag'), `v${pkg.version}`)

  const targetBranch = publicTarget?.get('branch')
  assert.ok(targetBranch, 'public_target.branch is required')
  assert.match(targetBranch, /^(?:main|stable\/\d+\.\d+\.x)$/u, `Unsupported public_target.branch format: ${targetBranch}`)
  const distTag = publicTarget?.get('npm_dist_tag')
  assert.ok(distTag, 'public_target.npm_dist_tag is required')
  assert.match(distTag, /^(?:latest|prelatest|stable-\d+\.\d+)$/u, `Unsupported public_target.npm_dist_tag format: ${distTag}`)
  const previousLatestMustBe = publicTarget?.get('previous_latest_must_be')
  const stableLatestMustRemain = publicTarget?.get('stable_latest_must_remain')

  if (prerelease) {
    assert.equal(distTag, 'prelatest')
    assert.equal(previousLatestMustBe, undefined, 'Prerelease must not set public_target.previous_latest_must_be')
    assert.ok(stableLatestMustRemain, 'Prerelease must record the stable latest version that may not move')
    const parsedRemain = parseStrictSemver(stableLatestMustRemain, 'public_target.stable_latest_must_remain')
    assert.equal(parsedRemain.prerelease.length, 0, 'public_target.stable_latest_must_remain must be a stable SemVer')
    assert.equal(parsedRemain.build.length, 0, 'public_target.stable_latest_must_remain must not contain build metadata')
    for (const [name, peerRange] of Object.entries(pkg.peerDependencies ?? {})) {
      if (!name.startsWith('@deepseek-ai/dsh-')) continue
      assertInstallRange(peerRange, verifiedDsh)
      assert.equal(peerRange, installRange, `peerDependencies.${name} must match lcxCompatibility.dshInstallRange`)
    }
  } else {
    const versionMinor = `${parsedVersion.major}.${parsedVersion.minor}`
    const maintenanceMatch = /^stable\/(\d+\.\d+)\.x$/u.exec(targetBranch)
    if (targetBranch === 'main' || (isLegacy060 && targetBranch === 'stable/0.6.x')) {
      assert.equal(distTag, 'latest', 'Stable main release must publish to npm dist-tag latest')
      assert.equal(stableLatestMustRemain, undefined, 'Stable main release must not set public_target.stable_latest_must_remain')
      assert.ok(previousLatestMustBe, 'Stable main release must record the previous latest version')
      const parsedPrev = parseStrictSemver(previousLatestMustBe, 'public_target.previous_latest_must_be')
      assert.equal(parsedPrev.prerelease.length, 0, 'public_target.previous_latest_must_be must be a stable SemVer')
      assert.equal(parsedPrev.build.length, 0, 'public_target.previous_latest_must_be must not contain build metadata')
      assert.ok(
        compareSemver(parsedVersion, parsedPrev) > 0,
        `Stable promotion must advance latest beyond previous_latest_must_be (${previousLatestMustBe} -> ${pkg.version})`,
      )
    } else if (maintenanceMatch && maintenanceMatch[1] === versionMinor) {
      const expectedMaintTag = `stable-${versionMinor}`
      assert.equal(
        distTag,
        expectedMaintTag,
        `Maintenance branch ${targetBranch} must publish to approved channel ${expectedMaintTag}`,
      )
      assert.equal(previousLatestMustBe, undefined, `Maintenance branch ${targetBranch} must not set public_target.previous_latest_must_be`)
      assert.ok(
        stableLatestMustRemain,
        `Maintenance branch ${targetBranch} must record stable_latest_must_remain so npm latest never moves`,
      )
      const parsedRemain = parseStrictSemver(stableLatestMustRemain, 'public_target.stable_latest_must_remain')
      assert.equal(parsedRemain.prerelease.length, 0, 'public_target.stable_latest_must_remain must be a stable SemVer')
      assert.equal(parsedRemain.build.length, 0, 'public_target.stable_latest_must_remain must not contain build metadata')
    } else {
      assert.fail(`Unsupported stable target branch "${targetBranch}" for version ${pkg.version}`)
    }
    assertStableBoundedRange(installRange, 'lcxCompatibility.dshInstallRange', verifiedDsh)
    for (const [name, peerRange] of Object.entries(pkg.peerDependencies ?? {})) {
      if (!name.startsWith('@deepseek-ai/dsh-')) continue
      assertStableBoundedRange(peerRange, `peerDependencies.${name}`, verifiedDsh)
      assert.equal(peerRange, installRange, `peerDependencies.${name} must match lcxCompatibility.dshInstallRange`)
    }
  }
  if (runtimeBasis?.has('install_range')) {
    const basisRange = runtimeBasis.get('install_range')
    if (isLegacyImmutableRelease) {
      assert.ok(
        basisRange === installRange || (typeof basisRange === 'string' && basisRange.startsWith(`${installRange} (`)),
        'runtime_basis.install_range must match lcxCompatibility.dshInstallRange',
      )
    } else {
      assert.equal(basisRange, installRange)
    }
  }

  return {
    version: pkg.version,
    tag: `v${pkg.version}`,
    prerelease,
    branch: targetBranch,
    distTag,
    previousLatestMustBe,
    stableLatestMustRemain,
  }
}
