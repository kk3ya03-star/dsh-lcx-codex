import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStrictComparatorSet, satisfiesStrictRange } from './semver-range.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const runtime = realpathSync(process.argv[2] ?? join(root, 'scripts/runtime-dsh022'))
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const runtimeRequire = createRequire(join(runtime, 'package.json'))

const pkg = readJson(join(root, 'package.json'))
const compatibility = pkg.lcxCompatibility
assert.ok(compatibility && typeof compatibility === 'object', 'Missing lcxCompatibility policy')
assert.equal(pkg.devDependencies['@deepseek-ai/dsh'], compatibility.verifiedDsh, 'Release/CI DSH baseline must stay exact')
assert.equal(pkg.devDependencies['@earendil-works/pi-ai'], compatibility.verifiedPluginPi, 'Plugin Pi must match the declared plugin Pi baseline')
assert.equal(pkg.dependencies, undefined)

const runtimeDshVersion = runtimeRequire('@deepseek-ai/dsh/package.json').version
const parsedInstallRange = parseStrictComparatorSet(compatibility.dshInstallRange, 'lcxCompatibility.dshInstallRange')
assert.ok(
  satisfiesStrictRange(runtimeDshVersion, parsedInstallRange),
  `DSH ${runtimeDshVersion} is outside LCX install range ${compatibility.dshInstallRange}`,
)

const hostPi = createRequire(runtimeRequire.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json'))
const hostPiManifest = hostPi.resolve.paths('@earendil-works/pi-ai')
  .map(path => join(path, '@earendil-works/pi-ai/package.json')).find(existsSync)
assert.ok(hostPiManifest, 'Missing host Pi package')
assert.equal(readJson(hostPiManifest).version, compatibility.verifiedHostPi, 'Host Pi changed; compatibility reassessment required')
const pluginPiManifest = join(root, 'node_modules/@earendil-works/pi-ai/package.json')
assert.ok(existsSync(pluginPiManifest), 'Missing plugin Pi package')
assert.equal(readJson(pluginPiManifest).version, compatibility.verifiedPluginPi, 'Plugin Pi changed; LCX protocol reassessment required')

const names = new Set([
  ...Object.keys(pkg.devDependencies),
  ...Object.keys(pkg.peerDependencies),
  '@deepseek-ai/cosmokit',
])
// The tests also import host packages directly (persistence, agent loop, compaction plugins, ...). Link every
// DSH package the selected runtime provides, so a gate run resolves one whole DSH, independent of how npm
// hoisted the root install and of which DSH version that install pins.
const runtimeScope = join(runtime, 'node_modules/@deepseek-ai')
for (const entry of existsSync(runtimeScope) ? readdirSync(runtimeScope) : [])
  if (entry.startsWith('dsh-')) names.add(`@deepseek-ai/${entry}`)
const currentTarget = path => {
  try { return realpathSync(path) } catch { return undefined }
}
// A link an earlier run made to a package this runtime does not provide would keep another DSH reachable.
const rootScope = resolve(root, 'node_modules/@deepseek-ai')
for (const entry of existsSync(rootScope) ? readdirSync(rootScope) : []) {
  const destination = join(rootScope, entry)
  if (!entry.startsWith('dsh-') || names.has(`@deepseek-ai/${entry}`) || !lstatSync(destination).isSymbolicLink()) continue
  if (!(currentTarget(destination) ?? '').startsWith(runtime + sep)) rmSync(destination, { force: true })
}
for (const name of names) {
  if (name === '@earendil-works/pi-ai') continue
  const manifest = runtimeRequire.resolve(name + '/package.json')
  const target = dirname(manifest)
  if (name.startsWith('@deepseek-ai/dsh-')) {
    assert.equal(readJson(join(target, 'package.json')).version, runtimeDshVersion, `${name} must match the selected DSH runtime`)
    if (Object.hasOwn(pkg.peerDependencies, name))
      assert.equal(pkg.peerDependencies[name], compatibility.dshInstallRange, `${name} peer must use the shared DSH install range`)
  }
  const destination = resolve(root, 'node_modules', name)
  assert.ok(destination.startsWith(resolve(root, 'node_modules') + sep))
  // Node resolution can fall back to this checkout for build-only dependencies.
  // Keep those real directories; deleting them would create a dangling self-link.
  const targetReal = realpathSync(target)
  if (resolve(target) === destination) continue
  const existing = lstatSync(destination, { throwIfNoEntry: false })
  // A link left by an earlier run may dangle (its runtime was removed); it is replaced like any other.
  if (existing && currentTarget(destination) === targetReal) continue
  assert.ok(!targetReal.startsWith(destination + sep), 'Link source must not be inside its replacement destination')
  if (existing) rmSync(destination, { recursive: !existing.isSymbolicLink(), force: true })
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir')
}
console.log(`Linked DSH ${runtimeDshVersion} within ${compatibility.dshInstallRange}; verified baseline ${compatibility.verifiedDsh}; host Pi ${compatibility.verifiedHostPi}; plugin Pi ${compatibility.verifiedPluginPi}`)
