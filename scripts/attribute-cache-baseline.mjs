import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INPUT = 'evidence/cache-baseline/cache-requests.jsonl';
const OUTPUT = 'evidence/cache-baseline';
const MODELS = ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna'];
const DIVERGENCES = ['cold-start', 'model-switch', 'compact-epoch', 'phase-change', 'structural', 'none'];
const AUTHORITY = { input_tokens: 689088421, cached_tokens: 649849216, uncached_input_tokens: 39239205, cache_write_tokens: 0 };
const FIELDS = new Set(['session', 'request_ordinal', 'turn_ordinal', 'model', 'provider_family', 'route_family', 'input_tokens', 'cached_tokens', 'cache_write_tokens', 'uncached_input_tokens', 'cache_hit_ratio', 'phase', 'cold_start', 'fork_observed', 'compact_epoch', 'restart_observed', 'structural_fingerprint', 'first_divergence']);

function readRows() {
  const rows = readFileSync(INPUT, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  for (const row of rows) {
    if (Object.keys(row).some((key) => !FIELDS.has(key))) throw new Error('unexpected evidence field');
    if (!MODELS.includes(row.model) || row.input_tokens !== row.uncached_input_tokens + row.cached_tokens + row.cache_write_tokens) throw new Error('invalid evidence row');
    if (row.input_tokens === 0 ? row.cache_hit_ratio !== null : !(row.cache_hit_ratio >= 0 && row.cache_hit_ratio <= 1)) throw new Error('invalid evidence ratio');
  }
  return rows.sort((left, right) => left.session.localeCompare(right.session) || left.request_ordinal - right.request_ordinal);
}

function rate(cached, input) {
  return input === 0 ? null : Number((cached / input).toFixed(6));
}

function totals(rows) {
  const result = rows.reduce((sum, row) => ({
    input_tokens: sum.input_tokens + row.input_tokens,
    cached_tokens: sum.cached_tokens + row.cached_tokens,
    cache_write_tokens: sum.cache_write_tokens + row.cache_write_tokens,
    uncached_input_tokens: sum.uncached_input_tokens + row.uncached_input_tokens,
  }), { input_tokens: 0, cached_tokens: 0, cache_write_tokens: 0, uncached_input_tokens: 0 });
  return { requests: rows.length, ...result, cache_hit_ratio: rate(result.cached_tokens, result.input_tokens) };
}

function withShare(summary, all) {
  return { ...summary, uncached_share: rate(summary.uncached_input_tokens, all.uncached_input_tokens) };
}

function collect(rows, labels, selector, all) {
  return Object.fromEntries(labels.map((label) => [label, withShare(totals(rows.filter((row) => selector(row) === label)), all)]));
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  return Number(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)].toFixed(6));
}

function ratioBuckets(rows, all) {
  const definitions = [
    ['0%', (row) => row.cache_hit_ratio === 0],
    ['(0,50)', (row) => row.cache_hit_ratio > 0 && row.cache_hit_ratio < 0.5],
    ['[50,80)', (row) => row.cache_hit_ratio >= 0.5 && row.cache_hit_ratio < 0.8],
    ['[80,95)', (row) => row.cache_hit_ratio >= 0.8 && row.cache_hit_ratio < 0.95],
    ['[95,99)', (row) => row.cache_hit_ratio >= 0.95 && row.cache_hit_ratio < 0.99],
    ['>=99', (row) => row.cache_hit_ratio >= 0.99],
    ['N/A_zero_input', (row) => row.cache_hit_ratio === null],
  ];
  return Object.fromEntries(definitions.map(([label, matches]) => [label, withShare(totals(rows.filter(matches)), all)]));
}

