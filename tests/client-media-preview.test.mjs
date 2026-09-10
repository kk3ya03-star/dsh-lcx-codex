import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('media client keeps helper names isolated from adjacent bundled plugins', () => {
  const destination = () => 'another plugin'
  const sandbox = { URL, destination, extractSearchMedia: 'another plugin',
    window: { __ModuleLoader__: { load() {} } } }
  const keys = Object.keys(sandbox).sort()
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox)
  assert.equal(sandbox.destination, destination)
  assert.equal(sandbox.extractSearchMedia, 'another plugin')
  assert.deepEqual(Object.keys(sandbox).sort(), keys)
})

function fixture() {
  let client, definition, settings, settingsView, media, mediaView
  let scopeListener
  const stores = [], disposers = [], writes = [], elements = []
  const disposed = { definition: 0, slots: 0, scope: 0 }
  const hookStates = new Map()
  const effects = new Map()
  let hookKey, hookCursor = 0
  const React = {
    createElement(type, props, ...children) {
      const element = { type, props: props ?? {}, children }
      if (typeof type === 'string') elements.push(element)
      return element
    },
    useState(initial) {
      const states = hookStates.get(hookKey) ?? []
      hookStates.set(hookKey, states)
      const index = hookCursor++
      if (index >= states.length) states[index] = initial
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useEffect(setup, deps) {
      const key = `${hookKey}:${hookCursor++}`
      const previous = effects.get(key)
      if (previous && deps.every((value,index) => Object.is(value,previous.deps[index]))) return
      previous?.cleanup?.()
      effects.set(key, {deps, cleanup:setup()})
    },
  }
  const renderComponent = (key, element) => {
    hookKey = key
    hookCursor = 0
    const result = element.type(element.props)
    hookKey = undefined
    return result
  }
  const values = {
    enabled: false, webSearch: false, advancedHostedSearch: false,
    alphaSearch: false, grokNativeWebSearch: false, grokNativeXSearch: false,
  }
  const scope = {
    status: 'ready', writable: true,
    bind() { return this },
    subscribe(listener) {
      scopeListener = listener
      return () => { disposed.scope += 1 }
    },
    getSnapshot() { return { status: this.status, writable: this.writable, value: { ...values } } },
    async mutate(ops) { writes.push(ops); Object.assign(values, Object.fromEntries(ops.map(op => [op.path[0], op.value]))); scopeListener() },
  }
  const dictionaries = new Map()
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    URL, AbortController, DOMException,
    window: { __ModuleLoader__: { load({ factory }) {
      client = factory(name => {
        if (name === 'react') return React
        if (name === '@deepseek-ai/dsh-client-store') return { createSnapshotStore(initial, options) {
          let state = initial
          const store = {
            options,
            getSnapshot: () => state,
            subscribe: () => () => {},
            set(next) { state = next },
          }
          stores.push(store)
          return store
        } }
        throw new Error(`Unexpected import: ${name}`)
      })
    } } },
  })
  client.apply({
    locale: { register(namespace, language, dictionary) {
      dictionaries.set(language, dictionary)
      return () => dictionaries.delete(language)
    } },
    settingsScope: scope,
    uiConversation: { events: { register(value) {
      definition = value
      return () => { disposed.definition += 1 }
    } } },
    slots: {
      inject(_name, register) { return register() },
      register(entry, component) {
        const injected = entry.inject()
        if (entry.name === 'settings.plugin.item') {
          settings = injected
          settingsView = component
        } else {
          media = injected
          mediaView = component
        }
        return () => { disposed.slots += 1 }
      },
    },
    effect(setup) { disposers.push(setup()) },
  })
  const dispose = () => disposers.reverse().forEach(value => value())
  return {
    definition, settings, settingsView, media, mediaView, stores, elements,
    values, writes, disposed, dictionaries, dispose, renderComponent,
    unmountEffects() { for (const effect of effects.values()) effect.cleanup?.(); effects.clear() },
  }
}

function assistantEvent({ seq = 917, model = 'gpt-5', text = '', interrupted = false } = {}) {
  const source = { kind: 'model', provider: model.startsWith('grok') ? 'xai' : 'openai', model }
  Object.defineProperty(source, 'replayState', { get() { throw new Error('replayState must stay private') } })
  return {
    type: 'assistant/message', seq, time: 1, surfaceOp: 'append',
    data: {
      turn: 3, step: 1, ...(interrupted ? { interrupted: true } : {}),
      message: {
        id: `message-${seq}`, role: 'assistant', source,
        content: [
          { type: 'reasoning', text: 'https://example.com/private.png' },
          { type: 'text', text },
          { type: 'opaque', value: 'https://example.com/opaque.jpg' },
        ],
      },
    },
  }
}

