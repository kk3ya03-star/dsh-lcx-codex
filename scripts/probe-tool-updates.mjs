// Live acceptance probe for addition-only tool updates (Issue #120). It sends minimal Responses requests with
// the wire shapes LCX produces for mid-session tool additions and checks that the upstream accepts them, that
// the model can call the added tool, and how much of the prompt cache survives a tool addition.
//
// It spends real (small) upstream requests, so it is NOT part of `npm test` or CI. Run it by hand:
//   LCX_MODEL=gpt-6-sol,gpt-5.6-sol LCX_API_KEY_FILE=/path/to/key node scripts/probe-tool-updates.mjs
//   node scripts/probe-tool-updates.mjs --dry-run     # print the request shapes, no network, no key needed
//
// Environment: LCX_MODEL (comma separated exact model ids, required), LCX_API_KEY_FILE (a file holding the bearer
// key, or a DSH credentials YAML with `LCX_API_KEY:`), LCX_BASE_URL (default https://api.lcxbot.com/v1),
// LCX_PROBE_TRIALS (cache trials per shape, default 3), LCX_PROBE_PHASES (subset of "acceptance,edges,cache").
// The key is read into memory only and is never printed or written; error text is redacted.
import { readFileSync } from 'node:fs'

const dryRun = process.argv.includes('--dry-run')
const baseURL = String(process.env.LCX_BASE_URL ?? 'https://api.lcxbot.com/v1').replace(/\/+$/u, '')
const models = String(process.env.LCX_MODEL ?? (dryRun ? 'dry-run-model' : '')).split(',').map(value => value.trim()).filter(Boolean)
const trials = Math.max(1, Number(process.env.LCX_PROBE_TRIALS ?? 3))
const phases = new Set(String(process.env.LCX_PROBE_PHASES ?? 'acceptance,edges,cache').split(',').map(value => value.trim()))
if (models.length === 0) throw new Error('Set LCX_MODEL to one or more exact GPT model ids')

function readKey() {
  if (dryRun) return 'dry-run'
  const file = String(process.env.LCX_API_KEY_FILE ?? '').trim()
  if (!file) throw new Error('Set LCX_API_KEY_FILE to a local file containing the bearer key')
  const text = readFileSync(file, 'utf8')
  const yaml = /^\s*LCX_API_KEY:\s*(\S+)\s*$/mu.exec(text)
  const key = (yaml ? yaml[1].replace(/^["']|["']$/gu, '') : text).trim()
  if (!key) throw new Error('LCX_API_KEY_FILE holds no key')
  return key
}
const key = readKey()
const redact = value => String(value).split(key).join('<KEY>')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const fn = (name, description, properties = { x: { type: 'string' } }) => ({
  type: 'function', name, description, strict: false,
  parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
})
const user = text => ({ role: 'user', content: [{ type: 'input_text', text }] })
const assistant = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
const developer = text => ({ role: 'developer', content: text })
/** The declaration item LCX emits for a tool added mid-session (Pi `additional_tools`, or `tool_search` output). */
const addition = (kind, tools) => kind === 'additional_tools'
  ? [{ type: 'additional_tools', role: 'developer', tools }]
  : kind === 'tool_search'
    ? [
      { type: 'tool_search_call', call_id: `pi_tool_load_${tools[0].name}`, execution: 'client', status: 'completed', arguments: { query: tools.map(tool => tool.name).join(' '), limit: tools.length } },
      { type: 'tool_search_output', call_id: `pi_tool_load_${tools[0].name}`, execution: 'client', status: 'completed', tools: tools.map(tool => ({ ...tool, defer_loading: true })) },
    ]
    : []

async function call(body) {
  if (dryRun) return { status: 0, dry: true }
  try {
    const response = await fetch(`${baseURL}/responses`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) })
    const text = await response.text()
    if (!response.ok) return { status: response.status, error: redact(text).slice(0, 300) }
    let completed
    for (const block of text.split(/\n\n/u)) {
      const line = block.split('\n').find(candidate => candidate.startsWith('data:'))
      if (!line) continue
      try { const event = JSON.parse(line.slice(5)); if (event.type === 'response.completed') completed = event.response } catch { /* partial event */ }
    }
    if (!completed) return { status: response.status, error: redact(text).slice(0, 300) }
    const output = completed.output ?? []
    return {
      status: response.status,
      output,
      calls: output.filter(item => item.type === 'function_call'),
      usage: completed.usage,
    }
  } catch (error) {
    return { status: 0, error: redact(error.message) }
  }
}
const cached = result => result.usage?.input_tokens_details?.cached_tokens
const inputTokens = result => result.usage?.input_tokens
const brief = result => result.dry ? 'dry-run' : result.error ? `HTTP ${result.status} ${result.error}` : `HTTP ${result.status}`
const failures = []
const record = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures.push(label) }
const base = (model, input, tools, cacheKey, extra = {}) => ({ model, stream: true, store: false, prompt_cache_key: cacheKey, input, ...(tools ? { tools } : {}), ...extra })

