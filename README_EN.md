<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="LCX Codex" width="100%" />

# LCX Codex

**Better long-running GPT and Grok workflows, web search, and continuous work inside DeepSeek Harness.**

[![npm latest](https://img.shields.io/npm/v/dsh-lcx-codex/latest?label=latest)](https://www.npmjs.com/package/dsh-lcx-codex)
[![npm prelatest](https://img.shields.io/npm/v/dsh-lcx-codex/prelatest?label=prelatest&color=orange)](https://www.npmjs.com/package/dsh-lcx-codex?activeTab=versions)
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
| Search media previews | Show search-returned images, direct image links and playable video links from an answer below it. |
| Alpha web actions | Experimental follow-up web reading for tasks that need to open or inspect search results. |

Other models continue through their normal DSH paths.

## Installation

Run `dsh --version` first, then pick the plugin line for your DSH version. Node.js `^22.19.0 || >=24.0.0` is required.

| Your DSH version | LCX version | Install tag |
| --- | --- | --- |
| `0.2.1-alpha.2` and later | `0.6.0-pre.2` (prerelease) | `@prelatest` |
| `0.2.0` line (`0.2.0-rc.2`, before `0.2.1-alpha.2`) | `0.5.2` (stable) | `@latest` |
| `0.1.6` line (`0.1.6-alpha.2` and later) | `0.4.4-pre.1` (previous prerelease) | `@0.4.4-pre.1` |
| `0.1.5` line (`0.1.5-rc.1` and later) | `0.4.3` (stable) | `@0.4.3` |

The lines are not interchangeable; installing the wrong one may only print a dependency warning while the plugin fails to work. `@latest` is the stable `0.5.2` (release baseline DSH `0.2.0-rc.2`, host/plugin Pi `0.87.1`) and supports DSH `0.2` only; DSH `0.1.5` users must pin `@0.4.3`.

`0.6.0-pre.2` is a prerelease for DSH `0.2.1-alpha.2`. Its install range has a **lower bound only** (`>=0.2.1-alpha.2`) and no upper bound: newer DSH versions can install it, but they are **unverified**. The verified baseline of this prerelease is exactly DSH `0.2.1-alpha.2` (host Pi `1.1.0`, plugin Pi `0.87.1`); do not read it as support for any other DSH version.

This release adopts the plugin-facing features of DSH `0.2.1`:

- **Incremental (addition-only) tool updates**: on GPT Responses routes where DSH declares this mode, a tool added mid-session (for example turning on web search, or enabling an MCP server or skill) no longer changes the request `tools`; the new tool is declared as a history item, so the cached prefix stays valid. The settings card has an "Incremental tool updates" switch, on by default; off sends the complete current tool list on every request. Removing a tool or redefining one under the same name still resets the cache once. Grok, custom-named routes, fork / route-migration replay and compaction checkpoints keep sending the complete list.
- **Searches made from code**: when a `run_code` program (programmatic tool calling) calls `web_search` or `websearch_gpt_advanced`, the search usage and returned images are counted and shown.
- **Plugin Manager card**: LCX shows its own name (LCX Codex), description and icon on the Plugin Manager page.

> Note: the stable `0.5.x` install range is `>=0.2.0-rc.2 <0.2.1`. Under DSH's version-range semantics, `0.2.1` prereleases (for example `0.2.1-alpha.2`) may also be allowed to install it, but they are **not** supported or verified for `0.5.x`; use `@prelatest` on DSH `0.2.1-alpha.2` and later.

DSH `0.2.1-alpha.2` and later (prerelease):

```sh
dsh plugin --profile web add dsh-lcx-codex@prelatest
dsh web
```

DSH `0.2.0` line (stable):

```sh
dsh plugin --profile web add dsh-lcx-codex@latest
dsh web
```

DSH `0.1.5` line (stable, pin the version; do not use `@latest`):

```sh
dsh plugin --profile web add dsh-lcx-codex@0.4.3
dsh web
```

DSH `0.1.6` line: `dsh plugin --profile web add dsh-lcx-codex@0.4.4-pre.1`. To update later, run the same `add` command again. If you already installed `0.5.0-pre.1`, running the `@latest` command (DSH `0.2.0` line) moves you to the stable release (`0.5.0-pre.1` and `0.5.0` share runtime code); on DSH `0.2.1-alpha.2` and later use `@prelatest`.

## Enable features

Open DSH Web plugin settings and find **Responses / Codex capabilities**.

### GPT

For normal GPT use, enable:

1. **Enable LCX**
2. **GPT Hosted Search** when web access is needed

Optional features:

- **Advanced Hosted tool**: for image search, domains, location, and other advanced search controls. It requires GPT Hosted Search.
- **Alpha**: experimental follow-up web actions. It is not needed for ordinary web search.
- **Incremental tool updates**: on by default; keeps the request prefix (and the prompt cache) stable when a tool is added mid-session on supporting GPT routes. Turn it off to send the complete tool list on every request.

### Grok

Grok native search is independent of the GPT LCX switch:

- **Grok native Web Search** searches the web.
- **Grok native X Search** searches X.

When Grok native search is enabled, LCX uses xAI's server-side search while keeping page-reading and other DSH / MCP tools available.

### Search media previews

**Search media previews** can be enabled independently. They change presentation only; they do not modify model prompts, search requests, conversation history, or cache behavior.

When enabled, LCX adds one media block below each answer:

- **Image rail**: images returned by GPT search, followed by direct image links from the answer (for example `.jpg`, `.png`, `.webp`), shown as one horizontal row at their natural proportions. Hover shows the source; click opens DSH's own image viewer; extra images scroll sideways.
- **Video cards**: direct playable video links (`.mp4`, `.webm`, `.ogv`) appear as compact cards. Nothing is loaded until you click; the video then plays inline in the answer.

Images written as Markdown in the answer are rendered by DSH itself and are never shown twice. Ordinary web pages and video sites stay as links. A direct image link that cannot be loaded simply stays a link; the answer text is never changed.

LCX also makes a Markdown image in an answer start on its own line, so text or links after it are no longer placed beside it. This small layout fix applies whether or not previews are enabled.

## Examples

Use normal language; you do not need to write tool arguments yourself.

> Search the official Python documentation and explain how `asyncio.TaskGroup` should be used.

> Find a few photos of the Golden Gate Bridge, show one, and include its source page.

> With Grok, search X for recent discussion about this project.

Long tasks do not require you to watch the context window manually. With LCX enabled, compatible GPT routes can automatically compact long conversations and keep working. You can also use `/compact` manually.

## Compatibility and known limits

- Baselines: `0.6.0-pre.2` is verified only on exactly DSH `0.2.1-alpha.2` (prerelease; host Pi `1.1.0`). Its install range has no upper bound, so newer DSH versions install but are unverified. The real-runtime pass on that baseline covers GPT routes, search, compaction, incremental tool updates, searches made inside `run_code` and the Plugin Manager card; the `run_code` check ran in an isolated home with the full-access permission mode (DSH's Windows file sandbox could not start `run_code` on the test machine) and the program only made search calls. Grok native search and user image input received only a limited regression check, and Alpha search and the naturally triggered compaction pressure band were not part of that pass. Stable `0.5.2` is based on DSH `0.2.0-rc.2` (as is `0.5.0`, runtime identical to the verified `0.5.0-pre.1`); `0.4.4-pre.1` verified on DSH `0.1.6-alpha.2`; stable `0.4.3` on DSH `0.1.5-rc.1` (also checked on `0.1.5-rc.2`). Later releases inside each install range need separate assessment.
- When upgrading, starting a new session is recommended; old saved compaction state is not guaranteed to remain compatible. On DSH `0.2`, an old long session carrying a previous LCX checkpoint reports `LCX_CHECKPOINT_UNSUPPORTED` on the LCX path; start a new session. Other routes are unaffected.
- Grok native search supports API-key / API-gateway routes. xAI OAuth / SuperGrok login is outside the current scope. Native X Search has been verified on `grok-4.6` only.
- Grok agentic calls report usage that is cumulative across internal requests. When the terminal response carries complete live-context details, LCX uses them for compaction pressure and otherwise falls back to an estimate; billed usage is unchanged.
- Alpha remains experimental. Stateful `open / find` browsing works on the tested OAuth-backed upstream; API-key upstream accounts are not covered. A failed target-page fetch is reported as `LCX_ALPHA_PAGE_FETCH_FAILED` so the model can try another result.
- DSH `0.2.1` incremental tool updates apply only on GPT Responses routes where DSH declares "addition-only"; when the DSH tool history or model information is missing, the route does not support it, or the settings-card switch is off, LCX goes back to sending the complete tool list on every request. Removing or redefining a tool still resets the cache once. Cache hits are noisy upstream: in a same-sequence comparison on `openai/gpt-6-sol`, the first request after a tool addition hit about 80% of the cache with the switch on and 0% with it off. LCX's bundled model catalog is frozen at Pi `0.86`; newer models missing from it (such as `gpt-6-sol`) follow the DSH declaration.
- On DSH `0.1.5` with `0.4.3`, after enabling or disabling the plugin an already-open browser page may need to be refreshed.
- API gateways vary in capability. A working normal chat does not guarantee that search, long-conversation compaction, Alpha, or Grok native search is also supported.

## Troubleshooting

**Installed but nothing changed?** Make sure installation and startup use the same `web` profile, then confirm the relevant feature switches were saved.

**Conversation works but search or compaction fails?** Check that the selected GPT / Grok Responses route actually provides the required server-side capability. A gateway product name alone does not guarantee every feature.

**Plugin "failed to import" after upgrading to DSH 0.2?** A profile upgraded from much older versions may still contain stale packages. Stop `dsh web`, move away or delete `node_modules` and `pnpm-lock.yaml` in `profiles/web/` under your DSH home (default `~/.dsh`, or `DSH_HOME`), run the matching `dsh plugin --profile web add dsh-lcx-codex@latest` command again (`@prelatest` on DSH `0.2.1-alpha.2` and later), then start `dsh web`.

**`@latest` / `@prelatest` installed the previous version right after a release?** The package manager's metadata cache may not have refreshed yet, and DSH rejects the incompatible version. Retry after a few minutes, or pin the exact version, for example `dsh-lcx-codex@0.6.0-pre.2` or `dsh-lcx-codex@0.5.2`.

When opening an [issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues), include plugin, DSH, and Node.js versions plus reproduction steps. Do not post API keys, full requests, or unredacted session logs.

## More information

- [Changelog](CHANGELOG.md)
- [Architecture](ARCHITECTURE.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE). Independent community plugin, not affiliated with or endorsed by OpenAI, DeepSeek, Sub2API, or NewAPI.
