import { z } from 'zod';
import { canonicalHeader, headerEquals } from '@deepseek-ai/dsh-session';
import { addUsage, aggregateContextOf, auxiliaryUsageOf, isSearchTool, providerContextOf, zeroBuckets } from './search-accounting.js';
const n = z.number().int().nonnegative();
const schema = z.object({ auxiliary: z.object({ uncachedInputTokens: n, outputTokens: n, cacheReadTokens: n, cacheWriteTokens: n }).strict(), aggregateContext: z.boolean(),
    contextDetails: z.object({ input_tokens: n, output_tokens: n }).strict().optional(), contextProvenance: z.literal('provider-context-details').optional() }).strict();
const headerKey = (header) => header === undefined ? undefined : JSON.stringify(canonicalHeader(header));
/** Separate, durable extension: the host's own usage projection remains primary-call billing. */
export const searchUsageProjection = {
    key: 'lcxSearchUsage', stateVersion: 3, stateSchema: schema.extend({ pending: z.record(z.string(), z.string()), headerKey: z.string().optional(), sampleHeaderKey: z.string().optional() }),
    init: () => ({ auxiliary: zeroBuckets(), aggregateContext: false, pending: {} }),
    apply(state, event) {
        if (event.type === 'request/header')
            return { ...state, headerKey: headerKey(event.data.header) };
        // DSH measure anchors assistant/message only. Attempts must not transplant a
        // newer context sample onto an older successful measurement anchor.
        if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
            const contextDetails = event.type === 'assistant/message' ? providerContextOf(event) : undefined;
            return { ...state, aggregateContext: aggregateContextOf(event) ?? state.aggregateContext, contextDetails,
                contextProvenance: contextDetails ? 'provider-context-details' : undefined,
                sampleHeaderKey: contextDetails ? state.headerKey : undefined };
        }
        if (event.type === 'tool/call' && isSearchTool(event.data.name))
            return { ...state, pending: { ...state.pending, [event.data.callId]: event.data.name } };
        const callId = event.type === 'tool/result' ? event.data.message.source.callId : undefined;
        const auxiliary = addUsage(state.auxiliary, auxiliaryUsageOf(event, callId ? state.pending[callId] : undefined));
        const aggregateContext = aggregateContextOf(event) ?? state.aggregateContext;
        if (callId && Object.hasOwn(state.pending, callId)) {
            const pending = { ...state.pending };
            delete pending[callId];
            return { ...state, auxiliary, aggregateContext, pending };
        }
        if (event.type === 'turn/end' && Object.keys(state.pending).length)
            return { ...state, auxiliary, aggregateContext, pending: {} };
        return auxiliary === state.auxiliary && aggregateContext === state.aggregateContext ? state : { ...state, auxiliary, aggregateContext };
    },
    wire: { viewSchema: schema, view: ({ auxiliary, aggregateContext, contextDetails, contextProvenance }) => ({ auxiliary, aggregateContext, ...(contextDetails ? { contextDetails, contextProvenance } : {}) }) },
};
const installed = new WeakMap();
/** Own a reversible adapter on the public measure method, never a DSH file or private fold. */
export function installSearchMeasurement(meter, projections) {
    const existing = installed.get(meter);
    if (existing) {
        existing.refs++;
        let active = true;
        return () => { if (active) {
            active = false;
            release(meter);
        } };
    }
    const original = meter.measure, descriptor = Object.getOwnPropertyDescriptor(meter, 'measure');
    function measure(session, header) {
        const value = original.call(this, session, header);
        const state = projections.stateOf(session, 'lcxSearchUsage');
        if (!state?.aggregateContext)
            return value;
        const effectiveHeader = header ?? session.requestHeader();
        if (state.contextDetails && state.sampleHeaderKey !== undefined && effectiveHeader !== undefined
            && headerEquals(JSON.parse(state.sampleHeaderKey), canonicalHeader(effectiveHeader))) {
            const tokens = state.contextDetails.input_tokens;
            return Object.freeze({ ...value, baseline: Object.freeze({ kind: 'estimated', tokens }),
                totalTokens: Math.max(0, tokens + value.surfaceDeltaTokens) });
        }
        if (value.baseline.kind !== 'usage')
            return value;
        // The official measure already prices retained images/files and surface replacements.
        // Only discard its unsuitable aggregate anchor; keep its current surface and node prices.
        const tools = (header ?? session.requestHeader())?.tools;
        const toolTokens = !tools?.length ? 0 : Math.ceil(JSON.stringify(tools).length / 4) + 4;
        const tokens = value.surfaceTokens + toolTokens;
        return Object.freeze({ ...value, baseline: Object.freeze({ kind: 'estimated', tokens }), surfaceDeltaTokens: 0, totalTokens: tokens });
    }
    Object.defineProperty(meter, 'measure', { configurable: true, writable: true, value: measure });
    installed.set(meter, { refs: 1, release() {
            if (Object.getOwnPropertyDescriptor(meter, 'measure')?.value !== measure)
                return;
            if (descriptor)
                Object.defineProperty(meter, 'measure', descriptor);
            else
                delete meter.measure;
        } });
    let active = true;
    return () => { if (active) {
        active = false;
        release(meter);
    } };
}
function release(meter) {
    const record = installed.get(meter);
    if (record && --record.refs === 0) {
        record.release();
        installed.delete(meter);
    }
}
export function installSearchUsage(ctx) {
    ctx.inject(['sessionProjections'], c => { c.sessionProjections.register(searchUsageProjection); });
    ctx.inject(['tokenMeter', 'sessionProjections'], c => {
        c.effect(() => installSearchMeasurement(c.tokenMeter, c.sessionProjections), 'lcx search context measurement');
    });
}