const SYSTEM = 'You are a terse test agent. When asked to call a tool, call exactly that tool once with the requested argument and nothing else.'
const t1 = fn('probe_one', 'Probe tool one.')
const t2 = fn('probe_two', 'Probe tool two, added mid-session.')
const t3 = fn('probe_three', 'Probe tool three, added later.')
const roundTrip = (item, output) => [{ type: 'function_call', call_id: item.call_id, name: item.name, arguments: item.arguments }, { type: 'function_call_output', call_id: item.call_id, output }]

async function acceptance(model, kind) {
  const label = `${model} ${kind}`
  const salt = Math.random().toString(36).slice(2, 8)
  let input = [developer(SYSTEM), user('Call probe_one with x=alpha.')]
  const first = await call(base(model, input, [t1], `probe-a-${salt}`))
  if (dryRun) { console.log(JSON.stringify(base(model, [...input, assistant('ok'), ...addition(kind, [t2]), user('Call probe_two with x=beta.')], [t1], 'probe'), null, 1)); return }
  record(first.calls?.[0]?.name === 'probe_one', `${label}: initial request calls the initial tool (${brief(first)})`)
  if (!first.calls?.length) return
  input = [...input, ...roundTrip(first.calls[0], 'tok-1'), assistant('Done.'), ...addition(kind, [t2]), user('Call probe_two with x=beta.')]
  const second = await call(base(model, input, [t1], `probe-a-${salt}`))
  record(second.calls?.[0]?.name === 'probe_two', `${label}: the tool added mid-session is callable (${brief(second)})`)
  if (!second.calls?.length) return
  input = [...input, ...roundTrip(second.calls[0], 'tok-2'), assistant('Done.'), ...addition(kind, [t3]), user('Call probe_three with x=gamma.')]
  const third = await call(base(model, input, [t1], `probe-a-${salt}`))
  record(third.calls?.[0]?.name === 'probe_three', `${label}: a second addition is callable (${brief(third)})`)
  if (!third.calls?.length) return
  input = [...input, ...roundTrip(third.calls[0], 'tok-3'), assistant('Done.'), user('Now call probe_one again with x=delta.')]
  const fourth = await call(base(model, input, [t1], `probe-a-${salt}`))
  record(fourth.calls?.[0]?.name === 'probe_one', `${label}: the initial tool stays callable (${brief(fourth)})`)
}

