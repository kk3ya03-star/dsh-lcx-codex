import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { globSync, lstatSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const lib = fileURLToPath(new URL('../lib', import.meta.url))
assert.ok(lstatSync(lib).isDirectory() && !lstatSync(lib).isSymbolicLink(), 'lib must be a real generated directory')
const snapshot = () => new Map(globSync('lib/**/*', { cwd: root })
  .filter(path => lstatSync(new URL(`../${path.replaceAll('\\', '/')}`, import.meta.url)).isFile())
  .map(path => [path, readFileSync(new URL(`../${path.replaceAll('\\', '/')}`, import.meta.url))]))
const before = snapshot()
// The only removal target is this checkout's generated lib, never the DSH source.
rmSync(lib, { recursive: true })
for (const args of [
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
  ['scripts/build-pi-runtime.mjs'],
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.client.json'],
  ['scripts/build-client.mjs'],
]) execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
const after = snapshot()
assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), 'Generated file set drifted')
for (const [path, bytes] of before) assert.ok(bytes.equals(after.get(path)), `Generated output drifted: ${path}`)
console.log(`Clean TypeScript rebuild matches ${after.size} generated files`)
