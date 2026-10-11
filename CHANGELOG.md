# Changelog

## 0.6.0-pre.2 - release candidate (DSH 0.2.1-alpha.2)

Prerelease patch on top of `0.6.0-pre.1`. Same DSH baseline and install range (exact DSH `0.2.1-alpha.2`, host Pi `1.1.0`, plugin Pi `0.87.1`; install range `>=0.2.1-alpha.2`, lower bound only: newer DSH versions are installable but unverified). It fixes GPT models that DSH knows but LCX's frozen model list did not, so they no longer fail with `NO_ADAPTER` on a provider profile without `api`. The published file list grows from 39 to 40 files (`lib/model-catalog.js`); nothing else is added.

- Fix GPT turns failing with `NO_ADAPTER: LCX could not resolve the selected Responses route` on a provider profile that names a catalog vendor but sets no `api`. A profile such as `openai` with only `baseURL`, `apiKeyEnv` and a `models` list, and a model such as `gpt-6-sol`, `gpt-6-luna` or `gpt-6.1-sol`, was resolved only from LCX's frozen Pi 0.86 allowlist, which lacks those models, although DSH resolves them from its own, newer catalog. LCX now resolves a route's protocol, endpoint and wire capabilities in this order: the provider profile, then what DSH itself resolves for the model (context window, input modalities, reasoning efforts, system-prompt and tool-update mode, read through `llm.resolveModelInfo`; DSH publishes no more of the resolved model to plugins), then LCX's bundled Pi 0.87.1 catalog, and the frozen Pi 0.86 allowlist only as the last fallback. A model the catalog does not describe but the profile lists in `models` takes the one protocol and endpoint every model of that provider shares, exactly as DSH does. Models that are neither in a catalog nor listed in the profile still fail closed, and the error now says what to change (`add api: openai-responses to the provider profile or select a model DSH recognizes`). Explicit `api` / `baseURL` / `compat` settings and custom-named routes behave as before.
- Credential-only profiles on the Grok route follow the same resolution: `grok-4.7` on `xai` now works without `api`.
- Incremental tool updates follow the catalog where it can speak: for a model LCX's bundled Pi 0.87.1 catalog describes, the `additional_tools` / `tool_search` capability now comes from that catalog instead of being left silent; for a model the catalog does not describe (for example `gpt-6.1-sol`) the tool-update mode DSH declares is kept, and such a model still defaults to `additional_tools`.
- When the protocol of a route truly cannot be determined (not in the profile, not resolved by DSH, not in the bundled catalog, not listed in the profile's `models`), the request now fails with a clear, actionable error naming the fix (`add api: openai-responses to the provider profile or select a model DSH recognizes`) instead of an opaque adapter failure.

## 0.6.0-pre.1 - release candidate (DSH 0.2.1-alpha.2)

Prerelease for DSH `0.2.1` and later. Same DSH baseline as `0.5.1-pre.1` (exact DSH `0.2.1-alpha.2`, host Pi `1.1.0`, plugin Pi `0.87.1`; install range `>=0.2.1-alpha.2`, lower bound only: newer DSH versions are installable but unverified). The version is `0.6.0-pre.1` because this prerelease adopts DSH `0.2.1`'s plugin-facing features: addition-only tool updates, programmatic-tool-calling nested search usage and media, and Plugin Manager card metadata. `0.5.1-pre.2` was prepared but never published; its fixes are folded into this release.

- Add native addition-only tool updates for GPT Responses routes (DSH 0.2.1+). On routes where DSH declares `toolUpdate: "addition-only"` (catalog GPT routes whose model supports `additional_tools` or `tool_search`), LCX now follows the host adapter instead of stripping DSH's tool updates: the request `tools` stay anchored to the initial declarations and a tool added mid-session (web search toggle, MCP or skill activation, Alpha) is declared in history position as a Responses `additional_tools` item (`tool_search` call/output when that is all the model supports; `additional_tools` wins when both are supported, as in Pi). A tool addition therefore no longer changes the cached prefix. Measured against the live gateway on `gpt-6-sol` and `gpt-5.6-sol` (about 15k token prefix, two runs of 3 trials per shape and model; upstream cache hits are noisy, so compare means): after an addition the anchored shape kept 0.81 to 0.90 of the input cached, in line with a turn with no tool change (0.67 to 0.92), whereas the previous full-list shape kept 0.00 to 0.14. This supersedes the full-tool-list decision of `0.5.1-pre.1` (which stripped developer tool updates and `deferLoading` and was explicitly not an incremental implementation): addition-only tool updates are now supported.
- Removing a tool or redefining one under the same name follows the host semantics and is never an error: a removal shrinks the anchored list once and a redefinition starts a new declaration series (the complete current list), each costing one cache reset, after which the surface is stable again. LCX adds a self check on top of the host projection and falls back to the previous full-tool-list request when the DSH tool history is missing, the model information is unreadable, the route is not addition-only or in-history, the route compat explicitly opts out of `additional_tools` and `tool_search`, or deferred tools and retained additions disagree. A route compat that says nothing is accepted, because DSH declares addition-only only for models that support the declaration items; this matters for models outside LCX's frozen Pi 0.86 catalog such as `gpt-6-sol`, where the first live A/B showed the full list being sent. A fallback although the host declared addition-only is logged once per session with a fixed reason. Custom-named routes (which DSH never declares addition-only), Grok routes, portable replay (fork and route migration) and native compaction checkpoints keep their previous handling; compaction requests may carry `additional_tools` and the checkpoint retains none, so the new series starts from the full list.
- New settings-card switch "Incremental tool updates (addition-only)" (`incrementalToolUpdates`, on by default, also for settings documents that predate it). Turning it off sends the complete current tool list on every request, as in `0.5.1-pre.1`; use it to roll back or to compare cache behaviour. The wire shapes and the cache comparison are reproducible with `npm run probe:tool-updates` (opt-in, spends real requests, never part of CI; `--dry-run` prints the shapes without a key).
- Count and show searches made from code: DSH 0.2.1 records a tool a `run_code` program (programmatic tool calling) calls as `tool/ptc-dispatch` carrying the nested tool's `name` and presentation `meta`, never as `tool/result`. LCX only read `tool/result`, so a `web_search` / `websearch_gpt_advanced` call made from inside `run_code` was not counted: its Hosted usage never reached the session search usage (`lcxSearchUsage` projection) or the per-turn usage pill, and its images never reached the search-media rail. All three now read the nested settlement as well. A nested call names its own tool, so it needs no pending entry; the settlement carries no turn, so the Client resolves it through the root `run_code` call it names. Usage is counted once per settled call (including a nested search that failed after it was billed), only for LCX's own search tools, and the projection state stays plain JSON. Media from nested searches joins the turn's single media block, ahead of direct links from the answer text, with the same ordering and placement as a model-direct search. Verified with DSH's real tool registry, `run_code` transport, nested dispatch scheduler, Agent loop, usage projection and Conversation assembler; the script runtime behind `ptcRuntime` is an in-process stand-in in tests.
- Give the Plugin Manager card LCX's own title, description and icon: DSH 0.2.1 reads a plugin's display metadata without activating it, from the package's `locale/<language>.json` files (`meta.title` / `meta.description`) and the manifest `icon`. LCX now ships `locale/en.json`, `locale/zh.json` and a small line-style `icon.svg` (the same style and size as DSH's own plugin icons) and declares them in `package.json` (`icon`, the `./locale/*.json` export, and the `files` allowlist), so the card shows "LCX Codex", a localized one-line description and the icon instead of the technical package name. The published file list grows from 35 to 39 files: the Plugin Manager metadata adds `icon.svg`, `locale/en.json` and `locale/zh.json`, and incremental tool updates add `lib/tool-surface.js`; nothing else is added. Verified with DSH's own `readPluginMeta` on the exact file set `npm pack` publishes.

