<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="LCX Codex" width="100%" />

# LCX Codex

**Remote native compaction, web search, and image search for GPT conversations in DeepSeek Harness.**

[![npm prerelease](https://img.shields.io/npm/v/dsh-lcx-codex/prelatest?label=prelatest)](https://www.npmjs.com/package/dsh-lcx-codex)
[![DSH](https://img.shields.io/badge/DSH-0.1.3--alpha.2-16803c)](#installation)
[![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

[简体中文](README.md) · **English** · [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues)

</div>

LCX Codex is a community plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (DSH). It connects GPT remote compaction and search to DSH, so long conversations can continue after compaction and replies can display images found on the web.

DSH still manages models, endpoints, credentials, sessions, and tools. There is no second provider configuration in the plugin. LCX targets **GPT / OpenAI Responses**, including Sub2API and NewAPI routes that support the requested capabilities.

## Installation

This page covers **`0.4.3-pre.2`, a prerelease for DSH `0.1.3-alpha.2`**. Stable remains `0.4.2`; users of DSH `0.1.1-rc.2` should follow the [stable instructions](https://github.com/kk3ya03-star/dsh-lcx-codex/blob/v0.4.2/README_EN.md).

Before installing, make sure DSH Web starts and your configured GPT Responses model can hold a conversation. Node.js must satisfy `^22.19.0 || >=24.0.0`. For Windows startup errors mentioning `fs-ext`, see [Troubleshooting](#troubleshooting) below.

```sh
dsh plugin --profile web add dsh-lcx-codex@0.4.3-pre.2
dsh web
```

To upgrade to future prereleases, run `dsh plugin --profile web add dsh-lcx-codex@prelatest`. Installing without a version or tag selects stable, **not the version described here**.

**Upgrading from `0.4.2`:** old plugin configuration and v3/v4 compaction checkpoints are unsupported. Reconfigure the plugin and start a new session. Current v5 checkpoints still support restart/resume.

## Enable the Plugin

In DSH Web plugin settings, expand **Responses / Codex capabilities**, enable the features you need, and save:

| Switch | Enable it when |
| --- | --- |
| Enable LCX | You want GPT remote native compaction or the search features below. |
| GPT Hosted Search | You want DSH to search the web. |
| Advanced Hosted tool | You want image search, site filters, or other search controls. |
| Alpha | You want successive open, find, and click actions on web content. Experimental. |

**All four switches are off by default.** Enable the first two for everyday web search, and the third for image search. Configure models, reasoning levels, and image-input capabilities in DSH's model settings.

Turn LCX off before switching to Claude, Gemini, DeepSeek, or another non-GPT model. Disabling LCX restores DSH's native request path.

## Web and Image Search

### Look Up Information

Ask directly in the conversation:

> Find the latest Node.js LTS version and link to the official source.

Ordinary queries use DSH's existing `web_search`. For more specific conditions, the model can use `websearch_gpt_advanced`:

> Search only the official Python documentation for asyncio.TaskGroup usage.

### Find and Display Images

With the advanced Hosted tool enabled, ask:

> Search for photos of the Golden Gate Bridge, display one in your reply, and link to its source page.

**You do not need to write JSON parameters.** The model selects image-search parameters. If it returns only text, ask it to use advanced Hosted image search and display the image explicitly.

The search tool provides image links and sources; DSH displays them using its existing Markdown renderer. This **finds existing images, rather than generating images**, and does not establish that the model received image pixels. Display also depends on the source URL remaining accessible.

### Alpha Web Actions

`websearch_alpha` supports actions such as `search / open / find / click / screenshot` for successive web lookups. It acts on **web content in the upstream search service**, not your local browser or DSH interface.

Alpha requires its own switch and a successful capability probe before the tool appears. References can still fail intermittently, and `screenshot` has not been verified to return displayable images. **Everyday web and image search do not require Alpha.**

## Long Conversations and Compaction

With LCX enabled, the plugin sends DSH's compaction request to the upstream GPT route for **Native V2 remote compaction**, then feeds the result back into the current session. DSH still owns persistence, tool execution, and the compaction transaction.

| Context usage | Behavior |
| --- | --- |
| Below `90%` | Continue normally without early tool-result pruning. |
| `90%` to below `95%` | Prefer remote native compaction. |
| At least `95%` | Allow DSH emergency tool-result pruning, then follow its compaction workflow. |

Use `/compact` for manual compaction. These thresholds are fixed policy, not additional settings. Compaction requires an eligible history range and upstream support.

You can continue after compaction, restart the session, or switch GPT models. For incompatible model or route configurations, LCX uses portable history instead of forcing native-state reuse. Some recoverable failures while creating the first checkpoint can fall back to DSH basic compaction; not every failure qualifies.

## Caching

The upstream service provides the cache; LCX maintains compatible cache identifiers. Matching request prefixes can be reused, but **cache hits and retention depend on the provider**. There is no separate plugin-cache switch to enable.

LCX follows Pi `0.85.1` cache semantics, using the `30m` long-retention parameter on routes that support explicit cache mode. Compaction, model switching, and tool-list changes may require the cache to warm again. Subagents can also hit shared-prefix caches, but a cache hit does not mean they inherited the parent's private conversation.

## Troubleshooting

**DSH fails to start on Windows with an `fs-ext` error?**

DSH `0.1.3-alpha.2` loads `fs-ext` during startup even though Windows does not use it. If its native module is unavailable, DSH exits before startup completes. This is **a DSH dependency-loading problem, not broken plugin compaction or a broken session lock**.

Windows tests for this release used a minimal DSH correction: load `fs-ext` only on non-Windows platforms, retaining the existing Win32 session lock. The plugin does not patch DSH automatically, and unmodified Windows startup is not guaranteed. Do not disable session locking to work around this error.

**Nothing changes after installation?**

Check that installation and startup use the same `web` profile, and that LCX is enabled and saved. Web search and advanced image search have separate switches.

**Conversation works, but search or compaction fails?**

A working Responses route does not establish support for Native V2, Hosted Search, or Alpha. Check that the selected route offers the capability. The Sub2API or NewAPI name alone is not a guarantee.

## Versions and Test Coverage

This release uses DSH `0.1.3-alpha.2`, host Pi `0.85.1`, and plugin Pi `0.85.1`. The plugin declares its own Pi dependency without replacing DSH's dependency.

Live tests cover long conversations, post-compaction continuation and restart, model switching after compaction, PNG/TXT attachments, search and image display, two-session concurrency, and foreground subagent caches. The Alpha limitations above remain; proxy behavior, higher concurrency and cancellation interleaving, background continuable subagents, and other attachment formats are not fully tested. See the [v0.4.3-pre.2 release notes](https://github.com/kk3ya03-star/dsh-lcx-codex/releases/tag/v0.4.3-pre.2) for details.

## Development and Feedback

```sh
npm ci --ignore-scripts
npm ci --prefix scripts/runtime-alpha2 --ignore-scripts
node scripts/link-dsh-runtime.mjs scripts/runtime-alpha2
node scripts/check-generated.mjs
npm run typecheck
npm test
npm run test:schema
```

See [Architecture](ARCHITECTURE.md) for implementation details. When opening an [issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues), include plugin, DSH, and Node.js versions and reproduction steps. Do not upload API keys, full requests, or unredacted session logs.

## License

[MIT](LICENSE). Independent community plugin, not affiliated with or endorsed by OpenAI, DeepSeek, Sub2API, or NewAPI. The DeepSeek name and mark belong to their respective rights holder.
