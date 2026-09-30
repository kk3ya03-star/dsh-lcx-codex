# LCX architecture — 0.5.0-pre.1

This prerelease targets the DSH 0.2 contract. Its validated/accepted release baseline is **DSH 0.2.0-rc.2, Session V4 and host/plugin Pi 0.87.1**. Public DSH peers use the bounded `>=0.2.0-rc.2 <0.2.1` install/assessment range; later in-range releases require their own compatibility evidence. The stable `0.4.3` line (DSH 0.1.5) is documented in earlier Git versions of this file. This is a model-scoped plugin, not a replacement DSH runtime.

## Ownership and package boundary

- **DSH** owns provider/model configuration, credentials, agents, tools, session persistence and migration, attachments, compaction ranges, durable transactions and context-pressure measurement.
- **LCX** owns the enabled GPT Responses final request/transport/replay path and the bounded Grok native-search bridge. Unrelated model routes retain DSH behavior.
- **Pi 0.87.1 public exports** supply canonical Responses serialization/stream helpers and model data. A reproducible build bundles the needed runtime subset; the plugin does not ship the complete Pi SDK dependency tree into user profiles or replace host Pi.
- **The browser client** supplies settings, search-media presentation and auxiliary usage presentation. Presentation controls do not change model requests, tools, history, usage or cache semantics.

`src/**` is strict TypeScript source. `lib/**` contains 57 reproducible generated files; the npm allowlist yields a 35-file package with selected declarations, host/client JavaScript, the plugin patch, license/notices, package metadata and README. Tests, test fixtures and build scripts remain repository-only. No DSH Core patch or private control-plane material is included. Third-party licensing is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## GPT lifecycle and compaction

The compatibility layer projects exact DSH generate options, attachments and Session V4 history into the Pi-assisted Responses path, including DSH `role: 'tool'` messages (multi-step, error and image results) and dynamic tool changes. Ordinary generation, Native V2 compaction, same-route replay and portable route migration share the request builder. Native V2 uses a Responses request with a compaction trigger; it is not an implementation of every upstream compaction API. DSH's current compaction directive is excluded from Native input.

DSH retains engine/range/transaction ownership and its own pressure trigger. LCX coordinates compatible GPT pressure handling against DSH's pressure budget (`window - output reserve - headroom`): remote-first near 90%, emergency pruning allowed at 95%. DSH may compact first when its own trigger fires. Grok remains on DSH compaction.

Current `lcx-native-compaction-v5` state lives in the DSH session log's compaction result, not a second session database. Opaque replay requires a compatible route/model and the same session identity; cross-session or incompatible-route continuation uses validated portable history instead of another session's opaque state. When DSH 0.2 migrates an older session, LCX does not convert a previous-format checkpoint: on the LCX path it reports `LCX_CHECKPOINT_UNSUPPORTED` and a new session is required. Quoted checkpoint markers inside ordinary tool output are not treated as checkpoints. Retained client history and opaque provider state remain distinct from visible checkpoint text.

The shared transport bounds responses, cleans up streams on failure/cancellation and follows the DSH request-error boundary for ordinary requests. Native compaction retains bounded retry and eligible first-checkpoint fallback. Reopening a persisted DSH session restores compatible state; this is not Codex process-level rollout/restart-resume.

## Search, replay and accounting

GPT ordinary search keeps the host's single `web_search` surface. Advanced Hosted controls and Alpha remain separate tools, and scoped tools are re-synchronized when a session's selected model/route changes, so the next request advertises the correct set. Active invocation scope supplies the calling route; no plugin-owned credential or model fallback is invented. Blank or irrelevant optional Hosted arguments (for example an empty location or image settings without image search) are treated as omitted; invalid non-empty values still fail closed.

Grok native search adds xAI server-side `web_search` / `x_search`, suppresses the duplicate DSH `web_search` for that request, and preserves other local tools. Ordered provider-native output is stored for same-session/route continuation and cold reopen; server search is never represented as a fake local DSH tool call. API-key/API-gateway authentication is supported; OAuth subscription login is not.

Grok agentic calls report provider usage that is cumulative across internal server-side requests. LCX keeps that canonical usage and DSH turn accounting unchanged. For context pressure, when an aggregate-scoped terminal response carries complete `usage.context_details`, LCX anchors pressure on `context_details.input_tokens` plus DSH's own signed surface delta and records provider provenance; otherwise it falls back to a retained-surface plus tool-schema estimate. Because DSH 0.2 has no provider-exact baseline kind, the measurement is exposed to DSH as `estimated`. GPT auxiliary search billing is persisted separately from main-call usage and supplements UI totals without adding model content or pressure.

Alpha stores session/route-scoped reference provenance and rejects conflicting observations atomically. Stateful search, open, find, click, PDF screenshot, cold-process continuation, fork isolation and model-route switching are validated on the tested OAuth-backed upstream; API-key upstream accounts are outside that claim. A target-page fetch failure is reported as `LCX_ALPHA_PAGE_FETCH_FAILED` rather than as missing capability. A search-only backend and a real provider result crossing the spill threshold were not covered at runtime; deterministic spill/cold-locator coverage passes. References are not guessed or replaced with URLs to conceal failure.

## Client presentation and current limits

Search media follows a fixed ownership boundary. DSH owns Markdown images and its image lightbox; LCX adds one scoped CSS rule so a Markdown image in an answer starts its own line, independent of the preview setting. With previews enabled, LCX renders structured provider image candidates and plain direct image links from the answer as one image rail under the owning response (natural proportions, sideways scrolling, DSH's public `ImageLightbox` with an LCX dialog fallback) and direct playable video URLs as cards that load nothing until clicked and then play inline. Page links stay ordinary links and Markdown images are never duplicated. Owned observers, listeners, dialogs and players are disposed when the feature is disabled or the client fiber is disposed. Request-invariance tests cover the UI boundary.

Search-usage presentation installs into DSH's public client slots and fails closed on absent or unsupported shapes, restoring only what it owns. Changing host profile inventory does not recompose an already-open browser boot graph; reload remains required. Dynamic-tool cache deltas and a typed provider-context provenance seam for pressure remain upstream DSH compatibility limits.

## Validation

The candidate passes 540/540 plugin tests, strict host/client types, 4/4 schemas and 57/57 generated-source consistency on DSH 0.2.0-rc.2, together with bounded real GPT/Grok, Alpha and browser workflows. Capabilities listed above as not covered are excluded from success claims. See the [README](README_EN.md) for installation.
