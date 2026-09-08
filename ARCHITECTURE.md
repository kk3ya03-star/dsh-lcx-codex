# Model-scoped Responses ownership — 0.4.3-pre.4 prerelease

## Product contract

Feature ownership follows the active model. The GPT LCX switch owns only eligible GPT Responses conversations: ordinary turns, tool loops, Native V2 compaction/replay, portable GPT migration, Hosted/Alpha Search and restart/resume. Grok native Web/X switches are independent: eligible `grok*` Responses routes keep DSH Agent/Session authority while LCX supplies the narrow xAI server-tool wire/replay bridge. Claude, Gemini, DeepSeek and other models remain on their native DSH adapter paths. DSH model switching remains hot and requires no restart.

## Responsibility boundary

- **DSH** remains the Agent, Session, request assembly, model/settings/credential, tool-execution, attachment, pressure-policy and compaction-transaction owner.
- **The DSH adapter bridge** projects current DSH `GenerateOptions` and durable replay content into Pi's provider-neutral `Context`, reusing DSH attachment/file APIs and Pi's public serializers. It does not support older plugin configuration or checkpoints.
- **Plugin Pi 0.85.1** owns canonical Responses message/tool serialization and stream semantics: reasoning, IDs, custom tools, strict/grammar tools, `additional_tools`, `tool_search`, namespace, cache semantics and event parsing. DSH 0.1.3-alpha.2 has bounded runtime evidence; see the README for the Windows host correction and remaining prerelease limitations.
- **LCX** owns the GPT final body/HTTP/SSE lifecycle where enabled, plus the narrow Grok native-search wire/replay bridge. It does not take ownership of ordinary non-GPT DSH conversations.

## Remote compaction implementation audit

The September 7 audit compares exact DSH 0.1.3 source, installed Pi 0.85.1,
OpenAI's public compaction guide, and OpenAI Codex commit
`f3f53ee949eeaa9b6050699a783b94fe4ee8ff0d`. The protocol distinctions below
describe the implementation rather than a guarantee for every compatible gateway.

- LCX implements the Codex Remote V2 protocol: `/responses` plus a trailing
  `compaction_trigger`, with retained client history before the opaque result.
  Codex itself sets a 64,000-token retained-message budget. LCX's 24,000-token
  assistant reserve / 3,000-token per-answer cap are additional fidelity policy,
  not OpenAI requirements; these remain unchanged pending runtime measurements.
- Do not confuse this with the public `/responses/compact` endpoint, which remains
  supported by OpenAI and returns a canonical window that must be reused as-is,
  or public `context_management` server-triggered inline compaction. Neither is
  a drop-in substitute for the configured V2 route. LCX does not implement them.
- Pi's public `stream`/`onPayload` can send a V2 trigger, but a deterministic test
  confirms its normalized assistant result does not preserve opaque compaction
  output. Keep the Native parser/replay bridge; do not wrap Pi with a second SSE
  reader just to claim full reuse.
- DSH retains compaction service/transaction ownership. The current integration
  consumes the stock summarizer's `purpose: 'compaction'` call and identifies its
  final directive by DSH `Message.source`, never by matching user prompt text.
  Subclassing Basic would require replacing the profile's engine, not merely
  registering another summarizer, so it is not adopted for an optional plugin.

Settings use DSH's atomic namespace `mutate()` and confirm the resulting snapshot;
the plugin does not implement rollback or a second settings persistence layer.
JSON responses are incrementally bounded at 8 MiB by default; JSON/SSE error
bodies use the smaller of the configured bound and 512 KiB. Oversized bodies are
cancelled without retries. These are transport limits, not context-token budgets.

## Grok native-search bridge

For an eligible Grok Responses request with native search enabled, LCX projects the current DSH provider/model/profile directly into one xAI-compatible `/responses` request. It removes the ordinary DSH `web_search` function from that request, adds `{type:"web_search"}` and/or `{type:"x_search"}`, and preserves `web_fetch` plus unrelated local tools. Server-side search items never enter DSH ToolRuntime as local calls.

The bridge remains stateless (`store:false`, no `previous_response_id`). Provider output required for an agentic continuation is kept in a route/session-bound opaque envelope and restored in original order before the corresponding local function result. LCX-generated citation display additions are tracked separately and never inserted into the provider-native sequence. Compatible gateways that represent X search only through encrypted reasoning and usage can still preserve their complete native output across a later user turn or restart.

Grok follows exact DSH/Pi request defaults rather than GPT product policy: each Grok child Session owns its prompt-cache/session-affinity identity, reasoning capability is materialized from the selected DSH profile/catalog, Harness attribution headers win reserved collisions, and stream-idle timing advances on meaningful DSH/Pi progress rather than transport heartbeat bytes. API-key/API-gateway auth is the supported boundary for this release.

