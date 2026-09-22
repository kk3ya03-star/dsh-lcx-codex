<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="LCX Codex" width="100%" />

# LCX Codex

**Web search and automatic long-conversation compaction for GPT and Grok in DeepSeek Harness.**

[![npm latest](https://img.shields.io/npm/v/dsh-lcx-codex/latest?label=latest)](https://www.npmjs.com/package/dsh-lcx-codex)
[![npm prelatest](https://img.shields.io/npm/v/dsh-lcx-codex/prelatest?label=prelatest&color=orange)](https://www.npmjs.com/package/dsh-lcx-codex?activeTab=versions)
[![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

[简体中文](README.md) · **English** · [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues)

</div>

LCX Codex is a community plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (DSH). Once installed, GPT and Grok in DSH can:

- **Search the web** — GPT uses Responses server-side search (Hosted Search); Grok uses xAI's native Web Search and X Search.
- **Keep long tasks going** — conversations are compacted automatically near the context limit, so you don't have to start over.
- **Show images and videos from search results** — previewed below the answer; click to enlarge or play.

Models, API keys, sessions and other tools stay managed by DSH — there is nothing extra to configure. Other models (such as DeepSeek) keep using DSH's own behavior.

## Requirements

- DSH with a **GPT or Grok Responses API route** configured (official API or a compatible gateway).
- Node.js `^22.19.0` or `>=24.0.0`.

> Search and compaction rely on server-side capabilities. A gateway that chats fine may still not support them — see [Known limitations](#known-limitations).

## Installation

### 1. Pick the plugin version for your DSH version

Run `dsh --version`, then use this table:

| Your DSH version | LCX version | Tag to install |
| --- | --- | --- |
| `0.1.6` line (`0.1.6-alpha.2` and later) | `0.4.4-pre.1` (prerelease) | `@prelatest` |
| `0.1.5` line (`0.1.5-rc.1` and later) | `0.4.3` (stable) | `@latest` |

Stick to this table: `0.4.3` does not support DSH `0.1.6`, and `0.4.4-pre.1` does not support DSH `0.1.5`. A mismatched install may only print dependency warnings, but the plugin may not work properly.

### 2. Install and start

DSH `0.1.6` line:

```sh
dsh plugin --profile web add dsh-lcx-codex@prelatest
dsh web
```

DSH `0.1.5` line:

```sh
dsh plugin --profile web add dsh-lcx-codex@latest
dsh web
```

To update later, run the same `add` command again.

### 3. Turn features on

In DSH Web, open the Plugins page, find the LCX configuration card **Responses / Codex capabilities**, turn on what you need, then click **Save**.

**GPT**

| Switch | What it does | Suggested |
| --- | --- | --- |
| **Enable LCX** | Master switch for GPT features, including automatic compaction | On when using GPT |
| **Use GPT Hosted Search as DSH web_search backend** | GPT web search | On when you need the web |
| **Enable advanced Hosted tool** | Image search, domain filters, location, etc. (requires the previous switch) | As needed |
| **Enable Alpha command** | Experimental: lets GPT open and search inside result pages | Not needed day to day |

**Grok native search** (independent of "Enable LCX")

| Switch | What it does |
| --- | --- |
| **Enable native Web Search** | Grok searches the web |
| **Enable native X Search** | Grok searches X |

With either one on, Grok uses xAI's native search; page reading and other DSH / MCP tools keep working.

**Display**

| Switch | What it does |
| --- | --- |
| **Search media previews** | Shows images and videos from search results below the answer; click to enlarge or play. Display only — never changes what is sent to the model |

## Usage

Just talk to the model as usual — no tool parameters needed:

> Search the Python docs and tell me how to use `asyncio.TaskGroup`.

> Find a few photos of the Golden Gate Bridge, show one, and include the source page.

> Use Grok to check recent discussion about this project on X.

Long conversations compact automatically near the limit; you can also type `/compact` at any time.

## Upgrading

- **Moving DSH from `0.1.5` to `0.1.6`**: switch the plugin to `@prelatest` (`0.4.4-pre.1`). `0.4.3` does not support DSH `0.1.6`.
- **Start a new session after upgrading**: compaction state saved by older versions is not guaranteed to be compatible.

## Disabling and uninstalling

- **Disable temporarily**: turn off **Enable LCX** and the Grok native search switches in the configuration card and save; GPT and Grok go back to DSH's native behavior.
- **Uninstall**:

  ```sh
  dsh plugin --profile web remove dsh-lcx-codex
  ```

## Known limitations

- **Gateway support varies**: search, compaction and Alpha all depend on server-side features that differ between gateways.
- **Grok**: API-key / API-gateway routes are supported; xAI OAuth / SuperGrok login is not. In `0.4.4-pre.1`, native X Search has only been verified on `grok-4.6`.
- **Alpha is experimental**: search works, but follow-up open/find actions can fail on some routes, and screenshots may not display.
- **DSH `0.1.5` + LCX `0.4.3`**: after enabling or disabling LCX in plugin settings, open browser tabs may need a refresh.
- **Verification scope**: `0.4.4-pre.1` is fully verified on DSH `0.1.6-alpha.2`; `0.4.3` on DSH `0.1.5-rc.1`. Later versions in the same line can be installed but are not individually verified — please report problems.

## Troubleshooting

**Nothing changed after installing?**
Make sure you installed and started with the same profile (`web` in the examples above) and that your switches are saved.

**Chat works, but search or compaction fails?**
Most likely the current GPT / Grok route does not provide that server-side capability. Try the official API or another gateway to compare.

**Dependency warnings during install, or the plugin fails to load?**
Usually your DSH and plugin versions don't match — pick again using [the table above](#1-pick-the-plugin-version-for-your-dsh-version).

## Reporting issues

Please include in your [issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues): plugin version, DSH version, Node.js version, model/gateway type, and steps to reproduce.

**Do not upload API keys, full request bodies, or unredacted session logs.**

## More

- [Changelog](CHANGELOG.md)
- [Architecture](ARCHITECTURE.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

[MIT](LICENSE). An independent community plugin, not affiliated with or endorsed by OpenAI, xAI, DeepSeek, Sub2API or NewAPI.
