import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function fixture(browserLanguage = 'en', activeLanguage = 'en') {
  let client, injection, snapshot, listener, render
  const dictionaries = new Map(), disposers = []
  let localeNamespace
  const values = { enabled: false, webSearch: false, advancedHostedSearch: false, alphaSearch: false }
  const writes = []
  const scope = {
    status: 'ready', writable: true,
    bind() { return this },
    subscribe(fn) { listener = fn; return () => {} },
    getSnapshot() { return { status: this.status, writable: this.writable, value: { ...values } } },
    async mutate(ops) {
      writes.push(structuredClone(ops))
      if (this.beforeWrite) await this.beforeWrite()
      Object.assign(values, Object.fromEntries(ops.map(op => [op.path[0], op.value])))
      listener()
    },
  }
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    navigator: { language: browserLanguage },
    window: { __ModuleLoader__: { load({ factory }) {
      client = factory(name => {
        if (name === 'react') return {
          createElement: (type, props, ...children) => ({ type, props, children }),
          useState: () => [true, () => {}],
        }
        if (name === '@deepseek-ai/dsh-client-store') return { createSnapshotStore(value) {
          snapshot = value
          return { set(next) { snapshot = next } }
        } }
        throw new Error(`Unexpected client import: ${name}`)
      })
    } } },
  })
  client.apply({
    locale: { register(namespace, language, dict) {
      assert.equal(namespace, 'lcx-codex')
      dictionaries.set(language, dict)
      return () => dictionaries.delete(language)
    } },
    settingsScope: scope,
    slots: {
      inject(_slot, callback) { callback() },
      register(definition, component) { localeNamespace = definition.locale; injection = definition.inject(); render = component },
    },
    effect(setup) { disposers.push(setup()) },
  })
  return {
    injection, scope, values, writes,
    state: () => snapshot,
    refresh: () => listener(),
    render: () => render({ ...injection, t: key => dictionaries.get(activeLanguage)?.[key] ?? dictionaries.get('en')[key], useLcxCard: () => snapshot }),
    setLocale: language => { activeLanguage = language },
    localeNamespace: () => localeNamespace,
    dictionaries,
    dispose: () => disposers.reverse().forEach(dispose => dispose()),
    async save() { injection.save(); await new Promise(resolve => setImmediate(resolve)) },
  }
}

test('client delegates locale to the DSH slot and preserves drafts across language changes', () => {
  const f = fixture('zh-CN', 'en')
  assert.equal(f.localeNamespace(), 'lcx-codex')
  assert.deepEqual(Object.keys(f.dictionaries.get('zh')).sort(), Object.keys(f.dictionaries.get('en')).sort())
  assert.match(JSON.stringify(f.render()), /Responses \/ Codex capabilities/)
  f.injection.edit('enabled', true)
  f.setLocale('zh')
  assert.doesNotMatch(JSON.stringify(f.render()), /Responses \/ Codex capabilities/)
  assert.equal(f.state().enabled.value, true)
  assert.equal(f.state().dirty, true)
  f.setLocale('unregistered')
  assert.match(JSON.stringify(f.render()), /Responses \/ Codex capabilities/)
  f.dispose()
  assert.equal(f.dictionaries.size, 0)
})

test('client saves changed fields in one DSH atomic mutation', async () => {
  const f = fixture()
  f.injection.edit('enabled', true)
  f.injection.edit('webSearch', true)
  await f.save()
  assert.deepEqual(f.writes, [[
    { op: 'set', path: ['enabled'], value: true },
    { op: 'set', path: ['webSearch'], value: true },
  ]])
  assert.equal(f.values.enabled, true)
  assert.equal(f.values.webSearch, true)
  assert.equal(f.state().dirty, false)
  assert.equal(f.state().saveError, false)
})

test('client contains rejected saves, keeps draft and renders a safe retryable error', async () => {
  const f = fixture()
  f.scope.beforeWrite = () => { throw new Error('SECRET provider response') }
  f.injection.edit('enabled', true)
  f.injection.edit('webSearch', true)
  await f.save()
  assert.equal(f.values.enabled, false)
  assert.equal(f.values.webSearch, false)
  assert.equal(f.state().enabled.value, true)
  assert.equal(f.state().webSearch.value, true)
  assert.equal(f.state().saving, false)
  assert.equal(f.state().dirty, true)
  assert.equal(f.state().saveError, true)
  const tree = JSON.stringify(f.render())
  assert.match(tree, /"role":"alert"/)
  assert.match(tree, /Could not confirm settings/)
  assert.doesNotMatch(tree, /SECRET/)
  delete f.scope.beforeWrite
  await f.save()
  assert.equal(f.state().dirty, false)
  assert.equal(f.state().saveError, false)
})

test('client detects DSH rejection followed by fulfilled recovery, and discard uses host state', async () => {
  const f = fixture()
  f.scope.mutate = async () => f.refresh()
  f.injection.edit('enabled', true)
  await f.save()
  assert.equal(f.state().saveError, true)
  assert.equal(f.state().dirty, true)
  f.injection.discard()
  assert.equal(f.state().enabled.value, false)
  assert.equal(f.state().dirty, false)
  assert.equal(f.state().saveError, false)
})

test('client preserves unrelated host changes, skips no-ops and guards writes while saving', async () => {
  const f = fixture()
  f.injection.edit('enabled', true)
  f.values.alphaSearch = true
  f.refresh()
  let resolve
  f.scope.beforeWrite = () => new Promise(done => { resolve = done })
  await f.save()
  f.injection.edit('webSearch', true)
  f.injection.discard()
  await f.save()
  assert.equal(f.writes.length, 1)
  assert.equal(f.state().saving, true)
  resolve()
  await new Promise(done => setImmediate(done))
  assert.deepEqual(f.writes[0], [{ op: 'set', path: ['enabled'], value: true }])
  assert.equal(f.values.alphaSearch, true)
  assert.equal(f.values.webSearch, false)
  f.injection.edit('webSearch', true)
  f.injection.edit('webSearch', false)
  await f.save()
  assert.equal(f.writes.length, 1)
  assert.equal(f.state().dirty, false)
})

test('client blocks unavailable and read-only saves', async () => {
  const f = fixture()
  f.injection.edit('enabled', true)
  f.scope.status = 'unavailable'
  await f.save()
  f.scope.status = 'ready'
  f.scope.writable = false
  await f.save()
  assert.equal(f.writes.length, 0)
  assert.equal(f.state().dirty, true)
})
