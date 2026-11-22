import assert from 'node:assert/strict'

const STRICT_SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

const COMPARATOR_TOKEN_RE = /^(>=|<=|>|<|=)?([^\s]+)$/u

export function parseStrictSemver(value, label = 'version') {
  assert.equal(typeof value, 'string', `${label} must be a string`)
  const match = STRICT_SEMVER_RE.exec(value)
  assert.ok(match, `${label} "${value}" is not valid strict SemVer`)
  return {
    raw: value,
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
    build: match[5] === undefined ? [] : match[5].split('.'),
  }
}

function compareIdentifiers(left, right) {
  const leftNum = /^\d+$/u.test(left) ? BigInt(left) : undefined
  const rightNum = /^\d+$/u.test(right) ? BigInt(right) : undefined
  if (leftNum !== undefined && rightNum !== undefined) {
    return leftNum === rightNum ? 0 : leftNum < rightNum ? -1 : 1
  }
  if (leftNum !== undefined) return -1
  if (rightNum !== undefined) return 1
  return left === right ? 0 : left < right ? -1 : 1
}

export function compareSemver(leftInput, rightInput) {
  const left = typeof leftInput === 'string' ? parseStrictSemver(leftInput) : leftInput
  const right = typeof rightInput === 'string' ? parseStrictSemver(rightInput) : rightInput
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0
    return left.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1
    if (right.prerelease[index] === undefined) return 1
    const compared = compareIdentifiers(left.prerelease[index], right.prerelease[index])
    if (compared !== 0) return compared
  }
  return 0
}

export function isExclusivePrereleaseZeroCeiling(comparator) {
  return (
    comparator.operator === '<' &&
    comparator.semver.prerelease.length === 1 &&
    comparator.semver.prerelease[0] === '0' &&
    comparator.semver.build.length === 0
  )
}

export function isExpectedReleaseCeiling(semverObj, verifiedObj) {
  return (
    semverObj.major === verifiedObj.major &&
    semverObj.minor === verifiedObj.minor &&
    semverObj.patch === verifiedObj.patch + 1n &&
    semverObj.prerelease.length === 1 &&
    semverObj.prerelease[0] === '0' &&
    semverObj.build.length === 0
  )
}

export function parseStrictComparatorSet(range, label = 'install range') {
  assert.equal(typeof range, 'string', `${label} must be a string`)
  const trimmed = range.trim()
  assert.ok(trimmed.length > 0, `${label} must be a non-empty SemVer range`)
  assert.doesNotMatch(trimmed, /\|\|/u, `${label} must be a single comparator set without ||`)
  assert.doesNotMatch(trimmed, /[,*^~]/u, `${label} cannot use *, ^, ~, or comma ranges`)
  assert.doesNotMatch(trimmed, /\s-\s/u, `${label} cannot use hyphen ranges`)

  const tokens = trimmed.split(/\s+/u)
  const comparators = tokens.map((token) => {
    const match = COMPARATOR_TOKEN_RE.exec(token)
    assert.ok(match, `${label} has unsupported comparator token "${token}"`)
    const operator = match[1] ?? '='
    const verStr = match[2]
    assert.ok(
      !verStr.includes('+') && !/^[><=]/.test(verStr),
      `${label} comparator "${token}" is malformed (no internal spaces or build metadata allowed)`,
    )
    const semver = parseStrictSemver(verStr, `${label} comparator`)
    assert.equal(semver.build.length, 0, `${label} comparator "${token}" cannot contain build metadata`)
    return {
      raw: token,
      operator,
      semver,
      value: `${operator}${verStr}`,
    }
  })

  return comparators
}

export function satisfiesStrictRange(version, rangeOrComparators) {
  const parsed = typeof version === 'string' ? parseStrictSemver(version) : version
  const comparators = typeof rangeOrComparators === 'string'
    ? parseStrictComparatorSet(rangeOrComparators)
    : rangeOrComparators
  return comparators.every((item) => {
    const compared = compareSemver(parsed, item.semver)
    if (item.operator === '>=') return compared >= 0
    if (item.operator === '<=') return compared <= 0
    if (item.operator === '>') return compared > 0
    if (item.operator === '<') return compared < 0
    return compared === 0
  })
}

export function assertNoBareUpperBounds(comparators, label = 'install range') {
  for (const comparator of comparators) {
    if (comparator.operator === '<' || comparator.operator === '<=') {
      assert.ok(
        isExclusivePrereleaseZeroCeiling(comparator),
        `${label}: Bounded install ranges must exclude next-version prereleases with <X.Y.Z-0`,
      )
    }
  }
}

export function assertNonEmptyBounds(comparators, label = 'install range') {
  const exacts = comparators.filter((c) => c.operator === '=')
  const lowers = comparators.filter((c) => c.operator === '>=' || c.operator === '>')
  const uppers = comparators.filter((c) => c.operator === '<' || c.operator === '<=')
  for (const upper of uppers) {
    if (
      upper.operator === '<' &&
      upper.semver.major === 0n &&
      upper.semver.minor === 0n &&
      upper.semver.patch === 0n &&
      upper.semver.prerelease.length === 1 &&
      upper.semver.prerelease[0] === '0'
    ) {
      assert.fail(`${label} is empty: upper bound ${upper.raw} admits no SemVer versions`)
    }
  }
  for (const exact of exacts) {
    assert.ok(
      satisfiesStrictRange(exact.semver, comparators),
      `${label} is contradictory around exact comparator ${exact.raw}`,
    )
  }
  for (const lower of lowers) {
    for (const upper of uppers) {
      const cmp = compareSemver(lower.semver, upper.semver)
      const ok = lower.operator === '>=' && upper.operator === '<=' ? cmp <= 0 : cmp < 0
      assert.ok(
        ok,
        `${label} is contradictory: lower bound ${lower.raw} is not below upper bound ${upper.raw}`,
      )
      if (
        lower.operator === '>' &&
        lower.semver.prerelease.length === 0 &&
        isExpectedReleaseCeiling(upper.semver, lower.semver)
      ) {
        assert.fail(
          `${label} is empty: strict ${lower.raw} paired with ${upper.raw} admits no SemVer versions`,
        )
      }
    }
  }
  return { exacts, lowers, uppers }
}
