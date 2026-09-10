import { createHash } from "node:crypto";
import { JsonStore } from "./json-store.js";
const VERSION = 2;
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
function validFingerprint(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
function validProvenance(value) {
    return isRecord(value) &&
        typeof value.action === "string" && value.action.length > 0 &&
        (value.originKind === "response" || value.originKind === "request" || value.originKind === "legacy-unattributed") &&
        validFingerprint(value.originFingerprint) &&
        (value.artifactFingerprint === undefined || validFingerprint(value.artifactFingerprint));
}
function validRef(refId, value) {
    return isRecord(value) && value.refId === refId && validHttpUrl(value.url) && validProvenance(value.provenance);
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
function validLegacyRef(refId, value) {
    return isRecord(value) && value.refId === refId && validHttpUrl(value.url);
}
function validLegacySession(value) {
    return isRecord(value) &&
        typeof value.routeFingerprint === "string" && value.routeFingerprint.length > 0 &&
        typeof value.updatedAt === "string" && !Number.isNaN(Date.parse(value.updatedAt)) &&
        isRecord(value.refs) && Object.entries(value.refs).every(([refId, ref]) => refId.length > 0 && validLegacyRef(refId, ref));
}
function validLegacyData(data) {
    return isRecord(data) && data.version === 1 && isRecord(data.sessions) &&
        Object.entries(data.sessions).every(([sessionId, session]) => sessionId.length > 0 && validLegacySession(session));
}
function legacyFingerprint(sessionId, routeFingerprint, ref) {
    return createHash("sha256")
        .update(JSON.stringify([sessionId, routeFingerprint, ref.refId, ref.url ?? null]))
        .digest("hex");
}
function migrateLegacyData(data) {
    if (!validLegacyData(data))
        return undefined;
    return {
        version: VERSION,
        sessions: Object.fromEntries(Object.entries(data.sessions).map(([sessionId, session]) => [sessionId, {
                routeFingerprint: session.routeFingerprint,
                updatedAt: session.updatedAt,
                refs: Object.fromEntries(Object.entries(session.refs).map(([refId, ref]) => [refId, {
                        refId,
                        ...(ref.url ? { url: ref.url } : {}),
                        provenance: {
                            action: "legacy-unattributed",
                            originKind: "legacy-unattributed",
                            originFingerprint: legacyFingerprint(sessionId, session.routeFingerprint, ref),
                        },
                    }])),
            }])),
    };
}
function unavailable(refId) {
    return Object.assign(new Error(`Alpha reference is unavailable in this session and route: ${refId}`), {
        code: "LCX_ALPHA_REF_UNAVAILABLE",
    });
}
function collision(refId) {
    return Object.assign(new Error(`Alpha reference collision in this session and route: ${refId}`), {
        code: "LCX_ALPHA_REF_COLLISION",
    });
}
function sameObservation(left, right) {
    return left.refId === right.refId && left.url === right.url &&
        left.provenance.action === right.provenance.action &&
        left.provenance.originKind === right.provenance.originKind &&
        left.provenance.originFingerprint === right.provenance.originFingerprint &&
        left.provenance.artifactFingerprint === right.provenance.artifactFingerprint;
}
export class AlphaRefStore {
    store;
    constructor(file) {
        this.store = new JsonStore(file, () => ({ version: VERSION, sessions: {} }), validData, "LCX_ALPHA_REF_STORE_CORRUPT", migrateLegacyData);
    }
    record(sessionId, routeFingerprint, refs) {
        if (typeof sessionId !== "string" || !sessionId || typeof routeFingerprint !== "string" || !routeFingerprint || !Array.isArray(refs)) {
            throw unavailable("invalid-record");
        }
        this.store.update((current) => {
            const previous = current.sessions[sessionId];
            const sameRoute = previous?.routeFingerprint === routeFingerprint;
            const nextRefs = { ...(sameRoute ? previous.refs : {}) };
            let changed = !sameRoute;
            for (const value of refs) {
                if (!isRecord(value) || typeof value.refId !== "string" || !value.refId)
                    throw unavailable("invalid-record");
                const accepted = nextRefs[value.refId];
                if (!validHttpUrl(value.url) || !validProvenance(value.provenance)) {
                    if (accepted)
                        throw collision(value.refId);
                    throw unavailable("invalid-record");
                }
                const observation = {
                    refId: value.refId,
                    ...(value.url ? { url: value.url } : {}),
                    provenance: { ...value.provenance },
                };
                if (accepted) {
                    if (!sameObservation(accepted, observation))
                        throw collision(observation.refId);
                    continue;
                }
                nextRefs[observation.refId] = observation;
                changed = true;
            }
            if (!changed && previous)
                return current;
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
