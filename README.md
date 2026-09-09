<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="LCX Codex" width="100%" />

# LCX Codex

**为 DeepSeek Harness 中的 GPT 提供 Responses 生命周期能力，并为 Grok 接入原生 Web / X Search。**

[![npm prerelease](https://img.shields.io/npm/v/dsh-lcx-codex/prelatest?label=prelatest)](https://www.npmjs.com/package/dsh-lcx-codex)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--alpha.1-16803c)](#安装)
[![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

**简体中文** · [English](README_EN.md) · [更新日志](CHANGELOG.md) · [问题反馈](https://github.com/kk3ya03-star/dsh-lcx-codex/issues)

</div>

LCX Codex 是 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（DSH）的社区插件。它按当前模型启用对应能力：GPT 可使用远程原生压缩、Hosted / Alpha Search；Grok 可直接使用 xAI Responses 的原生 `web_search` 与 `x_search`。其他模型继续走 DSH 原生路径。

模型、接口、API Key / credential、会话和工具仍由 DSH 管理，不需要在插件里再配置一遍。GPT 与 Grok 的功能开关彼此独立；当前 Grok 原生搜索支持 API Key / API 网关调用，不包含 xAI OAuth / SuperGrok 登录。

## 安装

本页对应 **`0.4.3-pre.12` 预发布版**，只支持 **DSH `0.1.5-alpha.1` + Pi `0.85.1`**。稳定版仍为 `0.4.2`；本预发布版不为旧 DSH / 旧 Session 格式保留兼容层。

安装前，请确认 DSH `0.1.5-alpha.1` Web 能正常启动，并已配置需要使用的 GPT Responses 或 Grok Responses API 路由。Node.js 要求 `^22.19.0 || >=24.0.0`。

```sh
dsh plugin --profile web add dsh-lcx-codex@0.4.3-pre.12
dsh web
```

以后升级预发布版，可执行 `dsh plugin --profile web add dsh-lcx-codex@prelatest`。不带版本或标签安装会得到稳定版，**不是本页介绍的新版本**。

**升级到本版：** 只支持 DSH `0.1.5-alpha.1` 的 Session V3。旧插件配置、旧 DSH session、旧 LCX checkpoint / Grok replay envelope 都不迁移到活动目录。需要保留旧历史时，请先将旧 `sessions` 目录改名或归档，再让 DSH `0.1.5-alpha.1` 从新的空 `sessions` 目录开始；旧数据只作为离线备份保留。

DSH 持久化层重新打开同一个已保存 session 时，LCX 可以恢复该 session 内保存的 v5 checkpoint；这只是 DSH session persistence 上的继续对话，**不是 Codex rollout/checkpoint 的进程级 restart/resume 机制**。

## 启用

打开 DSH Web 的插件设置，展开 **Responses / Codex 能力**，按需打开开关并保存：

| 开关 | 什么时候开 |
| --- | --- |
| 启用 LCX | 使用 GPT Responses 生命周期、Native V2 压缩及 GPT 搜索能力时。 |
| GPT Hosted Search | 当前模型是 GPT，且需要普通联网查询时。 |
| 高级 Hosted 工具 | GPT 需要搜图、限定网站或使用其他 Hosted 搜索条件时。 |
| Alpha | GPT 需要连续 `open / find / click / screenshot` 网页操作时，属于实验功能。 |
| Grok 原生 Web Search | 当前模型是 Grok，并希望使用 xAI 服务端原生网页搜索时。 |
| Grok 原生 X Search | 当前模型是 Grok，并希望直接搜索 X 内容时。 |

**六个开关默认均关闭。** GPT 四项由“启用 LCX”控制；Grok 两项独立，不要求打开 GPT 的 LCX 主开关。模型、推理等级、图片输入、endpoint 与 credential 都继续在 DSH 的模型/provider 配置中管理。

模型切换不需要重启插件：

- GPT → 只启用已打开的 GPT / LCX 能力；
- Grok → 只启用已打开的原生 Web / X Search；开启任意 Grok 原生搜索时，该请求不会同时暴露 DSH `web_search`，但 `web_fetch` 和其他 DSH/MCP 工具仍可用；
- Claude、Gemini、DeepSeek 等其他模型 → 保持 DSH 原生会话、搜索、工具和压缩行为。

## 搜索与搜图

### GPT 联网查询

GPT 普通查询沿用 DSH 的单一 `web_search` 工具入口；开启 **GPT Hosted Search** 后，LCX 按当前 GPT Responses route 执行 Hosted Search。需要域名、位置、search context 或图片等额外参数时，可启用 `websearch_gpt_advanced`。

例如：

> 只搜索 Python 官方文档，查找 asyncio.TaskGroup 的用法。

### Grok 原生 Web / X Search

Grok 使用 xAI Responses 的服务端工具，而不是把搜索包装成 DSH function tool：

```text
{ type: "web_search" }
{ type: "x_search" }
```

开启任意 Grok 原生搜索后，Grok 请求会移除 DSH `web_search`，避免重复搜索语义；`web_fetch`、`read` 及其他 DSH/MCP function tools 仍保持可用。原生搜索结果可以继续进入本地工具调用，再回到同一 Grok agentic workflow；插件会保存 xAI 必需的 provider-native replay state，但不会把服务端搜索伪装成 DSH 本地工具调用。

当前支持 **API Key / API Gateway** 路由；OAuth / SuperGrok / X Premium 订阅登录不在本版范围内。LCX 不再为 Grok 自动追加可见的 synthetic `Sources:` 列表，并会清理已知的 `render_inline_citation` / `stateless_invoke` /私有区 renderer 标记、尾部 `<|eos|>` 等上游渲染协议残留；模型正文中主动写出的普通链接仍保持可见。完整 provider-native 搜索输出只保存在 same-session replay state 中。

### GPT 搜索图片并显示

开启高级 Hosted 工具后，可以这样说：

> 搜索金门大桥的照片，选一张直接显示在回复里，并附上来源网页。

**不需要自己填写 JSON 参数。** 模型负责选择图片搜索参数；如果只返回文字，可以补充“请使用高级 Hosted 的图片搜索，并把图片显示出来”。

搜索工具提供图片链接与来源，DSH 用现有的 Markdown 渲染器显示图片。这是**搜索已有图片，不是生成图片**，也不代表模型已经读取了图片像素。图片能否显示还取决于原站链接是否可访问。

### Alpha 网页操作

`websearch_alpha` 支持 `search / open / find / click / screenshot` 等动作，用于 GPT 连续查阅网页。它操作的是**上游搜索服务中的网页内容**，不会操作你的本机浏览器或 DSH 界面。

Alpha 需要单独开启，且接口通过能力探测后才会出现。目前网页引用仍可能偶发失效，`screenshot` 尚未验证能返回可显示的图片。**日常 GPT 搜索/搜图和 Grok 原生搜索都不需要开启 Alpha。**

## 长对话与压缩

开启 LCX 后，插件将 DSH 的压缩请求交给上游 GPT 接口执行 **Native V2 远程原生压缩**，再将结果接回当前会话。会话保存、工具执行和压缩事务仍由 DSH 负责。

| 上下文占用 | 处理方式 |
| --- | --- |
| 低于 `90%` | 正常对话，不提前裁剪工具结果。 |
| `90%` 至 `95%` | 优先尝试远程原生压缩。 |
| 达到 `95%` | 允许 DSH 紧急裁剪工具结果，再按流程压缩。 |

也可以输入 `/compact` 手动压缩。这些阈值是固定策略，不需要额外设置；实际能否压缩取决于是否有可压缩的历史以及接口支持情况。Grok 不走 GPT Native V2，而继续使用 DSH `0.1.5-alpha.1` 自己的 compaction；Session V3 的 leading `system/message` 由 DSH 保持在摘要之外。

压缩后可以在同一存活 session 内继续对话；如果 DSH 自身重新打开同一个已持久化 session，LCX 也会校验并恢复其中的 v5 checkpoint。遇到不兼容的模型、route 或 session identity 时，插件改用可迁移的历史，不会强行复用原生状态。首次建立检查点时，部分可恢复失败可以回退到 DSH 基础压缩；并非所有失败都会回退。这里不引入 Codex 式 rollout/checkpoint restart-resume。

## 缓存

缓存由上游服务实现，插件只负责保持与当前 provider 兼容的缓存/session identity。

- **GPT**：延续 LCX 既有策略；前台会话与其子代理可共享父会话的 prompt-cache identity，以复用公共请求前缀。真正的 DSH Session、工具执行与私有历史仍各自独立。
- **Grok**：严格跟随 DSH/Pi 原生语义；每个前台/子代理使用自己的 DSH Session ID 作为 prompt cache / session affinity identity，sibling 子代理不会共享 opaque replay state。

Pi `0.85.1` 的显式缓存模式支持 `30m` 长保留参数；`cacheRetention=none` 时不发送 prompt cache key。压缩、切换模型或改变工具列表后，缓存可能需要重新建立。

## 故障排查

**从旧版 Windows DSH 升级后还需要 `fs-ext` 本地补丁吗？**

不需要把 `0.1.3-alpha.2` 的 `fs-ext` 本地 workaround 带到 DSH `0.1.5-alpha.1`。本版已经在未修改的 Windows DSH `0.1.5-alpha.1` 上完成 Web 与 headless 启动验证。若旧安装曾手工修改 DSH 文件，请通过正常安装得到干净的 `0.1.5-alpha.1` 文件，不要把旧补丁复制到新版本。

**安装后没有变化？**

检查安装和启动是否使用同一个 `web` 配置，并确认对应模型的开关已保存。GPT 主开关与 Grok Web/X 开关彼此独立。

**对话正常，但搜索或压缩失败？**

普通 Responses 对话可用，不代表接口同时支持 Native V2、Hosted/Alpha 或 Grok 原生 Web/X Search。请确认当前通道提供对应服务端能力；Sub2API、NewAPI 或其他网关名称本身不是能力保证。

## 版本与验证范围

本版使用 DSH `0.1.5-alpha.1`、DSH host Pi `0.85.1` 和插件 Pi `0.85.1`。插件单独声明 Pi 依赖，不替换 DSH 的依赖。

发布候选已通过 **246/246 PASS**、strict host/client typecheck 与 DSH schema 校验。真实 DSH `0.1.5-alpha.1` 隔离运行已验证：Web 启动、headless GPT 普通请求、Session V3 `system/message`、Native V2 `/compact`、compact 后同 session continuation，以及 v5 checkpoint 的 session identity 绑定。

Grok 另做了真实长会话验证：原生 Web Search → 足够长的上下文 → DSH 实际 `/compact` → compact 后再次原生搜索/续聊。marker 与关键事实保持，`system/message` 只出现一次，Grok replay 为当前 v3 envelope，最终可见正文 `sourceLeak=false`。

仍需保留的预发布限制：Alpha 引用及 screenshot 展示、代理/NO_PROXY、更广的并发/取消和后台 continuable subagent 矩阵仍未全面覆盖；Grok OAuth 不支持；未知的新型上游 renderer 协议仍可能需要额外适配。DSH `0.1.5-alpha.1` 本身仍是 alpha/developer-preview 级上游。

## 开发与反馈

```sh
npm ci --ignore-scripts
npm ci --prefix scripts/runtime-dsh015 --ignore-scripts
node scripts/link-dsh-runtime.mjs scripts/runtime-dsh015
node scripts/check-generated.mjs
npm run typecheck
npm test
npm run test:schema
```

实现细节见[架构说明](ARCHITECTURE.md)。提交 [Issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues) 时，请附上插件、DSH、Node.js 版本及复现步骤，不要上传 API Key、完整请求或未脱敏的会话日志。

## 许可证

[MIT](LICENSE)。独立社区插件，与 OpenAI、DeepSeek、Sub2API、NewAPI 无隶属或官方背书关系。DeepSeek 名称及标识归其权利人所有。
