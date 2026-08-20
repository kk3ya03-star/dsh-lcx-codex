import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import {
  CheckpointV3Store,
  LcxResponsesSearchProvider,
  apply,
  baseURLFingerprint,
  buildPortableHistory,
  buildPortableReplayMessages,
  buildPortableResponsesInput,
  hasPortableCheckpoint,
  normalizeCompactionResponse,
  normalizeHostedSearchArgs,
  portableResponsesToMessages,
  routeFingerprint,
} from '../lib/index.js'
import { fetchJson, fetchJsonWithRetry, fetchSseWithRetry } from '../lib/transport.js'
import { buildNativeCompactionBody, parseNativeCompactionSse, requestNativeCompaction } from '../lib/compact-v2.js'
import {
  HOSTED_SEARCH_OUTPUT,
  HOSTED_SEARCH_PARAMETERS,
  buildHostedSearchBody,
  parseHostedSearchResponse,
} from '../lib/web-search-hosted.js'
import {
  ALPHA_SEARCH_OUTPUT,
  ALPHA_SEARCH_PARAMETERS,
  ALPHA_SCHEMA_FINGERPRINT,
  buildAlphaSearchBody,
  normalizeAlphaSearchArgs,
  parseAlphaSearchResponse,
  probeAlphaCapabilities,
} from '../lib/web-search-alpha.js'
import { AlphaCapabilityStore, alphaCapabilityFingerprint } from '../lib/web-search-capability.js'
import { AlphaRefStore } from '../lib/web-search-ref-store.js'
import { createSessionGenerationTracker } from '../lib/session-lease.js'
import {
  buildPortableResponsesInputWithImages,
  hydrateNativeImageReferences,
  inputImageCount,
  normalInput,
  normalInputWithImages,
  persistNativeImageReferences,
  portableCheckpointState,
} from '../lib/compact.js'

function message(role, text, extra = {}) {
  return {
    id: `${role}-${Math.random()}`,
    role,
    content: [{ type: 'text', text }, ...(extra.content ?? [])],
    source: role === 'assistant'
      ? { kind: 'model', provider: 'lcx', model: 'gpt-5.6-sol' }
      : { kind: 'user' },
  }
}

function route(overrides = {}) {
  return {
    provider: 'lcx',
    model: 'gpt-5.6-sol',
    baseURL: 'https://api.lcxbot.com/v1',
    sessionId: 'session-1',
    ...overrides,
  }
}

function portableRecord(overrides = {}) {
  const currentRoute = route(overrides)
  const checkpointId = overrides.checkpointId ?? '11234567-89ab-cdef-0123-456789abcdef'
  const compaction = { type: 'compaction', id: 'cmp-v3', encrypted_content: 'opaque-v3' }
  return {
    version: 3,
    checkpointId,
    lineageId: currentRoute.sessionId,
    sourceSessionId: currentRoute.sessionId,
    provider: currentRoute.provider,
    model: currentRoute.model,
    modelKey: `${currentRoute.provider}:${currentRoute.model}`,
    baseURLFingerprint: baseURLFingerprint(currentRoute.baseURL),
    routeFingerprint: routeFingerprint(currentRoute),
    nativeOutput: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'native context' }] },
      compaction,
    ],
    nativeCompaction: compaction,
    portableHistory: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'portable context' }] },
    ],
    portableSummary: 'Portable context summary',
    createdAt: 1,
    ...overrides.record,
  }
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function compactSseResponse({ id = 'compact-response-1', object = 'response.compaction', usage = { input_tokens: 4, output_tokens: 2 }, output: outputOverride } = {}) {
  const output = outputOverride ?? [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'preserved context' }] },
    { type: 'compaction', id: 'cmp-native', encrypted_content: 'opaque-native' },
  ]
  const events = [
    { type: 'response.output_item.done', item: output[0] },
    { type: 'response.output_item.done', item: output[1] },
    { type: 'response.completed', response: { id, object, output, usage } },
  ]
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function replaySseResponse({ events, text = 'resumed', usage = { input_tokens: 4, output_tokens: 2 } } = {}) {
  const streamEvents = events ?? [
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'message-1', role: 'assistant', content: [] } },
    { type: 'response.output_text.delta', output_index: 0, item_id: 'message-1', delta: text },
    { type: 'response.output_text.done', output_index: 0, item_id: 'message-1', text },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'message-1', role: 'assistant', content: [{ type: 'output_text', text }] } },
    { type: 'response.completed', response: { output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage } },
  ]
  const payload = streamEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  const encoded = new TextEncoder().encode(payload)
  const chunks = []
  for (let offset = 0; offset < encoded.length; offset += 17) chunks.push(encoded.slice(offset, Math.min(offset + 17, encoded.length)))
  let index = 0
  const body = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++])
      else controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

test('session generation leases reject stale compaction commits after disposal', () => {
  const handlers = new Map()
  const session = { id: 'session-lease-1' }
  const ctx = {
    sessions: { list: () => [session] },
    on(event, handler) {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
  }
  const tracker = createSessionGenerationTracker(ctx)
  const lease = tracker.capture(session.id)
  lease.assert('request-start')
  handlers.get('session/disposed')(session)
  assert.throws(() => lease.assert('commit'), (error) => error.code === 'LCX_SESSION_GENERATION_STALE')
  const replacement = { id: session.id }
  handlers.get('session/created')(replacement)
  const replacementLease = tracker.capture(replacement.id)
  assert.doesNotThrow(() => replacementLease.assert('commit'))
  tracker.dispose()
})

function testContext(settingsValue, onTool, logger = { error() {} }) {
  let listener
  let registeredProvider
  const ctx = {
    logger,
    web: {
      searchProviderId: 'deepseek-official',
      registerSearchProvider(provider) {
        registeredProvider = provider
        return () => {}
      },
    },
    tools: {
      register(tool) {
        onTool?.(tool)
        return () => {}
      },
    },
    get(name) {
      if (name === 'credentials') return { resolve: async () => ({ value: 'stored-key', source: 'test' }) }
      if (name === 'settings') {
        return {
          register: () => ({ get: () => settingsValue, watch: () => () => {} }),
          get: () => undefined,
        }
      }
      return undefined
    },
    on(_event, handler) {
      listener = handler
    },
  }
  return {
    ctx,
    get listener() { return listener },
    get registeredProvider() { return registeredProvider },
  }
}

test('checkpoint v3 preserves portable history and migrates same-lineage model changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  try {
    const file = join(dir, 'checkpoints-v3.json')
    const store = new CheckpointV3Store(file)
    const id = '11234567-89ab-cdef-0123-456789abcdef'
    store.put(id, portableRecord({ checkpointId: id }))
    const messages = [
      message('user', `[dsh-lcx-codex-v3-checkpoint:${id}]`),
      {
        role: 'user',
        content: [
          { type: 'reasoning', text: 'private tail reasoning' },
          { type: 'text', text: 'new tail' },
        ],
      },
    ]
    assert.equal(hasPortableCheckpoint(messages), true)
    assert.deepEqual(buildPortableResponsesInput(messages, new CheckpointV3Store(file), route({ model: 'gpt-5.6-terra' })), [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Portable context summary' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'portable context' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'new tail' }] },
    ])
    assert.deepEqual(
      buildPortableResponsesInput(messages, new CheckpointV3Store(file), route({ model: 'gpt-5.6-terra', branchId: 'non-public-field' })),
      buildPortableResponsesInput(messages, new CheckpointV3Store(file), route({ model: 'gpt-5.6-terra' })),
    )
    assert.equal(
      routeFingerprint(route({ branchId: 'non-public-field' })),
      routeFingerprint(route()),
      'route identity must not depend on the nonexistent GenerateOptions.branchId field',
    )
    assert.deepEqual(buildPortableHistory([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'old' }] },
      { type: 'compaction', encrypted_content: 'must-not-copy' },
      { type: 'reasoning', encrypted_content: 'must-not-copy' },
    ]), [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'old' }] },
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('private reasoning blocks are ignored in strict DSH-to-Responses input', () => {
  const reasoning = { type: 'reasoning', text: 'private reasoning must not be sent' }
  const messages = [
    { role: 'assistant', content: [reasoning] },
    { role: 'user', content: [reasoning] },
  ]

  assert.deepEqual(normalInput(messages, { strict: true }), [])
  assert.deepEqual(buildPortableResponsesInput(messages, {}, route()), [])
})

test('strict input preserves sendable text and tool blocks around reasoning', () => {
  const messages = [
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'private assistant reasoning' },
        { type: 'text', text: 'assistant text' },
        { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'reasoning', text: 'private user reasoning' },
        { type: 'text', text: 'user text' },
        { type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'tool output' }] },
      ],
    },
  ]
  const expected = [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'assistant text' }] },
    { type: 'function_call', call_id: 'call-1', name: 'read', arguments: '{}' },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'user text' }] },
    { type: 'function_call_output', call_id: 'call-1', output: 'tool output' },
  ]

  assert.deepEqual(normalInput(messages, { strict: true }), expected)
  assert.deepEqual(buildPortableResponsesInput(messages, {}, route()), expected)
  assert.equal(JSON.stringify(expected).includes('private'), false)
})

test('strict input still rejects image and unknown content blocks', () => {
  for (const block of [
    { type: 'image', source: 'not portable' },
    { type: 'vendor-private', value: 'not portable' },
  ]) {
    const messages = [{ role: 'user', content: [block] }]
    assert.throws(
      () => normalInput(messages, { strict: true }),
      (error) => error.code === 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT' && error.message.endsWith(`: ${block.type}`),
    )
    assert.throws(
      () => buildPortableResponsesInput(messages, {}, route()),
      (error) => error.code === 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT' && error.message.endsWith(`: ${block.type}`),
    )
  }
})

test('native image input resolves attachments into Responses input_image without losing text', async () => {
  const input = await normalInputWithImages([
    { role: 'user', content: [{ type: 'text', text: 'inspect this' }, { type: 'image', attachment: { attachmentId: 'sha256:test', mediaType: 'image/png' } }] },
  ], {
    strict: true,
    resolveImage: async () => ({ data: Uint8Array.from([1, 2, 3]), mediaType: 'image/png' }),
  })
  assert.deepEqual(input, [{
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: 'inspect this' },
      { type: 'input_image', image_url: 'data:image/png;base64,AQID' },
    ],
  }])
  assert.equal(inputImageCount(input), 1)
})

test('native image input rejects missing, unsupported, and oversized attachments', async () => {
  const messageWithImage = [{ role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'sha256:test', mediaType: 'image/png' } }] }]
  await assert.rejects(
    normalInputWithImages(messageWithImage, { strict: true }),
    { code: 'LCX_COMPACT_IMAGE_UNAVAILABLE' },
  )
  await assert.rejects(
    normalInputWithImages(messageWithImage, {
      strict: true,
      resolveImage: async () => ({ data: Uint8Array.from([1]), mediaType: 'image/svg+xml' }),
    }),
    { code: 'LCX_COMPACT_IMAGE_UNSUPPORTED' },
  )
  await assert.rejects(
    normalInputWithImages(messageWithImage, {
      strict: true,
      resolveImage: async () => ({ data: new Uint8Array(20 * 1024 * 1024 + 1), mediaType: 'image/png' }),
    }),
    { code: 'LCX_COMPACT_IMAGE_TOO_LARGE' },
  )
})

test('native image references persist without base64 and hydrate only at request time', async () => {
  const attachment = {
    attachmentId: `sha256:${'a'.repeat(64)}`,
    mediaType: 'image/png',
    bytes: 3,
    width: 1,
    height: 1,
    name: 'test.png',
  }
  const imageUrl = 'data:image/png;base64,AQID'
  const persisted = persistNativeImageReferences([
    { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: imageUrl }] },
    { type: 'compaction', encrypted_content: 'opaque' },
  ], new Map([[imageUrl, attachment]]))
  assert.deepEqual(persisted[0].content, [{ type: 'dsh_image_attachment', attachment }])
  assert.equal(JSON.stringify(persisted).includes('data:image'), false)

  const hydrated = await hydrateNativeImageReferences(persisted, {
    resolveImage: async (block) => {
      assert.deepEqual(block.attachment, attachment)
      return { data: Uint8Array.from([1, 2, 3]), mediaType: 'image/png' }
    },
  })
  assert.deepEqual(hydrated[0].content, [{ type: 'input_image', image_url: imageUrl }])
})

