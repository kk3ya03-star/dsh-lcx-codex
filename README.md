<div align="center">

<img src="assets/dsh-lcx-codex-banner.svg" alt="DSH GPT & Grok Plus" width="100%" />

<br />

<h1>DSH GPT &amp; Grok Plus</h1>

<p>
  <strong>专为 <a href="https://github.com/deepseek-ai/DeepSeek-Harness">DeepSeek Harness (DSH)</a> 打造的 GPT &amp; Grok 全能力增强插件</strong><br />
  原生联网与 X 搜索 · 超长对话无损压缩 · 搜索图文视频墙 · 单轮缓存命中率 · 第三方网关兼容回退
</p>

<p>
  <a href="https://www.npmjs.com/package/dsh-lcx-codex"><img src="https://img.shields.io/npm/v/dsh-lcx-codex?style=flat-square&label=npm&color=4D6BFE" alt="npm version" /></a>
  <a href="#安装与版本对照"><img src="https://img.shields.io/badge/DSH-0.2.2--rc.5-10B981?style=flat-square" alt="DSH 0.2.2-rc.5" /></a>
  <img src="https://img.shields.io/badge/Node-%3E%3D22.19-6366F1?style=flat-square" alt="Node >= 22.19" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-64748B?style=flat-square" alt="MIT License" /></a>
</p>

<p>
  <strong>简体中文</strong> ·
  <a href="README_EN.md">English</a> ·
  <a href="#核心亮点">核心亮点</a> ·
  <a href="#安装与版本对照">快速安装</a> ·
  <a href="#界面配置指南">配置指南</a> ·
  <a href="#常见问题">常见问题</a> ·
  <a href="CHANGELOG.md">更新日志</a>
</p>

</div>

---

## 为什么需要它？

[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/DeepSeek-Harness) 本身已经管好了你的模型、密钥、本地工具与会话历史；但在使用 **GPT（OpenAI Responses）** 和 **Grok（xAI Responses）** 时，默认缺少服务端联网搜索、超长上下文远端压缩、搜索富媒体展示与单轮缓存命中统计。

**DSH GPT & Grok Plus** 在不改动你任何原有 DSH 配置的前提下，直接补齐这些能力——**不接管 DeepSeek 等其他模型、无需重复填 API Key、装上即用**。

---

## 核心亮点

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🔍 GPT &amp; Grok 原生联网与 X 搜索</h3>
      <ul>
        <li><strong>GPT Hosted Search</strong>：接管 DSH 标准 <code>web_search</code>，自带权威引用来源；可选高级工具支持图搜、域名过滤与地区定位。</li>
        <li><strong>Grok 原生 Web / X Search</strong>：直连 xAI 服务端网页与 X 实时检索，同时完整保留本地读文件、终端和 MCP 工具。</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>♾️ 超长对话远端无损压缩</h3>
      <ul>
        <li><strong>Native V2 远端压缩</strong>：连续代码重构或长研究任务逼近窗口上限时，自动在服务端压缩上下文并无缝续跑。</li>
        <li><strong>增量工具前缀护航</strong>：会话中途开启新工具不破坏 Prompt Cache 前缀，也可随时 <code>/compact</code> 手动压缩。</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🖼️ 搜索图文墙 &amp; 缓存命中胶囊</h3>
      <ul>
        <li><strong>媒体预览区</strong>：搜索返回的图片自动排成自然比例横向画廊（点击灯箱放大），视频直链生成可点击行内播放卡片。</li>
        <li><strong>单轮缓存命中率</strong>：上游返回缓存计数时，在每轮回答底部显示简洁只读的 <code>缓存命中 XX%</code> 胶囊。</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>🛡️ 零侵入复用 &amp; 第三方网关适配</h3>
      <ul>
        <li><strong>完全复用 DSH 配置</strong>：直接沿用你配好的模型、Key 与工作区，对 GPT-6.2 / Grok 4.6-4.7 开箱支持。</li>
        <li><strong>网关兼容回退开关</strong>：遇到不支持 <code>additional_tools</code> 或 <code>configuration_update</code> 的第三方中转站，一键回退标准格式。</li>
      </ul>
    </td>
  </tr>
</table>

---

## 安装与版本对照

运行下面两条命令即可安装最新稳定版（`v0.7.0`）：

```bash
dsh plugin --profile web add dsh-lcx-codex@latest
dsh web
```

> [!TIP]
> **关于安装名**：为保证老用户直接通过 `@latest` 无感升级且不中断 npm 自动发布，底层 npm 包名继续沿用 `dsh-lcx-codex`。安装完成后，在 DSH Web 左侧 **插件** 页面中开启即可。

请按你本地运行的 **DSH 版本** 选择对应版本（要求 Node.js `^22.19.0 || >=24.0.0`）：

