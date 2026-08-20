import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8')

test('installation package contains only runtime and user-facing files', () => {
  assert.deepEqual(packageJson.files, [
    'lib/*.js',
    'scripts/probe-alpha.mjs',
    'cordis.patch.yml',
    'LICENSE',
    'README.md',
    'CHANGELOG.md',
  ])
  assert.deepEqual(packageJson.engines, { node: '>=20' })
  assert.deepEqual(packageJson.publishConfig, { access: 'public' })
  assert.deepEqual(packageJson.keywords, [
    'deepseek-harness',
    'dsh',
    'dsh-plugin',
    'plugin',
    'web-search',
    'openai-responses',
    'sub2api',
    'newapi',
    'compaction',
  ])
  assert.equal(Object.hasOwn(packageJson, 'dshhub'), false)
  assert.deepEqual(packageJson.repository, {
    type: 'git',
    url: 'git+https://github.com/kk3ya03-star/dsh-lcx-codex.git',
  })
  assert.equal(packageJson.homepage, 'https://github.com/kk3ya03-star/dsh-lcx-codex#readme')
  assert.deepEqual(packageJson.bugs, { url: 'https://github.com/kk3ya03-star/dsh-lcx-codex/issues' })
})

test('public wording identifies the compatibility boundary without official affiliation claims', () => {
  assert.match(readme, /社区维护/iu)
  assert.match(readme, /`LCX` 只是插件名称/iu)
  assert.match(readme, /不隶属于 OpenAI，也不是 OpenAI 官方发布/iu)
  assert.match(readme, /OpenAI Responses\/Codex-compatible upstream/iu)
  assert.match(readme, /Sub2API 反代的 GPT 模型/iu)
  assert.match(readme, /NewAPI 中转的 GPT 模型/iu)
  assert.match(readme, /也就是第三方中转/iu)
  assert.match(readme, /accTitle: dsh-lcx-codex 技术路线/iu)
  assert.match(readme, /POST \/responses \+ web_search/iu)
  assert.match(readme, /POST \/alpha\/search/iu)
  assert.match(readme, /stream \+ compaction_trigger/iu)
  assert.match(readme, /Alpha Search 有 5 种可用部署路径/iu)
  assert.match(readme, /`Sub2API`、`New API`、`ChatGPT Subscription \(Codex\)`、`Advanced Custom`/iu)
  assert.match(readme, /普通 `OpenAI` 渠道不支持/iu)
  assert.match(readme, /复用当前 DSH 模型的 provider、model、Responses 地址、凭据引用/iu)
  assert.match(readme, /正常运行不需要再给插件配置一份 `LCX_API_KEY`/iu)
  assert.match(readme, /探针需要本机 key 文件/iu)
  assert.doesNotMatch(readme, /ChatGPT OAuthGPT\/Codex/iu)
  assert.doesNotMatch(readme, /remain pending/iu)
  assert.doesNotMatch(readme, /\]\((?:ACCEPTANCE|AGENTS|CLAUDE|DESIGN|DEVELOPMENT-PLAN|ERRORS|GOVERNANCE|RESEARCH)\.md\)/iu)
  assert.match(readme, /dsh plugin --profile web add dsh-lcx-codex/iu)
  assert.match(readme, /https:\/\/www\.npmjs\.com\/package\/dsh-lcx-codex/iu)
  assert.match(readme, /推荐从 npm 安装/iu)
  assert.doesNotMatch(readme, /npm registry 尚未发布/iu)
  assert.match(readme, /dsh plugin --profile web add \.\\dsh-lcx-codex-0\.3\.1\.tgz/iu)
  assert.match(readme, /dsh plugin --profile web update dsh-lcx-codex/iu)
  assert.match(readme, /dsh plugin --profile web remove dsh-lcx-codex/iu)
  assert.match(readme, /网络目标由当前活动 DSH `openai-responses` provider 的 `baseURL` 决定/iu)
  assert.match(readme, /不固定到 LCX 或其他域名/iu)
  assert.match(readme, /只在该地址下调用 `\/responses` 和 `\/alpha\/search`/iu)
  assert.match(readme, /凭据名称取自同一 provider 的 `apiKeyEnv`/iu)
  assert.match(readme, /DSH credentials service 解析/iu)
  assert.match(packageJson.description, /Sub2API.*NewAPI/iu)
  assert.doesNotMatch(packageJson.description, /LCX\/Sub2API/iu)
  assert.doesNotMatch(clientSource, /GPT(?:-native| 专属原生) search|GPT 专属原生搜索/iu)
})

test('real credentials and runtime artifacts are ignored at the source boundary', () => {
  for (const pattern of [
    'output/',
    '.playwright-cli/',
    'test-results/',
    'artifacts/',
    'screenshots/',
    'session-exports/',
    'service-logs/',
    'work/',
    'test-secrets/',
    'secrets/',
    '*.key',
    '*.pem',
    'checkpoints-v*.json',
    'alpha-refs*.json',
    'web-alpha-*.json',
    '*.har',
    '*.trace.zip',
    '*.session-export.json',
  ]) {
    assert.equal(gitignore.split(/\r?\n/u).includes(pattern), true, `missing ignore rule: ${pattern}`)
  }
})

test('public Git tree excludes internal records and includes an MIT license', () => {
  const tracked = execFileSync('git', ['ls-files'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).split(/\r?\n/u).filter(Boolean)
  const allowedRootFiles = new Set([
    '.gitattributes',
    '.gitignore',
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'cordis.patch.yml',
    'package.json',
    'pnpm-lock.yaml',
  ])
  const unexpected = tracked.filter((path) => {
    if (allowedRootFiles.has(path)) return false
    if (/^lib\/[^/]+\.js$/u.test(path)) return false
    if (/^scripts\/(?:probe-alpha|validate-dsh-schema)\.mjs$/u.test(path)) return false
    if (/^tests\/[^/]+\.test\.mjs$/u.test(path)) return false
    return true
  })

  assert.deepEqual(unexpected, [])
  assert.equal(existsSync(new URL('../LICENSE', import.meta.url)), true)
  assert.equal(packageJson.license, 'MIT')
})
