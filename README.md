<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="LCX Codex" width="100%" />

# LCX Codex

**为 DeepSeek Harness 中的 GPT 会话提供远程原生压缩、联网搜索和图片搜索。**

[![npm prerelease](https://img.shields.io/npm/v/dsh-lcx-codex/prelatest?label=prelatest)](https://www.npmjs.com/package/dsh-lcx-codex)
[![DSH](https://img.shields.io/badge/DSH-0.1.3--alpha.2-16803c)](#安装)
[![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

**简体中文** · [English](README_EN.md) · [更新日志](CHANGELOG.md) · [问题反馈](https://github.com/kk3ya03-star/dsh-lcx-codex/issues)

</div>

LCX Codex 是 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（DSH）的社区插件。它将 GPT 接口的远程压缩和搜索能力接入 DSH，让长对话在压缩后继续，也能在回复中展示搜索到的网页图片。

模型、接口、凭据、会话和工具仍由 DSH 管理，不需要在插件里再配置一遍。插件面向 **GPT / OpenAI Responses**，可用于支持相应能力的 Sub2API、NewAPI 等通道。

## 安装

本页对应 **`0.4.3-pre.2` 预发布版**，适配 **DSH `0.1.3-alpha.2`**。稳定版仍为 `0.4.2`，使用旧版 DSH `0.1.1-rc.2` 的用户请看[稳定版说明](https://github.com/kk3ya03-star/dsh-lcx-codex/blob/v0.4.2/README.md)。

安装前，请确认 DSH Web 能正常启动，且已配置可以对话的 GPT Responses 模型。Node.js 要求 `^22.19.0 || >=24.0.0`；Windows 启动出现 `fs-ext` 报错时，先看下方[故障排查](#故障排查)。

```sh
dsh plugin --profile web add dsh-lcx-codex@0.4.3-pre.2
dsh web
```

以后升级预发布版，可执行 `dsh plugin --profile web add dsh-lcx-codex@prelatest`。不带版本或标签安装会得到稳定版，**不是本页介绍的新版本**。

**从 `0.4.2` 升级：** 旧插件配置和 v3/v4 压缩检查点不再兼容，请重新配置插件并新建会话。新版 v5 检查点仍支持重启续聊。

## 启用

打开 DSH Web 的插件设置，展开 **Responses / Codex 能力**，按需打开开关并保存：

| 开关 | 什么时候开 |
| --- | --- |
| 启用 LCX | 使用 GPT 远程原生压缩及下面的搜索能力时。 |
| GPT Hosted Search | 需要让 DSH 联网查询时。 |
| 高级 Hosted 工具 | 需要搜图、限定网站或使用其他搜索条件时。 |
| Alpha | 需要连续打开、查找和点击网页内容时，属于实验功能。 |

**四个开关默认均关闭。** 日常联网使用打开前两项；需要图片搜索再打开第三项。模型、推理等级及图片输入能力在 DSH 的模型配置中设置。

切换到 Claude、Gemini、DeepSeek 等非 GPT 模型前，请先关闭 LCX。关闭后恢复 DSH 原生请求路径。

## 搜索与搜图

### 联网查询

直接在对话里提出问题即可，例如：

> 查一下 Node.js 最新 LTS 版本，给我官方来源。

普通查询使用 DSH 原有的 `web_search`；需要更细的条件时，模型可以调用高级工具 `websearch_gpt_advanced`：

> 只搜索 Python 官方文档，查找 asyncio.TaskGroup 的用法。

### 搜索图片并显示

开启高级 Hosted 工具后，可以这样说：

> 搜索金门大桥的照片，选一张直接显示在回复里，并附上来源网页。

**不需要自己填写 JSON 参数。** 模型负责选择图片搜索参数；如果只返回文字，可以补充“请使用高级 Hosted 的图片搜索，并把图片显示出来”。

搜索工具提供图片链接与来源，DSH 用现有的 Markdown 渲染器显示图片。这是**搜索已有图片，不是生成图片**，也不代表模型已经读取了图片像素。图片能否显示还取决于原站链接是否可访问。

### Alpha 网页操作

`websearch_alpha` 支持 `search / open / find / click / screenshot` 等动作，用于连续查阅网页。它操作的是**上游搜索服务中的网页内容**，不会操作你的本机浏览器或 DSH 界面。

Alpha 需要单独开启，且接口通过能力探测后才会出现。目前网页引用仍可能偶发失效，`screenshot` 尚未验证能返回可显示的图片。**日常搜索和搜图不需要开启 Alpha。**

## 长对话与压缩

开启 LCX 后，插件将 DSH 的压缩请求交给上游 GPT 接口执行 **Native V2 远程原生压缩**，再将结果接回当前会话。会话保存、工具执行和压缩事务仍由 DSH 负责。

| 上下文占用 | 处理方式 |
| --- | --- |
| 低于 `90%` | 正常对话，不提前裁剪工具结果。 |
| `90%` 至 `95%` | 优先尝试远程原生压缩。 |
| 达到 `95%` | 允许 DSH 紧急裁剪工具结果，再按流程压缩。 |

也可以输入 `/compact` 手动压缩。这些阈值是固定策略，不需要额外设置；实际能否压缩取决于是否有可压缩的历史以及接口支持情况。

压缩后可以继续对话、重启恢复或切换 GPT 模型。遇到不兼容的模型或接口配置时，插件改用可迁移的历史，不会强行复用原生状态。首次建立检查点时，部分可恢复失败可以回退到 DSH 基础压缩；并非所有失败都会回退。

## 缓存

缓存由上游服务实现，插件负责保持兼容的缓存标识。相同请求前缀可以复用，**是否命中及缓存多久由接口决定**，不需要再开启一个“插件缓存”。

插件跟随 Pi `0.85.1` 的缓存规则，支持显式模式的接口使用 `30m` 长保留参数。压缩、切换模型或改变工具列表后，缓存可能需要重新建立。子代理也可能命中公共前缀缓存，但命中缓存不等于继承了父会话的私有历史。

## 故障排查

**DSH 在 Windows 启动时报 `fs-ext` 错误？**

DSH `0.1.3-alpha.2` 会在启动时加载 `fs-ext`，即使 Windows 实际不使用它。当它的原生模块不可用时，DSH 会在启动阶段退出。这是 **DSH 的依赖加载问题，不是插件压缩或会话锁损坏**。

本版 Windows 实测使用了一个最小 DSH 修正：仅在非 Windows 平台加载 `fs-ext`，保留原有 Win32 会话锁。插件不会自动修改 DSH；未经该修正的 Windows 环境不保证能启动。不要用关闭会话锁来绕过问题。

**安装后没有变化？**

检查安装和启动是否使用同一个 `web` 配置，确认已打开 LCX 并保存。联网搜索和高级搜图各有独立开关。

**对话正常，但搜索或压缩失败？**

普通 Responses 对话可用，不代表接口同时支持 Native V2、Hosted Search 或 Alpha。请确认当前通道提供对应能力；Sub2API、NewAPI 的名称本身不是能力保证。

## 版本与验证范围

本版使用 DSH `0.1.3-alpha.2`、DSH host Pi `0.85.1` 和插件 Pi `0.85.1`。插件单独声明 Pi 依赖，不替换 DSH 的依赖。

已实测长对话、压缩后续聊和重启恢复、压缩后切换模型、PNG/TXT 附件、搜索及图片展示、双会话并发和前台子代理缓存。Alpha 的上述限制仍存在；代理、高并发与取消交错、后台可续聊子代理和其他附件格式尚未全面验证。详细变更见 [v0.4.3-pre.2 发布说明](https://github.com/kk3ya03-star/dsh-lcx-codex/releases/tag/v0.4.3-pre.2)。

## 开发与反馈

```sh
npm ci --ignore-scripts
npm ci --prefix scripts/runtime-alpha2 --ignore-scripts
node scripts/link-dsh-runtime.mjs scripts/runtime-alpha2
node scripts/check-generated.mjs
npm run typecheck
npm test
npm run test:schema
```

实现细节见[架构说明](ARCHITECTURE.md)。提交 [Issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues) 时，请附上插件、DSH、Node.js 版本及复现步骤，不要上传 API Key、完整请求或未脱敏的会话日志。

## 许可证

[MIT](LICENSE)。独立社区插件，与 OpenAI、DeepSeek、Sub2API、NewAPI 无隶属或官方背书关系。DeepSeek 名称及标识归其权利人所有。
