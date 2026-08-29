# dsh-lcx-codex

[![npm stable](https://img.shields.io/npm/v/dsh-lcx-codex?label=stable&color=1677ff)](https://www.npmjs.com/package/dsh-lcx-codex)
[![npm prerelease](https://img.shields.io/npm/v/dsh-lcx-codex/prelatest?label=prelatest&color=7c3aed)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![Node](https://img.shields.io/badge/Node-%5E22.19%20%7C%7C%20%3E%3D24-2f855a)
![Plugin Pi](https://img.shields.io/badge/plugin%20Pi-0.84.3-111827)
![License](https://img.shields.io/badge/license-MIT-6b7280)

**简体中文** · [English](README_EN.md) · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md) · [Releases](https://github.com/kk3ya03-star/dsh-lcx-codex/releases)

> **让 DSH 的 GPT Responses 会话从第一轮普通请求开始，到工具调用、Prompt Cache、Native V2 Compact / Replay、重启恢复和 GPT 模型切换，始终保持同一个 Responses lifecycle owner。**

`dsh-lcx-codex` 不替换 DSH 的 Agent、Session、Tool Executor 或 compaction policy。DSH 仍然是 host；当 **LCX ON** 时，LCX 接管当前 GPT Responses 会话的最终 request / SSE wire。

## 版本状态

| Channel | Version | npm dist-tag | 状态 |
|---|---:|---|---|
| Stable | `0.4.1` | `latest` | **VERIFIED STABLE** |
| Prerelease | `0.4.2-pre.1` | `prelatest` | **VERIFIED PRERELEASE** |

`0.4.2-pre.1` 是当前新架构预发布版，已经完成真实 DSH + Sub2API RC 验收。保守使用请继续安装 `latest`；想使用完整 GPT Responses lifecycle ownership、Pi 0.84.3 和新版 Prompt Cache 行为，请安装 `prelatest`。

```powershell
# 稳定版
dsh plugin --profile web add dsh-lcx-codex

# 0.4.2 预发布版
dsh plugin --profile web add dsh-lcx-codex@0.4.2-pre.1

dsh web
```

## 为什么需要 LCX

DSH 负责 Agent、Session、工具执行、模型选择和 compaction policy；但 GPT Responses 的普通请求、Native Compact、Replay、cache identity 和 provider-native state 如果由不同的 wire owner 构造，就容易在长会话里出现生命周期断点。

`0.4.2-pre.1` 把这条链统一起来：

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
                             Prompt Cache
                                    ↓
                         Native V2 Compact
                                    ↓
                                Replay
                                    ↓
                           Restart / Resume
                                    ↓
                         GPT Model Migration
```

### 产品约定

```text
LCX OFF
= 完全使用 DSH 原生 LLM 流程

LCX ON
= 当前 GPT Responses 会话从第一轮 ordinary 请求开始由 LCX 接管最终 wire
```

切换 Claude、Gemini、DeepSeek 等非 GPT 模型前先关闭 LCX；模型切换本身不需要重启 DSH。

## 核心能力

### 1. Full GPT Responses lifecycle ownership

LCX ON 后，当前 GPT 会话的 ordinary、tool continuation、Native Compact、Native Replay、restart/resume 和 portable GPT model migration 使用同一套 request builder / transport owner。

这意味着 Compact 不再同时成为一次“history representation + request owner”双重切换。

### 2. GPT-5.6 Prompt Cache

`0.4.2-pre.1` 使用 GPT-5.6 新的 Prompt Cache 路径：

- 默认 implicit caching；
- `prompt_cache_options.ttl = 30m`；
- 同一会话保持稳定 prompt-cache identity；
- ordinary / tool / compact / replay / restart 维持可复用前缀；
- 真实最终 RC workload 中，单次 warm request 观察到 `60,928` cached input tokens。

缓存命中取决于 provider、模型、请求前缀和会话状态；上述数字是验收环境观测值，不是固定性能承诺。

### 3. Native V2 Compact + Replay

DSH 仍然决定 **何时压缩、压缩范围、事务和 recovery**；LCX 只负责 provider-native Responses V2 wire。

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

Native v5 checkpoint 不再重复保留每请求 canonical developer/system prelude；重复 Compact → Replay 不会线性累积高优先级 prompt。保留的 assistant visible copy 也会维护有效 `phase` 语义。

### 4. Restart / Resume + GPT 热切换

同一 DSH session 可以：

```text
Terra
  → Compact
  → Replay
  → Restart DSH
  → Resume same session
  → Switch to Sol
  → Continue
```

同 route/model 可恢复 Native opaque state；不兼容的 GPT model / route 切换会丢弃不安全 opaque state，重建 portable history，但仍保持 LCX Responses transport ownership。

### 5. Hosted Search + Stateful Web Actions

普通搜索仍然使用 DSH 原生 `web_search`；LCX 可以把 SearchProvider 映射到当前 GPT Hosted Search，而不是再注册一个重复的普通搜索工具。

| 需求 | 使用入口 |
|---|---|
| 普通联网搜索 | DSH `web_search` |
| Hosted Search 高级参数 | `websearch_gpt_advanced` |
| 连续网页 / PDF 操作 | `websearch_alpha` |

Alpha 支持：

```text
search → open → find / click → screenshot
```

它默认关闭，并且只有当前 endpoint / provider / model / schema 通过 capability probe 后才注册。未知部署 fail-closed。

### 6. Pi 0.84.3 隔离升级

插件独立使用 `@earendil-works/pi-ai 0.84.3`，但不会 override DSH host：

```text
DSH 0.1.1-rc.2
└─ host Pi 0.82.1      ← 不改

dsh-lcx-codex 0.4.2-pre.1
└─ plugin Pi 0.84.3    ← 插件隔离依赖
```

Pi 负责 canonical Responses message/tool serialization、reasoning、IDs、strict/grammar/custom tools、`additional_tools`、`tool_search`、namespace 和 stream semantics；LCX 不维护第二套通用 provider framework。

## 30 秒开始使用

### 前提条件

- Node.js `^22.19.0 || >=24.0.0`
- 已安装 DSH `0.1.1-rc.2`
- DSH 中已有可工作的 GPT Responses route
- 上游 endpoint 实际支持你准备启用的 Hosted Search / Native V2 / Alpha 能力

### 推荐初始设置

| 设置 | 推荐值 | 说明 |
|---|---:|---|
| Enable LCX | **On** | 接管当前 GPT Responses 会话 |
| Use GPT Hosted Search | 按需 | 让 DSH `web_search` 使用 GPT Hosted Search |
| Advanced Hosted Search | Off | 需要高级 Hosted 参数时再开 |
| Alpha Search | Off | capability probe 通过后再开 |
| Native-first auto compaction | On | 默认使用 Native-first pressure coordination |
| Native threshold | `90%` | 主动 Native V2 阈值 |
| Emergency DSH prune | `95%` | 紧急 prune 阈值 |
| Fallback to Basic Compaction | On | Native 首次失败时允许受控回退 |
| `web_search` timeout | `240s` | 避免较慢 Hosted Search 被过早中断 |

### 如何确认它真的生效

| 能力 | 预期行为 |
|---|---|
| LCX ownership | LCX ON 后第一轮 GPT ordinary request 就走 LCX Responses path |
| Prompt Cache | 连续 warm turn 出现 provider `cached_tokens` |
| Hosted Search | 普通入口仍是 DSH `web_search` |
| Advanced Hosted | 开启后出现 `websearch_gpt_advanced` |
| Alpha | capability probe 通过后才出现 `websearch_alpha` |
| Native V2 | Compact 产生 provider-native checkpoint，而不是把 Basic Compaction 伪装成 Native |
| Replay | Compact 后继续同一 DSH session，无重复 canonical prelude |

## DSH 与 LCX 的责任边界

| 组件 | 负责什么 |
|---|---|
| **DSH** | Agent loop、Session/history、GenerateOptions、模型/credential、工具执行、AttachmentStore、pressure policy、compaction transaction |
| **DSH rc.2 compatibility seam** | 把 DSH message / GenerateOptions 投影到 Pi Context，并把结果桥接回 DSH |
| **Plugin Pi 0.84.3** | canonical Responses serialization / parser semantics |
| **LCX** | ON/OFF ownership、最终 Responses body + HTTP/SSE wire、ordinary/compact/replay orchestration、Native opaque state、Search capabilities |

更深的 checkpoint、portable replay、cache identity、RefStore、pressure coordination 与 protocol 细节见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 兼容性

| Plugin | DSH | DSH host Pi | Plugin Pi | 状态 |
|---|---|---|---|---|
| `0.4.1` | `0.1.1-rc.2` | `0.82.1` | `0.82.1` | **VERIFIED STABLE** |
| `0.4.2-pre.1` | `0.1.1-rc.2` | `0.82.1` | `0.84.3` | **VERIFIED PRERELEASE** |

新的 DSH / Pi / gateway 版本不会自动视为兼容；项目按受影响 seam 做增量验证。

## 当前边界

`0.4.2-pre.1` 已验证核心 lifecycle，但以下能力仍保持明确边界：

- 当前 DSH/Pi host vocabulary 不暴露 `prompt_cache_breakpoint`，因此不能通过这条栈手动放置 explicit cache breakpoint；
- `reasoning.context` / `reasoning.mode` 仍由 host/Pi 能力暴露决定，LCX 不额外造控制面；
- normal operational context 仍使用约 `262K` 级别配置；1.05M long context 不是默认开启项；
- credentialed `ALPHA-004` runtime 仍为 `NOT_COVERED`，fail-closed 行为已有测试覆盖；
- Programmatic Tool Calling 目前不作为已支持能力宣传。

## 常见问题

<details>
<summary><strong>为什么切非 GPT 前要关闭 LCX？</strong></summary>

LCX ON 是 GPT Responses lifecycle ownership switch，不是通用多模型代理层。非 GPT 模型继续走 DSH 原生 adapter，因此切换前先关闭 LCX。

</details>

<details>
<summary><strong>为什么 web_search 还是同一个工具？</strong></summary>

这是刻意设计。普通搜索仍使用 DSH `web_search`，LCX 改的是 SearchProvider，不给模型重复暴露两个“普通搜索”工具。

</details>

<details>
<summary><strong>为什么 Alpha 有时不出现？</strong></summary>

这是 fail-closed 行为。当前 route/schema 没通过 capability probe 时，`websearch_alpha` 不注册。

</details>

<details>
<summary><strong>为什么 npm latest 还是 0.4.1？</strong></summary>

`0.4.2-pre.1` 是已验证 prerelease，但稳定版晋升是单独的发布决策。需要新架构请显式安装 `@0.4.2-pre.1`。

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
