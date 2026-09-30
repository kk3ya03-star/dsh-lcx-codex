import { build } from 'esbuild'
import { writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

// Exercise changed source while the atomic port deliberately leaves lib/ untouched.
export async function loadHostSource(entry) {
  const output = resolve(`.wp2-${entry}-${process.pid}.mjs`)
  const result = await build({
    entryPoints: [resolve(`src/${entry}.ts`)],
    bundle: true,
    packages: 'external',
    format: 'esm',
    platform: 'node',
    target: 'node24',
    write: false,
  })
  await writeFile(output, result.outputFiles[0].contents)
  try {
    return await import(new URL(`../.wp2-${entry}-${process.pid}.mjs`, import.meta.url))
  } finally {
    await unlink(output)
  }
}

export async function loadClientSource() {
  const result = await build({
    entryPoints: [resolve('src/client/index.tsx')],
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    platform: 'browser',
    target: 'es2022',
    write: false,
  })
  return result.outputFiles[0].text
}
