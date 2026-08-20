import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ALPHA_SEARCH_OUTPUT, ALPHA_SEARCH_PARAMETERS } from '../lib/web-search-alpha.js'
import { HOSTED_SEARCH_OUTPUT, HOSTED_SEARCH_PARAMETERS } from '../lib/web-search-hosted.js'

async function dshTools() {
  try {
    return await import('@deepseek-ai/dsh-tools')
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
    const root = process.platform === 'win32'
      ? process.env.npm_config_prefix
        ? join(process.env.npm_config_prefix, 'node_modules')
        : join(process.env.APPDATA ?? '', 'npm', 'node_modules')
      : execFileSync('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true }).trim()
    const entry = join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')
    return import(pathToFileURL(entry).href)
  }
}

const { assertSupportedJsonSchema } = await dshTools()
for (const [name, schema] of Object.entries({
  HOSTED_SEARCH_PARAMETERS,
  HOSTED_SEARCH_OUTPUT,
  ALPHA_SEARCH_PARAMETERS,
  ALPHA_SEARCH_OUTPUT,
})) {
  assertSupportedJsonSchema(schema)
  process.stdout.write(`${name}: ok\n`)
}