- Fix the session projection cache never persisting: LCX's `lcxSearchUsage` projection wrote optional fields (`headerKey`, `contextDetails`, `contextProvenance`, `sampleHeaderKey`) as explicit `undefined`, which DSH's plain-JSON checkpoint check rejects, so after the first model reply every turn logged `projection checkpoint is not losslessly JSON-serializable` and no checkpoint was ever saved. Reopening a long session therefore replayed its whole log instead of resuming from the cached checkpoint. Absent fields are now omitted (and a stale provider-context sample is removed when a later reply carries none); usage numbers, pressure measurement and the UI are unchanged, and the projection state version stays at 3. Verified with the real DSH registry and `dsh-session-projection-cache` (write, read back, cold restore).
- Fix transient provider failures that arrive inside a streaming response ending the turn: when a gateway answers HTTP 200 and then reports `response.failed`, an `error` event, `response.incomplete`, or a terminal response with status `failed`, LCX classified it as the generic `RESPONSES_ERROR`, which DSH never retries, so a momentary `server_error` / `server_is_overloaded` / `bad_response_status_code` (or a failure with no error object) stopped the turn. The structured `error.code` / `error.type` (and the incomplete reason) are now mapped to DSH's taxonomy: server-side codes become `SERVER`, `rate_limit_exceeded` becomes `RATE_LIMIT`, `insufficient_quota` becomes `INSUFFICIENT_QUOTA`, `context_length_exceeded` becomes `CONTEXT_WINDOW_EXCEEDED`, `invalid_prompt` / `content_filter` / an incomplete `content_filter` become `INVALID_REQUEST` (not retried). DSH discards the partial output of a failed attempt and re-runs the step for the retryable classes. Provider message bodies still never leave the wire boundary. Both the GPT and Grok native streams now write one redacted `warn` line per failed request (`route`, LCX code, HTTP status, request id, provider `code`/`type`, whether output had already streamed); DSH 0.2.1-alpha.2 does not persist plugin logger output on its own.
- Fix GPT routes ignoring the profile's reasoning configuration: a `reasoningEfforts` mapping such as `high -> gateway-high` was never applied on GPT routes (only Grok honoured it), `reasoningEfforts: false` still sent `reasoning: {"effort": "none"}`, and any model without a catalog entry (for example `gpt-4.1` behind a custom-named route) was assumed to be a reasoning model. GPT routes now project the declared `reasoningEfforts` (wire spelling, or `false` for a non-reasoning model) into the request and refuse an effort DSH does not offer for the model with `UNSUPPORTED_OPTION`, as the Grok route and the DSH adapter already do. A model with no declared efforts follows the catalog, or what DSH resolves for it: a custom-named route DSH treats as non-reasoning no longer gets `reasoning: {"effort": "none"}` and renders its instructions with the plain `system` role instead of `developer`. Catalog routes (`openai/gpt-5.x`, `gpt-6`) are unchanged.
- Fix a model's explicit "unsupported" reasoning level still being sent: in a model's `thinkingLevelMap` an unmapped level means "send as requested" while an explicit `null` means the model does not support that level, but the request builder treated both the same and sent the level (for example `low` to `gpt-5.4-pro`). A null-mapped level is now omitted from the request; unmapped and mapped levels are unchanged. DSH itself refuses such a level before dispatch, so this only matters for the shared compaction and replay request builder.
- Fix the request image bound not counting images restored from a compaction checkpoint: `maxRequestImageBytes` was enforced per serialization batch, so the images a native checkpoint brings back into the request were never added to the new images that follow it (measured: a 20 MiB bound, 26.7 MiB sent, no offload request). The bound is now checked over the whole assembled request. When offloading enough new images fits it, LCX asks DSH to offload exactly that many (`IMAGE_OFFLOAD_REQUIRED`, as for ordinary requests); when the checkpoint's own images already leave no room, DSH cannot offload them, so the request fails with a clear `INVALID_REQUEST` ("Images kept in the compaction checkpoint exceed the request image bound; start a new session or raise maxRequestImageBytes") instead of being sent over budget.
- Fix portable replay duplicating tool results: when a compacted assistant message called several tools but only some had results, fork / route-migration replay put the existing results into the group and then read them again as separate messages, so the same `function_call_output` was sent twice, and a tight replay budget could start the replay with a result whose call had been cut off. The results taken into a call's group are now consumed once, and a tool result no call can claim is left out of portable replay instead of being sent as an orphan. Complete groups behave as before; DSH normally completes every group, so this only affects unusual histories.
- Fix Hosted search usage dropping cache-write tokens: the search usage collector read `cached_tokens` but ignored `input_tokens_details.cache_write_tokens`, so a cache-write share was reported as ordinary input. It now uses the same disjoint accounting as the main Responses path (input = input_tokens - cached - cache_write, with cache read and cache write reported separately). Responses without `cache_write_tokens` are accounted as before; no sampled gateway sends the field today.
- Fix Hosted search usage being lost when the search fails after it was billed: when a Hosted search response was received and billed but then could not be used (for example an incomplete response, or one query of a multi-query `web_search` failing), the call failed and the usage that had already been collected was discarded, so the session's search usage and token total under-reported. DSH builds a failed tool result from the error alone, so LCX now attaches the collected usage to the failed result through an Agent-scoped around-dispatch listener (no global wrapper), and the existing search-usage projection folds it in like any other search result. Displayed usage only; nothing about the request or the error shown to the model changes.
- Harden SSE reading against a stalled read: the SSE reader used by native compaction only checked for an abort between reads, relying on every caller tying the response body to the same signal. An abort now cancels the pending read itself, so the reader settles promptly with the abort reason and releases the connection even when its body is not coupled to that signal. No behaviour change for the existing callers.
- Fix inline search media being ordered by link syntax instead of text order: direct image/video links in an answer were collected as inline links first, then reference links, then bare URLs, so the media rail order depended on how a link was written and, once past the display limit, the links that survived were not the first ones in the answer. All three kinds are now ordered by their position in the text. Ownership rules (DSH renders Markdown images itself, duplicates collapse, pages stay ordinary links) are unchanged.
- Fix in-stream provider failures that carry an error object without a usable code still ending the turn: a `response.failed`, `error` event or `response.completed` with status `failed` whose error object was `{}`, had only a `message`, an empty or null `code`, or only an unknown `type` was classified as the generic non-retryable `RESPONSES_ERROR`, while the same failure with no error object at all was already retryable. These are now `SERVER` (retried by DSH). Recognised identifiers keep their class (quota, invalid prompt, content filter, context length, authentication), and wording that clearly names a class (rate limit, context window, timeout, invalid request) still wins over the default. A non-empty but unrecognised `code` keeps the generic class.
- Fix selecting the `off` reasoning level sending `{"reasoning":{"effort":"none"}}` when the profile declares `off: null`: LCX dropped the `null` entry while converting `reasoningEfforts`, so the request builder fell back to its default `none` for `off`, and the same happened when no level was selected. An explicit `off: null` now means "supported, send no reasoning option" on GPT and Grok routes and stays selectable; a mapped `off` (for example `off: "none"`), mapped levels and the catalog defaults are unchanged. For reference, the host adapter with Pi 1.1.0 sends `{"effort":"none"}` for the same `off: null` profile, because DSH leaves `off` out of Pi's level map and Pi reads an absent `off` as "none"; LCX follows the profile's documented meaning instead.
- Fix portable replay keeping a tool result that answers no call of the assistant in front of it: after an assistant message calling `A`, a result for a different call `X` stayed in fork / route-migration history (`user, assistant:A, tool:X, user`) and was sent as an orphan `function_call_output`. Only the first result for each call the assistant issued now joins its group; results for other calls and repeated results are dropped, the whole run of tool messages is consumed once, and nothing is duplicated or left without its call under any replay budget.

