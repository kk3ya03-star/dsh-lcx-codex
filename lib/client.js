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
      advancedHostedSearch: false,
      alphaSearch: false,
      remoteCompaction: false,
      fallbackToBasicCompaction: true,
      autoCompaction: true,
      webSearchTimeoutSeconds: 240,
      autoCompactionThresholdPercent: 90,
      emergencyPruneThresholdPercent: 95,
      provider: 'lcx',
      baseURL: 'https://api.lcxbot.com/v1',
      apiKeyEnv: 'LCX_API_KEY',
      model: 'gpt-5.6-sol',
    }
    const css = `.lcx-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;list-style:none}.lcx-head{width:100%;display:flex;justify-content:space-between;padding:14px 16px;border:0;background:transparent;color:inherit}.lcx-body{border-top:1px solid var(--dsw-alias-border-l2);padding:12px 16px}.lcx-row{display:flex;gap:9px;padding:8px 0}.lcx-row small,.lcx-help,.lcx-field small{display:block;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}.lcx-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px}.lcx-field{display:flex;flex-direction:column;gap:4px}.lcx-input{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px;background:transparent;color:inherit}.lcx-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}.lcx-foot button{padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit}`
    if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="dsh-lcx-codex"]')) {
      const tag = document.createElement('style')
      tag.dataset.pluginCss = 'dsh-lcx-codex'
      tag.textContent = css
      document.head.appendChild(tag)
    }
    const copy = {
      zh: {
        title: 'Responses / Codex 能力',
        desc: 'LCX 开启后从第一轮普通请求开始接管当前 GPT Responses 会话，并统一管理普通请求、工具、Native V2 压缩和续接。',
        enabled: '启用 LCX（接管当前 GPT Responses 会话）',
        enabledHelp: '切换 Claude、Gemini、DeepSeek 等非 GPT 模型前先关闭 LCX；模型切换本身不需要重启 DSH。',
        web: '使用 GPT Hosted Search 作为 DSH web_search 后端',
        webHelp: '不会新增第二个普通搜索工具；普通 web_search 自动跟随当前 Agent 的 GPT Responses 模型。',
        searchTimeout: 'web_search 超时（秒）',
        searchTimeoutHelp: '只调整 DSH 工具外层超时，不改变模型可见 schema。默认 240 秒；Hosted Search 较慢时避免 60 秒提前中断。',
        advanced: '启用高级 Hosted 工具（websearch_gpt_advanced）',
        advancedHelp: '只在需要域名过滤、位置、search context、图片等原生 Hosted 参数时使用；默认关闭以保持工具 schema 稳定。',
        alpha: '启用 Alpha command（websearch_alpha）',
        alphaHelp: '仅 capability probe 对当前 endpoint/provider/model/schema 验证通过后才真正注册。',
        autoCompact: '启用 Native-first 自动压缩',
        autoCompactHelp: '到主动阈值前不让 DSH 的 80% tool-result prune 改写历史；到主动阈值后优先 Native V2。',
        autoThreshold: 'Native 自动压缩阈值（%）',
        autoThresholdHelp: '建议 90%。允许 85–95%；262k 窗口在 90% 时仍约剩 26k tokens。',
        emergencyThreshold: 'DSH 紧急 prune 阈值（%）',
        emergencyThresholdHelp: '建议 95%。达到这里才允许 DSH tool-result-pruner 先救场；必须高于 Native 阈值。',
        fallback: 'Native 失败后回退 DSH basic compaction',
        fallbackHelp: 'Remote-first：只有 Native 请求失败才调用 basic summary，不并行双跑。',
        endpoint: 'Responses 地址',
        model: 'GPT 模型',
        save: '保存', discard: '放弃修改', saving: '保存中…',
      },
      en: {
        title: 'Responses / Codex capabilities',
        desc: 'When enabled, LCX owns the selected GPT Responses conversation from the first ordinary turn through tools, Native V2 compaction and continuation.',
        enabled: 'Enable LCX (own current GPT Responses conversation)',
        enabledHelp: 'Turn LCX off before switching to Claude, Gemini, DeepSeek, or another non-GPT model. Model switching itself does not require a DSH restart.',
        web: 'Use GPT Hosted Search as DSH web_search backend',
        webHelp: 'Keeps DSH web_search as the single ordinary search tool and follows the active Agent GPT Responses model.',
        searchTimeout: 'web_search timeout (seconds)',
        searchTimeoutHelp: 'Changes only the DSH tool deadline, not the model-visible schema. Default 240s to avoid premature 60s timeouts.',
        advanced: 'Enable advanced Hosted tool (websearch_gpt_advanced)',
        advancedHelp: 'Only for native Hosted controls such as domains, location, context size and image search; off by default for stable tool schemas.',
        alpha: 'Enable Alpha command (websearch_alpha)',
        alphaHelp: 'Registered only after a matching capability probe.',
        autoCompact: 'Enable Native-first automatic compaction',
        autoCompactHelp: 'Suppresses the stock 80% tool-result prune before the proactive threshold, then prefers Native V2.',
        autoThreshold: 'Native auto-compaction threshold (%)',
        autoThresholdHelp: 'Default 90%. Allowed 85–95%.',
        emergencyThreshold: 'DSH emergency prune threshold (%)',
        emergencyThresholdHelp: 'Default 95%. DSH tool-result pruning is allowed only in this emergency zone; must exceed the Native threshold.',
        fallback: 'Fall back to DSH basic compaction on Native failure',
        fallbackHelp: 'Remote-first: basic summary runs only after Native failure, never in parallel.',
        endpoint: 'Responses endpoint', model: 'GPT model',
        save: 'Save', discard: 'Discard', saving: 'Saving…',
      },
    }
    const lang = () => String(globalThis.navigator?.language ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
    function valueFrom(snapshot) { return { ...DEFAULTS, ...(snapshot.value ?? {}) } }
    class Controller {
      constructor(scope) {
        this.scope = scope; this.draft = null; this.dirty = false; this.saving = false
        this.store = createSnapshotStore(this.projection())
        this.stop = scope.subscribe(() => { if (!this.dirty) this.draft = null; this.publish() })
      }
      snapshot() { return this.scope.getSnapshot() }
      value() { return valueFrom(this.snapshot()) }
      draftValue() { return { ...this.value(), ...(this.draft ?? {}) } }
      field(name) { return this.draftValue()[name] }
      projection() {
        const s = this.snapshot()
        const bools = ['enabled','webSearch','advancedHostedSearch','alphaSearch','fallbackToBasicCompaction','autoCompaction']
        return {
          available: s.status === 'ready', writable: s.writable, dirty: this.dirty, saving: this.saving,
          ...Object.fromEntries(bools.map((f) => [f, { value: f === 'fallbackToBasicCompaction' || f === 'autoCompaction' ? this.field(f) !== false : Boolean(this.field(f)) }])),
          webSearchTimeoutSeconds: Number(this.field('webSearchTimeoutSeconds') ?? 240),
          autoCompactionThresholdPercent: Number(this.field('autoCompactionThresholdPercent') ?? 90),
          emergencyPruneThresholdPercent: Number(this.field('emergencyPruneThresholdPercent') ?? 95),
          baseURL: String(this.field('baseURL') ?? ''), model: String(this.field('model') ?? ''),
        }
      }
      publish() { this.store.set(this.projection()) }
      edit(field, value) { this.draft = { ...(this.draft ?? this.value()), [field]: value }; this.dirty = true; this.publish() }
      discard() { this.draft = null; this.dirty = false; this.publish() }
      async save() {
        if (!this.dirty || this.saving || !this.snapshot().writable) return
        const next = this.draftValue(), prev = this.value(); this.saving = true; this.publish()
        try {
          for (const f of Object.keys(next)) if (next[f] !== prev[f]) await this.scope.set(f, next[f])
          this.draft = null; this.dirty = false
        } finally { this.saving = false; this.publish() }
      }
      inject() { return { hooks: { lcxCard: this.store }, edit: (f,v) => this.edit(f,v), save: () => void this.save(), discard: () => this.discard() } }
    }
    function Row({ id, label, help, checked, disabled, onChange }) {
      return React.createElement('div', { className:'lcx-row' },
        React.createElement('input', { id, type:'checkbox', checked, disabled, onChange:e=>onChange(e.target.checked) }),
        React.createElement('label', { htmlFor:id }, label, React.createElement('small', null, help)))
    }
    function Field({ label, help, value, disabled, type='text', min, max, step, onChange }) {
      return React.createElement('div', { className:'lcx-field' },
        React.createElement('label', null, label),
        React.createElement('input', { className:'lcx-input', type, value, disabled, min, max, step, onChange }),
        help ? React.createElement('small', null, help) : null)
    }
    function Card(props) {
      const t = copy[lang()], s = props.useLcxCard(x=>x), [open,setOpen] = React.useState(false)
      if (!s.available) return null
      const disabled = !s.writable || s.saving
      const numeric = (field) => (e) => props.edit(field, Number(e.target.value))
      return React.createElement('li', { className:'lcx-card' },
        React.createElement('button', { className:'lcx-head', type:'button', onClick:()=>setOpen(!open) }, React.createElement('strong',null,t.title), React.createElement('span',null,open?'⌃':'⌄')),
        open ? React.createElement('div', { className:'lcx-body' },
          React.createElement('p', { className:'lcx-help' }, t.desc),
          React.createElement(Row, { id:'lcx-enabled', label:t.enabled, help:t.enabledHelp, checked:s.enabled.value, disabled, onChange:v=>props.edit('enabled',v) }),
          React.createElement(Row, { id:'lcx-web', label:t.web, help:t.webHelp, checked:s.webSearch.value, disabled:disabled||!s.enabled.value, onChange:v=>props.edit('webSearch',v) }),
          React.createElement('div', { className:'lcx-fields' },
            React.createElement(Field, { label:t.searchTimeout, help:t.searchTimeoutHelp, type:'number', min:30, max:600, step:30, value:s.webSearchTimeoutSeconds, disabled:disabled||!s.enabled.value||!s.webSearch.value, onChange:numeric('webSearchTimeoutSeconds') })),
          React.createElement(Row, { id:'lcx-advanced', label:t.advanced, help:t.advancedHelp, checked:s.advancedHostedSearch.value, disabled:disabled||!s.enabled.value||!s.webSearch.value, onChange:v=>props.edit('advancedHostedSearch',v) }),
          React.createElement(Row, { id:'lcx-alpha', label:t.alpha, help:t.alphaHelp, checked:s.alphaSearch.value, disabled:disabled||!s.enabled.value, onChange:v=>props.edit('alphaSearch',v) }),
          React.createElement(Row, { id:'lcx-auto-compact', label:t.autoCompact, help:t.autoCompactHelp, checked:s.autoCompaction.value, disabled:disabled||!s.enabled.value, onChange:v=>props.edit('autoCompaction',v) }),
          React.createElement('div', { className:'lcx-fields' },
            React.createElement(Field, { label:t.autoThreshold, help:t.autoThresholdHelp, type:'number', min:85, max:95, step:1, value:s.autoCompactionThresholdPercent, disabled:disabled||!s.enabled.value||!s.autoCompaction.value, onChange:numeric('autoCompactionThresholdPercent') }),
            React.createElement(Field, { label:t.emergencyThreshold, help:t.emergencyThresholdHelp, type:'number', min:90, max:99, step:1, value:s.emergencyPruneThresholdPercent, disabled:disabled||!s.enabled.value||!s.autoCompaction.value, onChange:numeric('emergencyPruneThresholdPercent') })),
          React.createElement(Row, { id:'lcx-fallback', label:t.fallback, help:t.fallbackHelp, checked:s.fallbackToBasicCompaction.value, disabled:disabled||!s.enabled.value, onChange:v=>props.edit('fallbackToBasicCompaction',v) }),
          React.createElement('div', { className:'lcx-fields' },
            React.createElement(Field, { label:t.endpoint, value:s.baseURL, disabled, onChange:e=>props.edit('baseURL',e.target.value) }),
            React.createElement(Field, { label:t.model, value:s.model, disabled, onChange:e=>props.edit('model',e.target.value) })),
          React.createElement('div', { className:'lcx-foot' },
            React.createElement('button', { disabled:!s.dirty||disabled, onClick:props.discard }, t.discard),
            React.createElement('button', { disabled:!s.dirty||disabled, onClick:props.save }, s.saving?t.saving:t.save))) : null)
    }
    const inject = ['slots','locale','settingsScope']
    function apply(ctx) {
      const slots = ctx.slots ?? ctx.get('slots'), svc = ctx.settingsScope ?? ctx.get('settingsScope')
      if (!slots || !svc) return
      const controller = new Controller(svc.bind({ namespace:NAMESPACE }))
      slots.inject('settings.plugin.item', () => slots.register({ name:'settings.plugin.item', key:NAMESPACE, inject:()=>controller.inject() }, Card))
      ctx.effect(() => () => controller.stop(), 'lcx-codex settings card')
    }
    exports.apply = apply; exports.inject = inject; return module.exports
  },
})
