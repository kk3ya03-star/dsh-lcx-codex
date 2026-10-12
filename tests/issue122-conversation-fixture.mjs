import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// Real DSH Conversation engine (`ConversationNodeAssembler`, the event and view registries) from the installed
// `@deepseek-ai/dsh-client-ui-conversation/client` bundle, with LCX's real built client (`lib/client.js`)
// registering its Definitions on it. The bundle is a browser module whose top level only needs its imports to
// exist, so the Services it extends are replaced by minimal shells; none of the classes used here touch them.

const require = createRequire(import.meta.url)

const deep = (name) =>
  new Proxy(function () {}, {
    get: (_target, key) => (key === Symbol.toPrimitive ? undefined : key === '__esModule' ? false : deep(`${name}.${String(key)}`)),
    apply: () => deep(`${name}()`),
    construct: () => ({}),
  })

let engine
export function conversationEngine() {
  if (engine) return engine
  let exported
  const imports = {
    react: require('react'),
    '@deepseek-ai/dsh-client-store': { notifySubscribers: (listeners) => listeners.forEach((listener) => listener()) },
    '@deepseek-ai/cordis': { Service: Object.assign(class {}, { tracker: Symbol('tracker') }) },
  }
  vm.runInNewContext(readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8'), {
    console,
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory((name) => imports[name] ?? deep(name)) } } },
  })
  return (engine = exported)
}

const ownerCtx = () => ({ effect: (setup) => { const dispose = setup(); return () => dispose?.() } })

/**
 * The registries a Client shares between Sessions: LCX registers its Definitions once on the event registry, and
 * every Session gets its own assembler on top (`createAssembly({ shared })`), exactly as DSH wires it.
 */
export function createSharedEngine({ mediaPreview = true } = {}) {
  const { ConversationEventRegistry, ConversationViewRegistry } = conversationEngine()
  const events = new ConversationEventRegistry(ownerCtx())
  const views = new ConversationViewRegistry(ownerCtx())
  views.register({
    target: 'chat',
    create() {
      const nodes = new Map()
      const snapshot = () => ({ nodes: [...nodes.values()].sort((a, b) => a.anchorSeq - b.anchorSeq) })
      return {
        empty: { nodes: [] },
        replace({ nodes: next }) { nodes.clear(); for (const node of next) nodes.set(node.key, node); return snapshot() },
        apply({ upserts }) { for (const node of upserts) nodes.set(node.key, node); return snapshot() },
      }
    },
  })
  installLcxClient(events, mediaPreview)
  return { events, views }
}

/**
 * Build one Session-bound assembly: the real registries and assembler, a minimal `chat` view target that
 * keeps the materialized Nodes, and LCX's real client registered on the real event registry.
 */
export function createAssembly({ mediaPreview = true, shared = createSharedEngine({ mediaPreview }) } = {}) {
  const { ConversationNodeAssembler } = conversationEngine()
  const { events, views } = shared
  const assembler = new ConversationNodeAssembler(events, views)
  assembler.activateTarget('chat')
  return {
    assembler,
    replace(sessionEvents) {
      assembler.replaceWindow(sessionEvents.map((event) => ({ type: 'event', event })), false)
      assembler.flush()
    },
    append(sessionEvents) {
      for (const event of sessionEvents) assembler.append({ type: 'event', event })
      assembler.flush()
    },
    nodes: () => (assembler.snapshot('chat')?.nodes ?? []).filter((node) => node.kind === 'lcx-search-media'),
    turnUsage(turn) {
      const location = assembler.locationIndex.snapshot().turns.get(turn)
      return location?.data.get('lcx-search-usage')
    },
  }
}

function installLcxClient(events, mediaPreview) {
  const values = { searchMediaPreview: mediaPreview }
  const scope = {
    status: 'ready', writable: true, bind() { return this },
    subscribe: () => () => {},
    getSnapshot() { return { status: this.status, writable: this.writable, value: { ...values } } },
    async mutate() {},
  }
  const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }), useState: (v) => [v, () => {}], useEffect() {} }
  let client
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    URL, AbortController, DOMException,
    window: { __ModuleLoader__: { load({ factory }) {
      client = factory((name) => {
        if (name === 'react') return React
        if (name === '@deepseek-ai/dsh-client-store') return { createSnapshotStore: (initial) => ({ getSnapshot: () => initial, subscribe: () => () => {}, set() {} }) }
        throw new Error(`Unexpected import: ${name}`)
      })
    } } },
  })
  client.apply({
    locale: { register: () => () => {} },
    configForms: { get: () => scope },
    get(name) { return this[name] },
    uiConversation: { events },
    slots: { inject: (_name, register) => register(), register: (entry) => { entry.inject?.(); return () => {} } },
    effect(setup) { return setup() },
  })
}
