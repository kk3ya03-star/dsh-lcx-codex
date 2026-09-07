import { JsonStore } from "./json-store.js";
const VERSION = 1;
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validHttpUrl(value) {
    if (value === undefined)
        return true;
    if (typeof value !== "string")
        return false;
    try {
        return ["http:", "https:"].includes(new URL(value).protocol);
    }
    catch {
        return false;
    }
}
function validRef(refId, value) {
    return isRecord(value) && value.refId === refId && validHttpUrl(value.url);
}
function validSession(value) {
    return isRecord(value) &&
        typeof value.routeFingerprint === "string" && value.routeFingerprint.length > 0 &&
        typeof value.updatedAt === "string" && !Number.isNaN(Date.parse(value.updatedAt)) &&
        isRecord(value.refs) && Object.entries(value.refs).every(([refId, ref]) => refId.length > 0 && validRef(refId, ref));
}
function validData(data) {
    return isRecord(data) && data.version === VERSION && isRecord(data.sessions) &&
        Object.entries(data.sessions).every(([sessionId, session]) => sessionId.length > 0 && validSession(session));
}
function unavailable(refId) {
    return Object.assign(new Error(`Alpha reference is unavailable in this session and route: ${refId}`), {
        code: "LCX_ALPHA_REF_UNAVAILABLE",
    });
}
export class AlphaRefStore {
    store;
    constructor(file) {
        this.store = new JsonStore(file, () => ({ version: VERSION, sessions: {} }), validData, "LCX_ALPHA_REF_STORE_CORRUPT");
    }
    record(sessionId, routeFingerprint, refs) {
        if (typeof sessionId !== "string" || !sessionId || typeof routeFingerprint !== "string" || !routeFingerprint || !Array.isArray(refs)) {
            throw unavailable("invalid-record");
        }
        this.store.update((current) => {
            const previous = current.sessions[sessionId];
            const previousRefs = previous?.routeFingerprint === routeFingerprint ? previous.refs : {};
            const nextRefs = { ...previousRefs };
            for (const value of refs) {
                if (!isRecord(value) || typeof value.refId !== "string" || !value.refId || !validHttpUrl(value.url))
                    continue;
                nextRefs[value.refId] = { refId: value.refId, ...(value.url ? { url: value.url } : {}) };
            }
            const sessions = {
                ...current.sessions,
                [sessionId]: { routeFingerprint, refs: nextRefs, updatedAt: new Date().toISOString() },
            };
            const ordered = Object.entries(sessions)
                .sort((left, right) => Date.parse(right[1].updatedAt) - Date.parse(left[1].updatedAt))
                .slice(0, 256);
            return { version: VERSION, sessions: Object.fromEntries(ordered) };
        });
    }
    assertUsable(sessionId, routeFingerprint, refId) {
        this.store.refresh();
        if (typeof sessionId !== "string" || typeof refId !== "string")
            throw unavailable(String(refId));
        const session = this.store.data.sessions[sessionId];
        const ref = session?.routeFingerprint === routeFingerprint ? session.refs[refId] : undefined;
        if (!ref)
            throw unavailable(refId);
        return structuredClone(ref);
    }
}