## Unified request path

`serializeNativeAware()` is the shared history compiler. With no checkpoint it serializes ordinary history; with a compatible checkpoint it injects retained native history plus the opaque compaction item; with an incompatible GPT model/route it reconstructs portable DSH history. All three representations continue through one standard LCX request builder and one LCX transport/parser bridge. Compact is the standard request plus `compaction_trigger` and the Remote V2 feature header; native replay is the standard request plus opaque history. Portable migration never recursively bypasses LCX back to `PiAiAdapter`.

Ordinary and replay requests perform one provider attempt and emit DSH terminal failure chunks using the host taxonomy, leaving visible retries to DSH's `agent/request-error` policy. Native compaction retains its bounded idempotent retry and first-checkpoint Basic fallback. Genuine upstream tool namespace is stored only in adapter-private replay metadata because DSH rc.2's visible ToolCall block has no namespace field.

## Gateway continuity

The stable DSH session id drives Pi-compatible prompt-cache/session-affinity fields. Sub2API v0.1.183 accepts `session_id`, `session-id`, and `x-client-request-id` for Codex account stickiness and repairs recovered custom-tool/tool-search item ID prefixes. Runtime acceptance therefore verifies both LCX wire continuity and gateway account continuity; release prose is not treated as the wire contract.

---

## rc.6 pressure coordination

DSH 0.1.1-rc.2 `compaction-basic` defaults to a `0.8` pressure threshold and, once pressure qualifies, runs `toolResultPruner` before summary compaction. Real long-session traces showed that a large prune can reduce the measured surface below 80%, preventing the Native summarizer from running while still rewriting an old request prefix and invalidating cache. rc.6 coordinates the existing engine instead of replacing it:

- for a compatible GPT Responses route with Native auto-compaction enabled, `compactIfNeeded(..., "pressure")` returns `null` below the configured Native threshold (default 90%), so the stock 80% path does not mutate history;
- from 90% up to the emergency threshold, the existing engine still owns range selection and the durable transaction, but `toolResultPruner.pruneSession()` is temporarily suppressed for that call; the engine's summary transport therefore reaches the existing `purpose=compaction` Native V2 override first;
- at the emergency threshold (default 95%) or above, the pruner is no longer suppressed and DSH may shrink oversized tool results before attempting summary compaction;
- provider-confirmed context overflow continues to use DSH's original `context-overflow` recovery unchanged;
- manual `/compact` remains unchanged.

Agent presets may isolate `compaction` and `toolResultPruner` inside entry-local Cordis realms. DSH 0.1.1-rc.2 explicitly documents that these preset services are invisible to both the host and ordinary `agent.ctx`; host-side code must address them through `agentPresets.serviceFor(agent, name)`. LCX therefore observes agent lifecycle events globally, resolves each Agent's real preset-local compaction/pruner through that public resolver, and patches the concrete compaction instance. A root `ctx.inject(['compaction'], ...)` hook remains only for non-preset/non-isolated deployments. Concrete Cordis service identity is used for de-duplication. DSH's own pre-step listener dynamically dispatches `this.compactIfNeeded()` at event time, and the wrapper is restored on plugin cleanup.

## rc.6 search timeout coordination

`dsh-tool-web` stores the cooperative search deadline only in `ToolDefinition.timeoutMs`; timeout metadata is explicitly not sent to the model. rc.6 adjusts the visible `web_search` definition's timeout to 240 seconds by default and restores the original value on cleanup. This avoids the observed 60-second false timeout while leaving the model-visible tool schema byte-stable.

# Architecture Notes — 0.4 Native Session Refactor / rc.6 Pressure Coordination

## rc.11 Native cache identity

Native compaction and same-route replay reuse the active DSH/Pi conversation cache identity. Pi 0.85.1 explicit-mode routes use `prompt_cache_options: { ttl: "30m" }` for supported long retention, no cache-options field for short, and `{ mode: "explicit" }` without a key for none. Non-explicit routes may emit supported `prompt_cache_retention: "24h"`. Ordinary Hosted Search remains isolated under `dsh-lcx-search:<route hash>`.

## Design invariants

