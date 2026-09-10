<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="LCX Codex" width="100%" />

# LCX Codex

**让 DeepSeek Harness 里的 GPT 与 Grok 更适合长任务、联网搜索和连续工作。**

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?label=latest)](https://www.npmjs.com/package/dsh-lcx-codex)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--rc.1-16803c)](#安装)
[![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

**简体中文** · [English](README_EN.md) · [更新日志](CHANGELOG.md) · [问题反馈](https://github.com/kk3ya03-star/dsh-lcx-codex/issues)

</div>

LCX Codex 是 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（DSH）的社区插件。

它不会替代 DSH，也不需要你重新配置模型、接口或 API Key。模型、凭据、会话和工具仍由 DSH 管理；LCX 只在需要时为 GPT 和 Grok 增加额外能力。

## 你可以用它做什么

| 能力 | 适合场景 |
| --- | --- |
| GPT 联网搜索 | 让 GPT 直接通过 DSH 的 `web_search` 查询网页。 |
| GPT 高级搜索 | 搜图片、限定网站、加入位置等额外搜索条件。 |
| Grok 原生 Web / X Search | 直接使用 xAI Responses 的 Web Search 和 X Search。 |
| 长对话压缩 | GPT 长任务接近上下文上限时自动尝试远程压缩，并继续当前会话。 |
| 搜索媒体预览 | 在回答下方直接预览可用的图片和视频链接。 |
| Alpha 网页操作 | 实验性连续网页阅读能力，适合需要进一步打开、查找页面内容的任务。 |

其他模型继续使用 DSH 原生路径，不会因为安装 LCX 而被接管。

## 安装

当前稳定版：**`dsh-lcx-codex@0.4.3`**

兼容环境：

- DSH `0.1.5-rc.1` 起的 `0.1.5` 系列（当前完整验证基线：`0.1.5-rc.1`）
- Node.js `^22.19.0 || >=24.0.0`

安装：

```sh
dsh plugin --profile web add dsh-lcx-codex@0.4.3
dsh web
```

后续稳定版更新可以使用：

```sh
dsh plugin --profile web add dsh-lcx-codex@latest
```

不指定版本或使用 `@latest` 都会安装当前稳定版。需要预发布版本时可使用 `@prelatest`；`0.4.3-pre.13` 作为本次正式版之前的已验证预发布历史继续保留。

本版已在官方 DSH `0.1.5-rc.1` 完整验证。后续同一 `0.1.5` 系列版本可以直接安装并进行兼容评估，不再需要仅因为 RC 版本号变化而发布新的 LCX 版本。

## 启用功能

打开 DSH Web 的插件设置，找到 **Responses / Codex 能力**。

### 使用 GPT

通常打开：

1. **启用 LCX**
2. **GPT Hosted Search**（需要联网时）

按需再打开：

- **高级 Hosted 工具**：需要图片搜索、限定域名、位置等高级搜索条件时使用；它依赖 GPT Hosted Search。
- **Alpha**：实验性网页连续操作。日常联网搜索不需要开启。

### 使用 Grok

Grok 原生搜索与 GPT 的 LCX 主开关相互独立：

- **Grok 原生 Web Search**：搜索网页。
- **Grok 原生 X Search**：搜索 X 内容。

开启 Grok 原生搜索后，LCX 会使用 xAI 的服务端搜索能力，同时保留页面读取和其他 DSH / MCP 工具。

### 搜索媒体预览

**搜索媒体预览**可以独立开启。它只改变回答的显示方式，不会修改模型提示词、搜索请求、聊天历史或缓存。

可识别的图片会显示缩略图并支持放大；直接视频链接可以点击播放。媒体加载失败时，原来的文字和链接仍会保留。

## 常见用法

直接像平时一样和模型说话，不需要手写工具参数。例如：

> 搜索 Python 官方文档，告诉我 `asyncio.TaskGroup` 应该怎么用。

> 搜索几张金门大桥的照片，显示一张，并给我来源网页。

> 用 Grok 搜一下 X 上最近关于这个项目的讨论。

长任务也不需要自己盯着上下文。启用 LCX 后，兼容的 GPT 路由会在对话变得很长时自动尝试远程压缩并继续工作；你也可以使用 `/compact` 手动压缩。

## 兼容性与已知限制

- `0.4.3` 的当前完整验证基线是 DSH `0.1.5-rc.1`。同一 `0.1.5` 系列后续版本处于可安装、可评估范围，但仍会单独记录兼容验证结果；`0.1.6` 及更高版本不会自动视为兼容。
- 从较旧的 LCX / DSH 版本升级时，建议新建会话；旧版保存的压缩状态不保证兼容。
- Grok 原生搜索支持 API Key / API 网关路由；xAI OAuth / SuperGrok 登录不在当前范围。
- Alpha 仍是实验功能。搜索可以正常使用，但连续 `open / find` 等操作在部分路由上仍可能失败；截图也不保证能作为可显示图片返回。
- 修改 DSH profile 中的插件启用状态后，已经打开的浏览器页面可能需要刷新。
- 不同 API 网关支持的能力可能不同。普通聊天可用，不代表搜索、长对话压缩或 Alpha 等功能也一定可用。

## 遇到问题

**安装后看不到变化**：确认安装和启动使用的是同一个 `web` profile，并检查对应功能开关是否已经保存。

**对话正常，但搜索或压缩失败**：先确认当前 GPT / Grok Responses 路由确实提供对应服务端能力。网关名称本身不代表一定支持所有功能。

提交 [Issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues) 时，请附上插件版本、DSH 版本、Node.js 版本和复现步骤。不要上传 API Key、完整请求或未脱敏的会话日志。

## 更多信息

- [更新日志](CHANGELOG.md)
- [架构说明](ARCHITECTURE.md)
- [第三方许可](THIRD_PARTY_NOTICES.md)

## 许可证

[MIT](LICENSE)。独立社区插件，与 OpenAI、DeepSeek、Sub2API、NewAPI 无隶属或官方背书关系。
