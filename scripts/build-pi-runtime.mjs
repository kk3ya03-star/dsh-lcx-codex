import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const sourcePath = resolve('src/pi-responses-runtime.ts')
const outputPath = resolve('lib/pi-responses-runtime.js')
const forbiddenRuntime = /(?:^|[\\/])(?:@google|protobufjs|@anthropic-ai|@aws-sdk|@smithy)(?:[\\/]|$)/i
const allowedPackages = new Set(['@earendil-works/pi-ai', 'partial-json'])
const allowedCatalogs = new Set([
  'cloudflare-ai-gateway', 'github-copilot', 'openai', 'opencode', 'opencode-go', 'xai',
])

const result = await build({
  entryPoints: [sourcePath],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: outputPath,
  metafile: true,
  treeShaking: true,
  banner: {
    js: '// Generated from public @earendil-works/pi-ai@0.85.1 by scripts/build-pi-runtime.mjs. Do not edit.',
  },
})

const emittedOutput = Object.values(result.metafile.outputs).find(output =>
  Object.keys(output.inputs).some(path => path.replaceAll('\\', '/').endsWith('/src/pi-responses-runtime.ts') || path === 'src/pi-responses-runtime.ts'))
assert.ok(emittedOutput, 'Pi bundle output was not represented in the esbuild metafile')
const contributing = Object.entries(emittedOutput.inputs)
  .filter(([, value]) => value.bytesInOutput > 0)
  .map(([path]) => path.replaceAll('\\', '/'))
const forbiddenInputs = contributing.filter(path => forbiddenRuntime.test(path))
assert.deepEqual(forbiddenInputs, [], `Forbidden runtime dependency entered Pi bundle: ${forbiddenInputs.join(', ')}`)

const packageOf = path => {
  const match = path.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/u)
  return match?.[1]
}
const bundledPackages = [...new Set(contributing.map(packageOf).filter(Boolean))].sort()
assert.deepEqual(bundledPackages, [...allowedPackages].sort(), 'Unexpected third-party package entered Pi bundle')
const catalogInputs = contributing.flatMap(path => {
  const match = path.match(/\/providers\/(?:data\/)?([^/]+)\.(?:js|json)$/u)
  return match ? [match[1].replace(/\.models$/u, '')] : []
})
assert.deepEqual([...new Set(catalogInputs)].sort(), [...allowedCatalogs].sort(), 'Responses provider catalog scope drifted')
assert.ok(emittedOutput.bytes < 512 * 1024, `Pi runtime bundle exceeded 512 KiB: ${emittedOutput.bytes}`)
assert.deepEqual(emittedOutput.imports.filter(entry => entry.external), [], 'Pi bundle retained external runtime imports')
const output = await readFile(outputPath, 'utf8')
assert.doesNotMatch(output, /from\s+["']@earendil-works\/pi-ai/u, 'Pi bundle retained a production Pi import')
console.log(`Bundled ${contributing.length} contributing modules (${emittedOutput.bytes} bytes; packages: ${bundledPackages.join(', ')}) into lib/pi-responses-runtime.js`)
