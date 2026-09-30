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
| `0.2.0` line (`0.2.0-rc.2` and later, below `0.2.1`) | `0.5.0-pre.1` (prerelease) | `@prelatest` |
| `0.1.6` line (`0.1.6-alpha.2` and later) | `0.4.4-pre.1` (previous prerelease) | `@0.4.4-pre.1` |
| `0.1.5` line (`0.1.5-rc.1` and later) | `0.4.3` (stable) | `@latest` |

The three lines are not interchangeable; installing the wrong one may only print a dependency warning while the plugin fails to work. `0.5.0-pre.1` is a prerelease; its validated/accepted release baseline is DSH `0.2.0-rc.2` with host/plugin Pi `0.87.1`.

DSH `0.2.0` line:

```sh
dsh plugin --profile web add dsh-lcx-codex@prelatest
dsh web
```

DSH `0.1.5` line (stable):

```sh
dsh plugin --profile web add dsh-lcx-codex@latest
dsh web
```

DSH `0.1.6` line: `dsh plugin --profile web add dsh-lcx-codex@0.4.4-pre.1`. To update later, run the same `add` command again.

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

- Baselines: `0.5.0-pre.1` validated/accepted on DSH `0.2.0-rc.2` (prerelease); `0.4.4-pre.1` verified on DSH `0.1.6-alpha.2`; stable `0.4.3` on DSH `0.1.5-rc.1` (also checked on `0.1.5-rc.2`). Later releases inside each install range need separate assessment.
- When upgrading, starting a new session is recommended; old saved compaction state is not guaranteed to remain compatible. On DSH `0.2`, an old long session carrying a previous LCX checkpoint reports `LCX_CHECKPOINT_UNSUPPORTED` on the LCX path; start a new session. Other routes are unaffected.
- Grok native search supports API-key / API-gateway routes. xAI OAuth / SuperGrok login is outside the current scope. Native X Search has been verified on `grok-4.6` only.
- Grok agentic calls report usage that is cumulative across internal requests. When the terminal response carries complete live-context details, `0.5.0-pre.1` uses them for compaction pressure and otherwise falls back to an estimate; billed usage is unchanged.
- Alpha remains experimental. Stateful `open / find` browsing works on the tested OAuth-backed upstream; API-key upstream accounts are not covered. A failed target-page fetch is reported as `LCX_ALPHA_PAGE_FETCH_FAILED` so the model can try another result.
- On DSH `0.1.5` with `0.4.3`, after enabling or disabling the plugin an already-open browser page may need to be refreshed.
- API gateways vary in capability. A working normal chat does not guarantee that search, long-conversation compaction, Alpha, or Grok native search is also supported.

## Troubleshooting

**Installed but nothing changed?** Make sure installation and startup use the same `web` profile, then confirm the relevant feature switches were saved.

**Conversation works but search or compaction fails?** Check that the selected GPT / Grok Responses route actually provides the required server-side capability. A gateway product name alone does not guarantee every feature.

**Plugin "failed to import" after upgrading to DSH 0.2?** A profile upgraded from much older versions may still contain stale packages. Stop `dsh web`, move away or delete `node_modules` and `pnpm-lock.yaml` in `profiles/web/` under your DSH home (default `~/.dsh`, or `DSH_HOME`), run `dsh plugin --profile web add dsh-lcx-codex@prelatest` again, then start `dsh web`.

**`@prelatest` installed the previous version right after a release?** The package manager's metadata cache may not have refreshed yet, and DSH rejects the incompatible version. Retry after a few minutes, or pin the exact version, for example `dsh-lcx-codex@0.5.0-pre.1`.

When opening an [issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues), include plugin, DSH, and Node.js versions plus reproduction steps. Do not post API keys, full requests, or unredacted session logs.

## More information

- [Changelog](CHANGELOG.md)
- [Architecture](ARCHITECTURE.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE). Independent community plugin, not affiliated with or endorsed by OpenAI, DeepSeek, Sub2API, or NewAPI.
