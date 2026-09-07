<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="LCX Codex" width="100%" />

# LCX Codex

**让 DeepSeek Harness 中的 GPT 会话支持原生压缩、联网搜索与连续网页操作。**

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?label=npm)](https://www.npmjs.com/package/dsh-lcx-codex)
[![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-16803c)](#兼容性与限制)
[![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

**简体中文** · [English](README_EN.md) · [版本发布](https://github.com/kk3ya03-star/dsh-lcx-codex/releases) · [问题反馈](https://github.com/kk3ya03-star/dsh-lcx-codex/issues)

</div>

LCX Codex（`dsh-lcx-codex`）是 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（DSH）的社区插件，为已配置好的 **GPT / OpenAI Responses 接口**扩展长会话和搜索能力，适用于兼容的 Sub2API、NewAPI 等通道。

你仍然在 DSH 中选择模型、管理会话和使用工具。开启 LCX 后，从普通对话到工具调用、上下文压缩和压缩后的续聊，都使用同一条 Responses 请求路径。

## 它能做什么

| 你需要 | LCX 提供 |
| --- | --- |
| **长对话继续进行** | 接近上下文上限时优先使用 Native V2 原生压缩，支持压缩后续聊和重启恢复。 |
| **在对话中查询网页** | 通过 DSH 原有的 `web_search` 使用 GPT Hosted Search，普通搜索跟随当前 Agent 的 GPT 模型。 |
| **更细的搜索控制** | 按需启用域名过滤、位置、搜索上下文大小、图片搜索等 Hosted Search 参数。 |
| **连续查阅网页** | 在支持的接口上使用 Alpha 工具，连续执行搜索、打开、查找、点击等操作。 |
| **复用提示词缓存** | 在支持的 GPT-5.6 接口上保持稳定的缓存标识，让相同的请求前缀可以被重复利用。 |

> LCX 面向 GPT / OpenAI Responses。各项扩展能力取决于上游接口支持；能正常对话，不代表该通道同时支持原生压缩、Hosted Search 或 Alpha 网页操作。

## 快速开始

### DSH 0.1.3 用户：0.4.3-pre.2 预发布

`0.4.3-pre.2` 面向 **DSH `0.1.3-alpha.2` / host 与插件 Pi `0.85.1`**，安装时明确选择预发布：

```sh
dsh plugin --profile web add dsh-lcx-codex@0.4.3-pre.2
dsh web
```

也可使用 `dsh-lcx-codex@prelatest` 跟随预发布通道。稳定通道 `latest` 仍为 `0.4.2`，对应下面的旧版安装说明，不要混用 DSH 版本。

新版只保留 LCX、Hosted Search、高级 Hosted、Alpha 四个开关；`90%` / `95%` 压缩阈值及 `240` 秒搜索超时为固定策略。设置页语言跟随 DSH。旧版 `0.4.2` 插件配置与 v3/v4 压缩检查点不再迁移，请重新配置并新建会话；当前 v5 检查点仍支持重启续聊。

**预发布限制：** Windows 上 DSH `0.1.3-alpha.2` 存在启动时加载 `fs-ext` 的宿主问题。本轮 Windows 实测使用了仅在非 Windows 加载 `fs-ext` 的本地修正，保留原 Win32 会话锁；插件安装不会自动修补 DSH，不能宣称未修正的 Windows 宿主开箱即用。Alpha 网页引用仍可能偶发失效，`screenshot` 尚未验证返回可显示的图片。代理 / `NO_PROXY`、更高并发与取消交错、后台可续聊子代理尚未测全。

普通对话、缓存、基础 PNG/TXT 附件、Native 压缩与重启续聊、压缩后模型切换、普通搜索与 Hosted 搜图展示、双会话并发、前台子代理缓存已有有界实测；这不是全平台或所有附件格式的完整兼容保证。

### 1. 准备环境

- DSH **`0.1.1-rc.2`**，且 Web 界面能够正常使用。
- Node.js **22.19.0 及以上的 22.x，或 24.0.0 及以上版本**。
- 已在 DSH 中配置好可正常对话的 **GPT Responses 接口、模型与凭据**。

### 2. 安装插件

在运行 DSH 的环境中执行：

```sh
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

插件通过 npm 安装，无需克隆仓库或手动下载源码。本 README 对应 **`0.4.2`**；可在 [npm](https://www.npmjs.com/package/dsh-lcx-codex) 查看发布版本，或查看 [v0.4.2 发布说明](https://github.com/kk3ya03-star/dsh-lcx-codex/releases/tag/v0.4.2)。

### 3. 启用并保存

1. 打开 DSH Web 的插件设置，展开 **Responses / Codex 能力**。
2. 勾选 **启用 LCX（接管当前 GPT Responses 会话）**。
3. 需要联网搜索时，再勾选 **使用 GPT Hosted Search 作为 DSH web_search 后端**。
4. 保留默认压缩设置，点击 **保存**，使用已配置好的 GPT 模型开始对话。

**LCX 和联网搜索默认关闭，安装后需要手动启用。** 高级搜索和 Alpha 可以在需要时再开。

切换 Claude、Gemini、DeepSeek 等非 GPT 模型前，请先关闭 LCX 并保存。模型切换本身不需要重启 DSH。

## 长会话如何继续

LCX 使用上游的 **Native V2 原生压缩**处理长上下文，并将压缩结果接回 DSH 会话，供后续请求继续使用（Replay）。DSH 仍负责压缩时机、会话保存和工具执行。

默认的 Native-first 自动压缩策略为：

| 上下文压力 | 行为 |
| --- | --- |
| 低于 `90%` | 正常运行，避免过早裁剪工具结果。 |
| 达到 `90%`、低于 `95%` | 优先尝试 Native V2 压缩。 |
| 达到 `95%` | 允许 DSH 紧急裁剪工具结果，并按现有流程处理压缩。 |

手动 `/compact` 仍通过 DSH 的压缩流程执行。首次建立压缩检查点时，符合条件的可恢复失败可以回退到 DSH 基础压缩；并非所有 Native 失败都会自动回退。

原生压缩状态只在兼容的同一会话与接口配置中复用。切换到不兼容的 GPT 模型或通道时，LCX 会改用可迁移的会话历史继续请求。

## 搜索怎么选

日常查询从 `web_search` 开始即可。三种搜索工具的用途和启用条件如下：

| 工具 | 用途 | 启用条件 |
| --- | --- | --- |
| `web_search` | 日常联网查询，使用 DSH 原有搜索入口。 | 开启 LCX 和 GPT Hosted Search。 |
| `websearch_gpt_advanced` | 域名过滤、位置、搜索上下文大小、图片搜索等额外参数。 | 在上述基础上开启高级 Hosted 工具。 |
| `websearch_alpha` | 连续执行 `search / open / find / click / screenshot` 等操作。 | 开启 Alpha，且当前接口通过能力探测。 |

Alpha 默认关闭。即使打开开关，也只有当前接口通过能力探测后才会注册工具。

### 可以直接让 DSH 搜图吗？

可以。开启 LCX、GPT Hosted Search 和高级 Hosted 工具后，直接说：

> 搜索金门大桥的照片，选一张直接显示在回复里，并附上图片来源网页。

通常不需要自己填写 JSON，模型负责选择 `websearch_gpt_advanced` 的图片搜索参数；若只返回文字，可以补充“请使用高级 Hosted 的图片搜索”。是否选择正确参数仍取决于模型，接口也必须支持图片搜索。

工具返回的是现有网页图片的 URL、来源等信息，模型可用 Markdown 将图片显示在 DSH 中。`0.4.3-pre.2` 已实测图片结果解析及界面展示；这是**搜索已有图片，不是生成图片，也不等于模型已经看到了图片像素**。图片链接可能受原站权限或防盗链影响。Alpha 不必开启；Alpha 的网页操作发生在上游搜索服务，不会点击你的本机浏览器或 DSH 界面，其 `screenshot` 也不保证返回照片。

## 缓存的使用预期

在支持的 GPT-5.6 接口上，LCX 使用 `prompt_cache_options` 并保持稳定的缓存标识。连续对话和工具任务的请求前缀保持一致时，可以复用提示词缓存；实际命中情况由上游决定。

原生压缩会改变历史内容。运行中加载 skill、plugin，或切换会改变工具列表的功能，也可能使缓存需要重新建立。新请求前缀稳定后可以再次复用缓存。

## 设置参考

下表为稳定版 `0.4.2`。`0.4.3-pre.2` 只提供前四项开关，其余为固定内部策略。

| 设置 | 默认值 | 建议 |
| --- | --- | --- |
| 启用 LCX | 关闭 | 使用 GPT Responses 时开启。 |
| GPT Hosted Search | 关闭 | 需要联网查询时开启。 |
| 高级 Hosted 工具 | 关闭 | 需要额外搜索参数时开启。 |
| Alpha command | 关闭 | 在支持的接口上按需开启。 |
| Native-first 自动压缩 | 开启 | 保持默认，需先启用 LCX。 |
| Native 自动压缩阈值 | `90%` | 保持默认。 |
| DSH 紧急裁剪阈值 | `95%` | 必须高于 Native 阈值。 |
| Native 失败后回退 DSH basic compaction | 开启 | 保留符合回退条件时的基础压缩能力。 |
| `web_search` 超时 | `240` 秒 | 搜索较慢时再调整。 |

## 常见问题

**安装后没有变化？**

确认插件安装到了启动 Web 使用的 `web` 配置中，再检查 LCX 是否已经勾选并保存。联网搜索有单独的开关。

**能对话，但搜索或压缩报错？**

检查当前通道是否支持对应能力，以及模型与凭据是否可用。Sub2API、NewAPI 的名称本身不代表其所有通道都支持相同功能。

**需要手动下载安装包吗？**

常规安装使用上面的 DSH 命令即可。需要留存发布包时，可下载 [v0.4.2 npm 包（.tgz）](https://registry.npmjs.org/dsh-lcx-codex/-/dsh-lcx-codex-0.4.2.tgz)。GitHub 的 **Code → Download ZIP** 提供源码，不能代替插件安装步骤。

## 兼容性与限制

| 组件 | `0.4.2` 对应版本 |
| --- | --- |
| DSH | `0.1.1-rc.2` |
| DSH host Pi | `0.82.1` |
| 插件 Pi | `0.84.3` |
| Node.js | `^22.19.0 \|\| >=24.0.0` |

插件单独使用 `@earendil-works/pi-ai@0.84.3`，不覆盖 DSH host 的 Pi 依赖。

- DSH `0.1.2-alpha.1` 尚未列入此版本的正式兼容范围。
- 1.05M 长上下文和 Programmatic Tool Calling 暂不作为正式支持项。
- 显式 `prompt_cache_breakpoint` 设置未开放。
- `reasoning.context` 和 `reasoning.mode` 是否可用，取决于 DSH / Pi 是否暴露相应字段。

## 开发与反馈

在仓库中安装依赖并运行检查：

```sh
npm ci --ignore-scripts
npm ci --prefix scripts/runtime-alpha2 --ignore-scripts
node scripts/link-dsh-runtime.mjs scripts/runtime-alpha2
node scripts/check-generated.mjs
npm run typecheck
npm test
npm run test:schema
npm pack --ignore-scripts
```

[架构说明](ARCHITECTURE.md)介绍请求生命周期、压缩检查点和 Replay 实现；[更新日志](CHANGELOG.md)记录版本变化。

遇到问题可提交 [Issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues)，附上插件、DSH、Node.js 版本、接口类型、复现步骤和已脱敏的报错信息。

## 许可证

[MIT](LICENSE)。本项目是独立社区插件，与 OpenAI、DeepSeek、Sub2API、NewAPI 无隶属或官方背书关系。DeepSeek 名称及鲸鱼标识归其权利人所有。
