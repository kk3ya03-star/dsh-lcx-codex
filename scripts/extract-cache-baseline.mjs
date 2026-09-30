import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const ZSTD_MAGIC = 0xfd2fb528;
const TARGET_MODELS = new Set(['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna']);
const DEFAULT_SOURCE = 'C:\\Users\\83737\\.dsh\\sessions';
const DEFAULT_OUTPUT = 'evidence/cache-baseline';
const SESSION_HASH_SALT = 'dsh-lcx-cache-baseline-v1';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break;
    offset += 4;
    if (offset === buffer.length) break;
    const descriptor = buffer.readUInt8(offset++);
    if ((descriptor & 0x18) !== 0) throw new Error(`reserved zstd header bit at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const hasChecksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const headerBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < headerBytes) break;
    offset += headerBytes;

    let complete = false;
    while (offset < buffer.length) {
      if (buffer.length - offset < 3) break;
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`reserved zstd block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) break;
      offset += payloadBytes;
      if (!lastBlock) continue;
      if (hasChecksum) {
        if (buffer.length - offset < 4) break;
        offset += 4;
      }
      frames.push({ start, end: offset });
      complete = true;
      break;
    }
    if (!complete) break;
  }
  return frames;
}

function listRecentSessionFiles(sourceRoot, cutoffMs) {
  const files = [];
  const pending = [sourceRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      if (entry.isFile() && entry.name === 'session.jsonl.zstd' && statSync(candidate).mtimeMs >= cutoffMs) {
        files.push(candidate);
      }
    }
  }
  return files.sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs);
}

