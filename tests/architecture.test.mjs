import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const text = async (path) => readFile(new URL(path, root), 'utf8')

test('ordinary Hosted Search uses DSH web provider while advanced tool is explicitly named', async () => { const source = await text('lib/index.js'); assert.match(source, /registerSearchProvider\(provider\)/u); assert.match(source, /websearch_gpt_advanced/u); assert.doesNotMatch(source, /const\s+WEB_SEARCH_TOOL_NAME\s*=\s*['"]websearch_gpt['"]/u) })
test('native compaction is remote-first rather than parallel local+remote', async () => { const source = await text('lib/index.js'); assert.doesNotMatch(source, /Promise\.allSettled\(\[localPromise,\s*remotePromise\]\)/u); assert.doesNotMatch(source, /collectLocalCompaction/u); const remoteAt = source.indexOf('requestNativeCompaction({'); const fallbackAt = source.indexOf('const stream = await next()', remoteAt); assert.ok(remoteAt >= 0 && fallbackAt > remoteAt) })
test('Native openai-responses keeps the Pi system prompt inside canonical input', async () => { const source = await text('lib/index.js'); const serializer = await text('lib/dsh-responses.js'); assert.match(source, /systemPrompt: options\.system/u); assert.doesNotMatch(source, /instructions: options\.system/u); assert.match(serializer, /includeSystemPrompt: normalized\.includeSystemPrompt/u); assert.match(serializer, /@earendil-works\/pi-ai\/api\/openai-responses-shared/u); assert.doesNotMatch(serializer, /file:\/\/\/|AppData|dist\/api\/openai-responses-shared/u) })
test('new checkpoints are session-log native and old v3 sidecar is read-only compatibility', async () => { const index = await text('lib/index.js'); const native = await text('lib/native-checkpoint.js'); const legacy = await text('lib/legacy-v3.js'); assert.match(native, /lcx-native-compaction-v5/u); assert.match(native, /lcx-native-compaction-v4/u); assert.match(native, /rawOutput/u); assert.match(legacy, /readFileSync/u); assert.doesNotMatch(legacy, /writeFile|renameSync|mkdirSync/u); assert.doesNotMatch(index, /CheckpointV3Store/u) })
test('native checkpoint keeps a bounded conversation-fidelity prefix before opaque compaction state', async () => { const source = await text('lib/native-checkpoint.js'); assert.match(source, /RETAINED_MESSAGE_TOKEN_BUDGET = 64_000/u); assert.match(source, /ASSISTANT_RETENTION_TOKEN_RESERVE = 24_000/u); assert.match(source, /retainedConversationPlan\(input/u); assert.match(source, /\[\.\.\.retention\.items, structuredClone\(result\.compaction\)\]/u) })
test('package targets DSH 0.1.1-rc.2 directly', async () => { const pkg = JSON.parse(await text('package.json')); assert.equal(pkg.dependencies['@earendil-works/pi-ai'], '0.82.1'); assert.equal(pkg.devDependencies['@deepseek-ai/dsh-llm'], '0.1.1-rc.2'); assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-attachment'], '^0.1.1-rc.2'); assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-compaction-basic'], undefined); assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-web'], undefined) })
test('Cordis service access uses plugin-level inject metadata without a nested lifecycle gate', async () => {
  const source = await text('lib/index.js')
  const applyMatch = source.match(/export function apply\(ctx, configInput = \{\}\) \{([\s\S]*?)\n\}/u)
  assert.ok(applyMatch, 'exported apply(ctx, configInput) body must remain inspectable')
  const applyBody = applyMatch[1]

  assert.match(source, /export const inject = \['llm', 'web', 'sessions'\]/u)
  assert.match(applyBody, /^\s*return installInjected\(ctx, configInput\)\s*$/u)
  assert.doesNotMatch(applyBody, /ctx\.inject\(\s*\[\s*['"]llm['"]\s*,\s*['"]web['"]\s*,\s*['"]sessions['"]/u)
  assert.match(source, /ctx\.inject\(\['compaction'\]/u)
  assert.match(source, /installSettingsSection\(ctx, SETTINGS_NS/u)
  assert.match(source, /apply\.inject = inject/u)
  assert.match(source, /apply\.Config = Config/u)
})
test('Native-first pressure delays DSH prune to the emergency zone', async () => { const source = await text('lib/index.js'); assert.match(source, /auto pressure .*Native V2 first/u); assert.match(source, /emergency DSH prune allowed/u); assert.match(source, /ratioPercent < auto/u); assert.match(source, /ratioPercent < emergency/u) })
test('web_search deadline is extended without changing its model schema', async () => { const source = await text('lib/index.js'); const compat = await text('lib/dsh-compat.js'); assert.match(compat, /definition\.timeoutMs/u); assert.match(source, /webSearchTimeoutSeconds/u); const client = await text('lib/client.js'); assert.match(client, /240/u) })
test('ordinary Hosted Search follows the active Agent without changing web_search schema', async () => { const source = await text('lib/index.js'); assert.match(source, /AsyncLocalStorage/u); assert.match(source, /hostedSearchRouteContext\.run\(active/u); assert.match(source, /web_search route:/u); assert.match(source, /dsh-lcx-search:/u); const hosted = await text('lib/web-search-hosted.js'); assert.match(hosted, /prompt_cache_key/u) })
test('rc.8 uses the DSH 0.1.1 request-image API directly', async () => { const source = await text('lib/dsh-responses.js'); assert.match(source, /readImageRequest/u); assert.match(source, /offloadRequestImagesWithPolicy/u); assert.doesNotMatch(source, /attachments\?\.readImage\)/u); assert.match(source, /DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 2048 \* 2048/u); assert.match(source, /DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1024 \* 1024/u) })

test('DSH rc.2 host access and mutation details stay inside the compatibility boundary', async () => {
  const source = await text('lib/index.js')
  const compat = await text('lib/dsh-compat.js')
  assert.match(source, /from '\.\/dsh-compat\.js'/u)
  assert.match(compat, /searchProviderId/u)
  assert.match(compat, /serviceFor\?\.\(agent, name\)/u)
  assert.match(compat, /cordisSymbols\.original/u)
  for (const pattern of [/searchProviderId/u, /cordisSymbols/u, /serviceFor\?\./u, /requestHeader\?\.\(\)/u, /compactIfNeeded\s*=/u, /pruneSession\s*=/u, /definition\.timeoutMs\s*=/u]) assert.doesNotMatch(source, pattern)
})


test('Native-first pressure patch deduplicates on the concrete compaction service identity', async () => {
  const source = await text('lib/dsh-compat.js')
  assert.match(source, /symbols as cordisSymbols/u)
  assert.match(source, /cordisSymbols\.original/u)
  assert.match(source, /const compaction = concreteService\(value\)/u)
  assert.match(source, /records\.has\(compaction\)/u)
})


test('Native-first pressure patch waits for the compaction service lifecycle', async () => {
  const source = await text('lib/index.js')
  assert.match(source, /ctx\.inject\(\['compaction'\],\s*compactionCtx\s*=>/u)
  assert.match(source, /patchCompactionPressureService\(resolveContextService\(compactionCtx, 'compaction'\)/u)
})


test('Native-first pressure patch observes isolated agents through global status events', async () => {
  const source = await text('lib/index.js')
  assert.match(source, /ctx\.on\('agent\/status',[\s\S]*?\{\s*global:\s*true\s*\}\)/u)
  assert.match(source, /patchCompactionPressureForAgent\(agent, state, \(\) => runtimeConfig, ctx, compactionPatchRecords, requestHeaders\)/u)
})

test('isolated pressure coordination uses the official AgentPresets service resolver', async () => {
  const source = await text('lib/index.js')
  const compat = await text('lib/dsh-compat.js')
  assert.match(compat, /agentPresets/u)
  assert.match(compat, /serviceFor\?\.\(agent, name\)/u)
  assert.match(source, /resolveAgentService\(ctx, agent, 'compaction'\)/u)
  assert.match(source, /resolveAgentService\(ctx, agentArg, 'toolResultPruner'\)/u)
})


test('Native fallback is an explicit retryable-first-checkpoint allowlist', async () => {
  const source = await text('lib/index.js')
  const match = source.match(/function fallbackEligible\(error, signal\) \{[\s\S]*?\n\}/u)
  assert.ok(match, 'fallbackEligible function must remain inspectable')
  const fallbackEligible = Function(`${match[0]}; return fallbackEligible`)()
  const signal = { aborted: false }
  assert.equal(fallbackEligible({ code: 'LCX_HTTP_RETRYABLE', status: 503 }, signal), true)
  assert.equal(fallbackEligible({ code: 'LCX_RETRY_EXHAUSTED' }, signal), true)
  assert.equal(fallbackEligible({ code: 'LCX_HTTP_ERROR', status: 401 }, signal), false)
  assert.equal(fallbackEligible({ code: 'LCX_COMPACT_INVALID_RESPONSE' }, signal), false)
  assert.equal(fallbackEligible({ code: 'LCX_INVALID_SSE' }, signal), false)
  assert.equal(fallbackEligible({ code: 'LCX_CREDENTIAL_UNAVAILABLE' }, signal), false)
  assert.equal(fallbackEligible({ code: 'LCX_SESSION_GENERATION_STALE' }, signal), false)
})

test('Native Basic fallback is disabled once a checkpoint already exists', async () => {
  const source = await text('lib/index.js')
  assert.match(source, /messagesContainNativeCheckpoint\(history, session\)/u)
  assert.match(source, /hasExistingCheckpoint[\s\S]*?throw error/u)
})

test('session event cache refreshes globally before Native compaction', async () => { const source = await text('lib/index.js'); assert.match(source, /const requestHeaders = new Map\(\)/u); assert.match(source, /ctx\.on\('session\/event', \(session, event\) => \{\s*updateRequestHeaderCache\(requestHeaders, session, event\)[\s\S]*?\}, \{ global: true \}\)/u); assert.match(source, /remoteCompactionStream\(options, routeConfig, state, ctx, next, requestHeaders\)/u) })
test('request-header cache seeds resumed sessions and releases disposed sessions', async () => {
  const source = await text('lib/index.js')
  assert.match(source, /for \(const session of sessionsService\(ctx\)\?\.list\?\.\(\) \?\? \[\]\) seedRequestHeader\(session\)/u)
  assert.match(source, /ctx\.on\('session\/created', \(session\) => \{\s*seedRequestHeader\(session\)\s*\}, \{ global: true \}\)/u)
  assert.match(source, /ctx\.on\('session\/disposed', \(session\) => \{\s*requestHeaders\.delete\(String\(session\?\.id \?\? ''\)\)[\s\S]*?\}, \{ global: true \}\)/u)
})
test('pressure wrapper snapshots the exact Agent request header before Basic compaction', async () => { const source = await text('lib/index.js'); assert.match(source, /patchCompactionPressureService\([^)]*requestHeaders\)/u); assert.match(source, /updateRequestHeaderCache\(requestHeaders, agentArg\?\.session, \{ type: 'compaction\/start' \}\)/u); assert.match(source, /patchCompactionPressureForAgent\([^)]*requestHeaders\)/u) })
test('pressure wrapper serializes every compactIfNeeded trigger and drains on cleanup', async () => {
  const source = await text('lib/index.js')
  assert.match(source, /record\.mutex\.run\([\s\S]*?trigger !== 'pressure'/u)
  assert.match(source, /await restoreCompactionPressure\(compactionPatchRecords\)/u)
})

test('Native compaction warning surfaces safe provider machine fields', async () => {
  const source = await text('lib/index.js')
  assert.ok(source.includes('const providerCode = error?.providerCode'))
  assert.ok(source.includes('const providerType = error?.providerType'))
  assert.ok(source.includes('const providerParam = error?.providerParam'))
  assert.doesNotMatch(source, /error\?\.providerMessage/u)
})

test('Alpha runtime forwards contract-valid URLs while retaining opaque ref-store gates', async () => {
  const source = await text('lib/index.js')
  assert.match(source, /alphaRefRequiresStore/u)
  assert.match(source, /if \(alphaRefRequiresStore\(normalized\.action, normalized\.refId\)\) refStore\.assertUsable/u)
})

test('Alpha registration is scoped to the exact selected route while execution retains header-first routing', async () => {
  const source = await text('lib/index.js')
  const compat = await text('lib/dsh-compat.js')
  assert.match(source, /function verifiedAlphaCapabilityForRoute\(ctx, active, config, store\)/u)
  assert.match(source, /resolveResponsesRouteConfig\(ctx, active, config\)/u)
  assert.match(compat, /requestConfig: agent\?\.session\?\.requestHeader/u)
  assert.match(source, /function activeAgentRoute\(exec, fallback\) \{[\s\S]*?provider: route\.requestConfig\?\.provider \?\? route\.options\?\.provider/u)
  assert.match(source, /function selectedAgentRoute\(agent, fallback\) \{[\s\S]*?provider: route\.options\?\.provider \?\? route\.requestConfig\?\.provider/u)
  assert.match(source, /function syncAlphaToolForAgent\(ctx, agent, state, getConfig, capabilityStore, refStore, registrations\)/u)
  assert.match(source, /const active = selectedAgentRoute\(agent, config\)/u)
  assert.match(source, /function createAlphaTool\([\s\S]*?async execute\(args, exec\) \{[\s\S]*?const config = getConfig\(\); const active = activeAgentRoute\(exec, config\)/u)
  assert.match(source, /const scopedTools = resolveScopedService\(agent, 'tools'\)/u)
  assert.match(source, /scopedTools\.register\(createAlphaTool/u)
  assert.match(source, /syncAlphaToolForAgent\(ctx, agent, state, \(\) => runtimeConfig, capabilityStore, refStore, alphaToolRegistrations\)/u)
  assert.match(source, /event\?\.type === 'request\/header'[\s\S]*?syncAlphaToolForAgent\(ctx, agent, state/u)
  assert.doesNotMatch(source, /tools\.register\(createAlphaTool/u)
})
