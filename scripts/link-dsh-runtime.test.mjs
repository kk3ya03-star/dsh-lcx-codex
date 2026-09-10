import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'

test('runtime linking preserves local build dependencies and is repeatable', t => {
  const output = fileURLToPath(new URL('../output/', import.meta.url))
  mkdirSync(output, { recursive: true })
  const root = mkdtempSync(join(output, 'lcx-runtime-link-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const runtime = join(root, 'scripts/runtime-dsh015')
  mkdirSync(runtime, { recursive: true })
  copyFileSync(new URL('./link-dsh-runtime.mjs', import.meta.url), join(root, 'scripts/link-dsh-runtime.mjs'))
  const write = (path, json) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(json)) }
  write(join(root, 'package.json'), {
    type: 'module', devDependencies: { '@deepseek-ai/dsh': '0.1.5-alpha.2', '@earendil-works/pi-ai': '0.85.1', 'local-build-tool': '1.0.0' },
    peerDependencies: { '@deepseek-ai/dsh-session': '0.1.5-alpha.2' },
  })
  write(join(runtime, 'package.json'), { private: true })
  for (const [name, version] of Object.entries({
    '@deepseek-ai/dsh': '0.1.5-alpha.2', '@deepseek-ai/dsh-session': '0.1.5-alpha.2',
    '@deepseek-ai/dsh-llm-pi-ai': '0.1.5-alpha.2', '@earendil-works/pi-ai': '0.85.1', '@deepseek-ai/cosmokit': '1.0.0',
  })) write(join(runtime, 'node_modules', name, 'package.json'), { name, version })
  const local = join(root, 'node_modules/local-build-tool')
  write(join(local, 'package.json'), { name: 'local-build-tool', version: '1.0.0' })
  const before = readFileSync(join(local, 'package.json'))
  const run = () => execFileSync(process.execPath, ['scripts/link-dsh-runtime.mjs'], { cwd: root })
  run()
  assert.equal(lstatSync(local).isSymbolicLink(), false)
  assert.deepEqual(readFileSync(join(local, 'package.json')), before)
  const host = join(root, 'node_modules/@deepseek-ai/dsh-session')
  assert.equal(realpathSync(host), realpathSync(join(runtime, 'node_modules/@deepseek-ai/dsh-session')))
  run()
  assert.ok(existsSync(join(local, 'package.json')))
  assert.deepEqual(readFileSync(join(local, 'package.json')), before)
})
