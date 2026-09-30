import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INPUT = 'evidence/cache-baseline/cache-requests.jsonl';
const OUTPUT = 'evidence/cache-baseline';
const MODELS = ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna'];
const PHASES = ['ordinary', 'tool', 'search'];
const AUTHORITY = { requests: 6101, input_tokens: 689088421, cached_tokens: 649849216, uncached_input_tokens: 39239205 };
const FIELDS = new Set(['session', 'request_ordinal', 'turn_ordinal', 'model', 'provider_family', 'route_family', 'input_tokens', 'cached_tokens', 'cache_write_tokens', 'uncached_input_tokens', 'cache_hit_ratio', 'phase', 'cold_start', 'fork_observed', 'compact_epoch', 'restart_observed', 'structural_fingerprint', 'first_divergence']);

function rate(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(6));
}

function percentile(values, fraction) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted.length === 0 ? null : sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function readRows() {
  const rows = readFileSync(INPUT, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  for (const row of rows) {
    if (Object.keys(row).some((key) => !FIELDS.has(key))) throw new Error('unexpected evidence field');
    if (!MODELS.includes(row.model) || !PHASES.includes(row.phase)) throw new Error('invalid evidence enum');
    if (row.input_tokens !== row.cached_tokens + row.uncached_input_tokens + row.cache_write_tokens) throw new Error('input buckets do not reconcile');
  }
  return rows.sort((left, right) => left.session.localeCompare(right.session) || left.request_ordinal - right.request_ordinal);
}

function rowTotals(rows) {
  const totals = rows.reduce((sum, row) => ({
    input_tokens: sum.input_tokens + row.input_tokens,
    cached_tokens: sum.cached_tokens + row.cached_tokens,
    uncached_input_tokens: sum.uncached_input_tokens + row.uncached_input_tokens,
  }), { input_tokens: 0, cached_tokens: 0, uncached_input_tokens: 0 });
  return { requests: rows.length, ...totals, cache_hit_ratio: rate(totals.cached_tokens, totals.input_tokens) };
}

function sessionGroups(rows) {
  const groups = new Map();
  for (const row of rows) groups.set(row.session, [...(groups.get(row.session) ?? []), row]);
  return groups;
}

function sessionLabels(groups) {
  const summaries = [...groups.entries()].map(([session, rows]) => ({ session, input_tokens: rowTotals(rows).input_tokens }));
  const p25 = percentile(summaries.map((item) => item.input_tokens), 0.25);
  const p50 = percentile(summaries.map((item) => item.input_tokens), 0.5);
  const p75 = percentile(summaries.map((item) => item.input_tokens), 0.75);
  const label = (input) => input <= p25 ? 'q1' : input <= p50 ? 'q2' : input <= p75 ? 'q3' : 'q4';
  return { thresholds: { p25, p50, p75 }, labels: new Map(summaries.map((item) => [item.session, { quartile: label(item.input_tokens), high_input: item.input_tokens >= p75 }])) };
}

function inputSize(input) {
  if (input < 4000) return '<4k';
  if (input < 16000) return '4k-16k';
  if (input < 64000) return '16k-64k';
  if (input <= 128000) return '64k-128k';
  return '>128k';
}

function makePair(previous, current, labels) {
  const priorPrefixTokens = previous.input_tokens;
  const priorPrefixReused = Math.min(current.cached_tokens, priorPrefixTokens);
  const priorPrefixReused128 = Math.min(priorPrefixTokens, current.cached_tokens + 128);
  return {
    session: current.session,
    model: current.model,
    phase: current.phase,
    input_size: inputSize(current.input_tokens),
    session_input_quartile: labels.quartile,
    high_input_session: labels.high_input,
    previous_input_tokens: priorPrefixTokens,
    current_input_tokens: current.input_tokens,
    current_cached_tokens: current.cached_tokens,
    current_uncached_input_tokens: current.uncached_input_tokens,
    prior_prefix_reused: priorPrefixReused,
    prior_prefix_reuse_ratio: rate(priorPrefixReused, priorPrefixTokens),
    prior_prefix_reused_128: priorPrefixReused128,
    prior_prefix_reuse_ratio_128: rate(priorPrefixReused128, priorPrefixTokens),
    prefix_gap_tokens: Math.max(0, priorPrefixTokens - current.cached_tokens),
    new_tail_proxy: Math.max(0, current.input_tokens - priorPrefixTokens),
    excess_uncached_proxy: Math.max(0, current.uncached_input_tokens - Math.max(0, current.input_tokens - priorPrefixTokens)),
    structural_fingerprint: current.structural_fingerprint,
  };
}

function pairMetrics(pairs) {
  const sum = pairs.reduce((result, pair) => ({
    prior_prefix_tokens: result.prior_prefix_tokens + pair.previous_input_tokens,
    prior_prefix_reused: result.prior_prefix_reused + pair.prior_prefix_reused,
    prior_prefix_reused_128: result.prior_prefix_reused_128 + pair.prior_prefix_reused_128,
    prefix_gap_tokens: result.prefix_gap_tokens + pair.prefix_gap_tokens,
    new_tail_proxy: result.new_tail_proxy + pair.new_tail_proxy,
    excess_uncached_proxy: result.excess_uncached_proxy + pair.excess_uncached_proxy,
    current_uncached_input_tokens: result.current_uncached_input_tokens + pair.current_uncached_input_tokens,
  }), { prior_prefix_tokens: 0, prior_prefix_reused: 0, prior_prefix_reused_128: 0, prefix_gap_tokens: 0, new_tail_proxy: 0, excess_uncached_proxy: 0, current_uncached_input_tokens: 0 });
  return {
    pairs: pairs.length,
    ...sum,
    prior_prefix_reuse_ratio: rate(sum.prior_prefix_reused, sum.prior_prefix_tokens),
    prior_prefix_reuse_ratio_128: rate(sum.prior_prefix_reused_128, sum.prior_prefix_tokens),
  };
}

function grouped(pairs, labels) {
  return Object.fromEntries(labels.map((label) => [label, pairMetrics(pairs.filter((pair) => pair.group === label))]));
}

function ratioBuckets(pairs) {
  const definitions = [
    ['>=99%', (pair) => pair.prior_prefix_reuse_ratio >= 0.99],
    ['[98%,99%)', (pair) => pair.prior_prefix_reuse_ratio >= 0.98 && pair.prior_prefix_reuse_ratio < 0.99],
    ['[95%,98%)', (pair) => pair.prior_prefix_reuse_ratio >= 0.95 && pair.prior_prefix_reuse_ratio < 0.98],
    ['<95%', (pair) => pair.prior_prefix_reuse_ratio < 0.95],
  ];
  return Object.fromEntries(definitions.map(([label, test]) => [label, pairMetrics(pairs.filter(test))]));
}

function analyse(rows) {
  const all = rowTotals(rows);
  if (Object.keys(AUTHORITY).some((key) => all[key] !== AUTHORITY[key])) throw new Error('source dataset does not match #39 authority');
  const groups = sessionGroups(rows);
  const labels = sessionLabels(groups);
  const excluded = { model_switch: [], compact_boundary: [], context_shrink_or_unknown: [], zero_or_invalid_denominator: [] };
  const warm = [];
  for (const [session, values] of groups) {
    for (let index = 1; index < values.length; index += 1) {
      const previous = values[index - 1];
      const current = values[index];
      if (previous.model !== current.model) { excluded.model_switch.push({ previous, current }); continue; }
      if (previous.compact_epoch !== current.compact_epoch) { excluded.compact_boundary.push({ previous, current }); continue; }
      if (previous.input_tokens <= 0) { excluded.zero_or_invalid_denominator.push({ previous, current }); continue; }
      if (current.input_tokens < previous.input_tokens) { excluded.context_shrink_or_unknown.push({ previous, current }); continue; }
      warm.push(makePair(previous, current, labels.labels.get(session)));
    }
  }
  const totalAdjacent = rows.length - groups.size;
  const excludedCount = Object.values(excluded).reduce((sum, values) => sum + values.length, 0);
  if (warm.length + excludedCount !== totalAdjacent) throw new Error('pair funnel does not reconcile');
  const overall = pairMetrics(warm);
  const withUncachedShare = (metrics) => ({ ...metrics, prefix_gap_uncached_share: rate(metrics.prefix_gap_tokens, all.uncached_input_tokens), excess_uncached_share: rate(metrics.excess_uncached_proxy, all.uncached_input_tokens) });
  const group = (key, names) => Object.fromEntries(names.map((name) => [name, withUncachedShare(pairMetrics(warm.filter((pair) => pair[key] === name)))]));
  const top = warm.slice().sort((left, right) => right.prefix_gap_tokens - left.prefix_gap_tokens || right.current_uncached_input_tokens - left.current_uncached_input_tokens).slice(0, 20);
  return {
    source_commit: '9ab97cf917060d5269186ab0579b0b75b4ade68b',
    source_authority: all,
    pair_funnel: {
      total_adjacent_within_session_pairs: totalAdjacent,
      excluded_model_switch: excluded.model_switch.length,
      excluded_compact_boundary: excluded.compact_boundary.length,
      context_shrink_or_unknown: excluded.context_shrink_or_unknown.length,
      zero_or_invalid_denominator: excluded.zero_or_invalid_denominator.length,
      final_append_only_warm_pairs: warm.length,
      high_input_long_session_warm_pairs: warm.filter((pair) => pair.high_input_session).length,
      reconciliation: warm.length + excludedCount,
      exclusion_priority: ['model_switch', 'compact_boundary', 'zero_or_invalid_denominator', 'context_shrink_or_unknown'],
    },
    overall_warm_pairs: withUncachedShare(overall),
    reuse_ratio_percentiles: {
      p25: percentile(warm.map((pair) => pair.prior_prefix_reuse_ratio), 0.25),
      median: percentile(warm.map((pair) => pair.prior_prefix_reuse_ratio), 0.5),
      p75: percentile(warm.map((pair) => pair.prior_prefix_reuse_ratio), 0.75),
      p90: percentile(warm.map((pair) => pair.prior_prefix_reuse_ratio), 0.9),
      p95: percentile(warm.map((pair) => pair.prior_prefix_reuse_ratio), 0.95),
    },
    ratio_buckets: ratioBuckets(warm),
    by_model: group('model', MODELS),
    by_phase: group('phase', PHASES),
    by_input_size: group('input_size', ['<4k', '4k-16k', '16k-64k', '64k-128k', '>128k']),
    by_session_input_quartile: group('session_input_quartile', ['q1', 'q2', 'q3', 'q4']),
    high_input_long_sessions: withUncachedShare(pairMetrics(warm.filter((pair) => pair.high_input_session))),
    session_input_quartile_thresholds: labels.thresholds,
    proxy_scope: {
      prefix_gap_tokens: overall.prefix_gap_tokens,
      prefix_gap_uncached_share: rate(overall.prefix_gap_tokens, all.uncached_input_tokens),
      excess_uncached_proxy: overall.excess_uncached_proxy,
      excess_uncached_share: rate(overall.excess_uncached_proxy, all.uncached_input_tokens),
      uncached_not_explained_by_excess_proxy: Math.max(0, all.uncached_input_tokens - overall.excess_uncached_proxy),
      note: 'prefix gap and excess uncached are non-additive pair-level proxies, not an exact serialized-prefix or upstream attribution',
    },
    top20_prefix_gap_pairs: {
      prefix_gap_share: rate(pairMetrics(top).prefix_gap_tokens, all.uncached_input_tokens),
      pairs: top.map((pair) => ({ session: pair.session, model: pair.model, phase: pair.phase, previous_input_tokens: pair.previous_input_tokens, current_input_tokens: pair.current_input_tokens, current_cached_tokens: pair.current_cached_tokens, prefix_gap_tokens: pair.prefix_gap_tokens, prior_prefix_reuse_ratio: pair.prior_prefix_reuse_ratio, structural_fingerprint: pair.structural_fingerprint })),
    },
  };
}

function table(headers, rows) {
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

function metricRows(values) {
  return Object.entries(values).map(([name, value]) => [name, value.pairs, value.prior_prefix_tokens, value.prior_prefix_reused, value.prefix_gap_tokens, value.excess_uncached_proxy, value.prior_prefix_reuse_ratio]);
}

function report(analysis) {
  const funnel = analysis.pair_funnel;
  const columns = ['group', 'pairs', 'prior prefix', 'reused', 'gap', 'excess uncached proxy', 'reuse ratio'];
  const high = analysis.high_input_long_sessions;
  const conclusion = funnel.final_append_only_warm_pairs < 100
    ? 'Warm-pair volume is below one hundred; do not use this audit to decide prefix drift.'
    : high.prior_prefix_reuse_ratio >= 0.98
      ? 'High-input warm pairs meet the 98% threshold: current overall miss economics are predominantly new-tail and boundary compatible by this proxy.'
      : 'High-input warm pairs are below 98% by this proxy: exact serialized-prefix instrumentation is warranted before any cache implementation change.';
  return `# Prefix-Reuse Proxy Audit\n\n## Scope\n\n- Reads only the committed sanitized 6,101-row cache baseline.\n- No DSH/model/provider traffic, raw content, credentials, opaque state, or runtime change.\n- This is a pair-level proxy, not an exact serialized-prefix or upstream cache trace.\n\n## Pair Funnel\n\n${table(['stage', 'pairs'], [
  ['total adjacent within-session', funnel.total_adjacent_within_session_pairs],
  ['excluded model-switch', funnel.excluded_model_switch],
  ['excluded compact boundary', funnel.excluded_compact_boundary],
  ['context shrink or unknown', funnel.context_shrink_or_unknown],
  ['zero or invalid previous input', funnel.zero_or_invalid_denominator],
  ['final append-only warm pairs', funnel.final_append_only_warm_pairs],
  ['high-input/long-session warm pairs', funnel.high_input_long_session_warm_pairs],
  ['reconciliation', funnel.reconciliation],
])}\n\nExclusion priority: ${funnel.exclusion_priority.join(' -> ')}. Phase and structural fingerprint never exclude a pair.\n\n## Overall Warm Prefix Reuse\n\n${JSON.stringify(analysis.overall_warm_pairs)}\n\n- Pair ratio p25/median/p75/p90/p95: ${analysis.reuse_ratio_percentiles.p25} / ${analysis.reuse_ratio_percentiles.median} / ${analysis.reuse_ratio_percentiles.p75} / ${analysis.reuse_ratio_percentiles.p90} / ${analysis.reuse_ratio_percentiles.p95}.\n- 128-token tolerance sensitivity: ${analysis.overall_warm_pairs.prior_prefix_reuse_ratio_128}.\n- ${conclusion}\n\n## Reuse Ratio Buckets\n\n${table(columns, metricRows(analysis.ratio_buckets))}\n\n## By Model\n\n${table(columns, metricRows(analysis.by_model))}\n\n## By Current Phase\n\n${table(columns, metricRows(analysis.by_phase))}\n\n## By Current Input Size\n\n${table(columns, metricRows(analysis.by_input_size))}\n\n## Session Input Quartiles\n\n- Session total-input thresholds: ${JSON.stringify(analysis.session_input_quartile_thresholds)}.\n${table(columns, metricRows(analysis.by_session_input_quartile))}\n\n## High-Input/Long Sessions\n\n${JSON.stringify(high)}\n\n## Proxy Scale Against Baseline Uncached\n\n${JSON.stringify(analysis.proxy_scope)}\n\nThe two proxies are non-additive. Unexplained includes excluded/shrink pairs and prompt behavior the pair model cannot see.\n\n## Top Prefix-Gap Pairs\n\n- Top 20 gap share against total baseline uncached: ${analysis.top20_prefix_gap_pairs.prefix_gap_share}.\n- The anonymous, field-restricted rows are in prefix-reuse.json.\n\n## Not Covered\n\nTTL/idle expiry, exact serialized prefix topology, NewAPI/OAuth affinity, provider retry behavior, cache-write details, and causal mechanism are not present in this sanitized dataset.\n`;
}

const rows = readRows();
const analysis = analyse(rows);
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(resolve(OUTPUT, 'prefix-reuse.json'), `${JSON.stringify(analysis, null, 2)}\n`);
writeFileSync(resolve(OUTPUT, 'PREFIX-REUSE.md'), report(analysis));
console.log(JSON.stringify({ pair_funnel: analysis.pair_funnel, overall_warm_prefix_reuse: analysis.overall_warm_pairs.prior_prefix_reuse_ratio, high_input_prefix_reuse: analysis.high_input_long_sessions.prior_prefix_reuse_ratio, proxy_scope: analysis.proxy_scope }));
