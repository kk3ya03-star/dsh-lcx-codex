# dsh-lcx-codex

[![npm stable](https://img.shields.io/npm/v/dsh-lcx-codex?label=stable&color=1677ff)](https://www.npmjs.com/package/dsh-lcx-codex)
[![npm prerelease](https://img.shields.io/npm/v/dsh-lcx-codex/prelatest?label=prelatest&color=7c3aed)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![Node](https://img.shields.io/badge/Node-%5E22.19%20%7C%7C%20%3E%3D24-2f855a)
![Plugin Pi](https://img.shields.io/badge/plugin%20Pi-0.84.3-111827)
![License](https://img.shields.io/badge/license-MIT-6b7280)

[简体中文](README.md) · **English** · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md) · [Releases](https://github.com/kk3ya03-star/dsh-lcx-codex/releases)

> **Keep a DSH GPT Responses conversation on one request lifecycle owner from the first ordinary turn through tools, Prompt Cache, Native V2 Compact / Replay, restart recovery, and GPT model switching.**

`dsh-lcx-codex` does not replace the DSH Agent, Session, Tool Executor, or compaction policy. DSH remains the host; when **LCX is ON**, LCX owns the final request / SSE wire for the selected GPT Responses conversation.

## Release status

| Channel | Version | npm dist-tag | Status |
|---|---:|---|---|
| Stable | `0.4.1` | `latest` | **VERIFIED STABLE** |
| Prerelease | `0.4.2-pre.1` | `prelatest` | **VERIFIED PRERELEASE** |

`0.4.2-pre.1` is the current architecture prerelease and has passed real DSH + Sub2API release-candidate validation. Stay on `latest` for the conservative stable path; use `prelatest` for full GPT Responses lifecycle ownership, plugin Pi 0.84.3, and the updated Prompt Cache path.

```powershell
# Stable
dsh plugin --profile web add dsh-lcx-codex

# 0.4.2 prerelease
dsh plugin --profile web add dsh-lcx-codex@0.4.2-pre.1

dsh web
```

## Why LCX exists

DSH owns the Agent, Session, tool execution, model selection, and compaction policy. But if ordinary GPT Responses requests, Native Compact / Replay, cache identity, and provider-native state are constructed by different wire owners, long conversations can cross an unnecessary lifecycle boundary.

`0.4.2-pre.1` unifies that path:

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
                             Prompt Cache
                                    ↓
                         Native V2 Compact
                                    ↓
                                Replay
                                    ↓
                           Restart / Resume
                                    ↓
                         GPT Model Migration
```

### Product contract

```text
LCX OFF
= use the native DSH LLM path

LCX ON
= LCX owns the final wire for the selected GPT Responses conversation
  starting with ordinary turn 1
```

Turn LCX off before switching to Claude, Gemini, DeepSeek, or another non-GPT model. Model switching itself does not require a DSH restart.

## Core capabilities

### 1. Full GPT Responses lifecycle ownership

With LCX ON, ordinary requests, tool continuations, Native Compact, Native Replay, restart/resume, and portable GPT model migration use one request builder / transport owner.

Compact is therefore a history-representation transition, not a simultaneous history + request-owner transition.

### 2. GPT-5.6 Prompt Cache

`0.4.2-pre.1` uses the updated GPT-5.6 Prompt Cache path:

- implicit caching by default;
- `prompt_cache_options.ttl = 30m`;
- stable prompt-cache identity inside a session;
- reusable prefixes across ordinary / tool / compact / replay / restart epochs where the provider permits it;
- the final real RC workload observed `60,928` cached input tokens on a warm request.

Cache reuse depends on the provider, model, prefix, and session state. The number above is an observed acceptance result, not a fixed performance guarantee.

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

Native v5 checkpoints no longer retain a duplicate per-request canonical developer/system prelude. Repeated Compact → Replay cycles do not linearly accumulate high-priority prompts, and retained assistant-visible copies preserve valid `phase` semantics.

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

Compatible model/route resumes may reuse Native opaque state. An incompatible GPT model / route drops unsafe opaque state and reconstructs portable history while remaining on LCX Responses transport.

### 5. Hosted Search + stateful Web Actions

Ordinary search still uses DSH's native `web_search`; LCX can map its SearchProvider to the active GPT Hosted Search route instead of exposing a second ordinary-search tool.

| Need | Entry |
|---|---|
| Ordinary web search | DSH `web_search` |
| Advanced Hosted Search controls | `websearch_gpt_advanced` |
| Stateful page / PDF actions | `websearch_alpha` |

Alpha supports:

```text
search → open → find / click → screenshot
```

It is off by default and is registered only after the current endpoint / provider / model / schema passes a capability probe. Unknown deployments fail closed.

### 6. Isolated Pi 0.84.3 upgrade

The plugin uses `@earendil-works/pi-ai 0.84.3` without overriding the DSH host dependency:

```text
DSH 0.1.1-rc.2
└─ host Pi 0.82.1      ← unchanged

dsh-lcx-codex 0.4.2-pre.1
└─ plugin Pi 0.84.3    ← isolated plugin dependency
```

Pi owns canonical Responses message/tool serialization, reasoning, IDs, strict/grammar/custom tools, `additional_tools`, `tool_search`, namespace, and stream semantics. LCX does not maintain a second generic provider framework.

## Get started in 30 seconds

### Requirements

- Node.js `^22.19.0 || >=24.0.0`
- DSH `0.1.1-rc.2`
- a working GPT Responses route in DSH
- actual upstream support for any Hosted Search / Native V2 / Alpha capability you enable

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
| Prompt Cache | Warm continuations may report provider `cached_tokens` |
| Hosted Search | Ordinary entry remains DSH `web_search` |
| Advanced Hosted | `websearch_gpt_advanced` appears when enabled |
| Alpha | `websearch_alpha` appears only after capability validation |
| Native V2 | Compact produces provider-native checkpoint behavior instead of relabeling Basic Compaction |
| Replay | The same DSH session continues after Compact without duplicate canonical prelude |

## DSH / LCX responsibility boundary

| Component | Owns |
|---|---|
| **DSH** | Agent loop, Session/history, GenerateOptions, model/credential selection, tool execution, AttachmentStore, pressure policy, compaction transaction |
| **DSH rc.2 compatibility seam** | Projects DSH messages / GenerateOptions into Pi Context and bridges results back to DSH |
| **Plugin Pi 0.84.3** | Canonical Responses serialization / parser semantics |
| **LCX** | ON/OFF ownership, final Responses body + HTTP/SSE wire, ordinary/compact/replay orchestration, Native opaque state, Search capabilities |

See [ARCHITECTURE.md](ARCHITECTURE.md) for checkpoint, portable replay, cache identity, RefStore, pressure coordination, and protocol details.

## Compatibility

| Plugin | DSH | DSH host Pi | Plugin Pi | Status |
|---|---|---|---|---|
| `0.4.1` | `0.1.1-rc.2` | `0.82.1` | `0.82.1` | **VERIFIED STABLE** |
| `0.4.2-pre.1` | `0.1.1-rc.2` | `0.82.1` | `0.84.3` | **VERIFIED PRERELEASE** |

New DSH / Pi / gateway versions are not assumed compatible automatically; affected seams are validated incrementally.

## Current boundaries

`0.4.2-pre.1` validates the core lifecycle while keeping these boundaries explicit:

- the current DSH/Pi host vocabulary does not expose `prompt_cache_breakpoint`, so this stack cannot place explicit cache breakpoints manually;
- `reasoning.context` / `reasoning.mode` remain host/Pi exposure boundaries; LCX does not invent a second control surface;
- the normal operational context profile remains in the ~`262K` class; 1.05M long context is not enabled by default;
- credentialed `ALPHA-004` runtime coverage remains `NOT_COVERED`, while fail-closed behavior is covered by tests;
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

That is the fail-closed behavior. `websearch_alpha` is not registered until the active route/schema passes capability probing.

</details>

<details>
<summary><strong>Why is npm latest still 0.4.1?</strong></summary>

`0.4.2-pre.1` is a verified prerelease, while stable promotion is a separate release decision. Install `@0.4.2-pre.1` explicitly if you want the new lifecycle architecture now.

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
