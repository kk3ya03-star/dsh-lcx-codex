import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const runtime = realpathSync(process.argv[2])
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const runtimeRequire = createRequire(join(runtime, 'package.json'))
assert.equal(runtimeRequire('@deepseek-ai/dsh/package.json').version, '0.1.5-alpha.1')
const hostPi = createRequire(runtimeRequire.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json'))
const hostPiManifest = hostPi.resolve.paths('@earendil-works/pi-ai')
  .map(path => join(path, '@earendil-works/pi-ai/package.json')).find(existsSync)
assert.ok(hostPiManifest, 'Missing host Pi package')
assert.equal(readJson(hostPiManifest).version, '0.85.1')
const pkg = readJson(join(root, 'package.json'))
assert.equal(pkg.dependencies['@earendil-works/pi-ai'], '0.85.1')
const names = [...Object.keys(pkg.peerDependencies).filter(name => name.startsWith('@deepseek-ai/')), '@deepseek-ai/cosmokit']
for (const name of names) {
  const target = dirname(runtimeRequire.resolve(name + '/package.json'))
  if (name.startsWith('@deepseek-ai/dsh-')) {
    assert.equal(readJson(join(target, 'package.json')).version, '0.1.5-alpha.1')
    assert.equal(pkg.peerDependencies[name], '0.1.5-alpha.1')
  }
  const destination = resolve(root, 'node_modules', name)
  assert.equal(dirname(destination), resolve(root, 'node_modules/@deepseek-ai'))
  const existing = lstatSync(destination, { throwIfNoEntry: false })
  if (existing) rmSync(destination, { recursive: !existing.isSymbolicLink(), force: true })
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir')
}
console.log('Linked DSH 0.1.5-alpha.1 published packages; host and plugin Pi 0.85.1')
