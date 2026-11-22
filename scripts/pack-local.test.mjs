import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import {
  REQUIRED_PACKAGE_FILES,
  assertArchivedFilesMatchStaged,
  assertExactFileSet,
  assertRuntimeImportClosure,
  assertSafeArchiveDirectories,
  assertSafeArchiveEntries,
  collectPublicExportPaths,
  deriveExpectedPackageFiles,
  extractRelativeJsImports,
  extractRelativeJsImportsFallback,
  inspectTarGzArchive,
  isPrivateCheckout,
  listTarGzEntries,
  loadPublicExportPolicy,
  runLocalPack,
  stageCuratedExport,
  verifyPublicReadmeBytes,
} from './pack-local.mjs'

const rootDir = new URL('../', import.meta.url)
const repoPath = fileURLToPath(rootDir)
const manifestText = readFileSync(new URL('../PUBLIC-RELEASE-MANIFEST.yml', import.meta.url), 'utf8')
const minimalPkgJson = JSON.stringify({
  name: 'dsh-lcx-codex',
  version: '0.7.0',
  type: 'module',
  main: 'lib/index.js',
  files: [
    'icon.svg',
    'locale/*.json',
    'lib/*.js',
    'lib/types/index.d.ts',
    'lib/types/client/index.d.ts',
    'lib/types/client/search-media.d.ts',
    'cordis.patch.yml',
    'THIRD_PARTY_NOTICES.md',
  ],
}, null, 2)

function writeMinimalExportFixture(dir, { privateMode, readmeContent }) {
  mkdirSync(join(dir, 'lib', 'types', 'client'), { recursive: true })
  mkdirSync(join(dir, 'locale'), { recursive: true })
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), minimalPkgJson, 'utf8')
  writeFileSync(join(dir, 'lib', 'index.js'), 'export default function() {}\n', 'utf8')
  writeFileSync(join(dir, 'lib', 'client.js'), 'export default function() {}\n', 'utf8')
  writeFileSync(join(dir, 'lib', 'pi-responses-runtime.js'), 'export {}\n', 'utf8')
  writeFileSync(join(dir, 'lib', 'types', 'index.d.ts'), 'export {}\n', 'utf8')
  writeFileSync(join(dir, 'lib', 'types', 'client', 'index.d.ts'), 'export {}\n', 'utf8')
  writeFileSync(join(dir, 'lib', 'types', 'client', 'search-media.d.ts'), 'export {}\n', 'utf8')
  writeFileSync(join(dir, 'cordis.patch.yml'), 'name: dsh-lcx-codex\n', 'utf8')
  writeFileSync(join(dir, 'LICENSE'), 'MIT\n', 'utf8')
  writeFileSync(join(dir, 'THIRD_PARTY_NOTICES.md'), 'Notices\n', 'utf8')
  writeFileSync(join(dir, 'locale', 'en.json'), '{"meta":{"title":"LCX","description":"desc"}}\n', 'utf8')
  writeFileSync(join(dir, 'locale', 'zh.json'), '{"meta":{"title":"LCX","description":"描述"}}\n', 'utf8')
  writeFileSync(join(dir, 'icon.svg'), '<svg></svg>\n', 'utf8')
  writeFileSync(join(dir, '.github', 'workflows', 'verify.yml'), 'name: verify\n', 'utf8')
  writeFileSync(join(dir, '.github', 'workflows', 'publish.yml'), 'name: publish\n', 'utf8')
  writeFileSync(join(dir, 'PUBLIC-RELEASE-MANIFEST.yml'), manifestText, 'utf8')
  if (readmeContent !== undefined) {
    writeFileSync(join(dir, 'README.md'), readmeContent, 'utf8')
  }
  if (privateMode) {
    writeFileSync(join(dir, 'AGENTS.md'), '# private\n', 'utf8')
    writeFileSync(join(dir, 'AI-MANIFEST.yml'), 'project: private\n', 'utf8')
    writeFileSync(join(dir, '.github', 'workflows', 'governance.yml'), 'name: governance\n', 'utf8')
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'internal.md'), 'secret\n', 'utf8')
  }
}

test('loadPublicExportPolicy parses PUBLIC-RELEASE-MANIFEST.yml include and exclude lists', () => {
  const policy = loadPublicExportPolicy(new URL('../PUBLIC-RELEASE-MANIFEST.yml', import.meta.url))
  assert.ok(policy.from_private_release_source.includes('lib/**'))
  assert.ok(policy.from_private_release_source.includes('package.json'))
  assert.ok(policy.public_test_support_from_private_release_source.includes('qa/issue-62/adapter-off.mjs'))
  assert.ok(policy.exclude_from_private_export.includes('README.md'))
  assert.ok(policy.exclude_from_private_export.includes('docs/**'))
  assert.ok(policy.exclude_from_private_export.includes('qa/**'))
})

