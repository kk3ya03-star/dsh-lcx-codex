import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { getBuiltinModels as getAllModels, getBuiltinProviders as getAllProviders } from '@earendil-works/pi-ai/providers/all'
import { getCatalogModels } from '../src/pi-responses-runtime.ts'

const root = new URL('../', import.meta.url)
const readJson = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'))

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('bounded Pi catalog preserves every public Responses descriptor previously reachable', () => {
  const bundled = ['cloudflare-ai-gateway', 'github-copilot', 'openai', 'opencode', 'opencode-go', 'xai']
  const expected = Object.fromEntries(bundled.map(provider => [provider, plain(getAllModels(provider).filter(model => model.api === 'openai-responses'))]))
  assert.ok(getAllProviders().includes('meta'), 'Pi 1.5.0 catalog shape changed; review bundle scope')
  for (const provider of bundled)
    assert.deepEqual(plain(getCatalogModels(provider).filter(model => model.api === 'openai-responses')), expected[provider], provider)
  assert.deepEqual(getCatalogModels('unrelated-provider'), [])
})

test('candidate package separates DSH install range from exact verification baseline', () => {
  const pkg = readJson('package.json')
  const lock = readJson('package-lock.json')
  assert.equal(pkg.version, '0.7.0-pre.1')
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.devDependencies['@deepseek-ai/dsh'], '0.2.2-alpha.3')
  assert.deepEqual(pkg.lcxCompatibility, { dshInstallRange: '>=0.2.2-alpha.3', verifiedDsh: '0.2.2-alpha.3', verifiedHostPi: '1.5.0', verifiedPluginPi: '1.5.0' })
  assert.equal(pkg.devDependencies['@earendil-works/pi-ai'], '1.5.0')
  for (const [name, version] of Object.entries(pkg.peerDependencies))
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, pkg.lcxCompatibility.dshInstallRange, name)
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-client-ui-settings'], pkg.lcxCompatibility.dshInstallRange)
  assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh-client-ui-settings'].optional, true)
  const officialPi = readJson('node_modules/@deepseek-ai/dsh-llm-pi-ai/package.json')
  // Product Owner decision 2026-10-10: install ranges have a floor and no ceiling. The floors are the minimums of the
  // oldest supported host (DSH 0.2.2-alpha.3, the pre line); this suite also runs against DSH 0.2.1-rc.2 (latest).
  const floors = { '@deepseek-ai/cordis': '>=4.0.6-alpha.2', '@deepseek-ai/cordis-plugin-loader': '>=1.0.7-alpha.2', '@deepseek-ai/schemastery': '>=3.18.6-alpha.2' }
  for (const [name, range] of Object.entries(floors)) assert.equal(pkg.peerDependencies[name], range, name)
  for (const [name, range] of Object.entries(pkg.peerDependencies))
    if (name.startsWith('@deepseek-ai/')) assert.doesNotMatch(range, /[<~^]|\|\|/u, `${name} peer must be a plain lower bound`)
  // The linked host asks for the floor or its release; the build/test runtime installs exactly one of the two.
  const loaderFloor = floors['@deepseek-ai/cordis-plugin-loader'].slice(2)
  const accepted = [loaderFloor, loaderFloor.replace(/-.*$/u, '')]
  assert.ok(accepted.map(version => `~${version}`).includes(officialPi.peerDependencies['@deepseek-ai/cordis-plugin-loader']), officialPi.version)
  assert.ok(accepted.includes(readJson('node_modules/@deepseek-ai/cordis-plugin-loader/package.json').version), 'the build/test runtime satisfies the floor')
  assert.equal(pkg.devDependencies['@deepseek-ai/dsh'], pkg.lcxCompatibility.verifiedDsh, 'the exact baseline stays pinned')
  assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/cordis-plugin-loader'].optional, true)
  assert.equal(lock.packages[''].peerDependencies['@deepseek-ai/cordis-plugin-loader'], pkg.peerDependencies['@deepseek-ai/cordis-plugin-loader'])
  assert.equal(lock.packages[''].peerDependencies['@deepseek-ai/dsh-client-ui-settings'], pkg.lcxCompatibility.dshInstallRange)
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
  // The shipped notice names the Pi version that is actually bundled.
  assert.ok(notices.includes(`## @earendil-works/pi-ai ${readJson('package.json').devDependencies['@earendil-works/pi-ai']}\n`))
})

// npm's default prerelease tuple gating is deliberate here (no includePrerelease).
test('pre peer floors satisfy the exact installed Cordis family under default npm semver', () => {
  const runtime = createRequire(new URL('../scripts/runtime-dsh022/package.json', import.meta.url))
  const semver = runtime('semver')
  const pkg = readJson('package.json')
  for (const [name, expected] of Object.entries({
    '@deepseek-ai/cordis': '4.0.6-alpha.2',
    '@deepseek-ai/cordis-plugin-loader': '1.0.7-alpha.2',
    '@deepseek-ai/schemastery': '3.18.6-alpha.2',
  })) {
    const { version } = runtime(name + '/package.json')
    assert.equal(version, expected, name)
    assert.equal(semver.satisfies(version, pkg.peerDependencies[name]), true, name)
  }
})
