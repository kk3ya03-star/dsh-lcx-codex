import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Llm, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import QuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import Projections from '@deepseek-ai/dsh-session-projection'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import apply from '../lib/index.js'
import { installSearchUsage } from '../lib/search-usage.js'
import { pluginConfig, providerContext } from './dsh02-fixture.mjs'

// Issue 122: drive DSH's real programmatic-tool-calling path. The registry, the `run_code` transport, the
// nested dispatch scheduler, the `tool/ptc-dispatch` events and the Agent loop are the real
// `@deepseek-ai/dsh-tools` / `dsh-agent-loop` classes. The only stand-in is the script runtime behind
// `ctx.ptcRuntime` (the real one launches a sandboxed Node process): it evaluates the program body in-process
// and hands it the very `tools` binding namespace the real transport built, so every nested call crosses the
// real `binding()` -> scheduler -> `tool/ptc-dispatch` bridge.

class InProcessPtcRuntime extends Service {
  language = 'typescript'
  isolation = 'process'
  constructor(ctx) {
    super(ctx, 'ptcRuntime')
  }
  resolve(request) {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? null }
  }
  async run(spec) {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    const globals = Object.fromEntries(spec.bindings.map((binding) => [binding.global, binding.functions]))
    const logs = []
    try {
      const value = await new AsyncFunction(...Object.keys(globals), 'console', spec.program)(
        ...Object.values(globals),
        { log: (...values) => logs.push(values.join(' ')) },
      )
      return { logs, ...(value === undefined ? {} : { value }) }
    } catch (error) {
      return { logs, error: { kind: 'exception', message: error?.message ?? String(error) } }
    }
  }
}

class FixtureWorkingDirectory extends Service {
  constructor(ctx, root) {
    super(ctx, 'workingDirectory')
    this.root = root
  }
  async ensure() {
    return this.root
  }
}

class FixtureAdapter extends LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, context: { contextWindow: 200000 } }
  }
  async *stream() {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const hostedUsage = (input, output, cached = 0) => ({
  input_tokens: input,
  input_tokens_details: { cached_tokens: cached },
  output_tokens: output,
  total_tokens: input + output,
})

/** A complete Responses body for one Hosted search, optionally carrying image candidates. */
export function hostedResponse({ id, text = 'answer', usage, images = [] }) {
  return {
    id,
    status: 'completed',
    output_text: text,
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: { type: 'search', sources: [{ url: 'https://source.example/page', title: 'Source' }] },
        ...(images.length ? { results: images.map((image) => ({ type: 'image_result', ...image })) } : {}),
      },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] },
    ],
    usage,
  }
}

/**
 * Run one real Agent turn in which the model calls `run_code`; the program may call the Hosted search tools.
 * `modelCalls` is the scripted model: each entry is an array of `{ name, arguments }` tool calls (or a string
 * for the final answer text), consumed one per LLM request.
 */
export async function runAgent(t, { modelCalls, fetchHandler, config = {}, tools = { mode: 'ptc' } }) {
  const root = await mkdtemp(resolve(tmpdir(), 'lcx-122-ptc-'))
  const ctx = new Context()
  let handle
  t.after(async () => {
    await handle?.dispose()
    await rm(root, { recursive: true, force: true })
  })
  ctx.plugin(Llm)
  ctx.plugin(Sessions)
  ctx.plugin(Jsonl, { root: resolve(root, 'sessions') })
  ctx.plugin(QuerySqlite, { path: ':memory:', openAt: 'never' })
  ctx.plugin(Projections)
  ctx.plugin(SystemPrompt)
  ctx.plugin(Tools, tools)
  ctx.plugin(Agents)
  ctx.plugin(AgentLoop)
  ctx.plugin(InProcessPtcRuntime)
  ctx.plugin(FixtureWorkingDirectory, root)
  ctx.plugin(installSearchUsage)
  await new Promise((done) => setTimeout(done, 500))
  ctx.llm.registerAdapter(['fixture'], new FixtureAdapter())
  const profiles = providerContext({
    fixture: { api: 'openai-responses', baseURL: 'https://fixture.invalid/v1', apiKeyEnv: 'FIXTURE_KEY' },
  })
  const pluginCtx = {
    llm: profiles.llm,
    sessions: ctx.sessions,
    tools: ctx.tools,
    settings: { ...profiles.settings, configure: () => () => {} },
    web: {},
    credentials: { resolve: async () => ({ value: 'fixture-only' }) },
    attachments: {},
    fs: {},
    logger: { info() {}, warn() {} },
    get(name) {
      return this[name]
    },
    on: ctx.on.bind(ctx),
    effect() {},
    inject() {},
  }
  apply(pluginCtx, pluginConfig({ enabled: true, webSearch: true, advancedHostedSearch: true, ...config }))
  t.mock.method(globalThis, 'fetch', fetchHandler)
  let calls = 0
  ctx.on(
    'llm/stream',
    () => {
      const script = modelCalls[Math.min(calls, modelCalls.length - 1)]
      calls += 1
      return (async function* () {
        if (typeof script === 'string') {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: script } }
          yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        for (const [index, call] of script.entries()) {
          const args = JSON.stringify(call.arguments)
          yield { type: 'block-start', index, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index, id: call.id, name: call.name, argumentsDelta: args }
          yield { type: 'block-end', index, block: { type: 'tool-call', id: call.id, name: call.name, arguments: args } }
        }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      })()
    },
    { prepend: true },
  )
  handle = await ctx.agents.create({
    sessionId: SessionId(`i122-${Math.random().toString(36).slice(2)}`),
    meta: { cwd: root },
    agentOptions: { provider: 'fixture', model: 'gpt-search' },
  })
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'search please' }], source: { kind: 'user' } }))
  await handle.agent.whenIdle()
  return { ctx, session: handle.agent.session, events: handle.agent.session.snapshotEvents(), handle }
}

/** `run_code` tool call descriptor whose program body is `code`. */
export const runCode = (id, code) => ({
  id,
  name: 'run_code',
  arguments: { description: 'nested search', code },
})
