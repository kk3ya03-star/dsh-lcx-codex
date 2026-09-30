import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { Context } from '@deepseek-ai/cordis'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const compiledPath = resolve(`.wp4-index-${process.pid}.mjs`)
const built = await build({
  entryPoints: [resolve('src/index.ts')], bundle: true, packages: 'external',
  format: 'esm', platform: 'node', target: 'node24', write: false,
  footer: { js: '\nexport { stripCompactionDirective, remoteCompactionStream };' },
})
await writeFile(compiledPath, built.outputFiles[0].contents)
let source
try { source = await import(pathToFileURL(compiledPath).href) }
finally { await unlink(compiledPath) }

test('real compaction-basic compactNow directive is absent from Native V2 input', async () => {
  const ctx = new Context()
  const session = Session.create(SessionId('wp4-real-directive'))
  const request = []
  ctx.provide('llm', {
    async resolveModelInfo() { return { input: ['text'], context: { contextWindow: 272_000 }, defaultMaxTokens: 32_768 } },
    fileRequestText() { return 'fixture file' },
    async *stream(options) {
      request.push(options)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Summary of earlier work.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Summary of earlier work.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }, true)
  ctx.provide('tokenMeter', {
    measure(s) {
      const nodes = s.surface.nodes.map(seq => ({ seq, tokens: 100, heuristicTokens: 100 }))
      return { totalTokens: nodes.length * 100, nodes }
    },
    estimateMessage() { return 1 },
  }, true)
  ctx.provide('sessions', { get: () => session, async flush() {} }, true)
  ctx.provide('credentials', { async resolve() { return { value: 'fixture-only' } } }, true)
  session.append('request/header', { header: { config: { provider: 'relay', model: 'gpt-fixture' } }, reason: 'initial' })
  for (let n = 0; n < 3; n++) session.append('user/message', createUserMessage({
    source: { kind: 'user' }, content: [{ type: 'text', text: `history ${n}` }],
  }), { surfaceOp: 'append' })
  const engine = new BasicCompactionEngine(ctx, { auto: false, retainTokens: 0 })
  const signal = new AbortController().signal
  const agent = {
    session, options: { provider: 'relay', model: 'gpt-fixture' },
    runMaintenance: callback => callback(signal),
  }
  assert.ok(await engine.compactNow(agent, signal))
  assert.equal(request.length, 1)
  const options = request[0]
  assert.equal(options.purpose, 'compaction')
  const directive = options.messages.at(-1)
  assert.equal(directive.role, 'user')
  assert.deepEqual(Object.keys(directive).sort(), ['content', 'role'])
  assert.equal(directive.content.length, 1)
  assert.equal(directive.content[0].type, 'text')
  assert.equal(source.stripCompactionDirective(options.messages).length, options.messages.length - 1)
  const ordinary = { role: 'user', content: [{ type: 'text', text: directive.content[0].text }], id: 'real-user', source: { kind: 'user' } }
  assert.deepEqual(source.stripCompactionDirective([...options.messages.slice(0, -1), ordinary]).at(-1), ordinary)

  let body
  const fetchBefore = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body)
    return new Response('fixture denied', { status: 401 })
  }
  try {
    const route = { baseURL: 'https://fixture.invalid/v1', maxAttempts: 1, portableReplayMaxChars: 200_000 }
    await assert.rejects(async () => {
      for await (const _chunk of source.remoteCompactionStream(options, route, ctx, () => { throw new Error('unexpected DSH fallback') })) {}
    }, { code: 'LCX_HTTP_ERROR' })
    assert.ok(body)
    assert.deepEqual(body.input.at(-1), { type: 'compaction_trigger' })
    assert.ok(JSON.stringify(body.input).includes('history'))
    assert.equal(JSON.stringify(body.input).includes(directive.content[0].text), false)
  } finally { globalThis.fetch = fetchBefore }
})
