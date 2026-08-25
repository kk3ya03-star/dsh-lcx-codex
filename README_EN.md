<div align="center">

<img src="assets/dsh-lcx-codex-banner-en.png" alt="dsh-lcx-codex — GPT Hosted Search, Codex-style Web Actions, and Native V2 Compaction for DSH" width="100%" />

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?color=1677ff&label=npm%20latest)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![Node](https://img.shields.io/badge/Node-%3E%3D20-2f855a)
![License](https://img.shields.io/badge/license-MIT-6b7280)

[简体中文](README.md) · **English** · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

</div>

> **DSH remains the host. LCX adds missing native capabilities to GPT Responses routes without modifying DSH core or replacing Agent / Session / Web / Compaction.**

## Release channels

| Channel | Version | Use it when | Install |
|---|---|---|---|
| `latest` | `0.4.0` | You want the current formally stable / VERIFIED release | `dsh plugin --profile web add dsh-lcx-codex` |
| `prelatest` | `0.4.1-pre.1` | You want the newest QA-passed fixes and accept prerelease status | `dsh plugin --profile web add dsh-lcx-codex@prelatest` |

**Most users should start with `latest`.** Use `prelatest` if you specifically need the Alpha stateful-continuation fixes, installed Settings lifecycle fix, typed protocol hardening, or unified token budgeting introduced in `0.4.1-pre.1`.

`0.4.1-pre.1` is published on npm, but it is still a prerelease. Stable compatibility authority remains `0.4.0`.

## What it solves

If DSH already has a working GPT `openai-responses` route, `dsh-lcx-codex` lets that route use more native GPT Responses capabilities while preserving DSH entry points and lifecycle ownership.

| Scenario | Existing DSH surface | With LCX |
|---|---|---|
| Ordinary web search | DSH `web_search` | Keep the same `web_search`; LCX maps its SearchProvider to GPT Hosted Search |
| Advanced Hosted controls | Ordinary search stays simple | Optional `websearch_gpt_advanced` for domain filters, approximate location, search context, image search, and related controls |
| Stateful page / PDF browsing | DSH keeps Web lifecycle ownership | Optional Codex / Alpha actions: `search → open → find/click → screenshot` |
| Long-session compaction | DSH keeps pressure, transactions, and recovery | Prefer Responses Native V2 checkpoints at the existing compaction seam |

## Core capabilities

### GPT Hosted Search

The model still sees DSH's ordinary `web_search`; LCX changes the SearchProvider path instead of registering a duplicate ordinary-search tool. Enable `websearch_gpt_advanced` only when you need additional Hosted Search controls.

### Codex-style Web Actions

`websearch_alpha` supports stateful browsing:

```text
search → open → find / click → screenshot
```

It is off by default and registered only when the current route/schema passes capability checks. Unknown deployments fail closed.

> Complete URL/stateful continuation and capability fail-closed fixes are part of `0.4.1-pre.1`. If you depend on the full chain, use `@prelatest` rather than assuming stable `0.4.0` has identical behavior.

### Native V2 Compaction

LCX does not create a second compaction engine. DSH still owns pressure, compactable ranges, `/compact`, durable session transactions, pruning, and overflow recovery. LCX requests Responses Native V2 through the existing compaction seam.

```text
0% ─────────────────── 90% ───── 95% ───── 100%
       normal            Native      emergency   hard cap
                         V2          DSH prune
```

- **90%**: prefer Native V2.
- **95%**: allow emergency DSH pruning.
- provider-confirmed context overflow: keep DSH's original recovery.
- manual `/compact`: keep the native DSH transaction.

Native opaque state stays source-session bound. Forks and route/model migrations use portable migration rather than sending a parent's opaque state.

## Get started

### Stable release

```powershell
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

### Current prerelease

```powershell
dsh plugin --profile web add dsh-lcx-codex@prelatest
dsh web
```

When switching channels, use the official DSH plugin remove/add path. Do not delete user sessions or storage just to change versions.

### Suggested first-run settings

| Setting | Suggested value |
|---|---:|
| Enable plugin | **On** |
| Use GPT Hosted Search | On when needed |
| Advanced Hosted Search | Off until needed |
| Alpha Search | Off until route capability is confirmed |
| Native V2 remote compaction | On only when upstream supports it |
| Native-first auto compaction | On when using Native V2 |

> The installed Settings namespace / configuration-card lifecycle fix is included in `0.4.1-pre.1`. If stable `0.4.0` does not expose the UI described here, test `@prelatest`.

Requirements: Node.js `>=20`, a working GPT `openai-responses` route in DSH, and actual upstream support for the capabilities you enable.

## Verify observable behavior

| Capability | Expected behavior |
|---|---|
| GPT Hosted Search | Ordinary entry remains DSH `web_search`; the request follows the active GPT Responses route |
| Advanced Hosted | `websearch_gpt_advanced` appears only when enabled |
| Alpha Web Actions | `websearch_alpha` appears only after capability validation |
| Native V2 | Compaction follows the provider-native checkpoint path; Basic Compaction is not mislabeled as Native V2 |

## How it fits into DSH

```text
DSH Agent / Session / Web
├─ web_search ──────────> LCX SearchProvider ──> GPT Hosted Search
├─ Advanced / Alpha ────> LCX Web tools ───────> GPT Web actions
└─ compact / replay ────> LCX Native bridge ───> Responses Native V2
```

**DSH is the host; LCX is a compatibility extension.** It reuses the active DSH route's URL, configured authentication reference, headers, model, and retry policy rather than maintaining a second account configuration.

See [ARCHITECTURE.md](ARCHITECTURE.md) for checkpoint, replay, Pi serialization, cache identity, fork safety, and pressure-coordination details.

## Compatibility

| Release line | Plugin | DSH | DSH host Pi | Plugin Pi | Status |
|---|---|---|---|---|---|
| Stable / `latest` | `0.4.0` | `0.1.1-rc.2` | `0.82.1` | `0.82.1` | **VERIFIED** |
| Prerelease / `prelatest` | `0.4.1-pre.1` | `0.1.1-rc.2` | `0.82.1` | `0.82.1` | **RELEASED PRERELEASE / QA PASSED** |

The prerelease has passed candidate QA and its publication chain, but it does **not** automatically become stable compatibility authority. New DSH releases are also not assumed compatible without seam review and risk-appropriate testing.

<details>
<summary><strong>What changed in 0.4.1-pre.1?</strong></summary>

- Alpha URL/stateful continuation and fail-closed capability fixes;
- DSH compatibility-seam isolation;
- typed protocol core for route / Native V2 / checkpoint handling;
- unified conservative token budgeting for Native retention and portable migration;
- installed settings namespace / configuration-card lifecycle fix;
- Installed Candidate + Cross-feature QA.

See [CHANGELOG.md](CHANGELOG.md) for release history.

</details>

<details>
<summary><strong>Pin a specific version</strong></summary>

```powershell
# Stable
dsh plugin --profile web add dsh-lcx-codex@0.4.0

# Current prerelease
dsh plugin --profile web add dsh-lcx-codex@0.4.1-pre.1
```

</details>

<details>
<summary><strong>Development</strong></summary>

```bash
npm run typecheck
npm test
npm run test:schema
npm pack --ignore-scripts
```

- Design: [ARCHITECTURE.md](ARCHITECTURE.md)
- Releases: [CHANGELOG.md](CHANGELOG.md)
- npm: [`dsh-lcx-codex`](https://www.npmjs.com/package/dsh-lcx-codex)

</details>

## License

MIT

> `LCX` is only the project name. This is a community project and is not affiliated with OpenAI, DeepSeek, Sub2API, or NewAPI.
