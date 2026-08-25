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

## Current stable release

`0.4.1` is the current stable release. It is a **zero-functional-change stable promotion** of `0.4.1-pre.1`, which already passed full Installed Candidate and Cross-feature QA.

```powershell
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

npm `latest` points to `0.4.1`. Historical `prelatest=0.4.1-pre.1` uses the same accepted runtime baseline; new users should install `latest`.

## What it solves

If DSH already has a working GPT `openai-responses` route, `dsh-lcx-codex` fills Responses capability gaps while preserving DSH entry points and lifecycle ownership.

| Scenario | Existing DSH surface | With LCX |
|---|---|---|
| Ordinary web search | DSH `web_search` | Keep the same `web_search`; LCX maps its SearchProvider to GPT Hosted Search |
| Advanced Hosted controls | Ordinary search stays simple | Optional `websearch_gpt_advanced` for domain filters, approximate location, search context, image search, and related controls |
| Stateful page / PDF browsing | DSH keeps Web lifecycle ownership | Optional Codex / Alpha actions: `search → open → find/click → screenshot` |
| Long-session compaction | DSH keeps pressure, transactions, and recovery | Prefer Responses Native V2 checkpoints at the existing compaction seam |

**The goal is not to build another Agent stack. It is to let a DSH GPT route use the native capabilities it should already have access to.**

## Core capabilities

### GPT Hosted Search

The model still sees DSH's ordinary `web_search`; LCX changes the SearchProvider path instead of registering a duplicate ordinary-search tool. Enable `websearch_gpt_advanced` only when you need additional Hosted Search controls.

### Codex-style Web Actions

`websearch_alpha` supports stateful browsing:

```text
search → open → find / click → screenshot
```

It is off by default and registered only when the current endpoint / provider / model / schema passes capability checks. Unknown deployments fail closed.

`0.4.1` includes the URL/stateful-continuation and capability fail-closed fixes that were accepted on the prerelease line.

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

Native opaque state stays source-session bound. Forks and model/route migrations use portable migration rather than sending a parent's opaque state across sessions; restart/resume rebuilds from the DSH session log.

## What changed from 0.4.0

`0.4.1` promotes the already accepted `0.4.1-pre.1` changes to stable:

- Alpha URL/stateful continuation and fail-closed capability fixes;
- DSH compatibility-seam isolation;
- typed protocol core for route / Native V2 / checkpoint handling;
- unified conservative token budgeting for Native retention and portable migration;
- installed settings namespace / configuration-card lifecycle fix;
- Installed Candidate + Cross-feature QA.

The stable promotion itself adds no new runtime behavior.

## Get started

### Install stable

```powershell
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

Pin the exact version if needed:

```powershell
dsh plugin --profile web add dsh-lcx-codex@0.4.1
```

Use the official DSH plugin remove/add path when upgrading. Do not delete user sessions or `$DSH_HOME/storages/lcx-codex/` just to change versions.

### Suggested first-run settings

| Setting | Suggested value |
|---|---:|
| Enable plugin | **On** |
| Use GPT Hosted Search | On when needed |
| Advanced Hosted Search | Off until needed |
| Alpha Search | Off until route capability is confirmed |
| Native V2 remote compaction | On only when upstream supports it |
| Native-first auto compaction | On when using Native V2 |

Requirements: Node.js `>=20`, a working GPT `openai-responses` route in DSH, and actual upstream support for the capabilities you enable.

## Verify observable behavior

| Capability | Expected behavior |
|---|---|
| GPT Hosted Search | Ordinary entry remains DSH `web_search`; the request follows the active GPT Responses route |
| Advanced Hosted | `websearch_gpt_advanced` appears only when enabled |
| Alpha Web Actions | `websearch_alpha` appears only after capability validation |
| Native V2 | Compaction follows the provider-native checkpoint path; Basic Compaction is not mislabeled as Native V2 |

## Which search tool should I use?

| Goal | Entry | Best for |
|---|---|---|
| Ordinary web lookup | DSH `web_search` | General search, research, and retrieval |
| Control Hosted Search parameters | `websearch_gpt_advanced` | Domain allow/block, approximate location, search context, image search, and related controls |
| Browse pages or PDFs statefully | `websearch_alpha` | `search/open/find/click/screenshot` and structured Web actions |

## How it fits into DSH

```text
DSH Agent / Session / Web
├─ web_search ──────────> LCX SearchProvider ──> GPT Hosted Search
├─ Advanced / Alpha ────> LCX Web tools ───────> GPT Web actions
└─ compact / replay ────> LCX Native bridge ───> Responses Native V2
```

**DSH is the host; LCX is a compatibility extension.** It reuses the active DSH route's `baseURL`, configured authentication reference, headers, model, and retry policy rather than maintaining a second account configuration.

See [ARCHITECTURE.md](ARCHITECTURE.md) for checkpoint, replay, Pi serialization, cache identity, fork safety, and pressure-coordination details.

## Compatibility

Current formally stable stack:

| Plugin | DSH | DSH host Pi | Plugin Pi | Status |
|---|---|---|---|---|
| `0.4.1` | `0.1.1-rc.2` | `0.82.1` | `0.82.1` | **VERIFIED STABLE** |

`0.4.1` uses the fully QA-passed `0.4.1-pre.1` runtime, and the stable promotion is zero-functional-change. New DSH releases are **not** assumed compatible without seam review and risk-appropriate testing.

<details>
<summary><strong>Recommended settings</strong></summary>

| Setting | Recommended | Notes |
|---|---:|---|
| Enable plugin | On | Enables LCX |
| Use GPT Hosted Search | As needed | Routes DSH `web_search` through GPT Hosted Search |
| Advanced Hosted Search | Off | Enable only for advanced Hosted parameters |
| Alpha Search | Off | Enable after capability verification |
| Native V2 remote compaction | On* | *When the upstream route actually supports Native V2 |
| Native-first auto compaction | On | Enables automatic pressure coordination |
| Native threshold | 90% | Prefer Native V2 from 90% |
| Emergency DSH prune | 95% | Allow emergency prune from 95% |
| `web_search` timeout | 240 s | Avoid false timeout on longer searches |

</details>

<details>
<summary><strong>Common cases</strong></summary>

**`web_search` is not using GPT Hosted Search**  
Make sure the plugin and Hosted Search are enabled and that the active Agent resolves to a compatible GPT `openai-responses` route.

**`websearch_alpha` is missing**  
That is expected fail-closed behavior. Alpha is registered only after a trusted capability probe succeeds for the current route/schema.

**Native V2 is not taking effect**  
Verify that the current GPT Responses endpoint actually supports `remote_compaction_v2`. The plugin does not present ordinary Basic Compaction as a successful Native V2 run.

**Installed but no configuration card is visible**  
Make sure you are on `0.4.1` or later and restart/refresh DSH Web. `0.4.1` includes the installed settings lifecycle fix.

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
