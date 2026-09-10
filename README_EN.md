<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="LCX Codex" width="100%" />

# LCX Codex

**Better long-running GPT and Grok workflows, web search, and continuous work inside DeepSeek Harness.**

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?label=latest)](https://www.npmjs.com/package/dsh-lcx-codex)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--rc.1-16803c)](#installation)
[![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

[简体中文](README.md) · **English** · [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues)

</div>

LCX Codex is a community plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (DSH).

It does not replace DSH or require a second model/provider configuration. Models, credentials, sessions, and tools remain managed by DSH; LCX only adds optional capabilities for GPT and Grok.

## What it adds

| Capability | Best for |
| --- | --- |
| GPT web search | Let GPT search the web through DSH's normal `web_search` entrypoint. |
| GPT advanced search | Image search, domain filters, location, and other additional search controls. |
| Grok native Web / X Search | Use xAI Responses native Web Search and X Search directly. |
| Long-conversation compaction | Let compatible GPT routes compact long sessions remotely and continue working. |
| Search media previews | Preview available images and direct video links below answers. |
| Alpha web actions | Experimental follow-up web reading for tasks that need to open or inspect search results. |

Other models continue through their normal DSH paths.

## Installation

Current stable release: **`dsh-lcx-codex@0.4.3`**

Compatible environment:

- DSH `0.1.5` line starting at `0.1.5-rc.1` (current fully verified baseline: `0.1.5-rc.1`)
- Node.js `^22.19.0 || >=24.0.0`

Install:

```sh
dsh plugin --profile web add dsh-lcx-codex@0.4.3
dsh web
```

For later stable updates:

```sh
dsh plugin --profile web add dsh-lcx-codex@latest
```

Installing without a version or with `@latest` selects the current stable release. Use `@prelatest` only when you want the prerelease channel; `0.4.3-pre.13` remains available as the verified prerelease immediately preceding this stable promotion.

This release installs directly on official DSH `0.1.5-rc.1`; the old Windows `fs-ext` workaround is no longer required.

## Enable features

Open DSH Web plugin settings and find **Responses / Codex capabilities**.

### GPT

For normal GPT use, enable:

1. **Enable LCX**
2. **GPT Hosted Search** when web access is needed

Optional features:

- **Advanced Hosted tool**: for image search, domains, location, and other advanced search controls. It requires GPT Hosted Search.
- **Alpha**: experimental follow-up web actions. It is not needed for ordinary web search.

### Grok

Grok native search is independent of the GPT LCX switch:

- **Grok native Web Search** searches the web.
- **Grok native X Search** searches X.

When Grok native search is enabled, LCX uses xAI's server-side search while keeping page-reading and other DSH / MCP tools available.

### Search media previews

**Search media previews** can be enabled independently. They change presentation only; they do not modify model prompts, search requests, conversation history, or cache behavior.

Images can appear as thumbnails with an enlarged view. Direct video links can be opened in the native player. If media cannot be loaded, the original answer and source link stay intact.

## Examples

Use normal language; you do not need to write tool arguments yourself.

> Search the official Python documentation and explain how `asyncio.TaskGroup` should be used.

> Find a few photos of the Golden Gate Bridge, show one, and include its source page.

> With Grok, search X for recent discussion about this project.

Long tasks do not require you to watch the context window manually. With LCX enabled, compatible GPT routes can automatically compact long conversations and keep working. You can also use `/compact` manually.

## Compatibility and known limits

- The current fully verified baseline for `0.4.3` is DSH `0.1.5-rc.1`. Later releases in the same `0.1.5` line are installable for separate compatibility assessment; `0.1.6` and later are not treated as compatible automatically.
- When upgrading from much older LCX / DSH versions, starting a new session is recommended; old saved compaction state is not guaranteed to remain compatible.
- Grok native search supports API-key / API-gateway routes. xAI OAuth / SuperGrok login is outside the current scope.
- Alpha remains experimental. Search works, but follow-up `open / find` operations can still fail on some routes, and screenshots are not guaranteed to return as displayable images.
- After enabling or disabling the plugin in the DSH profile, an already-open browser page may need to be refreshed.
- API gateways vary in capability. A working normal chat does not guarantee that search, long-conversation compaction, Alpha, or Grok native search is also supported.

## Troubleshooting

**Installed but nothing changed?** Make sure installation and startup use the same `web` profile, then confirm the relevant feature switches were saved.

**Conversation works but search or compaction fails?** Check that the selected GPT / Grok Responses route actually provides the required server-side capability. A gateway product name alone does not guarantee every feature.

When opening an [issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues), include plugin, DSH, and Node.js versions plus reproduction steps. Do not post API keys, full requests, or unredacted session logs.

## More information

- [Changelog](CHANGELOG.md)
- [Architecture](ARCHITECTURE.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

[MIT](LICENSE). Independent community plugin, not affiliated with or endorsed by OpenAI, DeepSeek, Sub2API, or NewAPI.
