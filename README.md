<div align="center">

<img src="assets/dsh-lcx-codex-banner.jpg" alt="dsh-lcx-codex" width="100%" />

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?color=1677ff&label=npm)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![License](https://img.shields.io/badge/license-MIT-6b7280)

**简体中文** · [English](README_EN.md) · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

</div>

给 DSH 的 GPT / OpenAI Responses 路径补上 Native Compact / Replay、Hosted Search 和长会话续接。

这个插件只管 GPT。LCX 关着时，DSH 原样工作；打开后，当前 GPT 会话从第一轮开始走 LCX 的 Responses 请求链。Agent、Session、工具执行和压缩时机仍然由 DSH 管。

当前版本：**0.4.2**

## 安装

```powershell
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

需要：

- DSH `0.1.1-rc.2`
- Node.js `^22.19.0 || >=24.0.0`
- DSH 里已经配好能用的 GPT Responses route

## LCX 开关

```text
LCX OFF  → DSH 原生 LLM 流程
LCX ON   → 当前 GPT 会话由 LCX 发送 Responses 请求
```

要切 Claude、Gemini、DeepSeek 等非 GPT 模型，先关 LCX。切模型本身不用重启 DSH。

## 有什么用

### Native Compact / Replay

DSH 还是负责判断什么时候该压缩。到阈值后，LCX 优先走 Responses Native V2：

```text
< 90%   正常运行
90%     优先 Native Compact
95%     允许 DSH emergency prune
```

手动 `/compact` 也保留 DSH 原来的事务逻辑。

Compact 后可以继续 Replay；重启 DSH 后也能接着原来的 session。GPT 模型或 route 不兼容时，不会硬塞旧的 opaque state，而是退回可移植历史继续跑。

### Prompt Cache

GPT-5.6 兼容 route 使用 `prompt_cache_options`，普通长会话在前缀稳定时可以持续命中缓存。

两种情况会自然重新 warm：

- Native Compact 改写了历史前缀；
- skill 在运行中增加了顶层工具，导致 `tools` schema 变化。

后者目前会多一次 cache miss，但工具功能正常。现阶段不为了省这一次 miss 去猜工具来源。

### Hosted Search

普通搜索还是 DSH 的 `web_search`，LCX 只替换后面的 GPT Hosted Search 路径，不额外塞第二个普通搜索工具。

另外两个可选入口：

- `websearch_gpt_advanced`：域名、位置、search context、图片搜索等
- `websearch_alpha`：`search / open / find / click / screenshot`

Alpha 默认关闭，探测通过后才注册。

## 推荐设置

| 设置 | 建议 |
|---|---|
| Enable LCX | GPT 会话时开 |
| Use GPT Hosted Search | 按需 |
| Advanced Hosted Search | 默认关 |
| Alpha Search | 默认关 |
| Native-first auto compaction | 开 |
| Native threshold | `90%` |
| Emergency DSH prune | `95%` |
| Fallback to Basic Compaction | 开 |
| `web_search` timeout | `240s` |

## 兼容性

| Plugin | DSH | DSH host Pi | Plugin Pi |
|---|---|---|---|
| `0.4.2` | `0.1.1-rc.2` | `0.82.1` | `0.84.3` |

插件自己带 Pi `0.84.3`，不会 override DSH 的 Pi。

目前没有把 DSH `0.1.2-alpha.1`、1.05M long context 和 Programmatic Tool Calling 算进 0.4.2 的正式支持范围。

## 开发

```bash
npm run typecheck
npm test
npm run test:schema
npm pack --ignore-scripts
```

实现细节看 [ARCHITECTURE.md](ARCHITECTURE.md)，版本记录看 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT

`LCX` 只是项目名。本项目与 OpenAI、DeepSeek、Sub2API、NewAPI 无隶属关系。
