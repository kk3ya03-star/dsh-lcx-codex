import { mergeFeatureHeader } from './compact-v2.js'
import { resolvePiResponsesModel } from './dsh-responses.js'
import { buildResponsesBody } from './responses-request.js'
import { streamResponsesRequest } from './responses-stream.js'

/**
 * Backward-compatible body helper retained for protocol tests and downstream imports.
 * Production managed replay already carries the DSH system prompt in canonical input;
 * `system` remains only as a low-level compatibility field.
 */
export function replayBody({ model, modelDescriptor, input, system, tools, promptCacheKey, promptCacheRetention, cacheRetention, reasoningEffort, temperature, maxTokens }) {
  const descriptor = modelDescriptor ?? resolvePiResponsesModel({
    route: { provider: 'lcx', model, baseURL: '' },
    model: { id: model, provider: 'lcx', baseUrl: '', api: 'openai-responses', reasoning: true, input: ['text'] },
  })
  const body = buildResponsesBody({
    model: descriptor,
    input,
    instructions: system,
    tools,
    promptCacheKey,
    promptCacheRetention,
    cacheRetention: cacheRetention ?? (promptCacheKey ? (promptCacheRetention ? 'long' : 'short') : 'none'),
    reasoningEffort,
    temperature,
    maxTokens,
  })
  // Opaque Native replay stays on the Remote V2 wire contract while sharing the standard builder.
  body.tool_choice = 'auto'
  body.parallel_tool_calls = true
  return body
}

/**
 * Compatibility wrapper: Native replay now uses the same builder/transport/parser as ordinary turns.
 */
export async function* requestNativeReplay({ baseURL, provider, model, modelDescriptor, input, system, tools, promptCacheKey, promptCacheRetention, cacheRetention, reasoningEffort, temperature, maxTokens, grammarToolInputProperties, headers, signal, timeoutMs, maxAttempts = 1, maxResponseBytes }) {
  const descriptor = modelDescriptor ?? resolvePiResponsesModel({
    route: { provider, model, baseURL },
    model: { id: model, provider, baseUrl: baseURL, api: 'openai-responses', reasoning: true, input: ['text'] },
  })
  const body = replayBody({
    model,
    modelDescriptor: descriptor,
    input,
    system,
    tools,
    promptCacheKey,
    promptCacheRetention,
    cacheRetention,
    reasoningEffort,
    temperature,
    maxTokens,
  })
  yield* streamResponsesRequest({
    baseURL,
    provider,
    model,
    piModel: descriptor,
    body,
    grammarToolInputProperties,
    headers: mergeFeatureHeader(headers),
    signal,
    timeoutMs,
    maxAttempts,
    maxResponseBytes,
  })
}