## 0.5.1-pre.1 - release candidate

Prerelease for DSH `0.2.1-alpha.2` (verified baseline exactly DSH `0.2.1-alpha.2`, host Pi `1.1.0`, plugin Pi `0.87.1`). Stable `0.5.0` remains the release for DSH `0.2.0-rc.2`.

- Retarget to DSH `0.2.1-alpha.2`. The install range has a lower bound and no upper bound (`>=0.2.1-alpha.2`, including the cordis, loader and schemastery peers), so newer DSH versions can install it, but only the exact `0.2.1-alpha.2` baseline is verified. The host Pi resolves to `1.1.0`; the plugin keeps its own Pi `0.87.1`.
- Fix in-history system prompt updates: on routes that declare `systemPromptUpdate: "in-history"` (catalog GPT-5.4+/5.5/5.6/6 routes), a changed system prompt arrives as a later `system` message. LCX previously sent it as a user message, and serialization batches could merge or drop it. It is now emitted at its original history position with the model instruction role, also across batched serialization. Routes without in-history keep the previous mapping.
- Safety: if the route's model information cannot be read and the history already holds a mid-history DSH system-prompt snapshot, LCX refuses the request with a clear, identifiable error (`LCX_SYSTEM_PROMPT_MODE_UNKNOWN`, reported as `NO_ADAPTER`) instead of re-sending that instruction as user text; requests without such history are unaffected. Checkpoint retention drops only items traced, by message source rather than text, to DSH system-prompt snapshots; other developer/system instruction items are kept.
- Drop superseded prompt snapshots from Native V2 retained items and from portable (fork / route-migration) replay, before the replay budget is computed, so stale instructions such as a switched-off plan policy never return as user text. Session V3 checkpoints, where later system messages were ordinary context, are refused by LCX before replay.
- Tool updates: routes that declare `toolUpdate: "addition-only"` keep working through the full-tool-list fallback; LCX strips developer tool-addition/removal messages and `deferLoading` and sends the complete current tool set on every request. Incremental addition-only tool updates and their cache benefit are not implemented and not claimed.
- Fix inline search-media placement on DSH 0.2.1, whose Chat flow renders items inside a `data-slot="conversation.chat.flow"` wrapper; DSH 0.2.0 layout still works and any other wrapper still fails closed.
- Real DSH `0.2.1-alpha.2` runtime QA passed for system-prompt updates (catalog and custom routes), tool toggles, compaction, restart/resume, fork, lifecycle, web search and inline media on GPT routes; the final build was re-verified (plan on/off, compact, fork, no stale prompt snapshot or internal marker on the wire). Not covered: the natural pressure-band compaction trigger, Alpha search, Grok routes and user image input.
- Validate 557/557 plugin tests, strict host/client types, 4/4 schemas and 57 reproducible generated files. Intended prerelease channel: `prelatest`; stable `latest` remains `0.5.0`. This entry does not imply publication has occurred.

