import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const publishWorkflowUrl = new URL('../.github/workflows/publish.yml', import.meta.url)
const publishWorkflowText = readFileSync(publishWorkflowUrl, 'utf8')
const rootPkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const baseManifest = readFileSync(new URL('../PUBLIC-RELEASE-MANIFEST.yml', import.meta.url), 'utf8')

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
  assert.ok(runIdx !== -1, `Step "${stepName}" must contain a bash run block`)
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

function removeYamlSectionField(yamlText, sectionName, keyName) {
  const lines = yamlText.split(/\r?\n/u)
  let inSection = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^[A-Za-z0-9_]+:/u.test(line)) {
      if (inSection) break
      if (line.trim() === `${sectionName}:`) inSection = true
      continue
    }
    if (inSection && new RegExp(`^  ${keyName}:(?:[ \\t]|$)`, 'u').test(line)) {
      lines.splice(i, 1)
      break
    }
  }
  return lines.join('\n')
}

function buildApprovedManifest({
  version,
  branch,
  distTag,
  previousLatest,
  stableRemain,
  state = version.includes('-') ? 'APPROVED_PRERELEASE' : 'APPROVED_STABLE',
  baseText = baseManifest,
}) {
  let out = baseText
    .replace(/^version: .+$/m, `version: ${version}`)
    .replace(/^state: .+$/m, `state: ${state}`)
    .replace(/^ {2}branch: .+$/m, `  branch: ${branch}`)
    .replace(/^ {2}tag: .+$/m, `  tag: v${version}`)
    .replace(/^ {2}npm_dist_tag: .+$/m, `  npm_dist_tag: ${distTag}`)
    .replace(/^ {2}dsh: .+$/m, `  dsh: ${rootPkg.devDependencies['@deepseek-ai/dsh']}`)
    .replace(/^ {2}host_pi: .+$/m, `  host_pi: ${rootPkg.lcxCompatibility.verifiedHostPi}`)
    .replace(/^ {2}plugin_pi: .+$/m, `  plugin_pi: ${rootPkg.devDependencies['@earendil-works/pi-ai']}`)

  const commit = '0123456789abcdef0123456789abcdef01234567'
  out = setYamlSectionField(out, 'approval', 'product_owner', 'private-issue-131-po-approved-2026-11-22')
  out = setYamlSectionField(out, 'approval', 'controller_review', 'TL_ACCEPTED_ENGINEERING_REVIEW_2026-11-22')
  out = setYamlSectionField(out, 'approval', 'tl_reviewed_product_commit', commit)
  out = setYamlSectionField(out, 'approval', 'approved_version', version)
  out = setYamlSectionField(out, 'approval', 'final_irreversible_confirmation', 'RECORDED_2026-11-22')
  out = setYamlSectionField(out, 'approval', 'public_export_review', 'TL_PASSED_REVISION_1_2026-11-22')
  out = setYamlSectionField(out, 'verification', 'state', 'ENGINEERING_GATES_AND_RUNTIME_QA_PASSED_TL_ACCEPTED')
  out = setYamlSectionField(out, 'verification', 'runtime_qa', 'PASSED')
  out = setYamlSectionField(out, 'verification', 'dsh', rootPkg.devDependencies['@deepseek-ai/dsh'])
  out = setYamlSectionField(out, 'verification', 'product_commit', commit)
  if (/^ {2}verified_commit:/m.test(out)) {
    out = setYamlSectionField(out, 'verification', 'verified_commit', commit)
  }
  out = setYamlSectionField(
    out,
    'verification',
    'policy',
    '"Engineering gates + runtime QA completed under docs/qa/issue-131/RUNTIME-QA-STABLE.md"',
  )
  out = setYamlSectionField(out, 'source', 'product_commit', commit)
  out = setYamlSectionField(out, 'publication', 'state', 'APPROVED_PENDING_PUBLISH')

  if (previousLatest !== undefined) {
    out = out.replace(/^ {2}previous_latest_must_be: .+$/m, `  previous_latest_must_be: ${previousLatest}`)
  } else {
    out = out.replace(/^ {2}previous_latest_must_be: .+$/m, `  stable_latest_must_remain: ${stableRemain}`)
  }
  return out
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

function setupPublishRepo(t, { version, branch, distTag, previousLatest, stableRemain, manifestOverride }) {
  const root = mkdtempSync(join(tmpdir(), 'lcx-publish-wf-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const originDir = join(root, 'origin.git')
  const workDir = join(root, 'work')
  const binDir = join(root, 'bin')
  const logFile = join(root, 'calls.log')
  const githubOutput = join(root, 'github_output.txt')
  const githubEnv = join(root, 'github_env.txt')
  mkdirSync(originDir, { recursive: true })
  mkdirSync(join(workDir, 'scripts'), { recursive: true })
  mkdirSync(binDir, { recursive: true })

  execFileSync('git', ['init', '--bare', originDir], { stdio: 'ignore' })
  execFileSync('git', ['init', '-b', 'main', workDir], { stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workDir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: workDir })
  execFileSync('git', ['remote', 'add', 'origin', originDir], { cwd: workDir })

  copyFileSync(new URL('./release-policy.mjs', import.meta.url), join(workDir, 'scripts', 'release-policy.mjs'))
  copyFileSync(new URL('./semver-range.mjs', import.meta.url), join(workDir, 'scripts', 'semver-range.mjs'))

  const candidatePkg = {
    ...structuredClone(rootPkg),
    version,
    lcxCompatibility: {
      ...rootPkg.lcxCompatibility,
      dshInstallRange: '>=0.2.2-rc.5 <0.2.3-0',
      verifiedDsh: '0.2.2-rc.5',
    },
    peerDependencies: Object.fromEntries(
      Object.entries(rootPkg.peerDependencies).map(([k, v]) => [
        k,
        k.startsWith('@deepseek-ai/dsh-') ? '>=0.2.2-rc.5 <0.2.3-0' : v,
      ]),
    ),
  }
  const manifest = manifestOverride ?? buildApprovedManifest({ version, branch, distTag, previousLatest, stableRemain })
  writeFileSync(join(workDir, 'package.json'), JSON.stringify(candidatePkg, null, 2), 'utf8')
  writeFileSync(join(workDir, 'PUBLIC-RELEASE-MANIFEST.yml'), manifest, 'utf8')

  if (branch !== 'main') {
    execFileSync('git', ['add', '.'], { cwd: workDir })
    execFileSync('git', ['commit', '-m', 'base main'], { cwd: workDir, stdio: 'ignore' })
    execFileSync('git', ['push', 'origin', 'main'], { cwd: workDir, stdio: 'ignore' })
    execFileSync('git', ['checkout', '-b', branch], { cwd: workDir, stdio: 'ignore' })
  } else {
    execFileSync('git', ['add', '.'], { cwd: workDir })
    execFileSync('git', ['commit', '-m', `release v${version}`], { cwd: workDir, stdio: 'ignore' })
  }
  execFileSync('git', ['push', 'origin', branch], { cwd: workDir, stdio: 'ignore' })
  execFileSync('git', ['tag', `v${version}`], { cwd: workDir })
  execFileSync('git', ['push', 'origin', `v${version}`], { cwd: workDir, stdio: 'ignore' })

  const nodePath = process.execPath.replace(/\\/gu, '/')
  const npmStubJs = join(binDir, 'npm-stub.mjs')
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
    fetchStubJs,
    `
const origFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://registry.npmjs.org/dsh-lcx-codex/')) {
    if (process.env.STUB_FETCH_ERROR === '1') {
      throw new TypeError('simulated registry network error')
    }
    const status = Number.parseInt(process.env.STUB_FETCH_STATUS || '404', 10)
    const body = process.env.STUB_FETCH_BODY || '{}'
    return new Response(body, { status, headers: { 'content-type': 'application/json' } })
  }
  return origFetch(url, init)
}
`,
    'utf8',
  )

  const npmSh = join(binDir, 'npm')
  writeFileSync(npmSh, `#!/bin/sh\nexec "${nodePath}" "${npmStubJs.replace(/\\/gu, '/')}" "$@"\n`, 'utf8')
  if (process.platform !== 'win32') chmodSync(npmSh, 0o755)

  const policyScript = join(root, 'step-policy.sh')
  const precheckScript = join(root, 'step-precheck.sh')
  const verifyScript = join(root, 'step-verify.sh')
  writeFileSync(policyScript, extractStepRunBlock(publishWorkflowText, 'Enforce release policy and registry preconditions'), 'utf8')
  writeFileSync(precheckScript, extractStepRunBlock(publishWorkflowText, 'Re-verify registry preconditions immediately before npm publish'), 'utf8')
  writeFileSync(verifyScript, extractStepRunBlock(publishWorkflowText, 'Verify npm publication and channel convergence'), 'utf8')

  const tgzPath = join(root, `dsh-lcx-codex-${version}.tgz`)
  const tgzBytes = gzipSync(Buffer.from(`stub-tarball-${version}`))
  writeFileSync(tgzPath, tgzBytes)
  const tarballSha256 = createHash('sha256').update(tgzBytes).digest('hex')
  const tarballShasum = createHash('sha1').update(tgzBytes).digest('hex')
  const tarballIntegrity = `sha512-${createHash('sha512').update(tgzBytes).digest('base64')}`

  const runBashScript = (scriptFile, extraEnv = {}) => {
    const sep = process.platform === 'win32' ? ';' : ':'
    writeFileSync(githubOutput, '', 'utf8')
    writeFileSync(githubEnv, '', 'utf8')
    const out = execFileSync(findBash(), [scriptFile], {
      cwd: workDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}${sep}${dirname(process.execPath)}${sep}${process.env.PATH ?? ''}`,
        NODE_OPTIONS: `--import=${pathToFileURL(fetchStubJs).href}`,
        GITHUB_REF: `refs/tags/v${version}`,
        GITHUB_OUTPUT: githubOutput,
        GITHUB_ENV: githubEnv,
        STUB_LOG: logFile,
        LCX_CONVERGE_ATTEMPTS: '1',
        LCX_CONVERGE_SLEEP_SEC: '0',
        ...extraEnv,
      },
    })
    return {
      stdout: out,
      outputs: parseKeyValueFile(githubOutput),
      envFile: parseKeyValueFile(githubEnv),
    }
  }

  return {
    root,
    workDir,
    logFile,
    tgzPath,
    tarballSha256,
    tarballShasum,
    tarballIntegrity,
    runPolicy: (env) => runBashScript(policyScript, env),
    runPrecheck: (env) => runBashScript(precheckScript, env),
    runVerify: (env) => runBashScript(verifyScript, env),
  }
}

test('P1-1, P1-3, P1-5, P2-1 & P2-2: publish.yml structure uses package-wide concurrency with queue max, npm@11.21.3 before registry/packaging, GITHUB_OUTPUT without mapfile, dist-tags --json, and uploads verified-public-package artifact', () => {
  assert.match(publishWorkflowText, /concurrency:\s*\r?\n\s+group:\s*npm-publish-\$\{\{\s*github\.repository\s*\}\}\s*\r?\n\s+cancel-in-progress:\s*false\s*\r?\n\s+queue:\s*max/u)
  assert.match(publishWorkflowText, /npm install --global npm@11\.21\.3/u)
  const upgradeIdx = publishWorkflowText.indexOf('Upgrade npm for OIDC trusted publishing')
  const packIdx = publishWorkflowText.indexOf('npm run pack:local')
  const precheckIdx = publishWorkflowText.indexOf('Re-verify registry preconditions immediately before npm publish')
  assert.ok(upgradeIdx > 0 && packIdx > upgradeIdx && precheckIdx > packIdx, 'npm@11.21.3 upgrade must precede packaging/precheck/publish')
  assert.match(publishWorkflowText, /uses:\s*actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02\s+#\s*v4/u)
  assert.match(publishWorkflowText, /name:\s*verified-public-package-\$\{\{\s*github\.run_id\s*\}\}-\$\{\{\s*github\.run_attempt\s*\}\}/u)
  assert.match(publishWorkflowText, /LCX_EXPECT_PUBLIC_CHECKOUT=1 npm test/u)
  assert.match(publishWorkflowText, /npm run pack:local --silent -- --public --pack-destination/u)
  assert.match(publishWorkflowText, /tarball_sha256=/u)
  assert.match(publishWorkflowText, /tarball_shasum=/u)
  assert.match(publishWorkflowText, /tarball_integrity=/u)
  assert.match(publishWorkflowText, /npm dist-tag add/u)
  assert.doesNotMatch(publishWorkflowText, /\bmapfile\b/u)
  assert.doesNotMatch(publishWorkflowText, /dist-tags\.\$\{?DIST_TAG\}?/u)
})

test('P1-1, P1-3 & P2-2: executes actual publish.yml policy, precheck, and verify steps across main -> latest, stable/X.Y.x -> stable-X.Y, and prerelease -> prelatest', (t) => {
  // 1) main -> latest (empty stable_latest_must_remain — used to crash mapfile!)
  const mainEnv = setupPublishRepo(t, {
    version: '0.7.0',
    branch: 'main',
    distTag: 'latest',
    previousLatest: '0.6.0',
  })
  const mainPolicy = mainEnv.runPolicy({
    STUB_FETCH_STATUS: '404',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.6.0', prelatest: '0.7.0-pre.1' }),
  })
  assert.equal(mainPolicy.outputs.version, '0.7.0')
  assert.equal(mainPolicy.outputs.dist_tag, 'latest')
  assert.equal(mainPolicy.outputs.previous_latest, '0.6.0')
  assert.equal(mainPolicy.outputs.stable_latest_remain, '')
  assert.equal(mainPolicy.outputs.already_published, 'false')
  assert.equal(mainPolicy.envFile.LCX_POLICY_VERSION, '0.7.0')

  const mainPrecheck = mainEnv.runPrecheck({
    STUB_FETCH_STATUS: '404',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.6.0' }),
    LCX_VERSION: mainPolicy.outputs.version,
    LCX_DIST_TAG: mainPolicy.outputs.dist_tag,
    LCX_PREVIOUS_LATEST: mainPolicy.outputs.previous_latest,
    LCX_STABLE_REMAIN: mainPolicy.outputs.stable_latest_remain,
    LCX_TARBALL_SHASUM: mainEnv.tarballShasum,
    LCX_TARBALL_INTEGRITY: mainEnv.tarballIntegrity,
  })
  assert.equal(mainPrecheck.outputs.should_publish, 'true')
  assert.equal(mainPrecheck.outputs.should_dist_tag, 'false')

  mainEnv.runVerify({
    STUB_FETCH_STATUS: '200',
    STUB_FETCH_BODY: JSON.stringify({ dist: { shasum: mainEnv.tarballShasum, integrity: mainEnv.tarballIntegrity } }),
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
    LCX_VERSION: '0.7.0',
    LCX_DIST_TAG: 'latest',
    LCX_STABLE_REMAIN: '',
    LCX_TARBALL_SHASUM: mainEnv.tarballShasum,
    LCX_TARBALL_INTEGRITY: mainEnv.tarballIntegrity,
  })

  // 2) stable/0.7.x -> stable-0.7 (dotted dist-tag!)
  const maintEnv = setupPublishRepo(t, {
    version: '0.7.1',
    branch: 'stable/0.7.x',
    distTag: 'stable-0.7',
    stableRemain: '0.8.0',
  })
  const maintPolicy = maintEnv.runPolicy({
    STUB_FETCH_STATUS: '404',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.8.0' }),
  })
  assert.equal(maintPolicy.outputs.dist_tag, 'stable-0.7')
  assert.equal(maintPolicy.outputs.stable_latest_remain, '0.8.0')
  maintEnv.runVerify({
    STUB_FETCH_STATUS: '200',
    STUB_FETCH_BODY: JSON.stringify({ dist: { shasum: maintEnv.tarballShasum, integrity: maintEnv.tarballIntegrity } }),
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.8.0', 'stable-0.7': '0.7.1' }),
    LCX_VERSION: '0.7.1',
    LCX_DIST_TAG: 'stable-0.7',
    LCX_STABLE_REMAIN: '0.8.0',
    LCX_TARBALL_SHASUM: maintEnv.tarballShasum,
    LCX_TARBALL_INTEGRITY: maintEnv.tarballIntegrity,
  })
  assert.match(readFileSync(maintEnv.logFile, 'utf8'), /npm view dsh-lcx-codex dist-tags --json/u)

  // 3) prerelease 0.7.0-pre.2 -> prelatest
  const preEnv = setupPublishRepo(t, {
    version: '0.7.0-pre.2',
    branch: 'main',
    distTag: 'prelatest',
    stableRemain: '0.6.0',
  })
  const prePolicy = preEnv.runPolicy({
    STUB_FETCH_STATUS: '404',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.6.0', prelatest: '0.7.0-pre.1' }),
  })
  assert.equal(prePolicy.outputs.dist_tag, 'prelatest')
  assert.equal(prePolicy.outputs.stable_latest_remain, '0.6.0')
})

test('P1-5 & P2-2: publish.yml catches late latest drift, fails loudly on HTTP 500/network errors, and recovers idempotently only when tarball digest matches', (t) => {
  const env = setupPublishRepo(t, {
    version: '0.7.0',
    branch: 'main',
    distTag: 'latest',
    previousLatest: '0.6.0',
  })

  // HTTP 500 or network failure MUST fail loudly instead of acting like 404
  assert.throws(() => env.runPolicy({
    STUB_FETCH_STATUS: '500',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.6.0' }),
  }), /failed with HTTP 500/u)
  assert.throws(() => env.runPolicy({
    STUB_FETCH_ERROR: '1',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.6.0' }),
  }))

  // Late race: another tag moved `latest` between policy and publish_precheck -> blocked BEFORE npm publish!
  assert.throws(() => env.runPrecheck({
    STUB_FETCH_STATUS: '404',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.6.1' }),
    LCX_VERSION: '0.7.0',
    LCX_DIST_TAG: 'latest',
    LCX_PREVIOUS_LATEST: '0.6.0',
    LCX_STABLE_REMAIN: '',
    LCX_TARBALL_SHASUM: env.tarballShasum,
    LCX_TARBALL_INTEGRITY: env.tarballIntegrity,
  }), /Pre-publish latest drifted/u)

  // Rerun after interrupted upload: matching shasum+integrity skips npm publish & converges cleanly!
  const rerunPolicy = env.runPolicy({
    STUB_FETCH_STATUS: '200',
    STUB_FETCH_BODY: JSON.stringify({ dist: { shasum: env.tarballShasum, integrity: env.tarballIntegrity } }),
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
  })
  assert.equal(rerunPolicy.outputs.already_published, 'true')
  const rerunAlreadyTagged = env.runPrecheck({
    STUB_FETCH_STATUS: '200',
    STUB_FETCH_BODY: JSON.stringify({ dist: { shasum: env.tarballShasum, integrity: env.tarballIntegrity } }),
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
    LCX_VERSION: '0.7.0',
    LCX_DIST_TAG: 'latest',
    LCX_PREVIOUS_LATEST: '0.6.0',
    LCX_STABLE_REMAIN: '',
    LCX_TARBALL_SHASUM: env.tarballShasum,
    LCX_TARBALL_INTEGRITY: env.tarballIntegrity,
  })
  assert.equal(rerunAlreadyTagged.outputs.should_publish, 'false')
  assert.equal(rerunAlreadyTagged.outputs.should_dist_tag, 'false')

  // Rerun where version exists but dist-tag not yet updated -> sets should_dist_tag=true without republishing
  const rerunNeedsTag = env.runPrecheck({
    STUB_FETCH_STATUS: '200',
    STUB_FETCH_BODY: JSON.stringify({ dist: { shasum: env.tarballShasum, integrity: env.tarballIntegrity } }),
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.6.0' }),
    LCX_VERSION: '0.7.0',
    LCX_DIST_TAG: 'latest',
    LCX_PREVIOUS_LATEST: '0.6.0',
    LCX_STABLE_REMAIN: '',
    LCX_TARBALL_SHASUM: env.tarballShasum,
    LCX_TARBALL_INTEGRITY: env.tarballIntegrity,
  })
  assert.equal(rerunNeedsTag.outputs.should_publish, 'false')
  assert.equal(rerunNeedsTag.outputs.should_dist_tag, 'true')

  // Rerun where existing npm tarball digest mismatches local pack:local -> FAILS loudly!
  assert.throws(() => env.runPrecheck({
    STUB_FETCH_STATUS: '200',
    STUB_FETCH_BODY: JSON.stringify({ dist: { shasum: '0000000000000000000000000000000000000000', integrity: env.tarballIntegrity } }),
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.7.0' }),
    LCX_VERSION: '0.7.0',
    LCX_DIST_TAG: 'latest',
    LCX_PREVIOUS_LATEST: '0.6.0',
    LCX_STABLE_REMAIN: '',
    LCX_TARBALL_SHASUM: env.tarballShasum,
    LCX_TARBALL_INTEGRITY: env.tarballIntegrity,
  }), /mismatches verified local tarball/u)
})

test('Round 5 P1-1: first publish (HTTP 404) refuses to downgrade stable-* or prelatest dist-tags', (t) => {
  const maintDowngrade = setupPublishRepo(t, {
    version: '0.7.1',
    branch: 'stable/0.7.x',
    distTag: 'stable-0.7',
    stableRemain: '0.8.0',
  })
  assert.throws(() => maintDowngrade.runPolicy({
    STUB_FETCH_STATUS: '404',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.8.0', 'stable-0.7': '0.7.2' }),
  }), /Refusing dist-tag downgrade/u)
  assert.throws(() => maintDowngrade.runPrecheck({
    STUB_FETCH_STATUS: '404',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.8.0', 'stable-0.7': '0.7.2' }),
    LCX_VERSION: '0.7.1',
    LCX_DIST_TAG: 'stable-0.7',
    LCX_PREVIOUS_LATEST: '',
    LCX_STABLE_REMAIN: '0.8.0',
    LCX_TARBALL_SHASUM: maintDowngrade.tarballShasum,
    LCX_TARBALL_INTEGRITY: maintDowngrade.tarballIntegrity,
  }), /Refusing pre-publish dist-tag downgrade/u)

  const preDowngrade = setupPublishRepo(t, {
    version: '0.7.0-pre.1',
    branch: 'main',
    distTag: 'prelatest',
    stableRemain: '0.6.0',
  })
  assert.throws(() => preDowngrade.runPolicy({
    STUB_FETCH_STATUS: '404',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.6.0', prelatest: '0.7.0-pre.2' }),
  }), /Refusing dist-tag downgrade/u)
  assert.throws(() => preDowngrade.runPrecheck({
    STUB_FETCH_STATUS: '404',
    STUB_NPM_TAGS: JSON.stringify({ latest: '0.6.0', prelatest: '0.7.0-pre.2' }),
    LCX_VERSION: '0.7.0-pre.1',
    LCX_DIST_TAG: 'prelatest',
    LCX_PREVIOUS_LATEST: '',
    LCX_STABLE_REMAIN: '0.6.0',
    LCX_TARBALL_SHASUM: preDowngrade.tarballShasum,
    LCX_TARBALL_INTEGRITY: preDowngrade.tarballIntegrity,
  }), /Refusing pre-publish dist-tag downgrade/u)
})

test('Round 9-11 P1-1/P1-2/P2-1/P3-1/P3-2: publish.yml rejects denials, pending verification, missing/mismatched commits, invisible BOM/ZWSP, and buildApprovedManifest overwrites pre-seeded SHAs', (t) => {
  for (const [label, mutator, expectedErr] of [
    ['APPROVED_REQUIRED product_owner', (m) => setYamlSectionField(m, 'approval', 'product_owner', 'APPROVED_REQUIRED'), /Explicit positive Product Owner approval required/u],
    ['po-never-approved product_owner', (m) => setYamlSectionField(m, 'approval', 'product_owner', 'po-never-approved'), /Explicit positive Product Owner approval required/u],
    ['TL_ACCEPTED_HOLD controller_review', (m) => setYamlSectionField(m, 'approval', 'controller_review', 'TL_ACCEPTED_HOLD'), /Explicit positive controller_review approval required/u],
    ['missing approved_version', (m) => removeYamlSectionField(m, 'approval', 'approved_version'), /approval\.approved_version is required/u],
    ['missing approval.work_branch', (m) => removeYamlSectionField(m, 'approval', 'work_branch'), /approval\.work_branch is required/u],
    ['missing source.product_commit', (m) => removeYamlSectionField(m, 'source', 'product_commit'), /source\.product_commit must be a 40-char hex commit SHA/u],
    ['source.product_commit flow list', (m) => setYamlSectionField(m, 'source', 'product_commit', '[abc]'), /Unsupported YAML syntax for source\.product_commit/u],
    ['missing final_irreversible_confirmation', (m) => removeYamlSectionField(m, 'approval', 'final_irreversible_confirmation'), /Explicit positive approval\.final_irreversible_confirmation/u],
    ['FAILED final_irreversible_confirmation', (m) => setYamlSectionField(m, 'approval', 'final_irreversible_confirmation', 'FAILED'), /Explicit positive approval\.final_irreversible_confirmation/u],
    ['PENDING final_irreversible_confirmation', (m) => setYamlSectionField(m, 'approval', 'final_irreversible_confirmation', 'PENDING'), /Explicit positive approval\.final_irreversible_confirmation/u],
    ['missing public_export_review', (m) => removeYamlSectionField(m, 'approval', 'public_export_review'), /Explicit positive approval\.public_export_review/u],
    ['FAILED public_export_review', (m) => setYamlSectionField(m, 'approval', 'public_export_review', 'FAILED'), /Explicit positive approval\.public_export_review/u],
    ['PENDING public_export_review', (m) => setYamlSectionField(m, 'approval', 'public_export_review', 'PENDING'), /Explicit positive approval\.public_export_review/u],
    ['pending runtime-QA verification.state', (m) => setYamlSectionField(m, 'verification', 'state', 'ENGINEERING_GATES_PASSED_RUNTIME_QA_PENDING'), /Explicit positive verification\.state/u],
    ['RUNTIME_QA_PASSED_FAILED verification.state', (m) => setYamlSectionField(m, 'verification', 'state', 'RUNTIME_QA_PASSED_FAILED'), /Explicit positive verification\.state/u],
    ['missing verification.state', (m) => removeYamlSectionField(m, 'verification', 'state'), /Explicit positive verification\.state/u],
    ['missing verification.policy', (m) => removeYamlSectionField(m, 'verification', 'policy'), /verification\.policy is required/u],
    ['pending verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Engineering gates passed; runtime QA remain pending; no runtime claim is made."'), /verification\.policy must not contain pending/u],
    ['No runtime QA was run verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"No runtime QA was run."'), /verification\.policy must not contain pending/u],
    ['Runtime QA has not been completed verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA has not been completed."'), /verification\.policy must not contain pending/u],
    ['mixed affirmative and pending verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed, except no runtime QA was run."'), /verification\.policy must not contain pending/u],
    ['Runtime QA did not pass verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA did not pass"'), /verification\.policy must not contain pending/u],
    ['Runtime QA will be completed tomorrow verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA will be completed tomorrow"'), /verification\.policy must not contain pending/u],
    ['Post-release verification did not pass verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Post-release verification did not pass"'), /verification\.policy must not contain pending/u],
    ['mixed Engineering gates passed + did not pass verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Engineering gates passed; runtime QA did not pass"'), /verification\.policy must not contain pending/u],
    ['No evidence that runtime QA passed verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"No evidence that runtime QA passed"'), /verification\.policy must not contain pending/u],
    ['Runtime QA could be completed tomorrow verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA could be completed tomorrow"'), /verification\.policy must not contain pending/u],
    ['Engineering gates passed, runtime QA status remains unknown verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Engineering gates passed, runtime QA status remains unknown"'), /verification\.policy must not contain pending/u],
    ['no affirmative runtime QA verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Engineering gates passed."'), /must affirmatively state completed runtime QA/u],
    ['missing verification commits', (m) => removeYamlSectionField(removeYamlSectionField(m, 'verification', 'product_commit'), 'verification', 'verified_commit'), /verification\.product_commit or verification\.verified_commit is required/u],
    ['short commit deadbeef in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed; Verified commit deadbeef under docs/qa/issue-131/RUNTIME-QA-STABLE.md"'), /Mismatched(?: product)? commit SHA/u],
    ['Markdown backtick Verified commit in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA completed. Verified commit `deadbeef`"'), /Mismatched(?: product)? commit SHA/u],
    ['parenthesized backtick commit in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA completed; commit (`deadbeef`)"'), /Mismatched(?: product)? commit SHA/u],
    ['curly-quoted verified commit in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA completed; verified commit “deadbeef”"'), /Mismatched(?: product)? commit SHA/u],
    ['Markdown bold **Commit** in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA completed; **Commit** `deadbeef`"'), /Mismatched(?: product)? commit SHA/u],
    ['verified commit SHA label in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA completed; verified commit SHA deadbeef"'), /Mismatched(?: product)? commit SHA/u],
    ['missing verification.runtime_qa for issue >= 131', (m) => removeYamlSectionField(m, 'verification', 'runtime_qa'), /Explicit verification\.runtime_qa: PASSED is required/u],
    ['PENDING verification.runtime_qa for issue >= 131', (m) => setYamlSectionField(m, 'verification', 'runtime_qa', 'PENDING'), /Explicit verification\.runtime_qa: PASSED is required/u],
    ['FAILED verification.runtime_qa for issue >= 131', (m) => setYamlSectionField(m, 'verification', 'runtime_qa', 'FAILED'), /Explicit verification\.runtime_qa: PASSED is required/u],
    ['Once runtime QA completed in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Once the runtime QA is completed, we can sign off"'), /verification\.policy must not contain pending/u],
    ['Engineering review passed for runtime QA plan in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Engineering review passed for the runtime QA plan"'), /verification\.policy must not contain pending/u],
    ['Engineering review passed for runtime QA checklist in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Engineering review passed for the runtime QA checklist"'), /must affirmatively state completed runtime QA/u],
    ['No sign yet runtime QA example in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"No sign yet, runtime QA passed only in the example"'), /verification\.policy must not contain pending/u],
    ['Issue 131 historical mask ENGINEERING_PASS not VERIFIED disallowed', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed; ENGINEERING_PASS, not VERIFIED."'), /verification\.policy must not contain pending/u],
    ['colon commit:deadbeef in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed; verified commit:deadbeef"'), /Mismatched(?: product)? commit SHA/u],
    ['equals commit=deadbeef in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed; commit=deadbeef"'), /Mismatched(?: product)? commit SHA/u],
    ['labeled commit SHA=deadbeef in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed; commit SHA=deadbeef"'), /Mismatched(?: product)? commit SHA/u],
    ['plural commits deadbeef and cafebabe in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed; commits deadbeef and cafebabe"'), /Mismatched product commit SHA/u],
    ['missing verification.dsh', (m) => removeYamlSectionField(m, 'verification', 'dsh'), /verification\.dsh must match runtime_basis\.dsh/u],
    ['wrong verification.dsh', (m) => setYamlSectionField(m, 'verification', 'dsh', '0.2.1-rc.5'), /verification\.dsh must match runtime_basis\.dsh/u],
    ['POST_RELEASE_VERIFIED state disallowed on 0.7.0', (m) => setYamlSectionField(m, 'verification', 'state', 'POST_RELEASE_VERIFIED'), /Explicit positive verification\.state/u],
    ['simulator runtime QA disallowed', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed in a simulator."'), /verification\.policy must not contain pending/u],
    ['test double runtime QA disallowed', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed in a test double."'), /verification\.policy must not contain pending/u],
    ['wrong DSH version in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA on DSH 0.2.1-rc.5 has passed."'), /Mismatched DSH version 0\.2\.1-rc\.5/u],
    ['Post-release verification disallowed on 0.7.0', (m) => setYamlSectionField(m, 'verification', 'policy', '"Post-release verification passed."'), /verification\.policy must not contain pending/u],
    ['unparenthesized stop-condition not mask disallowed', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed, both stop conditions not hit."'), /verification\.policy must not contain pending/u],
    ['engineering gates stop-condition not paren disallowed', (m) => setYamlSectionField(m, 'verification', 'policy', '"Engineering gates passed (both stop conditions not hit); Runtime QA passed."'), /verification\.policy must not contain pending/u],
    ['engineering gates custom parens disallowed', (m) => setYamlSectionField(m, 'verification', 'policy', '"Engineering gates passed (custom note); Runtime QA passed."'), /verification\.policy contains unrecognized clause/u],
    ['only replayed fixtures disallowed', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed; only replayed fixtures."'), /verification\.policy contains unrecognized clause/u],
    ['parenthesized mismatched DSH clause disallowed', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed; (on DSH 0.2.1-rc.5)."'), /Mismatched DSH version 0\.2\.1-rc\.5/u],
    ['parenthesized matching DSH clause disallowed', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed; (on DSH 0.2.2-rc.5)."'), /verification\.policy contains unrecognized clause/u],
    ['comma-and commit list deadbeef bypass disallowed', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed; commits 0123456, and deadbeef"'), /Mismatched product commit SHA deadbeef/u],
    ['Oxford-comma commit list deadbeef bypass disallowed', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed; commits 0123456, deadbeef, and cafebabe"'), /Mismatched product commit SHA deadbeef/u],
    ['glued parenthesized commitdeadbeef disallowed', (m) => setYamlSectionField(m, 'verification', 'policy', '"Runtime QA passed (commitdeadbeef)."'), /Malformed commit SHA reference|Mismatched(?: product)? commit SHA/u],
    ['engineering_issue 129 with work/131 rejected', (m) => setYamlSectionField(setYamlSectionField(setYamlSectionField(m, 'approval', 'product_owner', 'po-approved-2026-11-22'), 'approval', 'engineering_issue', '129'), 'source', 'engineering_issue', '129'), /source\.work_branch .* must match engineering_issue #129/u],
    ['400-digit engineering_issue rejected', (m) => setYamlSectionField(setYamlSectionField(setYamlSectionField(m, 'approval', 'product_owner', 'po-approved-2026-11-22'), 'approval', 'engineering_issue', '9'.repeat(400)), 'source', 'engineering_issue', '9'.repeat(400)), /positive integer without leading zeros/u],
    ['aligned 400-digit engineering_issue and work_branch rejected', (m) => setYamlSectionField(setYamlSectionField(setYamlSectionField(setYamlSectionField(setYamlSectionField(setYamlSectionField(m, 'approval', 'product_owner', 'po-approved-2026-11-22'), 'approval', 'engineering_issue', '9'.repeat(400)), 'source', 'engineering_issue', '9'.repeat(400)), 'approval', 'work_branch', `work/${'9'.repeat(400)}-stable`), 'source', 'work_branch', `work/${'9'.repeat(400)}-stable`), 'verification', 'policy', '"Runtime QA passed"'), /positive integer without leading zeros/u],
    ['stale Private Issue #129 in verification.policy', (m) => setYamlSectionField(m, 'verification', 'policy', '"Verified under Private Issue #129"'), /Stale or mismatched issue reference #129 in verification\.policy/u],
    ['mismatched verification.verified_commit', (m) => setYamlSectionField(m, 'verification', 'verified_commit', 'ffffffffffffffffffffffffffffffffffffffff'), /verification\.verified_commit must match source\.product_commit/u],
    ['escaped BOM in quoted product_owner', (m) => setYamlSectionField(m, 'approval', 'product_owner', '"po-approved\\ufeff"'), /Unsupported invisible\/BOM format character/u],
    ['escaped BOM in quoted work_branch', (m) => setYamlSectionField(setYamlSectionField(m, 'approval', 'work_branch', '"work/131\\ufeff"'), 'source', 'work_branch', '"work/131\\ufeff"'), /Unsupported invisible\/BOM format character/u],
    ['whitespace-only quoted work_branch', (m) => setYamlSectionField(setYamlSectionField(m, 'approval', 'work_branch', '"   "'), 'source', 'work_branch', '"   "'), /must be a non-empty string/u],
    ['invisible ZWSP in work_branch', (m) => setYamlSectionField(setYamlSectionField(m, 'approval', 'work_branch', '"work/\\u200b"'), 'source', 'work_branch', '"work/\\u200b"'), /Unsupported invisible\/BOM format character/u],
  ]) {
    const repo = setupPublishRepo(t, {
      version: '0.7.0',
      branch: 'main',
      distTag: 'latest',
      previousLatest: '0.6.0',
      manifestOverride: mutator(buildApprovedManifest({ version: '0.7.0', branch: 'main', distTag: 'latest', previousLatest: '0.6.0' })),
    })
    assert.throws(
      () =>
        repo.runPolicy({
          STUB_FETCH_STATUS: '404',
          STUB_NPM_TAGS: JSON.stringify({ latest: '0.6.0' }),
        }),
      expectedErr,
      `publish.yml must reject ${label}`,
    )
  }

  // Round 11-12 P2-7/P3-2: pre-existing real-shaped 40-hex SHAs across approval/source/verification in baseManifest are cleanly overwritten by buildApprovedManifest
  const preSeededBase = setYamlSectionField(
    setYamlSectionField(
      setYamlSectionField(
        setYamlSectionField(
          setYamlSectionField(
            setYamlSectionField(baseManifest, 'approval', 'tl_reviewed_product_commit', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
            'source',
            'product_commit',
            'cafebabecafebabecafebabecafebabecafebabe',
          ),
          'verification',
          'product_commit',
          '1111111111111111111111111111111111111111',
        ),
        'verification',
        'verified_commit',
        '2222222222222222222222222222222222222222',
      ),
      'verification',
      'runtime_qa',
      'PENDING',
    ),
    'verification',
    'dsh',
    '0.2.1-rc.5',
  )
  const seededRepo = setupPublishRepo(t, {
    version: '0.7.0',
    branch: 'main',
    distTag: 'latest',
    previousLatest: '0.6.0',
    manifestOverride: buildApprovedManifest({
      version: '0.7.0',
      branch: 'main',
      distTag: 'latest',
      previousLatest: '0.6.0',
      baseText: preSeededBase,
    }),
  })
  assert.doesNotThrow(() =>
    seededRepo.runPolicy({
      STUB_FETCH_STATUS: '404',
      STUB_NPM_TAGS: JSON.stringify({ latest: '0.6.0' }),
    }),
  )

  // Round 18-19 P2-1/P2-2: explicit parenthesized stop-condition notes, mixed commit separators, and comma-separated upstream tracking pass publish policy
  for (const validR19Policy of [
    '"Runtime QA passed (both stop conditions not hit); commit:0123456; commit SHA=0123456."',
    '"Runtime QA passed (commit:0123456; both stop conditions not hit)."',
    '"Runtime QA passed; commits 0123456 & 01234567, and 012345678."',
    '"Runtime QA passed; upstream issue #105, and #62 remain open."',
  ]) {
    const r19ValidRepo = setupPublishRepo(t, {
      version: '0.7.0',
      branch: 'main',
      distTag: 'latest',
      previousLatest: '0.6.0',
      manifestOverride: setYamlSectionField(
        buildApprovedManifest({ version: '0.7.0', branch: 'main', distTag: 'latest', previousLatest: '0.6.0' }),
        'verification',
        'policy',
        validR19Policy,
      ),
    })
    assert.doesNotThrow(() =>
      r19ValidRepo.runPolicy({
        STUB_FETCH_STATUS: '404',
        STUB_NPM_TAGS: JSON.stringify({ latest: '0.6.0' }),
      }),
    )
  }
})
