import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const script = resolve('scripts/probe-tool-updates.mjs')
const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], {
  encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, timeout: 20000,
})

test('live tool-update probe: --dry-run prints the wire shapes without a key or network', () => {
  const result = run(['--dry-run'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /"type": "additional_tools"/u)
  assert.match(result.stdout, /"type": "tool_search_output"/u)
  assert.match(result.stdout, /ACCEPTANCE: all checks passed/u)
})

test('live tool-update probe refuses to run without a model or a key file and never prints key material', () => {
  const noModel = run([])
  assert.notEqual(noModel.status, 0)
  assert.match(noModel.stderr, /LCX_MODEL/u)
  const noKey = run([], { LCX_MODEL: 'gpt-6-sol' })
  assert.notEqual(noKey.status, 0)
  assert.match(noKey.stderr, /LCX_API_KEY_FILE/u)
  assert.doesNotMatch(noKey.stdout + noKey.stderr, /Bearer/u)
})

test('the live probe is opt-in: it is not part of the npm test glob', async () => {
  const { readFileSync } = await import('node:fs')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts['probe:tool-updates'], 'node scripts/probe-tool-updates.mjs')
  assert.match(pkg.scripts.test, /tests\/\*\.test\.mjs/u)
})
