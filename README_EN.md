<div align="center">

<img src="assets/dsh-lcx-codex-banner.jpg" alt="dsh-lcx-codex" width="100%" />

[![npm](https://img.shields.io/npm/v/dsh-lcx-codex?color=1677ff&label=npm)](https://www.npmjs.com/package/dsh-lcx-codex)
[![CI](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml/badge.svg)](https://github.com/kk3ya03-star/dsh-lcx-codex/actions/workflows/publish.yml)
![DSH](https://img.shields.io/badge/DSH-0.1.1--rc.2-4ea8ff)
![License](https://img.shields.io/badge/license-MIT-6b7280)

[简体中文](README.md) · **English** · [Architecture](ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

</div>

Adds Native Compact / Replay, Hosted Search, and long-session continuation to the GPT / OpenAI Responses path in DSH.

The plugin only handles GPT. With LCX off, DSH works normally. With LCX on, the current GPT conversation uses LCX for Responses requests from the first turn. DSH still owns the Agent, Session, tool execution, and the decision of when to compact.

Current release: **0.4.2**

## Install

```powershell
dsh plugin --profile web add dsh-lcx-codex
dsh web
```

Requires:

- DSH `0.1.1-rc.2`
- Node.js `^22.19.0 || >=24.0.0`
- a working GPT Responses route in DSH

## LCX switch

```text
LCX OFF  → native DSH LLM path
LCX ON   → LCX sends Responses requests for the current GPT conversation
```

Turn LCX off before switching to Claude, Gemini, DeepSeek, or another non-GPT model. Switching models does not require a DSH restart.

## What it does

### Native Compact / Replay

DSH still decides when to compact. At the configured threshold, LCX prefers Responses Native V2:

```text
< 90%   normal
90%     prefer Native Compact
95%     allow DSH emergency prune
```

Manual `/compact` keeps the normal DSH transaction flow.

After Compact, the same session can continue through Replay and survive a DSH restart. If a GPT model or route is not compatible with the saved opaque state, LCX falls back to portable history instead of forcing that state into the request.

### Prompt Cache

Compatible GPT-5.6 routes use `prompt_cache_options`. Long conversations can keep reusing a warm prefix while the request shape stays stable.

Two common cases naturally start a new warm-up:

- Native Compact changes the history prefix;
- a skill registers new top-level tools and changes the `tools` schema.

The second case currently costs one cache miss, but tool execution remains correct. The plugin does not guess tool provenance just to avoid that miss.

### Hosted Search

Ordinary search still uses DSH's `web_search`. LCX changes the backend to GPT Hosted Search instead of exposing another ordinary-search tool.

Optional entries:

- `websearch_gpt_advanced` for domains, location, search context, image search, and similar controls
- `websearch_alpha` for `search / open / find / click / screenshot`

Alpha is off by default and is registered only after its capability probe passes.

## Suggested settings

| Setting | Suggested |
|---|---|
| Enable LCX | On for GPT conversations |
| Use GPT Hosted Search | As needed |
| Advanced Hosted Search | Off by default |
| Alpha Search | Off by default |
| Native-first auto compaction | On |
| Native threshold | `90%` |
| Emergency DSH prune | `95%` |
| Fallback to Basic Compaction | On |
| `web_search` timeout | `240s` |

## Compatibility

| Plugin | DSH | DSH host Pi | Plugin Pi |
|---|---|---|---|
| `0.4.2` | `0.1.1-rc.2` | `0.82.1` | `0.84.3` |

The plugin ships its own Pi `0.84.3` and does not override the Pi version used by DSH.

DSH `0.1.2-alpha.1`, 1.05M long context, and Programmatic Tool Calling are not part of the formal 0.4.2 support target.

## Development

```bash
npm run typecheck
npm test
npm run test:schema
npm pack --ignore-scripts
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for implementation details and [CHANGELOG.md](CHANGELOG.md) for release history.

## License

MIT

`LCX` is just the project name. This project is not affiliated with OpenAI, DeepSeek, Sub2API, or NewAPI.
