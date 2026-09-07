// src/client/index.tsx
window.__ModuleLoader__.load({
  id: "dsh-lcx-codex",
  factory: (require2) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require2("react");
    const { createSnapshotStore } = require2(
      "@deepseek-ai/dsh-client-store"
    );
    const NAMESPACE = "lcx-codex";
    const FIELDS = [
      "enabled",
      "webSearch",
      "advancedHostedSearch",
      "alphaSearch"
    ];
    const DEFAULTS = Object.fromEntries(
      FIELDS.map((field) => [field, false])
    );
    const css = `.lcx-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;list-style:none}.lcx-head{width:100%;display:flex;justify-content:space-between;padding:14px 16px;border:0;background:transparent;color:inherit}.lcx-body{border-top:1px solid var(--dsw-alias-border-l2);padding:12px 16px}.lcx-row{display:flex;gap:9px;padding:8px 0}.lcx-row small,.lcx-help{display:block;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}.lcx-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}.lcx-foot button{padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit}`;
    if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="dsh-lcx-codex"]')) {
      const tag = document.createElement("style");
      tag.dataset.pluginCss = "dsh-lcx-codex";
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    const copy = {
      zh: {
        title: "Responses / Codex \u80FD\u529B",
        desc: "LCX \u8DDF\u968F DSH \u5F53\u524D\u4F1A\u8BDD\u9009\u62E9\u7684 GPT Responses route\uFF1B\u6A21\u578B\u3001endpoint \u548C credential \u7EE7\u7EED\u53EA\u7531 DSH \u7BA1\u7406\u3002",
        enabled: "\u542F\u7528 LCX\uFF08\u63A5\u7BA1\u5F53\u524D GPT Responses \u4F1A\u8BDD\uFF09",
        enabledHelp: "\u5207\u6362 Claude\u3001Gemini\u3001DeepSeek \u7B49\u975E GPT \u6A21\u578B\u524D\u5148\u5173\u95ED LCX\uFF1B\u6A21\u578B\u5207\u6362\u672C\u8EAB\u4E0D\u9700\u8981\u91CD\u542F DSH\u3002",
        web: "\u4F7F\u7528 GPT Hosted Search \u4F5C\u4E3A DSH web_search \u540E\u7AEF",
        webHelp: "\u4E0D\u4F1A\u65B0\u589E\u7B2C\u4E8C\u4E2A\u666E\u901A\u641C\u7D22\u5DE5\u5177\uFF1B\u666E\u901A web_search \u81EA\u52A8\u8DDF\u968F\u5F53\u524D Agent \u7684 GPT Responses route\u3002",
        advanced: "\u542F\u7528\u9AD8\u7EA7 Hosted \u5DE5\u5177\uFF08websearch_gpt_advanced\uFF09",
        advancedHelp: "\u53EA\u5728\u9700\u8981\u57DF\u540D\u8FC7\u6EE4\u3001\u4F4D\u7F6E\u3001search context\u3001\u56FE\u7247\u7B49\u539F\u751F Hosted \u53C2\u6570\u65F6\u4F7F\u7528\uFF1B\u9ED8\u8BA4\u5173\u95ED\u4EE5\u4FDD\u6301\u5DE5\u5177 schema \u7A33\u5B9A\u3002",
        alpha: "\u542F\u7528 Alpha command\uFF08websearch_alpha\uFF09",
        alphaHelp: "\u4EC5 capability probe \u5BF9\u5F53\u524D route/schema \u9A8C\u8BC1\u901A\u8FC7\u540E\u624D\u771F\u6B63\u6CE8\u518C\u3002",
        save: "\u4FDD\u5B58",
        discard: "\u653E\u5F03\u4FEE\u6539",
        saving: "\u4FDD\u5B58\u4E2D\u2026",
        saveError: "\u672A\u80FD\u786E\u8BA4\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u3002\u4FEE\u6539\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u91CD\u8BD5\u6216\u653E\u5F03\u4FEE\u6539\u4EE5\u67E5\u770B\u5F53\u524D\u8BBE\u7F6E\u3002"
      },
      en: {
        title: "Responses / Codex capabilities",
        desc: "LCX follows the GPT Responses route selected by the current DSH session. Model, endpoint and credentials remain DSH-owned.",
        enabled: "Enable LCX (own current GPT Responses conversation)",
        enabledHelp: "Turn LCX off before switching to Claude, Gemini, DeepSeek, or another non-GPT model. Model switching itself does not require a DSH restart.",
        web: "Use GPT Hosted Search as DSH web_search backend",
        webHelp: "Keeps DSH web_search as the single ordinary search tool and follows the active Agent GPT Responses route.",
        advanced: "Enable advanced Hosted tool (websearch_gpt_advanced)",
        advancedHelp: "Only for native Hosted controls such as domains, location, context size and image search; off by default for stable tool schemas.",
        alpha: "Enable Alpha command (websearch_alpha)",
        alphaHelp: "Registered only after a matching capability probe.",
        save: "Save",
        discard: "Discard",
        saving: "Saving\u2026",
        saveError: "Could not confirm settings were saved. Changes are kept; retry or discard to view current settings."
      }
    };
    function valueFrom(snapshot) {
      const value = snapshot.value ?? {};
      return {
        ...DEFAULTS,
        ...Object.fromEntries(
          FIELDS.map((field) => [field, Boolean(value[field])])
        )
      };
    }
    class Controller {
      scope;
      draft;
      dirty;
      saving;
      saveError;
      store;
      stop;
      constructor(scope) {
        this.scope = scope;
        this.draft = null;
        this.dirty = false;
        this.saving = false;
        this.saveError = false;
        this.store = createSnapshotStore(this.projection());
        this.stop = scope.subscribe(() => {
          if (!this.dirty) this.draft = null;
          this.publish();
        });
      }
      snapshot() {
        return this.scope.getSnapshot();
      }
      value() {
        return valueFrom(this.snapshot());
      }
      draftValue() {
        return { ...this.value(), ...this.draft ?? {} };
      }
      projection() {
        const s = this.snapshot(), value = this.draftValue(), fields = Object.fromEntries(
          FIELDS.map((field) => [field, { value: Boolean(value[field]) }])
        );
        return {
          available: s.status === "ready",
          writable: s.writable,
          dirty: this.dirty,
          saving: this.saving,
          saveError: this.saveError,
          ...fields
        };
      }
      publish() {
        this.store.set(this.projection());
      }
      edit(field, value) {
        if (!FIELDS.includes(field) || this.saving || !this.snapshot().writable) return;
        this.draft = {
          ...this.draft,
          [field]: Boolean(value)
        };
        if (this.value()[field] === Boolean(value)) delete this.draft[field];
        this.dirty = Object.keys(this.draft).length > 0;
        this.saveError = false;
        this.publish();
      }
      discard() {
        if (this.saving) return;
        this.draft = null;
        this.dirty = false;
        this.saveError = false;
        this.publish();
      }
      async save() {
        if (!this.dirty || this.saving || !this.snapshot().writable || this.snapshot().status !== "ready") return;
        const next = this.draftValue(), prev = this.value();
        const fields = FIELDS.filter((field) => next[field] !== prev[field]);
        this.saving = true;
        this.saveError = false;
        this.publish();
        try {
          if (fields.length) {
            await this.scope.mutate(fields.map((field) => ({
              op: "set",
              path: [field],
              value: next[field]
            })));
            if (this.snapshot().status !== "ready" || fields.some((field) => this.value()[field] !== next[field]))
              throw new Error("Settings mutation was not confirmed");
          }
          this.draft = null;
          this.dirty = false;
        } catch {
          this.saveError = true;
        } finally {
          this.saving = false;
          this.publish();
        }
      }
      inject() {
        return {
          hooks: { lcxCard: this.store },
          edit: (field, value) => this.edit(field, value),
          save: () => void this.save(),
          discard: () => this.discard()
        };
      }
    }
    function Row({
      id,
      label,
      help,
      checked,
      disabled,
      onChange
    }) {
      return React.createElement(
        "div",
        { className: "lcx-row" },
        React.createElement("input", {
          id,
          type: "checkbox",
          checked,
          disabled,
          onChange: (event) => onChange(event.target.checked)
        }),
        React.createElement(
          "label",
          { htmlFor: id },
          label,
          React.createElement("small", null, help)
        )
      );
    }
    function Card(props) {
      const t = props.t, s = props.useLcxCard((state) => state), [open, setOpen] = React.useState(false);
      if (!s.available) return null;
      const disabled = !s.writable || s.saving;
      return React.createElement(
        "li",
        { className: "lcx-card" },
        React.createElement(
          "button",
          {
            className: "lcx-head",
            type: "button",
            onClick: () => setOpen(!open)
          },
          React.createElement("strong", null, t("title")),
          React.createElement("span", null, open ? "\u2303" : "\u2304")
        ),
        open ? React.createElement(
          "div",
          { className: "lcx-body" },
          React.createElement("p", { className: "lcx-help" }, t("desc")),
          React.createElement(Row, {
            id: "lcx-enabled",
            label: t("enabled"),
            help: t("enabledHelp"),
            checked: s.enabled.value,
            disabled,
            onChange: (value) => props.edit("enabled", value)
          }),
          React.createElement(Row, {
            id: "lcx-web",
            label: t("web"),
            help: t("webHelp"),
            checked: s.webSearch.value,
            disabled: disabled || !s.enabled.value,
            onChange: (value) => props.edit("webSearch", value)
          }),
          React.createElement(Row, {
            id: "lcx-advanced",
            label: t("advanced"),
            help: t("advancedHelp"),
            checked: s.advancedHostedSearch.value,
            disabled: disabled || !s.enabled.value || !s.webSearch.value,
            onChange: (value) => props.edit("advancedHostedSearch", value)
          }),
          React.createElement(Row, {
            id: "lcx-alpha",
            label: t("alpha"),
            help: t("alphaHelp"),
            checked: s.alphaSearch.value,
            disabled: disabled || !s.enabled.value,
            onChange: (value) => props.edit("alphaSearch", value)
          }),
          React.createElement(
            "p",
            { role: "alert", hidden: !s.saveError },
            s.saveError ? t("saveError") : ""
          ),
          React.createElement(
            "div",
            { className: "lcx-foot" },
            React.createElement(
              "button",
              { disabled: !s.dirty || disabled, onClick: props.discard },
              t("discard")
            ),
            React.createElement(
              "button",
              { disabled: !s.dirty || disabled, onClick: props.save },
              s.saving ? t("saving") : t("save")
            )
          )
        ) : null
      );
    }
    const inject = ["slots", "locale", "settingsScope"];
    function apply(ctx) {
      const slots = ctx.slots ?? ctx.get("slots"), svc = ctx.settingsScope ?? ctx.get("settingsScope"), locale = ctx.locale ?? ctx.get("locale");
      if (!slots || !svc || !locale) return;
      for (const language of ["zh", "en"])
        ctx.effect(() => locale.register(NAMESPACE, language, copy[language]), `lcx-codex ${language} dictionary`);
      const controller = new Controller(svc.bind({ namespace: NAMESPACE }));
      slots.inject(
        "settings.plugin.item",
        () => slots.register(
          {
            name: "settings.plugin.item",
            key: NAMESPACE,
            locale: NAMESPACE,
            inject: () => controller.inject()
          },
          Card
        )
      );
      ctx.effect(() => () => controller.stop(), "lcx-codex settings card");
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
