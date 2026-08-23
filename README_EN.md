<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="DSH-LCX-CODEX" width="100%" />

# DSH-LCX-CODEX

**Native GPT Responses search, compaction and replay semantics for DeepSeek Harness.**

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?color=1677ff&label=npm)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![Node](https://img.shields.io/badge/Node-%3E%3D20-2f855a)
![License](https://img.shields.io/badge/license-MIT-6b7280)

[简体中文](README.md) · **English** · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

</div>

---

## What it is

`dsh-lcx-codex` is a community plugin for **DeepSeek Harness (DSH)**. It does not replace DSH's Agent, Session, Web or Compaction systems. Instead, it extends existing `llm-pi-ai / openai-responses` routes with native GPT / Codex-style capabilities.

The design rule is simple: **DSH keeps ownership of session and execution lifecycle; the plugin only fills missing Responses semantics.**

```text
DSH Agent / Session / Web
          │
          ▼
     llm-pi-ai
          │
          ▼
 OpenAI Responses route
          │
    ┌─────┴───────────────┐
    │ dsh-lcx-codex       │
    │ Hosted / Alpha      │
    │ Native V2 Compact   │
    │ Replay / fidelity   │
    └─────────────────────┘
```

> `LCX` is only the project name. This project is not affiliated with OpenAI, DeepSeek, Sub2API or NewAPI.

## Capabilities

| Capability | Purpose | Default |
|---|---|---:|
| **DSH `web_search` → GPT Hosted Search** | Reuses the native DSH search entry and follows the active GPT Responses route | Optional |
| **Advanced Hosted Search** | Domain filters, location, search context, image search and other Hosted controls | Off |
| **Alpha Search** | Stateful Codex/Alpha actions such as `search/open/find/click/screenshot`; registered only after capability verification | Off |
| **Native Remote Compaction V2** | Requests provider-native checkpoints with Responses `compaction_trigger` | Optional |
| **Native-first pressure policy** | Native V2 at 90%; emergency DSH prune only at 95% | Optional |
| **Canonical replay** | Preserves response ids, reasoning/text metadata and tool-call identity using Pi Responses semantics | Built in |
| **Conversation fidelity retention** | Retains bounded user/assistant-visible facts across compaction | Built in |
| **Fork / restart safety** | Opaque state is same-session only; forks use portable migration; restart/resume is supported | Built in |

## Why both DSH and Pi matter

DSH's GPT `openai-responses` path is built on a Pi adapter. The plugin also directly uses Pi's public Responses converters to keep message, tool, reasoning and replayState semantics canonical.

Compatibility therefore has two layers:

```text
DSH host seams
  └─ session / fork / compaction / pruner / attachment / web / Cordis

Pi Responses seams
  └─ message conversion / tools / replayState / stream / stop reason
```

Verified stack:

| Plugin | DSH | DSH host Pi | Plugin Pi | Status |
|---|---|---|---|---|
| `0.4.0` | `0.1.1-rc.2` | `0.82.1` | `0.82.1` | **VERIFIED** |

A new DSH release is **not** assumed compatible. The project reviews changed host seams first, then runs only the tests warranted by the risk. A newer Pi registry version is an advisory, not an automatic dependency upgrade.

## Search

### DSH `web_search`

The plugin supplies a SearchProvider that maps ordinary DSH search to the active Agent's GPT Hosted Search without changing the `web_search` schema exposed to the model.

Hosted Search uses a separate cache namespace from the main Native replay conversation.

### `websearch_gpt_advanced`

Optional structured Hosted controls for domain filtering, location, search context and image search. It is off by default to avoid unnecessary tool-catalog drift.

### `websearch_alpha`

Stateful Codex/Alpha actions. The tool is registered only after a trusted capability probe matches the current endpoint/provider/model/schema. Auth errors, 5xx responses and unknown deployments remain `unknown` rather than being mislabeled as supported.

## Native V2 Compaction

DSH still owns pressure calculation, compactable ranges, durable session transactions, `/compact`, tool-result pruning and overflow recovery.

The plugin only replaces the compaction LLM seam with a Native V2 Responses request:

```text
DSH compaction transaction
        │
        └─ purpose=compaction
              │
              └─ POST /responses
                   x-codex-beta-features: remote_compaction_v2
                   input: [...canonical history, compaction_trigger]
```

Successful checkpoints are stored in the DSH append-only session log. Opaque checkpoint replay is allowed **only in the exact source session**. Parent/child ancestry authorizes portable migration, never direct reuse of a parent's opaque state.

### Conversation fidelity

Provider-native opaque compaction can omit low-salience assistant-only facts. The plugin therefore retains a bounded client/assistant-visible history alongside the Native V2 compaction item.

The goal is not byte-for-byte history retention. It is: **drop process, retain facts.**

## Automatic pressure policy

```text
0% ─────────────────── 90% ───── 95% ───── 100%
       normal            Native      emergency   hard cap
                         V2          DSH prune
```

A shared preset compaction service is mutex-protected so simultaneous high-pressure sessions cannot leak temporary pruner/config state into one another.

## Install

### Stable

```powershell
dsh plugin --profile web add dsh-lcx-codex
```

### Prerelease

```powershell
dsh plugin --profile web add dsh-lcx-codex@next
```

### Local tarball

```powershell
dsh plugin --profile web remove dsh-lcx-codex
dsh plugin --profile web add .\dsh-lcx-codex-0.4.0.tgz
dsh web
```

Do not delete DSH sessions or `$DSH_HOME/storages/lcx-codex/` merely to upgrade the plugin; historical compatibility data may still be referenced by older sessions.

## Recommended settings

```text
Enable plugin                         on
Use GPT Hosted Search                as needed
Advanced Hosted Search               off by default
Alpha Search                         off until capability verified

Native V2 remote compaction          on when upstream supports it
Native-first auto compaction         on
Native threshold                     90%
Emergency DSH prune                  95%
web_search timeout                   240s
```

Key fields include `remoteCompaction`, `autoCompaction`, `fallbackToBasicCompaction`, `autoCompactionThresholdPercent`, `emergencyPruneThresholdPercent`, `webSearchTimeoutSeconds`, `advancedHostedSearch` and `alphaSearch`.

## Requirements

- Node.js `>=20`
- **Verified DSH: `0.1.1-rc.2`**
- a working GPT `openai-responses` route in DSH
- upstream support for whichever Hosted Search / Native V2 / Alpha capabilities you enable

The plugin prefers the active DSH route's `baseURL`, credential reference, headers, model and retry policy instead of maintaining a second account configuration.

## Compatibility policy

Because this is a DSH plugin rather than a standalone provider SDK, DSH updates are reviewed against the host seams we actually depend on:

`session/event` · `requestHeader()` · `session.fork` · `agentPresets.serviceFor()` · compaction/pruner lifecycle · attachments · Web SearchProvider · DSH Web `/compact` · Pi Responses adapter.

Changes are classified by L0–L4 risk. Real DSH model budget is spent only when an update touches runtime-sensitive seams.

## Development

```bash
npm test
npm run test:schema
npm pack --ignore-scripts
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for design details and [CHANGELOG.md](CHANGELOG.md) for release history.

## License

MIT
