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

  register(namespace) {
    this.registerCalls += 1
    this.ctx.effect(() => {
      this.namespaces.add(namespace)
      return () => this.namespaces.delete(namespace)
    })
    return { get: () => ({}), watch: () => () => {} }
  }
}

async function settlePlugins(ctx) {
  await Promise.all([...ctx.registry.values()].flatMap(runtime => [...runtime.fibers].map(fiber => fiber.await())))
}

const listenerEvents = [
  'session/created',
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

test('plugin dependencies initialize once, cleanly re-enable, and late-mount settings', async () => {
  const ctx = new Context()
  ctx.provide('llm', {})
  const web = new WebFixture(ctx)
  ctx.provide('sessions', { list: () => [] })
  ctx.provide('tools', { register: () => {} })

  const first = ctx.plugin(apply)
  await first
  await settlePlugins(ctx)

  assert.equal(web.registerCalls, 1, 'plugin-level llm/web/sessions dependencies initialize once')
  assert.equal(web.providers.size, 1)
  assertListenerCounts(ctx, 1)

  const settings = new SettingsFixture(ctx)
  await settlePlugins(ctx)
  assert.equal(settings.registerCalls, 1, 'settings provider mounts after the plugin is active')
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
