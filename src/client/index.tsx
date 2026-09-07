import type { ClientModuleLoaderTarget } from "@deepseek-ai/dsh-client-modules/client";
import type { LocaleRuntime } from "@deepseek-ai/dsh-client-locale/client";

type Field =
  | "enabled"
  | "webSearch"
  | "advancedHostedSearch"
  | "alphaSearch";

type Values = Record<Field, boolean>;

type ScopeSnapshot = {
  status: string;
  writable: boolean;
  value?: Record<string, unknown>;
};

type SettingsScope = {
  bind(options: { namespace: string }): SettingsScope;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ScopeSnapshot;
  mutate(ops: readonly { op: "set"; path: [Field]; value: boolean }[]): Promise<void>;
};

type Store<T> = {
  set(value: T): void;
};

type StoreFactory = {
  createSnapshotStore<T>(value: T): Store<T>;
};

type ControllerInjection = {
  hooks: { lcxCard: Store<CardState> };
  edit(field: Field, value: boolean): void;
  save(): void;
  discard(): void;
};

type ReactModule = {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
  useState<T>(initialState: T): [T, (value: T) => void];
};

type CardState = {
  available: boolean;
  writable: boolean;
  dirty: boolean;
  saving: boolean;
  saveError: boolean;
} & Record<Field, { value: boolean }>;

type CardProps = {
  t(key: string): string;
  useLcxCard(selector: (state: CardState) => CardState): CardState;
  edit(field: Field, value: boolean): void;
  save(): void;
  discard(): void;
};

type ModuleExports = {
  apply?: (ctx: PluginContext) => void;
  inject?: string[];
};

type PluginContext = {
  locale?: LocaleRuntime;
  slots?: Slots;
  settingsScope?: SettingsScope;
  get(key: "slots"): Slots | undefined;
  get(key: "settingsScope"): SettingsScope | undefined;
  get(key: "locale"): LocaleRuntime | undefined;
  effect(cleanup: () => () => void, name: string): void;
};

type Slots = {
  inject(name: string, callback: () => unknown): unknown;
  register(definition: {
    name: string;
    key: string;
    locale: string;
    inject(): ControllerInjection;
  }, component: (props: CardProps) => unknown): unknown;
};

type Require = (specifier: string) => unknown;

declare global {
  interface Window {
    __ModuleLoader__: Pick<ClientModuleLoaderTarget, "load">;
  }
}

window.__ModuleLoader__.load({
  id: "dsh-lcx-codex",
  factory: (require) => {
    const module: { exports: ModuleExports } = { exports: {} };
    const exports = module.exports;
    const React = require("react") as ReactModule;
    const { createSnapshotStore } = require(
      "@deepseek-ai/dsh-client-store",
    ) as StoreFactory;
    const NAMESPACE = "lcx-codex";
    const FIELDS: Field[] = [
      "enabled",
      "webSearch",
      "advancedHostedSearch",
      "alphaSearch",
    ];
    const DEFAULTS: Values = Object.fromEntries(
      FIELDS.map((field) => [field, false]),
    ) as Values;
    const css = `.lcx-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;list-style:none}.lcx-head{width:100%;display:flex;justify-content:space-between;padding:14px 16px;border:0;background:transparent;color:inherit}.lcx-body{border-top:1px solid var(--dsw-alias-border-l2);padding:12px 16px}.lcx-row{display:flex;gap:9px;padding:8px 0}.lcx-row small,.lcx-help{display:block;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}.lcx-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}.lcx-foot button{padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit}`;
    if (
      typeof document !== "undefined" &&
      !document.querySelector('style[data-plugin-css="dsh-lcx-codex"]')
    ) {
      const tag = document.createElement("style");
      tag.dataset.pluginCss = "dsh-lcx-codex";
      tag.textContent = css;
      document.head.appendChild(tag);
    }
    const copy = {
      zh: {
        title: "Responses / Codex 能力",
        desc: "LCX 跟随 DSH 当前会话选择的 GPT Responses route；模型、endpoint 和 credential 继续只由 DSH 管理。",
        enabled: "启用 LCX（接管当前 GPT Responses 会话）",
        enabledHelp:
          "切换 Claude、Gemini、DeepSeek 等非 GPT 模型前先关闭 LCX；模型切换本身不需要重启 DSH。",
        web: "使用 GPT Hosted Search 作为 DSH web_search 后端",
        webHelp:
          "不会新增第二个普通搜索工具；普通 web_search 自动跟随当前 Agent 的 GPT Responses route。",
        advanced: "启用高级 Hosted 工具（websearch_gpt_advanced）",
        advancedHelp:
          "只在需要域名过滤、位置、search context、图片等原生 Hosted 参数时使用；默认关闭以保持工具 schema 稳定。",
        alpha: "启用 Alpha command（websearch_alpha）",
        alphaHelp:
          "仅 capability probe 对当前 route/schema 验证通过后才真正注册。",
        save: "保存",
        discard: "放弃修改",
        saving: "保存中…",
        saveError: "未能确认设置已保存。修改已保留，请重试或放弃修改以查看当前设置。",
      },
      en: {
        title: "Responses / Codex capabilities",
        desc: "LCX follows the GPT Responses route selected by the current DSH session. Model, endpoint and credentials remain DSH-owned.",
        enabled: "Enable LCX (own current GPT Responses conversation)",
        enabledHelp:
          "Turn LCX off before switching to Claude, Gemini, DeepSeek, or another non-GPT model. Model switching itself does not require a DSH restart.",
        web: "Use GPT Hosted Search as DSH web_search backend",
        webHelp:
          "Keeps DSH web_search as the single ordinary search tool and follows the active Agent GPT Responses route.",
        advanced: "Enable advanced Hosted tool (websearch_gpt_advanced)",
        advancedHelp:
          "Only for native Hosted controls such as domains, location, context size and image search; off by default for stable tool schemas.",
        alpha: "Enable Alpha command (websearch_alpha)",
        alphaHelp: "Registered only after a matching capability probe.",
        save: "Save",
        discard: "Discard",
        saving: "Saving…",
        saveError: "Could not confirm settings were saved. Changes are kept; retry or discard to view current settings.",
      },
    };
    function valueFrom(snapshot: ScopeSnapshot): Values {
      const value = snapshot.value ?? {};
      return {
        ...DEFAULTS,
        ...(Object.fromEntries(
          FIELDS.map((field) => [field, Boolean(value[field])]),
        ) as Values),
      };
    }
    class Controller {
      scope: SettingsScope;
      draft: Partial<Values> | null;
      dirty: boolean;
      saving: boolean;
      saveError: boolean;
      store: Store<CardState>;
      stop: () => void;

      constructor(scope: SettingsScope) {
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
      snapshot(): ScopeSnapshot {
        return this.scope.getSnapshot();
      }
      value(): Values {
        return valueFrom(this.snapshot());
      }
      draftValue(): Values {
        return { ...this.value(), ...(this.draft ?? {}) };
      }
      projection(): CardState {
        const s = this.snapshot(),
          value = this.draftValue(),
          fields = Object.fromEntries(
            FIELDS.map((field) => [field, { value: Boolean(value[field]) }]),
          ) as Record<Field, { value: boolean }>;
        return {
          available: s.status === "ready",
          writable: s.writable,
          dirty: this.dirty,
          saving: this.saving,
          saveError: this.saveError,
          ...fields,
        };
      }
      publish(): void {
        this.store.set(this.projection());
      }
      edit(field: Field, value: boolean): void {
        if (!FIELDS.includes(field) || this.saving || !this.snapshot().writable) return;
        this.draft = {
          ...this.draft,
          [field]: Boolean(value),
        };
        if (this.value()[field] === Boolean(value)) delete this.draft[field];
        this.dirty = Object.keys(this.draft).length > 0;
        this.saveError = false;
        this.publish();
      }
      discard(): void {
        if (this.saving) return;
        this.draft = null;
        this.dirty = false;
        this.saveError = false;
        this.publish();
      }
      async save(): Promise<void> {
        if (!this.dirty || this.saving || !this.snapshot().writable || this.snapshot().status !== "ready") return;
        const next = this.draftValue(),
          prev = this.value();
        const fields = FIELDS.filter((field) => next[field] !== prev[field]);
        this.saving = true;
        this.saveError = false;
        this.publish();
        try {
          if (fields.length) {
            await this.scope.mutate(fields.map((field) => ({
              op: "set", path: [field], value: next[field],
            })));
            // DSH may recover a rejected mutation without rejecting its promise.
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
      inject(): ControllerInjection {
        return {
          hooks: { lcxCard: this.store },
          edit: (field: Field, value: boolean) => this.edit(field, value),
          save: () => void this.save(),
          discard: () => this.discard(),
        };
      }
    }
    function Row({
      id,
      label,
      help,
      checked,
      disabled,
      onChange,
    }: {
      id: string;
      label: string;
      help: string;
      checked: boolean;
      disabled: boolean;
      onChange(value: boolean): void;
    }) {
      return React.createElement(
        "div",
        { className: "lcx-row" },
        React.createElement("input", {
          id,
          type: "checkbox",
          checked,
          disabled,
          onChange: (event: { target: { checked: boolean } }) =>
            onChange(event.target.checked),
        }),
        React.createElement(
          "label",
          { htmlFor: id },
          label,
          React.createElement("small", null, help),
        ),
      );
    }
    function Card(props: CardProps) {
      const t = props.t,
        s = props.useLcxCard((state) => state),
        [open, setOpen] = React.useState(false);
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
            onClick: () => setOpen(!open),
          },
          React.createElement("strong", null, t("title")),
          React.createElement("span", null, open ? "⌃" : "⌄"),
        ),
        open
          ? React.createElement(
              "div",
              { className: "lcx-body" },
              React.createElement("p", { className: "lcx-help" }, t("desc")),
              React.createElement(Row, {
                id: "lcx-enabled",
                label: t("enabled"),
                help: t("enabledHelp"),
                checked: s.enabled.value,
                disabled,
                onChange: (value: boolean) => props.edit("enabled", value),
              }),
              React.createElement(Row, {
                id: "lcx-web",
                label: t("web"),
                help: t("webHelp"),
                checked: s.webSearch.value,
                disabled: disabled || !s.enabled.value,
                onChange: (value: boolean) => props.edit("webSearch", value),
              }),
              React.createElement(Row, {
                id: "lcx-advanced",
                label: t("advanced"),
                help: t("advancedHelp"),
                checked: s.advancedHostedSearch.value,
                disabled: disabled || !s.enabled.value || !s.webSearch.value,
                onChange: (value: boolean) =>
                  props.edit("advancedHostedSearch", value),
              }),
              React.createElement(Row, {
                id: "lcx-alpha",
                label: t("alpha"),
                help: t("alphaHelp"),
                checked: s.alphaSearch.value,
                disabled: disabled || !s.enabled.value,
                onChange: (value: boolean) => props.edit("alphaSearch", value),
              }),
              React.createElement(
                "p",
                { role: "alert", hidden: !s.saveError },
                s.saveError ? t("saveError") : "",
              ),
              React.createElement(
                "div",
                { className: "lcx-foot" },
                React.createElement(
                  "button",
                  { disabled: !s.dirty || disabled, onClick: props.discard },
                  t("discard"),
                ),
                React.createElement(
                  "button",
                  { disabled: !s.dirty || disabled, onClick: props.save },
                  s.saving ? t("saving") : t("save"),
                ),
              ),
            )
          : null,
      );
    }
    const inject = ["slots", "locale", "settingsScope"];
    function apply(ctx: PluginContext): void {
      const slots = ctx.slots ?? ctx.get("slots"),
        svc = ctx.settingsScope ?? ctx.get("settingsScope"),
        locale = ctx.locale ?? ctx.get("locale");
      if (!slots || !svc || !locale) return;
      for (const language of ["zh", "en"] as const)
        ctx.effect(() => locale.register(NAMESPACE, language, copy[language]), `lcx-codex ${language} dictionary`);
      const controller = new Controller(svc.bind({ namespace: NAMESPACE }));
      slots.inject("settings.plugin.item", () =>
        slots.register(
          {
            name: "settings.plugin.item",
            key: NAMESPACE,
            locale: NAMESPACE,
            inject: () => controller.inject(),
          },
          Card,
        ),
      );
      ctx.effect(() => () => controller.stop(), "lcx-codex settings card");
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
