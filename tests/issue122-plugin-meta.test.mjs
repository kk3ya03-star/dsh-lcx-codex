import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readPluginMeta } from '@deepseek-ai/dsh-app-boot'
import { isPrivateCheckout, isPrivateReadmeContent, runLocalPack } from '../scripts/pack-local.mjs'

// Issue 122 item 2: DSH 0.2.1's plugin manager shows a plugin's card from package metadata it reads without
// activating the plugin: `./locale/<language>.json` (`meta.title` / `meta.description`) and the package icon.
// These tests call DSH's real reader (`readPluginMeta` from `@deepseek-ai/dsh-app-boot`, the function the
// plugin manager itself calls) on the file set the curated `pack:local` boundary would publish, laid out as an installed package.

const root = new URL('../', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const ICON_LIMIT = 256 * 1024 // DSH's own bound on a plugin icon

/** The files `scripts/pack-local.mjs` would publish, via npm itself on the curated public export (no tarball, no scripts). */
function packedFiles() {
  const out = execFileSync(process.execPath, ['scripts/pack-local.mjs', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return JSON.parse(out)[0].files.map((file) => file.path)
}

/** Install exactly the published file set as `node_modules/dsh-lcx-codex` under a throwaway profile. */
function installPacked(t) {
  const profile = mkdtempSync(join(tmpdir(), 'lcx-122-meta-'))
  t.after(() => rmSync(profile, { recursive: true, force: true }))
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'profile', private: true }))
  const installed = join(profile, 'node_modules', pkg.name)
  for (const path of packedFiles()) {
    mkdirSync(dirname(join(installed, path)), { recursive: true })
    cpSync(new URL(path, root), join(installed, path))
  }
  return pathToFileURL(join(profile, 'package.json')).href
}

test('DSH reads LCX title, description and icon from the published package without loading it', (t) => {
  const meta = readPluginMeta(pkg.name, installPacked(t))
  assert.ok(meta, 'the plugin manager finds display metadata')
  assert.equal(meta.error, undefined, 'no metadata diagnostic')
  // `title` / `description` become per-language maps (keys are lowercase language ids, English required).
  assert.deepEqual(Object.keys(meta.title).sort(), ['en', 'zh'])
  assert.deepEqual(Object.keys(meta.description).sort(), ['en', 'zh'])
  for (const text of [...Object.values(meta.title), ...Object.values(meta.description)])
    assert.ok(typeof text === 'string' && text.trim() !== '')
  assert.match(meta.title.en, /LCX/u)
  assert.match(meta.description.en, /GPT Responses/u)
  assert.match(meta.description.zh, /[一-鿿]/u, 'the zh description is Chinese')
  assert.notEqual(meta.description.zh, meta.description.en)
  // The icon reaches the card as a base64 data URL of the shipped SVG, never as markup.
  assert.match(meta.icon, /^data:image\/svg\+xml;base64,/u)
  const svg = Buffer.from(meta.icon.split(',')[1], 'base64').toString('utf8')
  assert.equal(svg, readFileSync(new URL('icon.svg', root), 'utf8'))
})

