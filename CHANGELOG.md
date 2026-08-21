# Changelog

## 0.4.0-rc.8

- Rebase the plugin on DSH `0.1.1-rc.2`; older DSH releases are no longer a supported runtime target.
- Native V2 compaction image replay now uses DSH `attachments.readImageRequest()` with the active `llm-pi-ai` route's request-image pixel/byte policy instead of reading normalized master bytes directly.
- Native image requests use DSH's deterministic `offloadRequestImagesWithPolicy()` projection before serialization, matching the current request-size behavior for long image-heavy sessions.
- Keep rc.7 active-Agent Hosted Search routing, isolated search cache namespace, 240s search timeout, rc.5 conversation-fidelity checkpointing, and rc.6 90% Native-first / 95% emergency pressure policy unchanged.
- CI installs against current declared DSH packages instead of enforcing the stale rc.8 lockfile.

## 0.4.0-rc.7 - 2026-08-22

### Fixed

- Ordinary DSH `web_search` now follows the active Agent `provider/model` instead of always using the plugin fallback GPT model. A Luna conversation now searches with Luna; a Sol conversation searches with Sol.
- Added an AsyncLocalStorage route bridge at the DSH `tools/execute` boundary so the provider-only `ctx.web.search()` seam can receive Agent route context without changing the model-visible `web_search` schema.
- Hosted Search now uses a separate stable `dsh-lcx-search:<route hash>` `prompt_cache_key`, avoiding intentional cache-key sharing with Native conversation replay.
- The settings UI now labels the configured Responses endpoint/model as **fallback** values, matching their actual rc.7 role.

### Kept from rc.6

- 240-second default DSH `web_search` deadline.
- Native-first automatic pressure policy: 90% Native V2, 95% emergency DSH prune.
- rc.5 conversation-fidelity checkpoints and restart-safe DSH session-log persistence.

### Docs / release

- Reworked the README around the current architecture and real cache observations.
- Added a blue/white DSH-LCX-CODEX hero banner for GitHub/npm.
- GitHub trusted publishing is wired through `.github/workflows/publish.yml`: pre-release tags publish to npm dist-tag `next`; stable tags publish to `latest`.

## 0.4.0-rc.6

- Added Native-first automatic pressure coordination for GPT Responses sessions: below the configured Native threshold the plugin suppresses DSH's stock 80% pressure compaction/prune path; at the default 90% threshold it lets compaction proceed while temporarily suppressing tool-result pruning so Native V2 runs first.
- Added a separate emergency prune threshold (default 95%). At or above this zone, DSH's replay-safe tool-result pruner is allowed to run before compaction as overflow protection.
- Added adjustable `web_search` tool deadline, default 240 seconds (30–600s). This mutates only DSH's non-model-visible `ToolDefinition.timeoutMs`, so the model tool schema and prompt-cache prefix do not change.
- Added Settings UI controls for automatic compaction, Native threshold, emergency prune threshold, and web search timeout.
- Kept the rc.5 checkpoint/fidelity format unchanged (`lcx-native-compaction-v5`); rc.6 is a pressure/timeout coordination release, not another checkpoint migration.

## 0.4.0-rc.5

- Adds a bounded conversation-fidelity layer after real DSH testing showed assistant-only facts could be lost by opaque Native V2 compaction.
- New `lcx-native-compaction-v5` checkpoints retain selected user/developer/system messages plus user-visible assistant final answers before the opaque compaction item.
- Keeps explicit retained history within an estimated 64k-token ceiling; defaults reserve at most 24k for assistant answers and cap one retained answer at about 3k tokens.
- Does not copy reasoning, tool calls/results, raw search payloads, or telemetry into the fidelity prefix.
- Repairs rc.3/rc.4 v4 checkpoints from append-only `shadowedSeqs`, including assistant-visible answers when the original DSH events still exist.
- Stores only the single opaque compaction output item, ignoring unrelated terminal output items from nonstandard proxies.
- Route compatibility now accepts both native checkpoint versions 4 and 5.
- Adds regression coverage for the exact assistant-only anchor failure (`Cobalt-Sparrow-604` / `81736`) and the 64k retention ceiling.

## 0.4.0-rc.4

- Fixes a Native V2 replay fidelity bug found by real DSH session-log testing.
- Native checkpoints now persist the retained client-authored Responses messages before the opaque `compaction` item, matching current OpenAI Codex remote-compaction V2 replacement-history semantics.
- Existing rc.3 opaque-only v4 checkpoints are repaired on replay by reconstructing the missing shadowed user history from the DSH append-only session log.
- Adds replay/retention regression coverage and an explicit Native success diagnostic.
- Keeps the rc.3 search-provider, remote-first fallback, and session-log-native checkpoint architecture unchanged.

## 0.4.0-rc.3

- Fix Cordis external-package loading: all `ctx.web`/`ctx.llm` service access now occurs inside an explicit `ctx.inject(['llm', 'web'], ...)` scope.
- This fixes `cannot get property "web" without inject` when DSH loads the plugin from a profile-installed `.tgz`.
- No protocol or checkpoint-format changes from rc.2.

## 0.4.0-rc.2 - 2026-08-21

- Packaging-only fix over rc.1: remove unnecessary `@deepseek-ai/dsh-compaction-basic` and `@deepseek-ai/dsh-web` peer declarations.
- The plugin consumes DSH runtime services through injected `ctx.*` seams and does not import or mount either package directly.
- Avoids misleading pnpm "missing peer" warnings and, importantly, avoids encouraging users to install a second compaction backend.

## 0.4.0-rc.1 - 2026-08-21

### Architecture

- Keep DSH `compaction-basic` as the sole compaction service owner; use only its documented/interceptable `purpose=compaction` `llm/stream` summarizer seam.
- Replace parallel local+remote compaction with remote-first fallback.
- Persist new Native V2 opaque state in DSH `compaction/summary.rawOutput` using `lcx-native-compaction-v4`; the model-visible replacement stays short.
- Remove new-checkpoint writes to the v3 JSON sidecar. The v3 sidecar is now read-only compatibility for old sessions.
- Reconstruct portable history for route migration from DSH append-only `shadowedSeqs` instead of duplicating every checkpoint's portable history.
- Preserve same-route fork replay through DSH session ancestry.
- Centralize the remaining direct Responses-native transport in `compact-v2.js` and `responses-replay.js`.

### Search

- Make `ctx.web` / DSH `web_search` the ordinary Hosted Search entry point.
- Remove the ambiguous ordinary `websearch_gpt` tool.
- Add opt-in `websearch_gpt_advanced` for Hosted-only controls that DSH `WebSearchRequest` cannot express.
- Keep `websearch_alpha` independent and capability-gated.
- Isolate the DSH rc.8 runtime SearchProvider-selection compatibility shim.

### Reliability

- Rehydrate DSH image attachment references when replaying legacy v3 checkpoints.
- Resolve startup settings into runtime route config immediately instead of waiting for the first settings change.
- Do not assume `events[seq]` is always the event whose `event.seq === seq`; use a safe fallback lookup.
- Add protocol, session persistence, migration and architecture regression tests.

### Compatibility

- Node.js >= 20.
- Target DSH `0.1.1-rc.2` only.
- Existing 0.3.x v3 marker sessions remain best-effort readable through the old sidecar.

## 0.3.1

- Previous Hosted/Alpha Search and Native V2 checkpoint-v3 implementation.
