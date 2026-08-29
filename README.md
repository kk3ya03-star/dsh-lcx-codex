# dsh-lcx-codex

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?label=stable&color=1677ff)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![Node](https://img.shields.io/badge/Node-%5E22.19%20%7C%7C%20%3E%3D24-2f855a)
![Plugin Pi](https://img.shields.io/badge/plugin%20Pi-0.84.3-111827)
![License](https://img.shields.io/badge/license-MIT-6b7280)

**简体中文** · [English](README_EN.md) · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md) · [Releases](https://github.com/kk3ya03-star/dsh-lcx-codex/releases)

> **让 DSH 的 GPT Responses 会话从第一轮普通请求开始，到工具调用、Native V2 Compact / Replay、重启恢复和 GPT 模型切换，始终保持同一个最终 Responses wire owner。**

`dsh-lcx-codex` 不替换 DSH。DSH 仍负责 Agent、Session、模型选择、工具执行、附件和 compaction policy；当 **LCX ON** 时，LCX 接管当前 GPT Responses 会话的最终 request / SSE wire。

## 当前稳定版

**`0.4.2`** 是当前稳定版，也是已完成真实 DSH + Sub2API 验收的 `0.4.2-pre.1` 的 **zero-functional-change stable promotion**。

```powershell
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

- npm dist-tag：`latest`
- DSH：`0.1.1-rc.2`
- Plugin Pi：`0.84.3`
- Node.js：`^22.19.0 || >=24.0.0`

`0.4.2-pre.1` 保留为历史 prerelease；新用户直接安装 `latest` 即可。

## 产品约定

```text
LCX OFF
= 完全使用 DSH 原生 LLM 流程

LCX ON
= 当前 GPT Responses 会话从 ordinary turn 1 开始
  由 LCX 持有最终 Responses request / SSE wire
```

切换 Claude、Gemini、DeepSeek 等非 GPT 模型前先关闭 LCX；模型切换本身不需要重启 DSH。

## 为什么需要 LCX

DSH 原本已经拥有 Agent、Session、Tools 和 compaction lifecycle。LCX 解决的是 GPT Responses provider-native 路径的最后一层一致性：ordinary、tools、Native Compact、Replay、restart/resume 和 GPT route migration 不再在同一个会话中切换最终 wire owner。

```text
                        DSH
              Agent / Session / Tools
                         │
                 llm / stream seam
                         │
              ┌──────────┴──────────┐
              │                     │
           LCX OFF               LCX ON
              │                     │
       native DSH adapter      LCX Responses Core
                                    │
                         ordinary turn 1
                                    ↓
                                 tools
                                    ↓
                         Native V2 Compact
                                    ↓
                                Replay
                                    ↓
                           Restart / Resume
                                    ↓
                         GPT Model Migration
```

Compact 因此只改变 history representation，不再同时改变 request owner。

## 核心能力

### 1. Full GPT Responses lifecycle ownership

LCX ON 后，ordinary、tool continuation、Native Compact、Native Replay、restart/resume 和 portable GPT migration 使用同一套 LCX Responses request builder / transport owner。

DSH 仍是 canonical session/history owner；LCX 不创建第二套会话数据库，也不替换 DSH Tool Executor。

### 2. GPT-5.6 Prompt Cache

`0.4.2` 使用 GPT-5.6 当前 cache-options 路径，并保持同一会话的稳定 cache identity：

- 默认使用 implicit caching；
- 当前支持 route 发送 `prompt_cache_options.ttl = 30m`；
- 普通连续 turn / tool-heavy workload 可以复用已 warm 前缀；
- Native Compact 会按设计建立新的 history/cache epoch，旧未压缩前缀不会被承诺继续复用；
- 真实长会话中，稳定 topology 下 warm request 多次观察到接近完整前缀复用。

缓存命中由 provider、模型、请求前缀、工具 schema 和会话状态共同决定，不是固定性能承诺。

一个已确认的边界：运行中激活 skill 若改变顶层 tool schema，会发生一次 cache reset；新 tool topology 稳定后下一请求即可重新 warm。当前支持 route 会拒绝 content-level `prompt_cache_breakpoint`，而 DSH `0.1.1-rc.2` 也没有可靠的 dynamic-tool provenance，因此 `0.4.2` 保留一次安全 reset，而不靠猜测重写工具历史。

### 3. Native V2 Compact + Replay

DSH 仍决定 **何时压缩、压缩范围、事务与 recovery**；LCX 只负责 provider-native Responses V2 wire。

默认 pressure coordination：

```text
0% ─────────────────── 90% ───── 95% ───── 100%
       normal            Native      emergency   hard cap
                         V2          DSH prune
```

- `90%`：优先 Native V2；
- `95%`：允许 DSH emergency tool-result prune；
- provider-confirmed overflow：继续交给 DSH recovery；
- manual `/compact`：仍使用 DSH 原生 compaction transaction。

Native checkpoint v5 会持久化 provider-native compaction state 与必要的可移植保留历史；同 session / compatible route 可 Native replay，不兼容 route 不会错误复用 opaque state。

### 4. Restart / Resume + GPT 热切换

同一个 DSH session 可以跨越：

```text
Terra
  → Compact
  → Replay
  → Restart DSH
  → Resume same session
  → Switch to Sol
  → Continue
```

compatible route/model 可恢复 Native opaque state；不兼容的 GPT model / route 会丢弃不安全 opaque state并重建 portable history，但仍保持 LCX Responses transport ownership。

### 5. Hosted Search + Stateful Web Actions

普通联网搜索仍使用 DSH 原生 `web_search`。LCX 可以把 SearchProvider 映射到当前 GPT Hosted Search，而不是再给模型暴露第二个普通搜索工具。

| 需求 | 使用入口 |
|---|---|
| 普通联网搜索 | DSH `web_search` |
| Hosted Search 高级参数 | `websearch_gpt_advanced` |
| 连续网页 / PDF 操作 | `websearch_alpha` |

Alpha 支持：

```text
search → open → find / click → screenshot
```

Alpha 默认关闭；只有当前 endpoint / provider / model / schema 通过 capability probe 后才注册。未知部署 fail-closed。

### 6. Pi 0.84.3 隔离升级

插件独立使用 `@earendil-works/pi-ai 0.84.3`，不 override DSH host：

```text
DSH 0.1.1-rc.2
└─ host Pi 0.82.1      ← 不改

dsh-lcx-codex 0.4.2
└─ plugin Pi 0.84.3    ← 插件隔离依赖
```

Pi 负责 canonical Responses message/tool serialization、reasoning、IDs、strict/grammar/custom tools、`additional_tools`、`tool_search`、namespace 和 stream semantics；LCX 不维护第二套通用 provider framework。

## 30 秒配置

### 前提条件

- Node.js `^22.19.0 || >=24.0.0`
- DSH `0.1.1-rc.2`
- DSH 中已有可工作的 GPT Responses route
- 上游 endpoint 实际支持准备启用的 Hosted Search / Native V2 / Alpha 能力

### 推荐初始设置

| 设置 | 推荐值 | 说明 |
|---|---:|---|
| Enable LCX | **On** | 接管当前 GPT Responses 会话 |
| Use GPT Hosted Search | 按需 | 让 DSH `web_search` 使用 GPT Hosted Search |
| Advanced Hosted Search | Off | 需要高级 Hosted 参数时再开 |
| Alpha Search | Off | capability probe 通过后再开 |
| Native-first auto compaction | On | 使用 Native-first pressure coordination |
| Native threshold | `90%` | 主动 Native V2 阈值 |
| Emergency DSH prune | `95%` | 紧急 prune 阈值 |
| Fallback to Basic Compaction | On | Native 首次失败时允许受控回退 |
| `web_search` timeout | `240s` | 避免较慢 Hosted Search 被过早中断 |

### 如何确认生效

| 能力 | 预期行为 |
|---|---|
| LCX ownership | LCX ON 后第一轮 GPT ordinary request 就进入 LCX Responses path |
| Prompt Cache | 稳定 warm turn 可出现 provider `cached_tokens` |
| Hosted Search | 普通入口仍是 DSH `web_search` |
| Advanced Hosted | 开启后出现 `websearch_gpt_advanced` |
| Alpha | capability probe 通过后才出现 `websearch_alpha` |
| Native V2 | Compact 产生 provider-native checkpoint，而不是把 Basic Compaction 伪装成 Native |
| Replay | Compact 后继续同一 DSH session；restart/resume 仍可续接 |

## DSH 与 LCX 的责任边界

| 组件 | 负责什么 |
|---|---|
| **DSH** | Agent loop、Session/history、GenerateOptions、模型/credential、工具执行、AttachmentStore、pressure policy、compaction transaction |
| **DSH compatibility seam** | 把 DSH message / GenerateOptions 投影到 Pi Context，并把结果桥接回 DSH |
| **Plugin Pi 0.84.3** | canonical Responses serialization / parser semantics |
| **LCX** | ON/OFF ownership、最终 Responses body + HTTP/SSE wire、ordinary/compact/replay orchestration、Native opaque state、Search capabilities |

更多 checkpoint、portable replay、cache identity、RefStore、pressure coordination 与 protocol 细节见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 兼容性

| Plugin | DSH | DSH host Pi | Plugin Pi | 状态 |
|---|---|---|---|---|
| `0.4.2` | `0.1.1-rc.2` | `0.82.1` | `0.84.3` | **VERIFIED STABLE** |
| `0.4.1` | `0.1.1-rc.2` | `0.82.1` | `0.82.1` | historical stable |

DSH `0.1.2-alpha.1` 和更新的 Pi 版本目前不属于 `0.4.2` 的正式兼容性声明；后续会按受影响 seam 单独验证，而不是自动视为兼容。

## 当前边界

- 当前支持 route 使用 implicit Prompt Cache；content-level explicit breakpoint 在该 route 上会被拒绝，因此没有作为产品设置开放。
- dynamic skill / plugin 若改变 top-level tool schema，可能触发一次 prompt-cache reset；功能不受影响，新 topology 会重新 warm。
- `reasoning.context` / `reasoning.mode` 仍取决于 host/Pi 暴露能力，LCX 不额外造第二套控制面。
- normal operational context 仍使用约 `262K` 级别配置；1.05M long context 不是默认开启项。
- credentialed `ALPHA-004` runtime 仍为 `NOT_COVERED`，fail-closed 行为已有测试覆盖。
- Programmatic Tool Calling 当前不作为已支持能力宣传。

## 常见问题

<details>
<summary><strong>为什么切非 GPT 前要关闭 LCX？</strong></summary>

LCX ON 是 GPT Responses lifecycle ownership switch，不是通用多模型代理层。非 GPT 模型继续走 DSH 原生 adapter。

</details>

<details>
<summary><strong>为什么 web_search 还是同一个工具？</strong></summary>

这是刻意设计。LCX 改的是 DSH `web_search` 后面的 SearchProvider，不给模型重复暴露两个普通搜索工具。

</details>

<details>
<summary><strong>为什么 Alpha 有时不出现？</strong></summary>

这是 fail-closed 行为。当前 route/schema 没通过 capability probe 时，`websearch_alpha` 不注册。

</details>

<details>
<summary><strong>为什么加载 skill 后有时缓存会重新 warm？</strong></summary>

某些 skill 会动态注册新的顶层工具。工具 schema 属于可缓存 prompt prefix 的一部分，topology 改变时 provider 可能建立新的 cache epoch。`0.4.2` 优先保证工具定义正确，不通过猜测 provenance 来强行维持旧 cache。

</details>

## 开发与验证

```bash
npm run typecheck
npm test
npm run test:schema
npm pack --ignore-scripts
```

- 架构：[ARCHITECTURE.md](ARCHITECTURE.md)
- 版本记录：[CHANGELOG.md](CHANGELOG.md)
- GitHub Releases：[Releases](https://github.com/kk3ya03-star/dsh-lcx-codex/releases)
- npm：[`dsh-lcx-codex`](https://www.npmjs.com/package/dsh-lcx-codex)

## License

MIT

> `LCX` 只是项目名称。本项目是社区项目，不隶属于 OpenAI、DeepSeek、Sub2API 或 NewAPI。
