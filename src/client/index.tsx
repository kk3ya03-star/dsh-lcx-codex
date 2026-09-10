import type { ClientModuleLoaderTarget } from "@deepseek-ai/dsh-client-modules/client";
import type { LocaleRuntime } from "@deepseek-ai/dsh-client-locale/client";
import type {
  ConversationLocation,
  ConversationNodeDefinition,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { ChatConversationViewNode } from "@deepseek-ai/dsh-client-ui-chat/client";
import {
  extractSearchMedia,
  mergeSearchMedia,
  structuredSearchMedia,
  type SearchMediaItem,
  type StructuredMediaTool,
} from "./search-media.js";
import { installInlineMedia, inlineMediaCss } from "./inline-media.js";
import { installUsageSlots, searchUsageDefinition } from "./search-usage-ui.js";

const SEARCH_MEDIA_KIND = "lcx-search-media";

type SearchMediaData = {
  readonly items: readonly SearchMediaItem[];
  readonly provider: string;
  readonly model: string;
};

declare module "@deepseek-ai/dsh-client-ui-chat/client" {
  interface ChatNodeDataMap {
    "lcx-search-media": SearchMediaData;
  }
}

type Field =
  | "enabled"
  | "webSearch"
  | "advancedHostedSearch"
  | "alphaSearch"
  | "grokNativeWebSearch"
  | "grokNativeXSearch"
  | "searchMediaPreview";

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
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
  set(value: T): void;
};

type StoreFactory = {
  createSnapshotStore<T>(
    value: T,
    options?: { persist?: { name: string } },
  ): Store<T>;
};

type MediaPreference = {
  readonly enabled: boolean;
};

type ControllerInjection = {
  hooks: {
    lcxCard: Store<CardState>;
    mediaPreview: Store<MediaPreference>;
  };
  setMediaPreview(value: boolean): void;
  edit(field: Field, value: boolean): void;
  save(): void;
  discard(): void;
};

type ReactModule = {
  useEffect(effect: () => void | (() => void), deps: unknown[]): void;
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
  useState<T>(initialState: T): [T, (value: T | ((previous: T) => T)) => void];
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
  useMediaPreview(
    selector: (state: MediaPreference) => boolean,
  ): boolean;
  setMediaPreview(value: boolean): void;
  edit(field: Field, value: boolean): void;
  save(): void;
  discard(): void;
};

type ModuleExports = {
  apply?: (ctx: PluginContext) => void;
  inject?: string[];
};

type UiConversation = {
  events: {
    register(definition: ConversationNodeDefinition): () => void;
  };
};

type PluginContext = {
  locale?: LocaleRuntime;
  slots?: Slots;
  settingsScope?: SettingsScope;
  uiConversation?: UiConversation;
  get(key: "slots"): Slots | undefined;
  get(key: "settingsScope"): SettingsScope | undefined;
  get(key: "locale"): LocaleRuntime | undefined;
  get(key: "uiConversation"): UiConversation | undefined;
  effect(setup: () => () => void, name: string): void;
};