## 0.5.0 - stable release

Stable release for DSH `>=0.2.0-rc.2 <0.2.1` (release baseline DSH `0.2.0-rc.2`, host/plugin Pi `0.87.1`). Stable `0.4.3` remains the release for the DSH `0.1.5` line; DSH `0.1.5` users should pin `@0.4.3`.

- Stable zero-functional-change promotion of the published `0.5.0-pre.1`: `src/**`, `lib/**` and the plugin patch are byte-identical to the prerelease. Only the version, install documentation and release tooling/metadata change.
- Publish stable `0.5.0` on npm `latest`; `0.5.0-pre.1` stays on `prelatest` as immutable prerelease history.
- The install range `>=0.2.0-rc.2 <0.2.1` may admit `0.2.1` prereleases (for example `0.2.1-alpha.2`) under DSH's range semantics; those builds are not supported or verified for this release.
- npm `@latest` now resolves to a release that supports DSH `0.2` only. DSH `0.1.5` installs must use `dsh-lcx-codex@0.4.3`, and DSH `0.1.6` installs `dsh-lcx-codex@0.4.4-pre.1`.

## 0.5.0-pre.1 - release candidate

Prerelease for DSH `>=0.2.0-rc.2 <0.2.1` (accepted validation baseline DSH `0.2.0-rc.2`, host/plugin Pi `0.87.1`). Stable `0.4.3` remains the release for the DSH `0.1.5` line.

