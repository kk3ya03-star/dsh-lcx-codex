<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="DSH-LCX-CODEX" width="100%" />

**为 DeepSeek Harness 补上 GPT Hosted Search、Codex / Alpha Web Actions 与 Native V2 Compaction。**

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?color=1677ff&label=npm)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![Node](https://img.shields.io/badge/Node-%3E%3D20-2f855a)
![License](https://img.shields.io/badge/license-MIT-6b7280)

**简体中文** · [English](README_EN.md) · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

</div>

> **不修改 DSH 核心，不替换 Agent / Session / Web / Compaction。**  
> DSH 继续拥有会话与执行生命周期；LCX 只扩展 GPT Responses 路径缺失的原生能力。

---

## 为什么用它

如果你的 DSH 已经有可工作的 GPT `openai-responses` route，LCX 主要解决三件事：

- **普通搜索不换入口**：模型继续调用 DSH 原生 `web_search`，插件把它映射到当前 GPT Hosted Search。
- **需要时才增加高级能力**：Advanced Hosted 与 Alpha Web Actions 默认不占用工具目录，按需启用。
- **长会话优先原生压缩**：在 DSH 原有 compaction 生命周期里接入 Native V2，并保留继续对话、重启和 fork 的安全边界。

## 快速开始

```powershell
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

然后在 **DSH Settings** 中启用插件，并只打开需要的功能。

**前提条件**

- Node.js `>=20`
- DSH 中已有可工作的 GPT `openai-responses` route
- 你的上游实际支持准备启用的 Hosted Search / Native V2 / Alpha 能力

## 核心能力

| 能力 | 用户看到的行为 | 默认 |
|---|---|---:|
| **GPT Hosted Search** | DSH 原生 `web_search` 直接跟随当前 GPT Responses route | 按需开启 |
| **Advanced Hosted Search** | 域名过滤、近似位置、search context、图片搜索等高级参数 | 关闭 |
| **Codex / Alpha Web Actions** | `search → open → find/click → screenshot`，以及结构化 Web actions | 关闭 |
| **Native V2 Compaction** | 长会话优先使用 provider-native checkpoint | 按需开启 |
| **Session continuity** | Compact 后继续对话、重启恢复、fork / model migration 安全迁移 | 内置 |

## 搜索工具怎么选

三个入口用途不同，不需要全部开启：

| 你要做什么 | 使用入口 | 说明 |
|---|---|---|
| 普通联网搜索 | DSH `web_search` | 默认选择；找资料、查网页、一般检索 |
| 控制 Hosted Search 参数 | `websearch_gpt_advanced` | 域名 allow/block、近似位置、search context、图片搜索等 |
| 连续浏览网页或 PDF | `websearch_alpha` | `search/open/find/click/screenshot`，以及 finance/weather/sports/time 等结构化 action |

启用 GPT Hosted Search 后，模型看到的普通搜索工具**仍然只有 DSH `web_search`**；LCX 只是替换 SearchProvider，不再额外制造一个重复的普通搜索入口。

`websearch_gpt_advanced` 默认关闭。`websearch_alpha` 也默认关闭，并且只有当前 endpoint / provider / model / schema 通过 capability probe 后才注册；未知部署不会被误报为“支持”。

## Native V2 Compaction

LCX 不创建第二套 compaction engine。DSH 仍然负责 pressure、compactable range、`/compact`、durable session transaction、tool-result pruning 与 overflow recovery；LCX 只在现有 compaction LLM seam 上请求 Responses Native V2。

默认自动策略：

```text
0% ─────────────────── 90% ───── 95% ───── 100%
       normal            Native      emergency   hard cap
                         V2          DSH prune
```

- **90%**：优先尝试 Native V2。
- **95%**：才允许 emergency DSH prune。
- provider-confirmed context overflow：继续使用 DSH 原有恢复逻辑。
- 手动 `/compact`：仍然使用 DSH 原生会话事务。

Compact 后，同一 source session 可以直接复用自己的 Native checkpoint；fork 或模型迁移不会跨 session 发送 parent 的 opaque state，而是走 portable migration；重启后从 DSH session log 恢复。

## 它如何接入 DSH

```text
DSH Agent / Session / Web
├─ web_search ──────────> LCX SearchProvider ──> GPT Hosted Search
├─ Advanced / Alpha ────> LCX Web tools ───────> GPT Web actions
└─ compact / replay ────> LCX Native bridge ───> Responses Native V2
```

**DSH 是 host，LCX 是兼容扩展层。** 插件优先复用当前 DSH route 的 `baseURL`、credential reference、headers、模型与 retry policy，而不是维护第二套账号配置。

更深的 checkpoint、canonical replay、Pi serializer、cache identity、fork safety 与 pressure coordination 设计见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 兼容性

当前正式验证组合：

| Plugin | DSH | DSH host Pi | Plugin Pi | 状态 |
|---|---|---|---|---|
| `0.4.0` | `0.1.1-rc.2` | `0.82.1` | `0.82.1` | **VERIFIED** |

**新的 DSH 版本不会自动视为兼容。** 项目会先检查受影响的 DSH / Pi seam，再按风险运行对应测试；Pi registry 单独出现新版本也不会自动升级插件依赖。

<details>
<summary><strong>推荐设置</strong></summary>

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