function project(definition, event, meta, toolName = 'web_search') {
  const turn = event.data.turn
  const turnEvent = { type: 'turn/start', seq: event.seq - 2, time: 0, data: { turn } }
  const turnLocation = { kind: 'turn', turn: { turn } }
  const start = { event: turnEvent, role: 'start', location: turnLocation }
  let state = definition.start({ matches: [start] }, start, {})
  const matches = [start]
  if (meta !== undefined) {
    const location = { kind: 'step', turn: { turn }, step: { turn, step: 1 } }
    const callEvent = { type: 'tool/call', seq: event.seq - 2, time: 0, data: { turn, step: 1, callId: 'call-media', name: toolName, args: {} } }
    const callMatch = { event: callEvent, role: 'update', location }
    state = definition.update({ state, matches }, callMatch);matches.push(callMatch)
    const toolEvent = { type: 'tool/result', seq: event.seq - 1, time: 0, data: { turn, step: 1, meta, message: { source: { kind: 'tool', callId: 'call-media', name: 'web_search' } } } }
    const toolMatch = { event: toolEvent, role: 'update', location }
    state = definition.update({ state, matches }, toolMatch);matches.push(toolMatch)
  }
  const matched = definition.match(event)
  if (matched === null) return null
  const location = { kind: 'step', turn: { turn }, step: { turn, step: 1 } }
  const update = { event, role: 'update', location }
  state = definition.update({ state, matches }, update)
  matches.push(update)
  return definition.buildViewNode({
    key: `media:${turn}`, kind: definition.kind, id: String(turn),
    matches, start, state, current: new Map(),
  })
}

test('presentation-only media preference stays off until host save is confirmed', async () => {
  const f=fixture(); const store=f.settings.hooks.mediaPreview;
  assert.equal(store.getSnapshot().enabled,false);
  assert.equal(f.media.hooks.mediaPreview,store);
  f.settings.setMediaPreview(true);
  assert.equal(store.getSnapshot().enabled,false);
  f.settings.save(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(store.getSnapshot().enabled,true);
  assert.equal(f.values.searchMediaPreview,true);
  assert.equal(f.values.enabled,false);
  assert.deepEqual(structuredClone(f.writes),[[{op:'set',path:['searchMediaPreview'],value:true}]]);
  f.settings.setMediaPreview(false); f.settings.discard();
  assert.equal(store.getSnapshot().enabled,true);
});

test('media definition projects completed historical GPT/Grok text at the assistant anchor', () => {
  const f = fixture()
  for (const model of ['gpt-5.2', 'grok-4-fast']) {
    const node = project(f.definition, assistantEvent({ model, text: 'https://example.com/a.jpg?raw=1\nhttps://example.com/b.mp4' }))
    assert.equal(node.kind, 'lcx-search-media')
    assert.equal(node.target, 'chat')
    assert.equal(node.anchorSeq, 917, 'media stays before the assistant + 0.1 turn tail')
    assert.equal(node.visibility, 'visible')
    assert.equal(node.data.model, model)
    assert.deepEqual(Array.from(node.data.items, item => item.kind), ['image', 'video'])
  }
  assert.equal(project(f.definition, assistantEvent({ model: 'claude-4', text: 'https://example.com/a.jpg' })), null)
  assert.equal(project(f.definition, assistantEvent({ interrupted: true, text: 'https://example.com/a.jpg' })), null)
  assert.equal(project(f.definition, assistantEvent({ text: 'ordinary link https://example.com/page' })), null)
})

test('structured tool metadata is primary and zero-candidate answers emit no row', () => {
  const f = fixture()
  const meta = { lcxHostedMedia: { version: 1, tool: 'web_search', candidates: [{
    kind: 'image', url: 'https://images.example.com/full', previewUrl: 'https://images.example.com/thumb',
    sourceUrl: 'https://example.com/source', caption: 'Structured result', structured: true,
  }] } }
  const node = project(f.definition, assistantEvent({ text: 'fallback https://example.com/fallback.jpg' }), meta)
  assert.deepEqual(structuredClone(node.data.items), [{
    kind: 'image', url: 'https://images.example.com/full', previewUrl: 'https://images.example.com/thumb',
    sourceUrl: 'https://example.com/source', caption: 'Structured result', structured: true,
  }])
  assert.equal(project(f.definition, assistantEvent({ text: 'ordinary answer' })), null)
  assert.equal(project(f.definition, assistantEvent({ text: 'foreign tool answer' }), meta, 'foreign_tool'), null)
})

test('media renderer does not mount or request anything while off', () => {
 const f=fixture(),node=project(f.definition,assistantEvent({text:'https://example.com/a.jpg'}));
 assert.equal(f.mediaView({node,t:key=>key,useMediaPreview:selector=>selector({enabled:false})}),null);
 assert.equal(f.elements.some(element=>element.type==='img'||element.type==='video'),false);
});

test('media client disposes definition, both slots, dictionaries and settings subscription', () => {
  const f = fixture()
  f.dispose()
  assert.deepEqual(f.disposed, { definition: 1, slots: 2, scope: 1 })
  assert.equal(f.dictionaries.size, 0)
})
