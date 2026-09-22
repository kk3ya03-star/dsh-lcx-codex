import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Production wiring only: everything below comes from the generated client artifact
// through client.apply(), never from compiling src/client/search-usage-ui.ts directly.
const artifact = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const record = {
  requestId: 'r1', provider: 'relay', model: 'gpt-search',
  usage: { inputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 0, outputTokens: 10, totalTokens: 110 },
}
const searchTurn = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'tool/call', data: { turn: 1, callId: 'search-call', name: 'web_search', arguments: '{}' } },
  { type: 'tool/result', data: { turn: 1, meta: { auxiliaryUsage: [record] }, message: { source: { callId: 'search-call' } } } },
  { type: 'turn/end', data: { turn: 1 } },
]

function loadClient() {
  let client
  vm.runInNewContext(artifact, {
    navigator: { language: 'en' },
    window: { __ModuleLoader__: { load({ factory }) {
      client = factory(name => {
        if (name === 'react') return {
          createElement: (type, props, ...children) => ({ type, props, children }),
          useState: () => [true, () => {}],
          useEffect: () => {},
        }
        if (name === '@deepseek-ai/dsh-client-store') return { createSnapshotStore(value) {
          let current = value
          return { getSnapshot: () => current, subscribe: () => () => {}, set(next) { current = next } }
        } }
        throw new Error(`Unexpected client import: ${name}`)
      })
    } } },
  })
  return client
}

function applyClient() {
  const definitions = [], entries = [], disposers = []
  const scope = {
    bind() { return this },
    subscribe() { return () => {} },
    getSnapshot() { return { status: 'ready', writable: true, value: {} } },
    async mutate() {},
  }
  const remover = (list, entry) => () => {
    const index = list.indexOf(entry)
    if (index >= 0) list.splice(index, 1)
  }
  loadClient().apply({
    locale: { register() { return () => {} } },
    settingsScope: scope,
    uiConversation: { events: { register(definition) {
      const entry = { definition }
      definitions.push(entry)
      return remover(definitions, entry)
    } } },
    slots: {
      inject(_name, callback) { return callback() },
      register(options, component) {
        const entry = { options, component }
        entries.push(entry)
        return remover(entries, entry)
      },
    },
    effect(setup) {
      const dispose = setup()
      disposers.push(typeof dispose === 'function' ? dispose : () => {})
    },
  })
  const kinds = () => definitions.map(entry => entry.definition?.kind)
  const ids = () => entries.map(entry => entry.options?.id ?? entry.options?.key)
  return {
    kinds, ids,
    definitionOf: kind => definitions.filter(entry => entry.definition?.kind === kind).map(entry => entry.definition),
    entryOf: name => entries.filter(entry => entry.options?.name === name),
    unload() { for (const dispose of disposers.reverse()) dispose() },
  }
}

// Replays a turn through the registered definition exactly as the host conversation would.
function publish(definition) {
  let context, publication
  for (const event of searchTurn) {
    const match = { event, ...definition.match(event) }
    context = { state: match.role === 'start' ? definition.start({}, match) : definition.update(context, match) }
    publication = definition.publication(match)
  }
  return { publication, data: definition.buildLocationData(context, 'turn') }
}

test('the production client registers the usage data producer exactly once', () => {
  const client = applyClient()
  assert.deepEqual(client.definitionOf('lcx-search-usage').length, 1,
    'turn-tail usage entry has no producer for its turn-local data')
  assert.equal(client.definitionOf('lcx-search-media').length, 1)
})

test('a completed search turn publishes lcx-search-usage turn data', () => {
  const [definition] = applyClient().definitionOf('lcx-search-usage')
  const { publication, data } = publish(definition)
  assert.equal(publication, 'immediate')
  assert.equal(data.kind, 'turn')
  assert.equal(data.key, 'lcx-search-usage')
  assert.equal(data.turn, 1)
  // Identity rather than deep equality: the array is built inside the artifact's realm.
  assert.equal(data.value.length, 1)
  assert.equal(data.value[0], record)
})

test('the registered turn-tail contribution renders from the published turn data', () => {
  const client = applyClient()
  const [definition] = client.definitionOf('lcx-search-usage')
  const { data } = publish(definition)
  const [turn] = client.entryOf('conversation.chat.turnTail')
  assert.equal(turn.options.id, 'lcx-search-usage-turn')
  const rendered = turn.component({
    turn: { data: { get: key => (key === 'lcx-search-usage' ? data.value : undefined) } },
    t: key => (key === 'usageTurn' ? 'Turn search usage' : key),
  })
  assert.equal(rendered.props['data-lcx-search-usage'], 'turn')
  assert.equal(rendered.children[0], 'Turn search usage: 110')
  // Without the producer the same component renders nothing, which is the shipped defect.
  assert.equal(turn.component({ turn: { data: { get: () => undefined } }, t: key => key }), null)
})

test('the registered session dock contribution renders from the lcxSearchUsage projection', () => {
  const [dock] = applyClient().entryOf('conversation.composer.dock')
  assert.equal(dock.options.id, 'lcx-search-usage-session')
  const auxiliary = { uncachedInputTokens: 20, outputTokens: 10, cacheReadTokens: 80, cacheWriteTokens: 0 }
  const rendered = dock.component({
    useProjection: key => (key === 'lcxSearchUsage' ? { auxiliary, aggregateContext: true } : undefined),
    t: key => (key === 'usageSession' ? 'Session search usage' : key),
  })
  assert.equal(rendered.props['data-lcx-search-usage'], 'session')
  assert.equal(rendered.children[0], 'Session search usage: 110')
  // An absent projection renders nothing rather than a zero row.
  assert.equal(dock.component({ useProjection: () => undefined, t: key => key }), null)
})

test('unload removes the producer and the owned entries; re-enable creates exactly one of each', () => {
  const client = applyClient()
  assert.deepEqual(client.definitionOf('lcx-search-usage').length, 1)
  assert.deepEqual(client.entryOf('conversation.chat.turnTail').length, 1)
  assert.deepEqual(client.entryOf('conversation.composer.dock').length, 1)
  client.unload()
  assert.deepEqual(client.kinds(), [])
  assert.deepEqual(client.ids(), [])

  const reenabled = applyClient()
  assert.deepEqual(reenabled.definitionOf('lcx-search-usage').length, 1)
  assert.deepEqual(reenabled.entryOf('conversation.chat.turnTail').length, 1)
  assert.deepEqual(reenabled.entryOf('conversation.composer.dock').length, 1)
  reenabled.unload()
  assert.deepEqual(reenabled.kinds(), [])
  assert.deepEqual(reenabled.ids(), [])
})
