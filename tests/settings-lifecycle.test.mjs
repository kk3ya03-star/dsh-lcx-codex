import test from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import apply from '../lib/index.js'

class WebFixture extends Service {
  constructor(ctx) {
    super(ctx, 'web')
    this.providers = new Set()
    this.registerCalls = 0
  }

  registerSearchProvider(provider) {
    this.registerCalls += 1
    this.ctx.effect(() => {
      this.providers.add(provider)
      return () => this.providers.delete(provider)
    })
  }
}

class SettingsFixture extends Service {
  constructor(ctx) {
    super(ctx, 'settings')
    this.namespaces = new Set()
    this.registerCalls = 0
  }

  installSection(_owner, namespace, _schema, entry, hooks) {
    this.registerCalls += 1
    this.ctx.effect(() => {
      this.namespaces.add(namespace)
      hooks.setSource(() => entry)
      hooks.onChange()
      return () => this.namespaces.delete(namespace)
    })
  }
}

async function settlePlugins(ctx) {
  await Promise.all([...ctx.registry.values()].flatMap(runtime => [...runtime.fibers].map(fiber => fiber.await())))
}

const listenerEvents = [
  'session/disposed',
  'session/event',
  'tools/execute',
  'agent/created',
  'agent/status',
  'llm/stream',
]

function assertListenerCounts(ctx, expected) {
  for (const event of listenerEvents) {
    assert.equal(ctx.events._hooks[event]?.length ?? 0, expected, `${event} listener count`)
  }
}

test('plugin waits for required services, initializes once and cleanly re-enables', async () => {
  const ctx = new Context()
  // Real hosts provide services from sibling plugins, not the root fiber.
  let web
  await ctx.plugin((services) => {
    services.provide('llm', {})
    web = new WebFixture(services)
    services.provide('sessions', { list: () => [] })
    services.provide('tools', { register: () => {} })
    services.provide('credentials', { resolve: async () => undefined })
    services.provide('attachments', {})
    services.provide('fs', {})
  })

  const first = ctx.plugin(apply)
  assert.equal(web.registerCalls, 0, 'plugin waits for its route settings service')
  let settings
  await ctx.plugin((services) => { settings = new SettingsFixture(services) })
  await first
  await settlePlugins(ctx)

  assert.equal(web.registerCalls, 1, 'required service dependencies initialize once')
  assert.equal(web.providers.size, 1)
  assertListenerCounts(ctx, 1)

  assert.equal(settings.registerCalls, 1, 'settings section mounts after the required provider is available')
  assert.deepEqual([...settings.namespaces], ['lcx-codex'])

  await first.dispose()
  assert.equal(web.providers.size, 0)
  assert.equal(settings.namespaces.size, 0)
  assertListenerCounts(ctx, 0)

  const second = ctx.plugin(apply)
  await second
  await settlePlugins(ctx)

  assert.equal(web.registerCalls, 2)
  assert.equal(web.providers.size, 1, 're-enable leaves one provider registration')
  assert.equal(settings.registerCalls, 2)
  assert.deepEqual([...settings.namespaces], ['lcx-codex'], 're-enable leaves one settings namespace registration')
  assertListenerCounts(ctx, 1)

  await second.dispose()
  assert.equal(web.providers.size, 0)
  assert.equal(settings.namespaces.size, 0)
  assertListenerCounts(ctx, 0)
})
