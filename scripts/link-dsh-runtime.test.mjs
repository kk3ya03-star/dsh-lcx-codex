import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'

const installRange = '>=0.1.5-rc.1 <0.1.6'
const verifiedDsh = '0.1.5-rc.1'
const hostPi = '0.85.1'

function fixture(t, runtimeVersion = verifiedDsh, runtimePi = hostPi) {
  const output = fileURLToPath(new URL('../output/', import.meta.url))
  mkdirSync(output, { recursive: true })
  const root = mkdtempSync(join(output, 'lcx-runtime-link-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const runtime = join(root, 'scripts/runtime-dsh015')
  mkdirSync(runtime, { recursive: true })
  copyFileSync(new URL('./link-dsh-runtime.mjs', import.meta.url), join(root, 'scripts/link-dsh-runtime.mjs'))
  const write = (path, json) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(json)) }
  write(join(root, 'package.json'), {
    type: 'module',
    devDependencies: { '@deepseek-ai/dsh': verifiedDsh, '@earendil-works/pi-ai': hostPi, 'local-build-tool': '1.0.0' },
    peerDependencies: { '@deepseek-ai/dsh-session': installRange },
    lcxCompatibility: { dshInstallRange: installRange, verifiedDsh, verifiedHostPi: hostPi },
  })
  write(join(runtime, 'package.json'), { private: true })
  for (const [name, version] of Object.entries({
    '@deepseek-ai/dsh': runtimeVersion,
    '@deepseek-ai/dsh-session': runtimeVersion,
    '@deepseek-ai/dsh-llm-pi-ai': runtimeVersion,
    '@earendil-works/pi-ai': runtimePi,
    '@deepseek-ai/cosmokit': '1.0.0',
  })) write(join(runtime, 'node_modules', name, 'package.json'), { name, version })
  const local = join(root, 'node_modules/local-build-tool')
  write(join(local, 'package.json'), { name: 'local-build-tool', version: '1.0.0' })
  return { root, runtime, local, run: () => execFileSync(process.execPath, ['scripts/link-dsh-runtime.mjs'], { cwd: root }) }
}

test('runtime linking preserves local build dependencies and is repeatable on verified rc.1', t => {
  const f = fixture(t)
  const before = readFileSync(join(f.local, 'package.json'))
  f.run()
  assert.equal(lstatSync(f.local).isSymbolicLink(), false)
  assert.deepEqual(readFileSync(join(f.local, 'package.json')), before)
  const host = join(f.root, 'node_modules/@deepseek-ai/dsh-session')
  assert.equal(realpathSync(host), realpathSync(join(f.runtime, 'node_modules/@deepseek-ai/dsh-session')))
  f.run()
  assert.ok(existsSync(join(f.local, 'package.json')))
  assert.deepEqual(readFileSync(join(f.local, 'package.json')), before)
})

test('later 0.1.5 RCs can be assessed without changing plugin version guards', t => {
  assert.doesNotThrow(() => fixture(t, '0.1.5-rc.2').run())
})

test('final 0.1.5 can be assessed within the same install range', t => {
  assert.doesNotThrow(() => fixture(t, '0.1.5').run())
})

test('older prereleases and the next DSH line fail closed', t => {
  assert.throws(() => fixture(t, '0.1.5-alpha.2').run(), /outside LCX install range/u)
  assert.throws(() => fixture(t, '0.1.6-alpha.1').run(), /outside LCX install range/u)
  assert.throws(() => fixture(t, '0.1.6').run(), /outside LCX install range/u)
})

test('a host Pi change still forces compatibility reassessment', t => {
  assert.throws(() => fixture(t, '0.1.5-rc.2', '0.85.2').run(), /Host Pi changed/u)
})
