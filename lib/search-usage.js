import { z } from 'zod';
import { SessionSeq } from '@deepseek-ai/dsh-session';
import { addUsage, aggregateContextOf, auxiliaryUsageOf, isSearchTool, zeroBuckets } from './search-accounting.js';
const n = z.number().int().nonnegative();
const schema = z.object({ auxiliary: z.object({ uncachedInputTokens: n, outputTokens: n, cacheReadTokens: n, cacheWriteTokens: n }).strict(), aggregateContext: z.boolean() }).strict();
/** Separate, durable extension: the host's own usage projection remains primary-call billing. */
export const searchUsageProjection = {
    key: 'lcxSearchUsage', stateVersion: 2, stateSchema: schema.extend({ pending: z.record(z.string(), z.string()) }),
    init: () => ({ auxiliary: zeroBuckets(), aggregateContext: false, pending: {} }),
    apply(state, event) {
        if (event.type === 'tool/call' && isSearchTool(event.data.name))
            return { ...state, pending: { ...state.pending, [event.data.callId]: event.data.name } };
        const callId = event.type === 'tool/result' ? event.data.message.source.callId : undefined;
        const auxiliary = addUsage(state.auxiliary, auxiliaryUsageOf(event, callId ? state.pending[callId] : undefined));
        const aggregateContext = aggregateContextOf(event) ?? state.aggregateContext;
        if (callId && Object.hasOwn(state.pending, callId)) {
            const pending = { ...state.pending };
            delete pending[callId];
            return { auxiliary, aggregateContext, pending };
        }
        if (event.type === 'turn/end' && Object.keys(state.pending).length)
            return { auxiliary, aggregateContext, pending: {} };
        return auxiliary === state.auxiliary && aggregateContext === state.aggregateContext ? state : { ...state, auxiliary, aggregateContext };
    },
    wire: { viewSchema: schema, view: ({ auxiliary, aggregateContext }) => ({ auxiliary, aggregateContext }) },
};
const installed = new WeakMap();
/** Own a reversible adapter on the public measure method, never a DSH file or private fold. */
export function installSearchMeasurement(meter) {
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
    const cursors = new WeakMap();
    function measure(session, header) {
        const value = original.call(this, session, header);
        let state = cursors.get(session) ?? { seq: 0, aggregate: false };
        while (state.seq < session.seq) {
            const e = session.eventAt(SessionSeq(state.seq++));
            if (e?.type === 'assistant/message')
                state.aggregate = aggregateContextOf(e) ?? false;
        }
        cursors.set(session, state);
        if (!state.aggregate || value.baseline.kind !== 'usage')
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
    ctx.inject(['tokenMeter'], c => {
        c.effect(() => installSearchMeasurement(c.tokenMeter), 'lcx search context measurement');
    });
}
