import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const catalog = read('../data/pi086-responses-models.json')
const probe = read('../data/step0c-route-086.json')
const providers = ['openai', 'xai', 'github-copilot', 'lcx', 'relay']
const models = [
  'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-astra',
  'gpt-6-sol', 'gpt-6-luna', 'grok-4.6', 'grok-4.7',
]
const matrix = {}
let observedCells = 0
for (const shape of ['omitted', 'explicit']) {
  matrix[shape] = {}
  for (const provider of providers) {
    matrix[shape][provider] = {}
    for (const model of models) {
      // The 0.86 probe established that explicit Responses profiles route by
      // model prefix, while credential-only profiles depend on this 0.86 catalog.
      const responses = shape === 'explicit' || (catalog[provider]?.includes(model) ?? false)
      const gpt = model.startsWith('gpt-') && responses
      const grok = model.startsWith('grok') && responses
      const key = `${provider} ${model}`
      const observed = Object.entries(probe[shape]).find(([label]) => label === key || label.startsWith(`${key} (`))?.[1]
      if (observed) {
        assert.deepEqual(observed, { gpt, grok }, `0.86 probe disagrees: ${shape} ${key}`)
        observedCells += 1
      }
      matrix[shape][provider][model] = {
        gpt, grok,
        request: gpt ? 'managed-gpt' : grok ? 'grok-native' : model.startsWith('gpt-') ? 'fail-closed' : 'passthrough',
        compaction: gpt ? 'native-v2' : model.startsWith('gpt-') ? 'fail-closed' : 'passthrough',
      }
    }
  }
}
assert.ok(observedCells >= 14, 'Step 0(c) probe coverage was lost')
const output = `${JSON.stringify(matrix, null, 2)}\n`
const outputPath = new URL('../data/model-scope-086-matrix.json', import.meta.url)
if (process.argv.includes('--check'))
  assert.equal(readFileSync(outputPath, 'utf8'), output, 'Frozen Pi 0.86 matrix drifted from Step 0(c) probe and catalog')
else writeFileSync(outputPath, output)
