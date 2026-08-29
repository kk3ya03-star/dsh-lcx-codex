<div align="center">

<img src="assets/dsh-lcx-codex-banner.jpg" alt="dsh-lcx-codex" width="100%" />

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?color=1677ff&label=npm)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![Node](https://img.shields.io/badge/Node-%5E22.19%20%7C%7C%20%3E%3D24-2f855a)
![License](https://img.shields.io/badge/license-MIT-6b7280)

**简体中文** · [English](README_EN.md) · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

</div>

`dsh-lcx-codex` 是一个面向 **DSH + GPT / OpenAI Responses** 的插件。

它不替换 DSH。Agent、Session、工具执行、模型选择和什么时候压缩，仍然由 DSH 负责。LCX 开启后，只接管 GPT 会话最后一层 Responses 请求与流式响应，让普通对话、工具续接、Native Compact 和 Replay 走同一条路径。

当前稳定版：**0.4.2**。

## 安装

```powershell
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

要求：

- DSH `0.1.1-rc.2`
- Node.js `^22.19.0 || >=24.0.0`
- DSH 里已经配置好可用的 GPT Responses route

## 0.4.2 主要改了什么

0.4.2 最大的变化不是多了一个工具，而是把 GPT Responses 的调用链统一了。

以前 LCX 主要负责 Native Compact / Replay；现在只要 **LCX ON**，从第一轮普通 GPT 请求开始就由 LCX 负责最终 Responses wire：

```text
普通对话 → 工具调用 → Native Compact → Replay → 重启续接
                都走同一个 LCX Responses 路径
```

DSH 仍然是上层 host，LCX 不维护第二套 Agent、Session 或工具执行器。

如果要切 Claude、Gemini、DeepSeek 等非 GPT 模型，先把 LCX 关掉即可，不需要重启 DSH。

## 功能

### GPT Responses lifecycle

LCX ON 后，ordinary request、tool continuation、Native Compact、Native Replay、restart/resume 和 GPT 模型切换共用同一套 request builder 和 transport。

这样 Compact 只负责“把历史换一种表示方式”，不会顺便把请求实现从一套代码切到另一套代码。

### Native V2 Compact / Replay

DSH 决定什么时候压缩；LCX 负责把这次压缩请求发成 provider-native Responses V2，并把 Native state 存回 DSH Session。

默认策略：

```text
< 90%       正常运行
90%         优先 Native V2 Compact
95%         允许 DSH emergency prune
```

手动 `/compact` 也仍然走 DSH 原来的 compaction transaction。

同一 session、兼容的 GPT route 可以继续使用 Native state；切到不兼容的 GPT route 时会改用 portable history，不会错误复用旧 opaque state。

### Prompt Cache

0.4.2 对 GPT-5.6 兼容 route 使用当前的 `prompt_cache_options` 路径，并保持稳定的 cache identity。普通长会话和工具密集任务在请求前缀不变时可以持续命中缓存。

Native Compact 本身会建立新的历史前缀，所以 Compact 之后重新 warm 是正常现象。

另外有一个已知边界：某些 skill 会在运行中注册新的顶层工具。`tools` schema 变化时，provider 可能出现一次 cache miss；新的工具集合稳定后，后续请求会重新命中。当前版本优先保证工具定义正确，不为了省这一次缓存去猜测工具来源。

### Hosted Search

普通联网搜索继续使用 DSH 原生 `web_search`。LCX 可以把它映射到当前 GPT Hosted Search，不会再给模型塞一个重复的“普通搜索”工具。

需要高级参数时可以单独开启：

- `websearch_gpt_advanced`：域名、位置、search context、图片搜索等 Hosted 参数
- `websearch_alpha`：连续 `search / open / find / click / screenshot`

Alpha 默认关闭，并且只有 capability probe 通过后才注册。

### Pi 0.84.3

插件自己使用 `@earendil-works/pi-ai 0.84.3`，不会 override DSH 自己的 Pi：

```text
DSH 0.1.1-rc.2
└─ host Pi 0.82.1

dsh-lcx-codex 0.4.2
└─ plugin Pi 0.84.3
```

这样可以使用较新的 Responses serialization、reasoning replay、strict / grammar / custom tools、`additional_tools`、`tool_search` 等能力，同时不强行升级 DSH host。

## 推荐设置

| 设置 | 建议 |
|---|---|
| Enable LCX | GPT Responses 会话使用时开启 |
| Use GPT Hosted Search | 按需 |
| Advanced Hosted Search | 默认关闭 |
| Alpha Search | 默认关闭 |
| Native-first auto compaction | 开启 |
| Native threshold | `90%` |
| Emergency DSH prune | `95%` |
| Fallback to Basic Compaction | 开启 |
| `web_search` timeout | `240s` |

## 已知边界

- 正式兼容目标仍是 DSH `0.1.1-rc.2`；`0.1.2-alpha.1` 暂未作为正式支持版本。
- 当前常用 route 不接受 content-level `prompt_cache_breakpoint`，所以没有开放 explicit breakpoint 设置。
- 动态加载 skill / plugin 如果改变顶层 tools，可能触发一次 Prompt Cache reset；不影响工具正常使用。
- `reasoning.context`、`reasoning.mode` 等能力取决于当前 DSH / Pi 是否真正暴露，LCX 不额外造一套控制面。
- 1.05M long context、Programmatic Tool Calling 目前不作为 0.4.2 的正式支持项。

## 兼容性

| Plugin | DSH | DSH host Pi | Plugin Pi |
|---|---|---|---|
| `0.4.2` | `0.1.1-rc.2` | `0.82.1` | `0.84.3` |

## 开发

```bash
npm run typecheck
npm test
npm run test:schema
npm pack --ignore-scripts
```

更详细的实现和协议说明见 [ARCHITECTURE.md](ARCHITECTURE.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT

> `LCX` 只是项目名称。本项目是社区项目，不隶属于 OpenAI、DeepSeek、Sub2API 或 NewAPI。