function sizeBuckets(rows, all) {
  const definitions = [
    ['<4k', (row) => row.input_tokens < 4000],
    ['4k-16k', (row) => row.input_tokens >= 4000 && row.input_tokens < 16000],
    ['16k-64k', (row) => row.input_tokens >= 16000 && row.input_tokens < 64000],
    ['64k-128k', (row) => row.input_tokens >= 64000 && row.input_tokens <= 128000],
    ['>128k', (row) => row.input_tokens > 128000],
  ];
  return Object.fromEntries(definitions.map(([label, matches]) => [label, withShare(totals(rows.filter(matches)), all)]));
}

function sessions(rows, all) {
  const groups = new Map();
  for (const row of rows) groups.set(row.session, [...(groups.get(row.session) ?? []), row]);
  const summaries = [...groups.entries()].map(([session, values]) => ({ session, ...totals(values) }));
  const validRates = summaries.map((summary) => summary.cache_hit_ratio).filter((value) => value !== null);
  const inputP75 = percentile(summaries.map((summary) => summary.input_tokens), 0.75);
  const high = summaries.filter((summary) => summary.input_tokens >= inputP75);
  const highRows = high.flatMap((summary) => groups.get(summary.session));
  const low = summaries.filter((summary) => summary.cache_hit_ratio !== null && summary.cache_hit_ratio < 0.95);
  return {
    session_count: summaries.length,
    unweighted_cache_rate_percentiles: { p25: percentile(validRates, 0.25), median: percentile(validRates, 0.5), p75: percentile(validRates, 0.75), p90: percentile(validRates, 0.9) },
    low_hit_definition: 'session cache_hit_ratio < 0.95',
    low_hit_sessions: low.length,
    low_hit_input_tokens: low.reduce((sum, summary) => sum + summary.input_tokens, 0),
    low_hit_input_share: rate(low.reduce((sum, summary) => sum + summary.input_tokens, 0), all.input_tokens),
    high_input_definition: 'session total input_tokens >= unweighted p75',
    high_input_p75_tokens: inputP75,
    high_input_sessions: high.length,
    high_input: withShare(totals(highRows), all),
  };
}

function strictSteady(rows) {
  const keys = new Set();
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const row = rows[index];
    if (row.session !== previous.session || row.model !== previous.model) continue;
    if (row.phase !== 'ordinary' || previous.phase !== 'ordinary' || row.turn_ordinal !== previous.turn_ordinal + 1) continue;
    if (row.first_divergence !== 'none' || row.compact_epoch !== previous.compact_epoch) continue;
    if (row.restart_observed || row.fork_observed || previous.restart_observed || previous.fork_observed) continue;
    keys.add(`${row.session}:${row.request_ordinal}`);
  }
  return { keys, rows: rows.filter((row) => keys.has(`${row.session}:${row.request_ordinal}`)) };
}

function compact(rows, steadyKeys, all) {
  const pre = [];
  const first = [];
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].session === rows[index - 1].session && rows[index].first_divergence === 'compact-epoch') {
      pre.push(rows[index - 1]);
      first.push(rows[index]);
    }
  }
  const later = rows.filter((row) => row.compact_epoch > 0 && steadyKeys.has(`${row.session}:${row.request_ordinal}`));
  return { detectable_pre_compact: withShare(totals(pre), all), detectable_post_compact_first: withShare(totals(first), all), post_compact_later_steady: withShare(totals(later), all) };
}

function phases(rows, all) {
  const ordinary = rows.filter((row) => row.phase === 'ordinary');
  const toolHeavy = rows.filter((row) => row.phase === 'tool' || row.phase === 'search');
  return {
    ordinary: withShare(totals(ordinary), all),
    tool_heavy: withShare(totals(toolHeavy), all),
    tool_structure_change: withShare(totals(toolHeavy.filter((row) => row.first_divergence === 'structural')), all),
    tool_without_structure_change: withShare(totals(toolHeavy.filter((row) => row.first_divergence !== 'structural')), all),
  };
}

function uncachedSplit(rows, steadyKeys, all) {
  const expected = [];
  const avoidable = [];
  const unknown = [];
  const boundaries = new Set(['cold-start', 'model-switch', 'compact-epoch', 'phase-change']);
  for (const row of rows) {
    if (boundaries.has(row.first_divergence)) expected.push(row);
    else if (steadyKeys.has(`${row.session}:${row.request_ordinal}`) && row.cache_hit_ratio < 0.98) avoidable.push(row);
    else unknown.push(row);
  }
  return {
    rule: 'expected only has explicit cold/model-switch/compact/phase boundary; potentially_avoidable is strict steady-state below 0.98; all other rows remain unknown',
    expected_cold_or_boundary: withShare(totals(expected), all),
    potentially_avoidable_steady_state: withShare(totals(avoidable), all),
    unknown_from_local_evidence: withShare(totals(unknown), all),
  };
}

function top20(rows, all) {
  const top = rows.slice().sort((left, right) => right.uncached_input_tokens - left.uncached_input_tokens || right.input_tokens - left.input_tokens).slice(0, 20);
  return {
    uncached_share: rate(totals(top).uncached_input_tokens, all.uncached_input_tokens),
    requests: top.map((row) => ({ session: row.session, model: row.model, phase: row.phase, first_divergence: row.first_divergence, input_tokens: row.input_tokens, cached_tokens: row.cached_tokens, uncached_input_tokens: row.uncached_input_tokens, cache_hit_ratio: row.cache_hit_ratio, structural_fingerprint: row.structural_fingerprint })),
  };
}