async function edges(model) {
  const salt = Math.random().toString(36).slice(2, 8)
  const key2 = `probe-e-${salt}`
  const zero = await call(base(model, [developer(SYSTEM), assistant('hello'), ...addition('additional_tools', [t2]), user('Call probe_two with x=beta.')], undefined, key2))
  record(zero.calls?.[0]?.name === 'probe_two' || zero.dry === true, `${model} edge: zero initial tools plus an addition (${brief(zero)})`)
  const ghost = await call(base(model, [developer(SYSTEM), user('Call probe_two with x=a.'), ...roundTrip({ call_id: 'call_ghost1', name: 'probe_two', arguments: '{"x":"a"}' }, 'tok'), assistant('done'), user('Now call probe_one with x=b.')], [t1], key2))
  record(ghost.calls?.[0]?.name === 'probe_one' || ghost.dry === true, `${model} edge: history calls a tool that is no longer declared (removal fallback) (${brief(ghost)})`)
  const many = await call(base(model, [developer(SYSTEM), assistant('hello'), ...addition('additional_tools', [t2, t3]), user('Call probe_three with x=g.')], [t1], key2))
  record(many.calls?.[0]?.name === 'probe_three' || many.dry === true, `${model} edge: two tools in one addition (${brief(many)})`)
  const filler = Array.from({ length: 300 }, (_, index) => `note-${index} quick brown fox ${index * 7}`).join(' ')
  const history = [developer(SYSTEM), user(`Remember the codeword TANGERINE-42. ${filler}`), assistant('Noted.'), ...addition('additional_tools', [t2]), user('Call probe_two with x=z.'), ...roundTrip({ call_id: 'call_c1', name: 'probe_two', arguments: '{"x":"z"}' }, 'tok-9'), assistant('Done.')]
  const compacted = await call(base(model, [...history, { type: 'compaction_trigger' }], [t1], key2, { tool_choice: 'auto', parallel_tool_calls: true }))
  record(compacted.output?.some(item => item.type === 'compaction') === true || compacted.dry === true, `${model} edge: compaction request carrying additional_tools (${brief(compacted)})`)
  const compaction = compacted.output?.find(item => item.type === 'compaction')
  if (compaction) {
    const after = await call(base(model, [compaction, user('What was the codeword? Then call probe_three with x=q.')], [t1, t2, t3], key2))
    record(after.calls?.[0]?.name === 'probe_three', `${model} edge: continuing from the compaction with the full list as the new baseline (${brief(after)})`)
  }
}

function filler(seed, count) {
  const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima']
  return Array.from({ length: count }, (_, index) => `${words[(index * 7 + seed) % 12]}-${(index * 31 + seed) % 97}`).join(' ')
}
const baseTools = Array.from({ length: 6 }, (_, index) => fn(`base_tool_${index + 1}`, `Base tool ${index + 1}. ${filler(index, 60)}`, { arg: { type: 'string', description: filler(index + 3, 20) } }))
const added = fn('added_tool_2', `Tool added mid-session. ${filler(40, 60)}`, { arg: { type: 'string' } })
const SHAPES = {
  control: { extraTools: [], add: false },
  anchored: { extraTools: [], add: 'additional_tools' },
  anchored_tool_search: { extraTools: [], add: 'tool_search' },
  full_list: { extraTools: [added], add: false },
}

async function cache(model) {
  const rows = {}
  for (let trial = 1; trial <= trials; trial += 1) for (const [shape, spec] of Object.entries(SHAPES)) {
    const salt = `${model}-${shape}-${trial}-${Math.random().toString(36).slice(2, 10)}`
    const cacheKey = `probe-b-${salt}`
    const head = [developer(`Session ${salt}. Always answer with the single word ok. Rules: ${filler(5, 1500)}`), user(`Context block one. ${filler(11, 500)} Reply ok.`)]
    const second = user(`Context block two. ${filler(13, 500)} Reply ok.`)
    const send = (input, tools) => call(base(model, input, tools, cacheKey, { max_output_tokens: 64 }))
    await send(head, baseTools); await sleep(4000)
    await send([...head, assistant('ok'), second], baseTools); await sleep(4000)
    await send([...head, assistant('ok'), second], baseTools); await sleep(4000)
    const result = await send([...head, assistant('ok'), second, assistant('ok'), ...(spec.add ? addition(spec.add, [added]) : []), user(`Final question. ${filler(17, 60)} Reply ok.`)], [...baseTools, ...spec.extraTools])
    const total = inputTokens(result), hit = cached(result)
    ;(rows[shape] ??= []).push(total && hit !== undefined ? hit / total : Number.NaN)
    console.log(`  cache ${model} ${shape} trial ${trial}: ${hit}/${total} (${brief(result)})`)
  }
  for (const [shape, ratios] of Object.entries(rows)) {
    const valid = ratios.filter(Number.isFinite)
    console.log(`CACHE ${model} ${shape}: mean cached ratio ${valid.length ? (valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(3) : 'n/a'} over ${valid.length} trials`)
  }
}

for (const model of models) {
  if (phases.has('acceptance')) for (const kind of ['additional_tools', 'tool_search']) await acceptance(model, kind)
  if (phases.has('edges')) await edges(model)
  if (phases.has('cache') && !dryRun) await cache(model)
}
console.log(failures.length === 0 ? 'ACCEPTANCE: all checks passed (cache ratios are informational; compare anchored vs full_list)' : `ACCEPTANCE: ${failures.length} check(s) failed`)
process.exitCode = failures.length === 0 ? 0 : 1
