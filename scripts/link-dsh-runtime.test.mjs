import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'

const installRange = '>=0.2.2-alpha.3'
const verifiedDsh = '0.2.2-alpha.3'
const hostPi = '1.5.0'
const pluginPi = '0.87.1'

function fixture(t, runtimeVersion = verifiedDsh, runtimePi = hostPi, rootPi = pluginPi) {
  const output = fileURLToPath(new URL('../output/', import.meta.url))
  mkdirSync(output, { recursive: true })
  const root = mkdtempSync(join(output, 'lcx-runtime-link-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const runtime = join(root, 'scripts/runtime-dsh022')
  mkdirSync(runtime, { recursive: true })
  copyFileSync(new URL('./link-dsh-runtime.mjs', import.meta.url), join(root, 'scripts/link-dsh-runtime.mjs'))
  const write = (path, json) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(json)) }
  write(join(root, 'package.json'), {
    type: 'module',
    devDependencies: { '@deepseek-ai/dsh': verifiedDsh, '@earendil-works/pi-ai': rootPi, 'local-build-tool': '1.0.0' },
    peerDependencies: { '@deepseek-ai/dsh-session': installRange, '@deepseek-ai/cordis-plugin-loader': '>=1.0.6-alpha.2' },
    lcxCompatibility: { dshInstallRange: installRange, verifiedDsh, verifiedHostPi: hostPi, verifiedPluginPi: rootPi },
  })
  write(join(runtime, 'package.json'), { private: true })
  for (const [name, version] of Object.entries({
    '@deepseek-ai/dsh': runtimeVersion,
    '@deepseek-ai/dsh-session': runtimeVersion,
    '@deepseek-ai/dsh-llm-pi-ai': runtimeVersion,
    '@deepseek-ai/dsh-session-persistence-jsonl': runtimeVersion,
    '@deepseek-ai/cordis-plugin-loader': '1.0.6',
    '@earendil-works/pi-ai': runtimePi,
    '@deepseek-ai/cosmokit': '1.0.0',
  })) write(join(runtime, 'node_modules', name, 'package.json'), { name, version })
  write(join(root, 'node_modules/@earendil-works/pi-ai/package.json'), { name: '@earendil-works/pi-ai', version: rootPi })
  const local = join(root, 'node_modules/local-build-tool')
  write(join(local, 'package.json'), { name: 'local-build-tool', version: '1.0.0' })
  return { root, runtime, local, run: () => execFileSync(process.execPath, ['scripts/link-dsh-runtime.mjs'], { cwd: root }) }
}

test('runtime linking preserves local build dependencies and is repeatable on verified 0.2.1-rc.2', t => {
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
  for (const version of ['0.2.2-alpha.3', '0.2.2-alpha.4', '0.2.2', '0.3.0', '1.0.0']) {
    const f = fixture(t, version)
    assert.doesNotThrow(() => f.run(), version)
  }
})

test('versions below the floor fail closed', t => {
  for (const version of ['0.1.6-alpha.2', '0.1.7-rc.2', '0.2.0-rc.2', '0.2.0', '0.2.1-alpha.2', '0.2.1-alpha.4'])
    assert.throws(() => fixture(t, version).run(), /outside LCX install range/u, version)
})

test('a host Pi change still forces compatibility reassessment', t => {
  assert.throws(() => fixture(t, verifiedDsh, '1.3.1').run(), /Host Pi changed/u)
})

test('every DSH package the runtime provides follows it, root-only packages stay', t => {
  const f = fixture(t, verifiedDsh)
  const write = (path, json) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(json)) }
  // The root install of the pinned DSH carries its own copy of a host package the tests import, and one the
  // runtime does not provide; the runtime also provides a host package the root install never hoisted.
  write(join(f.root, 'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/package.json'), { name: '@deepseek-ai/dsh-session-persistence-jsonl', version: verifiedDsh })
  write(join(f.root, 'node_modules/@deepseek-ai/dsh-root-only/package.json'), { name: '@deepseek-ai/dsh-root-only', version: verifiedDsh })
  write(join(f.runtime, 'node_modules/@deepseek-ai/dsh-compaction-basic/package.json'), { name: '@deepseek-ai/dsh-compaction-basic', version: verifiedDsh })
  f.run()
  for (const name of ['dsh-session-persistence-jsonl', 'dsh-compaction-basic'])
    assert.equal(realpathSync(join(f.root, 'node_modules/@deepseek-ai', name)), realpathSync(join(f.runtime, 'node_modules/@deepseek-ai', name)), name)
  assert.equal(lstatSync(join(f.root, 'node_modules/@deepseek-ai/dsh-root-only')).isSymbolicLink(), false)
})

test('a host package of another DSH version in the runtime fails closed', t => {
  const f = fixture(t)
  const write = (path, json) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(json)) }
  write(join(f.runtime, 'node_modules/@deepseek-ai/dsh-agent-loop/package.json'), { name: '@deepseek-ai/dsh-agent-loop', version: '0.2.1-alpha.5' })
  assert.throws(() => f.run(), /must match the selected DSH runtime/u)
})

test('a dangling link from an earlier runtime is replaced', t => {
  const f = fixture(t)
  const destination = join(f.root, 'node_modules/@deepseek-ai/dsh-session')
  mkdirSync(join(destination, '..'), { recursive: true })
  symlinkSync(join(f.root, 'scripts/removed-runtime/dsh-session'), destination, process.platform === 'win32' ? 'junction' : 'dir')
  f.run()
  assert.equal(realpathSync(destination), realpathSync(join(f.runtime, 'node_modules/@deepseek-ai/dsh-session')))
})

test('switching runtimes drops links to packages the new runtime does not provide', t => {
  const f = fixture(t)
  const stale = join(f.root, 'node_modules/@deepseek-ai/dsh-only-in-other-runtime')
  const other = join(f.root, 'scripts/other-runtime/node_modules/@deepseek-ai/dsh-only-in-other-runtime')
  mkdirSync(other, { recursive: true })
  writeFileSync(join(other, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-only-in-other-runtime', version: '0.2.1-rc.2' }))
  mkdirSync(join(stale, '..'), { recursive: true })
  symlinkSync(other, stale, process.platform === 'win32' ? 'junction' : 'dir')
  f.run()
  assert.equal(lstatSync(stale, { throwIfNoEntry: false }), undefined)
})
