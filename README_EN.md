<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="DSH-LCX-CODEX" width="100%" />

**Add GPT Hosted Search, Codex / Alpha Web Actions and Native V2 Compaction to DeepSeek Harness.**

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?color=1677ff&label=npm)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![Node](https://img.shields.io/badge/Node-%3E%3D20-2f855a)
![License](https://img.shields.io/badge/license-MIT-6b7280)

[简体中文](README.md) · **English** · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

</div>

> **No DSH core changes and no replacement Agent / Session / Web / Compaction stack.**  
> DSH stays in control of session and execution lifecycle; LCX only extends missing native capabilities on GPT Responses routes.

---

## Why use it

If DSH already has a working GPT `openai-responses` route, LCX mainly solves three problems:

- **Keep one ordinary search entry**: the model continues to call native DSH `web_search`, while LCX maps it to the active GPT Hosted Search route.
- **Add advanced capabilities only when needed**: Advanced Hosted and Alpha Web Actions stay out of the tool catalog until explicitly enabled.
- **Prefer native long-session compaction**: Native V2 is integrated into the existing DSH compaction lifecycle while preserving continuation, restart and fork safety boundaries.

## Quick start

```powershell
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

Enable the plugin in **DSH Settings**, then turn on only the capabilities you need.

**Requirements**

- Node.js `>=20`
- a working GPT `openai-responses` route in DSH
- actual upstream support for the Hosted Search / Native V2 / Alpha capabilities you plan to enable

## Core capabilities

| Capability | User-visible behavior | Default |
|---|---|---:|
| **GPT Hosted Search** | Native DSH `web_search` follows the active GPT Responses route | Optional |
| **Advanced Hosted Search** | Domain filters, approximate location, search context, image search and other Hosted controls | Off |
| **Codex / Alpha Web Actions** | `search → open → find/click → screenshot` plus structured Web actions | Off |
| **Native V2 Compaction** | Long sessions prefer provider-native checkpoints | Optional |
| **Session continuity** | Continue after compact, restore after restart, safely migrate forks / models | Built in |

## Which search tool should I use?

The three entries have different jobs. You do not need to enable all of them.

| What you want to do | Entry | Best for |
|---|---|---|
| Ordinary web lookup | DSH `web_search` | General search, research and retrieval |
| Control Hosted Search parameters | `websearch_gpt_advanced` | Domain allow/block, approximate location, search context, image search and related controls |
| Browse pages or PDFs statefully | `websearch_alpha` | `search/open/find/click/screenshot` plus finance/weather/sports/time actions |

When GPT Hosted Search is enabled, the model still sees **only the native DSH `web_search` entry for ordinary search**. LCX replaces the SearchProvider instead of creating another duplicate search tool.

`websearch_gpt_advanced` is off by default. `websearch_alpha` is also off by default and is registered only after the exact endpoint / provider / model / schema passes a capability probe. Unknown deployments are not mislabeled as supported.

## Native V2 Compaction

LCX does not create a second compaction engine. DSH still owns pressure, compactable ranges, `/compact`, durable session transactions, tool-result pruning and overflow recovery. LCX only requests Responses Native V2 at the existing compaction LLM seam.

Default automatic policy:

```text
0% ─────────────────── 90% ───── 95% ───── 100%
       normal            Native      emergency   hard cap
                         V2          DSH prune
```

- **90%**: prefer Native V2.
- **95%**: emergency DSH pruning becomes allowed.
- provider-confirmed context overflow: keep DSH's original recovery path.
- manual `/compact`: keep the native DSH session transaction.

After compaction, the exact source session can directly reuse its own Native checkpoint. Forks or model migrations never send a parent's opaque state across sessions and use portable migration instead. Restart/resume rebuilds from the DSH session log.

## How it fits into DSH

```text
DSH Agent / Session / Web
├─ web_search ──────────> LCX SearchProvider ──> GPT Hosted Search
├─ Advanced / Alpha ────> LCX Web tools ───────> GPT Web actions
└─ compact / replay ────> LCX Native bridge ───> Responses Native V2
```

**DSH is the host; LCX is a compatibility extension.** The plugin prefers the active DSH route's `baseURL`, credential reference, headers, model and retry policy instead of maintaining a second account configuration.

For checkpoint internals, canonical replay, Pi serialization, cache identity, fork safety and pressure coordination, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Compatibility

Current formally verified stack:

| Plugin | DSH | DSH host Pi | Plugin Pi | Status |
|---|---|---|---|---|
| `0.4.0` | `0.1.1-rc.2` | `0.82.1` | `0.82.1` | **VERIFIED** |

A new DSH release is **not** assumed compatible. The project first reviews the DSH / Pi seams that changed and then runs risk-appropriate tests. A newer Pi registry version alone does not automatically upgrade the plugin dependency.

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

> `LCX` is only the project name. This is a community project and is not affiliated with OpenAI, DeepSeek, Sub2API or NewAPI.
