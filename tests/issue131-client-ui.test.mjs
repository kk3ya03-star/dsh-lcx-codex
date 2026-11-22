import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'
import { parseHTML } from 'linkedom'
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { loadClientSource } from './wp2-source.mjs'

const [clientSource, uiCompiled] = await Promise.all([
  loadClientSource(),
  build({
    entryPoints: [fileURLToPath(new URL('../src/client/search-usage-ui.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  }),
])

const ui = await import('data:text/javascript;base64,' + Buffer.from(uiCompiled.outputFiles[0].text).toString('base64'))

function mountClient({ activeLanguage = 'en', initialValues = {}, doc } = {}) {
  let client
  let cardInjection
  let cardComponent
  let snapshot
  let listener
  let mediaSnapshot
  const dictionaries = new Map()
  const entries = []
  const disposers = []
  const writes = []
  const values = {
    enabled: false,
    webSearch: false,
    advancedHostedSearch: false,
    alphaSearch: false,
    grokNativeWebSearch: false,
    grokNativeXSearch: false,
    searchMediaPreview: false,
    incrementalToolUpdates: true,
    gatewayCompatibilityFallback: false,
    ...initialValues,
  }
  const scope = {
    status: 'ready',
    writable: true,
    bind() { return this },
    subscribe(fn) { listener = fn; return () => {} },
    getSnapshot() { return { status: this.status, writable: this.writable, value: { ...values } } },
    async mutate(ops) {
      writes.push(structuredClone(ops))
      Object.assign(values, Object.fromEntries(ops.map(op => [op.path[0], op.value])))
      listener()
    },
  }
  let pageEffect
  vm.runInNewContext(clientSource, {
    ...(doc ? { document: doc } : {}),
    navigator: { language: activeLanguage },
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          client = factory(name => {
            if (name === 'react') {
              return {
                createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
                useState: initial => [typeof initial === 'boolean' ? true : initial, () => {}],
                useEffect(setup, deps) {
                  if (pageEffect && deps.every((value, index) => Object.is(value, pageEffect.deps[index]))) return
                  pageEffect?.cleanup?.()
                  pageEffect = { deps: [...deps], cleanup: setup() }
                },
              }
            }
            if (name === '@deepseek-ai/dsh-client-store') {
              return {
                createSnapshotStore(value) {
                  const isMedia = !Object.hasOwn(value, 'available')
                  if (isMedia) mediaSnapshot = value
                  else snapshot = value
                  return {
                    getSnapshot() { return isMedia ? mediaSnapshot : snapshot },
                    subscribe() { return () => {} },
                    set(next) {
                      if (isMedia) mediaSnapshot = next
                      else snapshot = next
                    },
                  }
                },
              }
            }
            throw new Error(`Unexpected client import: ${name}`)
          })
        },
      },
    },
  })

  assert.deepEqual([...client.inject], ['slots', 'locale', 'configForms', 'uiConversation'])
  client.apply({
    locale: {
      register(namespace, language, dict) {
        assert.equal(namespace, 'lcx-codex')
        dictionaries.set(language, dict)
        return () => dictionaries.delete(language)
      },
    },
    configForms: { get: ns => (ns === 'lcx-codex' ? scope : undefined) },
    get(name) { return this[name] },
    uiConversation: { events: { register() { return () => {} } } },
    slots: {
      inject(_name, callback) { return callback() },
      register(options, component) {
        entries.push({ options, component })
        if (options.name === 'plugins.bundle.config') {
          cardInjection = options.inject()
          cardComponent = component
        }
        return () => {}
      },
    },
    effect(setup) {
      const dispose = setup()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
  })

  const translate = lang => key => dictionaries.get(lang)?.[key] ?? dictionaries.get('en')[key]
  return {
    client,
    values,
    writes,
    dictionaries,
    entries,
    cardInjection,
    state: () => snapshot,
    setLanguage(lang) { activeLanguage = lang },
    renderCard: (view = 'page') => cardComponent({
      ...cardInjection,
      view,
      t: translate(activeLanguage),
      useLcxCard: () => snapshot,
      useMediaPreview: selector => selector(mediaSnapshot),
    }),
    turnTailEntry: () => entries.find(entry => entry.options?.name === 'conversation.chat.turnTail'),
    dockEntry: () => entries.find(entry => entry.options?.name === 'conversation.composer.dock'),
    translate,
    async save() {
      cardInjection.save()
      await new Promise(resolve => setImmediate(resolve))
    },
    dispose() {
      pageEffect?.cleanup?.()
      disposers.reverse().forEach(fn => fn())
    },
  }
}

function flattenElements(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (typeof node.type === 'string') out.push(node)
  else if (typeof node.type === 'function') {
    const rendered = node.type(node.props)
    flattenElements(rendered, out)
  }
  for (const child of node.children ?? []) {
    if (Array.isArray(child)) child.forEach(item => flattenElements(item, out))
    else flattenElements(child, out)
  }
  return out
}

function renderVnodeToDom(document, vnode) {
  if (vnode === null || vnode === undefined || typeof vnode === 'boolean') return null
  if (typeof vnode === 'string' || typeof vnode === 'number') return document.createTextNode(String(vnode))
  const el = document.createElement(vnode.type)
  for (const [key, value] of Object.entries(vnode.props ?? {})) {
    if (value === undefined || value === null || key === 'children') continue
    if (key === 'className') el.setAttribute('class', String(value))
    else if (typeof value !== 'function') el.setAttribute(key, String(value))
  }
  for (const child of vnode.children ?? []) {
    const childNode = renderVnodeToDom(document, child)
    if (childNode) el.appendChild(childNode)
  }
  return el
}

test('WP3.1: gatewayCompatibilityFallback defaults off, localizes zh/en, edits, discards, and saves atomically', async () => {
  const f = mountClient({ activeLanguage: 'en' })
  assert.deepEqual(Object.keys(f.dictionaries.get('zh')).sort(), Object.keys(f.dictionaries.get('en')).sort())
  assert.equal(f.state().gatewayCompatibilityFallback.value, false)

  const enTree = flattenElements(f.renderCard('page'))
  const enCheckbox = enTree.find(node => node.type === 'input' && node.props.id === 'lcx-gateway-compatibility')
  assert.ok(enCheckbox, 'renders lcx-gateway-compatibility checkbox')
  assert.equal(enCheckbox.props.type, 'checkbox')
  assert.equal(enCheckbox.props.checked, false)
  const enText = JSON.stringify(f.renderCard('page'))
  assert.match(enText, /Gateway compatibility fallback/)
  assert.match(enText, /additional_tools/)
  assert.match(enText, /configuration_update/)
  assert.match(enText, /reasoning\.effort/)

  f.setLanguage('zh')
  const zhText = JSON.stringify(f.renderCard('page'))
  assert.match(zhText, /网关兼容回退/)
  assert.match(zhText, /additional_tools/)
  assert.match(zhText, /configuration_update/)

  // Edit and discard restores false without mutating host scope.
  f.cardInjection.edit('gatewayCompatibilityFallback', true)
  assert.equal(f.state().gatewayCompatibilityFallback.value, true)
  assert.equal(f.state().dirty, true)
  f.cardInjection.discard()
  assert.equal(f.state().gatewayCompatibilityFallback.value, false)
  assert.equal(f.state().dirty, false)
  assert.equal(f.writes.length, 0)

  // Edit and save persists only the changed camelCase key.
  f.cardInjection.edit('gatewayCompatibilityFallback', true)
  await f.save()
  assert.deepEqual(f.writes, [[{ op: 'set', path: ['gatewayCompatibilityFallback'], value: true }]])
  assert.equal(f.values.gatewayCompatibilityFallback, true)
  assert.equal(f.state().dirty, false)
  // leavePage clears unsaved edits back to host truth.
  f.cardInjection.edit('gatewayCompatibilityFallback', false)
  assert.equal(f.state().dirty, true)
  f.cardInjection.leavePage()
  assert.equal(f.state().gatewayCompatibilityFallback.value, true)
  assert.equal(f.state().dirty, false)
  f.dispose()

  // Pre-existing settings document lacking gatewayCompatibilityFallback defaults to false.
  const older = mountClient({ initialValues: { gatewayCompatibilityFallback: undefined } })
  assert.equal(older.state().gatewayCompatibilityFallback.value, false)
  older.dispose()
})

test('WP3.1: locale/zh.json and locale/en.json keep strict plugin metadata shape', () => {
  for (const lang of ['zh', 'en']) {
    const parsed = JSON.parse(readFileSync(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8'))
    assert.deepEqual(Object.keys(parsed), ['meta'])
    assert.deepEqual(Object.keys(parsed.meta).sort(), ['description', 'title'])
    assert.ok(parsed.meta.title.length > 0 && parsed.meta.description.length > 0)
  }
})

test('WP3.2: promptCacheHitRate math, rounding, overflow bounds, and fail-closed edge cases', () => {
  assert.deepEqual(ui.promptCacheHitRate({
    uncachedInputTokens: 140, cacheReadTokens: 860, cacheWriteTokens: 0, outputTokens: 20, totalTokens: 1020,
  }), { percent: 86, cacheReadTokens: 860, promptTokens: 1000 })

  // Session projection shape without totalTokens:
  assert.deepEqual(ui.promptCacheHitRate({
    uncachedInputTokens: 140, cacheReadTokens: 860, cacheWriteTokens: 0, outputTokens: 20,
  }), { percent: 86, cacheReadTokens: 860, promptTokens: 1000 })

  // Exact 100% and 0% hits:
  assert.deepEqual(ui.promptCacheHitRate({
    uncachedInputTokens: 0, cacheReadTokens: 500, cacheWriteTokens: 0, outputTokens: 12, totalTokens: 512,
  }), { percent: 100, cacheReadTokens: 500, promptTokens: 500 })
  assert.deepEqual(ui.promptCacheHitRate({
    uncachedInputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 12, totalTokens: 512,
  }), { percent: 0, cacheReadTokens: 0, promptTokens: 500 })

  // Imperfect hit that rounds near 100% clamps to 99 rather than falsely claiming 100%:
  assert.deepEqual(ui.promptCacheHitRate({
    uncachedInputTokens: 1, cacheReadTokens: 999, cacheWriteTokens: 0, outputTokens: 10, totalTokens: 1010,
  }), { percent: 99, cacheReadTokens: 999, promptTokens: 1000 })

  // Half-up rounding:
  assert.equal(ui.promptCacheHitRate({
    uncachedInputTokens: 199, cacheReadTokens: 1, outputTokens: 0, totalTokens: 200,
  })?.percent, 1)
  assert.equal(ui.promptCacheHitRate({
    uncachedInputTokens: 2, cacheReadTokens: 1, outputTokens: 0, totalTokens: 3,
  })?.percent, 33)

  // Large safe integers do not overflow intermediate *100 arithmetic:
  assert.deepEqual(ui.promptCacheHitRate({
    uncachedInputTokens: 0, cacheReadTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0, totalTokens: Number.MAX_SAFE_INTEGER,
  }), { percent: 100, cacheReadTokens: Number.MAX_SAFE_INTEGER, promptTokens: Number.MAX_SAFE_INTEGER })
  assert.deepEqual(ui.promptCacheHitRate({
    uncachedInputTokens: 1, cacheReadTokens: Number.MAX_SAFE_INTEGER - 1, outputTokens: 0, totalTokens: Number.MAX_SAFE_INTEGER,
  }), { percent: 99, cacheReadTokens: Number.MAX_SAFE_INTEGER - 1, promptTokens: Number.MAX_SAFE_INTEGER })

  // Zero-denominator, missing counters, invalid/corrupt values all fail closed:
  for (const invalid of [
    undefined,
    null,
    [],
    {},
    { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 0 },
    { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10, totalTokens: 10 },
    { uncachedInputTokens: 500, outputTokens: 10, totalTokens: 510 },
    { uncachedInputTokens: 100, cacheReadTokens: -1, outputTokens: 10, totalTokens: 110 },
    { uncachedInputTokens: 100, cacheReadTokens: 1.5, outputTokens: 10, totalTokens: 110 },
    { uncachedInputTokens: 100, cacheReadTokens: Number.NaN, outputTokens: 10, totalTokens: 110 },
    { uncachedInputTokens: 100, cacheReadTokens: Number.POSITIVE_INFINITY, outputTokens: 10, totalTokens: 110 },
    { uncachedInputTokens: 100, cacheReadTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 0 },
    { uncachedInputTokens: 100, cacheReadTokens: 200, outputTokens: 50, totalTokens: 200 }, // cacheRead > exactPrompt (150)
    { uncachedInputTokens: 100, cacheReadTokens: 80, outputTokens: 100, totalTokens: 50 }, // total < output
    { uncachedInputTokens: 100, cacheReadTokens: 80, totalTokens: 200 }, // missing outputTokens when totalTokens present
    { uncachedInputTokens: Number.MAX_SAFE_INTEGER, cacheReadTokens: 10 }, // sum overflows MAX_SAFE_INTEGER
  ]) {
    assert.equal(ui.promptCacheHitRate(invalid), null, JSON.stringify(invalid))
  }
})

test('WP3.2: client DOM renders localized per-turn cache hit pill and preserves request invariance', () => {
  const { document } = parseHTML('<!doctype html><html><head></head><body><div data-turn-tail="1"></div></body></html>')
  const f = mountClient({ activeLanguage: 'en', doc: document })
  try {
    const styleEl = document.querySelector('style[data-plugin-css="dsh-lcx-codex"]')
    assert.ok(styleEl, 'mounts plugin stylesheet')
    assert.match(styleEl.textContent, /\.lcx-cache-hit-turn\{/)
    assert.match(styleEl.textContent, /\.lcx-turn-usage\{/)

    // Derive authentic TurnTokenUsage via DSH's own deriveTurnTokenUsage fold:
    const usage = { inputTokens: 140, cacheReadTokens: 860, cacheWriteTokens: 0, outputTokens: 20, totalTokens: 1020 }
    const turnEvents = [
      { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
      { type: 'step/start', seq: 2, time: 2, data: { turn: 1, step: 1 } },
      {
        type: 'assistant/message', seq: 3, time: 3,
        data: {
          turn: 1, step: 1, usage, stream: [],
          message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'openai', model: 'gpt-6-sol' }, content: [{ type: 'text', text: 'ok' }] }),
        },
      },
      { type: 'step/end', seq: 4, time: 4, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const turnTokenUsage = deriveTurnTokenUsage(turnEvents)
    assert.ok(turnTokenUsage)

    const turnEntry = f.turnTailEntry()
    assert.ok(turnEntry)
    const fetchCalls = []
    const origFetch = globalThis.fetch
    globalThis.fetch = (...args) => { fetchCalls.push(args); throw new Error('UI must never fetch') }
    try {
      const turnDataSnapshot = Object.freeze({
        turn: 1, seq: 5, time: 5, closing: null, branchUnavailable: false,
        tokenUsage: Object.freeze({ ...turnTokenUsage }),
      })
      const turnArg = Object.freeze({
        turn: 1,
        data: Object.freeze({
          get: key => (key === 'turn-tail' ? turnDataSnapshot : undefined),
        }),
      })
      const vnodeEn = turnEntry.component({ turn: turnArg, seq: 5, openFile: () => {}, t: f.translate('en') })
      const domEn = renderVnodeToDom(document, vnodeEn)
      document.querySelector('[data-turn-tail="1"]').appendChild(domEn)
      const pillEn = document.querySelector('[data-lcx-cache-hit="turn"]')
      assert.ok(pillEn)
      assert.equal(pillEn.textContent, 'Cache 86%')
      assert.equal(pillEn.getAttribute('title'), 'Prompt cache hit rate: 86% (860 / 1000)')

      const vnodeZh = turnEntry.component({ turn: turnArg, seq: 5, openFile: () => {}, t: f.translate('zh') })
      const domZh = renderVnodeToDom(document, vnodeZh)
      assert.equal(domZh.textContent, '缓存命中 86%')
      assert.equal(domZh.getAttribute('title'), '本轮提示词缓存命中率: 86% (860 / 1000)')

      // Combined search + cache turn renders wrapper with both pills:
      const searchRecord = Object.freeze({
        requestId: 'r1', provider: 'relay', model: 'gpt-search',
        usage: { inputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 0, outputTokens: 10, totalTokens: 110 },
      })
      const combined = turnEntry.component({
        turn: {
          data: {
            get: key => (key === 'turn-tail' ? turnDataSnapshot : key === 'lcx-search-usage' ? [searchRecord] : undefined),
          },
        },
        seq: 5,
        openFile: () => {},
        t: f.translate('en'),
      })
      const domCombined = renderVnodeToDom(document, combined)
      assert.equal(domCombined.getAttribute('data-lcx-turn-usage'), 'turn')
      assert.equal(domCombined.querySelector('[data-lcx-search-usage="turn"]').textContent, 'Turn search usage: 110')
      assert.equal(domCombined.querySelector('[data-lcx-cache-hit="turn"]').textContent, 'Cache 86%')

      // Zero input / missing cacheRead renders nothing:
      const absent = turnEntry.component({
        turn: { data: { get: key => (key === 'turn-tail' ? { tokenUsage: { uncachedInputTokens: 0, outputTokens: 0, totalTokens: 0 } } : undefined) } },
        seq: 5,
        openFile: () => {},
        t: f.translate('en'),
      })
      assert.equal(absent, null)

      // Session dock remains auxiliary-search-only (never duplicates DSH UsagePill):
      const dockEntry = f.dockEntry()
      assert.equal(dockEntry.component({
        useProjection: key => (key === 'tokenUsage' ? { uncachedInputTokens: 140, cacheReadTokens: 860, cacheWriteTokens: 0, outputTokens: 20 } : undefined),
        t: f.translate('en'),
      }), null)

      assert.equal(fetchCalls.length, 0)
    } finally {
      globalThis.fetch = origFetch
    }
  } finally {
    f.dispose()
  }
})

test('WP2.2 (#105): DSH 0.2.2-rc.5 still renders Markdown image buttons inline-block, so nativeMarkdownImageCss stays active', () => {
  const css = readFileSync(new URL('../node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-CSAdOBx6.css', import.meta.url), 'utf8')
  const match = css.match(/\._imageButton_13jw0_\d+\{[^}]*\}/)
  assert.ok(match, 'DSH web-frontend CSS contains _imageButton rule')
  assert.match(match[0], /display:inline-block/, 'DSH 0.2.2-rc.5 still uses inline-block on Markdown image buttons')
  assert.doesNotMatch(css, /:has\([^)]*_imageButton_13jw0_/, 'DSH CSS has no :has image-button block override')

  const { document } = parseHTML('<!doctype html><html><head></head><body></body></html>')
  const f = mountClient({ doc: document })
  try {
    const styleText = document.querySelector('style[data-plugin-css="dsh-lcx-codex"]').textContent
    assert.match(styleText, /\[data-chat-flow-kind="assistant-step"\] p>button:has\(>img:only-child\)\{display:block;/)
  } finally {
    f.dispose()
  }
})

test('WP2.3: .github/workflows/finalize-stable-release.yml uses two-job resolve/finalize canonical bare-tag concurrency, full release policy without eval, Publish to npm artifact digest verification, and main/stable/* checks', () => {
  const workflow = readFileSync(new URL('../.github/workflows/finalize-stable-release.yml', import.meta.url), 'utf8')
  assert.match(workflow, /workflow_run:\s*\r?\n\s+workflows:\s*\["Publish to npm"\]/u)
  assert.match(workflow, /workflow_dispatch:/u)
  assert.match(workflow, /resolve:/u)
  assert.match(workflow, /needs:\s*resolve/u)
  assert.match(workflow, /group:\s*finalize-stable-\$\{\{\s*github\.repository\s*\}\}-\$\{\{\s*needs\.resolve\.outputs\.tag\s*\}\}/u)
  assert.doesNotMatch(workflow, /\beval\s+"/u)
  assert.match(workflow, /github\.repository == 'kk3ya03-star\/dsh-lcx-codex'/u)
  assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u)
  assert.match(workflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/u)
  assert.match(workflow, /node-version:\s*'24'/u)
  assert.match(workflow, /execFileSync\('git',\s*\['show',\s*`\$\{targetSha\}:package\.json`\]/u)
  assert.match(workflow, /execFileSync\('git',\s*\['show',\s*`\$\{targetSha\}:PUBLIC-RELEASE-MANIFEST\.yml`\]/u)
  assert.match(workflow, /verified-public-package/u)
  assert.match(workflow, /git merge-base --is-ancestor "\$TARGET" "refs\/remotes\/origin\/\$\{BRANCH\}"/u)
  assert.match(workflow, /--verify-tag/u)
  assert.match(workflow, /--latest=false/u)
})