test('P1-B & P2-1: isPrivateCheckout relies strictly on control-plane files, never README content', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'lcx-pack-modes-'))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))

  const privDir = join(tmp, 'private-checkout')
  writeMinimalExportFixture(privDir, {
    privateMode: true,
    readmeContent: '# dsh-lcx-codex 项目总控\nSee AI-MANIFEST.yml and AGENTS.md\n',
  })
  assert.equal(isPrivateCheckout(privDir), true)
  const privStage = join(tmp, 'priv-stage')
  mkdirSync(privStage, { recursive: true })
  const privStaged = stageCuratedExport({ rootDir: privDir, stageDir: privStage })
  assert.equal(privStaged.privateCheckout, true)
  assert.equal(privStaged.allowPublicReadme, false)
  assert.equal(existsSync(join(privStage, 'README.md')), false)
  assert.equal(existsSync(join(privStage, 'AGENTS.md')), false)
  assert.equal(existsSync(join(privStage, 'docs', 'internal.md')), false)
  assert.equal(existsSync(join(privStage, '.github', 'workflows', 'verify.yml')), false)
  const privRaw = runLocalPack(['--dry-run', '--json'], { rootDir: privDir, cwd: tmp })
  const privPacked = JSON.parse(privRaw)[0].files.map((item) => item.path)
  assert.equal(privPacked.includes('README.md'), false)

  // Public checkout with README mentioning work/ or network/ is STILL classified public and packs README.md!
  const pubDir = join(tmp, 'public-checkout')
  writeMinimalExportFixture(pubDir, {
    privateMode: false,
    readmeContent: '# dsh-lcx-codex\n\nPublic installation guide for DSH 0.2.2 over network/ proxy and work/ flow.\n',
  })
  assert.equal(isPrivateCheckout(pubDir), false)
  const pubStage = join(tmp, 'pub-stage')
  mkdirSync(pubStage, { recursive: true })
  const pubStaged = stageCuratedExport({ rootDir: pubDir, stageDir: pubStage })
  assert.equal(pubStaged.privateCheckout, false)
  assert.equal(pubStaged.allowPublicReadme, true)
  assert.equal(existsSync(join(pubStage, 'README.md')), true)
  assert.equal(existsSync(join(pubStage, '.github', 'workflows', 'verify.yml')), true)
  assert.equal(existsSync(join(pubStage, '.github', 'workflows', 'publish.yml')), true)
  const pubRaw = runLocalPack(['--dry-run', '--json'], { rootDir: pubDir, cwd: tmp })
  const pubPacked = JSON.parse(pubRaw)[0].files.map((item) => item.path)
  assert.equal(pubPacked.includes('README.md'), true, 'public checkout pack must retain README.md identically to publish.yml')
  assert.equal(pubPacked.some((p) => p.startsWith('.github/') || p === 'PUBLIC-RELEASE-MANIFEST.yml'), false)

  // Public checkout whose README accidentally contains private control-plane markers fails closed instead of misclassifying
  const pollutedPub = join(tmp, 'polluted-public')
  writeMinimalExportFixture(pollutedPub, {
    privateMode: false,
    readmeContent: '# dsh-lcx-codex 项目总控\nSee AI-MANIFEST.yml\n',
  })
  assert.equal(isPrivateCheckout(pollutedPub), false)
  assert.throws(() => runLocalPack(['--dry-run', '--json'], { rootDir: pollutedPub, cwd: tmp }), /private control-plane/u)

  // Public checkout missing README.md fails closed
  const badPubDir = join(tmp, 'bad-public')
  writeMinimalExportFixture(badPubDir, { privateMode: false, readmeContent: undefined })
  assert.throws(() => runLocalPack(['--dry-run', '--json'], { rootDir: badPubDir, cwd: tmp }), /requires root README\.md/u)
})

test('P1-1: stageCuratedExport matches repository checkout-type rules and protects private paths', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'lcx-pack-stage-'))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))
  const stageDir = join(tmp, 'stage')
  mkdirSync(stageDir, { recursive: true })
  const privRepo = isPrivateCheckout(repoPath)

  const { selected, allowPublicReadme } = stageCuratedExport({
    rootDir: repoPath,
    stageDir,
  })
  assert.equal(allowPublicReadme, !privRepo)
  assert.equal(selected.includes('README.md'), !privRepo)
  assert.equal(existsSync(join(stageDir, 'README.md')), !privRepo)
  assert.equal(existsSync(join(stageDir, 'AI-MANIFEST.yml')), false)
  assert.equal(existsSync(join(stageDir, 'AGENTS.md')), false)
  assert.equal(existsSync(join(stageDir, 'package.json')), true)
  assert.equal(existsSync(join(stageDir, 'locale/en.json')), true)
  assert.equal(existsSync(join(stageDir, 'locale/zh.json')), true)
  if (privRepo) {
    assert.equal(existsSync(join(stageDir, 'qa/issue-62/adapter-off.mjs')), true)
  }

  const policy = loadPublicExportPolicy(join(repoPath, 'PUBLIC-RELEASE-MANIFEST.yml'))
  const collected = collectPublicExportPaths(repoPath, policy)
  assert.equal(collected.some((p) => p.startsWith('docs/') || p.startsWith('releases/') || p.startsWith('compatibility/') || p.startsWith('tools/')), false)
  if (privRepo) {
    assert.equal(collected.some((p) => p.startsWith('.github/')), false)
  } else {
    assert.ok(collected.includes('.github/workflows/verify.yml'))
    assert.equal(collected.includes('.github/workflows/governance.yml'), false)
  }
})

test('public-readme overlay validation accepts clean public README and rejects private control-plane text', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'lcx-pack-readme-'))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))

  const badStage = join(tmp, 'bad-stage')
  mkdirSync(badStage, { recursive: true })
  const privateLike = join(tmp, 'bad-readme.md')
  writeFileSync(privateLike, '# dsh-lcx-codex 项目总控\nsee AI-MANIFEST.yml\n', 'utf8')
  assert.throws(
    () => stageCuratedExport({ rootDir: repoPath, stageDir: badStage, publicReadmePath: privateLike }),
    /private control-plane/u,
  )

  const goodStage = join(tmp, 'good-stage')
  mkdirSync(goodStage, { recursive: true })
  const publicLike = join(tmp, 'good-readme.md')
  writeFileSync(publicLike, '# LCX Codex\n\nPublic installation guide for DSH.\n', 'utf8')
  const staged = stageCuratedExport({ rootDir: repoPath, stageDir: goodStage, publicReadmePath: publicLike })
  assert.equal(staged.allowPublicReadme, true)
  assert.equal(readFileSync(join(goodStage, 'README.md'), 'utf8'), '# LCX Codex\n\nPublic installation guide for DSH.\n')

  assert.throws(() => assertSafeArchiveEntries(['package.json', 'README.md'], { allowPublicReadme: false }), /Private package leakage.*README\.md/u)
  assert.throws(() => assertSafeArchiveEntries(['package.json', 'docs/AI-RUNBOOK.md'], { allowPublicReadme: false }), /Private package leakage/u)
  assert.throws(() => assertSafeArchiveEntries(['package.json', 'node_modules/foo/index.js'], { allowPublicReadme: false }), /Unexpected bundled node_modules/u)
  assert.throws(() => assertSafeArchiveEntries(['package.json', 'extra.txt'], { allowPublicReadme: false, stagedSet: new Set(['package.json']) }), /Unexpected unstaged entry/u)
})

