
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

Native compaction and same-route replay reuse the active DSH/Pi conversation cache identity: the clamped session id is the `prompt_cache_key`, provider `cacheRetention` is respected, and `long` may emit `prompt_cache_retention: 24h` when supported. `cacheRetention: none` omits Native prompt-cache/session affinity. Ordinary Hosted Search remains intentionally isolated under `dsh-lcx-search:<route hash>` so search traffic cannot share the main conversation request/cache namespace.

## Design invariants

1. **DSH owns compaction policy.** LCX never independently decides threshold, compact range, pruning, transaction boundaries or overflow retries.
2. **Native success performs one compaction model request.** Basic summary is a failure fallback, not a parallel portable-copy generator.
3. **DSH session log is the new checkpoint source of truth.** Opaque Native V2 state lives in `compaction/summary.rawOutput`; v3 sidecar access is legacy read-only.
4. **Opaque state is same-session only.** Provider, model, base URL and exact `sourceSessionId === currentSessionId` gate Native opaque replay. Verified parent/child ancestry authorizes portable migration only; a fork never sends the parent's opaque checkpoint state.
5. **Route migration is transparent and transient.** Reconstruct shadowed DSH messages and hand them to the normal adapter; do not persist a second portable history copy.
6. **Ordinary search has one model tool.** `web_search` is ordinary search; `websearch_gpt_advanced` exists only for parameters absent from `WebSearchRequest`; Alpha remains its own stateful protocol.
7. **Provider-native wire code is isolated.** Direct `/responses` SSE code is limited to Native V2 compaction/replay and Hosted Search protocol calls.

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

Compatibility:

- `0.4.0-rc.3`: v4 checkpoint could contain only the opaque item.
- `0.4.0-rc.4`: v4 checkpoint retained client messages but not assistant-visible answers.
- `0.4.0-rc.5`: writes `lcx-native-compaction-v5`; when replaying a v4 checkpoint it reconstructs the shadowed DSH transcript and derives the v5 fidelity prefix before reusing the original opaque state.



## rc.7 active-Agent Hosted Search routing

DSH intentionally keeps `SearchProvider.search()` small: the provider receives the normalized search request and cancellation signal, not the calling Agent. Ordinary Hosted Search still needs the exact active GPT Responses route, especially when a user switches between Sol/Luna or multiple proxy routes.

rc.7 therefore captures route identity at the model-facing `tools/execute` boundary for `web_search` and propagates it through Node `AsyncLocalStorage` only for the lifetime of that tool execution. `LcxResponsesSearchProvider.search()` resolves the route from that async context and falls back to the plugin-configured route only when no compatible active Agent route exists. No fields are added to the DSH `web_search` schema.

Hosted Search uses a dedicated stable cache namespace (`dsh-lcx-search:<route fingerprint>`) rather than the Native replay namespace (`dsh-lcx:<route fingerprint>`). The two requests have different prefixes and should not be intentionally co-routed under one prompt-cache key.
