<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="LCX Codex" width="100%" />

# LCX Codex

**Native compaction, hosted search, and stateful web actions for GPT conversations in DeepSeek Harness.**

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?label=npm)](https://www.npmjs.com/package/dsh-lcx-codex)
[![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-16803c)](#compatibility-and-limitations)
[![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

[简体中文](README.md) · **English** · [Releases](https://github.com/kk3ya03-star/dsh-lcx-codex/releases) · [Report an issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues)

</div>

LCX Codex (`dsh-lcx-codex`) is a community plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (DSH). It adds long-conversation and search capabilities to an existing **GPT / OpenAI Responses route**, including compatible routes through Sub2API or NewAPI.

You continue selecting models, managing sessions, and using tools in DSH. With LCX enabled, ordinary turns, tool calls, compaction, and post-compaction continuation use one Responses request path.

## What it adds

| When you need to | LCX provides |
| --- | --- |
| **Continue a long conversation** | Prefer upstream Native V2 compaction as the context limit approaches, with post-compaction continuation and restart recovery. |
| **Look up information on the web** | Use GPT Hosted Search through DSH's existing `web_search` tool, following the active Agent's GPT model. |
| **Control your search more precisely** | Optionally use domain filters, location, search context size, image search, and other Hosted Search parameters. |
| **Browse across multiple steps** | Use the Alpha tool on supported routes for successive search, open, find, click, and other actions. |
| **Reuse prompt caches** | Maintain a stable cache identity on supported GPT-5.6 routes so an unchanged request prefix can be reused. |

> LCX targets GPT / OpenAI Responses. Each extension depends on upstream support. A working conversation does not establish support for native compaction, Hosted Search, or Alpha web actions.

## Quick start

### 1. Check your environment

- DSH **`0.1.1-rc.2`** with a working Web interface.
- Node.js **22.x starting at 22.19.0, or version 24.0.0 and later**.
- A working **GPT Responses endpoint, model, and credentials** configured in DSH.

### 2. Install the plugin

Run these commands in the environment where DSH is installed:

```sh
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

The plugin is installed from npm. No repository clone or manual source download is needed. This README covers **`0.4.2`**; see [npm](https://www.npmjs.com/package/dsh-lcx-codex) for published versions or read the [v0.4.2 release notes](https://github.com/kk3ya03-star/dsh-lcx-codex/releases/tag/v0.4.2).

### 3. Enable LCX and save

1. Open the plugin settings in DSH Web and expand **Responses / Codex capabilities**.
2. Select **Enable LCX (own current GPT Responses conversation)**.
3. For web search, also select **Use GPT Hosted Search as DSH web_search backend**.
4. Keep the default compaction settings, click **Save**, and start a conversation with your configured GPT model.

**LCX and hosted search are off by default and must be enabled after installation.** Enable advanced search and Alpha when you need them.

Before switching to Claude, Gemini, DeepSeek, or another non-GPT model, turn LCX off and save. Model switching itself does not require restarting DSH.

## Continuing long conversations

LCX uses upstream **Native V2 compaction** to handle long contexts, then stores the result in the DSH session for subsequent requests to reuse (Replay). DSH still controls compaction timing, session persistence, and tool execution.

The default Native-first automatic compaction policy is:

| Context pressure | Behavior |
| --- | --- |
| Below `90%` | Continue normally and avoid early tool-result pruning. |
| At least `90%`, below `95%` | Prefer Native V2 compaction. |
| At least `95%` | Allow DSH emergency tool-result pruning and continue its compaction workflow. |

Manual `/compact` still runs through DSH's compaction transaction. Eligible recoverable failures while creating the first compaction checkpoint can fall back to DSH basic compaction. Fallback does not apply to every Native failure.

Native state is reused only within a compatible session and route. When switching to an incompatible GPT model or route, LCX continues with portable conversation history.

## Choosing search tools

Start with `web_search` for everyday queries. The three tools serve different needs:

| Tool | Purpose | Requirements |
| --- | --- | --- |
| `web_search` | Everyday web lookup through DSH's existing search entry point. | Enable LCX and GPT Hosted Search. |
| `websearch_gpt_advanced` | Extra controls for domains, location, search context size, image search, and more. | Also enable the advanced Hosted tool. |
| `websearch_alpha` | Stateful `search / open / find / click / screenshot` and other actions. | Enable Alpha and pass the capability probe for the active route. |

Alpha is off by default. Even with its switch enabled, the tool is registered only after the active route passes its capability probe.

## What to expect from caching

On supported GPT-5.6 routes, LCX uses `prompt_cache_options` and maintains a stable cache identity. Consecutive turns and tool tasks can reuse prompt caches when their request prefixes stay unchanged; actual cache hits depend on the upstream provider.

Native compaction changes conversation history. Loading skills or plugins at runtime, or toggling features that change the tool list, can also require the cache to warm again. Reuse can resume once the new request prefix stabilizes.

## Settings

| Setting | Default | Recommendation |
| --- | --- | --- |
| Enable LCX | Off | Enable for GPT Responses conversations. |
| GPT Hosted Search | Off | Enable when you need web search. |
| Advanced Hosted tool | Off | Enable for additional search parameters. |
| Alpha command | Off | Enable as needed on a supported route. |
| Native-first automatic compaction | On | Keep the default; LCX must also be enabled. |
| Native auto-compaction threshold | `90%` | Keep the default. |
| DSH emergency prune threshold | `95%` | Must exceed the Native threshold. |
| Fall back to DSH basic compaction on Native failure | On | Keep fallback available for eligible failures. |
| `web_search` timeout | `240` seconds | Adjust if search needs more time. |

## Common questions

**Nothing changed after installation?**

Check that the plugin was installed into the `web` profile used to launch DSH Web, then confirm LCX is enabled and saved. Hosted search has a separate switch.

**Conversations work, but search or compaction fails?**

Check that the active route supports the requested capability and that its model and credentials are available. Sub2API and NewAPI deployments do not necessarily expose the same capabilities across all routes.

**Do I need to download a package manually?**

Use the DSH commands above for a normal installation. To retain a published archive, download the [v0.4.2 npm package (.tgz)](https://registry.npmjs.org/dsh-lcx-codex/-/dsh-lcx-codex-0.4.2.tgz). GitHub's **Code → Download ZIP** provides source code and does not replace plugin installation.

## Compatibility and limitations

| Component | Version for `0.4.2` |
| --- | --- |
| DSH | `0.1.1-rc.2` |
| DSH host Pi | `0.82.1` |
| Plugin Pi | `0.84.3` |
| Node.js | `^22.19.0 \|\| >=24.0.0` |

The plugin uses its own `@earendil-works/pi-ai@0.84.3` dependency without overriding DSH's Pi version.

- DSH `0.1.2-alpha.1` is not part of this release's formal compatibility target.
- 1.05M context and Programmatic Tool Calling are not advertised as supported.
- Explicit `prompt_cache_breakpoint` controls are not exposed.
- Availability of `reasoning.context` and `reasoning.mode` depends on whether DSH / Pi exposes those fields.

## Development and feedback

Install dependencies and run the checks from the repository:

```sh
npm install --ignore-scripts
npm run typecheck
npm test
npm run test:schema
npm pack --ignore-scripts
```

See the [architecture notes](ARCHITECTURE.md) for request lifecycles, checkpoints, and Replay implementation, and the [changelog](CHANGELOG.md) for version history.

To [report an issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues), include your plugin, DSH, and Node.js versions, route type, reproduction steps, and redacted error details.

## License

[MIT](LICENSE). This is an independent community plugin and is not affiliated with or endorsed by OpenAI, DeepSeek, Sub2API, or NewAPI. The DeepSeek name and whale mark belong to their respective rights holder.
