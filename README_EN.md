<div align="center">

<img src="assets/dsh-lcx-codex-banner.svg" alt="DSH GPT & Grok Plus" width="100%" />

<br />

<h1>DSH GPT &amp; Grok Plus</h1>

<p>
  <strong>The full-featured GPT &amp; Grok power-up plugin for <a href="https://github.com/deepseek-ai/DeepSeek-Harness">DeepSeek Harness (DSH)</a></strong><br />
  Native Web &amp; X Search · Lossless Remote Compaction · Search Media Rail · Per-Turn Cache Pill · Gateway Fallback
</p>

<p>
  <a href="https://www.npmjs.com/package/dsh-lcx-codex"><img src="https://img.shields.io/npm/v/dsh-lcx-codex?style=flat-square&label=npm&color=4D6BFE" alt="npm version" /></a>
  <a href="#installation--compatibility"><img src="https://img.shields.io/badge/DSH-0.2.2--rc.5-10B981?style=flat-square" alt="DSH 0.2.2-rc.5" /></a>
  <img src="https://img.shields.io/badge/Node-%3E%3D22.19-6366F1?style=flat-square" alt="Node >= 22.19" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-64748B?style=flat-square" alt="MIT License" /></a>
</p>

<p>
  <a href="README.md">简体中文</a> ·
  <strong>English</strong> ·
  <a href="#highlights">Highlights</a> ·
  <a href="#installation--compatibility">Install</a> ·
  <a href="#configuration-guide">Setup</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

</div>

---

## Why This Plugin?

[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/DeepSeek-Harness) already handles your providers, API keys, local tools, and sessions. When working with **GPT (OpenAI Responses)** and **Grok (xAI Responses)**, however, server-side web/X search, remote long-context compaction, rich search media previews, and per-turn cache metrics aren't included out of the box.

**DSH GPT & Grok Plus** unlocks all of them without duplicating your setup or interfering with DeepSeek and other model routes—**zero extra credentials, zero lock-in, works straight on top of your existing DSH profiles**.

---

## Highlights

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🔍 Native GPT &amp; Grok Web / X Search</h3>
      <ul>
        <li><strong>GPT Hosted Search</strong>: Powers DSH's standard <code>web_search</code> with citations, plus an optional advanced tool for image search, domain filters, and regional context.</li>
        <li><strong>Grok Native Web &amp; X Search</strong>: Uses xAI's server-side Web Search and X Search while keeping all local filesystem, shell, and MCP tools active.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>♾️ Lossless Long-Session Compaction</h3>
      <ul>
        <li><strong>Native V2 Remote Compaction</strong>: Automatically compacts long GPT sessions on the provider side near the context limit so deep coding tasks keep going seamlessly.</li>
        <li><strong>Cache-Safe Incremental Tools</strong>: Adding tools mid-session preserves your prompt cache prefix; trigger <code>/compact</code> manually anytime.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🖼️ Rich Media Rail &amp; Cache Hit Pill</h3>
      <ul>
        <li><strong>Inline Media Previews</strong>: Renders search images in a clean horizontal gallery (with lightbox zoom) and direct video links as click-to-play cards.</li>
        <li><strong>Per-Turn Cache Visibility</strong>: Displays a compact read-only <code>Cache XX%</code> pill at the turn tail whenever cached token counts are reported.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>🛡️ Zero-Friction Setup &amp; Relay Compatibility</h3>
      <ul>
        <li><strong>Reuses Your Existing DSH Profiles</strong>: Full support for GPT-6.2 and Grok 4.6/4.7 routes using the models and keys you already configured.</li>
        <li><strong>Gateway Compatibility Fallback</strong>: One-click toggle to fall back to standard top-level <code>tools</code> &amp; <code>reasoning.effort</code> for third-party API relays.</li>
      </ul>
    </td>
  </tr>
</table>

---

## Installation & Compatibility

Install the latest stable release (`v0.7.0`) in two commands:

```bash
dsh plugin --profile web add dsh-lcx-codex@latest
dsh web
```

> [!TIP]
> **Package ID note:** The underlying npm package remains `dsh-lcx-codex` so existing installations keep upgrading seamlessly via `@latest` and automated OIDC provenance publishing stays uninterrupted.

Pick the matching version for your local **DSH** line (requires Node.js `^22.19.0 || >=24.0.0`):

