import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const runtime = realpathSync(process.argv[2] ?? join(root, 'scripts/runtime-dsh015'))
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const runtimeRequire = createRequire(join(runtime, 'package.json'))
assert.equal(runtimeRequire('@deepseek-ai/dsh/package.json').version, '0.1.5-alpha.2')
const hostPi = createRequire(runtimeRequire.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json'))
const hostPiManifest = hostPi.resolve.paths('@earendil-works/pi-ai')
  .map(path => join(path, '@earendil-works/pi-ai/package.json')).find(existsSync)
assert.ok(hostPiManifest, 'Missing host Pi package')
assert.equal(readJson(hostPiManifest).version, '0.85.1')
const pkg = readJson(join(root, 'package.json'))
assert.equal(pkg.dependencies, undefined)
assert.equal(pkg.devDependencies['@earendil-works/pi-ai'], '0.85.1')
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
    assert.equal(readJson(join(target, 'package.json')).version, '0.1.5-alpha.2')
    assert.equal(pkg.peerDependencies[name], '0.1.5-alpha.2')
  }
  if (name === '@earendil-works/pi-ai')
    assert.equal(readJson(join(target, 'package.json')).version, '0.85.1')
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
console.log('Linked DSH 0.1.5-alpha.2 published packages; build-time Pi 0.85.1')
