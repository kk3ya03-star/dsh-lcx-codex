<div align="center">

<img src="assets/dsh-lcx-codex-banner.svg" alt="dsh-lcx-codex" width="100%" />

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?color=4D6BFE&label=npm)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4D6BFE)
![License](https://img.shields.io/badge/license-MIT-4D6BFE)

**简体中文** · [English](README_EN.md) · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

</div>

给 DeepSeek Harness 的 GPT / OpenAI Responses 路径补上 Native V2 Compact / Replay、Hosted Search、Prompt Cache 和连续网页操作。

## Highlights

- **完整的 GPT Responses 路径**：LCX 开启后，从第一轮普通请求开始接管 GPT Responses 请求；工具续接、Compact 和 Replay 不再中途换实现。
- **Native V2 Compact / Replay**：长会话优先使用 provider-native compaction，支持 Replay、重启恢复和 GPT 模型切换。
- **GPT Hosted Search**：保留 DSH 原生 `web_search` 入口，同时提供高级 Hosted Search 和连续网页操作。
- **Prompt Cache**：GPT-5.6 兼容 route 使用 `prompt_cache_options`，稳定前缀可以持续复用缓存。
- **不改 DSH host**：Agent、Session、工具执行和 compaction policy 仍由 DSH 管；插件自己的 Pi 版本与 DSH host 隔离。

## Installation

```powershell
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

需要：

- DSH `0.1.1-rc.2`
- Node.js `^22.19.0 || >=24.0.0`
- 一个已经能工作的 GPT Responses route

当前稳定版是 **0.4.2**，npm `latest` 已指向该版本。

## Quick start

安装后在 DSH Web 的插件设置里打开 **LCX**。

```text
LCX OFF  → 完全使用 DSH 原生 LLM 流程
LCX ON   → 当前 GPT 会话从第一轮开始走 LCX Responses 路径
```

LCX 只面向 GPT / OpenAI Responses。切换 Claude、Gemini、DeepSeek 等非 GPT 模型前先关掉 LCX；不需要重启 DSH。

## Native V2 Compact / Replay

DSH 仍然决定什么时候压缩。LCX 只负责把压缩请求送到 Responses Native V2，并把结果接回现有 Session。

默认 pressure 策略：

```text
< 90%   正常运行
90%     优先 Native V2 Compact
95%     允许 DSH emergency prune
```

手动 `/compact` 继续使用 DSH 自己的 compaction transaction。

Native state 只在兼容的同一会话 / route 上复用。切换到不兼容的 GPT route 时会自动改用 portable history，不会把旧 opaque state 硬塞过去。

## Prompt Cache

在支持的 GPT-5.6 route 上，LCX 使用当前的 `prompt_cache_options` 并保持稳定的 cache identity。

普通连续对话和 tool-heavy 任务只要请求前缀不变，就可以持续命中缓存。以下情况会建立新的 cache epoch：

- Native Compact 改写历史；
- 运行中加载 skill / plugin，顶层 `tools` schema 发生变化。

第二种情况目前会产生一次 cache miss，新的工具集合稳定后会重新 warm。0.4.2 优先保证工具定义正确，没有为了省这一轮缓存去猜 dynamic-tool provenance。

## Search

普通搜索仍然使用 DSH 的 `web_search`：

```text
DSH web_search → LCX SearchProvider → GPT Hosted Search
```

需要更多控制时，可以单独开启：

- `websearch_gpt_advanced` — 域名过滤、位置、search context、图片搜索等 Hosted Search 参数
- `websearch_alpha` — 连续 `search / open / find / click / screenshot`

Alpha 默认关闭，只有当前 route 的 capability probe 通过后才会注册。

## Settings

建议先用默认值，只改你真正需要的选项。

| Setting | Default / 建议 |
|---|---|
| Enable LCX | GPT 会话时开启 |
| Use GPT Hosted Search | 按需 |
| Advanced Hosted Search | Off |
| Alpha Search | Off |
| Native-first auto compaction | On |
| Native threshold | `90%` |
| Emergency DSH prune | `95%` |
| Fallback to Basic Compaction | On |
| `web_search` timeout | `240s` |

## Compatibility

| Plugin | DSH | DSH host Pi | Plugin Pi | Node.js |
|---|---|---|---|---|
| `0.4.2` | `0.1.1-rc.2` | `0.82.1` | `0.84.3` | `^22.19.0 || >=24` |

`@earendil-works/pi-ai@0.84.3` 只由插件自己使用，不会通过 override 升级 DSH host 的 Pi。

DSH `0.1.2-alpha.1` 尚未列入 0.4.2 的正式兼容范围。

## Known limitations

- 当前常用 route 不接受 content-level `prompt_cache_breakpoint`，因此没有开放 explicit breakpoint 设置。
- 动态 skill / plugin 改变顶层工具集合时，可能出现一次 Prompt Cache reset；工具功能不受影响。
- `reasoning.context` / `reasoning.mode` 取决于 DSH / Pi 是否真正暴露这些字段。
- 1.05M long context 和 Programmatic Tool Calling 暂不作为 0.4.2 的正式支持项。

## Development

```bash
npm run typecheck
npm test
npm run test:schema
npm pack --ignore-scripts
```

更细的请求生命周期、checkpoint、Replay 和协议说明在 [ARCHITECTURE.md](ARCHITECTURE.md)。版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT

本项目是独立的社区插件，与 OpenAI、DeepSeek、Sub2API、NewAPI 无隶属或官方背书关系。DeepSeek 名称及鲸鱼标识归其权利人所有。
