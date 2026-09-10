<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="LCX Codex" width="100%" />

# LCX Codex

**GPT Responses lifecycle capabilities plus native Web / X Search for Grok in DeepSeek Harness.**

[![npm prerelease](https://img.shields.io/npm/v/dsh-lcx-codex/prelatest?label=prelatest)](https://www.npmjs.com/package/dsh-lcx-codex)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--alpha.2-16803c)](#installation-and-compatibility)
[![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

[简体中文](README.md) · **English** · [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues)

</div>

LCX Codex is a community plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (DSH). It activates capabilities by the selected model: GPT can use remote native compaction plus Hosted / Alpha Search, while Grok can use xAI Responses native `web_search` and `x_search`. Other models remain on DSH's native path.

Models, endpoints, API keys / credentials, sessions, and tools remain DSH-owned. GPT and Grok feature switches are independent. Grok native search currently supports API-key / API-gateway routes; xAI OAuth / SuperGrok login is outside this release.

## Installation and Compatibility

This page describes **`dsh-lcx-codex@0.4.3-pre.13`**, targeting only **DSH `0.1.5-alpha.2` / Pi `0.85.1`**. Node.js requires `^22.19.0 || >=24.0.0`. Stable remains `0.4.2`; see the [stable documentation](https://github.com/kk3ya03-star/dsh-lcx-codex/blob/v0.4.2/README_EN.md) for older installations.

First confirm that official DSH `0.1.5-alpha.2` Web starts and configure your GPT Responses or Grok Responses route and credentials in DSH. Once this candidate is published, install it with:

```sh
dsh plugin --profile web add dsh-lcx-codex@0.4.3-pre.13
dsh web
```

For subsequent prerelease updates, use `dsh plugin --profile web add dsh-lcx-codex@prelatest`. Omitting a version or tag selects stable; during release preparation, `prelatest` may still resolve to the previous prerelease.

Clean-profile installation was validated on official, unmodified DSH `0.1.5-alpha.2`. The old Windows `fs-ext` workaround and manual approval of extra build scripts are not required. If an older DSH installation was patched, use clean target-version files instead of carrying those patches forward.

This version supports the target DSH's Session V3 only. It does not migrate older DSH sessions, plugin settings, or old checkpoint/replay formats. Back up old settings and sessions, retain history for offline reference, and use a fresh session directory. Reopening a persisted session of the supported version and restoring its current v5 checkpoint are supported.

## Enable the Plugin

In DSH Web plugin settings, open **Responses / Codex capabilities**, enable the features you need, and save:

| Switch | Purpose |
| --- | --- |
| Enable LCX | GPT Responses lifecycle, Native V2 compaction and GPT search. |
| GPT Hosted Search | Ordinary GPT web queries through the single `web_search` entrypoint. |
| Advanced Hosted tool | Image search, domain/location filters and other GPT search controls. |
| Alpha | Experimental upstream web actions; continuation remains limited, as described below. |
| Grok native Web Search | xAI server-side web search. |
| Grok native X Search | xAI server-side X search. |
| Search media previews | Preview available image/video links in answers; presentation only. |

All switches default off. GPT capabilities depend on Enable LCX; Grok Web/X and media previews are independent. DSH still owns model, reasoning level, endpoint, credentials and image-input capability.

GPT uses its enabled LCX features. When Grok native search is enabled, the corresponding request omits DSH `web_search` but preserves `web_fetch`, `read` and other local/MCP tools. Other models stay on the native DSH path. Switching models does not require a plugin restart.

## Search and Media

**GPT Hosted Search** handles ordinary queries; use `websearch_gpt_advanced` for images or additional controls. For example: “Find a Golden Gate Bridge photo, display one and link to its source.” This searches existing images; it neither generates an image nor proves the model has read its pixels.

**Grok native search** uses xAI Responses server-side `web_search` / `x_search` and can continue through local tools. API-key/API-gateway routes are supported; xAI OAuth / SuperGrok login is not. Normal links in model prose remain visible. LCX no longer appends synthetic Sources lists and filters known upstream renderer markers. Results depend on route capabilities.

**Search media previews** prefer structured search-image metadata, then conservatively recognize direct media links in answers. Images have thumbnails and an enlarged view; direct videos use the native player. Ordinary pages remain source links. Failed media leaves the original prose and links intact. This setting does not alter model requests, prompts, tool contents, history, cache identity, usage or compaction, and adds no model/Alpha calls. Displaying media can still contact its origin.

**Alpha** acts on upstream search-service content, not your local browser. Its interface offers `search / open / find / click / screenshot`, gated by route capability probes. Search and reference-collision protection are validated, but warm/cold opaque-reference `open/find` continuation remains unresolved; a complete `click` chain is not promised. Displayable screenshot delivery is also unverified. Unavailable or conflicting references fail closed, without guessed references or URL substitution. Ordinary Hosted and Grok search do not require Alpha.

## Long Conversations, Usage and Cache

With LCX enabled for GPT, ordinary requests, Native V2 remote compaction and compatible replay share one request path. DSH retains persistence, tool execution, compaction-range and transaction ownership. Compatible GPT routes normally prefer remote compaction at 90% context usage and permit emergency tool-result pruning at 95%; `/compact` is also available. Eligibility and upstream support still apply. Grok uses DSH's own compaction.

Current v5 checkpoints are validated against session, model and route. Incompatible contexts use portable history without cross-session opaque-state reuse. Some recoverable first-checkpoint failures can fall back to DSH basic compaction; not every failure can. Reopening the same saved DSH session is distinct from Codex process-level rollout/restart-resume.

GPT parents and children may share parent prompt-cache identity while retaining separate histories. Each Grok session has its own cache identity and replay state. Supported routes follow Pi `0.85.1`: explicit-mode long retention is `30m`; other routes supporting long retention can use `24h`; `none` omits the cache key. Cache hits are upstream decisions, and tool/history changes may rebuild the prefix.

GPT auxiliary search usage is recorded separately from the main call and supplements UI totals without entering model text or main-call context pressure. Grok billing counters preserve provider totals. Upstream separation of aggregate billing and context occupancy remains limited; not every conservative compaction decision is eliminated.

## Troubleshooting and Known Limits

- Install and start with the same `web` profile, and save the relevant switches. Working conversation alone does not establish Native V2, Hosted, Alpha or Grok search capability.
- Reload open browser pages after host-profile plugin enable/disable changes. DSH's existing boot graph does not unload a mounted browser plugin solely because host inventory changes. LCX preview OFF and cleanup when its actual client disposer runs have been validated.
- This npm package neither includes nor installs the standalone DSH pending-inbox patch, and does not claim to fix that issue in unmodified DSH Core.
- Dynamic-tool cache invalidation, Grok aggregate billing/context pressure, and upstream media/usage UI compatibility remain tracked limits. DSH is an alpha runtime; compatibility with other DSH versions is not claimed.

## Validation and Development

Accepted pre.13 evidence covers **370/370 plugin tests, strict host/client types, 4/4 schemas and 51/51 reproducible generated files**, plus exact alpha.2 clean-profile installation and bounded GPT/Grok/search/compaction/reopen/subagent/cancellation and browser-media scenarios. It does not establish the unresolved capabilities above or exhaustive provider/gateway coverage.

The plugin builds its required Responses helpers and model catalog from pinned Pi `0.85.1` public exports. It does not install the full Pi SDK dependency tree into the user's profile or replace DSH's Pi. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

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

See [Architecture](ARCHITECTURE.md) and [Changelog](CHANGELOG.md). Include versions and reproduction steps when reporting issues; do not upload credentials, full requests or unredacted session logs.

## License

[MIT](LICENSE). Independent community plugin, not affiliated with or endorsed by OpenAI, DeepSeek, Sub2API or NewAPI.
