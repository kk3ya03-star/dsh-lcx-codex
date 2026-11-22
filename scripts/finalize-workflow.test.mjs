import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const workflowUrl = new URL('../.github/workflows/finalize-stable-release.yml', import.meta.url)
const workflowText = readFileSync(workflowUrl, 'utf8')
const publishWorkflowText = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')
const rootPkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function findBash() {
  if (process.platform === 'win32') {
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    if (existsSync(gitBash)) return gitBash
  }
  return 'bash'
}

function extractStepRunBlock(ymlText, stepName) {
  const stepMarker = `- name: ${stepName}`
  const stepIdx = ymlText.indexOf(stepMarker)
  assert.ok(stepIdx !== -1, `Workflow must contain step "${stepName}"`)
  const runMarker = '        run: |\n'
  const runIdx = ymlText.indexOf(runMarker, stepIdx)
  assert.ok(runIdx !== -1, `Step "${stepName}" must contain bash run block`)
  const lines = ymlText.slice(runIdx + runMarker.length).split(/\r?\n/u)
  const collected = []
  for (const line of lines) {
    if (line === '' || line.startsWith('          ')) {
      collected.push(line.startsWith('          ') ? line.slice(10) : '')
      continue
    }
    break
  }
  return collected.join('\n')
}

function approvedStablePackage({
  name = 'dsh-lcx-codex',
  version,
  dsh = rootPkg.devDependencies['@deepseek-ai/dsh'],
  pluginPi = rootPkg.devDependencies['@earendil-works/pi-ai'],
  hostPi = rootPkg.lcxCompatibility.verifiedHostPi,
  installRange = '>=0.2.2-rc.5 <0.2.3-0',
} = {}) {
  return {
    name,
    version,
    devDependencies: {
      '@deepseek-ai/dsh': dsh,
      '@earendil-works/pi-ai': pluginPi,
    },
    peerDependencies: Object.fromEntries(
      Object.entries(rootPkg.peerDependencies).map(([k, v]) => [
        k,
        k.startsWith('@deepseek-ai/dsh-') ? installRange : v,
      ]),
    ),
    lcxCompatibility: {
      dshInstallRange: installRange,
      verifiedDsh: dsh,
      verifiedHostPi: hostPi,
      verifiedPluginPi: pluginPi,
    },
  }
}

function setYamlSectionField(yamlText, sectionName, keyName, valueText) {
  const lines = yamlText.split(/\r?\n/u)
  let inSection = false
  let sectionLineIdx = -1
  let existingIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^[A-Za-z0-9_]+:/u.test(line)) {
      if (inSection) break
      if (line.trim() === `${sectionName}:`) {
        inSection = true
        sectionLineIdx = i
      }
      continue
    }
    if (inSection && new RegExp(`^  ${keyName}:(?:[ \\t]|$)`, 'u').test(line)) {
      existingIdx = i
      break
    }
  }
  const formatted = `  ${keyName}: ${valueText}`
  if (existingIdx !== -1) {
    lines[existingIdx] = formatted
    return lines.join('\n')
  }
  assert.ok(sectionLineIdx !== -1, `Fixture manifest is missing section "${sectionName}:"`)
  lines.splice(sectionLineIdx + 1, 0, formatted)
  return lines.join('\n')
}

function approvedStableManifest({
  version,
  branch = 'main',
  tag = `v${version}`,
  distTag = 'latest',
  productOwner = 'private-issue-131-po-approved-2026-11-22',
  controllerReview = 'TL_ACCEPTED_ENGINEERING_REVIEW_2026-11-22',
  tlReviewedProductCommit = '0123456789abcdef0123456789abcdef01234567',
  sourceProductCommit = tlReviewedProductCommit,
  finalIrreversibleConfirmation = 'RECORDED_2026-11-22',
  publicExportReview = 'TL_PASSED_REVISION_1_2026-11-22',
  verificationState = 'ENGINEERING_GATES_AND_RUNTIME_QA_PASSED_TL_ACCEPTED',
  verificationRuntimeQa = 'PASSED',
  verificationDsh = undefined,
  verificationProductCommit = undefined,
  verificationVerifiedCommit = undefined,
  verificationPolicy = 'Engineering gates + runtime QA completed under docs/qa/issue-131/RUNTIME-QA-STABLE.md',
  engineeringIssue = '131',
  approvedVersion = version,
  approvalWorkBranch = 'work/131-stable-0.7.0',
  sourceWorkBranch = 'work/131-stable-0.7.0',
  publicationState = 'APPROVED_PENDING_PUBLISH',
  state = 'APPROVED_STABLE',
  previousLatest = '0.6.0',
  stableRemain = '0.8.0',
  dsh = rootPkg.devDependencies['@deepseek-ai/dsh'],
  hostPi = rootPkg.lcxCompatibility.verifiedHostPi,
  pluginPi = rootPkg.devDependencies['@earendil-works/pi-ai'],
  installRange = '>=0.2.2-rc.5 <0.2.3-0',
  extraApprovalLines = '',
  extraSourceLines = '',
  baseText = undefined,
}) {
  const effectiveVerificationProductCommit =
    verificationProductCommit === undefined ? sourceProductCommit : verificationProductCommit
  const effectiveVerificationDsh =
    verificationDsh === undefined ? dsh : verificationDsh
  if (baseText !== undefined) {
    let out = baseText
      .replace(/^version: .+$/m, `version: ${version}`)
      .replace(/^state: .+$/m, `state: ${state}`)
      .replace(/^ {2}branch: .+$/m, `  branch: ${branch}`)
      .replace(/^ {2}tag: .+$/m, `  tag: ${tag}`)
      .replace(/^ {2}npm_dist_tag: .+$/m, `  npm_dist_tag: ${distTag}`)
      .replace(/^ {2}dsh: .+$/m, `  dsh: ${dsh}`)
      .replace(/^ {2}host_pi: .+$/m, `  host_pi: ${hostPi}`)
      .replace(/^ {2}plugin_pi: .+$/m, `  plugin_pi: ${pluginPi}`)
    if (productOwner !== null) out = setYamlSectionField(out, 'approval', 'product_owner', productOwner)
    if (controllerReview !== null) out = setYamlSectionField(out, 'approval', 'controller_review', controllerReview)
    if (tlReviewedProductCommit !== null) out = setYamlSectionField(out, 'approval', 'tl_reviewed_product_commit', tlReviewedProductCommit)
    if (approvedVersion !== null) out = setYamlSectionField(out, 'approval', 'approved_version', approvedVersion)
    if (engineeringIssue !== null) {
      out = setYamlSectionField(out, 'approval', 'engineering_issue', engineeringIssue)
      out = setYamlSectionField(out, 'source', 'engineering_issue', engineeringIssue)
    }
    if (approvalWorkBranch !== null) out = setYamlSectionField(out, 'approval', 'work_branch', approvalWorkBranch)
    if (sourceWorkBranch !== null) out = setYamlSectionField(out, 'source', 'work_branch', sourceWorkBranch)
    if (finalIrreversibleConfirmation !== null) out = setYamlSectionField(out, 'approval', 'final_irreversible_confirmation', finalIrreversibleConfirmation)
    if (publicExportReview !== null) out = setYamlSectionField(out, 'approval', 'public_export_review', publicExportReview)
    if (verificationState !== null) out = setYamlSectionField(out, 'verification', 'state', verificationState)
    if (verificationRuntimeQa !== null) out = setYamlSectionField(out, 'verification', 'runtime_qa', verificationRuntimeQa)
    if (effectiveVerificationDsh !== null) out = setYamlSectionField(out, 'verification', 'dsh', effectiveVerificationDsh)
    if (effectiveVerificationProductCommit !== null) {
      out = setYamlSectionField(out, 'verification', 'product_commit', effectiveVerificationProductCommit)
    }
    if (verificationVerifiedCommit !== undefined && verificationVerifiedCommit !== null) {
      out = setYamlSectionField(out, 'verification', 'verified_commit', verificationVerifiedCommit)
    } else if (/^ {2}verified_commit:/m.test(out) && sourceProductCommit !== null) {
      out = setYamlSectionField(out, 'verification', 'verified_commit', sourceProductCommit)
    }
    if (verificationPolicy !== null) out = setYamlSectionField(out, 'verification', 'policy', `"${verificationPolicy}"`)
    if (sourceProductCommit !== null) out = setYamlSectionField(out, 'source', 'product_commit', sourceProductCommit)
    out = setYamlSectionField(out, 'publication', 'state', publicationState)
    return out
  }
  const targetVersionRule = branch === 'main'
    ? (previousLatest === null ? '' : `  previous_latest_must_be: ${previousLatest}`)
    : (stableRemain === null ? '' : `  stable_latest_must_remain: ${stableRemain}`)
  return [
    `version: ${version}`,
    `state: ${state}`,
    'approval:',
    ...(productOwner === null ? [] : [`  product_owner: ${productOwner}`]),
    ...(controllerReview === null ? [] : [`  controller_review: ${controllerReview}`]),
    ...(tlReviewedProductCommit === null ? [] : [`  tl_reviewed_product_commit: ${tlReviewedProductCommit}`]),
    ...(engineeringIssue === null ? [] : [`  engineering_issue: ${engineeringIssue}`]),
    ...(approvedVersion === null ? [] : [`  approved_version: ${approvedVersion}`]),
    ...(approvalWorkBranch === null ? [] : [`  work_branch: ${approvalWorkBranch}`]),
    ...(finalIrreversibleConfirmation === null ? [] : [`  final_irreversible_confirmation: ${finalIrreversibleConfirmation}`]),
    ...(publicExportReview === null ? [] : [`  public_export_review: ${publicExportReview}`]),
    ...(extraApprovalLines ? [extraApprovalLines] : []),
    'verification:',
    ...(verificationState === null ? [] : [`  state: ${verificationState}`]),
    ...(verificationRuntimeQa === null ? [] : [`  runtime_qa: ${verificationRuntimeQa}`]),
    ...(effectiveVerificationDsh === null ? [] : [`  dsh: ${effectiveVerificationDsh}`]),
    ...(effectiveVerificationProductCommit === null ? [] : [`  product_commit: ${effectiveVerificationProductCommit}`]),
    ...(verificationVerifiedCommit === undefined || verificationVerifiedCommit === null ? [] : [`  verified_commit: ${verificationVerifiedCommit}`]),
    ...(verificationPolicy === null ? [] : [`  policy: "${verificationPolicy}"`]),
    'source:',
    ...(sourceProductCommit === null ? [] : [`  product_commit: ${sourceProductCommit}`]),
    ...(engineeringIssue === null ? [] : [`  engineering_issue: ${engineeringIssue}`]),
    ...(sourceWorkBranch === null ? [] : [`  work_branch: ${sourceWorkBranch}`]),
    '  engineering_issues: [131]',
    ...(extraSourceLines ? [extraSourceLines] : []),
    'public_target:',
    `  branch: ${branch}`,
    `  tag: ${tag}`,
    `  npm_dist_tag: ${distTag}`,
    ...(targetVersionRule ? [targetVersionRule] : []),
    'runtime_basis:',
    `  dsh: ${dsh}`,
    `  host_pi: ${hostPi}`,
    `  plugin_pi: ${pluginPi}`,
    `  install_range: "${installRange}"`,
    'publication:',
    `  state: ${publicationState}`,
  ].join('\n')
}