- Retarget LCX to the DSH 0.2 contract: tool-history replay handles DSH `role: 'tool'` messages (multi-step, error and image results), dynamic tool changes are safe in replay and checkpoint paths, and Native-first / emergency compaction bands use DSH's pressure budget (`window - output reserve - headroom`).
- Old long sessions carrying a previous LCX checkpoint report `LCX_CHECKPOINT_UNSUPPORTED` on the LCX path after DSH migrates them; start a new session. Quoted legacy checkpoint markers no longer cause false rejection.
- Grok agentic usage: canonical cumulative billing is preserved, while compaction pressure uses the provider's complete terminal `usage.context_details` when available and a bounded estimate otherwise.
- Alpha stateful browsing (search, open, find, click, PDF screenshot, cold continuation, fork isolation, model-route switching) is validated on the tested OAuth-backed upstream; API-key upstream accounts are not covered. Target-page fetch failures report `LCX_ALPHA_PAGE_FETCH_FAILED`.
- Tools are re-synced immediately after a model/route switch, so the first request after switching advertises the correct GPT/Alpha tools.
- Redesign search media presentation for DSH 0.2: one borderless image rail under the answer (natural proportions, shared row height, source chip, horizontal scrolling with edge fades and arrows, DSH `ImageLightbox`) for search-returned images and plain direct image links, and direct video cards that expand into an inline player. Markdown images stay DSH-native and are never duplicated; a scoped CSS rule makes them start their own line so following links no longer sit beside them.
- Treat blank optional `userLocation` members and empty/irrelevant `searchContentTypes` / `imageSettings` padding of `websearch_gpt_advanced` as omitted instead of failing validation; invalid non-empty values still fail closed.