type Slots = {
  entriesOfSlot?: Parameters<typeof installUsageSlots>[0]['entriesOfSlot'];
  inject(name: string, callback: () => unknown): unknown;
  register<Props>(definition: {
    name: string;
    key: string;
    locale: string;
    inject(): unknown;
  }, component: (props: Props) => unknown): unknown;
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
    const mediaStore = createSnapshotStore<MediaPreference>(
      { enabled: false },
    );
    const FIELDS: Field[] = [
      "enabled",
      "webSearch",
      "advancedHostedSearch",
      "alphaSearch",
      "grokNativeWebSearch",
      "grokNativeXSearch",
      "searchMediaPreview",
    ];
    const DEFAULTS: Values = Object.fromEntries(
      FIELDS.map((field) => [field, false]),
    ) as Values;
    const css = `.lcx-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;list-style:none}.lcx-head{width:100%;display:flex;justify-content:space-between;padding:14px 16px;border:0;background:transparent;color:inherit}.lcx-body{border-top:1px solid var(--dsw-alias-border-l2);padding:12px 16px}.lcx-row{display:flex;gap:9px;padding:8px 0}.lcx-row small,.lcx-help{display:block;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}.lcx-group{border-top:1px solid var(--dsw-alias-border-l2);margin-top:10px;padding-top:14px}.lcx-group strong{font-size:14px}.lcx-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}.lcx-foot button{padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit}` + inlineMediaCss;
    function mountCss(): () => void {
      if (typeof document === "undefined") return () => {};
      if (document.querySelector('style[data-plugin-css="dsh-lcx-codex"]'))
        return () => {};
      const tag = document.createElement("style");
      tag.dataset.pluginCss = "dsh-lcx-codex";
      tag.textContent = css;
      document.head.appendChild(tag);
      return () => tag.remove();
    }
    const copy = {
      zh: {
        title: "Responses / Codex 能力",
        desc: "LCX 跟随 DSH 当前会话选择的 GPT Responses route；模型、endpoint 和 credential 继续只由 DSH 管理。",
        enabled: "启用 LCX（接管当前 GPT Responses 会话）",
        enabledHelp:
          "此开关仅接管 GPT Responses 会话；Grok 原生搜索由下方独立开关控制，其他非 GPT 模型继续使用 DSH 原生路径。",
        web: "使用 GPT Hosted Search 作为 DSH web_search 后端",
        webHelp:
          "不会新增第二个普通搜索工具；普通 web_search 自动跟随当前 Agent 的 GPT Responses route。",
        advanced: "启用高级 Hosted 工具（websearch_gpt_advanced）",
        advancedHelp:
          "只在需要域名过滤、位置、search context、图片等原生 Hosted 参数时使用；默认关闭以保持工具 schema 稳定。",
        alpha: "启用 Alpha command（websearch_alpha）",
        alphaHelp:
          "仅 capability probe 对当前 route/schema 验证通过后才真正注册。",
        mediaPreview: "搜索媒体预览",
        mediaPreviewHelp:
          "在回答下显示可用的搜索图片或直链预览，点击放大或播放；不可预览时保留原始回答与网页链接。此设置只改变界面显示。",
        mediaTitle: "媒体预览",
        mediaPlay: "播放视频",
        mediaEnlarge: "放大图片", mediaClose: "关闭预览",
        mediaMore: "展开其余 {count} 项", mediaLess: "收起预览", mediaPrevious: "上一张", mediaNext: "下一张",
        mediaResolve: "加载素材预览",
        mediaLoading: "正在获取媒体…",
        mediaUnavailable: "暂不能预览",
        mediaAll:"全部",mediaImages:"图片",mediaVideos:"视频",mediaImage:"图片",mediaVideo:"视频",mediaFilter:"媒体类型",
        mediaOpen: "打开原始媒体",
        grokTitle: "Grok 原生搜索",
        grokDesc: "使用 DSH 当前选择的 Grok 模型及其服务配置；与 GPT 功能开关独立。开启任一搜索后，Grok 仅使用原生搜索，网页读取和其他工具仍可用。",
        grokWeb: "启用原生 Web Search",
        grokWebHelp: "使用 Grok 的原生网页搜索。",
        grokX: "启用原生 X Search",
        grokXHelp: "使用 Grok 的原生 X 搜索；单独开启也不会使用 DSH 搜索。",
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
          "Applies only to GPT Responses conversations. Grok native search is controlled independently below; other non-GPT models continue through DSH normally.",
        web: "Use GPT Hosted Search as DSH web_search backend",
        webHelp:
          "Keeps DSH web_search as the single ordinary search tool and follows the active Agent GPT Responses route.",
        advanced: "Enable advanced Hosted tool (websearch_gpt_advanced)",
        advancedHelp:
          "Only for native Hosted controls such as domains, location, context size and image search; off by default for stable tool schemas.",
        alpha: "Enable Alpha command (websearch_alpha)",
        alphaHelp: "Registered only after a matching capability probe.",
        mediaPreview: "Search media previews",
        mediaPreviewHelp:
          "Preview available search images or direct media links below the answer. Unavailable media leaves the original answer and links intact. This setting changes presentation only.",
        mediaTitle: "Media previews",
        mediaPlay: "Play video",
        mediaEnlarge: "Enlarge image", mediaClose: "Close preview",
        mediaMore: "Show {count} more", mediaLess: "Show fewer", mediaPrevious: "Previous image", mediaNext: "Next image",
        mediaResolve: "Load media preview",
        mediaLoading: "Resolving media…",
        mediaUnavailable: "Preview unavailable",
        mediaAll:"All",mediaImages:"Photos",mediaVideos:"Videos",mediaImage:"Photo",mediaVideo:"Video",mediaFilter:"Media type",
        mediaOpen: "Open original media",
        grokTitle: "Grok native search",
        grokDesc: "Uses the Grok model and provider profile currently selected in DSH, independently of the GPT switch. When either search is enabled, Grok uses native search while page reading and other tools remain available.",
        grokWeb: "Enable native Web Search",
        grokWebHelp: "Use Grok's native web search.",
        grokX: "Enable native X Search",
        grokXHelp: "Use Grok's native X search. Enabling it alone also avoids DSH search.",
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
    type SearchMediaState = SearchMediaData & {
      readonly anchorSeq: number;
      readonly location: ConversationLocation;
      readonly structuredItems: readonly SearchMediaItem[];
      readonly pending: Readonly<Record<string, StructuredMediaTool>>;
      readonly ready: boolean;
    };
    const hostedMediaTool = (value: unknown): value is StructuredMediaTool =>
      value === "web_search" || value === "websearch_gpt_advanced";

    const searchMediaDefinition: ConversationNodeDefinition<SearchMediaState> = {
      kind: SEARCH_MEDIA_KIND,
      target: "chat",
      match(event) {
        if (event.type === "turn/start")
          return { id: String(event.data.turn), role: "start" };
        if (event.type === "tool/result" || event.type === "tool/call")
          return { id: String(event.data.turn), role: "update" };
        if (
          event.type !== "assistant/message" ||
          event.surfaceOp !== "append" ||
          event.data.interrupted === true
        )
          return null;
        const source = event.data.message.source;
        if (source.kind !== "model" || !/^(?:gpt|grok)/i.test(source.model))
          return null;
        return { id: String(event.data.turn), role: "update" };
      },
      start(_context, match) {
        if (match.event.type !== "turn/start")
          throw new Error("search media state requires turn/start");
        return {
          anchorSeq: 0,
          location: match.location,
          items: [],
          structuredItems: [],
          provider: "",
          model: "",
          pending: {},
          ready: false,
        };
      },
      update(context, match) {
        if (match.event.type === "tool/call") {
          if (!hostedMediaTool(match.event.data.name)) return context.state;
          return {
            ...context.state,
            pending: {
              ...context.state.pending,
              [match.event.data.callId]: match.event.data.name,
            },
          };
        }
        if (match.event.type === "tool/result") {
          const callId = match.event.data.message.source.callId;
          const tool = context.state.pending[callId];
          if (tool === undefined) return context.state;
          const pending = { ...context.state.pending };
          delete pending[callId];
          return {
            ...context.state,
            pending,
            structuredItems: mergeSearchMedia(
              context.state.structuredItems,
              structuredSearchMedia(match.event.data.meta, tool),
            ),
          };
        }
        if (match.event.type !== "assistant/message") return context.state;
        const message = match.event.data.message;
        const source = message.source;
        if (source.kind !== "model") return context.state;
        const text = message.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n");
        return {
          ...context.state,
          anchorSeq: match.event.seq,
          location: match.location,
          items: context.state.structuredItems.length
            ? context.state.structuredItems
            : extractSearchMedia(text),
          provider: source.provider,
          model: source.model,
          ready: true,
        };
      },
      publication: (match) =>
        match.event.type === "assistant/message" ? "immediate" : "none",
      buildViewNode(context) {
        const state = context.state;
        if (state === undefined || !state.ready || state.items.length === 0) return null;
        const node: ChatConversationViewNode & {
          readonly kind: typeof SEARCH_MEDIA_KIND;
          readonly data: SearchMediaData;
        } = {
          key: context.key,
          kind: SEARCH_MEDIA_KIND,
          id: context.id,
          target: "chat",
          anchorSeq: state.anchorSeq,
          location: state.location,
          visibility: "visible",
          data: {
            items: state.items,
            provider: state.provider,
            model: state.model,
          },
        };
        return node;
      },
    };

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
        mediaStore.set({ enabled: this.value().searchMediaPreview });
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
        mediaStore.set({ enabled: this.value().searchMediaPreview });
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
          hooks: {
            lcxCard: this.store,
            mediaPreview: mediaStore,
          },
          setMediaPreview: (value: boolean) => this.edit("searchMediaPreview", value),
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
                id: "lcx-media-preview",
                label: t("mediaPreview"),
                help: t("mediaPreviewHelp"),
                checked: s.searchMediaPreview.value,
                disabled,
                onChange: props.setMediaPreview,
              }),
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
                "section",
                { className: "lcx-group" },
                React.createElement("strong", null, t("grokTitle")),
                React.createElement("p", { className: "lcx-help" }, t("grokDesc")),
                React.createElement(Row, {
                  id: "lcx-grok-web",
                  label: t("grokWeb"),
                  help: t("grokWebHelp"),
                  checked: s.grokNativeWebSearch.value,
                  disabled,
                  onChange: (value: boolean) =>
                    props.edit("grokNativeWebSearch", value),
                }),
                React.createElement(Row, {
                  id: "lcx-grok-x",
                  label: t("grokX"),
                  help: t("grokXHelp"),
                  checked: s.grokNativeXSearch.value,
                  disabled,
                  onChange: (value: boolean) =>
                    props.edit("grokNativeXSearch", value),
                }),
              ),
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
    type MediaNodeProps = {
      node: ChatConversationViewNode & {
        readonly kind: typeof SEARCH_MEDIA_KIND;
        readonly data: SearchMediaData;
      };
      t(key: string): string;
      useMediaPreview(
        selector: (state: MediaPreference) => boolean,
      ): boolean;
    };

    function InlineMedia({node,t}: {node:MediaNodeProps['node'];t:(key:string)=>string}):unknown {
      const [marker,setMarker]=React.useState<HTMLElement|null>(null);
      React.useEffect(()=>{
        if (!marker) return;
        return installInlineMedia(marker,node.data.items,{image:t('mediaEnlarge'),video:t('mediaPlay'),close:t('mediaClose'),source:t('mediaOpen'),more:t('mediaMore'),less:t('mediaLess'),previous:t('mediaPrevious'),next:t('mediaNext')});
      },[marker,node.data.items,t]);
      return React.createElement('span',{ref:setMarker,'aria-hidden':true});
    }
    function MediaNode(props: MediaNodeProps): unknown {
      const enabled=props.useMediaPreview(state=>state?.enabled===true);
      return enabled?React.createElement(InlineMedia,{node:props.node,t:props.t}):null;
    }

    const inject = ["slots", "locale", "settingsScope", "uiConversation"];
    function apply(ctx: PluginContext): void {
      const slots = ctx.slots ?? ctx.get("slots"),
        svc = ctx.settingsScope ?? ctx.get("settingsScope"),
        locale = ctx.locale ?? ctx.get("locale"),
        uiConversation =
          ctx.uiConversation ?? ctx.get("uiConversation");
      if (!slots || !svc || !locale || !uiConversation) return;
      if (typeof slots.entriesOfSlot === 'function') {
        ctx.effect(() => uiConversation.events.register(searchUsageDefinition), 'lcx search billing data');
        ctx.effect(() => installUsageSlots(slots as Parameters<typeof installUsageSlots>[0], React.createElement), 'lcx search billing slots');
      }
      ctx.effect(mountCss, "lcx-codex styles");
      for (const language of ["zh", "en"] as const)
        ctx.effect(() => locale.register(NAMESPACE, language, copy[language]), `lcx-codex ${language} dictionary`);
      ctx.effect(
        () => uiConversation.events.register(searchMediaDefinition),
        "lcx-codex search media definition",
      );
      const installSlot = (
        name: string,
        label: string,
        register: () => unknown,
      ) =>
        ctx.effect(() => {
          const cleanup = slots.inject(name, register);
          return () => {
            if (typeof cleanup === "function") cleanup();
          };
        }, label);
      const controller = new Controller(svc.bind({ namespace: NAMESPACE }));
      installSlot("settings.plugin.item", "lcx-codex settings slot", () =>
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
      installSlot("conversation.chat.node", "lcx-codex media slot", () =>
        slots.register(
          {
            name: "conversation.chat.node",
            key: SEARCH_MEDIA_KIND,
            locale: NAMESPACE,
            inject: () => ({ hooks: { mediaPreview: mediaStore } }),
          },
          MediaNode,
        ),
      );
      ctx.effect(() => () => controller.stop(), "lcx-codex settings card");
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
