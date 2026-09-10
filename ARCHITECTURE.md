# LCX architecture — 0.4.3-pre.13

Current contract: **DSH 0.1.5-alpha.2, Session V3 and host/build Pi 0.85.1**. This is a model-scoped plugin, not a replacement DSH runtime. Older DSH/session/checkpoint formats are outside the current compatibility target. Historical architecture remains available in earlier Git versions; the summary below describes this candidate.

## Ownership and package boundary

- **DSH** owns provider/model configuration, credentials, agents, tools, session persistence, attachments, compaction ranges and durable transactions.
- **LCX** owns the enabled GPT Responses final request/transport/replay path and the bounded Grok native-search bridge. Unrelated model routes retain DSH behavior.
- **Pi 0.85.1 public exports** supply canonical Responses serialization/stream helpers and model data. A reproducible build bundles the needed runtime subset; the plugin does not ship the complete Pi SDK dependency tree into user profiles or replace host Pi.
- **The browser client** supplies settings, search-media previews and auxiliary usage presentation. Media controls do not change model requests, tools, history, usage or cache semantics.

`src/**` is strict TypeScript source. `lib/**` contains 51 reproducible generated files; the npm allowlist contains 32 files, including selected declarations, host/client JavaScript, plugin patch, license/notices, package metadata and README. Public tests and build scripts remain repository-only. No DSH Core patch or private control-plane material is included. Third-party licensing is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## GPT lifecycle and compaction

The compatibility layer projects exact DSH generate options, attachments and Session V3 history into the Pi-assisted Responses path. Ordinary generation, Native V2 compaction, same-route replay and portable route migration share the request builder. Native V2 uses a Responses request with a compaction trigger; it is not an implementation of every upstream compaction API.

DSH retains engine/range/transaction ownership. LCX integrates at the compaction-purpose call and coordinates compatible GPT pressure handling: remote-first near 90%, emergency pruning allowed at 95%. Grok remains on DSH compaction. Settings use the host's atomic namespace mutation rather than a second persistence layer.

Current `lcx-native-compaction-v5` state lives in the DSH session log's compaction result, not a second session database. Opaque replay requires compatible route/model and the same session identity. Cross-session or incompatible-route continuation uses validated portable history rather than another session's opaque state. Invalid/unsupported checkpoints fail closed. Retained client history and opaque provider state remain distinct from visible checkpoint text.

The shared transport bounds responses, cleans up streams on failure/cancellation and follows the DSH request-error boundary for ordinary requests. Native compaction retains bounded retry and eligible first-checkpoint fallback. Reopening a persisted DSH session restores compatible state; this is not Codex process-level rollout/restart-resume.

## Search, replay and accounting

GPT ordinary search keeps the host's single `web_search` surface. Advanced Hosted controls and Alpha remain separate tools. Active invocation scope supplies the calling route; no plugin-owned credential or model fallback is invented.

Grok native search adds xAI server-side `web_search` / `x_search`, suppresses the duplicate DSH `web_search` for that request, and preserves other local tools. Ordered provider-native output is stored for same-session/route continuation and cold reopen; server search is never represented as a fake local DSH tool call. Known renderer markers are filtered from visible prose, and no synthetic Sources list is appended. API-key/API-gateway authentication is supported; OAuth subscription login is not.

GPT auxiliary search billing is persisted separately from main-call usage and supplements UI totals without adding model content or pressure. Grok provider billing totals remain intact; upstream billing/context-occupancy contracts still limit pressure precision. GPT parent cache sharing does not imply shared history; Grok session/cache/replay identity stays independent for each child.

Alpha stores session/route-scoped reference provenance and rejects conflicting observations atomically. Search/collision protection is validated. Warm/cold opaque `open/find` continuation remains unresolved, and displayable screenshot delivery is not established. Capability probes do not prove every stateful action chain; references are not guessed or replaced with URLs to conceal failure.

## Client lifecycle and current limits

Search-media previews prefer structured metadata and conservatively handle direct media URLs. Owned observers, listeners, dialogs and players are disposed when the feature is disabled or the client fiber is actually disposed. Request-invariance tests cover the UI boundary. Changing host profile inventory does not recompose an already-open browser boot graph; reload remains required.

The exact alpha.2 usage-slot adapter fails closed on absent, ambiguous or unsupported shapes and restores only the wrapper it owns. A public immutable slot-owner identity is still unavailable. Dynamic-tool cache deltas and Grok aggregate billing/context pressure also remain upstream compatibility limits.

The standalone DSH pending-inbox patch is not part of this architecture or npm package. Installation and plugin acceptance use unmodified official DSH alpha.2; they do not imply that unrelated host defect is fixed.

## Validation

The accepted candidate has 370/370 plugin tests, strict host/client types, 4/4 schemas, 51/51 generated consistency and exact alpha.2 clean-profile installation evidence. Bounded real GPT/Grok and browser workflows complement these checks; unresolved capabilities above are excluded from success claims. See the [README](README_EN.md) for installation and reproducible build commands.