| DSH 版本 | 安装命令 | 适用说明 |
| :--- | :--- | :--- |
| **DSH `0.2.2`** *(推荐，基线 `0.2.2-rc.5`)* | `dsh plugin --profile web add dsh-lcx-codex@latest` | **`v0.7.0`（最新稳定版）** · Pi `1.6.0`、缓存命中胶囊、网关兼容回退 |
| DSH `0.2.1` *(基线 `0.2.1-rc.5`)* | `dsh plugin --profile web add dsh-lcx-codex@0.6.0` | 历史稳定版 `v0.6.0` |
| DSH `0.2.0` *(基线 `0.2.0-rc.2`)* | `dsh plugin --profile web add dsh-lcx-codex@0.5.2` | 历史稳定版 `v0.5.2` |
| DSH `0.1.5` *(基线 `0.1.5-rc.1`)* | `dsh plugin --profile web add dsh-lcx-codex@0.4.3` | 历史固定版 `v0.4.3` |

---

## 界面配置指南

打开 DSH Web → 左侧边栏 **「插件」** → 进入插件详情 → 展开 **「Responses / Codex 能力」**：

<div align="center">
  <img src="assets/settings-card.png" alt="DSH GPT & Grok Plus 插件设置面板" width="700" />
  <br />
  <sub>在 DSH Web 插件详情页一键按需开关各项增强能力（推荐默认配置示意）</sub>
</div>

<br />

| 使用场景 | 推荐勾选的开关 | 说明 |
| :--- | :--- | :--- |
| **日常 GPT 主力对话** | **启用 LCX** + **GPT Hosted Search** + **增量工具更新** + **搜索媒体预览** | 开启联网、长对话压缩与图文预览；需要图搜/域名过滤再加开 **高级 Hosted 工具** |
| **Grok 实时搜索** | **启用原生 Web Search** / **启用原生 X Search** | 与 GPT 开关完全独立，可单独启用 |
| **第三方 OpenAI 中转站** | 额外勾选 **网关兼容回退（标准 tools / reasoning.effort）** | 官方 / 完整兼容 Responses 渠道保持关闭即可；中转站报格式错或丢工具时再开启 |

---

## 上手示例

配置保存后直接用自然语言提问，无需记任何工具名或参数：

> **联网查官方文档**  
> *"帮我查一下 Python 3.13 里 `asyncio.TaskGroup` 的异常处理要点，并附上官方文档链接。"*

> **找图并自动展示画廊**  
> *"搜几张秋天的富士山高清实拍图展示在下面，同时给出来源页面。"*

> **用 Grok 追踪 X 实时讨论**  
> *"用 Grok 在 X 上搜一下大家最近对这个项目的评价和常见反馈。"*

---

## 常见问题

<details>
<summary><strong>1. 装完插件后好像没有任何变化？</strong></summary>

请确认安装与启动使用了**同一个 profile**（例如都是 `--profile web`），在插件设置卡片里已打开总开关与对应功能并点击了 **保存**；如果浏览器标签页此前已打开，请手动刷新一次页面。

</details>

<details>
<summary><strong>2. 切换到 Grok 时报错 <code>MODEL_SWITCH_COMPACTION_FAILED</code>？</strong></summary>

DSH `0.2.2` 会拦截 `maxTokens >= contextWindow` 的模型配置。请在你的 `llm-pi-ai` Grok 提供商配置里，把 `maxTokens` 调到明显小于 `contextWindow`（例如上下文窗口为 `500000` 时，将 `maxTokens` 设为 `64000` 或 `128000`）。

</details>

<details>
<summary><strong>3. 第三方中转站跑 GPT-6 时丢工具，或报 <code>additional_tools</code> / <code>configuration_update</code> 错误？</strong></summary>

部分第三方网关尚未兼容 OpenAI 新版增量请求体。请在插件设置里勾选 **「网关兼容回退（标准 tools / reasoning.effort）」**，点击保存后在新一轮对话重试即可。

</details>

<details>
<summary><strong>4. Grok 原生搜索和 Alpha 网页深读有什么使用限制？</strong></summary>

- **Grok 原生搜索**：支持 API Key 与兼容的 API 网关；xAI 浏览器 OAuth / SuperGrok 账号登录暂不支持。
- **Alpha 网页深读**：属于实验性功能，普通联网查资料用标准 **GPT Hosted Search** 即可，不必强开。

</details>

遇到其他问题欢迎提交 [GitHub Issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues)，附上 **插件版本、DSH 版本、Node.js 版本与复现步骤** 即可（请勿粘贴 API Key 或完整原始日志）。

---

<div align="center">

[更新日志](CHANGELOG.md) · [技术架构](ARCHITECTURE.md) · [第三方声明](THIRD_PARTY_NOTICES.md) · [MIT License](LICENSE)

<sub>独立开源社区插件，与 OpenAI、xAI、DeepSeek 无隶属或背书关系。</sub>

</div>