test('the package ships its card metadata and still nothing private', (t) => {
  const files = packedFiles()
  for (const path of ['icon.svg', 'locale/en.json', 'locale/zh.json', 'package.json', 'cordis.patch.yml'])
    assert.ok(files.includes(path), `${path} is published`)
  assert.deepEqual(files.filter((path) => path.startsWith('locale/')).sort(), ['locale/en.json', 'locale/zh.json'])
  const expectPublicCheckout = process.env.LCX_EXPECT_PUBLIC_CHECKOUT === '1'
  const privateCheckout = isPrivateCheckout(fileURLToPath(root))
  if (expectPublicCheckout) {
    assert.equal(privateCheckout, false, 'LCX_EXPECT_PUBLIC_CHECKOUT=1 forbids private control-plane markers')
  }
  const forbiddenExact = privateCheckout
    ? ['README.md', 'AGENTS.md', 'AI-MANIFEST.yml', 'STATUS.md', 'PUBLIC-RELEASE-MANIFEST.yml']
    : ['AGENTS.md', 'AI-MANIFEST.yml', 'STATUS.md', 'PUBLIC-RELEASE-MANIFEST.yml']
  assert.deepEqual(files.filter((path) => forbiddenExact.includes(path)), [])
  if (!privateCheckout) {
    assert.ok(files.includes('README.md'), 'public checkout must retain README.md')
    assert.equal(isPrivateReadmeContent(readFileSync(new URL('README.md', root), 'utf8')), false)
  }
  const forbidden = ['docs/', 'qa/', 'releases/', 'tools/', 'compatibility/', '.github/']
  assert.deepEqual(files.filter((path) => forbidden.some((prefix) => path.startsWith(prefix))), [])
  // Mirror of the manifest declarations DSH resolves: the locale glob export and the manifest icon.
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.equal(pkg.icon, './icon.svg')
  assert.ok(pkg.files.includes('icon.svg') && pkg.files.includes('locale/*.json'))

  // Round 9 P1-3: explicit public-checkout coverage keeps public README.md while excluding private files
  const tmp = mkdtempSync(join(tmpdir(), 'lcx-122-public-'))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))
  const publicRepo = join(tmp, 'public-checkout')
  mkdirSync(join(publicRepo, 'lib', 'types', 'client'), { recursive: true })
  mkdirSync(join(publicRepo, 'locale'), { recursive: true })
  for (const rel of [
    'package.json',
    'lib/index.js',
    'lib/client.js',
    'lib/pi-responses-runtime.js',
    'lib/types/index.d.ts',
    'lib/types/client/index.d.ts',
    'lib/types/client/search-media.d.ts',
    'cordis.patch.yml',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'locale/en.json',
    'locale/zh.json',
    'icon.svg',
    'PUBLIC-RELEASE-MANIFEST.yml',
  ]) {
    const srcFile = new URL(rel, root)
    if (rel === 'package.json') {
      const simplePkg = {
        name: pkg.name,
        version: pkg.version,
        type: 'module',
        main: 'lib/index.js',
        files: [
          'icon.svg',
          'locale/*.json',
          'lib/index.js',
          'lib/client.js',
          'lib/pi-responses-runtime.js',
          'lib/types/index.d.ts',
          'lib/types/client/index.d.ts',
          'lib/types/client/search-media.d.ts',
          'cordis.patch.yml',
          'THIRD_PARTY_NOTICES.md',
        ],
      }
      writeFileSync(join(publicRepo, rel), JSON.stringify(simplePkg, null, 2), 'utf8')
    } else if (rel === 'lib/index.js') {
      writeFileSync(join(publicRepo, rel), 'export default function() {}\n', 'utf8')
    } else {
      cpSync(srcFile, join(publicRepo, rel))
    }
  }
  writeFileSync(join(publicRepo, 'README.md'), '# dsh-lcx-codex\n\nPublic README for plugin users.\n', 'utf8')
  const publicPack = JSON.parse(runLocalPack(['--public', '--dry-run', '--json'], { rootDir: publicRepo, cwd: tmp }))[0]
  const publicFiles = publicPack.files.map((item) => item.path)
  assert.equal(isPrivateCheckout(publicRepo), false)
  assert.ok(publicFiles.includes('README.md'), 'public checkout pack must include README.md')
  assert.equal(publicFiles.includes('PUBLIC-RELEASE-MANIFEST.yml'), false)
  assert.throws(
    () => runLocalPack(['--private', '--dry-run', '--json'], { rootDir: publicRepo, cwd: tmp }),
    /Refusing --private packaging/u,
  )

  // Dedicated temporary fixture with private control-plane markers (independent of checkout type)
  const privateFixture = join(tmp, 'private-checkout')
  cpSync(publicRepo, privateFixture, { recursive: true })
  writeFileSync(join(privateFixture, 'AGENTS.md'), '# private\n', 'utf8')
  writeFileSync(join(privateFixture, 'AI-MANIFEST.yml'), 'project: private\n', 'utf8')
  writeFileSync(join(privateFixture, 'README.md'), '# 项目总控\n\nAGENTS.md\n', 'utf8')
  assert.equal(isPrivateCheckout(privateFixture), true)
  assert.throws(
    () => runLocalPack(['--public', '--dry-run', '--json'], { rootDir: privateFixture, cwd: tmp }),
    /Refusing --public packaging/u,
  )
  assert.throws(
    () => {
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import assert from 'node:assert/strict'; import { isPrivateCheckout } from './scripts/pack-local.mjs'; assert.equal(process.env.LCX_EXPECT_PUBLIC_CHECKOUT === '1' && isPrivateCheckout(process.env.TARGET_DIR), false, 'LCX_EXPECT_PUBLIC_CHECKOUT=1 forbids private markers')",
        ],
        { cwd: root, env: { ...process.env, LCX_EXPECT_PUBLIC_CHECKOUT: '1', TARGET_DIR: privateFixture }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
    },
    /LCX_EXPECT_PUBLIC_CHECKOUT=1/u,
  )

  // Checkout-aware verification on `root` itself
  if (privateCheckout) {
    assert.throws(
      () => runLocalPack(['--public', '--dry-run', '--json'], { rootDir: fileURLToPath(root), cwd: tmp }),
      /Refusing --public packaging/u,
    )
    assert.doesNotThrow(
      () => runLocalPack(['--private', '--dry-run', '--json'], { rootDir: fileURLToPath(root), cwd: tmp }),
    )
    assert.throws(
      () => {
        execFileSync(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            "import assert from 'node:assert/strict'; import { fileURLToPath } from 'node:url'; import { isPrivateCheckout } from './scripts/pack-local.mjs'; assert.equal(process.env.LCX_EXPECT_PUBLIC_CHECKOUT === '1' && isPrivateCheckout(fileURLToPath(new URL('./', import.meta.url))), false, 'LCX_EXPECT_PUBLIC_CHECKOUT=1 forbids private markers')",
          ],
          { cwd: root, env: { ...process.env, LCX_EXPECT_PUBLIC_CHECKOUT: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        )
      },
      /LCX_EXPECT_PUBLIC_CHECKOUT=1/u,
    )
  } else {
    const rootPublicPack = JSON.parse(runLocalPack(['--public', '--dry-run', '--json'], { rootDir: fileURLToPath(root), cwd: tmp }))[0]
    assert.ok(rootPublicPack.files.some((f) => f.path === 'README.md'))
    assert.doesNotThrow(() => {
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import assert from 'node:assert/strict'; import { fileURLToPath } from 'node:url'; import { isPrivateCheckout } from './scripts/pack-local.mjs'; assert.equal(process.env.LCX_EXPECT_PUBLIC_CHECKOUT === '1' && isPrivateCheckout(fileURLToPath(new URL('./', import.meta.url))), false, 'LCX_EXPECT_PUBLIC_CHECKOUT=1 forbids private markers')",
        ],
        { cwd: root, env: { ...process.env, LCX_EXPECT_PUBLIC_CHECKOUT: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
    })
  }
})

test('locale files follow DSH conventions: language-id filenames, a meta object with non-empty strings', () => {
  const dir = new URL('locale/', root)
  // DSH's built-in Client languages are `zh` and `en`; the manager keys translations by these lowercase ids.
  assert.deepEqual(readdirSync(dir).sort(), ['en.json', 'zh.json'])
  for (const name of readdirSync(dir)) {
    const parsed = JSON.parse(readFileSync(new URL(name, dir), 'utf8'))
    assert.deepEqual(Object.keys(parsed), ['meta'], name)
    assert.deepEqual(Object.keys(parsed.meta).sort(), ['description', 'title'], name)
    for (const value of Object.values(parsed.meta)) assert.ok(typeof value === 'string' && value.trim() !== '', name)
  }
})

test('the icon is a small self-contained SVG in DSH accepted format', () => {
  const file = new URL('icon.svg', root)
  assert.ok(statSync(file).size <= ICON_LIMIT)
  const svg = readFileSync(file, 'utf8')
  assert.match(svg, /^<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/u)
  assert.doesNotMatch(svg, /<script|<image|<foreignObject|\bon\w+=|href=/iu, 'rendered as an <img>: no script or external reference')
})