function parseKeyValueFile(filePath) {
  const map = {}
  if (!existsSync(filePath)) return map
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    if (!line) continue
    const eq = line.indexOf('=')
    if (eq > 0) map[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return map
}

function setupWorkflowRepo(t, { version, pkgOverride, manifest, autocrlfFalse = false }) {
  const root = mkdtempSync(join(tmpdir(), 'lcx-finalize-wf-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const originDir = join(root, 'origin.git')
  const workDir = join(root, 'work')
  const binDir = join(root, 'bin')
  const logFile = join(root, 'calls.log')
  const githubOutput = join(root, 'github_output.txt')
  const githubEnv = join(root, 'github_env.txt')
  mkdirSync(originDir, { recursive: true })
  mkdirSync(workDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })

  execFileSync('git', ['init', '--bare', originDir], { stdio: 'ignore' })
  execFileSync('git', ['init', '-b', 'main', workDir], { stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workDir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: workDir })
  if (autocrlfFalse) {
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: workDir })
  }
  const pkgObj = pkgOverride ?? approvedStablePackage({ version })
  writeFileSync(join(workDir, 'package.json'), JSON.stringify(pkgObj, null, 2))
  if (manifest !== undefined) writeFileSync(join(workDir, 'PUBLIC-RELEASE-MANIFEST.yml'), manifest, 'utf8')
  execFileSync('git', ['add', '.'], { cwd: workDir })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: workDir, stdio: 'ignore' })
  execFileSync('git', ['remote', 'add', 'origin', originDir], { cwd: workDir })
  execFileSync('git', ['push', 'origin', 'main'], { cwd: workDir, stdio: 'ignore' })

  const tarBytes = gzipSync(Buffer.from(`stub-tarball-${version}`))
  const artifactShasum = createHash('sha1').update(tarBytes).digest('hex')
  const artifactIntegrity = `sha512-${createHash('sha512').update(tarBytes).digest('base64')}`
  const artifactSource = join(root, `dsh-lcx-codex-${version}.tgz`)
  writeFileSync(artifactSource, tarBytes)

  const nodePath = process.execPath.replace(/\\/gu, '/')
  const npmStubJs = join(binDir, 'npm-stub.mjs')
  const ghStubJs = join(binDir, 'gh-stub.mjs')
  const fetchStubJs = join(binDir, 'fetch-stub.mjs')

  writeFileSync(
    npmStubJs,
    `
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(process.env.STUB_LOG, 'npm ' + args.join(' ') + '\\n')
const distTags = JSON.parse(process.env.STUB_NPM_TAGS || '{}')
if (args[0] === 'view') {
  const field = args[2] || ''
  if (field === 'dist-tags' && args.includes('--json')) {
    process.stdout.write(JSON.stringify(distTags) + '\\n')
  } else if (field.startsWith('dist-tags.')) {
    let cur = distTags
    for (const part of field.slice('dist-tags.'.length).split('.')) {
      cur = cur && typeof cur === 'object' ? cur[part] : undefined
    }
    if (typeof cur === 'string') process.stdout.write(cur + '\\n')
    else process.exit(1)
  } else {
    process.exit(1)
  }
}
`,
    'utf8',
  )

  writeFileSync(
    ghStubJs,
    `
import { appendFileSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
const args = process.argv.slice(2)
appendFileSync(process.env.STUB_LOG, 'gh ' + args.join(' ') + '\\n')
const existing = process.env.STUB_EXISTING_RELEASE === '1'
const raceCreate = process.env.STUB_RACE_CREATE === '1'
const runs = JSON.parse(process.env.STUB_PUBLISH_RUNS || '[]')
const defaultArtifactName = runs[0]?.id !== undefined && runs[0]?.run_attempt !== undefined
  ? 'verified-public-package-' + runs[0].id + '-' + runs[0].run_attempt
  : 'verified-public-package'
const artifacts = JSON.parse(
  process.env.STUB_ARTIFACTS || JSON.stringify([{ id: 8801, name: defaultArtifactName, expired: false }]),
)
function makeTestZip(entryName, payload, mode = 'stored') {
  if (mode === 'oversized-zip') {
    return Buffer.alloc(64 * 1024 * 1024 + 128 * 1024, 0x41)
  }
  const nameBuf = Buffer.from(entryName, 'utf8')
  const crc = crc32(payload) >>> 0
  const useDeflate = mode === 'deflate' || mode === 'deflate-data-descriptor' || mode === 'unsigned-dd' || mode === 'missing-dd' || mode === 'corrupt-dd' || mode === 'bit3-mismatch' || mode === 'nonzero-cd-disk' || mode === 'truncated-payload' || mode === 'corrupt-crc' || mode === 'wrong-uncompressed-size' || mode === 'oversized-bomb' || mode === 'real-bomb-small-header' || mode === 'deflate-trailing-garbage'
  const fullCompressed = (mode === 'oversized-bomb' || mode === 'real-bomb-small-header')
    ? deflateRawSync(Buffer.alloc(65 * 1024 * 1024, 0x41))
    : useDeflate
      ? deflateRawSync(payload)
      : payload
  const compressed = mode === 'truncated-payload'
    ? fullCompressed.subarray(0, Math.max(1, fullCompressed.length - 4))
    : mode === 'deflate-trailing-garbage'
      ? Buffer.concat([fullCompressed, Buffer.from([0xde, 0xad, 0xbe, 0xef])])
      : fullCompressed
  const declaredCompSize = mode === 'truncated-payload' ? fullCompressed.length : compressed.length
  const method = useDeflate ? 8 : 0
  const dataDescriptor = mode === 'deflate-data-descriptor' || mode === 'unsigned-dd' || mode === 'missing-dd' || mode === 'corrupt-dd'
  const cdFlags = dataDescriptor ? 0x08 : 0
  const lfhFlags = mode === 'bit3-mismatch' ? 0x08 : cdFlags
  const uncompSize = mode === 'oversized-bomb'
    ? 65 * 1024 * 1024
    : mode === 'oversized-header'
      ? 70 * 1024 * 1024
      : mode === 'real-bomb-small-header'
        ? 1024
        : mode === 'wrong-uncompressed-size'
          ? payload.length + 1
          : payload.length
  const cdCrc = mode === 'corrupt-crc' ? ((crc ^ 0xffffffff) >>> 0) : crc
  const lfhCrc = (lfhFlags & 0x08) !== 0 ? 0 : mode === 'lfh-mismatch' ? ((crc ^ 0x12345678) >>> 0) : cdCrc
  const lfhCompSize = (lfhFlags & 0x08) !== 0 ? 0 : declaredCompSize
  const lfhUncompSize = (lfhFlags & 0x08) !== 0 ? 0 : uncompSize
  let ddBuf = Buffer.alloc(0)
  if (mode === 'deflate-data-descriptor' || mode === 'corrupt-dd') {
    ddBuf = Buffer.alloc(16)
    ddBuf.writeUInt32LE(0x08074b50, 0)
    ddBuf.writeUInt32LE(mode === 'corrupt-dd' ? ((crc ^ 0xdeadbeef) >>> 0) : crc, 4)
    ddBuf.writeUInt32LE(declaredCompSize, 8)
    ddBuf.writeUInt32LE(uncompSize, 12)
  } else if (mode === 'unsigned-dd') {
    ddBuf = Buffer.alloc(12)
    ddBuf.writeUInt32LE(crc, 0)
    ddBuf.writeUInt32LE(declaredCompSize, 4)
    ddBuf.writeUInt32LE(uncompSize, 8)
  }

  const lfh = Buffer.alloc(30 + nameBuf.length)
  lfh.writeUInt32LE(0x04034b50, 0)
  lfh.writeUInt16LE(20, 4)
  lfh.writeUInt16LE(lfhFlags, 6)
  lfh.writeUInt16LE(method, 8)
  lfh.writeUInt32LE(lfhCrc, 14)
  lfh.writeUInt32LE(lfhCompSize, 18)
  lfh.writeUInt32LE(lfhUncompSize, 22)
  lfh.writeUInt16LE(nameBuf.length, 26)
  nameBuf.copy(lfh, 30)

  const cdh = Buffer.alloc(46 + nameBuf.length)
  cdh.writeUInt32LE(0x02014b50, 0)
  cdh.writeUInt16LE(20, 4)
  cdh.writeUInt16LE(20, 6)
  cdh.writeUInt16LE(cdFlags, 8)
  cdh.writeUInt16LE(method, 10)
  cdh.writeUInt32LE(cdCrc, 16)
  cdh.writeUInt32LE(declaredCompSize, 20)
  cdh.writeUInt32LE(uncompSize, 24)
  cdh.writeUInt16LE(nameBuf.length, 28)
  if (mode === 'nonzero-cd-disk') cdh.writeUInt16LE(1, 34)
  cdh.writeUInt32LE(mode === 'oob-offset' ? (lfh.length + compressed.length + 100) : 0, 42)
  nameBuf.copy(cdh, 46)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  const cdGap = mode === 'cd-eocd-gap' ? Buffer.from('GAP!') : Buffer.alloc(0)
  eocd.writeUInt32LE(cdh.length, 12)
  eocd.writeUInt32LE(lfh.length + compressed.length + ddBuf.length, 16)
  return Buffer.concat([lfh, compressed, ddBuf, cdh, cdGap, eocd])
}
if (args[0] === 'release' && args[1] === 'view') {
  if (existing || process.env.STUB_CREATED === '1') process.exit(0)
  process.exit(1)
}
if (args[0] === 'release' && args[1] === 'create') {
  if (raceCreate) {
    process.env.STUB_CREATED = '1'
    process.exit(1)
  }
  process.exit(0)
}
if (args[0] === 'run' && args[1] === 'download') {
  const dIdx = args.indexOf('-D')
  const destDir = dIdx !== -1 ? args[dIdx + 1] : '.'
  mkdirSync(destDir, { recursive: true })
  const ver = process.env.STUB_ARTIFACT_VERSION || '${version}'
  copyFileSync(process.env.STUB_ARTIFACT_FILE, join(destDir, 'dsh-lcx-codex-' + ver + '.tgz'))
  process.exit(0)
}
if (args[0] === 'api') {
  const endpoint = args[1] || ''
  if (endpoint.includes('/releases/tags/')) {
    process.stdout.write('false\\n')
  } else if (endpoint.endsWith('/actions/workflows/publish.yml')) {
    process.stdout.write(JSON.stringify({
      id: Number(process.env.STUB_PUBLISH_WORKFLOW_ID || 777),
      path: process.env.STUB_PUBLISH_WORKFLOW_PATH || '.github/workflows/publish.yml',
    }) + '\\n')
  } else if (endpoint.includes('/actions/workflows/publish.yml/runs')) {
    process.stdout.write(JSON.stringify({ workflow_runs: runs }) + '\\n')
  } else if (/\\/actions\\/runs\\/\\d+\\/artifacts(?:\\?.*)?$/u.test(endpoint)) {
    process.stdout.write(JSON.stringify({ artifacts }) + '\\n')
  } else if (/\\/actions\\/artifacts\\/(\\d+)\\/zip$/u.test(endpoint)) {
    const m = /\\/actions\\/artifacts\\/(\\d+)\\/zip$/u.exec(endpoint)
    const art = artifacts.find((a) => String(a.id) === m[1] && a.expired !== true)
    if (!art) process.exit(1)
    const ver = process.env.STUB_ARTIFACT_VERSION || '${version}'
    const payload = readFileSync(process.env.STUB_ARTIFACT_FILE)
    process.stdout.write(makeTestZip('dsh-lcx-codex-' + ver + '.tgz', payload, process.env.STUB_ZIP_MODE || 'stored'))
  } else if (/\\/actions\\/runs\\/(\\d+)\\/attempts\\/(\\d+)$/u.test(endpoint)) {
    const m = /\\/actions\\/runs\\/(\\d+)\\/attempts\\/(\\d+)$/u.exec(endpoint)
    const found = runs.find((r) => String(r.id) === m[1] && String(r.run_attempt) === m[2])
    if (!found) process.exit(1)
    process.stdout.write(JSON.stringify(found) + '\\n')
  } else if (/\\/actions\\/runs\\/\\d+$/u.test(endpoint)) {
    const id = Number(endpoint.slice(endpoint.lastIndexOf('/') + 1))
    const found = runs.find((r) => r.id === id) || runs[0] || {}
    process.stdout.write(JSON.stringify(found) + '\\n')
  }
}
`,
    'utf8',
  )

  writeFileSync(
    fetchStubJs,
    `
const origFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://registry.npmjs.org/dsh-lcx-codex/')) {
    const status = Number.parseInt(process.env.STUB_FETCH_STATUS || '200', 10)
    const body = process.env.STUB_FETCH_BODY || JSON.stringify({
      dist: {
        shasum: process.env.STUB_REGISTRY_SHASUM,
        integrity: process.env.STUB_REGISTRY_INTEGRITY,
      },
    })
    return new Response(body, { status, headers: { 'content-type': 'application/json' } })
  }
  return origFetch(url, init)
}
`,
    'utf8',
  )

  const npmSh = join(binDir, 'npm')
  const ghSh = join(binDir, 'gh')
  writeFileSync(npmSh, `#!/bin/sh\nexec "${nodePath}" "${npmStubJs.replace(/\\/gu, '/')}" "$@"\n`, 'utf8')
  writeFileSync(ghSh, `#!/bin/sh\nexec "${nodePath}" "${ghStubJs.replace(/\\/gu, '/')}" "$@"\n`, 'utf8')
  if (process.platform !== 'win32') {
    chmodSync(npmSh, 0o755)
    chmodSync(ghSh, 0o755)
  }

  const resolveScript = join(root, 'step-resolve.sh')
  const policyScript = join(root, 'step-policy.sh')
  const evidenceScript = join(root, 'step-evidence.sh')
  const releaseScript = join(root, 'step-release.sh')
  writeFileSync(resolveScript, extractStepRunBlock(workflowText, 'Resolve canonical release tag'), 'utf8')
  writeFileSync(policyScript, extractStepRunBlock(workflowText, 'Validate tagged package, full release policy, and target branch ancestry'), 'utf8')
  writeFileSync(evidenceScript, extractStepRunBlock(workflowText, 'Verify Publish to npm run and verified-public-package artifact'), 'utf8')
  writeFileSync(releaseScript, extractStepRunBlock(workflowText, 'Verify registry convergence and create or validate GitHub Release'), 'utf8')

  const execStep = (scriptFile, extraEnv) => {
    const sep = process.platform === 'win32' ? ';' : ':'
    writeFileSync(githubOutput, '', 'utf8')
    const out = execFileSync(findBash(), [scriptFile], {
      cwd: workDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}${sep}${dirname(process.execPath)}${sep}${process.env.PATH ?? ''}`,
        NODE_OPTIONS: `--import=${pathToFileURL(fetchStubJs).href}`,
        GITHUB_REPOSITORY: 'kk3ya03-star/dsh-lcx-codex',
        GITHUB_TOKEN: 'stub-token',
        GITHUB_OUTPUT: githubOutput,
        GITHUB_ENV: githubEnv,
        STUB_LOG: logFile,
        STUB_ARTIFACT_FILE: artifactSource,
        STUB_ARTIFACT_VERSION: version,
        STUB_REGISTRY_SHASUM: artifactShasum,
        STUB_REGISTRY_INTEGRITY: artifactIntegrity,
        LCX_CONVERGE_ATTEMPTS: '1',
        LCX_CONVERGE_SLEEP_SEC: '0',
        ...extraEnv,
      },
    })
    return {
      stdout: out,
      outputs: parseKeyValueFile(githubOutput),
    }
  }

  return {
    root,
    workDir,
    logFile,
    artifactShasum,
    artifactIntegrity,
    runResolve: (env = {}) => {
      writeFileSync(githubEnv, '', 'utf8')
      return execStep(resolveScript, env)
    },
    runFinalize: (envOverrides = {}) => {
      writeFileSync(githubEnv, '', 'utf8')
      const resolved = execStep(resolveScript, envOverrides)
      if (resolved.outputs.applicable !== 'true') {
        return { resolved, skipped: true, stdout: resolved.stdout }
      }
      const policy = execStep(policyScript, {
        ...envOverrides,
        TAG: resolved.outputs.tag,
      })
      const defaultRuns = [
        {
          id: Number(envOverrides.WORKFLOW_RUN_ID || 4242),
          run_attempt: Number(envOverrides.WORKFLOW_RUN_ATTEMPT || 1),
          workflow_id: 777,
          path: '.github/workflows/publish.yml',
          event: 'push',
          name: 'Publish to npm',
          conclusion: 'success',
          head_sha: policy.outputs.target_sha,
          head_branch: policy.outputs.tag,
        },
      ]
      const isWorkflowRun = (envOverrides.EVENT_NAME ?? 'workflow_run') === 'workflow_run'
      const evidenceEnv = {
        ...(isWorkflowRun ? { WORKFLOW_RUN_ID: '4242', WORKFLOW_RUN_ATTEMPT: '1' } : {}),
        STUB_PUBLISH_RUNS: JSON.stringify(defaultRuns),
        ...envOverrides,
        TAG: policy.outputs.tag,
        VERSION: policy.outputs.version,
        TARGET_SHA: policy.outputs.target_sha,
      }
      const evidence = execStep(evidenceScript, evidenceEnv)
      const release = execStep(releaseScript, {
        ...envOverrides,
        TAG: policy.outputs.tag,
        VERSION: policy.outputs.version,
        TARGET_BRANCH: policy.outputs.target_branch,
        DIST_TAG: policy.outputs.dist_tag,
        STABLE_REMAIN: policy.outputs.stable_latest_remain,
        ARTIFACT_SHASUM: evidence.outputs.artifact_shasum,
        ARTIFACT_INTEGRITY: evidence.outputs.artifact_integrity,
      })
      return {
        resolved,
        policy,
        evidence,
        release,
        skipped: false,
        stdout: [resolved.stdout, policy.stdout, evidence.stdout, release.stdout].join('\n'),
      }
    },
  }
}

test('P1-4, P3-1 & P1-2: finalize & publish workflow YAMLs have two-job canonical concurrency, no shell eval, safety guard, and pack:local', () => {
  assert.match(workflowText, /workflow_run:\s*\r?\n\s+workflows:\s*\["Publish to npm"\]/u)
  assert.match(workflowText, /workflow_dispatch:/u)
  assert.match(workflowText, /resolve:/u)
  assert.match(workflowText, /finalize:\s*\r?\n\s+needs:\s*resolve/u)
  assert.match(workflowText, /group:\s*finalize-stable-\$\{\{\s*github\.repository\s*\}\}-\$\{\{\s*needs\.resolve\.outputs\.tag\s*\}\}/u)
  assert.match(workflowText, /actions:\s*read/u)
  assert.doesNotMatch(workflowText, /\beval\s+"/u, 'finalize workflow must never run shell eval on manifest contents')
  assert.match(workflowText, /github\.repository == 'kk3ya03-star\/dsh-lcx-codex'/u)
  assert.match(workflowText, /--verify-tag/u)
  assert.match(workflowText, /--latest=false/u)

  assert.match(publishWorkflowText, /group:\s*npm-publish-\$\{\{\s*github\.repository\s*\}\}/u)
  assert.match(publishWorkflowText, /queue:\s*max/u)
  assert.match(publishWorkflowText, /github\.repository == 'kk3ya03-star\/dsh-lcx-codex'/u)
  assert.match(publishWorkflowText, /assertReleasePolicy/u)
  assert.match(publishWorkflowText, /npm run pack:local/u)
  assert.match(publishWorkflowText, /verified-public-package/u)
  assert.match(publishWorkflowText, /npm publish --provenance --access public --tag/u)
  assert.doesNotMatch(publishWorkflowText, /npm pack(?:\s|$)/u, 'publish.yml must use curated pack:local rather than raw npm pack')
  assert.doesNotMatch(publishWorkflowText, /\bmapfile\b/u)
})

test('P1-D & P3-1: workflow_run and workflow_dispatch resolve identical canonical bare tag and finalize main release', (t) => {
  const env = setupWorkflowRepo(t, {
    version: '0.7.0',
    manifest: approvedStableManifest({ version: '0.7.0' }),
  })
  const tagSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: env.workDir, encoding: 'utf8' }).trim()
  execFileSync('git', ['tag', 'v0.7.0'], { cwd: env.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: env.workDir, stdio: 'ignore' })

  const autoResolved = env.runResolve({
    EVENT_NAME: 'workflow_run',
    WORKFLOW_RUN_SHA: tagSha,
    WORKFLOW_RUN_BRANCH: 'v0.7.0',
  })
  const manualResolved = env.runResolve({
    EVENT_NAME: 'workflow_dispatch',
    DISPATCH_TAG: 'v0.7.0',
  })
  assert.equal(autoResolved.outputs.applicable, 'true')
  assert.equal(autoResolved.outputs.tag, 'v0.7.0')
  assert.equal(manualResolved.outputs.tag, autoResolved.outputs.tag)

  env.runFinalize({
    EVENT_NAME: 'workflow_run',
    WORKFLOW_RUN_SHA: tagSha,
    WORKFLOW_RUN_BRANCH: 'v0.7.0',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
    STUB_EXISTING_RELEASE: '0',
  })
  const calls = readFileSync(env.logFile, 'utf8')
  assert.match(calls, /gh release create v0\.7\.0 --verify-tag .* --latest(?:\s|$)/u)
  assert.doesNotMatch(calls, /--latest=false/u)
})

test('P1-2, P1-3, P1-4 & P2-3: rejects missing manifest, full-policy/runtime/pkg mismatch, BLOCKED/PENDING, strict YAML errors, missing Publish run/artifact, digest mismatch, and ignores shell metacharacters', (t) => {
  const missingEnv = setupWorkflowRepo(t, { version: '0.7.0', manifest: undefined })
  const missingSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: missingEnv.workDir, encoding: 'utf8' }).trim()
  execFileSync('git', ['tag', 'v0.7.0'], { cwd: missingEnv.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: missingEnv.workDir, stdio: 'ignore' })
  assert.throws(() =>
    missingEnv.runFinalize({
      EVENT_NAME: 'workflow_run',
      WORKFLOW_RUN_SHA: missingSha,
      WORKFLOW_RUN_BRANCH: 'v0.7.0',
      STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
    }),
  )
  assert.equal(existsSync(missingEnv.logFile), false)

  for (const [label, manifest, pkgOverride] of [
    ['BLOCKED publication', approvedStableManifest({ version: '0.7.0', publicationState: 'BLOCKED' })],
    ['PENDING_CONTROLLER_APPROVAL', approvedStableManifest({ version: '0.7.0', productOwner: 'PENDING_CONTROLLER_APPROVAL' })],
    ['quoted PENDING_CONTROLLER_APPROVAL', approvedStableManifest({ version: '0.7.0', productOwner: '"PENDING_CONTROLLER_APPROVAL" # pending' })],
    ['REVIEW_ONLY state', approvedStableManifest({ version: '0.7.0', state: 'REVIEW_ONLY' })],
    ['duplicate top-level key', `${approvedStableManifest({ version: '0.7.0' })}\nstate: REVIEW_ONLY`],
    ['duplicate section key', `${approvedStableManifest({ version: '0.7.0' })}\n  state: BLOCKED`],
    ['duplicate inline list key in source', approvedStableManifest({ version: '0.7.0', extraSourceLines: '  engineering_issues: [132]' })],
    ['null scalar', approvedStableManifest({ version: '0.7.0', productOwner: 'null' })],
    ['boolean scalar', approvedStableManifest({ version: '0.7.0', productOwner: 'true' })],
    ['inline mapping collection', approvedStableManifest({ version: '0.7.0', publicationState: '{ ok: true }' })],
    ['blank quoted product_owner', approvedStableManifest({ version: '0.7.0', productOwner: '""' })],
    ['wrong package name', approvedStableManifest({ version: '0.7.0' }), approvedStablePackage({ version: '0.7.0', name: 'evil-fork-pkg' })],
    ['wrong runtime_basis dsh', approvedStableManifest({ version: '0.7.0', dsh: '0.1.5-alpha.2' })],
    ['missing previous_latest_must_be', approvedStableManifest({ version: '0.7.0', previousLatest: null })],
    ['bad dshInstallRange ceiling', approvedStableManifest({ version: '0.7.0', installRange: '>=0.2.2-rc.5 <0.2.3' }), approvedStablePackage({ version: '0.7.0', installRange: '>=0.2.2-rc.5 <0.2.3' })],
    ['shell metacharacters in approval', approvedStableManifest({ version: '0.7.0', extraApprovalLines: '  reference: "$(touch pwned)"' })],
  ]) {
    const testEnv = setupWorkflowRepo(t, { version: '0.7.0', manifest, pkgOverride })
    const badSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: testEnv.workDir, encoding: 'utf8' }).trim()
    execFileSync('git', ['tag', 'v0.7.0'], { cwd: testEnv.workDir })
    execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: testEnv.workDir, stdio: 'ignore' })
    if (label === 'shell metacharacters in approval') {
      testEnv.runFinalize({
        EVENT_NAME: 'workflow_run',
        WORKFLOW_RUN_SHA: badSha,
        WORKFLOW_RUN_BRANCH: 'v0.7.0',
        STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
      })
      assert.equal(existsSync(join(testEnv.workDir, 'pwned')), false, 'shell metacharacters in manifest must never execute')
    } else {
      assert.throws(() =>
        testEnv.runFinalize({
          EVENT_NAME: 'workflow_run',
          WORKFLOW_RUN_SHA: badSha,
          WORKFLOW_RUN_BRANCH: 'v0.7.0',
          STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
        }), undefined, label)
      assert.equal(existsSync(testEnv.logFile), false, `${label} must fail before gh/npm`)
    }
  }

  // P1-2: manual workflow_dispatch MUST fail if no matching Publish to npm run, missing artifact, or registry digest mismatch!
  const dispatchEnv = setupWorkflowRepo(t, {
    version: '0.7.0',
    manifest: approvedStableManifest({ version: '0.7.0' }),
  })
  const dispatchSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dispatchEnv.workDir, encoding: 'utf8' }).trim()
  execFileSync('git', ['tag', 'v0.7.0'], { cwd: dispatchEnv.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: dispatchEnv.workDir, stdio: 'ignore' })

  assert.throws(() =>
    dispatchEnv.runFinalize({
      EVENT_NAME: 'workflow_dispatch',
      DISPATCH_TAG: 'v0.7.0',
      STUB_PUBLISH_RUNS: JSON.stringify([]),
      STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
    }),
  /No successful canonical \.github\/workflows\/publish\.yml push run/u)

  assert.throws(() =>
    dispatchEnv.runFinalize({
      EVENT_NAME: 'workflow_dispatch',
      DISPATCH_TAG: 'v0.7.0',
      STUB_ARTIFACTS: JSON.stringify([]),
      STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
    }),
  /must contain exactly 1 active verified-public-package-4242-1 artifact/u)

  assert.throws(() =>
    dispatchEnv.runFinalize({
      EVENT_NAME: 'workflow_dispatch',
      DISPATCH_TAG: 'v0.7.0',
      STUB_REGISTRY_SHASUM: '0000000000000000000000000000000000000000',
      STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
    }),
  /mismatches verified artifact/u)

  // With matching Publish to npm run + verified artifact digest -> succeeds cleanly!
  dispatchEnv.runFinalize({
    EVENT_NAME: 'workflow_dispatch',
    DISPATCH_TAG: 'v0.7.0',
    STUB_PUBLISH_RUNS: JSON.stringify([
      {
        id: 9001,
        run_attempt: 1,
        workflow_id: 777,
        path: '.github/workflows/publish.yml',
        event: 'push',
        name: 'Publish to npm',
        conclusion: 'success',
        head_sha: dispatchSha,
        head_branch: 'v0.7.0',
      },
    ]),
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
  })
  assert.match(readFileSync(dispatchEnv.logFile, 'utf8'), /gh release create v0\.7\.0/u)
})

test('Round 6 P2-1, P2-3 & P2-4: workflow_run & workflow_dispatch reject spoofed workflow_id/path/event; finalizer policy rejects missing colon whitespace, inactive channel fields, and missing SemVer', (t) => {
  const env = setupWorkflowRepo(t, {
    version: '0.7.0',
    manifest: approvedStableManifest({ version: '0.7.0' }),
  })
  const tagSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: env.workDir, encoding: 'utf8' }).trim()
  execFileSync('git', ['tag', 'v0.7.0'], { cwd: env.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: env.workDir, stdio: 'ignore' })

  for (const spoofRun of [
    { id: 9010, run_attempt: 1, workflow_id: 999, path: '.github/workflows/publish.yml', event: 'push', name: 'Publish to npm', conclusion: 'success', head_sha: tagSha, head_branch: 'v0.7.0' },
    { id: 9011, run_attempt: 1, workflow_id: 777, path: '.github/workflows/spoof.yml', event: 'push', name: 'Publish to npm', conclusion: 'success', head_sha: tagSha, head_branch: 'v0.7.0' },
    { id: 9012, run_attempt: 1, workflow_id: 777, path: '.github/workflows/publish.yml', event: 'workflow_dispatch', name: 'Publish to npm', conclusion: 'success', head_sha: tagSha, head_branch: 'v0.7.0' },
  ]) {
    assert.throws(
      () =>
        env.runFinalize({
          EVENT_NAME: 'workflow_dispatch',
          DISPATCH_TAG: 'v0.7.0',
          STUB_PUBLISH_RUNS: JSON.stringify([spoofRun]),
          STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
        }),
      /No successful canonical \.github\/workflows\/publish\.yml push run/u,
    )
    assert.throws(() =>
      env.runFinalize({
        EVENT_NAME: 'workflow_run',
        WORKFLOW_RUN_ID: String(spoofRun.id),
        WORKFLOW_RUN_SHA: tagSha,
        WORKFLOW_RUN_BRANCH: 'v0.7.0',
        STUB_PUBLISH_RUNS: JSON.stringify([spoofRun]),
        STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
      }),
    )
  }

  assert.throws(() =>
    env.runFinalize({
      EVENT_NAME: 'workflow_run',
      WORKFLOW_RUN_ID: '9013',
      WORKFLOW_RUN_SHA: tagSha,
      WORKFLOW_RUN_BRANCH: 'v0.7.0',
      STUB_PUBLISH_WORKFLOW_PATH: '.github/workflows/spoof.yml',
      STUB_PUBLISH_RUNS: JSON.stringify([
        { id: 9013, run_attempt: 1, workflow_id: 777, path: '.github/workflows/publish.yml', event: 'push', name: 'Publish to npm', conclusion: 'success', head_sha: tagSha, head_branch: 'v0.7.0' },
      ]),
      STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
    }),
  )

  const noColonEnv = setupWorkflowRepo(t, {
    version: '0.7.0',
    manifest: approvedStableManifest({ version: '0.7.0' }).replace(/^ {2}product_owner: .+$/m, '  product_owner:Reviewer approved'),
  })
  const noColonSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: noColonEnv.workDir, encoding: 'utf8' }).trim()
  execFileSync('git', ['tag', 'v0.7.0'], { cwd: noColonEnv.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: noColonEnv.workDir, stdio: 'ignore' })
  assert.throws(() =>
    noColonEnv.runFinalize({
      EVENT_NAME: 'workflow_run',
      WORKFLOW_RUN_SHA: noColonSha,
      WORKFLOW_RUN_BRANCH: 'v0.7.0',
    }),
  )

  const inactiveFieldEnv = setupWorkflowRepo(t, {
    version: '0.7.0',
    manifest: approvedStableManifest({ version: '0.7.0' }).replace(/^ {2}previous_latest_must_be: .+$/m, '  previous_latest_must_be: 0.6.0\n  stable_latest_must_remain: 0.6.0'),
  })
  const inactiveSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: inactiveFieldEnv.workDir, encoding: 'utf8' }).trim()
  execFileSync('git', ['tag', 'v0.7.0'], { cwd: inactiveFieldEnv.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: inactiveFieldEnv.workDir, stdio: 'ignore' })
  assert.throws(() =>
    inactiveFieldEnv.runFinalize({
      EVENT_NAME: 'workflow_run',
      WORKFLOW_RUN_SHA: inactiveSha,
      WORKFLOW_RUN_BRANCH: 'v0.7.0',
    }),
  )

  const noHostPiPkg = approvedStablePackage({ version: '0.7.0' })
  delete noHostPiPkg.lcxCompatibility.verifiedHostPi
  const noHostPiEnv = setupWorkflowRepo(t, {
    version: '0.7.0',
    pkgOverride: noHostPiPkg,
    manifest: approvedStableManifest({ version: '0.7.0' }).replace(/^ {2}host_pi: .+\r?\n/m, ''),
  })
  const noHostPiSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: noHostPiEnv.workDir, encoding: 'utf8' }).trim()
  execFileSync('git', ['tag', 'v0.7.0'], { cwd: noHostPiEnv.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: noHostPiEnv.workDir, stdio: 'ignore' })
  assert.throws(() =>
    noHostPiEnv.runFinalize({
      EVENT_NAME: 'workflow_run',
      WORKFLOW_RUN_SHA: noHostPiSha,
      WORKFLOW_RUN_BRANCH: 'v0.7.0',
    }),
  )

  // Round 7 P1-1, P2-1 & P2-2: ref-qualified run.path positive/negative across BOTH workflow_run & workflow_dispatch,
  // unequal valid SemVer Pi versions, and NBSP (\u00a0) rejection
  for (const refQualifiedPath of ['.github/workflows/publish.yml@v0.7.0', '.github/workflows/publish.yml@refs/tags/v0.7.0']) {
    const wfDispatchRef = setupWorkflowRepo(t, { version: '0.7.0', manifest: approvedStableManifest({ version: '0.7.0' }) })
    const shaA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wfDispatchRef.workDir, encoding: 'utf8' }).trim()
    execFileSync('git', ['tag', 'v0.7.0'], { cwd: wfDispatchRef.workDir })
    execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: wfDispatchRef.workDir, stdio: 'ignore' })
    wfDispatchRef.runFinalize({
      EVENT_NAME: 'workflow_dispatch',
      DISPATCH_TAG: 'v0.7.0',
      STUB_PUBLISH_RUNS: JSON.stringify([
        { id: 9020, run_attempt: 1, workflow_id: 777, path: refQualifiedPath, event: 'push', name: 'Publish to npm', conclusion: 'success', head_sha: shaA, head_branch: 'v0.7.0' },
      ]),
      STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
    })
    assert.match(readFileSync(wfDispatchRef.logFile, 'utf8'), /gh release create v0\.7\.0/u)

    const wfRunRef = setupWorkflowRepo(t, { version: '0.7.0', manifest: approvedStableManifest({ version: '0.7.0' }) })
    const shaB = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wfRunRef.workDir, encoding: 'utf8' }).trim()
    execFileSync('git', ['tag', 'v0.7.0'], { cwd: wfRunRef.workDir })
    execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: wfRunRef.workDir, stdio: 'ignore' })
    wfRunRef.runFinalize({
      EVENT_NAME: 'workflow_run',
      WORKFLOW_RUN_ID: '9021',
      WORKFLOW_RUN_SHA: shaB,
      WORKFLOW_RUN_BRANCH: 'v0.7.0',
      STUB_PUBLISH_RUNS: JSON.stringify([
        { id: 9021, run_attempt: 1, workflow_id: 777, path: refQualifiedPath, event: 'push', name: 'Publish to npm', conclusion: 'success', head_sha: shaB, head_branch: 'v0.7.0' },
      ]),
      STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
    })
    assert.match(readFileSync(wfRunRef.logFile, 'utf8'), /gh release create v0\.7\.0/u)
  }

  for (const badRefPath of [
    '.github/workflows/publish.yml@v0.6.0',
    '.github/workflows/publish.yml@refs/heads/main',
    '.github/workflows/publish.yml@',
  ]) {
    const spoofRefRun = {
      id: 9022,
      run_attempt: 1,
      workflow_id: 777,
      path: badRefPath,
      event: 'push',
      name: 'Publish to npm',
      conclusion: 'success',
      head_sha: tagSha,
      head_branch: 'v0.7.0',
    }
    assert.throws(
      () =>
        env.runFinalize({
          EVENT_NAME: 'workflow_dispatch',
          DISPATCH_TAG: 'v0.7.0',
          STUB_PUBLISH_RUNS: JSON.stringify([spoofRefRun]),
          STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
        }),
      /No successful canonical \.github\/workflows\/publish\.yml push run/u,
    )
    assert.throws(() =>
      env.runFinalize({
        EVENT_NAME: 'workflow_run',
        WORKFLOW_RUN_ID: '9022',
        WORKFLOW_RUN_SHA: tagSha,
        WORKFLOW_RUN_BRANCH: 'v0.7.0',
        STUB_PUBLISH_RUNS: JSON.stringify([spoofRefRun]),
        STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
      }),
    )
  }

  const piMismatchPkg = approvedStablePackage({ version: '0.7.0', hostPi: '1.6.1' })
  const piMismatchEnv = setupWorkflowRepo(t, {
    version: '0.7.0',
    pkgOverride: piMismatchPkg,
    manifest: approvedStableManifest({ version: '0.7.0', hostPi: '1.6.1' }),
  })
  const piMismatchSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: piMismatchEnv.workDir, encoding: 'utf8' }).trim()
  execFileSync('git', ['tag', 'v0.7.0'], { cwd: piMismatchEnv.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: piMismatchEnv.workDir, stdio: 'ignore' })
  assert.throws(() =>
    piMismatchEnv.runFinalize({
      EVENT_NAME: 'workflow_run',
      WORKFLOW_RUN_SHA: piMismatchSha,
      WORKFLOW_RUN_BRANCH: 'v0.7.0',
    }),
  )

  for (const [nbspLabel, mutator] of [
    ['NBSP after colon', (m) => m.replace(/^ {2}product_owner: .+$/m, '  product_owner:\u00a0private-issue-131-po-approved-2026-11-22')],
    ['NBSP after top-level colon', (m) => m.replace(/^state: .+$/m, 'state:\u00a0APPROVED_STABLE')],
    ['NBSP indentation', (m) => m.replace(/^ {2}branch: .+$/m, '\u00a0\u00a0branch: main')],
    ['NBSP before scalar', (m) => m.replace(/^ {2}product_owner: .+$/m, '  product_owner: \u00a0private-issue-131-po-approved-2026-11-22')],
    ['NEL U+0085 after colon', (m) => m.replace(/^ {2}product_owner: .+$/m, '  product_owner:\u0085private-issue-131-po-approved-2026-11-22')],
    ['NEL U+0085 after top-level colon', (m) => m.replace(/^state: .+$/m, 'state:\u0085APPROVED_STABLE')],
    ['NEL U+0085 indentation', (m) => m.replace(/^ {2}branch: .+$/m, '\u0085\u0085branch: main')],
    ['NEL U+0085 before unquoted scalar', (m) => m.replace(/^ {2}product_owner: .+$/m, '  product_owner: \u0085private-issue-131-po-approved-2026-11-22')],
    ['BOM U+FEFF before unquoted scalar', (m) => m.replace(/^ {2}product_owner: .+$/m, '  product_owner: \ufeffpo-approved')],
    ['BOM U+FEFF at file start', (m) => `\ufeff${m}`],
    ['BOM-only quoted product_owner', (m) => m.replace(/^ {2}product_owner: .+$/m, '  product_owner: "\ufeff"')],
    ['Unicode whitespace-only quoted product_owner', (m) => m.replace(/^ {2}product_owner: .+$/m, '  product_owner: "\u0085\u00a0"')],
  ]) {
    const nbspEnv = setupWorkflowRepo(t, {
      version: '0.7.0',
      manifest: mutator(approvedStableManifest({ version: '0.7.0' })),
    })
    const nbspSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: nbspEnv.workDir, encoding: 'utf8' }).trim()
    execFileSync('git', ['tag', 'v0.7.0'], { cwd: nbspEnv.workDir })
    execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: nbspEnv.workDir, stdio: 'ignore' })
    assert.throws(
      () =>
        nbspEnv.runFinalize({
          EVENT_NAME: 'workflow_run',
          WORKFLOW_RUN_SHA: nbspSha,
          WORKFLOW_RUN_BRANCH: 'v0.7.0',
        }),
      undefined,
      `Expected finalizer rejection for ${nbspLabel}`,
    )
  }

  // Round 8 & 9 P1-1/P1-2: reject template placeholders, explicit denials, APPROVED_REQUIRED, po-never-approved,
  // TL_ACCEPTED_HOLD, missing required bindings, source flow-list bypass, and stale version/issue approvals
  for (const [badApprovalLabel, overrides] of [
    ['template placeholder required', { productOwner: 'required' }],
    ['APPROVED_REQUIRED product_owner', { productOwner: 'APPROVED_REQUIRED' }],
    ['po-never-approved product_owner', { productOwner: 'po-never-approved' }],
    ['explicit denial REJECTED', { productOwner: 'REJECTED' }],
    ['explicit denial UNAPPROVED', { productOwner: 'UNAPPROVED' }],
    ['negated po-not-approved', { productOwner: 'po-not-approved' }],
    ['stale issue in product_owner', { productOwner: 'private-issue-129-po-approved-2026-11-04' }],
    ['stale #129 approval without issue fields', { engineeringIssue: null, productOwner: 'private-issue-129-po-approved-2026-11-04' }],
    ['stale issue in approval_reference', { extraApprovalLines: '  approval_reference: docs/qa/issue-129/PRODUCT-OWNER-APPROVAL.md' }],
    ['pending controller_review', { controllerReview: 'PENDING' }],
    ['missing controller_review', { controllerReview: null }],
    ['TL_ACCEPTED_HOLD controller_review', { controllerReview: 'TL_ACCEPTED_HOLD' }],
    ['rejected controller_review', { controllerReview: 'TL_REJECTED' }],
    ['pending tl_reviewed_product_commit', { tlReviewedProductCommit: 'PENDING' }],
    ['missing tl_reviewed_product_commit', { tlReviewedProductCommit: null }],
    ['short tl_reviewed_product_commit', { tlReviewedProductCommit: 'deadbeef' }],
    ['mismatched source.product_commit', { extraSourceLines: '  product_commit: ffffffffffffffffffffffffffffffffffffffff' }],
    ['source.product_commit flow-list bypass', { extraSourceLines: '  product_commit: [abc]' }],
    ['stale approved_version', { approvedVersion: '0.6.0' }],
    ['missing approved_version', { approvedVersion: null }],
    ['missing approval.work_branch', { approvalWorkBranch: null }],
    ['mismatched approval.engineering_issue', { extraSourceLines: '  engineering_issue: 131', engineeringIssue: null, extraApprovalLines: '  engineering_issue: 129' }],
  ]) {
    const badApprovalEnv = setupWorkflowRepo(t, {
      version: '0.7.0',
      manifest: approvedStableManifest({ version: '0.7.0', ...overrides }),
    })
    const badApprovalSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: badApprovalEnv.workDir, encoding: 'utf8' }).trim()
    execFileSync('git', ['tag', 'v0.7.0'], { cwd: badApprovalEnv.workDir })
    execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: badApprovalEnv.workDir, stdio: 'ignore' })
    assert.throws(
      () =>
        badApprovalEnv.runFinalize({
          EVENT_NAME: 'workflow_run',
          WORKFLOW_RUN_SHA: badApprovalSha,
          WORKFLOW_RUN_BRANCH: 'v0.7.0',
        }),
      undefined,
      `Expected finalizer rejection for ${badApprovalLabel}`,
    )
  }
})

test('P3-2 & P3-3: prerelease workflow_run is inert while malformed manual workflow_dispatch tag (including refs/tags/ and leading zero) fails loudly', (t) => {
  const env = setupWorkflowRepo(t, {
    version: '0.7.0-pre.1',
    manifest: approvedStableManifest({ version: '0.7.0-pre.1', state: 'APPROVED_PRERELEASE', tag: 'v0.7.0-pre.1', distTag: 'prelatest' }),
  })
  const tagSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: env.workDir, encoding: 'utf8' }).trim()
  execFileSync('git', ['tag', 'v0.7.0-pre.1'], { cwd: env.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.0-pre.1'], { cwd: env.workDir, stdio: 'ignore' })

  const result = env.runFinalize({
    EVENT_NAME: 'workflow_run',
    WORKFLOW_RUN_SHA: tagSha,
    WORKFLOW_RUN_BRANCH: 'v0.7.0-pre.1',
  })
  assert.equal(result.skipped, true)
  assert.equal(result.resolved.outputs.applicable, 'false')
  assert.equal(result.resolved.outputs.tag, 'inert')
  assert.match(result.stdout, /Non-stable tag v0\.7\.0-pre\.1; stable finalizer is inert/u)
  assert.equal(existsSync(env.logFile), false)

  for (const badManualTag of ['refs/tags/v0.7.0', 'v01.0.0', 'v0.07.0', 'v0.7.o', 'v0.7.0-pre.1', 'not-a-tag', '']) {
    assert.throws(() =>
      env.runFinalize({
        EVENT_NAME: 'workflow_dispatch',
        DISPATCH_TAG: badManualTag,
      }), undefined, `manual dispatch must reject ${badManualTag}`)
  }
})

test('P1-F: tag-first finalization reads package.json and manifest from peeled tag commit even after branch moves ahead', (t) => {
  const env = setupWorkflowRepo(t, {
    version: '0.7.0',
    manifest: approvedStableManifest({ version: '0.7.0' }),
  })
  execFileSync('git', ['tag', 'v0.7.0'], { cwd: env.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: env.workDir, stdio: 'ignore' })

  writeFileSync(join(env.workDir, 'package.json'), JSON.stringify({ name: 'dsh-lcx-codex', version: '0.7.1-pre.1' }, null, 2))
  writeFileSync(join(env.workDir, 'PUBLIC-RELEASE-MANIFEST.yml'), 'version: 0.7.1-pre.1\nstate: REVIEW_ONLY\n', 'utf8')
  execFileSync('git', ['add', '.'], { cwd: env.workDir })
  execFileSync('git', ['commit', '-m', 'bump main after v0.7.0'], { cwd: env.workDir, stdio: 'ignore' })
  execFileSync('git', ['push', 'origin', 'main'], { cwd: env.workDir, stdio: 'ignore' })

  env.runFinalize({
    EVENT_NAME: 'workflow_dispatch',
    DISPATCH_TAG: 'v0.7.0',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
    STUB_EXISTING_RELEASE: '0',
  })
  const calls = readFileSync(env.logFile, 'utf8')
  assert.match(calls, /gh release create v0\.7\.0 --verify-tag .* --latest(?:\s|$)/u)
})

test('P1-G & P1-2: maintenance branch finalizes under stable-X.Y with --latest=false, enforces latest === stable_latest_must_remain, and rejects latest/main disagreement', (t) => {
  const maint07Env = setupWorkflowRepo(t, {
    version: '0.7.1',
    manifest: approvedStableManifest({ version: '0.7.1', branch: 'stable/0.7.x', distTag: 'stable-0.7', stableRemain: '0.8.0' }),
  })
  execFileSync('git', ['checkout', '-b', 'stable/0.7.x'], { cwd: maint07Env.workDir, stdio: 'ignore' })
  execFileSync('git', ['push', 'origin', 'stable/0.7.x'], { cwd: maint07Env.workDir, stdio: 'ignore' })
  const maint07Sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: maint07Env.workDir, encoding: 'utf8' }).trim()
  execFileSync('git', ['tag', 'v0.7.1'], { cwd: maint07Env.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.1'], { cwd: maint07Env.workDir, stdio: 'ignore' })

  // If latest unexpectedly moved from 0.8.0 -> 0.7.1, maintenance finalizer MUST reject!
  assert.throws(() =>
    maint07Env.runFinalize({
      EVENT_NAME: 'workflow_run',
      WORKFLOW_RUN_SHA: maint07Sha,
      WORKFLOW_RUN_BRANCH: 'v0.7.1',
      STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.1', 'stable-0.7': '0.7.1' }),
    }),
  /expected npm latest to remain 0\.8\.0/u)

  maint07Env.runFinalize({
    EVENT_NAME: 'workflow_run',
    WORKFLOW_RUN_SHA: maint07Sha,
    WORKFLOW_RUN_BRANCH: 'v0.7.1',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.8.0', 'stable-0.7': '0.7.1' }),
    STUB_EXISTING_RELEASE: '0',
  })
  const calls = readFileSync(maint07Env.logFile, 'utf8')
  assert.match(calls, /npm view dsh-lcx-codex dist-tags --json/u)
  assert.match(calls, /gh release create v0\.7\.1 --verify-tag .* --latest=false/u)

  const badEnv = setupWorkflowRepo(t, {
    version: '0.7.2',
    manifest: approvedStableManifest({ version: '0.7.2', branch: 'stable/0.7.x', distTag: 'latest' }),
  })
  execFileSync('git', ['checkout', '-b', 'stable/0.7.x'], { cwd: badEnv.workDir, stdio: 'ignore' })
  execFileSync('git', ['push', 'origin', 'stable/0.7.x'], { cwd: badEnv.workDir, stdio: 'ignore' })
  execFileSync('git', ['tag', 'v0.7.2'], { cwd: badEnv.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.2'], { cwd: badEnv.workDir, stdio: 'ignore' })
  assert.throws(() =>
    badEnv.runFinalize({
      EVENT_NAME: 'workflow_dispatch',
      DISPATCH_TAG: 'v0.7.2',
      STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.2' }),
    }),
  )

  const pre070FloorEnv = setupWorkflowRepo(t, {
    version: '0.6.1',
    manifest: approvedStableManifest({ version: '0.6.1', branch: 'stable/0.6.x', distTag: 'stable-0.6', stableRemain: '0.7.0' }),
  })
  execFileSync('git', ['checkout', '-b', 'stable/0.6.x'], { cwd: pre070FloorEnv.workDir, stdio: 'ignore' })
  execFileSync('git', ['push', 'origin', 'stable/0.6.x'], { cwd: pre070FloorEnv.workDir, stdio: 'ignore' })
  execFileSync('git', ['tag', 'v0.6.1'], { cwd: pre070FloorEnv.workDir })
  execFileSync('git', ['push', 'origin', 'v0.6.1'], { cwd: pre070FloorEnv.workDir, stdio: 'ignore' })
  assert.throws(
    () =>
      pre070FloorEnv.runFinalize({
        EVENT_NAME: 'workflow_dispatch',
        DISPATCH_TAG: 'v0.6.1',
        STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0', 'stable-0.6': '0.6.1' }),
      }),
    /Finalize workflow requires release version >= 0\.7\.0/u,
    'Finalizer must reject synthetic 0.6.1 below 0.7.0 floor',
  )
  assert.equal(existsSync(pre070FloorEnv.logFile), false, '0.6.1 below 0.7.0 floor must fail before gh/npm')
})

test('P1-4 & P3-1: already-finalized release skips npm view polling and verifies Publish to npm artifact digest', (t) => {
  const env = setupWorkflowRepo(t, {
    version: '0.7.1',
    manifest: approvedStableManifest({ version: '0.7.1', branch: 'stable/0.7.x', distTag: 'stable-0.7', stableRemain: '0.8.0' }),
  })
  execFileSync('git', ['checkout', '-b', 'stable/0.7.x'], { cwd: env.workDir, stdio: 'ignore' })
  execFileSync('git', ['push', 'origin', 'stable/0.7.x'], { cwd: env.workDir, stdio: 'ignore' })
  execFileSync('git', ['tag', 'v0.7.1'], { cwd: env.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.1'], { cwd: env.workDir, stdio: 'ignore' })

  const res = env.runFinalize({
    EVENT_NAME: 'workflow_dispatch',
    DISPATCH_TAG: 'v0.7.1',
    STUB_EXISTING_RELEASE: '1',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.8.0', 'stable-0.7': '0.7.1' }),
  })
  assert.match(res.stdout, /already exists/u)
  const calls = readFileSync(env.logFile, 'utf8')
  assert.match(calls, /npm view dsh-lcx-codex dist-tags --json/u)
  assert.doesNotMatch(calls, /npm view dsh-lcx-codex@/u)
  assert.throws(() =>
    env.runFinalize({
      EVENT_NAME: 'workflow_dispatch',
      DISPATCH_TAG: 'v0.7.1',
      STUB_EXISTING_RELEASE: '1',
      STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.1', 'stable-0.7': '0.7.1' }),
    }),
  )
})

test('P1-3: tag not on main or matching stable/* branch is rejected before gh/npm', (t) => {
  const env = setupWorkflowRepo(t, {
    version: '0.7.0',
    manifest: approvedStableManifest({ version: '0.7.0' }),
  })
  execFileSync('git', ['checkout', '-b', 'work/unmerged'], { cwd: env.workDir, stdio: 'ignore' })
  writeFileSync(join(env.workDir, 'extra.txt'), 'unmerged')
  execFileSync('git', ['add', '.'], { cwd: env.workDir })
  execFileSync('git', ['commit', '-m', 'unmerged'], { cwd: env.workDir, stdio: 'ignore' })
  const unmergedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: env.workDir, encoding: 'utf8' }).trim()
  execFileSync('git', ['tag', 'v0.7.0'], { cwd: env.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: env.workDir, stdio: 'ignore' })

  assert.throws(() =>
    env.runFinalize({
      EVENT_NAME: 'workflow_run',
      WORKFLOW_RUN_SHA: unmergedSha,
      WORKFLOW_RUN_BRANCH: 'v0.7.0',
      STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
    }),
  )
  assert.equal(existsSync(env.logFile), false, 'unmerged tag must fail before gh or npm calls')
})

test('Round 10 & 11 P1-1/P1-2/P2-1/P2-4/P2-5/P2-6/P3-1: finalizer enforces source.product_commit, confirmation/export/verification state, BOM/ZWSP hygiene, attempt-pinned lookup, and hardened ZIP checks', (t) => {
  for (const [label, manifest, expectedErr] of [
    ['missing source.product_commit', approvedStableManifest({ version: '0.7.0', sourceProductCommit: null }), /source\.product_commit must be a 40-char hex commit SHA/u],
    ['missing final_irreversible_confirmation', approvedStableManifest({ version: '0.7.0', finalIrreversibleConfirmation: null }), /Explicit positive approval\.final_irreversible_confirmation/u],
    ['FAILED final_irreversible_confirmation', approvedStableManifest({ version: '0.7.0', finalIrreversibleConfirmation: 'FAILED' }), /Explicit positive approval\.final_irreversible_confirmation/u],
    ['PENDING final_irreversible_confirmation', approvedStableManifest({ version: '0.7.0', finalIrreversibleConfirmation: 'PENDING' }), /Explicit positive approval\.final_irreversible_confirmation/u],
    ['missing public_export_review', approvedStableManifest({ version: '0.7.0', publicExportReview: null }), /Explicit positive approval\.public_export_review/u],
    ['FAILED public_export_review', approvedStableManifest({ version: '0.7.0', publicExportReview: 'FAILED' }), /Explicit positive approval\.public_export_review/u],
    ['PENDING public_export_review', approvedStableManifest({ version: '0.7.0', publicExportReview: 'PENDING' }), /Explicit positive approval\.public_export_review/u],
    ['pending runtime-QA verification.state', approvedStableManifest({ version: '0.7.0', verificationState: 'ENGINEERING_GATES_PASSED_RUNTIME_QA_PENDING' }), /Explicit positive verification\.state/u],
    ['RUNTIME_QA_PASSED_FAILED verification.state', approvedStableManifest({ version: '0.7.0', verificationState: 'RUNTIME_QA_PASSED_FAILED' }), /Explicit positive verification\.state/u],
    ['missing verification.state', approvedStableManifest({ version: '0.7.0', verificationState: null }), /Explicit positive verification\.state/u],
    ['FAILED verification.state', approvedStableManifest({ version: '0.7.0', verificationState: 'FAILED' }), /Explicit positive verification\.state/u],
    ['missing verification commits', approvedStableManifest({ version: '0.7.0', verificationProductCommit: null }), /verification\.product_commit or verification\.verified_commit is required/u],
    ['mismatched verification.product_commit', approvedStableManifest({ version: '0.7.0', verificationProductCommit: 'ffffffffffffffffffffffffffffffffffffffff' }), /verification\.product_commit must match source\.product_commit/u],
    ['missing verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: null }), /verification\.policy is required/u],
    ['pending verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Engineering gates passed; runtime QA remain pending; no runtime claim is made.' }), /verification\.policy must not contain pending/u],
    ['No runtime QA verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'No runtime QA was run.' }), /verification\.policy must not contain pending/u],
    ['Runtime QA not completed verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA has not been completed.' }), /verification\.policy must not contain pending/u],
    ['mixed affirmative and negated verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed, except no runtime QA was run.' }), /verification\.policy must not contain pending/u],
    ['Runtime QA did not pass verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA did not pass' }), /verification\.policy must not contain pending/u],
    ['Runtime QA will be completed tomorrow verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA will be completed tomorrow' }), /verification\.policy must not contain pending/u],
    ['Post-release verification did not pass verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Post-release verification did not pass' }), /verification\.policy must not contain pending/u],
    ['mixed Engineering gates passed + did not pass verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Engineering gates passed; runtime QA did not pass' }), /verification\.policy must not contain pending/u],
    ['No evidence that runtime QA passed verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'No evidence that runtime QA passed' }), /verification\.policy must not contain pending/u],
    ['Runtime QA could be completed tomorrow verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA could be completed tomorrow' }), /verification\.policy must not contain pending/u],
    ['Engineering gates passed, runtime QA status remains unknown verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Engineering gates passed, runtime QA status remains unknown' }), /verification\.policy must not contain pending/u],
    ['no affirmative runtime QA claim in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Engineering gates passed.' }), /must affirmatively state completed runtime QA/u],
    ['short commit deadbeef in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed; Verified commit deadbeef under docs/qa/issue-131/RUNTIME-QA-STABLE.md' }), /Mismatched(?: product)? commit SHA/u],
    ['Markdown backtick Verified commit in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA completed. Verified commit `deadbeef`' }), /Mismatched(?: product)? commit SHA/u],
    ['parenthesized backtick commit in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA completed; commit (`deadbeef`)' }), /Mismatched(?: product)? commit SHA/u],
    ['curly-quoted verified commit in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA completed; verified commit “deadbeef”' }), /Mismatched(?: product)? commit SHA/u],
    ['Markdown bold **Commit** in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA completed; **Commit** `deadbeef`' }), /Mismatched(?: product)? commit SHA/u],
    ['verified commit SHA label in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA completed; verified commit SHA deadbeef' }), /Mismatched(?: product)? commit SHA/u],
    ['missing verification.runtime_qa for issue >= 131', approvedStableManifest({ version: '0.7.0', verificationRuntimeQa: null }), /Explicit verification\.runtime_qa: PASSED is required/u],
    ['PENDING verification.runtime_qa for issue >= 131', approvedStableManifest({ version: '0.7.0', verificationRuntimeQa: 'PENDING' }), /Explicit verification\.runtime_qa: PASSED is required/u],
    ['FAILED verification.runtime_qa for issue >= 131', approvedStableManifest({ version: '0.7.0', verificationRuntimeQa: 'FAILED' }), /Explicit verification\.runtime_qa: PASSED is required/u],
    ['Once runtime QA completed in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Once the runtime QA is completed, we can sign off' }), /verification\.policy must not contain pending/u],
    ['Engineering review passed for runtime QA plan in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Engineering review passed for the runtime QA plan' }), /verification\.policy must not contain pending/u],
    ['Engineering review passed for runtime QA checklist in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Engineering review passed for the runtime QA checklist' }), /must affirmatively state completed runtime QA/u],
    ['No sign yet runtime QA example in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'No sign yet, runtime QA passed only in the example' }), /verification\.policy must not contain pending/u],
    ['Issue 131 historical mask ENGINEERING_PASS not VERIFIED disallowed', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed; ENGINEERING_PASS, not VERIFIED.' }), /verification\.policy must not contain pending/u],
    ['colon commit:deadbeef in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed; verified commit:deadbeef' }), /Mismatched(?: product)? commit SHA/u],
    ['equals commit=deadbeef in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed; commit=deadbeef' }), /Mismatched(?: product)? commit SHA/u],
    ['labeled commit SHA=deadbeef in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed; commit SHA=deadbeef' }), /Mismatched(?: product)? commit SHA/u],
    ['plural commits deadbeef and cafebabe in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed; commits deadbeef and cafebabe' }), /Mismatched product commit SHA/u],
    ['missing verification.dsh', approvedStableManifest({ version: '0.7.0', verificationDsh: null }), /verification\.dsh must match runtime_basis\.dsh/u],
    ['wrong verification.dsh', approvedStableManifest({ version: '0.7.0', verificationDsh: '0.2.1-rc.5' }), /verification\.dsh must match runtime_basis\.dsh/u],
    ['POST_RELEASE_VERIFIED state disallowed on finalizer', approvedStableManifest({ version: '0.7.0', verificationState: 'POST_RELEASE_VERIFIED' }), /Explicit positive verification\.state/u],
    ['simulator runtime QA disallowed', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed in a simulator.' }), /verification\.policy must not contain pending/u],
    ['test double runtime QA disallowed', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed in a test double.' }), /verification\.policy must not contain pending/u],
    ['wrong DSH version in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA on DSH 0.2.1-rc.5 has passed.' }), /Mismatched DSH version 0\.2\.1-rc\.5/u],
    ['Post-release verification disallowed on finalizer', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Post-release verification passed.' }), /verification\.policy must not contain pending/u],
    ['unparenthesized stop-condition not mask disallowed', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed, both stop conditions not hit.' }), /verification\.policy must not contain pending/u],
    ['engineering gates stop-condition not paren disallowed', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Engineering gates passed (both stop conditions not hit); Runtime QA passed.' }), /verification\.policy must not contain pending/u],
    ['engineering gates custom parens disallowed', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Engineering gates passed (custom note); Runtime QA passed.' }), /verification\.policy contains unrecognized clause/u],
    ['only replayed fixtures disallowed', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed; only replayed fixtures.' }), /verification\.policy contains unrecognized clause/u],
    ['parenthesized mismatched DSH clause disallowed', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed; (on DSH 0.2.1-rc.5).' }), /Mismatched DSH version 0\.2\.1-rc\.5/u],
    ['parenthesized matching DSH clause disallowed', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed; (on DSH 0.2.2-rc.5).' }), /verification\.policy contains unrecognized clause/u],
    ['comma-and commit list deadbeef bypass disallowed', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed; commits 0123456, and deadbeef' }), /Mismatched product commit SHA deadbeef/u],
    ['Oxford-comma commit list deadbeef bypass disallowed', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed; commits 0123456, deadbeef, and cafebabe' }), /Mismatched product commit SHA deadbeef/u],
    ['glued parenthesized commitdeadbeef disallowed', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Runtime QA passed (commitdeadbeef).' }), /Malformed commit SHA reference|Mismatched(?: product)? commit SHA/u],
    ['engineering_issue 129 with work/131 rejected', approvedStableManifest({ version: '0.7.0', productOwner: 'po-approved-2026-11-22', engineeringIssue: '129' }), /source\.work_branch .* must match engineering_issue #129/u],
    ['400-digit engineering_issue rejected', approvedStableManifest({ version: '0.7.0', productOwner: 'po-approved-2026-11-22', engineeringIssue: '9'.repeat(400) }), /positive integer without leading zeros/u],
    ['aligned 400-digit engineering_issue and work_branch rejected', approvedStableManifest({ version: '0.7.0', productOwner: 'po-approved-2026-11-22', engineeringIssue: '9'.repeat(400), approvalWorkBranch: `work/${'9'.repeat(400)}-stable`, sourceWorkBranch: `work/${'9'.repeat(400)}-stable`, verificationPolicy: 'Runtime QA passed' }), /positive integer without leading zeros/u],
    ['stale Private Issue #129 in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Recorded under Private Issue #129' }), /Stale or mismatched issue reference #129 in verification\.policy/u],
    ['stale private-issue in verification.policy', approvedStableManifest({ version: '0.7.0', verificationPolicy: 'Recorded private-issue-129 and docs/qa/issue-129/RUNTIME-QA.md' }), /Stale or mismatched issue reference #129 in verification\.policy/u],
    ['escaped BOM in quoted product_owner', approvedStableManifest({ version: '0.7.0', productOwner: '"\\ufeff"' }), /YAML scalar for approval\.product_owner must be non-empty/u],
    ['trailing escaped BOM in product_owner', approvedStableManifest({ version: '0.7.0', productOwner: '"po-approved\\ufeff"' }), /Unsupported invisible\/BOM format character/u],
    ['invisible ZWSP in work_branch', approvedStableManifest({ version: '0.7.0', approvalWorkBranch: '"work/\\u200b"', sourceWorkBranch: '"work/\\u200b"' }), /Unsupported invisible\/BOM format character/u],
    ['escaped BOM in quoted work_branch', approvedStableManifest({ version: '0.7.0', approvalWorkBranch: '"work/131\\ufeff"', sourceWorkBranch: '"work/131\\ufeff"' }), /Unsupported invisible\/BOM format character/u],
    ['whitespace-only quoted work_branch', approvedStableManifest({ version: '0.7.0', approvalWorkBranch: '"   "', sourceWorkBranch: '"   "' }), /YAML scalar for approval\.work_branch must be non-empty/u],
  ]) {
    const badEnv = setupWorkflowRepo(t, { version: '0.7.0', manifest })
    const badSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: badEnv.workDir, encoding: 'utf8' }).trim()
    execFileSync('git', ['tag', 'v0.7.0'], { cwd: badEnv.workDir })
    execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: badEnv.workDir, stdio: 'ignore' })
    assert.throws(
      () =>
        badEnv.runFinalize({
          EVENT_NAME: 'workflow_run',
          WORKFLOW_RUN_SHA: badSha,
          WORKFLOW_RUN_BRANCH: 'v0.7.0',
          STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
        }),
      expectedErr,
      `Finalizer must reject ${label}`,
    )
    assert.equal(existsSync(badEnv.logFile), false, `${label} must fail before gh/npm`)
  }

  // Round 18-19 P2-1/P2-2: explicit parenthesized stop-condition notes, mixed commit separators, and comma-separated upstream tracking pass standalone finalizer
  for (const validR19Policy of [
    'Runtime QA passed (both stop conditions not hit); commit:0123456; commit SHA=0123456.',
    'Runtime QA passed (commit:0123456; both stop conditions not hit).',
    'Runtime QA passed; commits 0123456 & 01234567, and 012345678.',
    'Runtime QA passed; upstream issue #105, and #62 remain open.',
  ]) {
    const r19ValidEnv = setupWorkflowRepo(t, {
      version: '0.7.0',
      manifest: approvedStableManifest({
        version: '0.7.0',
        verificationPolicy: validR19Policy,
      }),
    })
    const r19ValidSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: r19ValidEnv.workDir, encoding: 'utf8' }).trim()
    execFileSync('git', ['tag', 'v0.7.0'], { cwd: r19ValidEnv.workDir })
    execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: r19ValidEnv.workDir, stdio: 'ignore' })
    assert.doesNotThrow(() =>
      r19ValidEnv.runFinalize({
        EVENT_NAME: 'workflow_run',
        WORKFLOW_RUN_SHA: r19ValidSha,
        WORKFLOW_RUN_BRANCH: 'v0.7.0',
        STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
        STUB_EXISTING_RELEASE: '0',
      }),
    )
    assert.match(readFileSync(r19ValidEnv.logFile, 'utf8'), /gh release create v0\.7\.0/u)
  }

  // Round 10 P2-6 & Round 11 P2-5: rerun attempt-pinned lookup via workflow_run and optional workflow_dispatch recovery
  const rerunEnv = setupWorkflowRepo(t, {
    version: '0.7.0',
    manifest: approvedStableManifest({ version: '0.7.0' }),
  })
  const rerunSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rerunEnv.workDir, encoding: 'utf8' }).trim()
  execFileSync('git', ['tag', 'v0.7.0'], { cwd: rerunEnv.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: rerunEnv.workDir, stdio: 'ignore' })

  assert.throws(
    () =>
      rerunEnv.runFinalize({
        EVENT_NAME: 'workflow_dispatch',
        DISPATCH_TAG: 'v0.7.0',
        WORKFLOW_RUN_ID: '7100',
        WORKFLOW_RUN_ATTEMPT: '2',
        STUB_ARTIFACTS: JSON.stringify([
          { id: 1001, name: 'verified-public-package', expired: false },
          { id: 1002, name: 'verified-public-package-7100-1', expired: false },
        ]),
        STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
      }),
    /must contain exactly 1 active verified-public-package-7100-2 artifact/u,
  )

  // Recover attempt 1 of run 7100 via workflow_dispatch even when attempt 2 later failed
  rerunEnv.runFinalize({
    EVENT_NAME: 'workflow_dispatch',
    DISPATCH_TAG: 'v0.7.0',
    WORKFLOW_RUN_ID: '7100',
    WORKFLOW_RUN_ATTEMPT: '1',
    STUB_PUBLISH_RUNS: JSON.stringify([
      { id: 7100, run_attempt: 1, workflow_id: 777, path: '.github/workflows/publish.yml', event: 'push', name: 'Publish to npm', conclusion: 'success', head_sha: rerunSha, head_branch: 'v0.7.0' },
      { id: 7100, run_attempt: 2, workflow_id: 777, path: '.github/workflows/publish.yml', event: 'push', name: 'Publish to npm', conclusion: 'failure', head_sha: rerunSha, head_branch: 'v0.7.0' },
    ]),
    STUB_ARTIFACTS: JSON.stringify([
      { id: 1002, name: 'verified-public-package-7100-1', expired: false },
      { id: 1003, name: 'verified-public-package-7100-2', expired: false },
    ]),
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
  })
  const recoveryCalls = readFileSync(rerunEnv.logFile, 'utf8')
  assert.match(recoveryCalls, /gh api repos\/kk3ya03-star\/dsh-lcx-codex\/actions\/runs\/7100\/attempts\/1/u)
  assert.match(recoveryCalls, /gh api repos\/kk3ya03-star\/dsh-lcx-codex\/actions\/artifacts\/1002\/zip/u)

  // workflow_run queries /actions/runs/<id>/attempts/<attempt> and verifies deflated + bit-3 streaming ZIPs
  writeFileSync(rerunEnv.logFile, '', 'utf8')
  rerunEnv.runFinalize({
    EVENT_NAME: 'workflow_run',
    WORKFLOW_RUN_ID: '7100',
    WORKFLOW_RUN_ATTEMPT: '2',
    WORKFLOW_RUN_SHA: rerunSha,
    WORKFLOW_RUN_BRANCH: 'v0.7.0',
    STUB_ZIP_MODE: 'deflate-data-descriptor',
    STUB_PUBLISH_RUNS: JSON.stringify([
      { id: 7100, run_attempt: 2, workflow_id: 777, path: '.github/workflows/publish.yml', event: 'push', name: 'Publish to npm', conclusion: 'success', head_sha: rerunSha, head_branch: 'v0.7.0' },
    ]),
    STUB_ARTIFACTS: JSON.stringify([
      { id: 1002, name: 'verified-public-package-7100-1', expired: false },
      { id: 1003, name: 'verified-public-package-7100-2', expired: false },
    ]),
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
  })
  const wrCalls = readFileSync(rerunEnv.logFile, 'utf8')
  assert.match(wrCalls, /gh api repos\/kk3ya03-star\/dsh-lcx-codex\/actions\/runs\/7100\/attempts\/2/u)
  assert.match(wrCalls, /gh api repos\/kk3ya03-star\/dsh-lcx-codex\/actions\/artifacts\/1003\/zip/u)
  assert.doesNotMatch(wrCalls, /gh run download/u)

  // Standard deflate and unsigned 12-byte Data Descriptor modes succeed
  for (const okZipMode of ['deflate', 'unsigned-dd']) {
    rerunEnv.runFinalize({
      EVENT_NAME: 'workflow_dispatch',
      DISPATCH_TAG: 'v0.7.0',
      STUB_ZIP_MODE: okZipMode,
      STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
    })
  }

  // Round 11-12 P2-4: reject corrupted CRC, LFH/CD mismatch, OOB offset, wrong uncompressed size, DD tampering, bit-3 mismatch, nonzero CD disk, truncated payload, real inflation bomb, and oversized ZIP pre-read
  for (const [zipMode, errRe] of [
    ['corrupt-crc', /CRC32 mismatch/u],
    ['lfh-mismatch', /metadata mismatches central directory/u],
    ['oob-offset', /Invalid ZIP local file header offset/u],
    ['wrong-uncompressed-size', /Inflated ZIP payload length/u],
    ['oversized-header', /Artifact uncompressed size out of bounds/u],
    ['oversized-bomb', /Artifact uncompressed size out of bounds/u],
    ['missing-dd', /Invalid or missing ZIP data descriptor/u],
    ['corrupt-dd', /ZIP data descriptor CRC32 mismatches central directory/u],
    ['bit3-mismatch', /data descriptor flag mismatches central directory/u],
    ['nonzero-cd-disk', /Unsupported multi-disk ZIP entry/u],
    ['truncated-payload', /ZIP payload overflows central directory bounds/u],
    ['real-bomb-small-header', /ERR_BUFFER_TOO_LARGE|Cannot create a Buffer larger than/u],
    ['cd-eocd-gap', /Unexpected trailing bytes between central directory and EOCD/u],
    ['deflate-trailing-garbage', /trailing|bytesWritten|compressed stream/iu],
    ['oversized-zip', /Downloaded artifact ZIP exceeds size limit/u],
  ]) {
    assert.throws(
      () =>
        rerunEnv.runFinalize({
          EVENT_NAME: 'workflow_dispatch',
          DISPATCH_TAG: 'v0.7.0',
          STUB_ZIP_MODE: zipMode,
          STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
        }),
      errRe,
      `ZIP validator must reject ${zipMode}`,
    )
  }

  // Round 12 P2-5: automatic workflow_run fails closed BEFORE any gh api call unless BOTH positive run_id and run_attempt are set
  for (const [label, badRunEnv] of [
    ['missing run_id', { EVENT_NAME: 'workflow_run', WORKFLOW_RUN_ID: '', WORKFLOW_RUN_ATTEMPT: '1' }],
    ['missing run_attempt', { EVENT_NAME: 'workflow_run', WORKFLOW_RUN_ID: '7100', WORKFLOW_RUN_ATTEMPT: '' }],
    ['zero run_id', { EVENT_NAME: 'workflow_run', WORKFLOW_RUN_ID: '0', WORKFLOW_RUN_ATTEMPT: '1' }],
    ['non-numeric run_attempt', { EVENT_NAME: 'workflow_run', WORKFLOW_RUN_ID: '7100', WORKFLOW_RUN_ATTEMPT: 'abc' }],
  ]) {
    writeFileSync(rerunEnv.logFile, '', 'utf8')
    assert.throws(
      () =>
        rerunEnv.runFinalize({
          ...badRunEnv,
          WORKFLOW_RUN_SHA: rerunSha,
          WORKFLOW_RUN_BRANCH: 'v0.7.0',
          STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
        }),
      undefined,
      `workflow_run must fail closed for ${label}`,
    )
    const callsMade = readFileSync(rerunEnv.logFile, 'utf8')
    assert.doesNotMatch(callsMade, /\bgh api\b/u, `workflow_run (${label}) must fail before any gh api call`)
  }

  // Round 12 P2-6 & P2-7 & Round 13 P3-3: CRLF manifest stored verbatim in git passes finalizer, pre-seeded verification SHAs overwrite cleanly, and +build metadata is rejected on target pins
  const rawBaseManifest = readFileSync(new URL('../PUBLIC-RELEASE-MANIFEST.yml', import.meta.url), 'utf8')
  const preSeededManifest = setYamlSectionField(
    setYamlSectionField(rawBaseManifest, 'verification', 'product_commit', '1111111111111111111111111111111111111111'),
    'verification',
    'verified_commit',
    '2222222222222222222222222222222222222222',
  )
  assert.match(preSeededManifest, /^ {2}product_commit: 1111111111111111111111111111111111111111$/m)
  assert.match(preSeededManifest, /^ {2}verified_commit: 2222222222222222222222222222222222222222$/m)
  const crlfApprovedManifest = approvedStableManifest({
    version: '0.7.0',
    baseText: preSeededManifest,
  }).replace(/\r?\n/gu, '\r\n')
  const crlfEnv = setupWorkflowRepo(t, {
    version: '0.7.0',
    manifest: crlfApprovedManifest,
    autocrlfFalse: true,
  })
  const crlfSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: crlfEnv.workDir, encoding: 'utf8' }).trim()
  execFileSync('git', ['tag', 'v0.7.0'], { cwd: crlfEnv.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: crlfEnv.workDir, stdio: 'ignore' })
  crlfEnv.runFinalize({
    EVENT_NAME: 'workflow_run',
    WORKFLOW_RUN_SHA: crlfSha,
    WORKFLOW_RUN_BRANCH: 'v0.7.0',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
  })

  for (const [buildLabel, buildManifestOpts, buildVersion, buildTag, buildDistTag] of [
    [
      'previous_latest_must_be with +build metadata',
      { version: '0.7.0', previousLatest: '0.6.0+build.1' },
      '0.7.0',
      'v0.7.0',
      'latest',
    ],
    [
      'stable_latest_must_remain with +build metadata',
      {
        version: '0.7.1',
        branch: 'stable/0.7.x',
        tag: 'v0.7.1',
        distTag: 'stable-0.7',
        stableRemain: '0.8.0+build.1',
      },
      '0.7.1',
      'v0.7.1',
      'stable-0.7',
    ],
  ]) {
    const buildEnv = setupWorkflowRepo(t, {
      version: buildVersion,
      manifest: approvedStableManifest(buildManifestOpts),
    })
    if (buildManifestOpts.branch && buildManifestOpts.branch !== 'main') {
      execFileSync('git', ['checkout', '-b', buildManifestOpts.branch], { cwd: buildEnv.workDir, stdio: 'ignore' })
      execFileSync('git', ['push', 'origin', buildManifestOpts.branch], { cwd: buildEnv.workDir, stdio: 'ignore' })
    }
    const buildSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: buildEnv.workDir, encoding: 'utf8' }).trim()
    execFileSync('git', ['tag', buildTag], { cwd: buildEnv.workDir })
    execFileSync('git', ['push', 'origin', buildTag], { cwd: buildEnv.workDir, stdio: 'ignore' })
    assert.throws(
      () =>
        buildEnv.runFinalize({
          EVENT_NAME: 'workflow_run',
          WORKFLOW_RUN_SHA: buildSha,
          WORKFLOW_RUN_BRANCH: buildTag,
          STUB_NPM_TAGS: JSON.stringify({ [buildDistTag]: buildVersion }),
        }),
      /must not contain build metadata/u,
      `Finalizer must reject ${buildLabel}`,
    )
    assert.equal(existsSync(buildEnv.logFile), false, `${buildLabel} must fail before gh/npm`)
  }

  // Round 14 P3-2: reject non-string package.json version (e.g. ["0.7.0"]) before semver coercion
  const arrayVerPkg = { ...approvedStablePackage({ version: '0.7.0' }), version: ['0.7.0'] }
  const arrayVerEnv = setupWorkflowRepo(t, {
    version: '0.7.0',
    pkgOverride: arrayVerPkg,
    manifest: approvedStableManifest({ version: '0.7.0' }),
  })
  const arrayVerSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: arrayVerEnv.workDir, encoding: 'utf8' }).trim()
  execFileSync('git', ['tag', 'v0.7.0'], { cwd: arrayVerEnv.workDir })
  execFileSync('git', ['push', 'origin', 'v0.7.0'], { cwd: arrayVerEnv.workDir, stdio: 'ignore' })
  assert.throws(
    () =>
      arrayVerEnv.runFinalize({
        EVENT_NAME: 'workflow_run',
        WORKFLOW_RUN_SHA: arrayVerSha,
        WORKFLOW_RUN_BRANCH: 'v0.7.0',
        STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
      }),
    /package\.json version must be a string/u,
    'Finalizer must reject array package.json version',
  )
  assert.equal(existsSync(arrayVerEnv.logFile), false, 'non-string package.json version must fail before gh/npm')

  // Round 17-19 P1-1/P2-1: finalizer remains strict with ZERO legacy bypass (rejects immutable archived 0.6.0 & 0.7.0-pre.1 commits checked via git cat-file -e, NEVER mutable main/dev refs)
  const hasGitCommit = (commitSha) => {
    try {
      execFileSync('git', ['cat-file', '-e', `${commitSha}^{commit}`], { cwd: rootDir, stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
  for (const [legacyCommit, legacyTag] of [
    ['be8d90bd70e3a6ec576dd7bf4fad7e5310797589', 'v0.6.0'],
    ['c4211438b4a0c2c390080fc7838876264feeeccb', 'v0.7.0-pre.1'],
  ]) {
    if (!hasGitCommit(legacyCommit)) continue
    const legacyManifest = execFileSync('git', ['show', `${legacyCommit}:PUBLIC-RELEASE-MANIFEST.yml`], {
      cwd: rootDir,
      encoding: 'utf8',
    })
    const legacyPkg = JSON.parse(
      execFileSync('git', ['show', `${legacyCommit}:package.json`], {
        cwd: rootDir,
        encoding: 'utf8',
      }),
    )
    const legacyEnv = setupWorkflowRepo(t, {
      version: legacyPkg.version,
      pkgOverride: legacyPkg,
      manifest: legacyManifest,
    })
    const legacySha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: legacyEnv.workDir, encoding: 'utf8' }).trim()
    execFileSync('git', ['tag', legacyTag], { cwd: legacyEnv.workDir })
    execFileSync('git', ['push', 'origin', legacyTag], { cwd: legacyEnv.workDir, stdio: 'ignore' })
    assert.throws(
      () =>
        legacyEnv.runFinalize({
          EVENT_NAME: 'workflow_run',
          WORKFLOW_RUN_SHA: legacySha,
          WORKFLOW_RUN_BRANCH: legacyTag,
          STUB_NPM_TAGS: JSON.stringify({ latest: '0.6.0' }),
        }),
      /Expected stable package version|approval\.approved_version|approval\.engineering_issue|verification\.runtime_qa/u,
      `Finalizer must strictly reject legacy commit ${legacyCommit} (${legacyTag}) manifest`,
    )
    assert.equal(existsSync(legacyEnv.logFile), false, `legacy commit ${legacyCommit} must fail before gh/npm`)
  }
})
