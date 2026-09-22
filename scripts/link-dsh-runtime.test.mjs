import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'

const installRange = '>=0.1.6-alpha.2 <0.1.7'
const verifiedDsh = '0.1.6-alpha.2'
const hostPi = '0.85.1'
const pluginPi = '0.86.0'

function fixture(t, runtimeVersion = verifiedDsh, runtimePi = hostPi, rootPi = pluginPi) {
  const output = fileURLToPath(new URL('../output/', import.meta.url))
  mkdirSync(output, { recursive: true })
  const root = mkdtempSync(join(output, 'lcx-runtime-link-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const runtime = join(root, 'scripts/runtime-dsh016')
  mkdirSync(runtime, { recursive: true })
  copyFileSync(new URL('./link-dsh-runtime.mjs', import.meta.url), join(root, 'scripts/link-dsh-runtime.mjs'))
  const write = (path, json) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(json)) }
  write(join(root, 'package.json'), {
    type: 'module',
    devDependencies: { '@deepseek-ai/dsh': verifiedDsh, '@earendil-works/pi-ai': rootPi, 'local-build-tool': '1.0.0' },
    peerDependencies: { '@deepseek-ai/dsh-session': installRange },
    lcxCompatibility: { dshInstallRange: installRange, verifiedDsh, verifiedHostPi: hostPi, verifiedPluginPi: rootPi },
  })
  write(join(runtime, 'package.json'), { private: true })
  for (const [name, version] of Object.entries({
    '@deepseek-ai/dsh': runtimeVersion,
    '@deepseek-ai/dsh-session': runtimeVersion,
    '@deepseek-ai/dsh-llm-pi-ai': runtimeVersion,
    '@earendil-works/pi-ai': runtimePi,
    '@deepseek-ai/cosmokit': '1.0.0',
  })) write(join(runtime, 'node_modules', name, 'package.json'), { name, version })
  write(join(root, 'node_modules/@earendil-works/pi-ai/package.json'), { name: '@earendil-works/pi-ai', version: rootPi })
  const local = join(root, 'node_modules/local-build-tool')
  write(join(local, 'package.json'), { name: 'local-build-tool', version: '1.0.0' })
  return { root, runtime, local, run: () => execFileSync(process.execPath, ['scripts/link-dsh-runtime.mjs'], { cwd: root }) }
}

test('runtime linking preserves local build dependencies and is repeatable on verified alpha.2', t => {
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
  assert.equal(JSON.parse(readFileSync(join(f.root, 'node_modules/@earendil-works/pi-ai/package.json'))).version, pluginPi)
})

test('runtime linking keeps plugin Pi independent from the DSH host Pi', t => {
  const f = fixture(t, verifiedDsh, hostPi, pluginPi)
  assert.doesNotThrow(() => f.run())
  assert.equal(JSON.parse(readFileSync(join(f.root, 'node_modules/@earendil-works/pi-ai/package.json'))).version, pluginPi)
})

test('older DSH lines and later release lines fail closed', t => {
  assert.throws(() => fixture(t, '0.1.5-rc.2').run(), /outside LCX install range/u)
  assert.throws(() => fixture(t, '0.1.5').run(), /outside LCX install range/u)
  assert.throws(() => fixture(t, '0.1.6-alpha.1').run(), /outside LCX install range/u)
  assert.throws(() => fixture(t, '0.1.7-alpha.1').run(), /outside LCX install range/u)
})

test('a host Pi change still forces compatibility reassessment', t => {
  assert.throws(() => fixture(t, verifiedDsh, '0.85.2').run(), /Host Pi changed/u)
})
