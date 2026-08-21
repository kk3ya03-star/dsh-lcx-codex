<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.jpg" alt="DSH-LCX-CODEX" width="100%" />

# DSH-LCX-CODEX

**OpenAI Responses / Codex-native capabilities for DeepSeek Harness.**

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?color=1677ff&label=npm)](https://www.npmjs.com/package/dsh-lcx-codex)
![Node](https://img.shields.io/badge/Node-%3E%3D20-1677ff)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![License](https://img.shields.io/badge/license-MIT-1677ff)

[简体中文](README.md) · **English**

</div>

---

`dsh-lcx-codex` is a community DSH plugin for GPT routes already configured through `llm-pi-ai / openai-responses`. It keeps DSH's Agent, Web, Session and Compaction ownership intact and fills the provider-native gaps.

> `LCX` is only the project name. This project is not affiliated with OpenAI, DeepSeek, Sub2API or NewAPI.

- **Current DSH image pipeline**: Native V2 reuses `readImageRequest()` and the active route image budgets, so compaction and ordinary GPT requests see the same deterministic image variants.

## Features

| Capability | What it does | Default |
|---|---|---:|
| **DSH `web_search` → GPT Hosted Search** | Uses DSH's existing ordinary search tool; rc.7+ follows the active Agent GPT Responses model | opt-in |
| **Advanced Hosted Search** | Native domain/location/context/image search controls | off |
| **Alpha Search** | Stateful `search/open/find/click/screenshot`-style commands, capability-gated | off |
| **Native Remote Compaction V2** | Uses Responses `compaction_trigger` and provider-native opaque state | opt-in |
| **Conversation fidelity retention** | Bounded user + assistant-visible history protects low-salience facts | built-in |
| **Session-native checkpoints** | Durable state lives in the DSH append-only session log | built-in |
| **Native-first auto compaction** | 90% Native V2, 95% emergency DSH pruning; configurable | opt-in |
| **Long web timeout** | DSH `web_search` deadline defaults to 240s, configurable 30–600s | built-in |

## rc.8: DSH 0.1.1-rc.2 native alignment

rc.8 targets **DSH 0.1.1-rc.2** directly. Ordinary Hosted Search still follows the active Agent route, while Native V2 image serialization now uses DSH's `readImageRequest()` request-version pipeline instead of reading attachment master bytes.

Search routing still crosses DSH's `tools/execute` → SearchProvider boundary without changing the model-visible `web_search` schema:

```text
Agent: lcx / gpt-5.6-luna
        └─ DSH web_search
             └─ Hosted Search: lcx / gpt-5.6-luna
```

The settings-page model is now a **fallback** used only when no active Agent route is available.

Hosted Search also receives its own stable cache namespace:

```text
conversation replay: dsh-lcx:<route hash>
hosted search:       dsh-lcx-search:<route hash>
```

A search row with a low cache hit in NewAPI therefore does not imply conversation truncation.

## Native V2 Compaction

DSH continues to own pressure, range selection, pruning, durable replacement, `/compact`, and overflow recovery. The plugin replaces only the `purpose: compaction` summarizer transport with Native V2:

```text
DSH compaction transaction
        └─ purpose=compaction
              └─ /responses + compaction_trigger
```

Native success means zero basic-summary request. Basic summary runs only if Native fails and fallback is enabled.

## Conversation fidelity layer

Provider-native opaque compaction is intentionally lossy. Real long-session tests showed that assistant-only details can disappear even when the opaque checkpoint itself is valid. The current checkpoint therefore keeps:

```text
bounded client-visible history
+ bounded assistant-visible final answers
+ opaque Native V2 compaction item
```

The explicit prefix is bounded at roughly 64k estimated tokens, with up to about 24k reserved for assistant answers and about 3k per retained assistant answer. Reasoning, raw tool traces, large search payloads and telemetry are not copied back into the prompt.

The goal is not byte-for-byte replay. It is **drop process noise, retain conversation facts**.

## Automatic compaction

```text
0% -------------------- 90% ----- 95% ----- 100%
        normal             Native   emergency   hard cap
                           V2       DSH prune
```

Default behavior:

- below 90%: suppress stock 80% pressure pruning for compatible Native sessions;
- 90–95%: Native V2 first;
- 95%+: DSH's replay-safe tool-result pruning may run as an emergency guard;
- provider-confirmed context overflow keeps DSH's normal recovery path;
- manual `/compact` is unaffected.

## Cache behavior

A provider cache miss is not the same thing as DSH deleting history.

Observed real-world pattern:

```text
turn N:   ~155k uncached, cacheRead 0
turn N+1: ~1k new input, ~155k cacheRead
```

That means the full context was resent and cached again. Prefix-changing operations include compaction, emergency pruning, route/model changes, and other DSH surface replacement. Restart/idle/provider cache TTL may also force a cold request independently of this plugin.

## Search modes

### Ordinary `web_search`

Recommended default. It follows the current Agent GPT Responses route.

### `websearch_gpt_advanced`

Opt in only for Hosted-only parameters such as domain filters, approximate location, search-context size and image search. Keeping it disabled avoids unnecessary tool-catalog churn.

### `websearch_alpha`

Stateful Codex/Alpha-style `search/open/find/click/screenshot`; registered only after a matching capability probe.

## Installation

Stable channel:

```powershell
dsh plugin --profile web add dsh-lcx-codex
```

Pre-release channel (current rc.8):

```powershell
dsh plugin --profile web add dsh-lcx-codex@next
```

Local RC:

```powershell
dsh plugin --profile web remove dsh-lcx-codex
dsh plugin --profile web add .\dsh-lcx-codex-0.4.0-rc.8.tgz
dsh web
```

Do not delete existing sessions or `$DSH_HOME/storages/lcx-codex/` just to upgrade. The legacy v3 sidecar remains read-only compatibility state.

## Recommended settings

```text
Enable plugin                         on
GPT Hosted Search                     on
Advanced Hosted Search               off
Alpha Search                         off
Native V2 remote compaction          on
Native-first auto compaction         on
Native threshold                     90%
Emergency DSH prune                  95%
web_search timeout                   240s
```

## Requirements

- Node.js >= 20
- DSH 0.1.1-rc.2
- a working GPT `openai-responses` route in DSH
- an upstream that actually supports the enabled Hosted Search / Native V2 / Alpha capabilities

Typical paths include direct Sub2API and NewAPI-relayed Responses routes.

## Release channels

Stable releases use npm's `latest` tag. `0.4.0-rc.*` builds publish to npm's `next` tag. GitHub tags must match `package.json`; Trusted Publishing runs tests before publishing.

## Development

```bash
npm test
npm run test:schema
npm pack --ignore-scripts
```

See [ARCHITECTURE.md](ARCHITECTURE.md) and [CHANGELOG.md](CHANGELOG.md) for implementation details.

## License

MIT
