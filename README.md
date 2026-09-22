<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="LCX Codex" width="100%" />

# LCX Codex

**给 DeepSeek Harness 里的 GPT 和 Grok 加上联网搜索和长对话自动压缩。**

[![npm latest](https://img.shields.io/npm/v/dsh-lcx-codex/latest?label=latest)](https://www.npmjs.com/package/dsh-lcx-codex)
[![npm prelatest](https://img.shields.io/npm/v/dsh-lcx-codex/prelatest?label=prelatest&color=orange)](https://www.npmjs.com/package/dsh-lcx-codex?activeTab=versions)
[![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

**简体中文** · [English](README_EN.md) · [更新日志](CHANGELOG.md) · [问题反馈](https://github.com/kk3ya03-star/dsh-lcx-codex/issues)

</div>

LCX Codex 是 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（DSH）的社区插件。装上之后，你在 DSH 里用的 GPT 和 Grok 可以：

- **联网搜索**：GPT 使用 Responses 服务端搜索（Hosted Search），Grok 使用 xAI 原生 Web Search 和 X Search；
- **长任务不中断**：对话接近上下文上限时自动压缩并继续，不用手动开新会话；
- **直接看到搜索到的图片和视频**：在回答下方预览，点击放大或播放。

模型、API Key、会话和其他工具仍由 DSH 管理，不需要额外配置。其他模型（如 DeepSeek）照常走 DSH 自己的逻辑，不受影响。

## 使用前提

- 已安装 DSH，并在 DSH 中配置好 **GPT 或 Grok 的 Responses API 路由**（官方 API 或兼容网关均可）。
- Node.js `^22.19.0` 或 `>=24.0.0`。

> 搜索和压缩依赖服务端能力。你的网关能正常聊天，不代表它一定支持这些功能，详见[已知限制](#已知限制)。

## 安装

### 1. 按 DSH 版本选择插件版本

先运行 `dsh --version` 查看 DSH 版本，再按下表选择：

| 你的 DSH 版本 | 安装的 LCX 版本 | 安装命令中的标签 |
| --- | --- | --- |
| `0.1.6` 系列（`0.1.6-alpha.2` 及以后） | `0.4.4-pre.1`（预发布版） | `@prelatest` |
| `0.1.5` 系列（`0.1.5-rc.1` 及以后） | `0.4.3`（稳定版） | `@latest` |

请务必按表格选择：`0.4.3` 不支持 DSH `0.1.6`，`0.4.4-pre.1` 也不支持 DSH `0.1.5`。装错版本时安装命令可能只给出依赖警告，但插件可能无法正常工作。

### 2. 安装并启动

DSH `0.1.6` 系列：

```sh
dsh plugin --profile web add dsh-lcx-codex@prelatest
dsh web
```

DSH `0.1.5` 系列：

```sh
dsh plugin --profile web add dsh-lcx-codex@latest
dsh web
```

以后更新插件，重新运行同一条 `add` 命令即可。

### 3. 打开功能开关

打开 DSH Web 的插件页面，在 LCX 的配置卡片 **Responses / Codex 能力** 中按需打开下列开关，然后点击 **保存**。

**GPT**

| 开关 | 作用 | 建议 |
| --- | --- | --- |
| **启用 LCX** | GPT 功能的总开关，包括长对话自动压缩 | 用 GPT 时打开 |
| **使用 GPT Hosted Search 作为 DSH web_search 后端** | GPT 联网搜索 | 需要联网时打开 |
| **启用高级 Hosted 工具** | 图片搜索、限定网站、指定位置等（需先打开上一项） | 按需 |
| **启用 Alpha command** | 实验功能：让 GPT 继续打开、查找搜索结果中的页面 | 日常不需要 |

**Grok 原生搜索**（与“启用 LCX”相互独立）

| 开关 | 作用 |
| --- | --- |
| **启用原生 Web Search** | Grok 搜索网页 |
| **启用原生 X Search** | Grok 搜索 X 内容 |

开启任一项后，Grok 改用 xAI 原生搜索；网页读取和其他 DSH / MCP 工具仍可正常使用。

**显示**

| 开关 | 作用 |
| --- | --- |
| **搜索媒体预览** | 在回答下方显示搜索到的图片和视频，点击放大或播放。只改变界面显示，不影响发给模型的内容 |

## 怎么用

像平时一样和模型说话即可，不需要写任何工具参数：

> 搜索 Python 官方文档，告诉我 `asyncio.TaskGroup` 应该怎么用。

> 搜几张金门大桥的照片，显示一张，并附上来源网页。

> 用 Grok 看看 X 上最近关于这个项目的讨论。

长对话会在接近上限时自动压缩；你也可以随时输入 `/compact` 手动压缩。

## 从旧版本升级

- **DSH 从 `0.1.5` 升级到 `0.1.6`**：需要把插件换成 `@prelatest`（`0.4.4-pre.1`），`0.4.3` 不支持 DSH `0.1.6`。
- **升级后建议新建会话**：旧版本保存的压缩状态不保证兼容。

## 停用与卸载

- **临时停用**：在配置卡片中关闭 **启用 LCX** 和 Grok 原生搜索开关并保存，GPT 和 Grok 即恢复 DSH 原生行为。
- **卸载**：

  ```sh
  dsh plugin --profile web remove dsh-lcx-codex
  ```

## 已知限制

- **网关能力因人而异**：搜索、压缩、Alpha 都依赖对应的服务端能力，不同网关支持程度不同。
- **Grok**：支持 API Key / API 网关路由，不支持 xAI OAuth / SuperGrok 登录。`0.4.4-pre.1` 的原生 X Search 目前只在 `grok-4.6` 上验证过。
- **Alpha 仍是实验功能**：搜索本身可用，但连续打开/查找页面在部分路由上可能失败，截图也不一定能显示。
- **DSH `0.1.5` + LCX `0.4.3`**：在插件设置中启用或停用 LCX 后，已打开的浏览器页面可能需要刷新。
- **验证范围**：`0.4.4-pre.1` 在 DSH `0.1.6-alpha.2` 上完整验证；`0.4.3` 在 DSH `0.1.5-rc.1` 上完整验证。同系列的更新版本可以安装，但未逐一验证，遇到问题欢迎反馈。

## 常见问题

**装完没有变化？**
确认安装命令和启动命令用的是同一个 profile（上面的示例都是 `web`），并检查插件设置里的开关已经保存。

**能正常聊天，但搜索或压缩失败？**
大概率是当前 GPT / Grok 路由没有提供对应的服务端能力。可以换官方 API 或其他网关对比一下。

**安装时出现依赖版本警告，或插件加载失败？**
通常是 DSH 版本和插件版本不匹配，按[上面的表格](#1-按-dsh-版本选择插件版本)重新选择。

## 反馈问题

请在 [Issues](https://github.com/kk3ya03-star/dsh-lcx-codex/issues) 中附上：插件版本、DSH 版本、Node.js 版本、使用的模型/网关类型和复现步骤。

**请不要上传 API Key、完整请求内容或未脱敏的会话日志。**

## 更多

- [更新日志](CHANGELOG.md)
- [架构说明](ARCHITECTURE.md)
- [第三方许可](THIRD_PARTY_NOTICES.md)

## 许可证

[MIT](LICENSE)。独立社区插件，与 OpenAI、xAI、DeepSeek、Sub2API、NewAPI 无隶属关系，也未获得其官方背书。
