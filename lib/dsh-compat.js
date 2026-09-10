import { symbols as cordisSymbols } from "@deepseek-ai/cordis";
import { Session, SessionId, } from "@deepseek-ai/dsh-session";
function mutableService(value) {
    return (value !== null && (typeof value === "object" || typeof value === "function"));
}
function agentLike(value) {
    return mutableService(value) ? value : undefined;
}
function agentSession(value) {
    return mutableService(value) ? value : undefined;
}
export function agentSessionId(agent) {
    return String(agentSession(agentLike(agent)?.session)?.id ?? "");
}
export function agentUsesSession(agent, session) {
    return agentLike(agent)?.session === session;
}
export function sessionFromAgent(agent) {
    const session = agentLike(agent)?.session;
    return session instanceof Session ? session : undefined;
}
export function readAgentRouteState(agent) {
    const value = agentLike(agent);
    return {
        requestConfig: agentSession(value?.session)?.requestHeader?.()?.config,
        options: value?.options,
        sessionId: agentSessionId(value),
    };
}
export function scopedToolRuntime(agent) {
    const tools = resolveScopedService(agent, "tools");
    if (!mutableService(tools) || typeof tools.register !== "function")
        return undefined;
    return {
        register: tools.register.bind(tools),
        ...(typeof tools.get === "function"
            ? { get: tools.get.bind(tools) }
            : {}),
    };
}
export function tokenMeterTotal(value, session) {
    if (!mutableService(value) || typeof value.measure !== "function")
        return undefined;
    const measurement = Reflect.apply(value.measure, value, [session]);
    if (!mutableService(measurement) || typeof measurement.totalTokens !== "number")
        return undefined;
    return Number.isFinite(measurement.totalTokens) ? measurement.totalTokens : undefined;
}
export function sessionsService(ctx) {
    const service = resolveContextService(ctx, "sessions");
    if (!mutableService(service) || typeof service.get !== "function")
        return undefined;
    return {
        get(id) {
            const value = Reflect.apply(service.get, service, [id]);
            return value instanceof Session ? value : undefined;
        },
    };
}
export function sessionFor(ctx, sessionId) {
    return sessionId
        ? sessionsService(ctx)?.get(SessionId(sessionId))
        : undefined;
}
export function readWebSearchProvider(ctx) {
    const web = resolveContextService(ctx, "web");
    if (!mutableService(web))
        return undefined;
    try {
        return Reflect.get(web, "searchProviderId");
    }
    catch {
        return undefined;
    }
}
export function writeWebSearchProvider(ctx, providerId) {
    const web = resolveContextService(ctx, "web");
    if (!mutableService(web))
        return false;
    try {
        if (!Reflect.set(web, "searchProviderId", providerId))
            return false;
        return Reflect.get(web, "searchProviderId") === providerId;
    }
    catch {
        return false;
    }
}
export function contextService(ctx, name) {
    if (!mutableService(ctx))
        return undefined;
    const get = ctx.get;
    return ((typeof get === "function" ? Reflect.apply(get, ctx, [name]) : undefined) ??
        ctx[name]);
}
export function resolveContextService(ctx, name) {
    try {
        return contextService(ctx, name);
    }
    catch {
        return undefined;
    }
}
export function resolveScopedService(agent, name) {
    return resolveContextService(agentLike(agent)?.ctx, name);
}
export function resolveAgentService(ctx, agent, name) {
    const agentPresets = resolveContextService(ctx, "agentPresets");
    if (!mutableService(agentPresets) ||
        typeof agentPresets.serviceFor !== "function")
        return undefined;
    try {
        return Reflect.apply(agentPresets.serviceFor, agentPresets, [agent, name]);
    }
    catch {
        return undefined;
    }
}
export function concreteService(value) {
    if (!mutableService(value))
        return value;
    try {
        return value[cordisSymbols.original] ?? value;
    }
    catch {
        return value;
    }
}
export function compactionPatchCandidate(value, records) {
    const compaction = concreteService(value);
    if (!mutableService(compaction) ||
        typeof compaction.compactIfNeeded !== "function" ||
        records.has(compaction))
        return undefined;
    let originalOwnDescriptor;
    try {
        originalOwnDescriptor = Object.getOwnPropertyDescriptor(compaction, "compactIfNeeded");
    }
    catch {
        return undefined;
    }
    return {
        compaction: compaction,
        original: compaction.compactIfNeeded,
        originalOwnDescriptor,
    };
}
function inheritedPropertyDescriptor(target, key) {
    try {
        for (let current = Object.getPrototypeOf(target); current; current = Object.getPrototypeOf(current)) {
            const descriptor = Object.getOwnPropertyDescriptor(current, key);
            if (descriptor)
                return descriptor;
        }
    }
    catch { }
    return undefined;
}
function sameDataDescriptor(left, right) {
    return (left !== undefined &&
        "value" in left &&
        "value" in right &&
        left.value === right.value &&
        left.writable === right.writable &&
        left.enumerable === right.enumerable &&
        left.configurable === right.configurable);
}
export function installCompactionPatch(records, candidate, mutex, policyScope, lifecycle, behavior) {
    const { compaction, original, originalOwnDescriptor } = candidate;
    if (originalOwnDescriptor &&
        (!("value" in originalOwnDescriptor) || originalOwnDescriptor.writable !== true))
        return false;
    if (!originalOwnDescriptor) {
        const inherited = inheritedPropertyDescriptor(compaction, "compactIfNeeded");
        if (!inherited || !("value" in inherited) || inherited.writable !== true)
            return false;
    }
    const callOriginal = async (agent, trigger, signal) => {
        const result = Reflect.apply(original, compaction, [agent, trigger, signal]);
        return Promise.resolve(result);
    };
    const wrapper = async function (agent, trigger, signal) {
        return behavior(agent, trigger, signal, (activeSignal) => callOriginal(agent, trigger, activeSignal));
    };
    const installedOwnDescriptor = originalOwnDescriptor
        ? { ...originalOwnDescriptor, value: wrapper }
        : {
            configurable: true,
            enumerable: true,
            writable: true,
            value: wrapper,
        };
    try {
        Object.defineProperty(compaction, "compactIfNeeded", installedOwnDescriptor);
    }
    catch {
        return false;
    }
    if (!sameDataDescriptor(Object.getOwnPropertyDescriptor(compaction, "compactIfNeeded"), installedOwnDescriptor)) {
        try {
            if (originalOwnDescriptor)
                Object.defineProperty(compaction, "compactIfNeeded", originalOwnDescriptor);
            else
                Reflect.deleteProperty(compaction, "compactIfNeeded");
        }
        catch { }
        return false;
    }
    records.set(compaction, {
        compaction,
        original,
        originalOwnDescriptor,
        installedOwnDescriptor,
        wrapper,
        mutex,
        policyScope,
        lifecycle,
    });
    return true;
}
export function restoreCompactionPatches(records, entries = records.values()) {
    for (const record of entries) {
        const current = Object.getOwnPropertyDescriptor(record.compaction, "compactIfNeeded");
        if (!sameDataDescriptor(current, record.installedOwnDescriptor))
            continue;
        try {
            if (record.originalOwnDescriptor)
                Object.defineProperty(record.compaction, "compactIfNeeded", record.originalOwnDescriptor);
            else
                Reflect.deleteProperty(record.compaction, "compactIfNeeded");
        }
        catch { }
    }
    records.clear();
}
export function toolResultPrunerState(value) {
    const pruner = concreteService(value);
    return mutableService(pruner)
        ? { pruner: pruner, original: pruner.pruneSession }
        : { pruner: undefined, original: undefined };
}
export function patchToolResultPruner(state, replacement) {
    if (!state.pruner || typeof state.original !== "function")
        return undefined;
    state.pruner.pruneSession = replacement;
    return { pruner: state.pruner, original: state.original, replacement };
}
export function restoreToolResultPruner(record) {
    if (record && record.pruner.pruneSession === record.replacement) {
        try {
            record.pruner.pruneSession = record.original;
        }
        catch { }
    }
}
export function compactionConfigState(service) {
    return mutableService(service)
        ? { service: service, original: service.config }
        : { service: undefined, original: undefined };
}
export function patchCompactionConfig(state, createConfig) {
    if (!state.original ||
        !state.service ||
        !Object.prototype.hasOwnProperty.call(state.service, "config"))
        return undefined;
    try {
        const installed = createConfig(state.original);
        state.service.config = installed;
        return { service: state.service, original: state.original, installed };
    }
    catch {
        return undefined;
    }
}
export function restoreCompactionConfig(record) {
    if (record && record.service.config === record.installed) {
        try {
            record.service.config = record.original;
        }
        catch { }
    }
}
export function patchVisibleWebSearchTimeout(agent, getTimeoutMs, patchedDefinitions) {
    const tools = resolveScopedService(agent, "tools");
    if (!mutableService(tools) || typeof tools.get !== "function")
        return;
    const definition = Reflect.apply(tools.get, tools, ["web_search", agent]);
    if (!mutableService(definition))
        return;
    if (!patchedDefinitions.has(definition))
        patchedDefinitions.set(definition, definition.timeoutMs);
    const timeoutMs = getTimeoutMs();
    const target = timeoutMs === undefined ? patchedDefinitions.get(definition) : timeoutMs;
    try {
        definition.timeoutMs = target;
    }
    catch { }
}
export function refreshVisibleWebSearchTimeouts(patchedDefinitions, timeoutMs) {
    for (const [definition, original] of patchedDefinitions) {
        try {
            definition.timeoutMs = timeoutMs === undefined ? original : timeoutMs;
        }
        catch { }
    }
}
export function restoreVisibleWebSearchTimeouts(patchedDefinitions) {
    for (const [definition, original] of patchedDefinitions) {
        try {
            if (original === undefined)
                delete definition.timeoutMs;
            else
                definition.timeoutMs = original;
        }
        catch { }
    }
    patchedDefinitions.clear();
}