1. **DSH owns compaction policy.** LCX never independently decides threshold, compact range, pruning, transaction boundaries or overflow retries.
2. **Native success performs one compaction model request.** Basic summary is a failure fallback, not a parallel portable-copy generator.
3. **DSH session log is the only checkpoint source of truth.** Opaque Native V2 state lives in `compaction/summary.rawOutput` as v5. There is no sidecar reader or old-format migration.
4. **Opaque state is same-session only.** Provider, model, base URL and exact `sourceSessionId === currentSessionId` gate Native opaque replay. Verified parent/child ancestry authorizes portable migration only; a fork never sends the parent's opaque checkpoint state.
5. **Route migration is transparent and transient.** Reconstruct shadowed DSH messages and hand them to the normal adapter; do not persist a second portable history copy.
6. **Ordinary search has one model tool.** `web_search` is ordinary search; `websearch_gpt_advanced` exists only for parameters absent from `WebSearchRequest`; Alpha remains its own stateful protocol.
7. **Provider-native wire code is isolated.** Direct `/responses` SSE code is limited to GPT Native V2/Hosted paths and the bounded Grok native-search bridge; it is not a generic second DSH provider framework.

## Why not subclass `BasicCompactionEngine`

`BasicCompactionEngine.summarize()` is the intended subclass customization hook, but a subclass is a new `ctx.compaction` service provider. The shipped DSH profile already mounts `dsh-compaction-basic`; mounting a second engine would duplicate service ownership/listeners unless the profile explicitly replaces the existing row.

The stock summarizer already routes through `ctx.llm.stream({ purpose: 'compaction' })`. For an out-of-tree optional plugin that must install without rewriting the base profile, narrowly intercepting that purpose is the less invasive integration.

If DSH later adds a public **summarizer provider registry** (distinct from the compaction engine service), LCX should migrate to it.

## Why not inline opaque JSON in checkpoint text

Inlining `encrypted_content` makes the session self-contained, but also exposes a large opaque string to DSH's visible surface/token accounting. Using a non-text block in `compaction/summary.rawOutput` keeps the session self-contained without turning provider state into prompt text.

## Remaining deliberate low-level seams

### Native Responses replay

Generic DSH/Pi messages do not expose an input type for OpenAI `compaction` items. Same-route resume therefore builds the Responses request directly. This is a bounded compatibility adapter, not a second general LLM stack.

### Runtime Web SearchProvider selection

DSH 0.1.1-rc.2 pins `deepseek-official` and has no public live setter. LCX uses an isolated compatibility write to the 0.1.1-rc.2 runtime field so the settings toggle works without restart. A future DSH public setter/configuration hook should replace this shim.

## Cache expectations

- Stable ordinary tool schema improves prefix stability versus exposing two ordinary search tools.
- Enabling/disabling Advanced or Alpha changes tools and may reset provider prefix cache.
- Compaction necessarily changes visible history and therefore starts a new post-checkpoint prefix.
- `prompt_cache_key` remains stable per exact route/session across Native compaction and native replay.
- Remote-first avoids an otherwise redundant large-prefix local summary call.

## Native V2 retained-history invariant

Current Codex V2 retains selected client messages and appends the opaque compaction item. Real DSH testing showed an additional product-level fidelity problem: a low-salience fact that existed only in an assistant answer can be omitted by the opaque state. LCX rc.5 therefore keeps the Native ordering but adds a bounded assistant-visible protection layer:

```text
selected user/developer/system message items
+ selected assistant visible output_text items
→ opaque compaction item
→ later DSH-retained / post-compaction messages
```

The fidelity prefix is capped at an estimated 64k tokens total. Up to 24k is reserved for assistant-visible answers; each retained assistant answer is capped at about 3k tokens. Assistant copies deliberately exclude reasoning, response IDs, tool calls, tool outputs, and provider-private state. The opaque item remains the only durable representation of those process details.

The DSH surface still stores only the short checkpoint marker. The retained wire items and opaque compaction state remain log-only in `compaction/summary.rawOutput`, so they do not inflate DSH's visible token-meter surface. They do, intentionally, increase the post-compaction provider request relative to an opaque-only checkpoint; the total explicit retention ceiling prevents this protection from defeating compaction.

Supported checkpoint contract: `lcx-native-compaction-v5` only. Unknown, older and invalid LCX checkpoint formats fail closed. Portable reconstruction is reserved for current-format route/session changes, not old-format migration.



## rc.7 active-Agent Hosted Search routing

DSH intentionally keeps `SearchProvider.search()` small: the provider receives the normalized search request and cancellation signal, not the calling Agent. Ordinary Hosted Search still needs the exact active GPT Responses route, especially when a user switches between Sol/Luna or multiple proxy routes.

Route identity is captured at the model-facing `tools/execute` boundary for `web_search` and propagated through Node `AsyncLocalStorage` only for that execution. Provider availability and search both require that selected DSH GPT Responses route; there is no plugin-configured fallback. No fields are added to the DSH `web_search` schema.

Hosted Search uses a dedicated stable cache namespace (`dsh-lcx-search:<route fingerprint>`) rather than the Native replay namespace (`dsh-lcx:<route fingerprint>`). The two requests have different prefixes and should not be intentionally co-routed under one prompt-cache key.