## 0.4.3 - 2026-09-10

- Stable zero-functional-change promotion of the fully verified `0.4.3-pre.13` product/runtime payload.
- Keep the DSH install envelope at `>=0.1.5-rc.1 <0.1.6`, with exact verified baseline DSH `0.1.5-rc.1` and host/plugin Pi `0.85.1`.
- Preserve GPT/Grok/search/compaction/media/usage/Alpha behavior byte-for-byte from the prerelease; only stable-version documentation and release tooling/metadata change.
- Publish stable `0.4.3` on npm `latest`; retain `0.4.3-pre.13` as immutable prerelease history on `prelatest`.

## 0.4.3-pre.13 — release candidate

- Verify DSH `0.1.5-rc.1` / Session V3 with host/build Pi `0.85.1`; public DSH peers now use the bounded `>=0.1.5-rc.1 <0.1.6` install range so later 0.1.5 RC/final releases can be assessed without an LCX release solely for version-string drift.
- Bundle the required Pi Responses helpers from pinned public exports instead of installing the full SDK dependency tree into user profiles; retain third-party notices.
- Add presentation-only search-media previews and auxiliary search-usage accounting; preserve model-request invariance, provider billing and native history. Harden media observer/disposer behavior and Alpha reference provenance/collision rejection.
- Validate 370/370 plugin tests, strict host/client types, 4/4 schemas, 51 reproducible generated files, the 32-file package boundary and bounded exact-rc.1 runtime/browser scenarios.
- Keep unresolved Alpha opaque open/find and screenshot delivery, browser boot-graph reload requirements, dynamic-tool cache and Grok billing/context-pressure limits explicit. The standalone DSH pending-inbox patch is not included or installed.
- Refresh public installation and architecture documentation. Intended prerelease channel: `prelatest`; stable `latest` remains `0.4.2`. This entry does not imply publication has occurred.