test('checkpoint store accepts durable image refs and rejects raw input_image data URLs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-image-'))
  const file = join(dir, 'checkpoints-v3.json')
  const attachment = {
    attachmentId: `sha256:${'b'.repeat(64)}`,
    mediaType: 'image/png',
    bytes: 3,
    width: 1,
    height: 1,
  }
  try {
    const goodId = '71234567-89ab-cdef-0123-456789abcdef'
    const good = portableRecord({ checkpointId: goodId, record: {
      nativeOutput: [
        { type: 'message', role: 'user', content: [{ type: 'dsh_image_attachment', attachment }] },
        { type: 'compaction', id: 'cmp-v3', encrypted_content: 'opaque-v3' },
      ],
      portableHistory: [
        { type: 'message', role: 'user', content: [{ type: 'dsh_image_attachment', attachment }] },
      ],
      portableImageCount: 1,
    } })
    const store = new CheckpointV3Store(file)
    store.put(goodId, good)
    assert.equal(JSON.stringify(store.get(goodId)).includes('data:image'), false)

    const badId = '81234567-89ab-cdef-0123-456789abcdef'
    const bad = portableRecord({ checkpointId: badId, record: {
      nativeOutput: [
        { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AQID' }] },
        { type: 'compaction', id: 'cmp-v3', encrypted_content: 'opaque-v3' },
      ],
      portableImageCount: 1,
    } })
    assert.throws(() => store.put(badId, bad), { code: 'LCX_CHECKPOINT_V3_CORRUPT' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('native image input supports images nested in tool results without silent loss', async () => {
  const input = await normalInputWithImages([{ role: 'user', content: [{
    type: 'tool-result',
    toolCallId: 'call-image',
    content: [
      { type: 'text', text: 'before' },
      { type: 'image', attachment: { attachmentId: 'sha256:test', mediaType: 'image/png' } },
      { type: 'text', text: 'after' },
    ],
  }] }], {
    strict: true,
    resolveImage: async () => ({ data: Uint8Array.from([1, 2, 3]), mediaType: 'image/png' }),
  })
  assert.deepEqual(input, [{
    type: 'function_call_output',
    call_id: 'call-image',
    output: [
      { type: 'input_text', text: 'before' },
      { type: 'input_image', image_url: 'data:image/png;base64,AQID' },
      { type: 'input_text', text: 'after' },
    ],
  }])
  assert.equal(inputImageCount(input), 1)
})

test('portable history persists durable image refs without image bytes', async () => {
  const attachment = {
    attachmentId: `sha256:${'c'.repeat(64)}`,
    mediaType: 'image/png',
    bytes: 3,
    width: 1,
    height: 1,
  }
  const input = await normalInputWithImages([
    { role: 'user', content: [{ type: 'text', text: 'image context' }, { type: 'image', attachment }] },
  ], {
    resolveImage: async () => ({ data: Uint8Array.from([1, 2, 3]), mediaType: 'image/png' }),
  })
  const imageUrl = 'data:image/png;base64,AQID'
  const persisted = persistNativeImageReferences(input, new Map([[imageUrl, attachment]]))
  const history = buildPortableHistory(persisted)
  assert.equal(inputImageCount(input), 1)
  assert.deepEqual(history, [{ type: 'message', role: 'user', content: [
    { type: 'input_text', text: 'image context' },
    { type: 'dsh_image_attachment', attachment },
  ] }])
  assert.equal(JSON.stringify(history).includes('AQID'), false)
})

test('legacy portable image count without a durable ref fails closed', async () => {
  const checkpointId = '61234567-89ab-cdef-0123-456789abcdef'
  const record = portableRecord({ checkpointId, record: { portableImageCount: 1 } })
  await assert.rejects(
    buildPortableResponsesInputWithImages(
      [{ role: 'user', content: [{ type: 'text', text: `[dsh-lcx-codex-v3-checkpoint:${checkpointId}]` }] }],
      { get() { return record } },
      route({ model: 'gpt-5.6-terra' }),
    ),
    { code: 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT' },
  )
})

test('portable replay restores durable images for supported targets and uses visible placeholders otherwise', () => {
  const checkpointId = '71234567-89ab-cdef-0123-456789abcdef'
  const marker = `[dsh-lcx-codex-v3-checkpoint:${checkpointId}]`
  const attachment = {
    attachmentId: `sha256:${'d'.repeat(64)}`,
    mediaType: 'image/png',
    bytes: 3,
    width: 1,
    height: 1,
  }
  const record = portableRecord({ checkpointId, record: {
    portableHistory: [{ type: 'message', role: 'user', content: [
      { type: 'input_text', text: 'inspect this image' },
      { type: 'dsh_image_attachment', attachment },
    ] }],
    portableImageCount: 1,
  } })
  const store = { get() { return record } }
  const childRoute = route({ sessionId: 'child', ancestorSessionIds: ['session-1'] })

  const supported = buildPortableReplayMessages([message('user', marker)], store, childRoute, { imageSupport: 'supported' })
  assert.deepEqual(supported.at(-1).content, [
    { type: 'text', text: 'inspect this image' },
    { type: 'image', attachment },
  ])

  const unsupported = buildPortableReplayMessages([message('user', marker)], store, childRoute, { imageSupport: 'unsupported' })
  assert.equal(unsupported.at(-1).content.some((block) => block.type === 'image'), false)
  assert.match(unsupported.at(-1).content.at(-1).text, /target model does not support image input/iu)

  assert.throws(
    () => buildPortableReplayMessages([message('user', marker)], store, childRoute, { imageSupport: 'unknown' }),
    { code: 'LCX_COMPACT_IMAGE_CAPABILITY_UNKNOWN' },
  )
})

test('portable remote compaction hydrates durable images only for supported targets', async () => {
  const checkpointId = '81234567-89ab-cdef-0123-456789abcdef'
  const attachment = {
    attachmentId: `sha256:${'e'.repeat(64)}`,
    mediaType: 'image/png',
    bytes: 3,
    width: 1,
    height: 1,
  }
  const record = portableRecord({ checkpointId, record: {
    portableHistory: [{ type: 'message', role: 'user', content: [
      { type: 'input_text', text: 'portable image' },
      { type: 'dsh_image_attachment', attachment },
    ] }],
    portableImageCount: 1,
  } })
  const messages = [message('user', `[dsh-lcx-codex-v3-checkpoint:${checkpointId}]`)]
  const store = { get() { return record } }
  const targetRoute = route({ model: 'gpt-5.6-terra' })
  const resolveImage = async (block) => {
    assert.deepEqual(block.attachment, attachment)
    return { ref: attachment, data: Uint8Array.from([1, 2, 3]), mediaType: 'image/png' }
  }

  const supported = await buildPortableResponsesInputWithImages(messages, store, targetRoute, {
    imageSupport: 'supported',
    resolveImage,
  })
  assert.equal(JSON.stringify(supported).includes('data:image/png;base64,AQID'), true)

  const unsupported = await buildPortableResponsesInputWithImages(messages, store, targetRoute, {
    imageSupport: 'unsupported',
  })
  assert.equal(JSON.stringify(unsupported).includes('data:image'), false)
  assert.match(JSON.stringify(unsupported), /target model does not support image input/iu)

  await assert.rejects(
    buildPortableResponsesInputWithImages(messages, store, targetRoute, { imageSupport: 'unknown' }),
    { code: 'LCX_COMPACT_IMAGE_CAPABILITY_UNKNOWN' },
  )
})

test('portable migration projects DSH reasoning and excludes native reasoning items', () => {
  const checkpointId = '51234567-89ab-cdef-0123-456789abcdef'
  const marker = `[dsh-lcx-codex-v3-checkpoint:${checkpointId}]`
  const nativeReasoning = { type: 'reasoning', id: 'native-reasoning-1', summary: [{ type: 'summary_text', text: 'native-only reasoning' }] }
  const record = portableRecord({
    checkpointId,
    record: {
      nativeOutput: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'native context' }] },
        nativeReasoning,
        { type: 'compaction', id: 'cmp-native', encrypted_content: 'opaque-native' },
      ],
      portableHistory: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'portable context' }] },
      ],
    },
  })
  const store = { get() { return record } }
  const tail = {
    role: 'assistant',
    content: [
      { type: 'reasoning', text: 'private migration reasoning' },
      { type: 'text', text: 'visible migration text' },
    ],
  }
  const migrated = buildPortableReplayMessages([message('user', marker), tail], store, route({ model: 'gpt-5.6-terra' }))

  assert.equal(migrated.at(-1).content[0].text, 'visible migration text')
  assert.equal(migrated.some((item) => item.content?.some((block) => block.type === 'reasoning')), false)
  assert.equal(JSON.stringify(migrated).includes('private migration reasoning'), false)
  assert.equal(JSON.stringify(migrated).includes('native-only reasoning'), false)
  for (const block of [
    { type: 'image', source: 'not portable' },
    { type: 'vendor-private', value: 'not portable' },
  ]) {
    assert.throws(
      () => buildPortableReplayMessages([message('user', marker), { role: 'user', content: [block] }], store, route({ model: 'gpt-5.6-terra' })),
      (error) => error.code === 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT' && error.message.endsWith(`: ${block.type}`),
    )
  }
})

test('portable migration filters unpaired calls from persisted history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  try {
    const file = join(dir, 'checkpoints-v3.json')
    const id = '11234567-89ab-cdef-0123-456789abcdef'
    const legacyRecord = portableRecord({
      checkpointId: id,
      record: {
        portableHistory: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ordinary context' }] },
          { type: 'function_call', call_id: 'call-orphan', name: 'glob', arguments: '{}' },
          { type: 'function_call', call_id: 'call-matched', name: 'read', arguments: '{}' },
          { type: 'function_call_output', call_id: 'call-matched', output: 'matched output' },
        ],
      },
    })
    writeFileSync(file, JSON.stringify({ version: 3, checkpoints: { [id]: legacyRecord } }))
    assert.throws(
      () => new CheckpointV3Store(file).put('21234567-89ab-cdef-0123-456789abcdef', portableRecord({ checkpointId: '21234567-89ab-cdef-0123-456789abcdef', record: { portableHistory: [{ type: 'function_call', call_id: 'call-orphan', name: 'read', arguments: '{}' }] } })),
      (error) => error.code === 'LCX_CHECKPOINT_V3_CORRUPT',
    )
    const messages = [
      message('user', `[dsh-lcx-codex-v3-checkpoint:${id}]`),
      message('user', 'new tail'),
    ]

    const migrated = buildPortableResponsesInput(messages, new CheckpointV3Store(file), route({ model: 'gpt-5.6-terra' }))
    assert.equal(migrated.some((item) => item.type === 'function_call' && item.call_id === 'call-orphan'), false)
    assert.deepEqual(migrated, [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Portable context summary' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ordinary context' }] },
      { type: 'function_call', call_id: 'call-matched', name: 'read', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call-matched', output: 'matched output' },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'new tail' }] },
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('checkpoint v3 store observes external atomic writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  try {
    const file = join(dir, 'checkpoints-v3.json')
    const first = new CheckpointV3Store(file)
    const second = new CheckpointV3Store(file)
    const id = '31234567-89ab-cdef-0123-456789abcdef'
    second.put(id, portableRecord({ checkpointId: id }))
    assert.equal(first.has(id), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('portable history retains only matched Responses tool-call pairs', () => {
  assert.deepEqual(buildPortableHistory([
    { type: 'function_call', call_id: 'call-glob', name: 'glob', arguments: '{"pattern":"**/*"}' },
    { type: 'function_call_output', call_id: 'call-glob', output: 'glob output' },
    { type: 'function_call', call_id: 'call-read', name: 'read', arguments: '{"file_path":"README.md"}' },
    { type: 'function_call', call_id: 'call-grep', name: 'grep', arguments: '{"pattern":"needle"}' },
    { type: 'function_call_output', call_id: 'call-grep', output: 'grep output' },
    { type: 'function_call_output', call_id: 'call-orphan', output: 'orphan output' },
  ]), [
    { type: 'function_call', call_id: 'call-glob', name: 'glob', arguments: '{"pattern":"**/*"}' },
    { type: 'function_call_output', call_id: 'call-glob', output: 'glob output' },
    { type: 'function_call', call_id: 'call-grep', name: 'grep', arguments: '{"pattern":"needle"}' },
    { type: 'function_call_output', call_id: 'call-grep', output: 'grep output' },
  ])
})

test('portable Responses replay converts safe text and paired tool calls only', () => {
  const marker = '[dsh-lcx-codex-v3-checkpoint:11234567-89ab-cdef-0123-456789abcdef]'
  const messages = portableResponsesToMessages([
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'portable user' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'portable assistant' }] },
    { type: 'function_call', call_id: 'call-safe', name: 'glob', arguments: '{"pattern":"**/*"}' },
    { type: 'function_call_output', call_id: 'call-safe', output: 'tool output' },
    { type: 'function_call', call_id: 'call-orphan', name: 'read', arguments: '{}' },
    { type: 'compaction', encrypted_content: 'opaque' },
    { type: 'response.output_text.delta', delta: 'must omit' },
    { type: 'message', role: 'user', encrypted_content: 'opaque', content: [{ type: 'input_text', text: 'must omit' }] },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: `${marker} tail` }] },
  ], { checkpointId: 'checkpoint-1' })

  assert.deepEqual(messages.map((item) => item.role), ['user', 'assistant', 'assistant', 'user', 'user'])
  assert.equal(messages[0].content[0].text, 'portable user')
  assert.equal(messages[1].content[0].text, 'portable assistant')
  assert.deepEqual(messages[2].content[0], { type: 'tool-call', id: 'call-safe', name: 'glob', arguments: '{"pattern":"**/*"}' })
  assert.deepEqual(messages[3].content[0], { type: 'tool-result', toolCallId: 'call-safe', content: [{ type: 'text', text: 'tool output' }] })
  assert.equal(messages[4].content[0].text, 'tail')
  assert.equal(messages.every((item) => item.source.plugin === 'dsh-lcx-codex' && item.source.purpose === 'checkpoint-recall'), true)
  assert.equal(JSON.stringify(messages).includes(marker), false)
  assert.equal(JSON.stringify(messages).includes('opaque'), false)
  assert.equal(JSON.stringify(messages).includes('call-orphan'), false)
})

test('portable replay normalizes array tool output and rejects unsupported output parts', () => {
  const messages = portableResponsesToMessages([
    { type: 'function_call', call_id: 'call-array', name: 'read', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call-array', output: [
      { type: 'input_text', text: 'array ' },
      { type: 'input_text', text: 'output' },
    ] },
  ], { checkpointId: 'checkpoint-1' })
  assert.deepEqual(messages[1].content[0], {
    type: 'tool-result',
    toolCallId: 'call-array',
    content: [{ type: 'text', text: 'array output' }],
  })
  assert.throws(
    () => portableResponsesToMessages([
      { type: 'function_call', call_id: 'call-image', name: 'read', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call-image', output: [{ type: 'input_image', image_url: 'opaque' }] },
    ], { checkpointId: 'checkpoint-1' }),
    (error) => error.code === 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT',
  )
})

test('portable replay rejects unsupported Responses items instead of dropping them', () => {
  assert.throws(
    () => portableResponsesToMessages([{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'hidden' }] }], { checkpointId: 'checkpoint-1' }),
    (error) => error.code === 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT',
  )
})

test('portable history rejects visible unsupported Responses items before migration', () => {
  assert.throws(
    () => buildPortableHistory([{ type: 'web_search_call', action: { sources: [] } }]),
    (error) => error.code === 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT',
  )
  assert.throws(
    () => buildPortableHistory([{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'hidden' }] }]),
    (error) => error.code === 'LCX_CHECKPOINT_PORTABLE_UNSUPPORTED_CONTENT',
  )
})

test('portable replay never truncates tool-call JSON arguments', () => {
  const messages = portableResponsesToMessages([
    { type: 'function_call', call_id: 'call-large', name: 'read', arguments: JSON.stringify({ path: 'abcdefghijklmnopqrstuvwxyz' }) },
    { type: 'function_call_output', call_id: 'call-large', output: 'result' },
  ], { budget: { chars: 12, bytes: 100 }, checkpointId: 'checkpoint-1' })
  assert.deepEqual(messages, [])
})