test('P0-A & P2-2: runLocalPack rejects invalid args, ignores inherited npm_config_dry_run on real pack, and inspects emitted .tgz on disk', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'lcx-pack-cli-'))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))
  for (const badArgs of [
    ['some-package'],
    ['.', '--dry-run'],
    ['--dry-run', '../other-pkg'],
    ['--'],
    ['--unknown-flag'],
    ['--pack-destination'],
    ['--public-readme'],
    ['--loglevel'],
  ]) {
    assert.throws(() => runLocalPack(badArgs, { rootDir: repoPath, cwd: tmp }), /Unsupported argument|requires a/u, JSON.stringify(badArgs))
  }

  const privRepo = isPrivateCheckout(repoPath)
  const raw = runLocalPack(['--dry-run', '--json'], { rootDir: repoPath, cwd: tmp })
  const parsed = JSON.parse(raw)
  assert.equal(parsed.length, 1)
  const paths = parsed[0].files.map((item) => item.path)
  assert.equal(paths.includes('README.md'), !privRepo)
  assert.ok(paths.includes('package.json'))
  assert.ok(paths.includes('locale/en.json'))
  assert.ok(paths.includes('locale/zh.json'))
  assert.ok(paths.includes('icon.svg'))
  assert.ok(paths.includes('lib/index.js'))

  // Real pack via CLI writes actual .tgz on disk even if inherited env sets npm_config_dry_run=true
  const cliOut = execFileSync(
    process.execPath,
    [join(repoPath, 'scripts/pack-local.mjs'), '--pack-destination', tmp],
    {
      cwd: repoPath,
      encoding: 'utf8',
      env: { ...process.env, npm_config_dry_run: 'true' },
    },
  ).trim()
  assert.match(cliOut, /^dsh-lcx-codex-.+\.tgz$/u)
  const tgzPath = join(tmp, cliOut)
  assert.equal(existsSync(tgzPath), true)
  const tarEntries = listTarGzEntries(tgzPath)
  assert.ok(tarEntries.includes('package.json'))
  assert.ok(tarEntries.includes('lib/index.js'))
  assert.equal(tarEntries.includes('README.md'), !privRepo)
  assert.equal(tarEntries.some((p) => p.startsWith('docs/') || p.startsWith('.github/') || p === 'PUBLIC-RELEASE-MANIFEST.yml'), false)
})

function buildTarHeader({ name, size = 0, typeFlag = '0', linkname = '' }) {
  const header = Buffer.alloc(512, 0)
  header.write(name.slice(0, 100), 0, 'utf8')
  header.write('0000644\0', 100, 'ascii')
  header.write('0000000\0', 108, 'ascii')
  header.write('0000000\0', 116, 'ascii')
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii')
  header.write('00000000000\0', 136, 'ascii')
  header.fill(0x20, 148, 156)
  header[156] = typeFlag === '\0' ? 0 : typeFlag.charCodeAt(0)
  if (linkname) header.write(linkname.slice(0, 100), 157, 'utf8')
  header.write('ustar\0', 257, 'ascii')
  header.write('00', 263, 'ascii')
  let sum = 0
  for (let i = 0; i < 512; i += 1) sum += header[i]
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  return header
}

function buildPaxRecord(key, value) {
  const body = Buffer.from(` ${key}=${value}\n`, 'utf8')
  let total = body.length + 1
  while (String(total).length + body.length !== total) {
    total = String(total).length + body.length
  }
  return Buffer.concat([Buffer.from(String(total), 'ascii'), body])
}

function packTarBuffer(entries) {
  const blocks = []
  for (const entry of entries) {
    const data = entry.data ? Buffer.from(entry.data) : Buffer.alloc(0)
    blocks.push(buildTarHeader({ name: entry.name, size: data.length, typeFlag: entry.typeFlag ?? '0', linkname: entry.linkname ?? '' }))
    if (data.length > 0) {
      blocks.push(data)
      const rem = data.length % 512
      if (rem !== 0) blocks.push(Buffer.alloc(512 - rem, 0))
    }
  }
  blocks.push(Buffer.alloc(1024, 0))
  return Buffer.concat(blocks)
}

