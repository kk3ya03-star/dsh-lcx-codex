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
    js: '// Generated from public @earendil-works/pi-ai@1.5.0 by scripts/build-pi-runtime.mjs. Do not edit.',
  },
})

const emittedOutput = Object.values(result.metafile.outputs).find(output =>
  Object.keys(output.inputs).some(path => path.replaceAll('\\', '/').endsWith('/src/pi-responses-runtime.ts') || path === 'src/pi-responses-runtime.ts'))
assert.ok(emittedOutput, 'Pi bundle output was not represented in the esbuild metafile')
const contributing = Object.entries(emittedOutput.inputs)
  .filter(([, value]) => value.bytesInOutput > 0)
  .map(([path]) => path.replaceAll('\\', '/'))
// Pin the output-contributing closure, not esbuild's scanned (tree-shaken) input graph.
const expectedContributing = [
  "node_modules/@earendil-works/pi-ai/dist/api/constrained-sampling.js",
  "node_modules/@earendil-works/pi-ai/dist/api/github-copilot-headers.js",
  "node_modules/@earendil-works/pi-ai/dist/api/openai-prompt-cache.js",
  "node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js",
  "node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js",
  "node_modules/@earendil-works/pi-ai/dist/model-catalog.js",
  "node_modules/@earendil-works/pi-ai/dist/models.js",
  "node_modules/@earendil-works/pi-ai/dist/providers/cloudflare-ai-gateway.models.js",
  "node_modules/@earendil-works/pi-ai/dist/providers/data/cloudflare-ai-gateway.json",
  "node_modules/@earendil-works/pi-ai/dist/providers/data/github-copilot.json",
  "node_modules/@earendil-works/pi-ai/dist/providers/data/openai.json",
  "node_modules/@earendil-works/pi-ai/dist/providers/data/opencode-go.json",
  "node_modules/@earendil-works/pi-ai/dist/providers/data/opencode.json",
  "node_modules/@earendil-works/pi-ai/dist/providers/data/xai.json",
  "node_modules/@earendil-works/pi-ai/dist/providers/github-copilot.models.js",
  "node_modules/@earendil-works/pi-ai/dist/providers/openai.models.js",
  "node_modules/@earendil-works/pi-ai/dist/providers/opencode-go.models.js",
  "node_modules/@earendil-works/pi-ai/dist/providers/opencode-headers.js",
  "node_modules/@earendil-works/pi-ai/dist/providers/opencode.models.js",
  "node_modules/@earendil-works/pi-ai/dist/providers/xai.models.js",
  "node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js",
  "node_modules/@earendil-works/pi-ai/dist/utils/hash.js",
  "node_modules/@earendil-works/pi-ai/dist/utils/json-parse.js",
  "node_modules/@earendil-works/pi-ai/dist/utils/sanitize-unicode.js",
  "node_modules/@earendil-works/pi-ai/dist/utils/streaming-json.js",
  "node_modules/@earendil-works/pi-ai/dist/utils/text.js",
  "node_modules/@earendil-works/pi-ai/dist/utils/transcript.js",
  "node_modules/partial-json/dist/index.js",
  "node_modules/partial-json/dist/options.js",
  "src/pi-responses-runtime.ts"
]
assert.equal(contributing.length, 30, 'Pi output-contributing module count drifted')
assert.deepEqual([...contributing].sort(), expectedContributing, 'Pi output-contributing module list drifted')
assert.ok(contributing.some(path => path.endsWith('/utils/streaming-json.js')), 'Pi streaming JSON parser must be bundled')
assert.deepEqual(contributing.filter(path => /(?:\/telemetry\.js$|\/@earendil-works\/pi-(?:telemetry|schema)\/)/u.test(path)), [], 'Telemetry/schema runtime entered Pi bundle')
const forbiddenInputs = contributing.filter(path => forbiddenRuntime.test(path))
assert.deepEqual(forbiddenInputs, [], `Forbidden runtime dependency entered Pi bundle: ${forbiddenInputs.join(', ')}`)

const packageOf = path => {
  const match = path.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/u)
  return match?.[1]
}
const bundledPackages = [...new Set(contributing.map(packageOf).filter(Boolean))].sort()
assert.deepEqual(bundledPackages, [...allowedPackages].sort(), 'Unexpected third-party package entered Pi bundle')
// Provider helper modules that are not catalogs (the OpenCode routing header Pi adds before dispatch).
const providerHelpers = new Set(['opencode-headers'])
const catalogInputs = contributing.flatMap(path => {
  const match = path.match(/\/providers\/(?:data\/)?([^/]+)\.(?:js|json)$/u)
  const name = match?.[1].replace(/\.models$/u, '')
  return name && !providerHelpers.has(name) ? [name] : []
})
assert.deepEqual([...new Set(catalogInputs)].sort(), [...allowedCatalogs].sort(), 'Responses provider catalog scope drifted')
assert.ok(emittedOutput.bytes < 512 * 1024, `Pi runtime bundle exceeded 512 KiB: ${emittedOutput.bytes}`)
assert.deepEqual(emittedOutput.imports.filter(entry => entry.external), [], 'Pi bundle retained external runtime imports')
const output = await readFile(outputPath, 'utf8')
assert.doesNotMatch(output, /from\s+["']@earendil-works\/pi-ai/u, 'Pi bundle retained a production Pi import')
console.log(`Bundled ${contributing.length} contributing modules (${emittedOutput.bytes} bytes; packages: ${bundledPackages.join(', ')}) into lib/pi-responses-runtime.js`)
