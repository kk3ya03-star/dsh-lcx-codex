<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.jpg" alt="DSH-LCX-CODEX" width="100%" />

# DSH-LCX-CODEX

**给 DeepSeek Harness 补上 GPT Responses / Codex 原生能力。**

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?color=1677ff&label=npm)](https://www.npmjs.com/package/dsh-lcx-codex)
![Node](https://img.shields.io/badge/Node-%3E%3D20-1677ff)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![License](https://img.shields.io/badge/license-MIT-1677ff)

**简体中文** · [English](README_EN.md)

</div>

---

`dsh-lcx-codex` 是一个社区维护的 DSH 插件，面向已经通过 `llm-pi-ai / openai-responses` 接入的 GPT 路由。它尽量复用 DSH 自己的 Agent、Web、Session 和 Compaction 架构，只在缺少 OpenAI/Codex 原生语义的地方补能力。

> `LCX` 只是项目名称。本项目不隶属于 OpenAI、DeepSeek、Sub2API 或 NewAPI。

- **最新版 DSH 图片管线**：Native V2 直接复用 `readImageRequest()` 和当前路由图片预算，避免压缩请求与普通 GPT 请求使用不同的图片版本。

## 核心能力

| 能力 | 说明 | 默认 |
|---|---|---:|
| **DSH 原生 `web_search` → GPT Hosted Search** | 不新增重复的普通搜索工具；rc.7+ 自动跟随当前 Agent 的 GPT Responses 模型 | 可开启 |
| **Advanced Hosted Search** | 域名过滤、location、search context、图片搜索等 OpenAI Hosted 参数 | 关闭 |
| **Alpha Search** | `search/open/find/click/screenshot` 等 Codex/Alpha 风格命令；能力探针通过后才注册 | 关闭 |
| **Native Remote Compaction V2** | 通过 Responses `compaction_trigger` 获取 provider-native opaque checkpoint | 可开启 |
| **Conversation fidelity retention** | 显式保留 bounded user / assistant 可见事实，避免只记得“问过什么”却忘记“答了什么” | 内置 |
| **Session-native checkpoint** | checkpoint 存在 DSH append-only session log，不再以 sidecar 作为新会话真相源 | 内置 |
| **Native-first 自动压缩** | 90% 主动 Native V2，95% emergency 才允许 DSH prune；阈值可调 | 可开启 |
| **长搜索超时** | DSH `web_search` 外层 timeout 默认提升到 240 秒，可调 30–600 秒 | 内置 |

## rc.8：面向 DSH 0.1.1-rc.2

rc.8 直接面向 **DSH 0.1.1-rc.2**。普通 `web_search` 继续跟随当前 Agent 模型，同时 Native V2 的图片输入改用新版 DSH `readImageRequest()` 管线，不再直接读取 attachment master bytes。

搜索路由仍通过 **DSH `tools/execute` → SearchProvider** 运行时上下文传递：

```text
Agent: lcx / gpt-5.6-luna
        │
        └─ DSH web_search
             │
             └─ Hosted Search: lcx / gpt-5.6-luna

Agent: lcx / gpt-5.6-sol
        │
        └─ DSH web_search
             │
             └─ Hosted Search: lcx / gpt-5.6-sol
```

这不会修改模型看到的 `web_search` schema。

没有 Agent 上下文时，才使用设置页里的 **回退 Responses 地址 / 回退 GPT 模型**。

### Search 与会话缓存隔离

Hosted Search 是一笔独立 Responses 请求，不等于主会话推理。rc.8 继续给搜索使用独立 cache namespace：

```text
主会话 replay:  dsh-lcx:<route hash>
Hosted Search: dsh-lcx-search:<route hash>
```

因此搜索不会故意与 Native replay 共用同一个 `prompt_cache_key`。NewAPI 后台仍可能看到搜索请求夹在主会话请求之间；它们是不同请求，搜索行本身 cache 较低并不代表 DSH session 被截断。

## Native V2 Compaction

DSH 本身已经负责：

- token pressure；
- compactable range selection；
- tool-result pruning；
- durable session transaction；
- `/compact`；
- context-overflow recovery。

本插件不再造第二套 compaction engine，而是在 DSH 的 `purpose: 'compaction'` LLM seam 上执行 Native V2：

```text
DSH compaction transaction
        │
        └─ purpose=compaction
              │
              └─ POST /responses
                   x-codex-beta-features: remote_compaction_v2
                   input: [...history, { type: "compaction_trigger" }]
```

Native 成功：不再额外运行 basic summary。

Native 失败且开启 fallback：才回到 DSH basic compaction。

## 为什么压缩后还能记住模型自己说过的话

单纯依赖 provider-native opaque compaction 是有损的。真实长会话测试发现，低显著性的 assistant-only 事实可能被压掉，例如：

- 模型随机生成的项目代号；
- 搜索后模型给出的具体姓名；
- 只在 assistant 最终回答里出现的数字。

因此当前 checkpoint 使用：

```text
bounded client-visible history
+ bounded assistant-visible answers
+ opaque Native V2 compaction item
```

默认总 explicit retention 预算约 `64k` estimated tokens，其中 assistant-visible answer 最多预留约 `24k`，单条默认最多约 `3k`。不把 reasoning、巨大 tool result、完整搜索正文和运行 telemetry 全塞回来。

目标不是“逐字无损”，而是：**删过程，保事实。**

## 自动压缩策略

rc.8 延续 rc.6 的 Native-first pressure policy：

```text
0% ─────────────────── 90% ───── 95% ───── 100%
       正常使用          Native     emergency    hard cap
                         V2         DSH prune
```

默认：

- `< 90%`：不让 DSH 原来的 80% pressure prune 提前改写历史；
- `90%–95%`：优先 Native V2；
- `>= 95%`：允许 DSH replay-safe tool-result pruner 救场；
- provider 明确返回 context overflow：仍保留 DSH 原生 recovery；
- 手动 `/compact`：不受阈值影响。

阈值可在插件设置页调整。

## 关于“缓存突然断了”

需要区分两件事：

```text
cacheRead = 0
≠
会话历史被删除
```

在真实 NewAPI 日志里，出现过：

```text
某轮：155k uncached / cacheRead 0
下一轮：~1k new input / ~155k cacheRead
```

这说明上一轮只是 provider prompt-cache miss / eviction，完整上下文仍被重新发送，并没有发生 session compaction 或 surface replacement。

真正会主动改变历史前缀的主要情况是：

1. `/compact` / 自动 Native compaction；
2. emergency tool-result pruning；
3. 换模型 / provider / baseURL；
4. DSH 自己发生其他 surface replacement。

DSH 重启、长时间 idle、上游 cache TTL/eviction 也可能造成某一轮重新建 cache；插件无法保证第三方网关永不 evict KV cache。

## 搜索分层

### 1. 普通搜索：`web_search`

推荐默认使用。rc.8 会跟随当前 Agent 的 GPT Responses route。

### 2. 高级 Hosted：`websearch_gpt_advanced`

仅在需要这些参数时开启：

- allowed / blocked domains；
- approximate user location；
- `search_context_size`；
- image search；
- external web access；
- return token budget。

开启/关闭额外工具会改变 tool catalog，因此默认关闭以保持主会话 request schema 稳定。

### 3. Alpha：`websearch_alpha`

面向 stateful Codex/Alpha 风格搜索：`search/open/find/click/screenshot` 等。只有 capability probe 与当前 endpoint/provider/model/schema 匹配后才注册。

## 安装

### npm

稳定版：

```powershell
dsh plugin --profile web add dsh-lcx-codex
```

预发布版（当前 rc.8）：

```powershell
dsh plugin --profile web add dsh-lcx-codex@next
```

### 本地 RC

```powershell
dsh plugin --profile web remove dsh-lcx-codex
dsh plugin --profile web add .\dsh-lcx-codex-0.4.0.tgz
dsh web
```

不要为了升级删除 `$DSH_HOME/storages/lcx-codex/` 或旧 session。v3 sidecar 仍作为只读旧会话兼容层。

## 推荐设置

```text
Enable plugin                         ✅
Use GPT Hosted Search                ✅
Advanced Hosted Search               ❌
Alpha Search                         ❌

Native V2 remote compaction          ✅
Native-first auto compaction         ✅
Native threshold                     90%
Emergency DSH prune                  95%
web_search timeout                   240s
```

调试 Native 时可以先关闭 fallback；稳定使用时是否开启 fallback 由你决定。

## 部署要求

- Node.js `>=20`
- DSH `0.1.1-rc.2`
- DSH 中已经能正常使用的 GPT `openai-responses` route
- upstream 实际支持你启用的 Hosted Search / Native V2 / Alpha 能力

典型路径：

```text
DSH → llm-pi-ai/openai-responses → Sub2API
DSH → llm-pi-ai/openai-responses → NewAPI → upstream
```

插件优先复用 DSH route 的 `baseURL`、credential reference、headers 和 retry policy。

## 发布通道

- npm stable：正式稳定版本
- npm `next`：`0.4.0-rc.*` 预发布测试版本

GitHub tag 与 `package.json` version 必须一致；Trusted Publishing workflow 会先跑测试再发布。

## 开发

```bash
npm test
npm run test:schema
npm pack --ignore-scripts
```

关键设计说明见 [ARCHITECTURE.md](ARCHITECTURE.md)，完整版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT
