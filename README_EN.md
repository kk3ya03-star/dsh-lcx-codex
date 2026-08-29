# dsh-lcx-codex

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?label=stable&color=1677ff)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![Node](https://img.shields.io/badge/Node-%5E22.19%20%7C%7C%20%3E%3D24-2f855a)
![Plugin Pi](https://img.shields.io/badge/plugin%20Pi-0.84.3-111827)
![License](https://img.shields.io/badge/license-MIT-6b7280)

[简体中文](README.md) · **English** · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md) · [Releases](https://github.com/kk3ya03-star/dsh-lcx-codex/releases)

> **Keep a DSH GPT Responses conversation on one final Responses wire owner from the first ordinary turn through tools, Native V2 Compact / Replay, restart recovery, and GPT model switching.**

`dsh-lcx-codex` does not replace DSH. DSH still owns the Agent, Session, model selection, tool execution, attachments, and compaction policy. When **LCX is ON**, LCX owns the final request / SSE wire for the selected GPT Responses conversation.

## Current stable release

**`0.4.2`** is the current stable release and a **zero-functional-change stable promotion** of the fully validated `0.4.2-pre.1` runtime.

```powershell
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

- npm dist-tag: `latest`
- DSH: `0.1.1-rc.2`
- Plugin Pi: `0.84.3`
- Node.js: `^22.19.0 || >=24.0.0`

`0.4.2-pre.1` remains a historical prerelease; new users should install `latest`.

## Product contract

```text
LCX OFF
= use the native DSH LLM path

LCX ON
= LCX owns the final Responses request / SSE wire
  for the selected GPT Responses conversation starting at ordinary turn 1
```

Turn LCX off before switching to Claude, Gemini, DeepSeek, or another non-GPT model. Model switching itself does not require a DSH restart.

## Why LCX exists

DSH already owns the Agent, Session, tools, and compaction lifecycle. LCX addresses the final provider-native GPT Responses layer: ordinary requests, tools, Native Compact, Replay, restart/resume, and GPT route migration no longer switch final wire owners inside one conversation.

```text
                        DSH
              Agent / Session / Tools
                         │
                 llm / stream seam
                         │
              ┌──────────┴──────────┐
              │                     │
           LCX OFF               LCX ON
              │                     │
       native DSH adapter      LCX Responses Core
                                    │
                         ordinary turn 1
                                    ↓
                                 tools
                                    ↓
                         Native V2 Compact
                                    ↓
                                Replay
                                    ↓
                           Restart / Resume
                                    ↓
                         GPT Model Migration
```

Compact therefore changes history representation without also changing request ownership.

## Core capabilities

### 1. Full GPT Responses lifecycle ownership

With LCX ON, ordinary requests, tool continuations, Native Compact, Native Replay, restart/resume, and portable GPT migration use one LCX Responses request-builder / transport owner.

DSH remains the canonical session/history owner. LCX does not create a second conversation database or replace the DSH Tool Executor.

### 2. GPT-5.6 Prompt Cache

`0.4.2` uses the current GPT-5.6 cache-options path and maintains stable cache identity inside a session:

- implicit caching by default;
- the supported route sends `prompt_cache_options.ttl = 30m`;
- ordinary consecutive turns and tool-heavy workloads can reuse warm prefixes;
- Native Compact intentionally creates a new history/cache epoch, so the old uncompressed prefix is not promised to remain reusable;
- real long-session validation repeatedly observed near-complete prefix reuse while request topology remained stable.

Cache reuse depends on provider behavior, model, request prefix, tool schemas, and session state; it is not a fixed performance guarantee.

One confirmed boundary: activating a skill at runtime can change the top-level tool schema and cause a one-time cache reset. The new topology warms again on the next request. The currently supported route rejects content-level `prompt_cache_breakpoint`, and DSH `0.1.1-rc.2` does not expose authoritative dynamic-tool provenance, so `0.4.2` preserves the safe one-time reset instead of guessing tool history.

### 3. Native V2 Compact + Replay

DSH still decides **when to compact, what range to compact, transaction boundaries, and recovery**. LCX owns only the provider-native Responses V2 wire.

Default pressure coordination:

```text
0% ─────────────────── 90% ───── 95% ───── 100%
       normal            Native      emergency   hard cap
                         V2          DSH prune
```

- `90%`: prefer Native V2;
- `95%`: allow emergency DSH tool-result pruning;
- provider-confirmed overflow stays with DSH recovery;
- manual `/compact` keeps the native DSH compaction transaction.

Native checkpoint v5 persists provider-native compaction state plus the portable retained history needed for fidelity. Compatible same-session routes can use Native replay; incompatible routes never reuse unsafe opaque state.

### 4. Restart / Resume + hot GPT switching

A single DSH session can continue through:

```text
Terra
  → Compact
  → Replay
  → Restart DSH
  → Resume same session
  → Switch to Sol
  → Continue
```

Compatible route/model resumes may restore Native opaque state. An incompatible GPT model / route drops unsafe opaque state and reconstructs portable history while remaining on LCX Responses transport.

### 5. Hosted Search + stateful Web Actions

Ordinary web search still uses DSH's native `web_search`. LCX can map its SearchProvider to the active GPT Hosted Search route instead of exposing a second ordinary-search tool.

| Need | Entry |
|---|---|
| Ordinary web search | DSH `web_search` |
| Advanced Hosted Search controls | `websearch_gpt_advanced` |
| Stateful page / PDF actions | `websearch_alpha` |

Alpha supports:

```text
search → open → find / click → screenshot
```

Alpha is off by default and is registered only after the current endpoint / provider / model / schema passes a capability probe. Unknown deployments fail closed.

### 6. Isolated Pi 0.84.3 upgrade

The plugin uses `@earendil-works/pi-ai 0.84.3` without overriding the DSH host dependency:

```text
DSH 0.1.1-rc.2
└─ host Pi 0.82.1      ← unchanged

dsh-lcx-codex 0.4.2
└─ plugin Pi 0.84.3    ← isolated plugin dependency
```

Pi owns canonical Responses message/tool serialization, reasoning, IDs, strict/grammar/custom tools, `additional_tools`, `tool_search`, namespace, and stream semantics. LCX does not maintain a second generic provider framework.

## Configure in 30 seconds

### Requirements

- Node.js `^22.19.0 || >=24.0.0`
- DSH `0.1.1-rc.2`
- a working GPT Responses route in DSH
- actual upstream support for the Hosted Search / Native V2 / Alpha capabilities you enable

### Suggested first-run settings

| Setting | Suggested | Notes |
|---|---:|---|
| Enable LCX | **On** | Own the current GPT Responses conversation |
| Use GPT Hosted Search | As needed | Use GPT Hosted Search behind DSH `web_search` |
| Advanced Hosted Search | Off | Enable only for advanced Hosted parameters |
| Alpha Search | Off | Enable after capability validation |
| Native-first auto compaction | On | Use Native-first pressure coordination |
| Native threshold | `90%` | Proactive Native V2 threshold |
| Emergency DSH prune | `95%` | Emergency prune threshold |
| Fallback to Basic Compaction | On | Allow bounded fallback after Native failure |
| `web_search` timeout | `240s` | Avoid premature timeout on slower Hosted Search |

### Verify observable behavior

| Capability | Expected behavior |
|---|---|
| LCX ownership | With LCX ON, the first GPT ordinary request already uses the LCX Responses path |
| Prompt Cache | Stable warm turns may report provider `cached_tokens` |
| Hosted Search | Ordinary entry remains DSH `web_search` |
| Advanced Hosted | `websearch_gpt_advanced` appears when enabled |
| Alpha | `websearch_alpha` appears only after capability validation |
| Native V2 | Compact produces provider-native checkpoint behavior rather than relabeling Basic Compaction |
| Replay | The same DSH session continues after Compact and remains resumable after restart |

## DSH / LCX responsibility boundary

| Component | Owns |
|---|---|
| **DSH** | Agent loop, Session/history, GenerateOptions, model/credential selection, tool execution, AttachmentStore, pressure policy, compaction transaction |
| **DSH compatibility seam** | Projects DSH messages / GenerateOptions into Pi Context and bridges results back to DSH |
| **Plugin Pi 0.84.3** | Canonical Responses serialization / parser semantics |
| **LCX** | ON/OFF ownership, final Responses body + HTTP/SSE wire, ordinary/compact/replay orchestration, Native opaque state, Search capabilities |

See [ARCHITECTURE.md](ARCHITECTURE.md) for checkpoint, portable replay, cache identity, RefStore, pressure coordination, and protocol details.

## Compatibility

| Plugin | DSH | DSH host Pi | Plugin Pi | Status |
|---|---|---|---|---|
| `0.4.2` | `0.1.1-rc.2` | `0.82.1` | `0.84.3` | **VERIFIED STABLE** |
| `0.4.1` | `0.1.1-rc.2` | `0.82.1` | `0.82.1` | historical stable |

DSH `0.1.2-alpha.1` and newer Pi versions are not part of the formal `0.4.2` compatibility claim. They will be validated by affected seam rather than assumed compatible automatically.

## Current boundaries

- The supported route uses implicit Prompt Cache. Content-level explicit breakpoints are rejected on that route and are not exposed as a product setting.
- Dynamic skills/plugins that change the top-level tool schema can trigger a one-time prompt-cache reset; functionality remains correct and the new topology warms again.
- `reasoning.context` / `reasoning.mode` remain host/Pi exposure boundaries; LCX does not invent a second control surface.
- The normal operational context profile remains in the ~`262K` class; 1.05M long context is not enabled by default.
- Credentialed `ALPHA-004` runtime coverage remains `NOT_COVERED`, while fail-closed behavior is covered by tests.
- Programmatic Tool Calling is not currently advertised as supported.

## FAQ

<details>
<summary><strong>Why do I need to turn LCX off before switching to a non-GPT model?</strong></summary>

LCX ON is a GPT Responses lifecycle ownership switch, not a universal multi-model proxy. Non-GPT models continue through native DSH adapters.

</details>

<details>
<summary><strong>Why is web_search still the same tool?</strong></summary>

By design. LCX changes the SearchProvider behind DSH `web_search` instead of exposing two ordinary search tools to the model.

</details>

<details>
<summary><strong>Why is Alpha sometimes missing?</strong></summary>

That is fail-closed behavior. `websearch_alpha` is not registered until the active route/schema passes capability probing.

</details>

<details>
<summary><strong>Why can a skill load cause the cache to warm again?</strong></summary>

Some skills dynamically register new top-level tools. Tool schemas are part of the cacheable prompt prefix, so a topology change can establish a new cache epoch. `0.4.2` prioritizes correct tool definitions instead of guessing provenance to force reuse of an old cache.

</details>

## Development and verification

```bash
npm run typecheck
npm test
npm run test:schema
npm pack --ignore-scripts
```

- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- GitHub Releases: [Releases](https://github.com/kk3ya03-star/dsh-lcx-codex/releases)
- npm: [`dsh-lcx-codex`](https://www.npmjs.com/package/dsh-lcx-codex)

## License

MIT

> `LCX` is only the project name. This is a community project and is not affiliated with OpenAI, DeepSeek, Sub2API, or NewAPI.
