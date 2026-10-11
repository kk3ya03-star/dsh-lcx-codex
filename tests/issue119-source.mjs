import { build } from 'esbuild'
import { writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

let counter = 0

/**
 * Bundle `src/<entry>.ts` (packages external) and re-export module-private names so a test can
 * drive internals such as `managedResponsesStream` through the real DSH classes.
 * @param {string} entry
 * @param {string} [footerExports] comma separated names to export
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
    ...(footerExports ? { footer: { js: `\nexport { ${footerExports} };` } } : {}),
  })
  const output = resolve(`.issue119-${entry.replaceAll('/', '_')}-${process.pid}-${counter++}.mjs`)
  await writeFile(output, result.outputFiles[0].contents)
  try {
    return await import(pathToFileURL(output).href)
  } finally {
    await unlink(output)
  }
}

export function sseResponse(events, status = 200) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}

export async function collect(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}