test('P2-3: inspectTarGzArchive verifies PAX byte lengths, bounds, regular file types, package/ prefix, uniqueness, and public README bytes', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'lcx-tar-inspect-'))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))

  // 1) Multi-byte UTF-8 PAX path with '=' & deep subpath decodes accurately
  const longUtf8Path = `package/lib/测试-${'a'.repeat(90)}/key=val.txt`
  const paxPayload = buildPaxRecord('path', longUtf8Path)
  const validTgz = join(tmp, 'valid-pax.tgz')
  writeFileSync(
    validTgz,
    gzipSync(
      packTarBuffer([
        { name: 'package/PaxHeaders.0/file', typeFlag: 'x', data: paxPayload },
        { name: 'package/fallback-short-name', typeFlag: '0', data: Buffer.from('hello-utf8', 'utf8') },
      ]),
    ),
  )
  const inspected = inspectTarGzArchive(validTgz)
  assert.deepEqual(inspected.entries, [`lib/测试-${'a'.repeat(90)}/key=val.txt`])
  assert.equal(inspected.fileContents.get(`lib/测试-${'a'.repeat(90)}/key=val.txt`)?.toString('utf8'), 'hello-utf8')

  // 2) Reject symlinks ('2'), hardlinks ('1'), missing package/ prefix, duplicates, truncated tar, and corrupt PAX records
  const symlinkTgz = join(tmp, 'symlink.tgz')
  writeFileSync(symlinkTgz, gzipSync(packTarBuffer([{ name: 'package/link', typeFlag: '2', linkname: '../secret' }])))
  assert.throws(() => inspectTarGzArchive(symlinkTgz), /Unsupported or unsafe tar entry type/u)

  const hardlinkTgz = join(tmp, 'hardlink.tgz')
  writeFileSync(hardlinkTgz, gzipSync(packTarBuffer([{ name: 'package/hard', typeFlag: '1', linkname: 'package/package.json' }])))
  assert.throws(() => inspectTarGzArchive(hardlinkTgz), /Unsupported or unsafe tar entry type/u)

  const noPrefixTgz = join(tmp, 'noprefix.tgz')
  writeFileSync(noPrefixTgz, gzipSync(packTarBuffer([{ name: 'README.md', typeFlag: '0', data: Buffer.from('bad') }])))
  assert.throws(() => inspectTarGzArchive(noPrefixTgz), /missing literal package\/ prefix/u)

  const dupTgz = join(tmp, 'dup.tgz')
  writeFileSync(
    dupTgz,
    gzipSync(
      packTarBuffer([
        { name: 'package/package.json', typeFlag: '0', data: Buffer.from('{}') },
        { name: 'package/package.json', typeFlag: '0', data: Buffer.from('{}') },
      ]),
    ),
  )
  assert.throws(() => inspectTarGzArchive(dupTgz), /Duplicate entry detected/u)

  const badPaxTgz = join(tmp, 'badpax.tgz')
  writeFileSync(
    badPaxTgz,
    gzipSync(
      packTarBuffer([
        { name: 'package/PaxHeaders.0/bad', typeFlag: 'x', data: Buffer.from('999 path=short\n', 'utf8') },
        { name: 'package/a.txt', typeFlag: '0', data: Buffer.from('ok') },
      ]),
    ),
  )
  assert.throws(() => inspectTarGzArchive(badPaxTgz), /Out-of-bounds PAX record/u)

  const truncatedTar = packTarBuffer([{ name: 'package/a.txt', typeFlag: '0', data: Buffer.alloc(600, 65) }])
  const truncatedTgz = join(tmp, 'truncated.tgz')
  writeFileSync(truncatedTgz, gzipSync(truncatedTar.subarray(0, 512)))
  assert.throws(() => inspectTarGzArchive(truncatedTgz), /Truncated tar entry payload/u)

  // 3) Public README overlay pack writes real .tgz whose package/README.md bytes match staged public README identically
  const publicReadmeFile = join(tmp, 'public-readme.md')
  const publicReadmeBody = '# dsh-lcx-codex\n\nVerified public README bytes 🚀.\n'
  writeFileSync(publicReadmeFile, publicReadmeBody, 'utf8')
  const pubOutDir = join(tmp, 'pub-pack')
  mkdirSync(pubOutDir, { recursive: true })
  const pubTarName = runLocalPack(['--public-readme', publicReadmeFile, '--pack-destination', pubOutDir], { rootDir: repoPath, cwd: tmp }).trim()
  const pubInspected = inspectTarGzArchive(join(pubOutDir, pubTarName))
  assert.equal(pubInspected.fileContents.get('README.md')?.toString('utf8'), publicReadmeBody)

  // 4) Round 5 P2-4, P2-5, P2-6: tar ustar magic, 2 EOF blocks, literal package/, dir shadowing, Buffer.equals non-UTF-8 byte mismatch, and required files check
  const rawTarNoMagic = packTarBuffer([{ name: 'package/package.json', typeFlag: '0', data: Buffer.from('{}') }])
  rawTarNoMagic.fill(0, 257, 263) // wipe ustar magic without fixing checksum -> recalc checksum so magic check itself triggers
  let badMagicSum = 0
  rawTarNoMagic.fill(0x20, 148, 156)
  for (let i = 0; i < 512; i += 1) badMagicSum += rawTarNoMagic[i]
  rawTarNoMagic.write(`${badMagicSum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  const badMagicTgz = join(tmp, 'bad-magic.tgz')
  writeFileSync(badMagicTgz, gzipSync(rawTarNoMagic))
  assert.throws(() => inspectTarGzArchive(badMagicTgz), /Invalid tar ustar magic/u)

  const singleEofTar = packTarBuffer([{ name: 'package/package.json', typeFlag: '0', data: Buffer.from('{}') }])
  const singleEofTgz = join(tmp, 'single-eof.tgz')
  writeFileSync(singleEofTgz, gzipSync(singleEofTar.subarray(0, singleEofTar.length - 512)))
  assert.throws(() => inspectTarGzArchive(singleEofTgz), /second 512-byte EOF zero block/u)

  const dotSlashTgz = join(tmp, 'dotslash.tgz')
  writeFileSync(dotSlashTgz, gzipSync(packTarBuffer([{ name: './package/package.json', typeFlag: '0', data: Buffer.from('{}') }])))
  assert.throws(() => inspectTarGzArchive(dotSlashTgz), /missing literal package\/ prefix/u)

  const dirShadowTgz = join(tmp, 'dirshadow.tgz')
  writeFileSync(
    dirShadowTgz,
    gzipSync(
      packTarBuffer([
        { name: 'package/lib', typeFlag: '0', data: Buffer.from('not-a-dir') },
        { name: 'package/lib/', typeFlag: '5' },
      ]),
    ),
  )
  assert.throws(() => inspectTarGzArchive(dirShadowTgz), /shadows regular file/u)

  // Non-identical raw byte sequences with identical lossy UTF-8 string decoding MUST be rejected by Buffer.equals check
  const invalidBytesA = Buffer.from([0x23, 0x20, 0x70, 0x75, 0x62, 0x20, 0xff, 0xfe, 0x0a])
  const invalidBytesB = Buffer.from([0x23, 0x20, 0x70, 0x75, 0x62, 0x20, 0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd, 0x0a])
  assert.equal(invalidBytesA.toString('utf8'), invalidBytesB.toString('utf8'))
  assert.equal(invalidBytesA.equals(invalidBytesB), false)
  assert.doesNotThrow(() => verifyPublicReadmeBytes(invalidBytesA, Buffer.from(invalidBytesA)))
  assert.throws(() => verifyPublicReadmeBytes(invalidBytesA, invalidBytesB), /bytes differ/u)

  // Missing required runtime file fails closed even when npm pack succeeds
  const missingRuntimeDir = join(tmp, 'missing-runtime')
  writeMinimalExportFixture(missingRuntimeDir, { privateMode: true })
  const brokenPkg = JSON.parse(readFileSync(join(missingRuntimeDir, 'package.json'), 'utf8'))
  brokenPkg.files = ['icon.svg', 'locale/*.json']
  writeFileSync(join(missingRuntimeDir, 'package.json'), JSON.stringify(brokenPkg, null, 2), 'utf8')
  assert.ok(REQUIRED_PACKAGE_FILES.includes('lib/client.js'))
  assert.throws(() => runLocalPack(['--dry-run', '--json'], { rootDir: missingRuntimeDir, cwd: tmp }), /missing required runtime entry/u)

  // 5) Round 6 P2-5 & P3-2: reject high-bit ustar magic, reject 'g'/'K' tar types, verify archive directory guard, and never write rejected .tgz to packDestination
  const highBitMagicTar = packTarBuffer([{ name: 'package/package.json', typeFlag: '0', data: Buffer.from('{}') }])
  Buffer.from([0x75, 0x73, 0x74, 0x61, 0x72, 0x80]).copy(highBitMagicTar, 257)
  let highBitSum = 0
  highBitMagicTar.fill(0x20, 148, 156)
  for (let i = 0; i < 512; i += 1) highBitSum += highBitMagicTar[i]
  highBitMagicTar.write(`${highBitSum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  const highBitTgz = join(tmp, 'highbit-magic.tgz')
  writeFileSync(highBitTgz, gzipSync(highBitMagicTar))
  assert.throws(() => inspectTarGzArchive(highBitTgz), /Invalid tar ustar magic/u)

  const globalPaxTgz = join(tmp, 'global-pax.tgz')
  writeFileSync(
    globalPaxTgz,
    gzipSync(packTarBuffer([{ name: 'package/PaxHeaders.0/global', typeFlag: 'g', data: Buffer.from('14 comment=x\n') }])),
  )
  assert.throws(() => inspectTarGzArchive(globalPaxTgz), /Unsupported or unsafe tar entry type/u)

  const gnuLongLinkTgz = join(tmp, 'gnu-long-link.tgz')
  writeFileSync(
    gnuLongLinkTgz,
    gzipSync(packTarBuffer([{ name: 'package/./@LongLink', typeFlag: 'K', data: Buffer.from('package/target\0') }])),
  )
  assert.throws(() => inspectTarGzArchive(gnuLongLinkTgz), /Unsupported or unsafe tar entry type/u)

  assert.throws(() => assertSafeArchiveDirectories(['lib', '.github']), /Private or forbidden directory entry detected/u)
  assert.throws(() => assertSafeArchiveDirectories(['docs/node_modules']), /Private or forbidden directory entry detected/u)
  assert.throws(
    () => assertSafeArchiveDirectories(['README.md'], { allowPublicReadme: true, stagedSet: new Set(['lib/index.js']) }),
    /has no matching staged files/u,
  )
  assert.doesNotThrow(() =>
    assertSafeArchiveDirectories(['lib', 'locale'], { stagedSet: new Set(['lib/index.js', 'locale/en.json']) }),
  )

  // 6) Round 7 P2-3 & P3-1: byte equality across ALL archived files + post-pack .tgz rejection leaves caller destination clean
  const byteParityDir = join(tmp, 'byte-parity-fixture')
  writeMinimalExportFixture(byteParityDir, { privateMode: true })
  const matchMap = new Map([
    ['package.json', readFileSync(join(byteParityDir, 'package.json'))],
    ['lib/index.js', readFileSync(join(byteParityDir, 'lib', 'index.js'))],
  ])
  assert.doesNotThrow(() => assertArchivedFilesMatchStaged(matchMap, byteParityDir, ['package.json', 'lib/index.js']))
  const tamperedMap = new Map(matchMap)
  tamperedMap.set('lib/index.js', Buffer.from('export default function() { /* tampered */ }\n', 'utf8'))
  assert.throws(
    () => assertArchivedFilesMatchStaged(tamperedMap, byteParityDir, ['package.json', 'lib/index.js']),
    /Archived file bytes differ from staged file: lib\/index\.js/u,
  )

  const stubNpmCli = join(tmp, 'stub-npm-cli.mjs')
  writeFileSync(
    stubNpmCli,
    `
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

function collectFiles(dir, prefix = '') {
  const out = []
  for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? prefix + '/' + ent.name : ent.name
    const full = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...collectFiles(full, rel))
    else if (ent.isFile()) out.push({ rel, data: readFileSync(full) })
  }
  return out
}

function tarHeader(name, size) {
  const h = Buffer.alloc(512, 0)
  h.write(name.slice(0, 100), 0, 'utf8')
  h.write('0000644\\0', 100, 'ascii')
  h.write('0000000\\0', 108, 'ascii')
  h.write('0000000\\0', 116, 'ascii')
  h.write(size.toString(8).padStart(11, '0') + '\\0', 124, 'ascii')
  h.write('00000000000\\0', 136, 'ascii')
  h.fill(0x20, 148, 156)
  h[156] = '0'.charCodeAt(0)
  h.write('ustar\\0', 257, 'ascii')
  h.write('00', 263, 'ascii')
  let sum = 0
  for (let i = 0; i < 512; i += 1) sum += h[i]
  h.write(sum.toString(8).padStart(6, '0') + '\\0 ', 148, 'ascii')
  return h
}

const files = collectFiles(process.cwd())
const args = process.argv.slice(2)
if (args.includes('--dry-run=false')) {
  const dest = args[args.indexOf('--pack-destination') + 1]
  mkdirSync(dest, { recursive: true })
  const blocks = []
  for (const f of files) {
    const payload = f.rel === 'lib/index.js'
      ? Buffer.from('export default function() { /* tampered-in-tar */ }\\n', 'utf8')
      : f.data
    blocks.push(tarHeader('package/' + f.rel, payload.length))
    if (payload.length > 0) {
      blocks.push(payload)
      const rem = payload.length % 512
      if (rem !== 0) blocks.push(Buffer.alloc(512 - rem, 0))
    }
  }
  blocks.push(Buffer.alloc(1024, 0))
  writeFileSync(join(dest, 'dsh-lcx-codex-0.7.0.tgz'), gzipSync(Buffer.concat(blocks)))
}
process.stdout.write(JSON.stringify([{ filename: 'dsh-lcx-codex-0.7.0.tgz', files: files.map((f) => ({ path: f.rel })), bundled: [] }]))
`,
    'utf8',
  )
  const failPackDest = join(tmp, 'rejected-pack-dest')
  mkdirSync(failPackDest, { recursive: true })
  const prevNpmExecPath = process.env.npm_execpath
  try {
    process.env.npm_execpath = stubNpmCli
    assert.throws(
      () => runLocalPack(['--pack-destination', failPackDest], { rootDir: byteParityDir, cwd: tmp }),
      /Archived file bytes differ from staged file: lib\/index\.js/u,
    )
  } finally {
    if (prevNpmExecPath === undefined) delete process.env.npm_execpath
    else process.env.npm_execpath = prevNpmExecPath
  }
  assert.deepEqual(readdirSync(failPackDest), [])

  // 7) Round 8 P2-2: deriveExpectedPackageFiles + assertRuntimeImportClosure catch missing imported runtime modules (e.g. lib/route.js)
  const missingImportDir = join(tmp, 'missing-imported-route')
  writeMinimalExportFixture(missingImportDir, { privateMode: true })
  writeFileSync(join(missingImportDir, 'lib', 'index.js'), 'import { route } from "./route.js"\nexport default route\n', 'utf8')
  writeFileSync(join(missingImportDir, 'lib', 'route.js'), 'export function route() {}\n', 'utf8')
  const handpickedPkg = JSON.parse(readFileSync(join(missingImportDir, 'package.json'), 'utf8'))
  handpickedPkg.files = [
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
  ]
  writeFileSync(join(missingImportDir, 'package.json'), JSON.stringify(handpickedPkg, null, 2), 'utf8')
  const derivedOmitted = deriveExpectedPackageFiles(missingImportDir, [
    'package.json',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'cordis.patch.yml',
    'icon.svg',
    'locale/en.json',
    'locale/zh.json',
    'lib/index.js',
    'lib/client.js',
    'lib/route.js',
    'lib/pi-responses-runtime.js',
    'lib/types/index.d.ts',
    'lib/types/client/index.d.ts',
    'lib/types/client/search-media.d.ts',
  ])
  assert.equal(derivedOmitted.includes('lib/route.js'), false)
  assert.throws(
    () => assertRuntimeImportClosure(derivedOmitted, missingImportDir),
    /Missing imported runtime module "lib\/route\.js" referenced by "lib\/index\.js"/u,
  )
  assert.throws(
    () => runLocalPack(['--dry-run', '--json'], { rootDir: missingImportDir, cwd: tmp }),
    /Missing imported runtime module "lib\/route\.js" referenced by "lib\/index\.js"/u,
  )
  assert.throws(
    () => assertExactFileSet(['package.json', 'lib/index.js'], ['package.json', 'lib/index.js', 'lib/route.js'], 'tarball'),
    /missing \[lib\/route\.js\]/u,
  )

  // 8) Round 9 P2-2 & P2-3: ESM comment/template/with/query forms + fail closed on unsupported package.json files glob syntax
  const esmFormsCode = [
    'export * from /* comment */ "./route.js";',
    'export { foo } from /* block */ \'./util.js?v=1#hash\';',
    'const a = import(`./dyn-template.js`);',
    'const b = import("./with-opts.js", { with: { type: "javascript" } });',
    'const regexTrap = /[\'"`]/;',
    'const fake = "import x from \'./not-real.js\'";',
  ].join('\n')
  assert.deepEqual(extractRelativeJsImports(esmFormsCode), [
    './route.js',
    './util.js?v=1#hash',
    './dyn-template.js',
    './with-opts.js',
  ])

  const esmFormsDir = join(tmp, 'esm-forms-fixture')
  writeMinimalExportFixture(esmFormsDir, { privateMode: true })
  writeFileSync(join(esmFormsDir, 'lib', 'index.js'), esmFormsCode, 'utf8')
  for (const mod of ['route.js', 'util.js', 'dyn-template.js', 'with-opts.js']) {
    writeFileSync(join(esmFormsDir, 'lib', mod), 'export const foo = 1\n', 'utf8')
  }
  const esmFilesComplete = [
    'package.json',
    'lib/index.js',
    'lib/route.js',
    'lib/util.js',
    'lib/dyn-template.js',
    'lib/with-opts.js',
  ]
  assert.doesNotThrow(() => assertRuntimeImportClosure(esmFilesComplete, esmFormsDir))
  for (const omitted of ['lib/route.js', 'lib/util.js', 'lib/dyn-template.js', 'lib/with-opts.js']) {
    assert.throws(
      () => assertRuntimeImportClosure(esmFilesComplete.filter((f) => f !== omitted), esmFormsDir),
      new RegExp(`Missing imported runtime module "${omitted.replace('.', '\\.')}"`, 'u'),
    )
  }

  for (const badGlob of ['lib/{index,route}.js', 'lib/[ir]*.js', 'lib\\*.js', 'lib/!(client).js', '!(lib)', 'lib/@(index|route).js']) {
    const badGlobDir = join(tmp, `bad-glob-${badGlob.replace(/[^a-z0-9]/giu, '_')}`)
    writeMinimalExportFixture(badGlobDir, { privateMode: true })
    const badGlobPkg = JSON.parse(readFileSync(join(badGlobDir, 'package.json'), 'utf8'))
    badGlobPkg.files.push(badGlob)
    writeFileSync(join(badGlobDir, 'package.json'), JSON.stringify(badGlobPkg, null, 2), 'utf8')
    assert.throws(
      () => deriveExpectedPackageFiles(badGlobDir, ['package.json', 'LICENSE', 'lib/index.js']),
      /Unsupported (?:backslash|extglob|glob syntax)/u,
      `Expected rejection for unsupported files pattern ${badGlob}`,
    )
  }

  // 9) Round 10 P2-2, P2-3 & P3-1: TypeScript AST parsing handles regex-after-if, division-by-{}, ${import()}, and \u0072 escapes;
  //    nested package-root check blocks ../%2e%2e/ traversal; ambiguous trailing /* is rejected vs single-segment lib/*.js
  const trickyEsmCode = [
    "if (cond) /'/.test(input);",
    "import './regex-if.js';",
    "const ratio = {} / 2;",
    "import './brace-div.js';",
    "const dynTpl = `prefix ${import('./tpl-dyn.js')} suffix`;",
    "import './\\u0072oute.js';",
  ].join('\n')
  assert.deepEqual([...extractRelativeJsImports(trickyEsmCode)].sort(), [
    './brace-div.js',
    './regex-if.js',
    './route.js',
    './tpl-dyn.js',
  ])

  const trickyDir = join(tmp, 'tricky-esm-fixture')
  writeMinimalExportFixture(trickyDir, { privateMode: true })
  writeFileSync(join(trickyDir, 'lib', 'index.js'), trickyEsmCode, 'utf8')
  for (const mod of ['regex-if.js', 'brace-div.js', 'tpl-dyn.js', 'route.js']) {
    writeFileSync(join(trickyDir, 'lib', mod), 'export const ok = 1\n', 'utf8')
  }
  const trickyFiles = [
    'package.json',
    'lib/index.js',
    'lib/regex-if.js',
    'lib/brace-div.js',
    'lib/tpl-dyn.js',
    'lib/route.js',
  ]
  assert.doesNotThrow(() => assertRuntimeImportClosure(trickyFiles, trickyDir))
  for (const omitted of ['lib/regex-if.js', 'lib/brace-div.js', 'lib/tpl-dyn.js', 'lib/route.js']) {
    assert.throws(
      () => assertRuntimeImportClosure(trickyFiles.filter((f) => f !== omitted), trickyDir),
      new RegExp(`Missing imported runtime module "${omitted.replace('.', '\\.')}"`, 'u'),
    )
  }

  // Round 10 P2-3: percent-encoded traversal ../%2e%2e/lib/route.js must be caught as escaping package root
  const encodedEscapeDir = join(tmp, 'encoded-escape-fixture')
  writeMinimalExportFixture(encodedEscapeDir, { privateMode: true })
  writeFileSync(join(encodedEscapeDir, 'lib', 'index.js'), "import '../%2e%2e/lib/route.js';\n", 'utf8')
  writeFileSync(join(encodedEscapeDir, 'lib', 'route.js'), 'export const x = 1\n', 'utf8')
  assert.throws(
    () => assertRuntimeImportClosure(['package.json', 'lib/index.js', 'lib/route.js'], encodedEscapeDir),
    /escapes package root/u,
  )

  // Round 11 P2-3: forbid encoded path separators (%2f / %5c) rejected by Node ESM
  for (const sepSpec of ['./nested%2Froute.js', './nested%5croute.js']) {
    const encodedSepDir = join(tmp, `encoded-sep-${sepSpec.replace(/[^a-z0-9]/giu, '_')}`)
    writeMinimalExportFixture(encodedSepDir, { privateMode: true })
    mkdirSync(join(encodedSepDir, 'lib', 'nested'), { recursive: true })
    writeFileSync(join(encodedSepDir, 'lib', 'index.js'), `import '${sepSpec}';\n`, 'utf8')
    writeFileSync(join(encodedSepDir, 'lib', 'nested', 'route.js'), 'export const x = 1\n', 'utf8')
    assert.throws(
      () => assertRuntimeImportClosure(['package.json', 'lib/index.js', 'lib/nested/route.js'], encodedSepDir),
      /forbidden encoded path separator/u,
    )
  }

  // Round 10 P3-1: reject ambiguous trailing /* while keeping single-segment *.js rules
  const starGlobDir = join(tmp, 'star-glob-fixture')
  writeMinimalExportFixture(starGlobDir, { privateMode: true })
  const starPkg = JSON.parse(readFileSync(join(starGlobDir, 'package.json'), 'utf8'))
  starPkg.files.push('lib/*')
  writeFileSync(join(starGlobDir, 'package.json'), JSON.stringify(starPkg, null, 2), 'utf8')
  assert.throws(
    () => deriveExpectedPackageFiles(starGlobDir, ['package.json', 'LICENSE', 'lib/index.js']),
    /Unsupported ambiguous trailing "\/\*"/u,
  )

  const extGlobDir = join(tmp, 'ext-glob-fixture')
  writeMinimalExportFixture(extGlobDir, { privateMode: true })
  mkdirSync(join(extGlobDir, 'lib', 'sub'), { recursive: true })
  writeFileSync(join(extGlobDir, 'lib', 'sub', 'nested.js'), 'export const nested = 1\n', 'utf8')
  const derivedExt = deriveExpectedPackageFiles(extGlobDir, [
    'package.json',
    'LICENSE',
    'lib/index.js',
    'lib/route.js',
    'lib/sub/nested.js',
  ])
  assert.ok(derivedExt.includes('lib/index.js') && derivedExt.includes('lib/route.js'))
  assert.equal(derivedExt.includes('lib/sub/nested.js'), false, 'lib/*.js must remain single-segment only')

  // Round 12 P3-2: fallback comment stripper must preserve https:// inside string literals
  const urlStringImportCode = [
    'const docsUrl = "https://example.com/a//b/*keep*/";',
    "const single = 'https://foo.test/bar';",
    '// line comment with import "./ignored.js"',
    '/* block comment with import "./ignored2.js" */',
    'import "./foo.js"; // trailing comment',
  ].join('\n')
  assert.deepEqual(
    extractRelativeJsImports(urlStringImportCode, { allowWithoutEsbuild: true }),
    ['./foo.js'],
  )

  // Round 13 P3-2: JS lexer fallback handles regex literals with //, nested template ${...} comments, division, and .import() calls
  const lexerBoundaryCode = [
    'const re1 = /\\/\\/import ".\\/ignored-regex.js"/gu;',
    'const re2 = /\\/\\*import ".\\/ignored-regex2.js"\\*\\//;',
    'const ratio = a / b / c;',
    'import "./after-div.js";',
    'const tpl = `import "./ignored-tpl.js" ${/* } import "./ignored-tpl-cmt.js" */ 1 + 2} end`;',
    'import "./after-tpl.js";',
    'obj.import("./ignored-method.js");',
    'obj?.import("./ignored-opt.js");',
    "const strLit = 'import \"./ignored-str.js\"';",
    'import defVal from "./dep-a.js";',
    'export * from "./dep-b.mjs";',
    'export { foo as bar } from "./dep-c.cjs";',
    'const dyn = await import("./dep-d.js", { with: { type: "json" } });',
    'if (x) /[/*]/.test(s);',
    'while (cond) /\\/\\*not-comment\\*\\//.test(s);',
    'for (;false;) /[/*]/.test(s);',
    'import "./after-ctrl-regex.js";',
    'const divAfterCall = obj.if(x) / 2;',
    'const divAfterParen = (a + b) / c;',
    'const v = { a: 1, nested: { b: 2 } } / 2;',
    'const fBlock = () => { return 1; }\n/\\/\\*not-comment\\*\\//.test(s);',
    'if (cond) { foo(); } /\\/\\*not-comment\\*\\//.test(s);',
    'import "./after-paren-div.js";',
  ].join('\n')
  const expectedLexerImports = [
    './after-div.js',
    './after-tpl.js',
    './dep-a.js',
    './dep-b.mjs',
    './dep-c.cjs',
    './dep-d.js',
    './after-ctrl-regex.js',
    './after-paren-div.js',
  ]
  assert.deepEqual(extractRelativeJsImportsFallback(lexerBoundaryCode), expectedLexerImports)
  assert.deepEqual(
    [...extractRelativeJsImports(lexerBoundaryCode, { allowWithoutEsbuild: true })].sort(),
    [...expectedLexerImports].sort(),
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('if (x) /[/*]/.test(s); with (obj) /[/*]/.test(s); import "./a.js";'),
    ['./a.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('const v = {a:1} / 2; import "./a.js";'),
    ['./a.js'],
  )
  // Round 16 P3-1: function/class expressions divide after }, declarations allow regex after }, and switch case/default blocks allow regex after }
  assert.deepEqual(
    extractRelativeJsImportsFallback('const f = function() {} / 2; import "./a.js";'),
    ['./a.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('const C = class {} / 2; import "./b.js";'),
    ['./b.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('const f = async function* named(x = { a: 1 }) { if (x) /re/.test(s); } / 2; import "./c.js";'),
    ['./c.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('const D = class extends (Base) { m() {} } / 2; import "./d.js";'),
    ['./d.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('function decl() {} /"import \'.\\/fake.js\'"/; import "./decl.js";'),
    ['./decl.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('class Decl {} /"import \'.\\/fake.js\'"/; import "./class-decl.js";'),
    ['./class-decl.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('switch (x) { case 1: { break; } /"import(\'.\\/fake.js\')/; import("./real.js"); }'),
    ['./real.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('switch (x) { case (a ? 1 : 2): { break; } /"import(\'.\\/fake-ternary.js\')/; default: { break; } /"import(\'.\\/fake-default.js\')/; } import "./real-switch.js";'),
    ['./real-switch.js'],
  )
  // Round 17 P3-1: nested block/callback function & class declarations, template roots, and return/yield newline ASI
  assert.deepEqual(
    extractRelativeJsImportsFallback('call(() => { function fn() {} /"import(\'.\\/fake.js\')/; import("./real.js"); });'),
    ['./real.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('call(() => { class C {} /"import(\'.\\/fake.js\')/; import("./real-class.js"); });'),
    ['./real-class.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('arr.map([() => { class C {} /"import(\'.\\/fake.js\')/; import("./real-bracket.js"); }]);'),
    ['./real-bracket.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('function g() {\n  return\n  function fn() {} /"import(\'.\\/fake.js\')/; import("./real-ret-asi.js");\n}'),
    ['./real-ret-asi.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('function g() {\n  return\n  /re"/.test(s); import("./after-ret-re.js");\n}'),
    ['./after-ret-re.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('function* gen() {\n  yield\n  function fn() {} /"import(\'.\\/fake.js\')/; import("./real-yield-asi.js");\n}'),
    ['./real-yield-asi.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('function outer() { const s = `${ function() {} / 2 }`; const t = `${ () => { function fn() {} /"/; import("./real-tpl-cb.js"); } }`; } import "./after-tpl-expr.js";'),
    ['./real-tpl-cb.js', './after-tpl-expr.js'],
  )
  // Round 18 P3-1: uniform line terminators (\r, \u2028) and return/yield newline ASI before { block }
  assert.deepEqual(
    extractRelativeJsImportsFallback('function g() {\n  return\n  { function fn() {} /"import(\'.\\/fake.js\')/; import("./real.js"); }\n}'),
    ['./real.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('function* gen() {\n  yield\n  { function fn() {} /"import(\'.\\/fake.js\')/; import("./real.js"); }\n}'),
    ['./real.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('function g() {\r  return\r  function fn() {} /"import(\'.\\/fake.js\')/; import("./real.js");\r}'),
    ['./real.js'],
  )
  assert.deepEqual(
    extractRelativeJsImportsFallback('// comment\rimport "./after-cr-comment.js";\u2028function g() {\u2028  return\u2028  { function fn() {} /"import(\'.\\/fake.js\')/; import("./after-ls.js"); }\u2028}'),
    ['./after-cr-comment.js', './after-ls.js'],
  )
  // Round 19 P3-1: JS line continuations across all 5 LineTerminators (LF, CR, CRLF, \u2028, \u2029) in static & dynamic imports
  assert.deepEqual(
    extractRelativeJsImportsFallback(
      [
        'import "./dep-lf\\\n.js";',
        'import "./dep-cr\\\r.js";',
        'import "./dep-crlf\\\r\n.js";',
        'import "./dep-ls\\\u2028.js";',
        'import "./dep-ps\\\u2029.js";',
        'import("./dyn-lf\\\n.js");',
        'import("./dyn-cr\\\r.js");',
        'import("./dyn-crlf\\\r\n.js");',
        'import("./dyn-ls\\\u2028.js");',
        'import("./dyn-ps\\\u2029.js");',
        'import(`./dyn-tpl\\\r\n.js`);',
      ].join('\n'),
    ),
    [
      './dep-lf.js',
      './dep-cr.js',
      './dep-crlf.js',
      './dep-ls.js',
      './dep-ps.js',
      './dyn-lf.js',
      './dyn-cr.js',
      './dyn-crlf.js',
      './dyn-ls.js',
      './dyn-ps.js',
      './dyn-tpl.js',
    ],
  )
})