## Earlier releases (historical)

The following entries describe their original versions, not the pre.13 setup or compatibility contract.

## 0.4.3-pre.4 - 2026-09-08

- Hide Grok reasoning blocks with no visible text while preserving their encrypted provider state for tool continuation and cold replay. Visible reasoning and GPT streaming remain unchanged.

- Display only Grok answer `url_citation` annotations as fallback Sources; search candidate lists no longer become visible citations. Preserve inline links, deduplicate citation URLs and keep original provider replay unchanged.

- Refresh public GPT/Grok metadata and Windows startup/undo instructions; add ordinary PR/main verification and duplicate-publication guards.
- Validate 243/243 tests, strict host/client types, four schemas, generated output and package checks. Publish only on `prelatest`; stable `latest` remains `0.4.2`.

## 0.4.3-pre.3 - 2026-09-09

- Add model-scoped ownership: GPT keeps the existing LCX Responses/Native V2/Hosted/Alpha path; Grok gains independent xAI-native Web/X Search; other models remain on native DSH behavior.
- Inject xAI Responses `{type:"web_search"}` and `{type:"x_search"}` for Grok and suppress DSH `web_search` only on Grok native-search requests; keep `web_fetch` and unrelated DSH/MCP tools.
- Preserve ordered provider-native Grok output across native search → local function → function result continuation and cold/restart replay without exposing server-side search as fake local tool calls.
- Match DSH 0.1.3-alpha.2 / Pi 0.85.1 reasoning, cache/session identity, header authority, cancellation and idle-timeout semantics, including independent Grok subagent session identity while preserving GPT parent-shared cache policy.
- Separate user-visible citation fallback from opaque provider replay; support compatible gateways that represent X search through encrypted reasoning/usage without an explicit `x_search_call` item.
- Validate 237/237 tests, strict host/client types, four schemas, real Grok Web/X + local-tool workflows, parent/child isolation, GPT regressions and native DSH DeepSeek search regression.
- Publish as prerelease `prelatest`; stable `latest` remains `0.4.2`. API-key/API-gateway Grok routes are supported; xAI OAuth/SuperGrok login remains out of scope and citation rendering can remain gateway-dependent.

## 0.4.3-pre.2 - 2026-09-07

- Target DSH 0.1.3-alpha.2 and Pi 0.85.1, with strict TypeScript source and generated host/client artifacts.
- Remove 0.4.2 configuration fallback and v3/v4 checkpoint readers. Keep DSH as the single route, attachment, session and compaction-transaction owner.
- Follow Pi's explicit-mode long cache retention of 30m; preserve session/fork identity and current v5 replay/model migration.
- Bound response reads incrementally; use atomic DSH settings updates with visible save errors and native locale selection.
- Harden Native checkpoint validation, portable-history traversal, Hosted completion checks and Alpha error reporting.
- Document Hosted image search and inline DSH image display without adding a downloader or browser-control layer.
- Bounded live validation covers long dialogue, Native compaction/restart/model switching, uploaded PNG/TXT, two-session concurrency, foreground subagent caches, and automatic pressure bands. 156 regression tests pass.
- Prerelease on `prelatest`; stable `latest` remains 0.4.2. Windows DSH tests require the documented minimal host loading correction. Alpha intermittent references and screenshot delivery, proxy behavior, and broader concurrency/cancellation remain limitations, not verified fixes.

## 0.4.2 - 2026-08-29

