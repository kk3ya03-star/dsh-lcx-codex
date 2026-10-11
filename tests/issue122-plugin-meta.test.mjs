import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readPluginMeta } from '@deepseek-ai/dsh-app-boot'

// Issue 122 item 2: DSH 0.2.1's plugin manager shows a plugin's card from package metadata it reads without
// activating the plugin: `./locale/<language>.json` (`meta.title` / `meta.description`) and the package icon.
// These tests call DSH's real reader (`readPluginMeta` from `@deepseek-ai/dsh-app-boot`, the function the
// plugin manager itself calls) on the file set `npm pack` would publish, laid out as an installed package.

const root = new URL('../', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const ICON_LIMIT = 256 * 1024 // DSH's own bound on a plugin icon

/** The files `npm pack` would publish, from npm itself (no tarball, no scripts). */
function packedFiles() {
  const out = execSync('npm pack --dry-run --json --ignore-scripts', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
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

test('the package ships its card metadata and still nothing private', () => {
  const files = packedFiles()
  for (const path of ['icon.svg', 'locale/en.json', 'locale/zh.json', 'package.json', 'cordis.patch.yml'])
    assert.ok(files.includes(path), `${path} is published`)
  assert.deepEqual(files.filter((path) => path.startsWith('locale/')).sort(), ['locale/en.json', 'locale/zh.json'])
  const forbidden = ['docs/', 'qa/', 'releases/', 'tools/', 'compatibility/', '.github/']
  assert.deepEqual(files.filter((path) => forbidden.some((prefix) => path.startsWith(prefix))), [])
  // Mirror of the manifest declarations DSH resolves: the locale glob export and the manifest icon.
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.equal(pkg.icon, './icon.svg')
  assert.ok(pkg.files.includes('icon.svg') && pkg.files.includes('locale/*.json'))
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
