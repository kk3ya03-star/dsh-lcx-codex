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

function fixture({ extras = {}, modules = {} } = {}) {
  let client, definition, settings, settingsView, media, mediaView
  let scopeListener
  const stores = [], disposers = [], writes = [], elements = [], definitions = []
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
    URL, AbortController, DOMException, ...extras,
    window: { __ModuleLoader__: { load({ factory }) {
      client = factory(name => {
        if (name === 'react') return React
        if (Object.hasOwn(modules, name)) return modules[name]
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
    configForms: { get: ns => ns === 'lcx-codex' ? scope : undefined },
    get(name) { return this[name] },
    uiConversation: { events: { register(value) {
      definitions.push(value?.kind)
      // Selected by kind: the client registers the usage producer alongside this one.
      if (value?.kind === 'lcx-search-media') definition = value
      return () => { disposed.definition += 1 }
    } } },
    slots: {
      inject(_name, register) { return register() },
      register(entry, component) {
        const injected = entry.inject()
        if (entry.name === 'plugins.bundle.config') {
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
    definition, definitions, settings, settingsView, media, mediaView, stores, elements,
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
    // Ownership (#102): plain direct image and video links are LCX's; Markdown images are DSH's.
    assert.deepEqual(Array.from(node.data.items, item => item.kind), ['image', 'video'])
  }
  const mixed = project(f.definition, assistantEvent({ text: 'an image link https://example.com/a.jpg and ![native](https://example.com/b.png)' }))
  assert.deepEqual(Array.from(mixed.data.items, item => item.url), ['https://example.com/a.jpg'], 'the native Markdown image is not duplicated')
  assert.equal(project(f.definition, assistantEvent({ text: 'only ![native](https://example.com/b.png)' })), null)
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
  const node = project(f.definition, assistantEvent({ text: 'prose https://example.com/prose.jpg' }), meta)
  // Structured candidates come first; a prose image link follows as a plain (unstructured) item.
  assert.deepEqual(structuredClone(node.data.items), [{
    kind: 'image', url: 'https://images.example.com/full', previewUrl: 'https://images.example.com/thumb',
    sourceUrl: 'https://example.com/source', caption: 'Structured result', structured: true,
  }, { kind: 'image', url: 'https://example.com/prose.jpg' }])
  // Structured images and a direct video in the same answer are two independent LCX surfaces.
  const both = project(f.definition, assistantEvent({ text: 'clip https://example.com/clip.mp4' }), meta)
  assert.deepEqual(Array.from(both.data.items, item => [item.kind, item.url]), [
    ['image', 'https://images.example.com/full'], ['video', 'https://example.com/clip.mp4'],
  ])
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
  assert.deepEqual(f.definitions, ['lcx-search-usage', 'lcx-search-media'])
  f.dispose()
  assert.deepEqual(f.disposed, { definition: 2, slots: 2, scope: 1 })
  assert.equal(f.dictionaries.size, 0)
})

test('media dictionaries carry every label the media surface uses in both languages', () => {
  const f = fixture()
  const keys = ['mediaTitle', 'mediaImagePreview', 'mediaPlay', 'mediaEnlarge', 'mediaClose', 'mediaHeading', 'mediaFailed', 'mediaVideoFailed', 'mediaPrevious', 'mediaNext', 'mediaOpen']
  for (const language of ['zh', 'en']) {
    const dictionary = f.dictionaries.get(language)
    for (const key of keys) assert.equal(typeof dictionary[key], 'string', language + '.' + key)
    for (const retired of ['mediaMore', 'mediaLess']) assert.equal(dictionary[retired], undefined, language + '.' + retired)
  }
})

const PAGE = "<html><body><div data-chat-flow>\n    <div data-chat-group-key='[\"process\",\"tool-3\",null]' data-chat-turn=\"3\" data-step-process></div>\n    <div data-chat-flow-kind=\"assistant-step\" data-chat-group-part=\"response\" data-chat-turn=\"3\"><p>Answer</p></div>\n    <div data-chat-group-key='[\"process\",\"media-3\",null]' data-chat-turn=\"3\" data-step-process><div data-chat-flow-kind=\"lcx-search-media\" data-chat-turn=\"3\"><span id=\"marker\"></span></div></div>\n  </div></body></html>"
function domExtras(window, document) {
  return { document, MutationObserver: window.MutationObserver, requestAnimationFrame: fn => { queueMicrotask(fn); return 1 }, cancelAnimationFrame() {}, queueMicrotask }
}
function mount(f, document, language, candidates) {
  const meta = { lcxHostedMedia: { version: 1, tool: 'web_search', candidates } }
  const node = project(f.definition, assistantEvent({ text: 'answer' }), meta)
  const dictionary = f.dictionaries.get(language)
  const element = f.mediaView({ node, t: key => dictionary[key], useMediaPreview: selector => selector({ enabled: true }) })
  f.renderComponent('inline', element).props.ref(document.getElementById('marker'))
  f.renderComponent('inline', element)
  return dictionary
}

test('structured image click mounts the public DSH ImageLightbox via baseline modules and unmounts cleanly', async () => {
  const { parseHTML } = await import('linkedom')
  const { window, document } = parseHTML(PAGE)
  function ImageLightbox() {}
  const roots = []
  const modules = {
    '@deepseek-ai/dsh-client-ui-primitives': { ImageLightbox },
    'react-dom/client': { createRoot(container) {
      const root = { container, unmounted: false, render(node) { this.node = node }, unmount() { this.unmounted = true } }
      roots.push(root); return root
    } },
  }
  const f = fixture({ modules, extras: domExtras(window, document) })
  const dictionary = mount(f, document, 'en', [{ kind: 'image', url: 'https://images.example.com/full', previewUrl: 'https://images.example.com/thumb', sourceUrl: 'https://example.com/s', caption: 'Caption', structured: true }])
  assert.equal(document.querySelectorAll('.lcx-media-tile').length, 1)
  document.querySelector('.lcx-media-open').onclick()
  assert.equal(document.querySelector('dialog'), null, 'no LCX dialog when the DSH lightbox is available')
  assert.equal(roots.length, 1)
  assert.equal(roots[0].node.type, ImageLightbox)
  assert.deepEqual(structuredClone({ src: roots[0].node.props.src, alt: roots[0].node.props.alt, labels: roots[0].node.props.labels }),
    { src: 'https://images.example.com/full', alt: 'Caption', labels: { dialog: dictionary.mediaImagePreview, close: dictionary.mediaClose } })
  assert.equal(document.querySelectorAll('[data-lcx-media-lightbox]').length, 1)
  roots[0].node.props.onClose(); roots[0].node.props.onClose()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(roots[0].unmounted, true)
  assert.equal(document.querySelectorAll('[data-lcx-media-lightbox]').length, 0)
  f.unmountEffects()
  assert.equal(document.querySelector('.lcx-media'), null)
})

test('a missing or broken DSH lightbox module falls back to the LCX dialog', async () => {
  const { parseHTML } = await import('linkedom')
  const { window, document } = parseHTML(PAGE)
  const create = document.createElement.bind(document)
  document.createElement = name => { const element = create(name); if (name === 'dialog') element.showModal = () => { element.open = true }; return element }
  const f = fixture({ extras: domExtras(window, document) })
  mount(f, document, 'zh', [{ kind: 'image', url: 'https://images.example.com/full', structured: true }])
  document.querySelector('.lcx-media-open').onclick()
  assert.equal(document.querySelectorAll('dialog.lcx-media-dialog').length, 1)
  assert.equal(document.querySelector('dialog img').src, 'https://images.example.com/full')
  f.unmountEffects()
  assert.equal(document.querySelector('dialog'), null)
})