- Promote the validated 0.4.2-pre.1 runtime to stable with no functional/runtime changes.
- Publish on npm `latest`; subsequently superseded prerelease channels do not change this stable release.
- Release commit: `60b023378d2d506093694e218ab6eb97cd81d9c0`; tag: `v0.4.2`.

## 0.4.2-pre.1 - released; superseded by 0.4.2

### Architecture

- Make the LCX master switch the GPT Responses lifecycle ownership switch: when enabled, the first ordinary Agent turn, tools, Native V2 compaction, native replay and portable GPT-model migration share one LCX final-wire path.
- Upgrade only the plugin's direct Pi dependency to `0.84.3`; DSH 0.1.1-rc.2 and its host Pi 0.82.x remain isolated and unchanged.
- Reuse Pi 0.84 canonical Responses serializers and stream semantics for strict/grammar/custom tools, deferred `additional_tools` / `tool_search`, namespace, reasoning, IDs and cache behavior.
- Add one standard Responses request builder and shared LCX HTTP/SSE transport/parser bridge; remove the old portable recursive bypass back to the DSH adapter.
- Preserve checkpoint v5, DSH compaction transactions, Native-first pressure coordination, first-checkpoint Basic fallback, restart/resume and Search/#20 architecture.
- Normalize ordinary/replay failures into DSH terminal taxonomy and keep DSH as the visible retry owner.

### Validation state

- Engineering gates and commit-bound DSH + Sub2API runtime acceptance completed before publication. Stable 0.4.2 subsequently promoted the same runtime without functional changes.

## 0.4.1 - 2026-08-25

### Stable promotion

- Promote the fully QA-passed `0.4.1-pre.1` runtime to stable `0.4.1` with **zero functional/runtime code changes**.
- Make Alpha stateful continuation/fail-closed fixes, DSH compatibility-seam isolation, typed protocol hardening, conservative token budgeting, and the installed Settings lifecycle fix part of the default stable line.
- Publish stable `0.4.1` to npm dist-tag `latest`; the prior `prelatest=0.4.1-pre.1` remains historical prerelease state.

### Validation basis

- `0.4.1-pre.1` passed Installed Candidate + Cross-feature QA before publication.
- Public promotion preserved runtime/source parity with the frozen prerelease candidate.
- Stable promotion requires package/version, typecheck, tests, schema, package/import boundary and zero-runtime-diff checks before publication.

## 0.4.1-pre.1 - 2026-08-25

### Released prerelease

- Published as `dsh-lcx-codex@0.4.1-pre.1` on npm dist-tag `prelatest`; stable `latest` remained `0.4.0` at prerelease publication time.
- Integrates the accepted Alpha stateful continuation and fail-closed capability work from #20, #21, and #22.
- Includes accepted compatibility seam isolation (#24), typed protocol-core hardening (#25), unified conservative token budgeting (#26), and the installed-plugin settings lifecycle fix (#36).
- Passed installed-candidate and cross-feature QA before publication, including ordinary/Advanced Hosted Search, Native compaction/replay, restart/resume, model continuation, fork isolation, and fail-closed Alpha behavior where unsupported.
- Public promotion preserved source/runtime parity with the frozen private candidate; package, schema, typecheck, import, install-chain, and publication gates passed.
- Post-release registry installation and Loader/client/settings-chain verification passed. The final provider-gated ordinary `web_search` recheck was not covered because the temporary authorized upstream credential returned HTTP 401; this was recorded as an external-auth verification gap rather than a package/source/runtime defect.
- Superseded as the recommended release by stable `0.4.1` after zero-functional-change promotion.

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

- Ordinary DSH `web_search` now follows the active Agent `provider/model` instead of always using the plugin fallback GPT model. A Luna conversation now searches with Luna; a Sol conversation now searches with Sol.
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
- Keeps explicit retained history within an estimated 64k-token ceiling; defaults reserve at most 24k for assistant answers and cap one retained assistant answer at about 3k tokens.
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