function hash(value) {
  return createHash('sha256').update(SESSION_HASH_SALT).update(value).digest('hex').slice(0, 16);
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function modelFrom(data) {
  const candidates = [
    data?.model,
    data?.header?.config?.model,
    data?.message?.source?.model,
    data?.chunk?.replayState?.response?.model,
  ];
  return candidates.find((value) => TARGET_MODELS.has(value)) ?? null;
}

function providerFamily(data) {
  const candidates = [
    data?.provider,
    data?.header?.config?.provider,
    data?.header?.config?.baseUrl,
    data?.message?.source?.provider,
    data?.chunk?.replayState?.response?.provider,
  ];
  const value = candidates.find((item) => typeof item === 'string')?.toLowerCase() ?? '';
  if (value.includes('newapi')) return 'newapi';
  if (value.includes('oauth')) return 'oauth';
  if (value.includes('openai')) return 'openai';
  return 'unknown';
}

function routeFamily(data) {
  const candidates = [data?.route, data?.header?.config?.route, data?.header?.config?.provider, data?.header?.config?.baseUrl, data?.provider];
  const value = candidates.find((item) => typeof item === 'string')?.toLowerCase() ?? '';
  if (value.includes('responses')) return 'responses';
  if (value.includes('chat')) return 'chat-completions';
  return 'unknown';
}

function toolCategory(data) {
  const candidates = [data?.tool?.name, data?.toolName, data?.call?.name, data?.name];
  const value = candidates.find((item) => typeof item === 'string')?.toLowerCase() ?? '';
  return value.includes('search') ? 'search' : 'tool';
}

function isExplicitCompact(event) {
  return typeof event.type === 'string' && event.type.toLowerCase().includes('compact');
}

function isExplicitRestart(event) {
  return typeof event.type === 'string' && event.type.toLowerCase().includes('restart');
}

function isExplicitFork(event, data) {
  return Boolean(data?.header?.parentSession ?? data?.parentSession)
    || (typeof event.type === 'string' && event.type.toLowerCase().includes('fork'));
}

function usageSampleFrom(event) {
  const data = event.data;
  const usage = event.type === 'assistant/message'
    ? data?.usage
    : event.type === 'assistant/chunk' && data?.chunk?.type === 'usage'
      ? data.chunk.usage
      : undefined;
  const inputTokens = numberOrNull(usage?.inputTokens);
  const turn = numberOrNull(data?.turn);
  const step = numberOrNull(data?.step);
  if (inputTokens === null || turn === null || step === null) return null;
  return {
    turn,
    step,
    inputTokens,
    cachedTokens: numberOrNull(usage.cacheReadTokens ?? usage.cachedTokens) ?? 0,
    cacheWriteTokens: numberOrNull(usage.cacheWriteTokens ?? usage.cacheWrite) ?? 0,
  };
}

function eventFingerprint(types) {
  return hash(types.sort().join('|'));
}

function decodeEvents(file, counters) {
  const bytes = readFileSync(file);
  const events = [];
  for (const frame of scanZstdFrames(bytes)) {
    let decoded;
    try {
      decoded = zstdDecompressSync(bytes.subarray(frame.start, frame.end)).toString('utf8');
    } catch {
      counters.invalidFrames += 1;
      continue;
    }
    counters.decodedFrames += 1;
    for (const line of decoded.split('\n')) {
      if (line.length === 0) continue;
      try {
        const event = JSON.parse(line);
        if (event && typeof event === 'object' && typeof event.type === 'string') events.push(event);
        else counters.invalidEvents += 1;
      } catch {
        counters.invalidEvents += 1;
      }
    }
  }
  return events;
}

function extractSession(file, counters) {
  const safeSessionId = hash(file);
  const state = {
    model: null,
    provider: 'unknown',
    route: 'unknown',
    parentObserved: false,
    compactEpoch: 0,
  };
  const turns = new Map();
  const samples = new Map();

  for (const event of decodeEvents(file, counters)) {
    const data = event.data;
    if (data && typeof data === 'object') {
      const model = modelFrom(data);
      if (model) state.model = model;
      state.provider = providerFamily(data) === 'unknown' ? state.provider : providerFamily(data);
      state.route = routeFamily(data) === 'unknown' ? state.route : routeFamily(data);
      state.parentObserved ||= isExplicitFork(event, data);
    }
    const turn = numberOrNull(data?.turn);
    const turnInfo = turn === null ? null : turns.get(turn) ?? { types: [], tool: null, compactEpoch: state.compactEpoch, restart: false };
    if (turnInfo) {
      turnInfo.types.push(event.type);
      if (event.type === 'tool/call' || event.type === 'tool/result') {
        const category = toolCategory(data);
        turnInfo.tool = category === 'search' ? 'search' : turnInfo.tool ?? 'tool';
      }
      turns.set(turn, turnInfo);
    }
    if (isExplicitCompact(event)) state.compactEpoch += 1;
    if (turnInfo && isExplicitRestart(event)) turnInfo.restart = true;

    const usage = usageSampleFrom(event);
    if (!usage || !state.model) continue;
    // DSH's durable token meter replaces earlier stream samples for a turn/step.
    samples.set(`${usage.turn}:${usage.step}`, {
      usage,
      model: state.model,
      provider: state.provider,
      route: state.route,
      compactEpoch: state.compactEpoch,
    });
  }

  let request = 0;
  let previous = null;
  const records = [];
  for (const sample of [...samples.values()].sort((left, right) => left.usage.turn - right.usage.turn || left.usage.step - right.usage.step)) {
    request += 1;
    const turnInfo = turns.get(sample.usage.turn) ?? { types: [], tool: null, compactEpoch: sample.compactEpoch, restart: false };
    const phase = turnInfo.tool ?? 'ordinary';
    const structuralFingerprint = eventFingerprint(turnInfo.types);
    let firstDivergence = 'none';
    if (!previous) firstDivergence = 'cold-start';
    else if (previous.model !== sample.model) firstDivergence = 'model-switch';
    else if (previous.route !== sample.route) firstDivergence = 'route-change';
    else if (previous.compactEpoch !== sample.compactEpoch) firstDivergence = 'compact-epoch';
    else if (previous.phase !== phase) firstDivergence = 'phase-change';
    else if (previous.fingerprint !== structuralFingerprint) firstDivergence = 'structural';

    const billedInputTokens = sample.usage.inputTokens + sample.usage.cachedTokens + sample.usage.cacheWriteTokens;
    records.push({
      session: safeSessionId,
      request_ordinal: request,
      turn_ordinal: sample.usage.turn,
      model: sample.model,
      provider_family: sample.provider,
      route_family: sample.route,
      input_tokens: billedInputTokens,
      cached_tokens: sample.usage.cachedTokens,
      cache_write_tokens: sample.usage.cacheWriteTokens,
      uncached_input_tokens: sample.usage.inputTokens,
      cache_hit_ratio: billedInputTokens === 0 ? null : Number((sample.usage.cachedTokens / billedInputTokens).toFixed(6)),
      phase,
      cold_start: request === 1,
      fork_observed: state.parentObserved,
      compact_epoch: sample.compactEpoch,
      restart_observed: turnInfo.restart,
      structural_fingerprint: structuralFingerprint,
      first_divergence: firstDivergence,
    });
    previous = { model: sample.model, route: sample.route, compactEpoch: sample.compactEpoch, phase, fingerprint: structuralFingerprint };
  }
  return records;
}

function aggregate(records, counters, sourceFiles, hours) {
  const totalInput = records.reduce((total, record) => total + record.input_tokens, 0);
  const totalCached = records.reduce((total, record) => total + record.cached_tokens, 0);
  const values = (key) => Object.fromEntries([...new Set(records.map((record) => record[key]))].sort().map((value) => [value, records.filter((record) => record[key] === value).length]));
  const observed = {
    ordinary: records.some((record) => record.phase === 'ordinary'),
    tool: records.some((record) => record.phase === 'tool'),
    search: records.some((record) => record.phase === 'search'),
    compact: records.some((record) => record.compact_epoch > 0),
    restart: records.some((record) => record.restart_observed),
    model_switch: records.some((record) => record.first_divergence === 'model-switch'),
    fork: records.some((record) => record.fork_observed),
    newapi_affinity: records.some((record) => record.provider_family === 'newapi'),
    oauth_affinity: records.some((record) => record.provider_family === 'oauth'),
  };
  const notCovered = Object.entries(observed).filter(([, value]) => !value).map(([key]) => key.toUpperCase());
  return { totalInput, totalCached, observed, notCovered, summary: `# Cache Baseline\n\n- Source window: recent ${hours} hours of local DSH session artifacts\n- Source files scanned: ${sourceFiles}\n- Complete zstd frames decoded: ${counters.decodedFrames}\n- Invalid frames skipped: ${counters.invalidFrames}\n- Invalid JSON/event records skipped: ${counters.invalidEvents}\n- Sanitized GPT requests: ${records.length}\n- Sanitized GPT sessions: ${new Set(records.map((record) => record.session)).size}\n- Weighted cache hit ratio: ${totalInput === 0 ? 'N/A' : (totalCached / totalInput).toFixed(6)}\n\n## Method\n\ninput_tokens is DSH's full prompt-side billed input: uncached_input_tokens + cached_tokens + cache_write_tokens. The source usage.inputTokens is the uncached bucket. Stream samples are folded by (turn, step) and only the last durable sample is retained, matching DSH's token-meter projection.\n\n## Coverage\n\n- Model counts: ${JSON.stringify(values('model'))}\n- Provider family counts: ${JSON.stringify(values('provider_family'))}\n- Route family counts: ${JSON.stringify(values('route_family'))}\n- Phase counts: ${JSON.stringify(values('phase'))}\n- First-divergence counts: ${JSON.stringify(values('first_divergence'))}\n- Observed categories: ${Object.entries(observed).filter(([, value]) => value).map(([key]) => key.toUpperCase()).join(', ') || 'NONE'}\n- NOT_COVERED: ${notCovered.join(', ') || 'NONE'}\n\n## Redaction\n\nThe JSONL evidence contains only the documented fields: hashed session ID, ordinal values, fixed model/provider/route families, token counts, boolean classifications, and SHA-256 structural fingerprints. It contains no message content, reasoning, tool arguments/results, credentials, raw cache/session keys, opaque state, or payload bodies.\n` };
}

const source = resolve(option('--source', DEFAULT_SOURCE));
const output = resolve(option('--out', DEFAULT_OUTPUT));
const hours = positiveInteger(option('--hours', '72'), '--hours');
if (!existsSync(source)) throw new Error(`source directory does not exist: ${source}`);

const counters = { decodedFrames: 0, invalidFrames: 0, invalidEvents: 0 };
const files = listRecentSessionFiles(source, Date.now() - hours * 60 * 60 * 1000);
const records = files.flatMap((file) => extractSession(file, counters)).sort((left, right) => left.session.localeCompare(right.session) || left.request_ordinal - right.request_ordinal);
const aggregateResult = aggregate(records, counters, files.length, hours);
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'cache-requests.jsonl'), records.map((record) => JSON.stringify(record)).join(records.length > 0 ? '\n' : ''));
writeFileSync(join(output, 'SUMMARY.md'), aggregateResult.summary);
console.log(JSON.stringify({ source_files: files.length, requests: records.length, sessions: new Set(records.map((record) => record.session)).size, weighted_cache_hit_ratio: aggregateResult.totalInput === 0 ? null : Number((aggregateResult.totalCached / aggregateResult.totalInput).toFixed(6)), not_covered: aggregateResult.notCovered }));
