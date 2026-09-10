import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getBuiltinModels as getAllModels, getBuiltinProviders as getAllProviders } from '@earendil-works/pi-ai/providers/all'
import { getBuiltinModels, getBuiltinProviders } from '../src/pi-responses-runtime.ts'

const root = new URL('../', import.meta.url)
const readJson = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'))

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('bounded Pi catalog preserves every public Responses descriptor previously reachable', () => {
  const expected = Object.fromEntries(getAllProviders().flatMap(provider => {
    const models = getAllModels(provider).filter(model => model.api === 'openai-responses')
    return models.length ? [[provider, plain(models)]] : []
  }))
  assert.deepEqual([...getBuiltinProviders()].sort(), Object.keys(expected).sort())
  for (const provider of getBuiltinProviders())
    assert.deepEqual(plain(getBuiltinModels(provider)), expected[provider], provider)
  assert.deepEqual(getBuiltinModels('unrelated-provider'), [])
})

test('candidate package separates DSH install range from exact verification baseline', () => {
  const pkg = readJson('package.json')
  const lock = readJson('package-lock.json')
  assert.equal(pkg.version, '0.4.3-pre.13')
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.devDependencies['@deepseek-ai/dsh'], '0.1.5-rc.1')
  assert.deepEqual(pkg.lcxCompatibility, { dshInstallRange: '>=0.1.5-rc.1 <0.1.6', verifiedDsh: '0.1.5-rc.1', verifiedHostPi: '0.85.1' })
  assert.equal(pkg.devDependencies['@earendil-works/pi-ai'], '0.85.1')
  for (const [name, version] of Object.entries(pkg.peerDependencies))
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, pkg.lcxCompatibility.dshInstallRange, name)
  assert.equal(lock.packages[''].dependencies, undefined)
  assert.deepEqual(pkg.files.filter(path => path.includes('/types/') || path.includes('types/')), [
    'lib/types/index.d.ts', 'lib/types/client/index.d.ts', 'lib/types/client/search-media.d.ts',
  ])
  assert.ok(pkg.files.includes('THIRD_PARTY_NOTICES.md'))
  assert.match(pkg.scripts['build:host'], /build-pi-runtime\.mjs/u)
})

test('bundle audit is output-contribution based and preserves both exact MIT notices', () => {
  const build = readFileSync(new URL('scripts/build-pi-runtime.mjs', root), 'utf8')
  const notices = readFileSync(new URL('THIRD_PARTY_NOTICES.md', root), 'utf8')
  assert.match(build, /bytesInOutput > 0/u)
  assert.match(build, /Unexpected third-party package entered Pi bundle/u)
  assert.match(build, /Responses provider catalog scope drifted/u)
  assert.match(notices, /Copyright \(c\) 2025 Mario Zechner/u)
  assert.match(notices, /Copyright \(c\) 2023 Promplate Dev Team/u)
  assert.equal((notices.match(/Permission is hereby granted/g) ?? []).length, 2)
})
