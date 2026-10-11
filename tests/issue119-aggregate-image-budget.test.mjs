import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, IMAGE_OFFLOAD_REQUIRED_CODE } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Llm from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import Sessions from '@deepseek-ai/dsh-session'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import QuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Compaction from '@deepseek-ai/dsh-compaction-basic'
import { collect, loadSource } from './issue119-source.mjs'

// Issue 119 item 1: the request-image byte bound was only enforced per serialization batch, so images
// that a native compaction checkpoint hydrates back into the request were not counted against the new
// images that follow it. These tests run the real DSH agent loop, session, attachments contract and
// compaction path; only the attachment bytes and the provider HTTP call are fixtures.

const MiB = 1024 * 1024
const IMG = 1 * MiB
const b64 = (bytes) => Math.ceil(bytes / 3) * 4
const baseURL = 'https://fixture.invalid/v1'
const index = await loadSource('index', 'serializeNativeAware, managedResponsesStream')
const checkpoint = await loadSource('native-checkpoint')

async function harness(t, bound) {
  const routeConfig = { baseURL, portableReplayMaxChars: 200000, maxRequestImageBytes: bound }
  const root = await mkdtemp(resolve(tmpdir(), 'lcx-119-img-'))
  const ctx = new Context()
  ctx.plugin(Llm)
  ctx.plugin(PiAi, { providers: { openai: {} } })
  ctx.plugin(Sessions)
  ctx.plugin(Jsonl, { root: resolve(root, 'sessions') })
  ctx.plugin(QuerySqlite, { path: ':memory:', openAt: 'never' })
  ctx.plugin(Projections)
  ctx.plugin(SystemPrompt)
  ctx.plugin(Tools)
  ctx.plugin(Agents)
  ctx.plugin(AgentLoop)
  ctx.plugin(TokenMeter)
  ctx.plugin(Compaction, { auto: false })
  await new Promise((done) => setTimeout(done, 800))
  ctx.provide('attachments', {
    imageHostPath: () => 'F:/dsh/attachments/x.png',
    async readImageRequest(ref) {
      return { variantId: `v:${ref.attachmentId}`, attachment: ref, data: new Uint8Array(IMG).fill(7), mediaType: 'image/png', bytes: IMG, width: 8, height: 8, depth: 'uchar', space: 'srgb', hasAlpha: false }
    },
  }, true)
  ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-only' }) }, true)
  const raw = []
  ctx.on('llm/stream', (options) => {
    raw.push(options)
    if (options.purpose === 'compaction') {
      return (async function* () {
        const route = { provider: options.provider, model: options.model, baseURL, sessionId: String(options.sessionId) }
        const prepared = await index.serializeNativeAware(options.messages, route, routeConfig, ctx, { tools: [] })
        const session = ctx.sessions.get(SessionId(String(options.sessionId)))
        const result = { compaction: { type: 'compaction', encrypted_content: 'FAKE-OPAQUE' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
        const block = await checkpoint.createNativeCheckpointBlock({ ctx, session, route, result, input: prepared.input, ephemeralPreludeItemCount: prepared.ephemeralPreludeItemCount, supersededItemIndices: prepared.supersededInstructionItems, imageMap: prepared.imageMap, retentionOptions: {} })
        yield* checkpoint.nativeCheckpointChunks(block, result.usage)
      })()
    }
    return (async function* () {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'reply' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'reply' } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  })
  const bodies = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)))
    return new Response('', { status: 500 })
  })
  let counter = 0
  const images = (count) => Array.from({ length: count }, () => ({ type: 'image', attachment: { attachmentId: `sha256:img${counter++}`, mediaType: 'image/png', bytes: IMG, width: 8, height: 8 } }))
  const handle = await ctx.agents.create({ sessionId: SessionId(`i119-${Math.random().toString(36).slice(2)}`), meta: { cwd: root }, agentOptions: { provider: 'openai', model: 'gpt-5.6-sol' } })
  const ask = async (content) => {
    handle.agent.followup(createUserMessage({ content, source: { kind: 'user' } }))
    await handle.agent.whenIdle()
  }
  t.after(async () => {
    await handle.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return { ctx, raw, bodies, images, ask, handle, routeConfig }
}

const imageChars = (input) => {
  let count = 0
  let chars = 0
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') {
      if (value.type === 'input_image' && typeof value.image_url === 'string') {
        count += 1
        chars += value.image_url.length - value.image_url.indexOf(',') - 1
      }
      Object.values(value).forEach(walk)
    }
  }
  walk(input)
  return { count, chars }
}

