import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const sourcePath = resolve('src/client/index.tsx')
const outputPath = resolve('lib/client.js')

await mkdir(dirname(outputPath), { recursive: true })
await build({
  entryPoints: [sourcePath],
  bundle: true,
  // DSH can concatenate client entries. Keep imported helper names private.
  format: 'iife',
  jsx: 'automatic',
  outfile: outputPath,
  platform: 'browser',
  target: 'es2022',
})
