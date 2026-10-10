import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'

const installRange = '>=0.2.1-alpha.2'
const verifiedDsh = '0.2.1-alpha.2'
const hostPi = '1.1.0'
const pluginPi = '0.87.1'

function fixture(t, runtimeVersion = verifiedDsh, runtimePi = hostPi, rootPi = pluginPi) {
  const output = fileURLToPath(new URL('../output/', import.meta.url))
  mkdirSync(output, { recursive: true })
  const root = mkdtempSync(join(output, 'lcx-runtime-link-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const runtime = join(root, 'scripts/runtime-dsh021')
  mkdirSync(runtime, { recursive: true })
  copyFileSync(new URL('./link-dsh-runtime.mjs', import.meta.url), join(root, 'scripts/link-dsh-runtime.mjs'))
  const write = (path, json) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(json)) }
  write(join(root, 'package.json'), {
    type: 'module',
    devDependencies: { '@deepseek-ai/dsh': verifiedDsh, '@earendil-works/pi-ai': rootPi, 'local-build-tool': '1.0.0' },
    peerDependencies: { '@deepseek-ai/dsh-session': installRange, '@deepseek-ai/cordis-plugin-loader': '>=1.0.6-alpha.1' },
    lcxCompatibility: { dshInstallRange: installRange, verifiedDsh, verifiedHostPi: hostPi, verifiedPluginPi: rootPi },
  })
  write(join(runtime, 'package.json'), { private: true })
  for (const [name, version] of Object.entries({
    '@deepseek-ai/dsh': runtimeVersion,
    '@deepseek-ai/dsh-session': runtimeVersion,
    '@deepseek-ai/dsh-llm-pi-ai': runtimeVersion,
    '@deepseek-ai/cordis-plugin-loader': '1.0.6-alpha.1',
    '@earendil-works/pi-ai': runtimePi,
    '@deepseek-ai/cosmokit': '1.0.0',
  })) write(join(runtime, 'node_modules', name, 'package.json'), { name, version })
  write(join(root, 'node_modules/@earendil-works/pi-ai/package.json'), { name: '@earendil-works/pi-ai', version: rootPi })
  const local = join(root, 'node_modules/local-build-tool')
  write(join(local, 'package.json'), { name: 'local-build-tool', version: '1.0.0' })
  return { root, runtime, local, run: () => execFileSync(process.execPath, ['scripts/link-dsh-runtime.mjs'], { cwd: root }) }
}

test('runtime linking preserves local build dependencies and is repeatable on verified 0.2.1-alpha.2', t => {
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

test('every later DSH is inside the floor-only install range, but only the exact baseline is verified', t => {
  // The range has a floor and no ceiling (Product Owner decision 2026-10-10); VERIFIED stays exact-baseline only.
  // 0.2.2-alpha.1 and 0.3.0 follow DSH's semver.satisfies(..., { includePrerelease: true }) precedence rules.
  for (const version of ['0.2.1-alpha.2', '0.2.1-alpha.3', '0.2.1-rc.1', '0.2.1', '0.2.2-alpha.1', '0.2.2', '0.3.0', '1.0.0']) {
    const f = fixture(t, version)
    assert.doesNotThrow(() => f.run(), version)
  }
})

test('versions below the floor fail closed', t => {
  for (const version of ['0.1.6-alpha.2', '0.1.7-rc.2', '0.2.0-rc.2', '0.2.0', '0.2.1-alpha.1'])
    assert.throws(() => fixture(t, version).run(), /outside LCX install range/u, version)
})

test('a host Pi change still forces compatibility reassessment', t => {
  assert.throws(() => fixture(t, verifiedDsh, '1.1.1').run(), /Host Pi changed/u)
})
