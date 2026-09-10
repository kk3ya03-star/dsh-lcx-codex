<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="LCX Codex" width="100%" />

# LCX Codex

**为 DeepSeek Harness 中的 GPT 提供 Responses 生命周期能力，并为 Grok 接入原生 Web / X Search。**

[![npm prerelease](https://img.shields.io/npm/v/dsh-lcx-codex/prelatest?label=prelatest)](https://www.npmjs.com/package/dsh-lcx-codex)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--alpha.2-16803c)](#安装与兼容性)
[![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

**简体中文** · [English](README_EN.md) · [更新日志](CHANGELOG.md) · [问题反馈](https://github.com/kk3ya03-star/dsh-lcx-codex/issues)

</div>

LCX Codex 是 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（DSH）的社区插件。它按当前模型启用对应能力：GPT 可使用远程原生压缩、Hosted / Alpha Search；Grok 可直接使用 xAI Responses 的原生 `web_search` 与 `x_search`。其他模型继续走 DSH 原生路径。

模型、接口、API Key / credential、会话和工具仍由 DSH 管理，不需要在插件里再配置一遍。GPT 与 Grok 的功能开关彼此独立；当前 Grok 原生搜索支持 API Key / API 网关调用，不包含 xAI OAuth / SuperGrok 登录。

## 安装与兼容性

本页说明 **`dsh-lcx-codex@0.4.3-pre.13`**，仅适配 **DSH `0.1.5-alpha.2` / Pi `0.85.1`**。Node.js 要求 `^22.19.0 || >=24.0.0`。稳定版仍为 `0.4.2`；旧版用户请参考[稳定版文档](https://github.com/kk3ya03-star/dsh-lcx-codex/blob/v0.4.2/README.md)。

先确认官方 DSH `0.1.5-alpha.2` Web 能正常启动，并在 DSH 中配置 GPT Responses 或 Grok Responses 路由与凭据。该候选完成发布后，使用以下命令安装：

```sh
dsh plugin --profile web add dsh-lcx-codex@0.4.3-pre.13
dsh web
```

后续预发布更新使用 `dsh plugin --profile web add dsh-lcx-codex@prelatest`。不指定版本或标签会安装稳定版；发布准备期间，`prelatest` 仍可能指向上一预发布版。

本版在官方、未修改的 DSH `0.1.5-alpha.2` 上完成 clean-profile 安装验证，不需要旧版 Windows `fs-ext` 修正，也不要求手动批准额外构建脚本。若旧安装曾修改 DSH 文件，请使用干净的目标版本，不要把旧补丁复制过来。

本版只支持目标 DSH 的 Session V3，不迁移旧 DSH session、旧插件配置或旧格式 checkpoint/replay 数据。升级前备份旧配置与会话，保留旧历史用于离线查阅，并使用新的会话目录。同一目标版本已持久化 session 的重新打开与 v5 checkpoint 恢复属于支持范围。

## 启用

打开 DSH Web 插件设置中的 **Responses / Codex 能力**，按需启用并保存：

| 开关 | 用途 |
| --- | --- |
| 启用 LCX | GPT Responses 生命周期、Native V2 压缩及 GPT 搜索能力。 |
| GPT Hosted Search | GPT 普通联网查询，沿用单一 `web_search` 入口。 |
| 高级 Hosted 工具 | GPT 图片搜索、域名、位置等额外搜索条件。 |
| Alpha | 实验性上游网页操作；连续浏览能力仍有限，见下文。 |
| Grok 原生 Web Search | xAI 服务端网页搜索。 |
| Grok 原生 X Search | xAI 服务端 X 搜索。 |
| 搜索媒体预览 | 在回答内预览可用图片和视频直链，仅影响界面。 |

这些开关默认关闭。GPT 能力受“启用 LCX”控制；Grok Web/X 开关与媒体预览开关独立。模型、推理等级、endpoint、凭据与图片输入能力仍由 DSH 管理。

GPT 使用已启用的 LCX 能力；Grok 开启原生搜索后，会从对应请求中移除 DSH `web_search`，保留 `web_fetch`、`read` 及其他本地/MCP 工具。其他模型保持 DSH 原生路径。切换模型无需重启插件。

## 搜索与媒体

**GPT Hosted Search** 用于普通搜索；需要图片或额外条件时使用 `websearch_gpt_advanced`。例如：“搜索金门大桥的照片，显示一张并附上来源网页。”这是搜索已有图片，不是生成图片，也不表示模型读取了图片像素。

**Grok 原生搜索** 使用 xAI Responses 的 `web_search` / `x_search` 服务端工具，可继续调用本地工具并续聊。支持 API Key / API 网关，不支持 xAI OAuth / SuperGrok 登录。模型正文中的普通链接保留；插件不再自动追加合成 Sources 列表，并过滤已知的上游渲染标记。具体结果仍取决于路由能力。

**搜索媒体预览** 优先使用结构化搜索图片信息，再保守识别回答中的媒体直链。图片提供缩略图和放大查看，视频直链使用原生播放器；普通网页保留为来源链接。加载失败时保留原文和链接，不伪造媒体。此开关不修改模型请求、提示词、工具内容、历史、缓存身份、用量或压缩策略，也不会增加模型/Alpha 调用；显示媒体仍可能访问其原站。

**Alpha** 操作上游搜索服务内容，不控制本机浏览器。接口提供 `search / open / find / click / screenshot` 动作，按路由能力探测启用。搜索和引用冲突保护已有验证，但 opaque 引用的 warm/cold `open/find` 连续操作仍未解决，不能据此承诺完整 `click` 链；可显示的截图交付也未验证。引用不可用或来源冲突时拒绝继续，不猜测引用或用 URL 替换。日常 Hosted 和 Grok 搜索不需要开启 Alpha。

## 长对话、用量与缓存

GPT 启用 LCX 后，普通请求、Native V2 远程压缩和同一路由回放共用请求路径。DSH 继续负责会话保存、工具执行、压缩范围和事务。兼容 GPT 路由通常在上下文达到 90% 时优先远程压缩，达到 95% 时允许紧急工具结果裁剪；也可用 `/compact`。能否压缩取决于历史与上游能力。Grok 继续使用 DSH 自身压缩。

当前 v5 checkpoint 按 session、模型和路由校验；不兼容时只使用可迁移历史，不跨 session 复用 opaque 状态。首次 checkpoint 的部分可恢复失败可回退到 DSH 基础压缩；并非所有失败均回退。重新打开同一已保存 session 的恢复不等于 Codex 进程级 rollout/restart-resume。

GPT 前台与子代理可共享父会话的 prompt-cache identity，但各自历史独立；Grok 每个 session 使用自己的缓存身份与回放状态。支持的路由采用 Pi `0.85.1` 缓存语义：显式模式的 long 为 `30m`，其他支持 long 的路由可使用 `24h`；`none` 不发送 cache key。缓存命中由上游决定，工具列表或历史变化可能重建缓存。

GPT 辅助搜索用量与主调用分开记录，再补充到界面统计，不进入模型正文或主调用上下文压力。Grok 累计计费保持提供方原值；计费与上下文压力的上游接口仍有限，不保证消除所有保守压缩判断。

## 排查与已知限制

- 安装和启动应使用同一 `web` profile，并保存对应功能开关。普通对话成功不代表路由支持 Native V2、Hosted、Alpha 或 Grok 原生搜索。
- 修改主机 profile 的插件启停状态后，请刷新已打开的浏览器页面。DSH 的现有 boot graph 不会仅因 inventory 改变就自动卸载页面内插件；LCX 自有预览关闭和实际 client disposer 清理已验证。
- 本 npm 包不包含或安装独立 DSH pending-inbox 补丁，也不声称修复未修改 DSH Core 的该问题。
- 动态工具变化造成的缓存失效、Grok 累计计费与上下文压力、媒体/用量 UI 的上游接口兼容边界仍需跟踪。DSH 仍处于 alpha；本版不作其他 DSH 版本的兼容承诺。

## 验证与开发

pre.13 的已验收证据包含 **370/370 插件测试、严格 host/client 类型检查、4/4 schema、51/51 生成文件重建一致性**，以及 exact alpha.2 clean-profile 安装、限定范围的 GPT/Grok/search/compaction/reopen/subagent/cancellation 与浏览器媒体验证。它们不代表上述未解决能力已通过，也不代表遍历所有 provider 或网关。

插件由固定 Pi `0.85.1` 的公开导出构建所需 Responses 辅助代码与模型目录，不在用户 profile 中额外安装完整 Pi SDK 依赖树，也不替换 DSH 的 Pi。第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix scripts/runtime-dsh015 --ignore-scripts --no-audit --no-fund
node scripts/link-dsh-runtime.mjs
node --test scripts/release-policy.test.mjs scripts/link-dsh-runtime.test.mjs
node scripts/check-generated.mjs
npm run typecheck
npm test
npm run test:schema
```

见[架构说明](ARCHITECTURE.md)和[更新日志](CHANGELOG.md)。反馈时提供版本和复现步骤，不上传凭据、完整请求或未脱敏 session 日志。

## 许可证

[MIT](LICENSE)。独立社区插件，与 OpenAI、DeepSeek、Sub2API、NewAPI 无隶属或官方背书关系。
