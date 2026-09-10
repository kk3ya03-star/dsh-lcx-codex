import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const runtime = realpathSync(process.argv[2] ?? join(root, 'scripts/runtime-dsh015'))
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const runtimeRequire = createRequire(join(runtime, 'package.json'))

function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value)
  assert.ok(match, `Unsupported semantic version: ${value}`)
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function compareIdentifiers(left, right) {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined
  const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined
  if (leftNumber !== undefined && rightNumber !== undefined) return Math.sign(leftNumber - rightNumber)
  if (leftNumber !== undefined) return -1
  if (rightNumber !== undefined) return 1
  return left === right ? 0 : left < right ? -1 : 1
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return Math.sign(left.core[index] - right.core[index])
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

function sameCore(left, right) {
  return left.core.every((value, index) => value === right.core[index])
}

function satisfiesSimpleRange(version, range) {
  assert.ok(!range.includes('||'), 'DSH compatibility range must be one bounded comparator set')
  const parsed = parseSemver(version)
  const comparators = range.trim().split(/\s+/u).map(raw => {
    const match = /^(>=|<=|>|<|=)?(.+)$/.exec(raw)
    assert.ok(match, `Unsupported DSH range comparator: ${raw}`)
    return { operator: match[1] ?? '=', version: parseSemver(match[2]) }
  })
  // Match npm semver prerelease intent: a prerelease is admitted only when one
  // comparator explicitly names a prerelease on the same major/minor/patch.
  if (parsed.prerelease.length > 0 && !comparators.some(item => item.version.prerelease.length > 0 && sameCore(parsed, item.version))) return false
  return comparators.every(item => {
    const compared = compareSemver(parsed, item.version)
    if (item.operator === '>=') return compared >= 0
    if (item.operator === '<=') return compared <= 0
    if (item.operator === '>') return compared > 0
    if (item.operator === '<') return compared < 0
    return compared === 0
  })
}

const pkg = readJson(join(root, 'package.json'))
const compatibility = pkg.lcxCompatibility
assert.ok(compatibility && typeof compatibility === 'object', 'Missing lcxCompatibility policy')
assert.equal(pkg.devDependencies['@deepseek-ai/dsh'], compatibility.verifiedDsh, 'Release/CI DSH baseline must stay exact')
assert.equal(pkg.devDependencies['@earendil-works/pi-ai'], compatibility.verifiedHostPi, 'Plugin Pi must match verified host Pi baseline')
assert.equal(pkg.dependencies, undefined)

const runtimeDshVersion = runtimeRequire('@deepseek-ai/dsh/package.json').version
assert.ok(
  satisfiesSimpleRange(runtimeDshVersion, compatibility.dshInstallRange),
  `DSH ${runtimeDshVersion} is outside LCX install range ${compatibility.dshInstallRange}`,
)

const hostPi = createRequire(runtimeRequire.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json'))
const hostPiManifest = hostPi.resolve.paths('@earendil-works/pi-ai')
  .map(path => join(path, '@earendil-works/pi-ai/package.json')).find(existsSync)
assert.ok(hostPiManifest, 'Missing host Pi package')
assert.equal(readJson(hostPiManifest).version, compatibility.verifiedHostPi, 'Host Pi changed; compatibility reassessment required')

const names = new Set([
  ...Object.keys(pkg.devDependencies),
  ...Object.keys(pkg.peerDependencies),
  '@deepseek-ai/cosmokit',
])
for (const name of names) {
  const manifest = name === '@earendil-works/pi-ai'
    ? hostPiManifest
    : runtimeRequire.resolve(name + '/package.json')
  const target = dirname(manifest)
  if (name.startsWith('@deepseek-ai/dsh-')) {
    assert.equal(readJson(join(target, 'package.json')).version, runtimeDshVersion, `${name} must match the selected DSH runtime`)
    assert.equal(pkg.peerDependencies[name], compatibility.dshInstallRange, `${name} peer must use the shared DSH install range`)
  }
  if (name === '@earendil-works/pi-ai')
    assert.equal(readJson(join(target, 'package.json')).version, compatibility.verifiedHostPi)
  const destination = resolve(root, 'node_modules', name)
  assert.ok(destination.startsWith(resolve(root, 'node_modules') + sep))
  // Node resolution can fall back to this checkout for build-only dependencies.
  // Keep those real directories; deleting them would create a dangling self-link.
  const targetReal = realpathSync(target)
  if (resolve(target) === destination) continue
  const existing = lstatSync(destination, { throwIfNoEntry: false })
  if (existing && realpathSync(destination) === targetReal) continue
  assert.ok(!targetReal.startsWith(destination + sep), 'Link source must not be inside its replacement destination')
  if (existing) rmSync(destination, { recursive: !existing.isSymbolicLink(), force: true })
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir')
}
console.log(`Linked DSH ${runtimeDshVersion} within ${compatibility.dshInstallRange}; verified baseline ${compatibility.verifiedDsh}; host Pi ${compatibility.verifiedHostPi}`)
