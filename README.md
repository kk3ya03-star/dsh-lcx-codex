<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="DSH-LCX-CODEX" width="100%" />

# DSH-LCX-CODEX

**把 GPT Responses 的原生搜索、压缩与会话语义接入 DeepSeek Harness。**

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?color=1677ff&label=npm)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![Node](https://img.shields.io/badge/Node-%3E%3D20-2f855a)
![License](https://img.shields.io/badge/license-MIT-6b7280)

**简体中文** · [English](README_EN.md) · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

</div>

---

## 它是什么

`dsh-lcx-codex` 是一个面向 **DeepSeek Harness（DSH）** 的社区插件。它不替换 DSH 的 Agent、Session、Web 或 Compaction 系统，而是在 DSH 已有 `llm-pi-ai / openai-responses` 路由上补齐 GPT / Codex 风格的原生能力。

核心原则只有一句：**DSH 继续拥有会话与执行生命周期，插件只扩展缺失的 Responses 语义。**

```text
DSH Agent / Session / Web
          │
          ▼
     llm-pi-ai
          │
          ▼
 OpenAI Responses route
          │
    ┌─────┴───────────────┐
    │ dsh-lcx-codex       │
    │                     │
    │ Hosted / Alpha      │
    │ Native V2 Compact   │
    │ Replay / fidelity   │
    └─────────────────────┘
```

> `LCX` 只是项目名称。本项目不隶属于 OpenAI、DeepSeek、Sub2API 或 NewAPI。

## 主要能力

| 能力 | 做什么 | 默认 |
|---|---|---:|
| **DSH `web_search` → GPT Hosted Search** | 复用 DSH 原生搜索入口，跟随当前 GPT Responses route | 可开启 |
| **Advanced Hosted Search** | 域名过滤、location、search context、图片搜索等 Hosted 参数 | 关闭 |
| **Alpha Search** | `search/open/find/click/screenshot` 等 stateful Codex/Alpha action；能力探针通过后才注册 | 关闭 |
| **Native Remote Compaction V2** | 使用 Responses `compaction_trigger` 生成 provider-native checkpoint | 可开启 |
| **Native-first pressure policy** | 90% 优先 Native V2；95% 才允许 emergency DSH prune | 可开启 |
| **Canonical replay** | 复用 Pi Responses 语义，保留 response id、reasoning/text metadata、tool-call identity | 内置 |
| **Conversation fidelity retention** | 有界保留用户与 assistant 可见事实，降低压缩后“知道问过但忘了答过什么” | 内置 |
| **Fork / restart safety** | opaque state 严格 same-session；fork 只做 portable migration；支持重启恢复 | 内置 |

## 为什么会同时提到 DSH 和 Pi

DSH 的 GPT `openai-responses` 路径底层使用 Pi adapter。插件本身也直接依赖 Pi 的公开 Responses converter 来保持消息、工具、reasoning 和 replayState 的 canonical 语义。

因此兼容性有两层：

```text
DSH host seams
  └─ session / fork / compaction / pruner / attachment / web / Cordis

Pi Responses seams
  └─ message conversion / tools / replayState / stream / stop reason
```

当前正式验证矩阵：

| Plugin | DSH | DSH host Pi | Plugin Pi | 状态 |
|---|---|---|---|---|
| `0.4.0` | `0.1.1-rc.2` | `0.82.1` | `0.82.1` | **VERIFIED** |

**新 DSH 版本不会自动视为兼容。** 项目会先做 host-seam impact review，再按风险决定是否需要真实 DSH QA。Pi registry 出现新版本也不会自动升级插件依赖。

## Search

### 普通搜索：DSH `web_search`

插件接管 DSH SearchProvider 后，把普通搜索映射到当前 Agent 的 GPT Hosted Search，同时保持模型看到的 `web_search` schema 不变。

Hosted Search 使用独立 cache namespace，不和主会话 Native replay 共用缓存键。

### Advanced Hosted：`websearch_gpt_advanced`

只有显式开启时才注册，用于 Hosted Search 的结构化控制，例如域名过滤、location、search context 和图片搜索。默认关闭，避免无意义改变主会话 tool catalog。

### Alpha：`websearch_alpha`

提供 stateful Codex/Alpha 风格 action。只有当前 endpoint / provider / model / schema 的 capability probe 被可信验证后才启用；认证失败、5xx 或未知部署不会被误标成“支持”。

## Native V2 Compaction

DSH 仍负责：

- pressure 与 compactable range；
- durable session transaction；
- `/compact`；
- tool-result pruning 与 overflow recovery。

插件只在 DSH 的 compaction LLM seam 上请求 Native V2：

```text
DSH compaction transaction
        │
        └─ purpose=compaction
              │
              └─ POST /responses
                   x-codex-beta-features: remote_compaction_v2
                   input: [...canonical history, compaction_trigger]
```

成功后 checkpoint 写入 DSH append-only session log。opaque checkpoint **只能在同一个 source session 直接 replay**；parent/child ancestry 只授权 portable migration，不会把 parent opaque state 发给 child。

### 为什么还要保留显式会话事实

真实长会话测试表明，仅依赖 provider opaque compaction 可能压掉低显著性的 assistant-only 事实。因此 checkpoint 同时保留一个有界的 client-visible / assistant-visible history，再叠加 Native V2 compaction item。

目标不是逐字恢复，而是：**删过程，保事实。**

## 自动压缩

默认策略：

```text
0% ─────────────────── 90% ───── 95% ───── 100%
       normal            Native      emergency   hard cap
                         V2          DSH prune
```

同一 preset 的共享 compaction service 使用互斥保护，避免两个高压力 session 互相污染临时 pruner / config 状态。

## 安装

### 稳定版

```powershell
dsh plugin --profile web add dsh-lcx-codex
```

### 预发布版

```powershell
dsh plugin --profile web add dsh-lcx-codex@next
```

### 本地 tarball

```powershell
dsh plugin --profile web remove dsh-lcx-codex
dsh plugin --profile web add .\dsh-lcx-codex-0.4.0.tgz
dsh web
```

升级插件时不要为了“清理”删除 DSH session 或 `$DSH_HOME/storages/lcx-codex/`。历史兼容数据可能仍被旧会话引用。

## 推荐设置

```text
Enable plugin                         on
Use GPT Hosted Search                as needed
Advanced Hosted Search               off by default
Alpha Search                         off until capability verified

Native V2 remote compaction          on when upstream supports it
Native-first auto compaction         on
Native threshold                     90%
Emergency DSH prune                  95%
web_search timeout                   240s
```

主要配置字段：`remoteCompaction`、`autoCompaction`、`fallbackToBasicCompaction`、`autoCompactionThresholdPercent`、`emergencyPruneThresholdPercent`、`webSearchTimeoutSeconds`、`advancedHostedSearch`、`alphaSearch`。

## 部署要求

- Node.js `>=20`
- **已验证 DSH：`0.1.1-rc.2`**
- DSH 中已经可工作的 GPT `openai-responses` route
- upstream 实际支持你启用的 Hosted Search / Native V2 / Alpha 能力

插件优先复用 DSH 当前 route 的 `baseURL`、credential reference、headers、模型与 retry policy，而不是维护第二套独立账号配置。

## 兼容性与升级

这个项目是 DSH 插件，不是独立 provider SDK。因此 DSH 更新时重点检查：

`session/event` · `requestHeader()` · `session.fork` · `agentPresets.serviceFor()` · compaction/pruner lifecycle · attachments · Web SearchProvider · DSH Web `/compact` · Pi Responses adapter。

新版本先做差异审查，再按 L0–L4 风险测试；只有触及 runtime seam 时才花 DSH 模型额度做真实验收。

## 开发

```bash
npm test
npm run test:schema
npm pack --ignore-scripts
```

设计细节见 [ARCHITECTURE.md](ARCHITECTURE.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT
