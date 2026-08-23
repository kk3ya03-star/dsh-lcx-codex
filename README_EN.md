<div align="center">

<img src="assets/dsh-lcx-codex-banner-en.svg" alt="dsh-lcx-codex — GPT Hosted Search, Codex-style Web Actions, and Native V2 Compaction for DSH" width="100%" />

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?color=1677ff&label=npm)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![Node](https://img.shields.io/badge/Node-%3E%3D20-2f855a)
![License](https://img.shields.io/badge/license-MIT-6b7280)

[简体中文](README.md) · **English** · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

</div>

> **DSH remains the host. LCX fills missing native capabilities on GPT Responses routes without modifying DSH core or replacing Agent / Session / Web / Compaction.**

## What it solves

If DSH already has a working GPT `openai-responses` route, `dsh-lcx-codex` lets that route use more of the native GPT Responses capability set while keeping DSH's existing entries and lifecycle ownership intact.

| Scenario | Existing DSH surface | With LCX |
|---|---|---|
| Ordinary web search | DSH `web_search` | **Keep the same `web_search` entry** while LCX maps its SearchProvider to the active GPT Hosted Search route |
| Advanced Hosted Search controls | Keep ordinary search simple | Optionally add `websearch_gpt_advanced` for domain filters, approximate location, search context, image search, and related controls |
| Stateful page / PDF browsing | DSH keeps Web lifecycle ownership | Optionally add Codex / Alpha Web Actions: `search → open → find/click → screenshot` |
| Long-session compaction | DSH keeps pressure, transactions, and recovery | Prefer Responses Native V2 checkpoints at the existing compaction seam |

**The goal is not to build another Agent stack. It is to let a DSH GPT route use the native capabilities it should already have access to.**

## Three core capabilities

### 1. GPT Hosted Search: keep the ordinary search entry

When enabled, the model still sees the native DSH `web_search` tool for ordinary search. LCX changes the SearchProvider path instead of registering a second duplicate search tool.

Enable `websearch_gpt_advanced` only when you need finer Hosted Search controls.

### 2. Codex-style Web Actions: opt in when needed

`websearch_alpha` is for stateful browsing and structured Web actions:

```text
search → open → find / click → screenshot
```

It is off by default and is registered only after the exact endpoint / provider / model / schema passes a capability probe. Unknown deployments are **fail-closed** rather than mislabeled as Alpha-capable.

### 3. Native V2 Compaction: preserve DSH session semantics

LCX does not create a second compaction engine. DSH still owns pressure, compactable ranges, `/compact`, durable session transactions, tool-result pruning, and overflow recovery. LCX only requests Responses Native V2 at the existing compaction LLM seam.

Default automatic policy:

```text
0% ─────────────────── 90% ───── 95% ───── 100%
       normal            Native      emergency   hard cap
                         V2          DSH prune
```

- **90%**: prefer Native V2.
- **95%**: allow emergency DSH pruning.
- provider-confirmed context overflow: keep DSH's original recovery path.
- manual `/compact`: keep the native DSH session transaction.

The exact source session can reuse its own Native checkpoint. Forks or model migrations never send a parent's opaque state across sessions and use portable migration instead. Restart/resume rebuilds from the DSH session log.

## Get started in 30 seconds

### 1. Install

```powershell
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

### 2. Enable it in DSH Settings

For a first run, start with the smallest useful configuration:

| Setting | Suggested first-run value |
|---|---:|
| Enable plugin | **On** |
| Use GPT Hosted Search | **On** when you want GPT Hosted Search |
| Advanced Hosted Search | **Off** until you need advanced controls |
| Alpha Search | **Off** until the current route is confirmed compatible |
| Native V2 remote compaction | **On** only when the upstream actually supports Native V2 |
| Native-first auto compaction | **On** when using Native V2 |

**Requirements**

- Node.js `>=20`
- a working GPT `openai-responses` route in DSH
- actual upstream support for the Hosted Search / Native V2 / Alpha capabilities you plan to enable

### 3. Verify that it is actually active

Do not stop at checking toggles. Verify observable behavior for each capability:

| Capability | What you should observe |
|---|---|
| GPT Hosted Search | The ordinary tool entry remains DSH `web_search`, while the actual request follows the active GPT Responses route |
| Advanced Hosted | `websearch_gpt_advanced` appears after enablement and exposes the advanced controls separately |
| Alpha Web Actions | `websearch_alpha` appears only after the capability probe succeeds |
| Native V2 | Compaction follows the provider-native checkpoint path; ordinary Basic Compaction is never presented as a successful Native V2 run |

## Which search tool should I use?

The three entries serve different jobs. **You do not need to enable all of them.**

| What you want to do | Entry | Best for |
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

**DSH is the host; LCX is a compatibility extension.** The plugin prefers the active DSH route's `baseURL`, credential reference, headers, model, and retry policy instead of maintaining a second account configuration.

For checkpoint internals, canonical replay, Pi serialization, cache identity, fork safety, and pressure coordination, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Compatibility

Current formally verified stack:

| Plugin | DSH | DSH host Pi | Plugin Pi | Status |
|---|---|---|---|---|
| `0.4.0` | `0.1.1-rc.2` | `0.82.1` | `0.82.1` | **VERIFIED** |

A new DSH release is **not** assumed compatible. The project first reviews the DSH / Pi seams that changed and then runs risk-appropriate tests. A newer Pi registry version alone does not automatically upgrade the plugin dependency.

<details>
<summary><strong>Full recommended settings</strong></summary>

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

Key fields: `remoteCompaction`, `autoCompaction`, `fallbackToBasicCompaction`, `autoCompactionThresholdPercent`, `emergencyPruneThresholdPercent`, `webSearchTimeoutSeconds`, `advancedHostedSearch`, `alphaSearch`.

</details>

<details>
<summary><strong>Other installation options</strong></summary>

**Prerelease**

```powershell
dsh plugin --profile web add dsh-lcx-codex@next
```

**Local tarball**

```powershell
dsh plugin --profile web remove dsh-lcx-codex
dsh plugin --profile web add .\dsh-lcx-codex-0.4.0.tgz
dsh web
```

Do not delete DSH sessions or `$DSH_HOME/storages/lcx-codex/` just to “clean up” during an upgrade. Older sessions may still reference compatibility data there.

</details>

<details>
<summary><strong>Common cases</strong></summary>

**`web_search` is not using GPT Hosted Search**  
Make sure the plugin and Hosted Search are enabled and that the active Agent resolves to a compatible GPT `openai-responses` route.

**`websearch_alpha` is missing**  
That is expected fail-closed behavior. Alpha is registered only after a trusted capability probe succeeds for the current route/schema.

**Native V2 is not taking effect**  
Verify that the current GPT Responses endpoint actually supports `remote_compaction_v2`. The plugin does not present ordinary Basic Compaction as a successful Native V2 run.

</details>

<details>
<summary><strong>Development</strong></summary>

```bash
npm test
npm run test:schema
npm pack --ignore-scripts
```

- Design and protocol details: [ARCHITECTURE.md](ARCHITECTURE.md)
- Release history: [CHANGELOG.md](CHANGELOG.md)
- npm: [`dsh-lcx-codex`](https://www.npmjs.com/package/dsh-lcx-codex)

</details>

## License

MIT

> `LCX` is only the project name. This is a community project and is not affiliated with OpenAI, DeepSeek, Sub2API, or NewAPI.
