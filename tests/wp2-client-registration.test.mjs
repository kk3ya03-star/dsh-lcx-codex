import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { loadClientSource, loadHostSource } from './wp2-source.mjs'

const [clientSource, host] = await Promise.all([loadClientSource(), loadHostSource('index')])

function createSnapshotStore(initial) {
  let snapshot = initial
  const listeners = new Set()
  const publish = next => { snapshot = next; for (const listener of listeners) listener() }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    set: publish,
    update(change) { const draft = structuredClone(snapshot); change(draft); publish(draft) },
  }
}

function clientModule(source) {
  let exports
  vm.runInNewContext(source, {
    navigator: { language: 'en' },
    window: { __ModuleLoader__: { load({ factory }) {
      exports = factory(name => {
        if (name === '@deepseek-ai/cordis') return { Service: (awaitCordis()).Service }
        if (name === '@deepseek-ai/dsh-client-store') return { createSnapshotStore }
        if (name === 'react') return { createElement: () => null, useEffect: () => {}, useState: () => [false, () => {}] }
        throw new Error(`Unexpected import: ${name}`)
      })
    } } },
  })
  return exports
}

// Keep the real Cordis constructor identical across the two installed client bundles.
import * as Cordis from '@deepseek-ai/cordis'
function awaitCordis() { return Cordis }

test('real DSH ConfigForms lets LCX register settings, usage and media slots', async () => {
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(metadata.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  const ctx = new Context()
  const registrations = []
  const definitions = []
  const values = {
    enabled: false, webSearch: false, advancedHostedSearch: false,
    alphaSearch: false, grokNativeWebSearch: false, grokNativeXSearch: false,
    searchMediaPreview: false,
  }
  ctx.provide('remote', {
    $host: { isLoopback: true },
    $on: () => () => {},
    settings: {
      describe: async () => ({ ok: true, value: {
        writable: true, hasDocument: true,
        namespaces: [{ ns: 'lcx-codex', autoGenerate: false, schema: host.Config.toJSON(), value: values, revision: 0, applies: 'live', secrets: [] }],
      } }),
      mutate: async () => ({ ok: true, value: {} }),
    },
  }, true)
  ctx.provide('slots', {
    inject(_name, register) { register(); return () => {} },
    register(options) { registrations.push(options.id ?? options.name); return () => {} },
  }, true)
  ctx.provide('locale', { register: () => () => {} }, true)
  ctx.provide('uiConversation', { events: { register(definition) { definitions.push(definition.kind); return () => {} } } }, true)
  const settings = clientModule(readFileSync(new URL('../node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js', import.meta.url), 'utf8'))
  settings.apply(ctx)
  assert.equal(typeof ctx.configForms.get, 'function')
  clientModule(clientSource).apply(ctx)
  await ctx.configForms.describe().ensure()
  assert.equal(ctx.configForms.get('lcx-codex').getSnapshot().status, 'ready')
  assert.ok(registrations.includes('plugins.bundle.config'))
  assert.ok(registrations.includes('conversation.chat.node'))
  assert.ok(registrations.includes('lcx-search-usage-turn'))
  assert.ok(registrations.includes('lcx-search-usage-session'))
  assert.ok(definitions.includes('lcx-search-media'))
})