| DSH Version | Install Command | Notes |
| :--- | :--- | :--- |
| **DSH `0.2.2`** *(recommended, baseline `0.2.2-rc.5`)* | `dsh plugin --profile web add dsh-lcx-codex@latest` | **`v0.7.0` (latest stable)** · Pi `1.6.0`, cache hit pill, gateway fallback |
| DSH `0.2.1` *(baseline `0.2.1-rc.5`)* | `dsh plugin --profile web add dsh-lcx-codex@0.6.0` | Previous stable release `v0.6.0` |
| DSH `0.2.0` *(baseline `0.2.0-rc.2`)* | `dsh plugin --profile web add dsh-lcx-codex@0.5.2` | Legacy stable release `v0.5.2` |
| DSH `0.1.5` *(baseline `0.1.5-rc.1`)* | `dsh plugin --profile web add dsh-lcx-codex@0.4.3` | Legacy pin `v0.4.3` |

---

## Configuration Guide

Open DSH Web → **Plugins** in the left sidebar → open the plugin detail view → expand **Responses / Codex capabilities**:

<div align="center">
  <img src="assets/settings-card.png" alt="DSH GPT & Grok Plus plugin settings panel" width="700" />
  <br />
  <sub>Enable exactly what you need inside DSH Web's plugin settings panel</sub>
</div>

<br />

| Workflow | Recommended Switches | Notes |
| :--- | :--- | :--- |
| **Everyday GPT Usage** | **Enable LCX** + **GPT Hosted Search** + **Incremental tool updates** + **Search media previews** | Add **Advanced Hosted tool** when you want image search or domain filters |
| **Grok Native Search** | **Grok native Web Search** / **Grok native X Search** | Independent of the GPT switch; toggle either or both freely |
| **Third-Party API Relays** | Also enable **Gateway compatibility fallback (standard tools / reasoning.effort)** | Keep **off** on official/compliant endpoints; turn **on** only if a relay rejects `additional_tools` or `configuration_update` |

---

## Everyday Examples

No special syntax needed—just chat naturally:

> **Search Official Docs**  
> *"Search the Python 3.13 docs for `asyncio.TaskGroup` exception handling caveats and include official source links."*

> **Visual Image Search**  
> *"Find a few high-resolution autumn photos of Mount Fuji, show them below, and link the source pages."*

> **Live X Search with Grok**  
> *"Use Grok to search X for recent community discussion and feedback about this project."*

---

## FAQ

<details>
<summary><strong>1. Installed the plugin, but nothing changed?</strong></summary>

Make sure `dsh plugin add` and `dsh web` target the **same profile** (e.g., `--profile web`), confirm the plugin toggle and feature switches are **saved**, and refresh any already-open browser tab.

</details>

<details>
<summary><strong>2. Switching to Grok fails with <code>MODEL_SWITCH_COMPACTION_FAILED</code>?</strong></summary>

DSH `0.2.2` blocks switching to a model whose `maxTokens >= contextWindow`. In your `llm-pi-ai` Grok provider config, set `maxTokens` clearly below `contextWindow` (e.g., `64000` or `128000` on a `500000` context window).

</details>

<details>
<summary><strong>3. Third-party gateway drops tools or rejects <code>additional_tools</code> / <code>configuration_update</code>?</strong></summary>

Some third-party relays don't yet support OpenAI's newer incremental wire items. Enable **Gateway compatibility fallback (standard tools / reasoning.effort)** in plugin settings, save, and retry on a clean turn.

</details>

<details>
<summary><strong>4. What are the limits of Grok search and Alpha web actions?</strong></summary>

- **Grok Native Search**: Supports API-key and compatible gateway routes; xAI browser OAuth / SuperGrok logins are out of scope.
- **Alpha Web Actions**: Experimental follow-up page inspection; standard **GPT Hosted Search** is recommended for everyday web queries.

</details>

Found a bug? Open an [issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues) with your **plugin, DSH, and Node.js versions plus reproduction steps** (never include API keys or unredacted request logs).

---

<div align="center">

[Changelog](CHANGELOG.md) · [Architecture](ARCHITECTURE.md) · [Third-party notices](THIRD_PARTY_NOTICES.md) · [MIT License](LICENSE)

<sub>Independent community plugin — not affiliated with or endorsed by OpenAI, xAI, or DeepSeek.</sub>

</div>
