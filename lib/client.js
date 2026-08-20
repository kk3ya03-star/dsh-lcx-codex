window.__ModuleLoader__.load({
  id: 'dsh-lcx-codex',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-runtime/client')

    const NAMESPACE = 'lcx-codex'
    const DEFAULTS = {
      enabled: false,
      webSearch: false,
      alphaSearch: false,
      remoteCompaction: false,
      fallbackToBasicCompaction: true,
      provider: 'lcx',
      baseURL: 'https://api.lcxbot.com/v1',
      apiKeyEnv: 'LCX_API_KEY',
      model: 'gpt-5.6-sol',
      compactTransport: 'native-v2',
    }

    const css = `
      .lcx-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none}
      .lcx-card-head{width:100%;display:flex;align-items:center;gap:12px;padding:14px 16px;border:0;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer;border-radius:12px}
      .lcx-card-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .lcx-card-title{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
      .lcx-card-title strong{font-size:15px}.lcx-card-title span,.lcx-help{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
      .lcx-card-body{border-top:1px solid var(--dsw-alias-border-l2);padding:14px 16px 10px}
      .lcx-row{display:flex;align-items:flex-start;gap:9px;padding:9px 0}.lcx-row input[type=checkbox]{margin-top:3px;accent-color:var(--dsw-alias-brand-primary)}
      .lcx-row label{font-size:13px;color:var(--dsw-alias-label-primary);line-height:19px}.lcx-row small{display:block;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}
      .lcx-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px}.lcx-field{display:flex;flex-direction:column;gap:5px}.lcx-field label{font-size:12px;color:var(--dsw-alias-label-secondary)}
      .lcx-input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 9px;font:inherit;font-size:12px}.lcx-input:disabled{color:var(--dsw-alias-label-tertiary)}
      .lcx-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;border-top:1px solid var(--dsw-alias-border-l2);padding:12px 0 4px}.lcx-footer button{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 14px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}.lcx-footer button.primary{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}.lcx-footer button:disabled{opacity:.5;cursor:default}.lcx-error{flex:1;color:var(--dsw-alias-state-error-primary);font-size:12px}
      @media(max-width:640px){.lcx-fields{grid-template-columns:1fr}}
    `
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-lcx-codex"]') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-lcx-codex'
      tag.dataset.pluginCss = 'dsh-lcx-codex'
      tag.textContent = css
      document.head.appendChild(tag)
    }

    const copy = {
      zh: {
        title: 'Responses / Codex 能力',
        description: '可选的 hosted Web Search 与 Responses 原生远程压缩。',
        enabled: '启用 LCX/Codex 能力',
        enabledHelp: '关闭时不改变当前模型、搜索提供方或压缩流程。',
        webSearch: '启用 Responses Hosted 搜索（websearch_gpt）',
        webSearchHelp: '开启后，模型可调用 websearch_gpt；插件通过 Responses /responses + web_search 执行结构化 hosted 搜索并返回来源。',
        alphaSearch: '启用 Alpha command 搜索（websearch_alpha）',
        alphaSearchHelp: '仅当当前 endpoint、provider、model 和 schema 的 capability probe 已通过时注册；PAT 模拟或未知能力不会暴露该工具。',
        compaction: '启用 GPT 专属原生远程压缩',
        compactionHelp: '只适用于兼容 Responses 的 GPT 路由；使用与 Sub2API 压缩测试一致的 native V2（/responses + compaction_trigger），保存完整 output 并在后续请求中回放。Legacy compact transport 已不支持，相关配置会被拒绝。',
        fallback: 'native 压缩失败时回退 DSH 普通压缩',
        fallbackHelp: '推荐开启：首次远程压缩失败且尚未生成 checkpoint 时，继续使用 DSH 原有压缩。已有 native checkpoint 的回放失败仍会明确报错。',
        endpoint: '旧版回退 Responses 地址',
        model: '默认 Hosted / Alpha 模型',
        save: '保存',
        saving: '保存中…',
        discard: '放弃修改',
        unsaved: '未保存',
        readOnly: '当前部署的设置为只读。',
        unavailable: '此插件的设置服务暂不可用。',
        saveFailed: '保存失败，请重试。',
        hint: '请求优先复用当前 DSH openai-responses 模型的地址与凭据；这里的地址仅用于旧版直连兼容。Hosted 与 Alpha 不会互相静默降级。',
      },
      en: {
        title: 'Responses / Codex capabilities',
        description: 'Optional hosted Web Search and native Responses compaction.',
        enabled: 'Enable LCX/Codex capabilities',
        enabledHelp: 'When off, the current model, search provider, and compaction flow are unchanged.',
        webSearch: 'Enable Responses Hosted search (websearch_gpt)',
        webSearchHelp: 'When on, the model can call websearch_gpt through Responses /responses + web_search with structured hosted-search controls and citations.',
        alphaSearch: 'Enable Alpha command search (websearch_alpha)',
        alphaSearchHelp: 'Registered only after a capability probe matches the current endpoint, provider, model, and schema. PAT emulation and unknown capabilities remain hidden.',
        compaction: 'Enable GPT-only native remote compaction',
        compactionHelp: 'Works only on a compatible Responses GPT route; uses the native V2 request used by Sub2API compact tests (/responses + compaction_trigger), stores the complete output, and replays it. Legacy compact transport is unsupported and rejected.',
        fallback: 'Fall back to normal DSH compaction on native failure',
        fallbackHelp: 'Recommended: if the first native request fails before a checkpoint is saved, use the existing DSH compaction. Replay failures for an existing native checkpoint still report an error.',
        endpoint: 'Legacy fallback Responses endpoint',
        model: 'Default Hosted / Alpha model',
        save: 'Save',
        saving: 'Saving…',
        discard: 'Discard',
        unsaved: 'Unsaved',
        readOnly: 'This deployment stores settings read-only.',
        unavailable: 'This plugin settings service is unavailable.',
        saveFailed: 'Save failed; please try again.',
        hint: 'Requests prefer the active DSH openai-responses model route and credential; this endpoint is only a legacy direct-route fallback. Hosted and Alpha never silently fall back to each other.',
      },
    }

    function language() {
      return String(globalThis.navigator?.language ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    function valueFrom(snapshot) {
      return { ...DEFAULTS, ...(snapshot.value ?? {}) }
    }

    class SettingsController {
      constructor(scope) {
        this.scope = scope
        this.draft = null
        this.dirty = false
        this.saving = false
        this.failed = false
        this.listeners = new Set()
        this.store = createSnapshotStore(this.projection())
        this.stop = scope.subscribe(() => {
          if (!this.dirty) this.draft = null
          this.publish()
        })
      }

      snapshot() { return this.scope.getSnapshot() }
      value() { return valueFrom(this.snapshot()) }
      draftValue() { return { ...this.value(), ...(this.draft ?? {}) } }
      field(name) { return this.draftValue()[name] }
      overridden(name) { return Object.prototype.hasOwnProperty.call(this.snapshot().user ?? {}, name) }
      projection() {
        const snapshot = this.snapshot()
        return {
          available: snapshot.status === 'ready',
          writable: snapshot.writable,
          dirty: this.dirty,
          saving: this.saving,
          failed: this.failed,
          enabled: { value: Boolean(this.field('enabled')), overridden: this.overridden('enabled') },
          webSearch: { value: Boolean(this.field('webSearch')), overridden: this.overridden('webSearch') },
          alphaSearch: { value: Boolean(this.field('alphaSearch')), overridden: this.overridden('alphaSearch') },
          remoteCompaction: { value: Boolean(this.field('remoteCompaction')), overridden: this.overridden('remoteCompaction') },
          fallbackToBasicCompaction: { value: this.field('fallbackToBasicCompaction') !== false, overridden: this.overridden('fallbackToBasicCompaction') },
          baseURL: String(this.field('baseURL') ?? ''),
          model: String(this.field('model') ?? ''),
          hint: language() === 'zh' ? copy.zh.hint : copy.en.hint,
        }
      }
      bind() { return this.store }
      subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
      publish() {
        this.store.set(this.projection())
        for (const listener of this.listeners) listener()
      }
      edit(field, value) {
        this.draft = { ...(this.draft ?? this.value()), [field]: value }
        this.dirty = true
        this.failed = false
        this.publish()
      }
      discard() {
        this.draft = null
        this.dirty = false
        this.failed = false
        this.publish()
      }
      async save() {
        if (!this.dirty || this.saving || !this.snapshot().writable) return
        const next = this.draftValue()
        const previous = this.value()
        const changes = Object.keys(next).filter((field) => next[field] !== previous[field])
        this.saving = true
        this.failed = false
        this.publish()
        try {
          for (const field of changes) await this.scope.set(field, next[field])
          this.draft = null
          this.dirty = false
        } catch {
          this.failed = true
        } finally {
          this.saving = false
          this.publish()
        }
      }
      inject() { return { hooks: { lcxCard: this.bind() }, ...this.actions() } }
      actions() {
        return {
          edit: (field, value) => this.edit(field, value),
          save: () => { void this.save() },
          discard: () => this.discard(),
        }
      }
    }

    function CheckRow({ id, label, help, checked, disabled, onChange }) {
      return React.createElement('div', { className: 'lcx-row' },
        React.createElement('input', { id, type: 'checkbox', checked, disabled, onChange: (event) => onChange(event.target.checked) }),
        React.createElement('label', { htmlFor: id }, label, React.createElement('small', null, help)),
      )
    }

    function LcxCard(props) {
      const t = copy[language()]
      const state = props.useLcxCard((snapshot) => snapshot)
      const [open, setOpen] = React.useState(false)
      if (!state.available) return null
      const disabled = !state.writable || state.saving
      return React.createElement('li', { className: 'lcx-card' },
        React.createElement('button', { className: 'lcx-card-head', type: 'button', 'aria-expanded': open, onClick: () => setOpen(!open) },
          React.createElement('span', { className: 'lcx-card-title' }, React.createElement('strong', null, t.title), React.createElement('span', null, t.description)),
          state.dirty ? React.createElement('span', null, t.unsaved) : null,
          React.createElement('span', null, open ? '⌃' : '⌄'),
        ),
        open ? React.createElement('div', { className: 'lcx-card-body' },
          React.createElement(CheckRow, { id: 'lcx-enabled', label: t.enabled, help: t.enabledHelp, checked: state.enabled.value, disabled, onChange: (value) => props.edit('enabled', value) }),
          React.createElement(CheckRow, { id: 'lcx-web-search', label: t.webSearch, help: t.webSearchHelp, checked: state.webSearch.value, disabled: disabled || !state.enabled.value, onChange: (value) => props.edit('webSearch', value) }),
          React.createElement(CheckRow, { id: 'lcx-alpha-search', label: t.alphaSearch, help: t.alphaSearchHelp, checked: state.alphaSearch.value, disabled: disabled || !state.enabled.value, onChange: (value) => props.edit('alphaSearch', value) }),
          React.createElement(CheckRow, { id: 'lcx-compaction', label: t.compaction, help: t.compactionHelp, checked: state.remoteCompaction.value, disabled: disabled || !state.enabled.value, onChange: (value) => props.edit('remoteCompaction', value) }),
          React.createElement(CheckRow, { id: 'lcx-fallback', label: t.fallback, help: t.fallbackHelp, checked: state.fallbackToBasicCompaction.value, disabled: disabled || !state.enabled.value || !state.remoteCompaction.value, onChange: (value) => props.edit('fallbackToBasicCompaction', value) }),
          React.createElement('div', { className: 'lcx-fields' },
            React.createElement('div', { className: 'lcx-field' }, React.createElement('label', { htmlFor: 'lcx-endpoint' }, t.endpoint), React.createElement('input', { id: 'lcx-endpoint', className: 'lcx-input', value: state.baseURL, disabled, onChange: (event) => props.edit('baseURL', event.target.value) })),
            React.createElement('div', { className: 'lcx-field' }, React.createElement('label', { htmlFor: 'lcx-model' }, t.model), React.createElement('input', { id: 'lcx-model', className: 'lcx-input', value: state.model, disabled, onChange: (event) => props.edit('model', event.target.value) })),
          ),
          React.createElement('p', { className: 'lcx-help' }, state.hint),
          React.createElement('div', { className: 'lcx-footer' },
            state.failed ? React.createElement('span', { className: 'lcx-error' }, t.saveFailed) : null,
            React.createElement('button', { type: 'button', disabled: !state.dirty || disabled, onClick: props.discard }, t.discard),
            React.createElement('button', { className: 'primary', type: 'button', disabled: !state.dirty || disabled, onClick: props.save }, state.saving ? t.saving : t.save),
          ),
        ) : null,
      )
    }

    const inject = ['slots', 'locale', 'settingsScope']

    function apply(ctx) {
      const slots = ctx.slots ?? ctx.get('slots')
      const scopeService = ctx.settingsScope ?? ctx.get('settingsScope')
      if (slots === undefined || scopeService === undefined) return
      const scope = scopeService.bind({ namespace: NAMESPACE })
      const controller = new SettingsController(scope)
      slots.inject('settings.plugin.item', () => slots.register({
        name: 'settings.plugin.item',
        key: NAMESPACE,
        inject: () => controller.inject(),
      }, LcxCard))
      ctx.effect(() => () => controller.stop(), 'lcx-codex: settings card')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
