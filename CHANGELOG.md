# Changelog

本项目遵循语义化版本。未通过真实验收的能力只记录在Unreleased，不作为已发布功能。

## Unreleased

## 0.3.1 - 2026-08-21

### Fixed

- 删除未被 DSH 官方识别、且错误写死旧域名与 `LCX_API_KEY` 的 `dshhub` 权限块；README 改为声明网络目标和凭据由当前 `openai-responses` provider 动态决定。
- 添加 npm 与 DSH 社区检索使用的标准关键词，其中包括 `dsh-plugin` GitHub topic 对应关键词。
- 新增独立英文用户文档 `README_EN.md`，并与中文 README 互相链接。

## 0.3.0 - 2026-08-21

### Changed

- 收紧 npm/DSH 安装包，只保留运行时代码、Alpha 运维探针、许可证和用户文档；开发测试与 schema 校验脚本继续保留在源码仓库。
- README 和包元数据明确 `LCX` 只是插件名称；支持 Sub2API 反代或 NewAPI 中转的 GPT 模型，不隶属于 OpenAI；Alpha 能力继续按部署 fingerprint 与可信 provenance 分类，不作全局 native 承诺。
- 明确 Alpha 经过 NewAPI 时渠道类型必须为 `Sub2API`，不能使用普通 `OpenAI` 渠道。
- README 改为面向用户的中文文档，提供经 DSH/pnpm 帮助核对的 GitHub URL、Release 包、更新和卸载命令；本地 `link:` 安装明确归入源码开发流程。

### Added

- Hosted Search 完整结构化参数与 citation/source/image 输出。
- 独立 `websearch_alpha`，支持 search、image、open/find/click、PDF screenshot、finance、weather、sports 和 time；capability/ref sidecar 按 route 与 session 隔离。
- Native V2 checkpoint v3、同路由 replay、Sol/Luna portable migration、fork/tree/restart generation lease 与 durable-image migration。

### Fixed

- Hosted Search 与 Alpha Search 现在和 Native V2 Compact 一样，复用 DSH 已添加的 `openai-responses` provider 路由、凭据引用、headers 与 retry policy；不再要求用户为插件重复配置 `LCX_API_KEY`。
- README 将插件运行时凭据与运行在 DSH 外的 Alpha 探针/E2E 测试凭据明确分开。
- README 改为简短的用户手册，以 npm 安装为主；Alpha 提示前置，并按 NewAPI 当前源码区分 4 种中转渠道类型与 Sub2API 直连，共 5 种部署路径。
- Native replay and portable migration no longer depend on the nonexistent `GenerateOptions.branchId`; fork safety uses public session ancestry and derived marker history while preserving existing v3 fingerprint compatibility.
- README 的本地 link 安装示例不再包含开发机绝对路径。
- Alpha 从 rc.8 公共 `session.requestContext()` 读取 active route，避免模型切换后的 capability 误判。
- Alpha 对 HTTP 200 内的函数调用语义错误 fail closed，并修正 sports action 的 wire 字段。
- Responses SSE 去重、usage、工具配对、并发 sidecar、Windows ACL、图片 offload/hydrate 和 remote/local summary 边界。

## 0.2.0

- Hosted Responses query-only Web Search。
- Native Remote Compaction V2，拒绝legacy transport。
- checkpoint v3、同route replay和第一批portable model migration。
- 图片同route attachment hydrate，portable image migration保持fail closed。
- 协议、大小、超时、重试、redirect和日志脱敏基础测试。