async function send(h, request, messages = request.messages) {
  const chunks = await collect(index.managedResponsesStream({ ...request, messages, signal: AbortSignal.timeout(8000) }, h.routeConfig, h.ctx))
  return chunks.find((chunk) => chunk.type === 'finish')
}

/** Mark the oldest `count` image occurrences offloaded, as DSH's offload owner does on IMAGE_OFFLOAD_REQUIRED. */
function offloadOldest(messages, count) {
  let remaining = count
  return messages.map((message) => {
    if (!Array.isArray(message.content) || remaining <= 0) return message
    return { ...message, content: message.content.map((block) => {
      if (block.type === 'image' && block.offloaded !== true && remaining > 0) { remaining -= 1; return { ...block, offloaded: true } }
      return block
    }) }
  })
}

test('checkpoint-hydrated images count against the bound with the new images', async (t) => {
  const bound = 20 * MiB
  const h = await harness(t, bound)
  await h.ask([{ type: 'text', text: 'first' }, ...h.images(12)])
  assert.ok(await h.ctx.compaction.compactNow(h.handle.agent, new AbortController().signal), 'a native checkpoint was written')
  await h.ask([{ type: 'text', text: 'tail' }, ...h.images(8)])
  const request = h.raw.at(-1)
  assert.equal(request.messages.flatMap((m) => m.content).filter((b) => b.type === 'image').length, 8, 'only the tail images are offloadable')

  // 12 checkpoint images + 8 new ones is ~26.7 MiB of base64 against a 20 MiB bound.
  const before = h.bodies.length
  const finish = await send(h, request)
  assert.equal(h.bodies.length, before, 'an over-budget request must not be posted')
  assert.equal(finish.reason.kind, 'error')
  assert.equal(finish.reason.failure.code, IMAGE_OFFLOAD_REQUIRED_CODE)
  const needed = finish.reason.failure.offloadImages
  assert.ok(needed >= 1 && needed <= 8)

  // Offloading exactly what was asked for makes the request fit, and the retry posts a compliant body.
  const retried = await send(h, request, offloadOldest(request.messages, needed))
  assert.equal(retried.reason.failure.code, 'SERVER', 'the (500) fixture upstream answered, so the request was posted')
  const posted = imageChars(h.bodies.at(-1).input)
  assert.ok(posted.chars <= bound, `posted ${posted.chars} base64 chars over the ${bound} bound`)
  assert.equal(posted.count, 12 + 8 - needed)
  assert.ok(h.bodies.at(-1).input.some((item) => item.type === 'compaction'), 'the native checkpoint is still replayed')
  // The count is minimal: one fewer offloaded image would not fit.
  assert.ok(imageChars(h.bodies.at(-1).input).chars + b64(IMG) > bound)
})

test('a request that fits is posted unchanged', async (t) => {
  const h = await harness(t, 20 * MiB)
  await h.ask([{ type: 'text', text: 'first' }, ...h.images(6)])
  assert.ok(await h.ctx.compaction.compactNow(h.handle.agent, new AbortController().signal))
  await h.ask([{ type: 'text', text: 'tail' }, ...h.images(4)])
  const finish = await send(h, h.raw.at(-1))
  assert.equal(finish.reason.failure.code, 'SERVER')
  assert.equal(imageChars(h.bodies.at(-1).input).count, 10)
})

test('checkpoint images that alone exceed the bound fail with a clear, non-offload error', async (t) => {
  const h = await harness(t, 20 * MiB)
  await h.ask([{ type: 'text', text: 'first' }, ...h.images(9)]) // 9 * 1.33 MiB = 12 MiB
  assert.ok(await h.ctx.compaction.compactNow(h.handle.agent, new AbortController().signal))
  h.routeConfig.maxRequestImageBytes = 10 * MiB // the bound is lowered after the checkpoint was written
  await h.ask([{ type: 'text', text: 'tail' }, ...h.images(1)])
  const before = h.bodies.length
  const finish = await send(h, h.raw.at(-1))
  assert.equal(h.bodies.length, before)
  assert.equal(finish.reason.kind, 'error')
  assert.equal(finish.reason.failure.code, 'INVALID_REQUEST')
  assert.match(finish.reason.failure.message, /checkpoint/iu)
  assert.ok(!('offloadImages' in finish.reason.failure), 'offloading cannot help, so DSH is not asked to try')
})