test('only user-role v3 markers are recognized and user v2 markers are rejected', () => {
  const id = '11234567-89ab-cdef-0123-456789abcdef'
  const marker = `[dsh-lcx-codex-v3-checkpoint:${id}]`
  const oldMarker = '[dsh-lcx-codex-checkpoint:11234567-89ab-cdef-0123-456789abcdef]'
  const assistantMessages = [
    message('assistant', `Narrative mentions ${marker} and ${oldMarker}`),
    message('tool', `Tool output mentions ${oldMarker}`),
    message('user', 'continue'),
  ]

  assert.equal(hasPortableCheckpoint(assistantMessages), false)
  assert.deepEqual(buildPortableResponsesInput(assistantMessages, {
    get() {
      throw new Error('narrative marker must not be replayed')
    },
  }, route()), [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Narrative mentions ${marker} and ${oldMarker}` }] },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: `Tool output mentions ${oldMarker}` }] },
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'continue' }] },
  ])
  assert.equal(hasPortableCheckpoint([message('user', marker)]), true)
  assert.throws(
    () => hasPortableCheckpoint([message('user', oldMarker)]),
    { code: 'LCX_CHECKPOINT_V2_UNSUPPORTED' },
  )
})

test('compact response normalization requires exactly one non-empty compaction item', () => {
  const valid = normalizeCompactionResponse({
    object: 'response.compaction',
    id: 'resp-1',
    output: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'keep' }] },
      { type: 'reasoning', id: 'reasoning-1', encrypted_content: 'opaque-reasoning', summary: [{ type: 'summary_text', text: 'private' }] },
      { type: 'compaction', encrypted_content: 'secret' },
    ],
  })
  assert.equal(valid.compaction.encrypted_content, 'secret')
  assert.equal(valid.output.length, 3)
  assert.equal(valid.output[1].encrypted_content, 'opaque-reasoning')
  assert.throws(
    () => normalizeCompactionResponse({ object: 'response.compaction', output: [] }),
    (error) => error.code === 'LCX_COMPACT_MISSING_ITEM' && /outputLength=0/u.test(error.message),
  )
  assert.throws(() => normalizeCompactionResponse({ object: 'response.compaction', output: [{ type: 'compaction', encrypted_content: 'a' }, { type: 'compaction', encrypted_content: 'b' }] }), { code: 'LCX_COMPACT_MULTIPLE_ITEMS' })
  assert.throws(() => normalizeCompactionResponse({ object: 'response.compaction', output: [{ type: 'compaction', encrypted_content: '' }] }), (error) => ['LCX_COMPACT_EMPTY_ENCRYPTED_CONTENT', 'LCX_COMPACT_INVALID_RESPONSE'].includes(error.code))
})

test('native V2 merges output_item added/done and preserves completed authority', async () => {
  const events = [
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'message-1', role: 'assistant', content: [] } },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'message-1', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] } },
    { type: 'response.output_item.added', output_index: 1, item: { type: 'compaction', id: 'compact-1', encrypted_content: 'added-secret' } },
    { type: 'response.output_item.done', output_index: 1, item: { type: 'compaction', id: 'compact-1', encrypted_content: 'done-secret' } },
    { type: 'response.completed', response: { id: 'completed-1', output: [
      { type: 'message', id: 'message-1', role: 'assistant', content: [{ type: 'output_text', text: 'authoritative' }] },
      { type: 'compaction', id: 'compact-1', encrypted_content: 'completed-secret' },
    ] } },
  ]
  const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  const parsed = await parseNativeCompactionSse(new Response(payload), { maxResponseBytes: 100000 })
  assert.equal(parsed.output.length, 2)
  assert.equal(parsed.output[0].content[0].text, 'authoritative')
  assert.equal(parsed.compaction.encrypted_content, 'completed-secret')

  const fallbackEvents = [...events.slice(0, 4), { type: 'response.completed', response: { id: 'completed-2', output: [{ type: 'message', content: [] }, { type: 'compaction', id: 'compact-1' }] } }]
  const fallbackPayload = fallbackEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  const fallback = await parseNativeCompactionSse(new Response(fallbackPayload), { maxResponseBytes: 100000 })
  assert.equal(fallback.compaction.encrypted_content, 'done-secret')
  assert.equal(fallback.output.filter((item) => item.type === 'message').length, 1)
})

test('portable history treats function calls and outputs as one budget unit', () => {
  const call = { type: 'function_call', call_id: 'pair-1', name: 'read', arguments: '{}' }
  const output = { type: 'function_call_output', call_id: 'pair-1', output: 'result' }
  const newest = { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'newest' }] }
  const newestChars = JSON.stringify(newest).length
  const history = buildPortableHistory([newest, call, output], {
    tokenBudget: Math.ceil(newestChars / 4) + 1,
    byteBudget: 100000,
  })
  assert.deepEqual(history, [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'newest' }] }])
})

test('portable migration without a current session is portable-only', () => {
  const record = portableRecord()
  assert.equal(portableCheckpointState(record, route({ sessionId: undefined })), 'portable-migratable')
  assert.notEqual(portableCheckpointState(record, route({ sessionId: undefined })), 'native-compatible')
})

test('portable migration accepts a child session whose ancestry contains the checkpoint source', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  try {
    const file = join(dir, 'checkpoints-v3.json')
    const store = new CheckpointV3Store(file)
    const id = '21234567-89ab-cdef-0123-456789abcdef'
    store.put(id, portableRecord({ checkpointId: id }))
    const child = route({ sessionId: 'session-child', model: 'gpt-5.6-terra', ancestorSessionIds: ['session-1'] })
    assert.equal(portableCheckpointState(store.get(id), child), 'portable-migratable')
    const marker = `[dsh-lcx-codex-v3-checkpoint:${id}]`
    const input = buildPortableResponsesInput([message('user', marker)], store, child)
    assert.equal(input[0].content[0].text, 'Portable context summary')
    assert.equal(JSON.stringify(input).includes('opaque-v3'), false)
    assert.throws(
      () => buildPortableResponsesInput([message('user', marker)], store, route({ sessionId: 'session-other', model: 'gpt-5.6-terra', ancestorSessionIds: ['not-the-parent'] })),
      (error) => error.code === 'LCX_CHECKPOINT_ROUTE_MISMATCH' && /session/u.test(error.message),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('compact normalization rejects invalid item, trigger, and call/output shapes', () => {
  const validCompaction = { type: 'compaction', encrypted_content: 'secret' }
  assert.throws(() => normalizeCompactionResponse({ object: 'response.compaction', output: [
    { type: 'message', role: 'assistant', content: 'not-an-array' }, validCompaction,
  ] }), { code: 'LCX_COMPACT_INVALID_RESPONSE' })
  assert.throws(() => normalizeCompactionResponse({ object: 'response.compaction', output: [
    { type: 'compaction_trigger' }, validCompaction,
  ] }), { code: 'LCX_COMPACT_INVALID_RESPONSE' })
  assert.throws(() => normalizeCompactionResponse({ object: 'response.compaction', output: [
    { type: 'function_call_output', call_id: 'missing-call', output: 'orphan' }, validCompaction,
  ] }), { code: 'LCX_COMPACT_INVALID_RESPONSE' })
})

test('native V2 compaction builds the trigger request and parses SSE output', async () => {
  const body = buildNativeCompactionBody({
    model: 'gpt-5.6-sol',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'keep' }] }],
    promptCacheKey: 'session-1',
    tools: [{ name: 'websearch_gpt', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }],
  })
  assert.equal(body.stream, true)
  assert.equal(body.store, false)
  assert.deepEqual(body.tools, [{ type: 'function', name: 'websearch_gpt', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, strict: false }])
  assert.deepEqual(body.input.at(-1), { type: 'compaction_trigger' })
  const parsed = await parseNativeCompactionSse(compactSseResponse(), { maxResponseBytes: 100000 })
  assert.equal(parsed.responseId, 'compact-response-1')
  assert.equal(parsed.output.length, 2)
  assert.equal(parsed.compaction.encrypted_content, 'opaque-native')
  assert.deepEqual(parsed.usage, { inputTokens: 4, outputTokens: 2 })
  assert.throws(() => buildNativeCompactionBody({ model: 'gpt-5.6-sol', input: [{ type: 'compaction_trigger' }] }), { code: 'LCX_COMPACT_DUPLICATE_TRIGGER' })
})

test('native V2 retries reuse one idempotency key', async () => {
  const previousFetch = globalThis.fetch
  const seen = []
  let attempts = 0
  globalThis.fetch = async (_url, init) => {
    attempts += 1
    seen.push(init.headers['idempotency-key'])
    if (attempts === 1) return new Response('temporary failure', { status: 503 })
    return compactSseResponse()
  }
  try {
    await requestNativeCompaction({
      baseURL: 'https://api.lcxbot.com/v1',
      model: 'gpt-5.6-sol',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'keep' }] }],
      idempotencyKey: 'retry-key',
      headers: { authorization: 'Bearer test-key' },
      signal: AbortSignal.timeout(5000),
      timeoutMs: 5000,
      maxAttempts: 2,
    })
    assert.deepEqual(seen, ['retry-key', 'retry-key'])
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('native V2 accepts standard Responses response object with a compaction item', async () => {
  const parsed = await parseNativeCompactionSse(compactSseResponse({ object: 'response' }), { maxResponseBytes: 100000 })
  assert.equal(parsed.compaction.encrypted_content, 'opaque-native')
})

test('native V2 compaction suppresses an all-zero usage report', async () => {
  const parsed = await parseNativeCompactionSse(compactSseResponse({ usage: { input_tokens: 0, output_tokens: 0 } }), { maxResponseBytes: 100000 })
  assert.equal(parsed.usage, undefined)
})

test('native V2 compaction preserves cached-only usage and cache writes', async () => {
  const parsed = await parseNativeCompactionSse(compactSseResponse({
    usage: {
      input_tokens: 10,
      output_tokens: 0,
      input_tokens_details: { cached_tokens: 5, cache_write_tokens: 2 },
    },
  }), { maxResponseBytes: 100000 })
  assert.deepEqual(parsed.usage, {
    inputTokens: 3,
    outputTokens: 0,
    cacheReadTokens: 5,
    cacheWriteTokens: 2,
  })
})

test('hosted Web Search normalizes the complete supported option set', () => {
  assert.deepEqual(normalizeHostedSearchArgs({
    query: '  current news  ',
    searchContextSize: 'high',
    allowedDomains: ['OpenAI.com', 'developers.openai.com'],
    blockedDomains: ['example.com'],
    userLocation: { country: 'us', city: ' New York ', region: ' NY ', timezone: 'America/New_York' },
    externalWebAccess: false,
    returnTokenBudget: 'unlimited',
    searchContentTypes: ['image', 'text'],
    imageSettings: { maxResults: 3, caption: true },
  }), {
    query: 'current news',
    searchContextSize: 'high',
    allowedDomains: ['openai.com', 'developers.openai.com'],
    blockedDomains: ['example.com'],
    userLocation: { country: 'US', city: 'New York', region: 'NY', timezone: 'America/New_York' },
    externalWebAccess: false,
    returnTokenBudget: 'unlimited',
    searchContentTypes: ['image', 'text'],
    imageSettings: { maxResults: 3, caption: true },
  })
  assert.throws(() => normalizeHostedSearchArgs({}), { code: 'WEB_INVALID_REQUEST' })
  assert.throws(() => normalizeHostedSearchArgs({ query: '' }), { code: 'WEB_INVALID_REQUEST' })
  assert.throws(() => normalizeHostedSearchArgs({ query: 'test', finance: [{ ticker: '600522' }] }), { code: 'WEB_INVALID_REQUEST' })
  assert.throws(() => normalizeHostedSearchArgs({ query: 'test', allowedDomains: ['https://openai.com'] }), { code: 'WEB_INVALID_REQUEST' })
  assert.throws(() => normalizeHostedSearchArgs({ query: 'test', allowedDomains: ['openai.com'], blockedDomains: ['OPENAI.COM'] }), { code: 'WEB_INVALID_REQUEST' })
  assert.throws(() => normalizeHostedSearchArgs({ query: 'test', userLocation: { country: 'USA' } }), { code: 'WEB_INVALID_REQUEST' })
  assert.throws(() => normalizeHostedSearchArgs({ query: 'test', userLocation: { timezone: 'not-a-timezone' } }), { code: 'WEB_INVALID_REQUEST' })
  assert.throws(() => normalizeHostedSearchArgs({ query: 'test', searchContentTypes: ['text'], imageSettings: { maxResults: 3 } }), { code: 'WEB_INVALID_REQUEST' })
  assert.throws(() => normalizeHostedSearchArgs({ query: 'test', searchContentTypes: ['image'], imageSettings: { maxResults: 0 } }), { code: 'WEB_INVALID_REQUEST' })
})

test('Web Search tool schemas stay within the enforced DSH JSON Schema subset', () => {
  const allowed = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'examples'])
  const inspect = (schema, path = 'schema') => {
    assert.equal(schema !== null && typeof schema === 'object' && !Array.isArray(schema), true, `${path} must be an object`)
    for (const key of Object.keys(schema)) assert.equal(allowed.has(key), true, `${path}.${key} is unsupported by DSH`)
    if (schema.properties) for (const [key, child] of Object.entries(schema.properties)) inspect(child, `${path}.properties.${key}`)
    if (schema.items) inspect(schema.items, `${path}.items`)
    if (schema.oneOf) schema.oneOf.forEach((child, index) => inspect(child, `${path}.oneOf.${index}`))
  }
  for (const schema of [HOSTED_SEARCH_PARAMETERS, HOSTED_SEARCH_OUTPUT, ALPHA_SEARCH_PARAMETERS, ALPHA_SEARCH_OUTPUT]) inspect(schema)
})

test('hosted Web Search maps every option to the Responses wire contract', () => {
  const normalized = normalizeHostedSearchArgs({
    query: 'current research',
    searchContextSize: 'low',
    allowedDomains: ['openai.com'],
    blockedDomains: ['example.com'],
    userLocation: { country: 'GB', city: 'London' },
    externalWebAccess: true,
    returnTokenBudget: 'default',
    searchContentTypes: ['image', 'text'],
    imageSettings: { maxResults: 2, caption: false },
  })
  assert.deepEqual(buildHostedSearchBody(normalized, 'gpt-5.6-sol'), {
    model: 'gpt-5.6-sol',
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'current research' }] }],
    tools: [{
      type: 'web_search',
      search_context_size: 'low',
      filters: { allowed_domains: ['openai.com'], blocked_domains: ['example.com'] },
      user_location: { type: 'approximate', country: 'GB', city: 'London' },
      external_web_access: true,
      return_token_budget: 'default',
      search_content_types: ['image', 'text'],
      image_settings: { max_results: 2, caption: false },
    }],
    tool_choice: 'required',
    include: ['web_search_call.action.sources', 'web_search_call.results'],
    stream: false,
    store: false,
  })
})

test('credential transport explicitly rejects redirects', async () => {
  const previousFetch = globalThis.fetch
  let requestInit
  globalThis.fetch = async (_url, init) => {
    requestInit = init
    return jsonResponse({ message: 'redirect denied' }, 302)
  }
  try {
    await assert.rejects(() => fetchJson('https://api.example/v1/responses', {}, { authorization: 'Bearer redacted' }, undefined, 1000, { maxResponseBytes: 1000 }), { code: 'LCX_HTTP_ERROR' })
    assert.equal(requestInit.redirect, 'error')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('JSON transport enforces UTF-8 byte limits and Retry-After retries', async () => {
  const previousFetch = globalThis.fetch
  let attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    if (attempts === 1) return new Response(JSON.stringify({ error: 'busy' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } })
    return jsonResponse({ ok: true })
  }
  try {
    const result = await fetchJsonWithRetry('https://api.example/v1/responses', {}, {}, undefined, 1000, { maxAttempts: 2, baseDelayMs: 100, maxResponseBytes: 1000 })
    assert.deepEqual(result, { ok: true })
    assert.equal(attempts, 2)
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'retry later' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '999999999' } })
    await assert.rejects(
      () => fetchJsonWithRetry('https://api.example/v1/responses', {}, {}, undefined, 20, { maxAttempts: 2, baseDelayMs: 1, maxResponseBytes: 1000 }),
      { code: 'LCX_TIMEOUT' },
    )
    globalThis.fetch = async () => new Response('😀😀', { status: 200, headers: { 'content-type': 'application/json' } })
    await assert.rejects(
      () => fetchJson('https://api.example/v1/responses', {}, {}, undefined, 1000, { maxResponseBytes: 5 }),
      { code: 'LCX_RESPONSE_TOO_LARGE' },
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('JSON transport retries only 429 and 5xx HTTP responses', async () => {
  const previousFetch = globalThis.fetch
  try {
    for (const status of [408, 413, 425]) {
      let attempts = 0
      globalThis.fetch = async () => {
        attempts += 1
        return jsonResponse({ error: 'do not retry' }, status)
      }
      await assert.rejects(
        () => fetchJsonWithRetry('https://api.example/v1/responses', {}, {}, undefined, 1000, { maxAttempts: 3, baseDelayMs: 0, maxResponseBytes: 1000 }),
        (error) => error?.code === 'LCX_HTTP_ERROR' && error?.status === status,
      )
      assert.equal(attempts, 1)
    }

    let attempts = 0
    globalThis.fetch = async () => {
      attempts += 1
      if (attempts === 1) return jsonResponse({ error: 'retry' }, 501)
      return jsonResponse({ ok: true })
    }
    assert.deepEqual(
      await fetchJsonWithRetry('https://api.example/v1/responses', {}, {}, undefined, 1000, { maxAttempts: 2, baseDelayMs: 0, maxResponseBytes: 1000 }),
      { ok: true },
    )
    assert.equal(attempts, 2)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('SSE transport does not retry HTTP 413', async () => {
  const previousFetch = globalThis.fetch
  let attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    return new Response('request too large', { status: 413 })
  }
  try {
    await assert.rejects(
      () => fetchSseWithRetry('https://api.example/v1/responses', {}, {}, undefined, 1000, {
        maxAttempts: 3,
        baseDelayMs: 0,
        maxResponseBytes: 1000,
        consume: async () => undefined,
      }),
      (error) => error?.code === 'LCX_HTTP_ERROR' && error?.status === 413,
    )
    assert.equal(attempts, 1)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('SSE transport normalizes body-read timeout after headers', async () => {
  const previousFetch = globalThis.fetch
  let streamCancelled = false
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) {
      return new Promise((resolve) => setTimeout(() => {
        if (!streamCancelled) controller.close()
        resolve()
      }, 100))
    },
    cancel() { streamCancelled = true },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  try {
    await assert.rejects(
      () => fetchSseWithRetry('https://api.example/v1/responses', {}, {}, undefined, 20, {
        maxAttempts: 1,
        consume: async (response) => {
          const reader = response.body.getReader()
          await reader.read()
        },
      }),
      { code: 'LCX_TIMEOUT' },
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('hosted provider sends Responses web_search and normalizes sources', async () => {
  const previous = process.env.LCX_API_KEY
  const previousFetch = globalThis.fetch
  process.env.LCX_API_KEY = 'test-only'
  let request
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), body: JSON.parse(init.body), init }
    return jsonResponse({
      id: 'hosted-response-1',
      status: 'completed',
      output: [
        { type: 'web_search_call', action: { sources: [{ url: 'https://example.com', title: 'Example', publishedAt: '2026-08-18' }] } },
        { type: 'message', content: [{ type: 'output_text', text: 'A short answer.' }] },
      ],
    })
  }
  try {
    const provider = new LcxResponsesSearchProvider({
      webSearchProvider: 'lcx-responses',
      baseURL: 'https://api.lcxbot.com/v1',
      model: 'gpt-5.6-sol',
      apiKeyEnv: 'LCX_API_KEY',
      timeoutMs: 1000,
      maxResponseBytes: 100000,
      maxAttempts: 1,
      webMaxResults: 8,
    })
    const result = await provider.search({ query: 'test', maxResults: 8 })
    assert.equal(request.url, 'https://api.lcxbot.com/v1/responses')
    assert.equal(request.body.stream, false)
    assert.equal(request.body.store, false)
    assert.deepEqual(request.body.tools, [{ type: 'web_search' }])
    assert.equal(request.body.tool_choice, 'required')
    assert.deepEqual(request.body.include, ['web_search_call.action.sources'])
    assert.deepEqual(request.body.input, [{ role: 'user', content: [{ type: 'input_text', text: 'test' }] }])
    assert.equal(result.content, '【Responses Hosted 搜索 · LCX】\nA short answer.')
    assert.deepEqual(result.sources, [{ url: 'https://example.com', title: 'Example', publishedAt: '2026-08-18' }])
    assert.equal(result.truncated, false)
  } finally {
    globalThis.fetch = previousFetch
    if (previous === undefined) delete process.env.LCX_API_KEY
    else process.env.LCX_API_KEY = previous
  }
})

test('hosted Web Search uses only declared sources and URL citation annotations', () => {
  const result = parseHostedSearchResponse({
    id: 'hosted-response-2',
    status: 'completed',
    metadata: { callback_url: 'https://should-not-be-a-source.example/' },
    output: [
      { type: 'web_search_call', action: { sources: [{ url: 'https://example.com/a?utm_source=test', title: 'Search result' }] } },
      {
        type: 'message',
        content: [{
          type: 'output_text',
          text: 'Answer with citation.',
          annotations: [
            { type: 'url_citation', url: 'https://example.com/a', title: 'Citation title' },
            { type: 'file_citation', url: 'https://should-not-be-a-source.example/file' },
          ],
        }],
      },
    ],
  }, 'fallback-id')
  assert.equal(result.sources.length, 1)
  assert.equal(result.citations.length, 1)
  assert.equal(result.mode, 'hosted')
  assert.equal(result.action, 'search')
  assert.equal(result.emulation, 'native')
  assert.equal(result.sources[0].url, 'https://example.com/a?utm_source=test')
  assert.equal(result.requestId, 'fallback-id')
  assert.equal(result.responseId, 'hosted-response-2')
})

test('hosted Web Search returns image results without treating image URLs as citations', () => {
  const result = parseHostedSearchResponse({
    id: 'hosted-image-response',
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: { type: 'search', sources: [{ url: 'https://example.com/source' }] },
        results: [{
          type: 'image_result',
          image_url: 'https://cdn.example/image.jpg',
          thumbnail_url: 'https://cdn.example/thumb.jpg',
          source_website_url: 'https://example.com/source',
          caption: 'Example image',
        }],
      },
    ],
  }, 'fallback-id')
  assert.equal(result.images.length, 1)
  assert.deepEqual(result.images[0], {
    imageUrl: 'https://cdn.example/image.jpg',
    thumbnailUrl: 'https://cdn.example/thumb.jpg',
    sourceWebsiteUrl: 'https://example.com/source',
    caption: 'Example image',
  })
  assert.deepEqual(result.citations, [])
})

test('hosted Web Search rejects model-only answers without a web search call', () => {
  assert.throws(
    () => parseHostedSearchResponse({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Model-only answer.' }] }],
    }, 'request-id'),
    { code: 'WEB_SEARCH_NOT_EXECUTED' },
  )
})

test('Alpha Web Search validates and maps every supported single action', () => {
  const cases = [
    [{ action: 'search_query', query: 'OpenAI news', domains: ['openai.com'], recency: 7 }, { search_query: [{ q: 'OpenAI news', domains: ['openai.com'], recency: 7 }] }],
    [{ action: 'image_query', query: 'Golden Gate Bridge' }, { image_query: [{ q: 'Golden Gate Bridge' }] }],
    [{ action: 'open', refId: 'turn0search0', lineNumber: 12 }, { open: [{ ref_id: 'turn0search0', lineno: 12 }] }],
    [{ action: 'find', refId: 'https://example.com', pattern: 'release' }, { find: [{ ref_id: 'https://example.com', pattern: 'release' }] }],
    [{ action: 'click', refId: 'turn0view0', linkId: 3 }, { click: [{ ref_id: 'turn0view0', id: 3 }] }],
    [{ action: 'screenshot', refId: 'turn0view0', pageNumber: 0 }, { screenshot: [{ ref_id: 'turn0view0', pageno: 0 }] }],
    [{ action: 'finance', ticker: 'AAPL', assetType: 'equity', market: 'USA' }, { finance: [{ ticker: 'AAPL', type: 'equity', market: 'USA' }] }],
    [{ action: 'weather', location: 'China, Shanghai', start: '2026-08-19', duration: 3 }, { weather: [{ location: 'China, Shanghai', start: '2026-08-19', duration: 3 }] }],
    [{ action: 'sports', fn: 'schedule', league: 'nba', team: 'LAL', numberOfGames: 5 }, { sports: [{ tool: 'sports', fn: 'schedule', league: 'nba', team: 'LAL', num_games: 5 }] }],
    [{ action: 'time', utcOffset: '+08:00' }, { time: [{ utc_offset: '+08:00' }] }],
  ]
  for (const [input, command] of cases) {
    const normalized = normalizeAlphaSearchArgs(input)
    const body = buildAlphaSearchBody(normalized, 'gpt-5.6-sol', 'session-alpha', true)
    assert.equal(body.id, 'session-alpha')
    assert.equal(body.model, 'gpt-5.6-sol')
    assert.deepEqual(body.commands, command)
    assert.deepEqual(body.settings, { allowed_callers: ['direct'], external_web_access: true })
    assert.equal(body.max_output_tokens, 2500)
    assert.ok(Array.isArray(body.input))
  }
  assert.throws(() => normalizeAlphaSearchArgs({}), { code: 'WEB_INVALID_REQUEST' })
  assert.throws(() => normalizeAlphaSearchArgs({ action: 'search_query', query: 'x', refId: 'unexpected' }), { code: 'WEB_INVALID_REQUEST' })
  assert.throws(() => normalizeAlphaSearchArgs({ action: 'finance', ticker: 'AAPL', assetType: 'bond' }), { code: 'WEB_INVALID_REQUEST' })
  assert.throws(() => normalizeAlphaSearchArgs({ action: 'time', utcOffset: '8' }), { code: 'WEB_INVALID_REQUEST' })
  assert.throws(() => normalizeAlphaSearchArgs({ action: 'screenshot', refId: 'turn0view0', pageNumber: -1 }), { code: 'WEB_INVALID_REQUEST' })
})

test('Alpha response preserves refs and direct HTTP sources but drops opaque output', () => {
  const result = parseAlphaSearchResponse({
    id: 'alpha-response-1',
    output: 'Example (https://example.com)\nL1: result',
    encrypted_output: 'must-not-leak',
    results: [
      { type: 'computer_initialize_state', id: 'turn0search0' },
      { type: 'search_result', ref_id: 'turn0search0', url: 'https://example.com', title: 'Example' },
      { type: 'search_result', ref_id: 'bad', url: 'file:///secret', title: 'Invalid' },
    ],
  }, { action: 'search_query', capability: 'command-capable', requestId: 'fallback-id', retrievedAt: '2026-08-19T00:00:00.000Z' })
  assert.equal(result.mode, 'alpha')
  assert.equal(result.emulation, 'unknown')
  assert.equal(result.requestId, 'fallback-id')
  assert.equal(result.responseId, 'alpha-response-1')
  assert.deepEqual(result.refs, ['turn0search0', 'bad'])
  assert.deepEqual(result.sources, [{ url: 'https://example.com/', title: 'Example', refId: 'turn0search0' }])
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false)
})

test('Alpha response accepts omitted results and extracts command refs from output citations', () => {
  const result = parseAlphaSearchResponse({
    output: 'Example (https://example.com)\nL1: result citeturn0search0',
  }, { action: 'search_query', capability: 'command-capable', requestId: 'fallback-id' })
  assert.deepEqual(result.results, [])
  assert.deepEqual(result.refs, ['turn0search0'])
  assert.equal(result.sources[0].url, 'https://example.com')
})

test('Alpha response preserves protocol link ids and identifies PDF view refs', () => {
  const html = parseAlphaSearchResponse({
    output: [
      'citeturn1view0 [wordlim: 200] Crawled: today; Content type: text/html; Total lines: 20',
      'L1: See cite7†API reference†platform.openai.com and cite7†API reference.',
    ].join('\n'),
  }, { action: 'open', capability: 'native', requestId: 'html-request' })
  assert.deepEqual(html.refs, ['turn1view0'])
  assert.deepEqual(html.links, [{ id: 7, label: 'API reference', domain: 'platform.openai.com' }])
  assert.deepEqual(html.pdfRefs, [])

  const pdf = parseAlphaSearchResponse({
    output: [
      'citeturn2view0 [wordlim: 200] Crawled: today; Content type: application/pdf; Number of pages: 15; Total lines: 802',
      'L1@P0: Attention Is All You Need',
    ].join('\n'),
  }, { action: 'open', capability: 'native', requestId: 'pdf-request' })
  assert.deepEqual(pdf.refs, ['turn2view0'])
  assert.deepEqual(pdf.links, [])
  assert.deepEqual(pdf.pdfRefs, ['turn2view0'])
})

test('Alpha response rejects HTTP 200 protocol-level action errors', () => {
  assert.throws(
    () => parseAlphaSearchResponse({
      output: "Error parsing function call: Invalid function_name='run' call: kwargs={'sports': [{'fn': 'schedule', 'league': 'nba'}]}",
    }, { action: 'sports', capability: 'native', requestId: 'sports-error' }),
    { code: 'LCX_ALPHA_ACTION_FAILED' },
  )
})

test('Alpha capability probe distinguishes command chains from emulated search-only responses', async () => {
  const calls = []
  const commandCapable = await probeAlphaCapabilities({
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    invoke: async (args) => {
      calls.push(args.action)
      if (args.action === 'search_query') return { refs: ['turn0search0'] }
      if (args.action === 'open') return { refs: ['turn0view0'] }
      if (args.action === 'find') return { refs: ['turn0find0'] }
      throw new Error('unexpected action')
    },
  })
  assert.equal(commandCapable.classification, 'command-capable')
  assert.equal(commandCapable.actions.search_query, 'supported')
  assert.equal(commandCapable.actions.open, 'supported')
  assert.equal(commandCapable.actions.find, 'supported')
  assert.deepEqual(calls, ['search_query', 'open', 'find'])

  const emulated = await probeAlphaCapabilities({
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    invoke: async () => ({ refs: [] }),
  })
  assert.equal(emulated.classification, 'emulated-search-only')
  assert.equal(emulated.actions.search_query, 'supported')
  assert.equal(emulated.actions.open, 'unsupported')

  const native = await probeAlphaCapabilities({
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    trustedNativeProvenance: true,
    invoke: async (args) => ({ refs: [args.action === 'search_query' ? 'turn0search0' : 'turn0view0'] }),
  })
  assert.equal(native.classification, 'native')

  const transient = await probeAlphaCapabilities({
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    invoke: async () => {
      const error = new Error('temporary upstream failure')
      error.status = 503
      throw error
    },
  })
  assert.equal(transient.classification, 'unknown')
  assert.equal(transient.actions.search_query, 'unknown')

  const unsupported = await probeAlphaCapabilities({
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    invoke: async () => {
      const error = new Error('channel does not support /v1/alpha/search')
      error.status = 500
      throw error
    },
  })
  assert.equal(unsupported.classification, 'unsupported')
  assert.equal(unsupported.actions.search_query, 'unsupported')
})

test('Alpha capability probe derives click and screenshot inputs from prior open responses', async () => {
  const calls = []
  const result = await probeAlphaCapabilities({
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    trustedNativeProvenance: true,
    clickProbeRef: 'https://en.wikipedia.org/wiki/OpenAI',
    screenshotProbeRef: 'https://arxiv.org/pdf/1706.03762',
    invoke: async (args) => {
      calls.push(args)
      if (args.action === 'search_query') return { refs: ['turn0search0'] }
      if (args.action === 'open' && args.refId === 'turn0search0') return { refs: ['turn1view0'], links: [] }
      if (args.action === 'find') return { refs: ['turn2find0'] }
      if (args.action === 'open' && args.refId.includes('wikipedia.org')) return { refs: ['turn3view0'], links: [{ id: 7, label: 'API reference' }] }
      if (args.action === 'click') return { refs: ['turn4view0'] }
      if (args.action === 'open' && args.refId.includes('arxiv.org')) return { refs: ['turn5view0'], pdfRefs: ['turn5view0'] }
      if (args.action === 'screenshot') return { refs: ['turn6view0'] }
      throw new Error(`unexpected action: ${args.action}`)
    },
  })
  assert.equal(result.classification, 'native')
  assert.equal(result.actions.click, 'supported')
  assert.equal(result.actions.screenshot, 'supported')
  assert.deepEqual(calls.find((call) => call.action === 'click'), {
    action: 'click',
    refId: 'turn3view0',
    linkId: 7,
    responseLength: 'short',
  })
  assert.deepEqual(calls.find((call) => call.action === 'screenshot'), {
    action: 'screenshot',
    refId: 'turn5view0',
    pageNumber: 0,
    responseLength: 'short',
  })
})

test('Alpha capability probe does not mark a semantic action error as supported', async () => {
  const result = await probeAlphaCapabilities({
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    trustedNativeProvenance: true,
    actionProbes: { sports: { fn: 'schedule', league: 'nba', numberOfGames: 1 } },
    invoke: async (args) => {
      if (args.action === 'search_query') return { refs: ['turn0search0'] }
      if (args.action === 'open') return { refs: ['turn0view0'] }
      if (args.action === 'find') return { refs: ['turn0find0'] }
      if (args.action === 'sports') {
        return parseAlphaSearchResponse({
          output: "Error parsing function call: Invalid function_name='run' call: kwargs={'sports': [{'fn': 'schedule', 'league': 'nba'}]}",
        }, { action: 'sports', capability: 'native', requestId: 'sports-error' })
      }
      throw new Error(`unexpected action: ${args.action}`)
    },
  })
  assert.equal(result.classification, 'native')
  assert.equal(result.actions.search_query, 'supported')
  assert.equal(result.actions.sports, 'unknown')
})

test('Alpha capability and ref stores are fingerprint- and session-scoped and fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-alpha-'))
  try {
    const fingerprint = alphaCapabilityFingerprint({
      baseURL: 'https://api.lcxbot.com/v1',
      provider: 'lcx',
      model: 'gpt-5.6-sol',
      profile: 'default',
      group: 'codex',
      schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    })
    const capabilityPath = join(dir, 'capabilities.json')
    const capabilityStore = new AlphaCapabilityStore(capabilityPath)
    const secondCapabilityStore = new AlphaCapabilityStore(capabilityPath)
    capabilityStore.put(fingerprint, {
      classification: 'command-capable',
      actions: { search_query: 'supported', open: 'supported' },
      probedAt: '2026-08-19T00:00:00.000Z',
      schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    })
    assert.equal(capabilityStore.get(fingerprint).classification, 'command-capable')
    assert.doesNotThrow(() => execFileSync(process.execPath, ['-e', "require('node:fs').readFileSync(process.argv[1])", capabilityPath], { windowsHide: true }))
    assert.equal(capabilityStore.get('different'), undefined)
    const secondFingerprint = alphaCapabilityFingerprint({
      baseURL: 'https://api.lcxbot.com/V1',
      provider: 'lcx',
      model: 'gpt-5.6-sol',
      profile: 'default',
      group: 'codex',
      schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    })
    assert.notEqual(secondFingerprint, fingerprint)
    assert.equal(alphaCapabilityFingerprint({
      baseURL: 'https://API.LCXBOT.COM/v1/',
      provider: 'lcx',
      model: 'gpt-5.6-sol',
      profile: 'default',
      group: 'codex',
      schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    }), fingerprint)
    secondCapabilityStore.put(secondFingerprint, {
      classification: 'unsupported',
      actions: { search_query: 'unsupported' },
      probedAt: '2026-08-20T00:00:00.000Z',
      schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    })
    assert.equal(capabilityStore.get(fingerprint).classification, 'command-capable')
    assert.equal(capabilityStore.get(secondFingerprint).classification, 'unsupported')
    assert.throws(() => capabilityStore.put('f'.repeat(64), {
      classification: 'native',
      actions: { search_query: 'supported' },
      probedAt: '2026-08-20T00:00:00.000Z',
      schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
      provenance: 'unavailable',
    }), { code: 'LCX_ALPHA_CAPABILITY_INVALID' })

    const refPath = join(dir, 'refs.json')
    const refStore = new AlphaRefStore(refPath)
    const secondRefStore = new AlphaRefStore(refPath)
    refStore.record('session-a', fingerprint, [{ refId: 'turn0search0', url: 'https://example.com' }])
    secondRefStore.record('session-b', fingerprint, [{ refId: 'turn1search0', url: 'https://example.org' }])
    assert.deepEqual(refStore.assertUsable('session-a', fingerprint, 'turn0search0'), { refId: 'turn0search0', url: 'https://example.com' })
    assert.deepEqual(refStore.assertUsable('session-b', fingerprint, 'turn1search0'), { refId: 'turn1search0', url: 'https://example.org' })
    assert.throws(() => refStore.assertUsable('session-b', fingerprint, 'turn0search0'), { code: 'LCX_ALPHA_REF_UNAVAILABLE' })
    assert.throws(() => refStore.assertUsable('session-a', 'different', 'turn0search0'), { code: 'LCX_ALPHA_REF_UNAVAILABLE' })

    writeFileSync(join(dir, 'refs.json'), '{not-json')
    assert.throws(() => new AlphaRefStore(join(dir, 'refs.json')), { code: 'LCX_ALPHA_REF_STORE_CORRUPT' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('corrupt optional Alpha stores disable Alpha without breaking hosted search', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-alpha-corrupt-'))
  const capabilityPath = join(dir, 'capabilities.json')
  writeFileSync(capabilityPath, '{not-json')
  const tools = []
  const diagnostics = []
  const settingsValue = { enabled: true, webSearch: true, alphaSearch: true, remoteCompaction: false }
  const harness = testContext(settingsValue, (tool) => tools.push(tool.name), { error(message) { diagnostics.push(String(message)) } })
  try {
    assert.doesNotThrow(() => apply(harness.ctx, {
      checkpointPath: join(dir, 'checkpoints.json'),
      alphaCapabilityPath: capabilityPath,
      alphaRefPath: join(dir, 'refs.json'),
    }))
    assert.deepEqual(tools, ['websearch_gpt'])
    assert.equal(diagnostics.some((message) => message.includes('LCX_ALPHA_CAPABILITY_STORE_CORRUPT')), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('hosted Web Search rejects missing or non-completed response status', () => {
  assert.throws(
    () => parseHostedSearchResponse({ output: [] }, 'request-id'),
    { code: 'WEB_RESPONSE_INCOMPLETE' },
  )
  assert.throws(
    () => parseHostedSearchResponse({ status: 'incomplete', output: [] }, 'request-id'),
    { code: 'WEB_RESPONSE_INCOMPLETE' },
  )
})

test('hosted provider reports upstream errors explicitly', async () => {
  const previousKey = process.env.LCX_API_KEY
  const previousFetch = globalThis.fetch
  process.env.LCX_API_KEY = 'test-only'
  globalThis.fetch = async () => jsonResponse({ error: 'hosted web search failed' }, 500)
  try {
    const provider = new LcxResponsesSearchProvider({
      webSearchProvider: 'lcx-responses',
      baseURL: 'https://api.lcxbot.com/v1',
      model: 'gpt-5.6-sol',
      apiKeyEnv: 'LCX_API_KEY',
      timeoutMs: 1000,
      maxResponseBytes: 100000,
      maxAttempts: 1,
      webMaxResults: 8,
    })
    await assert.rejects(() => provider.search({ query: 'test' }), { code: 'LCX_WEB_PROVIDER_ERROR' })
  } finally {
    globalThis.fetch = previousFetch
    if (previousKey === undefined) delete process.env.LCX_API_KEY
    else process.env.LCX_API_KEY = previousKey
  }
})

test('websearch_gpt uses the hosted query contract', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  let registeredTool
  let requestsClientId
  const settingsValue = { enabled: true, webSearch: true, remoteCompaction: false, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue, (tool) => { registeredTool = tool })
  globalThis.fetch = async (url, init) => {
    requestsClientId = init.headers['x-client-request-id']
    const body = JSON.parse(init.body)
    assert.equal(String(url), 'https://api.lcxbot.com/v1/responses')
    assert.deepEqual(body.tools, [{ type: 'web_search' }])
    assert.equal(body.stream, false)
    assert.equal(body.tool_choice, 'required')
    assert.equal(body.input[0].content[0].text, '中天科技最新公告')
    return jsonResponse({
      id: 'search-response-1',
      status: 'completed',
      output: [
        { type: 'web_search_call', action: { sources: [{ url: 'https://example.com/notice', title: '公告', publishedAt: '2026-08-17' }] } },
        { type: 'message', content: [{ type: 'output_text', text: '搜索摘要。' }] },
      ],
    })
  }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    assert.match(registeredTool.description, /一次性/u)
    assert.match(registeredTool.description, /不提供.*open.*find.*click.*screenshot/u)
    assert.doesNotMatch(registeredTool.description, /默认|优先/u)
    const result = await registeredTool.execute({ query: '中天科技最新公告' }, { signal: undefined })
    assert.equal(result.content, '搜索摘要。')
    assert.equal(result.sources[0].url, 'https://example.com/notice')
    assert.equal(result.requestId, requestsClientId)
    assert.equal(result.responseId, 'search-response-1')
    assert.equal(result.mode, 'hosted')
    assert.equal(result.action, 'search')
    assert.match(registeredTool.output.render({}, result)[0].text, /公告/)
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('websearch_gpt reuses the active DSH Responses provider route and credential', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-dsh-route-'))
  const previousFetch = globalThis.fetch
  let registeredTool
  let resolvedCredential
  const settingsValue = {
    enabled: true,
    webSearch: true,
    remoteCompaction: false,
    fallbackToBasicCompaction: true,
    provider: 'relay',
    baseURL: 'https://stale-plugin-config.example/v1',
    apiKeyEnv: 'STALE_PLUGIN_KEY',
    model: 'gpt-fallback',
  }
  const harness = testContext(settingsValue, (tool) => { registeredTool = tool })
  const settings = {
    register: () => ({ get: () => settingsValue, watch: () => () => {} }),
    get(namespace) {
      return namespace === 'llm-pi-ai'
        ? { providers: { relay: { api: 'openai-responses', baseURL: 'https://relay.example/v1', apiKeyEnv: 'RELAY_API_KEY' } } }
        : undefined
    },
  }
  harness.ctx.get = (name) => {
    if (name === 'settings') return settings
    if (name === 'credentials') {
      return {
        resolve: async (ref) => {
          resolvedCredential = ref
          return { value: 'dsh-stored-key', source: 'test' }
        },
      }
    }
    return name === 'tools' ? harness.ctx.tools : undefined
  }
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    assert.equal(String(url), 'https://relay.example/v1/responses')
    assert.equal(body.model, 'gpt-5.6-sol')
    assert.equal(init.headers.authorization, 'Bearer dsh-stored-key')
    return jsonResponse({
      id: 'search-response-dsh-route',
      status: 'completed',
      output: [
        { type: 'web_search_call', action: { sources: [{ url: 'https://example.com', title: 'Example' }] } },
        { type: 'message', content: [{ type: 'output_text', text: 'DSH route.' }] },
      ],
    })
  }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const exec = {
      signal: undefined,
      agent: {
        id: 'session-hosted-route',
        session: { requestContext: () => ({ provider: 'relay', model: 'gpt-5.6-sol' }) },
      },
    }
    const result = await registeredTool.execute({ query: 'DSH route' }, exec)
    assert.equal(result.content, 'DSH route.')
    assert.equal(resolvedCredential, 'RELAY_API_KEY')
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('websearch_gpt is disabled until explicitly enabled', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const registeredTools = []
  const settingsValue = { enabled: false, webSearch: false, remoteCompaction: false, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue, (tool) => { registeredTools.push(tool) })
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json') })
    assert.deepEqual(registeredTools, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('websearch_alpha registers only for a matching usable capability and keeps refs in-session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-alpha-integration-'))
  const previousFetch = globalThis.fetch
  const capabilityPath = join(dir, 'capabilities.json')
  const refPath = join(dir, 'refs.json')
  const config = {
    checkpointPath: join(dir, 'checkpoints.json'),
    alphaCapabilityPath: capabilityPath,
    alphaRefPath: refPath,
    maxAttempts: 1,
  }
  const fingerprint = alphaCapabilityFingerprint({
    baseURL: 'https://api.lcxbot.com/v1',
    provider: 'lcx',
    model: 'gpt-5.6-sol',
    profile: '',
    group: '',
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
  })
  new AlphaCapabilityStore(capabilityPath).put(fingerprint, {
    classification: 'command-capable',
    actions: { search_query: 'supported', open: 'supported' },
    probedAt: '2026-08-20T00:00:00.000Z',
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    provenance: 'unavailable',
  })
  const lunaFingerprint = alphaCapabilityFingerprint({
    baseURL: 'https://api.lcxbot.com/v1',
    provider: 'lcx',
    model: 'gpt-5.6-luna',
    profile: '',
    group: '',
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
  })
  new AlphaCapabilityStore(capabilityPath).put(lunaFingerprint, {
    classification: 'command-capable',
    actions: { search_query: 'supported', open: 'supported' },
    probedAt: '2026-08-20T00:00:00.000Z',
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    provenance: 'unavailable',
  })
  const tools = new Map()
  const settingsValue = { enabled: true, webSearch: false, alphaSearch: true, remoteCompaction: false, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue, (tool) => { tools.set(tool.name, tool) })
  const requests = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    requests.push({ url: String(url), body, clientRequestId: init.headers['x-client-request-id'] })
    if (body.commands.search_query) {
      return jsonResponse({
        id: 'alpha-search-response',
        output: 'Example result',
        results: [{ type: 'search_result', ref_id: 'turn0search0', url: 'https://example.com', title: 'Example' }],
      })
    }
    return jsonResponse({ id: 'alpha-open-response', output: 'Opened page', results: [{ type: 'open_result', ref_id: 'turn0view0', url: 'https://example.com' }] })
  }
  try {
    apply(harness.ctx, config)
    assert.equal(tools.has('websearch_gpt'), false)
    assert.equal(tools.has('websearch_alpha'), true)
    assert.equal([...tools.keys()].some((toolName) => /compact/iu.test(toolName)), false)
    const tool = tools.get('websearch_alpha')
    assert.match(tool.description, /有状态/u)
    assert.match(tool.description, /当前会话.*ref_id/u)
    assert.match(tool.description, /一次只执行一个/u)
    assert.doesNotMatch(tool.description, /默认|优先/u)
    const exec = {
      signal: undefined,
      agent: {
        id: 'session-alpha',
        options: { provider: 'lcx', model: 'gpt-5.6-luna' },
        session: { requestContext: () => ({ provider: 'lcx', model: 'gpt-5.6-sol' }) },
      },
    }
    const search = await tool.execute({ action: 'search_query', query: 'Example' }, exec)
    assert.equal(search.capability, 'command-capable')
    assert.equal(search.emulation, 'unknown')
    assert.equal(search.requestId, requests[0].clientRequestId)
    assert.equal(search.responseId, 'alpha-search-response')
    assert.equal(requests[0].url, 'https://api.lcxbot.com/v1/alpha/search')
    assert.equal(requests[0].body.id, 'session-alpha')
    const opened = await tool.execute({ action: 'open', refId: 'turn0search0' }, exec)
    assert.equal(opened.action, 'open')
    assert.equal(requests.length, 2)
    const lunaExec = {
      ...exec,
      agent: {
        ...exec.agent,
        session: { requestContext: () => ({ provider: 'lcx', model: 'gpt-5.6-luna' }) },
      },
    }
    await tool.execute({ action: 'search_query', query: 'Luna route' }, lunaExec)
    assert.equal(requests.length, 3)
    assert.equal(requests[2].body.model, 'gpt-5.6-luna')
    await assert.rejects(
      () => tool.execute({ action: 'open', refId: 'turn0view0' }, lunaExec),
      { code: 'LCX_ALPHA_REF_UNAVAILABLE' },
    )
    assert.equal(requests.length, 3)
    await assert.rejects(
      () => tool.execute({ action: 'open', refId: 'turn0search0' }, { signal: undefined, agent: { id: 'session-other' } }),
      { code: 'LCX_ALPHA_REF_UNAVAILABLE' },
    )
    assert.equal(requests.length, 3)
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('websearch_alpha fingerprints and requests through the DSH Responses provider route', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-alpha-dsh-route-'))
  const previousFetch = globalThis.fetch
  const capabilityPath = join(dir, 'capabilities.json')
  const refPath = join(dir, 'refs.json')
  const providerProfile = {
    api: 'openai-responses',
    baseURL: 'https://relay.example/v1',
    apiKeyEnv: 'RELAY_API_KEY',
  }
  const fingerprint = alphaCapabilityFingerprint({
    baseURL: providerProfile.baseURL,
    provider: 'relay',
    model: 'gpt-5.6-sol',
    profile: '',
    group: '',
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
  })
  new AlphaCapabilityStore(capabilityPath).put(fingerprint, {
    classification: 'command-capable',
    actions: { search_query: 'supported' },
    probedAt: '2026-08-20T00:00:00.000Z',
    schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    provenance: 'unavailable',
  })
  const tools = new Map()
  const settingsValue = {
    enabled: true,
    webSearch: false,
    alphaSearch: true,
    remoteCompaction: false,
    fallbackToBasicCompaction: true,
    provider: 'relay',
    baseURL: 'https://stale-plugin-config.example/v1',
    apiKeyEnv: 'STALE_PLUGIN_KEY',
    model: 'gpt-5.6-sol',
  }
  const harness = testContext(settingsValue, (tool) => { tools.set(tool.name, tool) })
  const settings = {
    register: () => ({ get: () => settingsValue, watch: () => () => {} }),
    get(namespace) {
      return namespace === 'llm-pi-ai' ? { providers: { relay: providerProfile } } : undefined
    },
  }
  let resolvedCredential
  harness.ctx.get = (name) => {
    if (name === 'settings') return settings
    if (name === 'credentials') {
      return {
        resolve: async (ref) => {
          resolvedCredential = ref
          return { value: 'dsh-stored-key', source: 'test' }
        },
      }
    }
    return name === 'tools' ? harness.ctx.tools : undefined
  }
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://relay.example/v1/alpha/search')
    assert.equal(init.headers.authorization, 'Bearer dsh-stored-key')
    return jsonResponse({
      id: 'alpha-dsh-route',
      output: 'Relay result',
      results: [{ type: 'search_result', ref_id: 'turn0search0', url: 'https://example.com', title: 'Example' }],
    })
  }
  try {
    apply(harness.ctx, {
      checkpointPath: join(dir, 'checkpoints.json'),
      alphaCapabilityPath: capabilityPath,
      alphaRefPath: refPath,
      maxAttempts: 1,
    })
    const tool = tools.get('websearch_alpha')
    assert.ok(tool)
    const result = await tool.execute({ action: 'search_query', query: 'Example' }, {
      signal: undefined,
      agent: {
        id: 'session-alpha-dsh-route',
        session: { requestContext: () => ({ provider: 'relay', model: 'gpt-5.6-sol' }) },
      },
    })
    assert.equal(result.content, 'Relay result')
    assert.equal(resolvedCredential, 'RELAY_API_KEY')
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('websearch_alpha stays unregistered when capability is unknown or emulated search-only', () => {
  for (const classification of ['unknown', 'emulated-search-only']) {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-alpha-disabled-'))
    const capabilityPath = join(dir, 'capabilities.json')
    const fingerprint = alphaCapabilityFingerprint({
      baseURL: 'https://api.lcxbot.com/v1',
      provider: 'lcx',
      model: 'gpt-5.6-sol',
      profile: '',
      group: '',
      schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
    })
    new AlphaCapabilityStore(capabilityPath).put(fingerprint, {
      classification,
      actions: { search_query: classification === 'emulated-search-only' ? 'supported' : 'unknown' },
      probedAt: '2026-08-20T00:00:00.000Z',
      schemaFingerprint: ALPHA_SCHEMA_FINGERPRINT,
      provenance: 'unavailable',
    })
    const tools = []
    const harness = testContext({ enabled: true, webSearch: false, alphaSearch: true, remoteCompaction: false }, (tool) => tools.push(tool.name))
    try {
      apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), alphaCapabilityPath: capabilityPath, alphaRefPath: join(dir, 'refs.json') })
      assert.equal(tools.includes('websearch_alpha'), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

test('same-route v3 replay sends complete native output through direct SSE with attribution', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  let listener
  const checkpointId = '21234567-89ab-cdef-0123-456789abcdef'
  const marker = `[dsh-lcx-codex-v3-checkpoint:${checkpointId}]`
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: false, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  harness.ctx.attachments = {
    readImage: async () => ({ ref: { mediaType: 'image/png' }, data: Uint8Array.from([1, 2, 3]) }),
  }
  const calls = []
  const tools = [{ name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }]
  const system = 'system instructions'
  const replayEvents = [
    { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'reasoning-1', content: [{ type: 'reasoning_text', text: 'private replay thought' }] } },
    { type: 'response.output_item.added', output_index: 1, item: { type: 'message', id: 'message-1', role: 'assistant', content: [] } },
    { type: 'response.output_text.delta', output_index: 1, item_id: 'message-1', delta: 'Hel' },
    { type: 'response.output_text.delta', output_index: 1, item_id: 'message-1', delta: 'lo' },
    { type: 'response.output_text.done', output_index: 1, item_id: 'message-1', text: 'Hello' },
    { type: 'response.output_item.done', output_index: 1, item: { type: 'message', id: 'message-1', role: 'assistant', content: [{ type: 'output_text', text: 'Hello' }] } },
    { type: 'response.completed', response: { output: [
      { type: 'reasoning', id: 'reasoning-1', content: [{ type: 'reasoning_text', text: 'private replay thought' }] },
      { type: 'message', content: [{ type: 'output_text', text: 'Hello' }] },
    ], usage: { input_tokens: 11, output_tokens: 7, input_tokens_details: { cached_tokens: 3 } } } },
  ]
  const nativeRecord = portableRecord({
    checkpointId,
    record: {
      nativeOutput: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'native context' }] },
        { type: 'reasoning', id: 'reasoning-1', summary: [{ type: 'summary_text', text: 'native-only reasoning' }] },
        { type: 'compaction', id: 'cmp-v3', encrypted_content: 'opaque-v3' },
      ],
    },
  })
  new CheckpointV3Store(join(dir, 'checkpoints-v3.json')).put(checkpointId, nativeRecord)
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers })
    return replaySseResponse({ events: replayEvents })
  }
  harness.ctx.llm = { stream() { throw new Error('same-route replay must not use ctx.llm.stream') } }
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const chunks = []
    for await (const chunk of listener({
      provider: 'lcx', model: 'gpt-5.6-sol', sessionId: 'session-1', tools, system,
      messages: [message('user', marker), { role: 'user', content: [
        { type: 'text', text: 'continue' },
        { type: 'image', attachment: { attachmentId: 'sha256:test', mediaType: 'image/png' } },
      ] }],
    }, () => { throw new Error('replay should be intercepted') })) chunks.push(chunk)

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.lcxbot.com/v1/responses')
    assert.equal(calls[0].body.stream, true)
    assert.equal(calls[0].body.store, false)
    assert.deepEqual(calls[0].body.tools, [{ type: 'function', ...tools[0], strict: false }])
    assert.match(String(calls[0].headers['x-codex-beta-features']), /remote_compaction_v2/u)
    assert.equal(calls[0].body.instructions, system)
    assert.equal(calls[0].body.prompt_cache_key, routeFingerprint(route()))
    assert.deepEqual(calls[0].body.input, [
      ...nativeRecord.nativeOutput,
      { type: 'message', role: 'user', content: [
        { type: 'input_text', text: 'continue' },
        { type: 'input_image', image_url: 'data:image/png;base64,AQID' },
      ] },
    ])
    assert.deepEqual(calls[0].body.input.find((item) => item.type === 'reasoning'), nativeRecord.nativeOutput[1])
    assert.match(String(calls[0].headers['user-agent']), /^deepseek-harness\//u)
    assert.deepEqual(chunks.map((chunk) => chunk.type), [
      'block-start', 'reasoning-delta', 'block-end',
      'block-start', 'text-delta', 'text-delta', 'block-end', 'usage', 'finish',
    ])
    assert.deepEqual(chunks.filter((chunk) => chunk.type === 'reasoning-delta').map((chunk) => chunk.text), ['private replay thought'])
    assert.deepEqual(chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text), ['Hel', 'lo'])
    assert.deepEqual(chunks.at(-2).usage, { inputTokens: 8, outputTokens: 7, cacheReadTokens: 3 })
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('same-route replay preserves call_id and materializes completion-only output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  let listener
  const checkpointId = '41234567-89ab-cdef-0123-456789abcdef'
  const marker = `[dsh-lcx-codex-v3-checkpoint:${checkpointId}]`
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: false, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  new CheckpointV3Store(join(dir, 'checkpoints-v3.json')).put(checkpointId, portableRecord({ checkpointId }))
  const events = [
    { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'read', arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'item-1', delta: '{"path":' },
    { type: 'response.function_call_arguments.done', output_index: 0, item_id: 'item-1', arguments: '{"path":"README.md"}' },
    { type: 'response.completed', response: { output: [
      { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'read', arguments: '{"path":"README.md"}' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] },
    ], usage: { input_tokens: 1, output_tokens: 1 } } },
  ]
  globalThis.fetch = async () => replaySseResponse({ events })
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const chunks = []
    for await (const chunk of listener({ provider: 'lcx', model: 'gpt-5.6-sol', sessionId: 'session-1', messages: [message('user', marker)] }, () => { throw new Error('replay should be intercepted') })) chunks.push(chunk)
    const toolDelta = chunks.find((chunk) => chunk.type === 'tool-call-delta')
    assert.equal(toolDelta.id, 'call-1')
    assert.equal(chunks.some((chunk) => chunk.type === 'text-delta' && chunk.text === 'done'), true)
    assert.equal(chunks.at(-1).reason.kind, 'tool-calls')
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('same-route replay does not duplicate an item closed before response.completed', async () => {
  const previousFetch = globalThis.fetch
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: false, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  let listener
  harness.ctx.on = (_event, handler) => { listener = handler }
  globalThis.fetch = async () => replaySseResponse({ text: 'once' })
  try {
    const store = new CheckpointV3Store(join(dir, 'checkpoints-v3.json'))
    const compaction = { type: 'compaction', id: 'cmp-replay', encrypted_content: 'opaque' }
    const record = portableRecord({ record: {
      nativeOutput: [compaction],
      nativeCompaction: compaction,
      portableHistory: [],
    } })
    store.put(record.checkpointId, record)
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const marker = `[dsh-lcx-codex-v3-checkpoint:${record.checkpointId}]`
    const chunks = []
    for await (const chunk of listener({ provider: 'lcx', model: 'gpt-5.6-sol', sessionId: 'session-1', messages: [message('user', marker), message('user', 'continue')] }, () => { throw new Error('replay should be intercepted') })) chunks.push(chunk)
    const blocks = chunks.filter((chunk) => chunk.type === 'block-end' && chunk.block?.type === 'text')
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].block.text, 'once')
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('replay suppresses duplicate completed text when gateway changes output index', async () => {
  const previousFetch = globalThis.fetch
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: false, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  let listener
  harness.ctx.on = (_event, handler) => { listener = handler }
  const record = portableRecord({ record: { nativeOutput: [{ type: 'compaction', encrypted_content: 'opaque' }], nativeCompaction: { type: 'compaction', encrypted_content: 'opaque' }, portableHistory: [] } })
  const events = [
    { type: 'response.output_item.added', output_index: 1, item: { type: 'message', id: 'stream-message', role: 'assistant', content: [] } },
    { type: 'response.output_text.delta', output_index: 1, item_id: 'stream-message', delta: 'same' },
    { type: 'response.output_text.done', output_index: 1, item_id: 'stream-message', text: 'same' },
    { type: 'response.completed', response: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'same' }] }] } },
  ]
  globalThis.fetch = async () => replaySseResponse({ events })
  try {
    new CheckpointV3Store(join(dir, 'checkpoints-v3.json')).put(record.checkpointId, record)
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const marker = `[dsh-lcx-codex-v3-checkpoint:${record.checkpointId}]`
    const chunks = []
    for await (const chunk of listener({ provider: 'lcx', model: 'gpt-5.6-sol', sessionId: 'session-1', messages: [message('user', marker), message('user', 'continue')] }, () => { throw new Error('replay should be intercepted') })) chunks.push(chunk)
    assert.equal(chunks.filter((chunk) => chunk.type === 'block-start').length, 1)
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('same-route v3 replay returns direct SSE stream errors without fallback', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  const checkpointId = '31234567-89ab-cdef-0123-456789abcdef'
  const marker = `[dsh-lcx-codex-v3-checkpoint:${checkpointId}]`
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  new CheckpointV3Store(join(dir, 'checkpoints-v3.json')).put(checkpointId, portableRecord({ checkpointId }))
  globalThis.fetch = async () => replaySseResponse({ events: [{ type: 'response.failed', error: { message: 'replay failed' } }] })
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const chunks = []
    for await (const chunk of harness.listener({
      provider: 'lcx', model: 'gpt-5.6-sol', sessionId: 'session-1',
      messages: [message('user', marker), message('user', 'continue')],
    }, () => { throw new Error('replay should be intercepted') })) chunks.push(chunk)
    assert.equal(chunks.at(-1).reason.kind, 'error')
    assert.equal(chunks.at(-1).reason.failure.code, 'LCX_RESPONSES_UPSTREAM_ERROR')
    assert.equal(chunks.at(-1).reason.failure.message, 'replay failed')
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('apply uses native V2 Responses compaction, stores full output, and replays the tail', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  let listener
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  const attachment = {
    attachmentId: `sha256:${'c'.repeat(64)}`,
    mediaType: 'image/png',
    bytes: 3,
    width: 1,
    height: 1,
    name: 'compact.png',
  }
  harness.ctx.attachments = {
    readImage: async (ref) => {
      assert.deepEqual(ref, attachment)
      return { ref: attachment, data: Uint8Array.from([1, 2, 3]) }
    },
  }
  const calls = []
  const llmCalls = []
  const nativeChunks = [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'resumed' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'resumed' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  harness.ctx.llm = {
    stream() {
      llmCalls.push(true)
      throw new Error('same-route replay must not use ctx.llm.stream')
    },
  }
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers })
    return calls.length === 1
      ? compactSseResponse({ output: [
        { type: 'message', role: 'user', content: [
          { type: 'input_text', text: 'old context' },
          { type: 'input_image', image_url: 'data:image/png;base64,AQID' },
        ] },
        { type: 'compaction', id: 'cmp-native', encrypted_content: 'opaque-native' },
      ] })
      : replaySseResponse({ usage: { input_tokens: 0, output_tokens: 0 } })
  }
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const compactChunks = []
    for await (const chunk of listener({
      provider: 'lcx', model: 'gpt-5.6-sol', purpose: 'compaction', sessionId: 'session-1',
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'old context' },
        { type: 'image', attachment },
      ] }, message('user', 'You are now acting as a compaction engine. Output the checkpoint.')],
    }, () => { throw new Error('compaction should be intercepted') })) compactChunks.push(chunk)
    const marker = compactChunks.find((chunk) => chunk.type === 'text-delta').text
    assert.match(marker, /LCX 压缩完成/u)
    assert.match(marker, /\[dsh-lcx-codex-v3-checkpoint:[0-9a-f-]{36}\]/iu)
    const savedV3 = new CheckpointV3Store(join(dir, 'checkpoints-v3.json'))
    assert.equal(savedV3.data.version, 3)
    const savedRecord = savedV3.get(marker.match(/\[dsh-lcx-codex-v3-checkpoint:([0-9a-f-]{36})\]/iu)[1])
    assert.equal(savedRecord.portableHistory[0].content[0].text, 'old context')
    assert.deepEqual(savedRecord.portableHistory[0].content[1], { type: 'dsh_image_attachment', attachment })
    assert.equal(savedRecord.portableImageCount, 1)
    assert.deepEqual(savedRecord.nativeOutput[0].content[1], { type: 'dsh_image_attachment', attachment })
    assert.equal(JSON.stringify(savedRecord).includes('data:image'), false)
    assert.equal(calls[0].url, 'https://api.lcxbot.com/v1/responses')
    assert.equal(calls[0].body.stream, true)
    assert.deepEqual(calls[0].body.input.at(-1), { type: 'compaction_trigger' })
    assert.deepEqual(calls[0].body.input[0].content[1], { type: 'input_image', image_url: 'data:image/png;base64,AQID' })
    assert.equal(calls[0].body.prompt_cache_key, routeFingerprint(route()))
    assert.match(calls[0].headers['x-codex-beta-features'], /remote_compaction_v2/iu)
    assert.match(String(calls[0].headers['idempotency-key']), /^[0-9a-f-]{36}$/iu)

    const replayChunks = []
    for await (const chunk of listener({
      provider: 'lcx', model: 'gpt-5.6-sol', sessionId: 'session-1',
      messages: [message('user', marker), message('user', 'continue')],
    }, () => { throw new Error('replay should be intercepted') })) replayChunks.push(chunk)
    assert.equal(calls.length, 2)
    assert.equal(llmCalls.length, 0)
    assert.equal(calls[1].body.stream, true)
    assert.deepEqual(calls[1].body.input.at(-1), { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'continue' }] })
    assert.deepEqual(calls[1].body.input[0].content[1], { type: 'input_image', image_url: 'data:image/png;base64,AQID' })
    assert.equal(calls[1].body.input.some((item) => item.type === 'compaction' && item.encrypted_content === 'opaque-native'), true)
    assert.equal(JSON.stringify(calls[1].body.input).includes(marker), false)
    assert.deepEqual(replayChunks, nativeChunks)
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('v3 checkpoint migrates same-session model changes without sending opaque content', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  let listener
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: false, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  const calls = []
  const llmCalls = []
  const nativeChunks = [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'migrated' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'migrated' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const nativeStream = () => (async function* () {
    for (const chunk of nativeChunks) yield chunk
  })()
  harness.ctx.llm = {
    stream(options) {
      llmCalls.push(options)
      return listener(options, () => nativeStream())
    },
  }
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return compactSseResponse({ id: 'migration-response-1' })
  }
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const compact = []
    for await (const chunk of listener({ provider: 'lcx', model: 'gpt-5.6-sol', purpose: 'compaction', sessionId: 'same-session', messages: [message('user', 'portable old context')] }, () => { throw new Error('compaction should be intercepted') })) compact.push(chunk)
    const marker = compact.find((chunk) => chunk.type === 'text-delta').text
    const replay = []
    for await (const chunk of listener({
      provider: 'lcx',
      model: 'gpt-5.6-terra',
      sessionId: 'same-session',
      messages: [
        message('user', marker),
        {
          role: 'user',
          content: [
            { type: 'reasoning', text: 'private migration reasoning' },
            { type: 'text', text: 'continue on terra' },
          ],
        },
      ],
    }, () => { throw new Error('migration should be intercepted') })) replay.push(chunk)
    assert.equal(calls.length, 1)
    assert.equal(llmCalls.length, 1)
    assert.equal(llmCalls[0].model, 'gpt-5.6-terra')
    assert.equal(llmCalls[0].messages.some((item) => item.type === 'compaction'), false)
    assert.equal(llmCalls[0].messages.some((item) => item.role === 'assistant'), true)
    assert.equal(llmCalls[0].messages.at(-1).content[0].text, 'continue on terra')
    assert.equal(JSON.stringify(llmCalls[0].messages).includes('private migration reasoning'), false)
    assert.equal(llmCalls[0].messages.at(-1).content.some((block) => block.type === 'reasoning'), false)
    assert.equal(JSON.stringify(llmCalls[0].messages).includes('opaque-native'), false)
    assert.deepEqual(replay, nativeChunks)
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('v3 portable replay accepts a missing current session without sending opaque content', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const checkpointId = '61234567-89ab-cdef-0123-456789abcdef'
  const marker = `[dsh-lcx-codex-v3-checkpoint:${checkpointId}]`
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: false, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  const llmCalls = []
  const chunks = [{ type: 'finish', reason: { kind: 'stop' } }]
  new CheckpointV3Store(join(dir, 'checkpoints-v3.json')).put(checkpointId, portableRecord({ checkpointId }))
  harness.ctx.llm = {
    stream(options) {
      llmCalls.push(options)
      return (async function* () { yield* chunks })()
    },
  }
  let listener
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json') })
    const replay = []
    for await (const chunk of listener({
      provider: 'lcx', model: 'gpt-5.6-terra',
      messages: [message('user', marker), message('user', 'continue without session')],
    }, () => { throw new Error('portable migration should be intercepted') })) replay.push(chunk)
    assert.equal(llmCalls.length, 1)
    assert.equal(llmCalls[0].sessionId, undefined)
    assert.equal(llmCalls[0].messages.at(-1).content[0].text, 'continue without session')
    assert.equal(JSON.stringify(llmCalls[0].messages).includes('opaque-v3'), false)
    assert.deepEqual(replay, chunks)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('v3 compaction chains portable checkpoints across same-session model changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  let listener
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: false, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return compactSseResponse({ id: `compact-response-${calls.length}` })
  }
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })

    const firstChunks = []
    for await (const chunk of listener({
      provider: 'lcx', model: 'gpt-5.6-sol', purpose: 'compaction', sessionId: 'same-session',
      messages: [message('user', 'initial context'), message('user', 'You are now acting as a compaction engine. Output the checkpoint.')],
    }, () => { throw new Error('first compaction should be intercepted') })) firstChunks.push(chunk)
    const firstMarker = firstChunks.find((chunk) => chunk.type === 'text-delta').text
    assert.match(firstMarker, /\[dsh-lcx-codex-v3-checkpoint:([0-9a-f-]{36})\]/iu)
    const firstId = firstMarker.match(/\[dsh-lcx-codex-v3-checkpoint:([0-9a-f-]{36})\]/iu)[1]
    const store = new CheckpointV3Store(join(dir, 'checkpoints-v3.json'))
    const firstCheckpoint = store.get(firstId)
    assert.equal(firstCheckpoint.version, 3)
    assert.equal(firstCheckpoint.parentCheckpointId, undefined)

    const secondChunks = []
    for await (const chunk of listener({
      provider: 'lcx', model: 'gpt-5.6-terra', purpose: 'compaction', sessionId: 'same-session',
      messages: [
        message('user', firstMarker),
        message('user', 'new tail'),
        message('user', 'You are now acting as a compaction engine. Output the checkpoint.'),
      ],
    }, () => { throw new Error('second compaction should be intercepted') })) secondChunks.push(chunk)
    const secondMarker = secondChunks.find((chunk) => chunk.type === 'text-delta').text
    assert.match(secondMarker, /\[dsh-lcx-codex-v3-checkpoint:([0-9a-f-]{36})\]/iu)
    const secondId = secondMarker.match(/\[dsh-lcx-codex-v3-checkpoint:([0-9a-f-]{36})\]/iu)[1]

    assert.equal(calls.length, 2)
    assert.equal(calls[1].body.model, 'gpt-5.6-terra')
    assert.equal(calls[1].body.stream, true)
    assert.deepEqual(calls[1].body.input.slice(0, 1 + firstCheckpoint.portableHistory.length), [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: firstCheckpoint.portableSummary }] },
      ...firstCheckpoint.portableHistory,
    ])
    assert.equal(calls[1].body.input.some((item) => item.type === 'compaction'), false)
    assert.deepEqual(calls[1].body.input.at(-1), { type: 'compaction_trigger' })
    assert.equal(calls[1].body.input.at(-2).content[0].text, 'new tail')

    const secondCheckpoint = new CheckpointV3Store(join(dir, 'checkpoints-v3.json')).get(secondId)
    assert.equal(secondCheckpoint.version, 3)
    assert.equal(secondCheckpoint.parentCheckpointId, firstId)
    assert.deepEqual(secondCheckpoint.portableHistory.at(-1), {
      type: 'message', role: 'user', content: [{ type: 'input_text', text: 'new tail' }],
    })
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('legacy compact transport is rejected before any request', () => {
  const previousFetch = globalThis.fetch
  let requestCount = 0
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: true, compactTransport: 'native-v2', provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  globalThis.fetch = async () => {
    requestCount += 1
    throw new Error('legacy transport must not issue a request')
  }
  try {
    assert.throws(
      () => apply(harness.ctx, { compactTransport: 'legacy' }),
      (error) => error?.code === 'LCX_COMPACT_TRANSPORT_UNSUPPORTED' && error.message === 'Legacy compact transport is unsupported; only native-v2 is available',
    )
    assert.equal(requestCount, 0)
    assert.throws(
      () => apply(harness.ctx, { compactTransport: 'native-v3' }),
      (error) => error?.code === 'LCX_COMPACT_TRANSPORT_INVALID',
    )
    assert.equal(requestCount, 0)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('remote compact runs with local summary exactly once and exposes one readable marker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  let listener
  let nextCalls = 0
  const started = []
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  globalThis.fetch = async () => {
    started.push('remote')
    return compactSseResponse({ usage: { input_tokens: 4, output_tokens: 2 } })
  }
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const chunks = []
    for await (const chunk of listener({ provider: 'lcx', model: 'gpt-5.6-sol', purpose: 'compaction', messages: [message('user', 'old context')] }, () => {
      nextCalls += 1
      started.push('local')
      return (async function* () {
        yield { type: 'text-delta', text: 'Readable local summary' }
        yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    })) chunks.push(chunk)
    const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
    assert.equal(nextCalls, 1)
    assert.deepEqual(started, ['local', 'remote'])
    assert.match(text, /Readable local summary/u)
    assert.equal((text.match(/dsh-lcx-codex-v3-checkpoint:/gu) ?? []).length, 1)
    assert.equal(chunks.filter((chunk) => chunk.type === 'block-start').length, 1)
    assert.equal(chunks.at(-1).reason.kind, 'stop')
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('remote compact does not fallback for authentication or protocol errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  let listener
  let nextCalls = 0
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  globalThis.fetch = async () => jsonResponse({ error: 'unauthorized' }, 401)
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const chunks = []
    for await (const chunk of listener({ provider: 'lcx', model: 'gpt-5.6-sol', purpose: 'compaction', messages: [message('user', 'old context')] }, () => {
      nextCalls += 1
      return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })()
    })) chunks.push(chunk)
    assert.equal(nextCalls, 1)
    assert.equal(chunks.at(-1).reason.kind, 'error')
    assert.equal(chunks.at(-1).reason.failure.code, 'LCX_HTTP_ERROR')
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('remote compact reports HTTP 413 instead of selecting the parallel local summary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  let listener
  let attempts = 0
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  globalThis.fetch = async () => {
    attempts += 1
    return jsonResponse({ error: 'request too large' }, 413)
  }
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 3 })
    const chunks = []
    for await (const chunk of listener({ provider: 'lcx', model: 'gpt-5.6-sol', purpose: 'compaction', messages: [message('user', 'old context')] }, () => (async function* () {
      yield { type: 'text-delta', text: 'local summary must not be selected' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })())) chunks.push(chunk)
    assert.equal(attempts, 1)
    assert.equal(chunks.some((chunk) => chunk.type === 'text-delta'), false)
    assert.equal(chunks.at(-1).reason.kind, 'error')
    assert.equal(chunks.at(-1).reason.failure.code, 'LCX_HTTP_ERROR')
    assert.equal(chunks.at(-1).reason.failure.status, 413)
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('compact HTTP failure falls back only before checkpoint creation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  let listener
  let fallbackCalled = false
  const diagnostics = []
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue, undefined, { error(message) { diagnostics.push(String(message)) } })
  globalThis.fetch = async () => jsonResponse({ error: 'openai_error' }, 502)
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const chunks = []
    for await (const chunk of listener({ provider: 'lcx', model: 'gpt-5.6-sol', purpose: 'compaction', messages: [message('user', 'old context')] }, () => {
      fallbackCalled = true
      return (async function* () {
        yield { type: 'text-delta', text: 'local summary' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    })) chunks.push(chunk)
    assert.equal(fallbackCalled, true)
    assert.equal(chunks[0].text, 'local summary')
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    assert.equal(diagnostics.length, 2)
    assert.match(diagnostics[0], /code=LCX_HTTP_RETRYABLE/iu)
    assert.match(diagnostics[0], /transport=native-v2/iu)
    assert.doesNotMatch(diagnostics[0], /openai_error/iu)
    assert.doesNotMatch(diagnostics[0], /message=/iu)
    assert.match(diagnostics[1], /compaction fallback/iu)
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('transient network TypeError falls back before checkpoint creation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  let listener
  let fallbackCalled = false
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  globalThis.fetch = async () => { throw new TypeError('network unavailable') }
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const chunks = []
    for await (const chunk of listener({ provider: 'lcx', model: 'gpt-5.6-sol', purpose: 'compaction', messages: [message('user', 'old context')] }, () => {
      fallbackCalled = true
      return (async function* () {
        yield { type: 'text-delta', text: 'local summary' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    })) chunks.push(chunk)
    assert.equal(fallbackCalled, true)
    assert.equal(chunks[0].text, 'local summary')
    assert.equal(chunks.at(-1).reason.kind, 'stop')
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('existing checkpoint compaction failure never falls back to basic compaction', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  let listener
  let fallbackCalled = false
  const checkpointId = '51234567-89ab-cdef-0123-456789abcdef'
  const marker = `[dsh-lcx-codex-v3-checkpoint:${checkpointId}]`
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  new CheckpointV3Store(join(dir, 'checkpoints-v3.json')).put(checkpointId, portableRecord({ checkpointId }))
  globalThis.fetch = async () => jsonResponse({ error: 'checkpoint replay failed' }, 502)
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const chunks = []
    for await (const chunk of listener({
      provider: 'lcx', model: 'gpt-5.6-sol', purpose: 'compaction', sessionId: 'session-1',
      messages: [message('user', marker), message('user', 'You are now acting as a compaction engine. Output the checkpoint.')],
    }, () => {
      fallbackCalled = true
      return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })()
    })) chunks.push(chunk)
    assert.equal(fallbackCalled, false)
    assert.equal(chunks.at(-1).reason.kind, 'error')
    assert.equal(chunks.at(-1).reason.failure.code, 'LCX_HTTP_RETRYABLE')
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('local compact schema failure never falls back to basic compaction', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  let listener
  let fallbackCalled = false
  const harness = testContext({ enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' })
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const chunks = []
    for await (const chunk of listener({ provider: 'lcx', model: 'gpt-5.6-sol', purpose: 'compaction', messages: [message('user', 'old')], tools: [{}] }, () => {
      fallbackCalled = true
      return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })()
    })) chunks.push(chunk)
    assert.equal(fallbackCalled, false)
    assert.equal(chunks.at(-1).reason.failure.code, 'LCX_COMPACT_INVALID_TOOLS')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('image attachment failure never falls back to basic compaction', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  let listener
  let fallbackCalled = false
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  harness.ctx.attachments = { readImage: async () => { throw new Error('attachment unavailable') } }
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const chunks = []
    for await (const chunk of listener({
      provider: 'lcx', model: 'gpt-5.6-sol', purpose: 'compaction',
      messages: [{ role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'sha256:test', mediaType: 'image/png' } }] }],
    }, () => {
      fallbackCalled = true
      return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })()
    })) chunks.push(chunk)
    assert.equal(fallbackCalled, false)
    assert.equal(chunks.at(-1).reason.failure.code, 'LCX_COMPACT_IMAGE_UNAVAILABLE')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('credential resolution failure never falls back to basic compaction', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  let listener
  let fallbackCalled = false
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const harness = testContext(settingsValue)
  harness.ctx.get = (name) => name === 'settings'
    ? { register: () => ({ get: () => settingsValue, watch: () => () => {} }), get: () => undefined }
    : name === 'credentials' ? { resolve: async () => { throw new Error('credential lookup failed') } } : undefined
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const chunks = []
    for await (const chunk of listener({ provider: 'lcx', model: 'gpt-5.6-sol', purpose: 'compaction', messages: [message('user', 'old')] }, () => {
      fallbackCalled = true
      return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })()
    })) chunks.push(chunk)
    assert.equal(fallbackCalled, false)
    assert.match(chunks.at(-1).reason.failure.message, /credential lookup failed/u)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('configured GPT Responses provider is used for compact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  let listener
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const settings = {
    register: () => ({ get: () => settingsValue, watch: () => () => {} }),
    get(namespace) {
      if (namespace === 'llm-pi-ai') return { providers: { kedaya: {
        api: 'openai-responses',
        baseURL: 'https://kedaya.example/v1',
        apiKeyEnv: 'KEDAYA_API_KEY',
        retryPolicy: {
          mode: 'normal',
          maxRetries: 1,
          retryableCodes: ['SERVER'],
          backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
        },
      } } }
      return undefined
    },
  }
  const harness = testContext(settingsValue)
  harness.ctx.get = (name) => name === 'settings' ? settings : name === 'credentials' ? { resolve: async (ref) => ({ value: ref === 'KEDAYA_API_KEY' ? 'kedaya-key' : 'fallback-key', source: 'test' }) } : undefined
  harness.ctx.on = (_event, handler) => { listener = handler }
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers })
    if (calls.length === 1) return new Response('temporary failure', { status: 502 })
    return compactSseResponse({ id: 'kedaya-response-1' })
  }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    const chunks = []
    for await (const chunk of listener({ provider: 'kedaya', model: 'gpt-5.6-sol', purpose: 'compaction', sessionId: 's', messages: [message('user', 'old')] }, () => { throw new Error('should intercept') })) chunks.push(chunk)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].url, 'https://kedaya.example/v1/responses')
    assert.equal(calls[0].body.stream, true)
    assert.deepEqual(calls[0].body.input.at(-1), { type: 'compaction_trigger' })
    assert.match(calls[0].headers['x-codex-beta-features'], /remote_compaction_v2/iu)
    assert.equal(calls[0].headers.authorization, 'Bearer kedaya-key')
    assert.match(chunks.find((chunk) => chunk.type === 'text-delta').text, /checkpoint/)
  } finally {
    globalThis.fetch = previousFetch
    rmSync(dir, { recursive: true, force: true })
  }
})

test('non-GPT routes are not intercepted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  let listener
  let nextCalled = false
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: true, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const settings = {
    register: () => ({ get: () => settingsValue, watch: () => () => {} }),
    get(namespace) { return namespace === 'llm-pi-ai' ? { providers: { kedaya: { api: 'openai-responses', baseURL: 'https://kedaya.example/v1', apiKeyEnv: 'KEDAYA_API_KEY' } } } : undefined },
  }
  const harness = testContext(settingsValue)
  harness.ctx.get = (name) => name === 'settings' ? settings : undefined
  harness.ctx.on = (_event, handler) => { listener = handler }
  try {
    apply(harness.ctx, { checkpointPath: join(dir, 'checkpoints.json') })
    listener({ provider: 'kedaya', model: 'deepseek-v4', purpose: 'compaction', messages: [] }, () => { nextCalled = true; return [] })
    assert.equal(nextCalled, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('v3 replay uses real Cordis waterfall and registered DSH adapter', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lcx-codex-'))
  const previousFetch = globalThis.fetch
  const checkpointId = '41234567-89ab-cdef-0123-456789abcdef'
  const marker = `[dsh-lcx-codex-v3-checkpoint:${checkpointId}]`
  const settingsValue = { enabled: true, webSearch: false, remoteCompaction: true, fallbackToBasicCompaction: false, provider: 'lcx', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY', model: 'gpt-5.6-sol' }
  const settings = {
    register: () => ({ get: () => settingsValue, watch: () => () => {} }),
    get(namespace) {
      return namespace === 'llm-pi-ai'
        ? { providers: { lcx: { api: 'openai-responses', baseURL: 'https://api.lcxbot.com/v1', apiKeyEnv: 'LCX_API_KEY' } } }
        : undefined
    },
  }
  const ctx = new Context()
  ctx.provide('web', { searchProviderId: 'deepseek-official', registerSearchProvider() { return () => {} } })
  ctx.provide('tools', { register() { return () => {} } })
  ctx.provide('settings', settings)
  ctx.provide('credentials', { resolve: async () => ({ value: 'stored-key', source: 'test' }) })
  const llm = new LlmRuntime(ctx)
  const adapterCalls = []
  class TestAdapter extends LlmAdapter {
    providerInfo(provider) {
      return { id: provider, name: 'protocol integration adapter' }
    }

    async *stream(options) {
      adapterCalls.push(options)
      yield { type: 'text-delta', index: 0, text: 'A' }
      yield { type: 'text-delta', index: 0, text: 'B' }
    }
  }
  const adapterRegistration = llm.registerAdapter(['lcx'], new TestAdapter())
  let waterfallPasses = 0
  const removeWaterfallObserver = ctx.on('llm/stream', (_options, next) => {
    waterfallPasses += 1
    return next()
  })
  new CheckpointV3Store(join(dir, 'checkpoints-v3.json')).put(checkpointId, portableRecord({ checkpointId }))
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error('normal checkpoint replay must not use direct fetch')
  }
  try {
    apply(ctx, { checkpointPath: join(dir, 'checkpoints.json'), maxAttempts: 1 })
    await new Promise((resolve) => setImmediate(resolve))

    const tools = [{ type: 'function', name: 'read' }]
    const system = 'system instructions'
    const options = {
      provider: 'lcx',
      model: 'gpt-5.6-terra',
      sessionId: 'session-1',
      tools,
      system,
      messages: [message('user', marker), message('user', 'continue')],
    }
    const chunks = []
    for await (const chunk of llm.stream(options)) chunks.push(chunk)

    assert.deepEqual(llm.listProviders(), [{ id: 'lcx', name: 'protocol integration adapter' }])
    assert.equal(waterfallPasses, 1)
    assert.equal(fetchCalls, 0)
    assert.equal(adapterCalls.length, 1)
    assert.equal(adapterCalls[0].provider, options.provider)
    assert.equal(adapterCalls[0].model, options.model)
    assert.equal(adapterCalls[0].sessionId, options.sessionId)
    assert.strictEqual(adapterCalls[0].tools, tools)
    assert.equal(adapterCalls[0].system, system)
    assert.equal(adapterCalls[0].messages[0].source.plugin, 'dsh-lcx-codex')
    assert.equal(adapterCalls[0].messages[0].source.purpose, 'checkpoint-recall')
    assert.equal(adapterCalls[0].messages.at(-1).content[0].text, 'continue')
    const serializedMessages = JSON.stringify(adapterCalls[0].messages)
    assert.equal(serializedMessages.includes(marker), false)
    assert.equal(serializedMessages.includes('opaque'), false)
    assert.equal(serializedMessages.includes('native context'), false)
    assert.deepEqual(chunks, [
      { type: 'text-delta', index: 0, text: 'A' },
      { type: 'text-delta', index: 0, text: 'B' },
    ])
  } finally {
    globalThis.fetch = previousFetch
    removeWaterfallObserver?.()
    adapterRegistration()
    rmSync(dir, { recursive: true, force: true })
  }
})