function table(headers, rows) {
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

function report(analysis) {
  const columns = ['group', 'requests', 'input', 'cached', 'uncached', 'uncached share', 'rate'];
  const stats = (label, value) => [label, value.requests, value.input_tokens, value.cached_tokens, value.uncached_input_tokens, value.uncached_share, value.cache_hit_ratio];
  const modelRows = MODELS.map((model) => stats(model, analysis.by_model[model]));
  const divergenceRows = DIVERGENCES.map((name) => stats(name, analysis.divergence[name]));
  const ratioRows = Object.entries(analysis.ratio_buckets).map(([name, value]) => stats(name, value));
  const sizeRows = Object.entries(analysis.input_size_buckets).map(([name, value]) => stats(name, value));
  const phaseRows = Object.entries(analysis.phase).map(([name, value]) => stats(name, value));
  const compactRows = Object.entries(analysis.compact).map(([name, value]) => stats(name, value));
  const splitRows = Object.entries(analysis.uncached_split).filter(([name]) => name !== 'rule').map(([name, value]) => [name, value.requests, value.uncached_input_tokens, value.uncached_share, value.cache_hit_ratio]);
  const largest = Object.entries(analysis.input_size_buckets).sort((left, right) => right[1].uncached_input_tokens - left[1].uncached_input_tokens)[0][0];
  const steadyConclusion = analysis.steady_state.requests < 20
    ? 'The strict cohort has fewer than 20 requests and is insufficient to decide whether ordinary prefix drift exists.'
    : analysis.steady_state.cache_hit_ratio >= 0.98
      ? 'The strict cohort is at or above 98%; the aggregate baseline is not evidence of ordinary prefix drift.'
      : 'The strict cohort is below 98%; this is a local signal only and does not establish a cause.';
  return `# Cache Attribution\n\n## Scope And Authority\n\n- Source: existing committed, sanitized cache-requests.jsonl only\n- Exact source authority: 9ab97cf917060d5269186ab0579b0b75b4ade68b\n- Requests: ${analysis.all.requests}; sessions: ${analysis.sessions.session_count}\n- Aggregate token invariant: input=${analysis.all.input_tokens}; cached=${analysis.all.cached_tokens}; uncached=${analysis.all.uncached_input_tokens}; cache-write=${analysis.all.cache_write_tokens}; weighted hit=${analysis.all.cache_hit_ratio}.\n- No DSH/model/provider traffic was created and no runtime file was changed.\n\n## Model Totals\n\n${table(columns, modelRows)}\n\n## Session Distribution\n\n- Unweighted session cache-rate percentiles: p25=${analysis.sessions.unweighted_cache_rate_percentiles.p25}; median=${analysis.sessions.unweighted_cache_rate_percentiles.median}; p75=${analysis.sessions.unweighted_cache_rate_percentiles.p75}; p90=${analysis.sessions.unweighted_cache_rate_percentiles.p90}.\n- Low-hit sessions (${analysis.sessions.low_hit_definition}): ${analysis.sessions.low_hit_sessions}; input=${analysis.sessions.low_hit_input_tokens}; input share=${analysis.sessions.low_hit_input_share}.\n- High-input sessions (${analysis.sessions.high_input_definition}; p75=${analysis.sessions.high_input_p75_tokens}): ${analysis.sessions.high_input_sessions}; input=${analysis.sessions.high_input.input_tokens}; input share=${analysis.sessions.high_input.uncached_share === null ? null : rate(analysis.sessions.high_input.input_tokens, analysis.all.input_tokens)}; weighted hit=${analysis.sessions.high_input.cache_hit_ratio}.\n\n## Request Ratio Buckets\n\n${table(columns, ratioRows)}\n\nN/A_zero_input is an explicit accounting row for nine valid zero-token usage records; it is not a cache miss bucket.\n\n## Input Size Buckets\n\n${table(columns, sizeRows)}\n\nThe largest uncached contribution is ${largest}.\n\n## Structural Divergence\n\n${table(columns, divergenceRows)}\n\n## Strict Steady-State Cohort\n\n- Definition: same session/model; current and immediately previous model request are ordinary adjacent turns; no cold/model-switch/compact/phase/structural boundary; unchanged compact epoch; no observed restart/fork.\n- ${JSON.stringify(analysis.steady_state)}\n- ${steadyConclusion}\n\n## Detectable Compact Cohorts\n\n${table(columns, compactRows)}\n\nOnly explicit local compact-epoch structure is compared. No cache-write or upstream behavior is inferred.\n\n## Tool-Heavy Versus Ordinary\n\n${table(columns, phaseRows)}\n\nThe tool-structure row is descriptive association only, not a causal conclusion.\n\n## Top 20 Uncached Requests\n\n- Top 20 cumulative uncached share: ${analysis.top20.uncached_share}.\n- The anonymous, field-restricted rows are in cache-attribution.json.\n\n## Conservative Uncached Split\n\n${table(['classification', 'requests', 'uncached', 'uncached share', 'rate'], splitRows)}\n\n${analysis.uncached_split.rule}.\n\n## Limits\n\nEvery source row has provider_family and route_family unknown. Restart, fork, NewAPI/OAuth affinity, cache-write activity, provider retries, raw upstream behavior, and causal explanations are outside this local evidence.\n`;
}

const rows = readRows();
const all = totals(rows);
if (rows.length !== 6101 || Object.keys(AUTHORITY).some((key) => all[key] !== AUTHORITY[key])) throw new Error('source dataset does not match #39 authority');
const steady = strictSteady(rows);
const analysis = {
  source_commit: '9ab97cf917060d5269186ab0579b0b75b4ade68b',
  all,
  by_model: collect(rows, MODELS, (row) => row.model, all),
  sessions: sessions(rows, all),
  ratio_buckets: ratioBuckets(rows, all),
  input_size_buckets: sizeBuckets(rows, all),
  divergence: collect(rows, DIVERGENCES, (row) => row.first_divergence, all),
  steady_state: withShare(totals(steady.rows), all),
  compact: compact(rows, steady.keys, all),
  phase: phases(rows, all),
  top20: top20(rows, all),
  uncached_split: uncachedSplit(rows, steady.keys, all),
};
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(resolve(OUTPUT, 'cache-attribution.json'), `${JSON.stringify(analysis, null, 2)}\n`);
writeFileSync(resolve(OUTPUT, 'ATTRIBUTION.md'), report(analysis));
console.log(JSON.stringify({ authoritative_total: analysis.all, steady_state: analysis.steady_state, uncached_split: analysis.uncached_split }));
