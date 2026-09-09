<div align="center">

<img src="https://raw.githubusercontent.com/kk3ya03-star/dsh-lcx-codex/main/assets/dsh-lcx-codex-banner.svg" alt="LCX Codex" width="100%" />

# LCX Codex

**GPT Responses lifecycle capabilities plus native Web / X Search for Grok in DeepSeek Harness.**

[![npm prerelease](https://img.shields.io/npm/v/dsh-lcx-codex/prelatest?label=prelatest)](https://www.npmjs.com/package/dsh-lcx-codex)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--alpha.1-16803c)](#installation)
[![License](https://img.shields.io/badge/license-MIT-555)](LICENSE)

[简体中文](README.md) · **English** · [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues)

</div>

LCX Codex is a community plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (DSH). It activates capabilities by the selected model: GPT can use remote native compaction plus Hosted / Alpha Search, while Grok can use xAI Responses native `web_search` and `x_search`. Other models remain on DSH's native path.

Models, endpoints, API keys / credentials, sessions, and tools remain DSH-owned. GPT and Grok feature switches are independent. Grok native search currently supports API-key / API-gateway routes; xAI OAuth / SuperGrok login is outside this release.

## Installation

This page documents **`0.4.3-pre.12`**, supporting only **DSH `0.1.5-alpha.1` + Pi `0.85.1`**. Stable remains `0.4.2`; this prerelease does not keep compatibility layers for older DSH or Session formats.

Before installing, make sure DSH Web starts correctly and that the GPT Responses or Grok Responses API route you intend to use is configured in DSH. Node.js requires `^22.19.0 || >=24.0.0`. DSH `0.1.5-alpha.1` was qualified on Windows without the old `0.1.3-alpha.2` `fs-ext` workaround.

```sh
dsh plugin --profile web add dsh-lcx-codex@0.4.3-pre.12
dsh web
```

For later prerelease updates, use `dsh plugin --profile web add dsh-lcx-codex@prelatest`. Installing without a version or dist-tag still selects stable, **not this prerelease**.

**Upgrading to this prerelease:** only DSH `0.1.5-alpha.1` Session V3 is supported. Old plugin configuration, old DSH sessions, old LCX checkpoints, and older Grok replay envelopes are not migrated into the active session root. To retain old history, rename/archive the old `sessions` directory and let DSH `0.1.5-alpha.1` start from a fresh empty `sessions` root; keep the old data only as an offline backup.

When DSH persistence reopens the same saved session, LCX can restore its persisted v5 checkpoint. This is ordinary continuation over DSH session persistence, **not a Codex-style process-level rollout/checkpoint restart/resume mechanism**.

## Enable the Plugin

Open DSH Web plugin settings, expand **Responses / Codex capabilities**, and enable only what you need:

| Switch | Use it when |
| --- | --- |
| Enable LCX | You want GPT Responses lifecycle ownership, Native V2 compaction, or GPT search features. |
| GPT Hosted Search | The active model is GPT and needs ordinary web search. |
| Advanced Hosted tool | GPT needs image search, domain filters, location, or other Hosted controls. |
| Alpha | GPT needs stateful `open / find / click / screenshot` web actions; experimental. |
| Grok native Web Search | The active model is Grok and should use xAI server-side web search. |
| Grok native X Search | The active model is Grok and should search X directly. |

**All six switches default off.** The four GPT features are governed by the GPT LCX switch; the two Grok switches are independent and do not require GPT lifecycle ownership. Model, reasoning level, image capability, endpoint, and credential remain configured in DSH.

Model switching requires no plugin restart:

- GPT → only the enabled GPT / LCX capabilities apply;
- Grok → only the enabled native Web / X Search capabilities apply; when either Grok search is enabled, DSH `web_search` is not advertised on that request, while `web_fetch` and unrelated DSH/MCP tools remain available;
- Claude, Gemini, DeepSeek, and other models → native DSH conversation, search, tool, and compaction behavior remains in control.

## Web and Image Search

### GPT Web Search

GPT keeps DSH's single ordinary `web_search` tool surface. With **GPT Hosted Search** enabled, LCX executes Hosted Search through the active GPT Responses route. Enable `websearch_gpt_advanced` only for controls such as domains, location, search context, or images.

### Grok Native Web / X Search

Grok receives xAI Responses server-side tools directly rather than function wrappers:

```text
{ type: "web_search" }
{ type: "x_search" }
```

When either native Grok search is enabled, DSH `web_search` is removed from that Grok request to avoid duplicate search semantics. `web_fetch`, `read`, and unrelated DSH/MCP function tools remain available. A native search can therefore flow into a local tool and continue in the same agentic workflow. Provider-native search state is replayed as xAI state, never as fake DSH local tool calls.

This release supports **API-key / API-gateway** routes. xAI OAuth / SuperGrok / X Premium subscription login is not supported. LCX no longer appends a visible synthetic `Sources:` block for Grok and filters known upstream renderer artifacts such as `render_inline_citation`, `stateless_invoke`, private-use-area renderer tokens, and trailing `<|eos|>`. Ordinary links intentionally written in answer text remain visible. Complete provider-native search output is retained only in same-session replay state.

### Find and Display Images with GPT

With the advanced Hosted tool enabled, ask naturally, for example:

> Find a photo of the Golden Gate Bridge, display one result inline, and include the source page.

You do **not** need to write JSON arguments. The model selects the image-search parameters. These are existing web images, not image generation, and display still depends on the source URL being reachable.

### Alpha Web Actions

`websearch_alpha` supports `search / open / find / click / screenshot` for stateful GPT web reading. It acts on upstream search-service content, not your local browser or DSH UI.

Alpha appears only after a matching capability probe. References may still fail intermittently, and screenshot delivery as a displayable image is not verified. Ordinary GPT search/image search and Grok native search do not require Alpha.

## Long Conversations and Compaction

With LCX enabled, the plugin sends DSH's compaction request to the upstream GPT route for **Native V2 remote compaction**, then feeds the result back into the current session. DSH still owns persistence, tool execution, and the compaction transaction.

| Context usage | Behavior |
| --- | --- |
| Below `90%` | Continue normally without early tool-result pruning. |
| `90%` to below `95%` | Prefer remote native compaction. |
| At least `95%` | Allow DSH emergency tool-result pruning, then follow its compaction workflow. |

Use `/compact` for manual compaction. These thresholds are fixed policy, not additional settings. Compaction requires an eligible history range and upstream support. Grok does not use GPT Native V2; it continues through DSH `0.1.5-alpha.1` compaction, with the Session V3 leading `system/message` kept outside the summary.

You can continue after compaction in the same live session. If DSH itself reopens the same persisted session, LCX validates and restores its v5 checkpoint. For incompatible model, route, or session identities, LCX uses portable history instead of forcing native-state reuse. Some recoverable failures while creating the first checkpoint can fall back to DSH basic compaction; not every failure qualifies. LCX does not add Codex-style rollout/checkpoint restart-resume.

## Caching

Caching is implemented by the upstream provider; the plugin preserves provider-compatible cache/session identity.

- **GPT:** keeps LCX's existing product policy. Foreground sessions and their subagents may share the parent's prompt-cache identity to reuse common request prefixes; their actual DSH Sessions, tools, and private history remain separate.
- **Grok:** follows native DSH/Pi semantics. Each foreground or subagent uses its own DSH Session ID for prompt-cache/session-affinity identity, and sibling subagents cannot restore each other's opaque replay state.

Pi `0.85.1` explicit cache mode supports a `30m` long-retention option. With `cacheRetention=none`, no prompt-cache key is sent. Compaction, model changes, or tool-schema changes may require a new cache prefix.

## Troubleshooting

**Should I keep the old Windows `fs-ext` patch after upgrading?**

No. Do not carry the DSH `0.1.3-alpha.2` `fs-ext` workaround into `0.1.5-alpha.1`. This release was qualified with an unmodified Windows DSH `0.1.5-alpha.1` Web and headless runtime. If the old installation was patched manually, obtain clean `0.1.5-alpha.1` package files through a normal reinstall/upgrade rather than copying the old modified file forward.

**Nothing changes after installation?**

Check that installation and startup use the same `web` profile, then verify the switches for the active model were saved. The GPT master switch and Grok Web/X switches are independent.

**Conversation works, but search or compaction fails?**

A working Responses chat does not guarantee Native V2, Hosted/Alpha, or Grok native Web/X Search support. Verify the selected route exposes the required server-side capability; a gateway product name alone does not guarantee it.

## Versions and Test Coverage

This release targets DSH `0.1.5-alpha.1`, DSH host Pi `0.85.1`, and plugin Pi `0.85.1`. The plugin carries its own Pi dependency and does not replace DSH's copy.

Release qualification was rerun against DSH `0.1.5-alpha.1`, including the changed Session V3/system-history path rather than relying on the previous pre.4 online matrix.

Release gates pass **246/246 tests**, strict host/client typechecks, and DSH schema validation. Real isolated DSH `0.1.5-alpha.1` coverage includes Web startup, a headless GPT ordinary request, Session V3 `system/message`, Native V2 `/compact`, same-session post-compact continuation, and v5 checkpoint session-identity binding.

Grok also has a real long-session qualification: native Web Search → enough conversation history for an actual DSH `/compact` → native search/continuation after compaction. The marker and key fact were retained, `system/message` appeared once, replay used the current v3 envelope, and final visible output reported `sourceLeak=false`.

Prerelease boundaries remain: Alpha references/screenshot display, proxy/NO_PROXY, broader concurrency/cancellation, and background continuable-subagent matrices are not fully covered; Grok OAuth is unsupported; unknown future upstream renderer protocols may still require adaptation. DSH `0.1.5-alpha.1` itself remains an alpha/developer-preview upstream.

## Development and Feedback

```sh
npm ci --ignore-scripts
npm ci --prefix scripts/runtime-dsh015 --ignore-scripts
node scripts/link-dsh-runtime.mjs scripts/runtime-dsh015
node scripts/check-generated.mjs
npm run typecheck
npm test
npm run test:schema
```

See [Architecture](ARCHITECTURE.md) for implementation details. When opening an [issue](https://github.com/kk3ya03-star/dsh-lcx-codex/issues), include plugin, DSH, and Node.js versions and reproduction steps. Do not upload API keys, full requests, or unredacted session logs.

## License

[MIT](LICENSE). Independent community plugin, not affiliated with or endorsed by OpenAI, DeepSeek, Sub2API, or NewAPI. The DeepSeek name and mark belong to their respective rights holder.
