import { build } from 'esbuild'
import { writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

let counter = 0

/**
 * Bundle `src/<entry>.ts` (packages external) and import it, so a test exercises the changed source rather
 * than `lib/`. `footerExports` (comma separated names) re-exports module-private names for tests that drive
 * internals such as `managedResponsesStream` through the real DSH classes.
 */
export async function loadSource(entry, footerExports) {
  const result = await build({
    entryPoints: [resolve(`src/${entry}.ts`)],
    bundle: true,
    packages: 'external',
    format: 'esm',
    platform: 'node',
    target: 'node24',
    write: false,
    ...(footerExports ? { footer: { js: `
export { ${footerExports} };` } } : {}),
  })
  const output = resolve(`.src-${entry.replaceAll('/', '_')}-${process.pid}-${counter++}.mjs`)
  await writeFile(output, result.outputFiles[0].contents)
  try {
    return await import(pathToFileURL(output).href)
  } finally {
    await unlink(output)
  }
}

export const loadHostSource = entry => loadSource(entry)

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
