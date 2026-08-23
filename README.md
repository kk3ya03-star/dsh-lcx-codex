<div align="center">

<img src="assets/dsh-lcx-codex-banner.png" alt="dsh-lcx-codex — 为 DSH 增加 GPT Hosted Search、Codex 风格网页操作与 Native V2 Compaction" width="100%" />

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?color=1677ff&label=npm)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![Node](https://img.shields.io/badge/Node-%3E%3D20-2f855a)
![License](https://img.shields.io/badge/license-MIT-6b7280)

**简体中文** · [English](README_EN.md) · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

</div>

> **DSH 仍然是 host。LCX 只补齐 GPT Responses 路径缺失的原生能力，不修改 DSH 核心，也不替换 Agent / Session / Web / Compaction。**

## 它解决什么

如果你的 DSH 已经有一个可工作的 GPT `openai-responses` route，`dsh-lcx-codex` 让这条 route 更完整地使用 GPT Responses 原生能力，同时尽量保持 DSH 原有入口和生命周期不变。

| 场景 | DSH 原有入口 | LCX 增强后 |
|---|---|---|
| 普通联网搜索 | DSH `web_search` | **仍然使用同一个 `web_search`**，由 LCX SearchProvider 映射到当前 GPT Hosted Search |
| Hosted Search 高级参数 | 普通搜索入口保持简洁 | 按需增加 `websearch_gpt_advanced`，提供域名过滤、近似位置、search context、图片搜索等 |
| 连续网页 / PDF 浏览 | DSH 继续拥有 Web 生命周期 | 按需增加 Codex / Alpha Web Actions：`search → open → find/click → screenshot` |
| 长会话压缩 | DSH 继续负责 pressure、事务与 recovery | 在现有 compaction seam 上优先请求 Responses Native V2 checkpoint |

**目标不是再造一套 Agent，而是让 DSH 的 GPT route 用上它本来就应该拥有的原生能力。**

## 三大能力

### 1. GPT Hosted Search：普通搜索不换入口

启用后，模型看到的普通搜索工具依然是 DSH 原生 `web_search`。LCX 替换的是 SearchProvider 路径，而不是再注册一个重复的“普通搜索”工具。

需要更细控制时，再单独启用 `websearch_gpt_advanced`。

### 2. Codex 风格 Web Actions：需要时再打开

`websearch_alpha` 面向连续浏览和结构化 Web action：

```text
search → open → find / click → screenshot
```

它默认关闭，并且只有当前 endpoint / provider / model / schema 通过 capability probe 后才注册。未知部署采用 **fail-closed**，不会被误报成“支持 Alpha”。

### 3. Native V2 Compaction：保留 DSH 会话语义

LCX 不创建第二套 compaction engine。DSH 仍然拥有 pressure、compactable range、`/compact`、durable session transaction、tool-result pruning 与 overflow recovery；LCX 只在已有 compaction LLM seam 上请求 Responses Native V2。

默认自动策略：

```text
0% ─────────────────── 90% ───── 95% ───── 100%
       normal            Native      emergency   hard cap
                         V2          DSH prune
```

- **90%**：优先尝试 Native V2。
- **95%**：才允许 emergency DSH prune。
- provider-confirmed context overflow：继续使用 DSH 原有恢复逻辑。
- 手动 `/compact`：继续使用 DSH 原生会话事务。

同一 source session 可以继续复用自己的 Native checkpoint；fork 或模型迁移不会跨 session 发送 parent 的 opaque state，而是走 portable migration；重启后从 DSH session log 恢复。

## 30 秒开始使用

### 1. 安装

```powershell
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

### 2. 在 DSH Settings 启用

第一次使用建议从最小配置开始：

| 设置 | 建议 |
|---|---:|
| Enable plugin | **On** |
| Use GPT Hosted Search | 需要 GPT Hosted Search 时 **On** |
| Advanced Hosted Search | **Off**，需要高级参数再开 |
| Alpha Search | **Off**，确认当前 route 支持后再开 |
| Native V2 remote compaction | 上游实际支持 Native V2 时 **On** |
| Native-first auto compaction | 使用 Native V2 时 **On** |

**前提条件**

- Node.js `>=20`
- DSH 中已有可工作的 GPT `openai-responses` route
- 上游 endpoint 实际支持你准备启用的 Hosted Search / Native V2 / Alpha 能力

### 3. 确认它真的生效

不要只看开关是否打开，按能力检查实际行为：

| 能力 | 应看到什么 |
|---|---|
| GPT Hosted Search | 普通工具入口仍是 DSH `web_search`，实际请求走当前 GPT Responses route |
| Advanced Hosted | 启用后出现 `websearch_gpt_advanced`，高级参数可以单独控制 |
| Alpha Web Actions | 只有 capability probe 通过时才出现 `websearch_alpha` |
| Native V2 | compact 时出现 provider-native checkpoint 路径；普通 Basic Compaction 不会被伪装成 Native V2 成功 |

## 搜索工具怎么选

三个入口用途不同，**不需要全部开启**：

| 你要做什么 | 使用入口 | 适合场景 |
|---|---|---|
| 普通联网搜索 | DSH `web_search` | 找资料、查网页、一般检索 |
| 控制 Hosted Search 参数 | `websearch_gpt_advanced` | 域名 allow/block、近似位置、search context、图片搜索等 |
| 连续浏览网页或 PDF | `websearch_alpha` | `search/open/find/click/screenshot` 与结构化 Web actions |

## 它如何接入 DSH

```text
DSH Agent / Session / Web
├─ web_search ──────────> LCX SearchProvider ──> GPT Hosted Search
├─ Advanced / Alpha ────> LCX Web tools ───────> GPT Web actions
└─ compact / replay ────> LCX Native bridge ───> Responses Native V2
```

**DSH 是 host，LCX 是兼容扩展层。** 插件优先复用当前 DSH route 的 `baseURL`、credential reference、headers、模型与 retry policy，而不是维护第二套账号配置。

checkpoint、canonical replay、Pi serializer、cache identity、fork safety 与 pressure coordination 等实现细节见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 兼容性

当前正式验证组合：

| Plugin | DSH | DSH host Pi | Plugin Pi | 状态 |
|---|---|---|---|---|
| `0.4.0` | `0.1.1-rc.2` | `0.82.1` | `0.82.1` | **VERIFIED** |

新的 DSH 版本**不会自动视为兼容**。项目会先检查受影响的 DSH / Pi seam，再按风险运行对应测试；Pi registry 单独出现新版本也不会自动升级插件依赖。

<details>
<summary><strong>完整推荐设置</strong></summary>

| 设置 | 推荐值 | 说明 |
|---|---:|---|
| Enable plugin | On | 启用插件 |
| Use GPT Hosted Search | 按需 | 让 DSH `web_search` 走 GPT Hosted Search |
| Advanced Hosted Search | Off | 需要高级 Hosted 参数时再开 |
| Alpha Search | Off | capability 验证后再开 |
| Native V2 remote compaction | On* | *上游 route 实际支持 Native V2 时 |
| Native-first auto compaction | On | 启用自动 pressure 策略 |
| Native threshold | 90% | 90% 开始优先 Native V2 |
| Emergency DSH prune | 95% | 95% 才允许 emergency prune |
| `web_search` timeout | 240 s | 避免长搜索被过早终止 |

主要配置字段：`remoteCompaction`、`autoCompaction`、`fallbackToBasicCompaction`、`autoCompactionThresholdPercent`、`emergencyPruneThresholdPercent`、`webSearchTimeoutSeconds`、`advancedHostedSearch`、`alphaSearch`。

</details>

<details>
<summary><strong>其他安装方式</strong></summary>

**预发布版**

```powershell
dsh plugin --profile web add dsh-lcx-codex@next
```

**本地 tarball**

```powershell
dsh plugin --profile web remove dsh-lcx-codex
dsh plugin --profile web add .\dsh-lcx-codex-0.4.0.tgz
dsh web
```

升级插件时，不要为了“清理”删除 DSH session 或 `$DSH_HOME/storages/lcx-codex/`。旧会话可能仍引用历史兼容数据。

</details>

<details>
<summary><strong>常见情况</strong></summary>

**`web_search` 没走 GPT Hosted Search**  
确认插件和 Hosted Search 已启用，并且当前 Agent 能解析到兼容的 GPT `openai-responses` route。

**`websearch_alpha` 没出现**  
这是预期的 fail-closed 行为。Alpha 必须对当前 route/schema 完成可信 capability probe 后才注册。

**Native V2 没有生效**  
确认当前 GPT Responses endpoint 实际支持 `remote_compaction_v2`。插件不会把普通 Basic Compaction 假装成 Native V2 成功。

</details>

<details>
<summary><strong>开发</strong></summary>

```bash
npm test
npm run test:schema
npm pack --ignore-scripts
```

- 设计与协议细节：[ARCHITECTURE.md](ARCHITECTURE.md)
- 版本变化：[CHANGELOG.md](CHANGELOG.md)
- npm：[`dsh-lcx-codex`](https://www.npmjs.com/package/dsh-lcx-codex)

</details>

## License

MIT

> `LCX` 只是项目名称。本项目是社区项目，不隶属于 OpenAI、DeepSeek、Sub2API 或 NewAPI。
