# Changelog

## 0.4.1-pre.1 - Candidate QA pending / not published

- Integrates the accepted Alpha stateful continuation and fail-closed capability work from #20, #21, and #22.
- Includes accepted compatibility seam isolation (#24), typed protocol-core hardening (#25), unified conservative token budgeting (#26), and the installed-plugin settings lifecycle fix (#36).
- This is an unpublished candidate for #19 installed-candidate and cross-feature QA; no npm publication, tag, or release is implied.

## 0.4.0 - 2026-08-23

### Stable promotion

- Promote the fully validated `0.4.0-rc.13` runtime to the stable `0.4.0` line with no functional/runtime code changes.
- Make the rc.13 Native V2 hardening, canonical Responses replay/serialization fixes, session isolation, cache continuity, and concurrency/lifecycle fixes the recommended stable release.
- Preserve `0.3.4` only as historical stable state; `0.4.0` becomes the default npm `latest` after publication.

### Validation

- Runtime-sensitive source is required to remain content-identical to the already live-tested rc.13 release.
- Full suite: 58/58 passed; DSH schema validation: 4/4 passed.
- Real rc.13 DSH acceptance already covers automatic Native pressure Compact, replay/cache re-warm, restart/resume, real GUI `/compact`, parent/child opaque isolation, and dual-session same-preset ServiceMutex failure cleanup.
- Stable promotion adds no new runtime behavior; publication is a version/documentation promotion only.

## 0.4.0-rc.13 - 2026-08-23

### Fixed

- Restrict opaque Native checkpoint replay to the exact source DSH session. Parent/child ancestry remains valid only for portable migration, so a fork never sends the parent session's opaque Native state.
- Reconcile Responses replay deltas and terminal output by stable item/call identity instead of `output_index` alone, preventing changed-index duplicate/empty text blocks and keeping terminal-only function calls balanced.
- Replace the simplified Native message/tool serializer with the public `@earendil-works/pi-ai@0.82.1` OpenAI Responses converters, preserving reasoning/message identities, tool linkage, constrained-tool semantics, deferred-tool transcript semantics, and DSH image boundaries.
- Match ordinary Pi `openai-responses` system-prompt placement: Native compact/replay now carries the developer/system prelude inside the canonical input prefix rather than introducing a separate top-level `instructions` prefix difference.
- Restore strict validation of DSH Pi replay-state envelopes before reusing native signatures; mismatched replay metadata degrades to a portable foreign-assistant projection instead of injecting stale provider-native identity.
- Treat Pi canonical role-only developer/user items as durable retained history and keep image persistence on `dsh_image_attachment` references rather than request image payloads.
- Use Pi/model or explicitly configured DSH Responses compatibility only; unknown custom routes no longer assume strict tools, grammar tools, or tool-search support.
- Mirror DSH/OpenAI Responses generation controls into Native compact/replay (`reasoning` + encrypted-reasoning include, temperature, and max output tokens), preventing the real Terra `xhigh` compact path from dropping the envelope used by ordinary Pi requests.
- Source automatic-compaction generation controls from the matching session request header rather than the Basic compaction summarizer request, so the selected conversation effort (for example Terra `xhigh`) reaches the Native provider request.
- Declare the DSH `sessions` service as an explicit Cordis runtime injection because checkpoint/replay and automatic-compaction generation parity read the live session/request header.
- Maintain a deterministic per-session request-header cache from DSH `session/event`; `compaction/start` synchronously refreshes it from the live Session before the Native request, avoiding reliance on async-context propagation for generation parity.
- Register that cross-session `session/event` observer with Cordis `{ global: true }`, matching DSH system-wide observers so Agent-carrier session events reach the standing plugin scope.
- Snapshot the exact `agentArg.session.requestHeader()` inside the Native-first pressure wrapper immediately before delegating to Basic compaction; this is the deterministic pressure-path source of generation controls, with the global session-event cache retained only as a secondary path.
- Seed the request-header cache from already-live sessions at plugin installation, seed newly announced resume/fork sessions, and evict disposed session entries so manual/non-pressure compaction remains restart-safe without retaining stale headers.
- Match the explicit Remote V2 tool-control contract used by current Codex and mature Responses compaction implementations: Native compact/replay send `tool_choice: "auto"` and `parallel_tool_calls: true` on the plain `openai-responses` route.
- Preserve only bounded provider machine diagnostics (`code`, `type`, `param`) from `response.failed`; the safe identifiers are included in the generic failure message/log so DSH compaction history can diagnose failures, while provider messages/bodies remain excluded.
- Persist Pi replay envelope v2 on successful Native replay finish so DSH retains response id/stop reason plus text/reasoning native metadata across post-compact turns.
- Preserve normal Pi OpenAI function-call identity as `call_id|item_id` for replay deltas and completed tool-call blocks, preventing loss of the provider `fc_*` item id on the next canonical request.
- Treat the session header `config` as the effective ordinary-request envelope even when DSH marks a value in `adapterDefaults`; those materialized defaults (for example Terra `xhigh` and `maxTokens`) are still sent by normal Pi and therefore must be mirrored by Native compact/replay.

### Validation

- `tests/rc13-regressions.test.mjs`: 15/15 passed.
- Full local suite: 58/58 passed; DSH schema validation: 4/4 passed; `git diff --check` passed.
- Installed DSH/NewAPI acceptance passed on Terra xhigh: automatic 90% Native V2 compact, continuous replay/cache re-warm, DSH Web restart/resume, real GUI `/compact` plus continuation, and parent→child fork portable isolation all completed without pre-Native stock prune or cross-session opaque replay.
- This remains a local release candidate only; no npm/GitHub publication or tag is implied.

## 0.4.0-rc.12 - 2026-08-22

### Fixed

- Serialize every `compactIfNeeded()` call per concrete preset compaction service so same-generation sessions cannot observe each other’s temporary Native-first pruner/config state; queued calls are abortable and plugin cleanup drains active owners before restoring the original method.
- Align Native `openai-responses` session affinity with the active Pi adapter: default OpenAI-format routes use `session_id` plus `x-client-request-id`, while OpenRouter-format routes use `x-session-id`; explicit affinity headers remain authoritative.
- Restrict Basic fallback to allowlisted retryable first-checkpoint failures and fail closed once a Native/legacy checkpoint already exists.
- Require a real `response.completed` terminal event with `status=completed` for Native compaction/replay and reject orphan `function_call_output` items.
- Set credential-bearing fetches to `redirect: error` and keep provider response bodies/messages out of surfaced/logged transport errors.

## 0.4.0-rc.11 - 2026-08-22

### Fixed

- Restore ERR-051 cache/session affinity semantics that regressed in the rc.8 refactor: Native V2 compaction and same-route replay now use the DSH/Pi conversation session id as the clamped `prompt_cache_key` instead of a route fingerprint, inherit the active provider `cacheRetention`, emit `prompt_cache_retention: 24h` only for supported `long` retention, and omit Native cache affinity when retention is `none`.
- Keep ordinary Hosted Search on its intentionally separate `dsh-lcx-search:<route hash>` namespace.

## 0.4.0-rc.10 - 2026-08-22

### Fixed

- Fix Native-first pressure coordination for DSH 0.1.1-rc.2 Agent presets by using the public `agentPresets.serviceFor(agent, name)` resolver for preset-local `compaction` and `toolResultPruner` instances. This replaces the rc.9 assumption that ordinary `agent.ctx` lookup could see entry-local isolated services.

## 0.4.0-rc.9 - 2026-08-22

### Fixed

- Restore the Alpha capability/ref-store interfaces consumed by `lib/index.js`; the rc.8 release package could pass its unit tests but fail immediately at module import with missing `AlphaCapabilityStore` / `AlphaRefStore` exports.
- Add package-entry import regression coverage so CI fails when the server entry point and internal module exports drift out of sync.
- Restore Native-first pressure coordination for isolated agent presets using DSH 0.1.1-rc.2's public `agentPresets.serviceFor(agent, name)` resolver. Preset-local `compaction` / `toolResultPruner` services are not visible through ordinary host or `agent.ctx` lookup; the plugin now addresses the actual per-Agent instances before applying the 90% Native / 95% emergency policy. A root service-lifecycle hook remains for non-preset deployments.
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
