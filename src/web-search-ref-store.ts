import { createHash } from "node:crypto";
import { JsonStore } from "./json-store.js";

const VERSION = 2;

type RecordValue = Record<string, unknown>;
export interface AlphaRefProvenance {
  action: string;
  originKind: "response" | "request" | "legacy-unattributed";
  originFingerprint: string;
  artifactFingerprint?: string;
}
export interface AlphaRefRecord { refId: string; url?: string; provenance: AlphaRefProvenance }
interface SessionRecord { routeFingerprint: string; updatedAt: string; refs: Record<string, AlphaRefRecord> }
interface RefStoreData { version: typeof VERSION; sessions: Record<string, SessionRecord> }
interface LegacyRefRecord { refId: string; url?: string }
interface LegacySessionRecord { routeFingerprint: string; updatedAt: string; refs: Record<string, LegacyRefRecord> }
interface LegacyRefStoreData { version: 1; sessions: Record<string, LegacySessionRecord> }

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validHttpUrl(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validProvenance(value: unknown): value is AlphaRefProvenance {
  return isRecord(value) &&
    typeof value.action === "string" && value.action.length > 0 &&
    (value.originKind === "response" || value.originKind === "request" || value.originKind === "legacy-unattributed") &&
    validFingerprint(value.originFingerprint) &&
    (value.artifactFingerprint === undefined || validFingerprint(value.artifactFingerprint));
}

function validRef(refId: string, value: unknown): value is AlphaRefRecord {
  return isRecord(value) && value.refId === refId && validHttpUrl(value.url) && validProvenance(value.provenance);
}

function validSession(value: unknown): value is SessionRecord {
  return isRecord(value) &&
    typeof value.routeFingerprint === "string" && value.routeFingerprint.length > 0 &&
    typeof value.updatedAt === "string" && !Number.isNaN(Date.parse(value.updatedAt)) &&
    isRecord(value.refs) && Object.entries(value.refs).every(([refId, ref]) => refId.length > 0 && validRef(refId, ref));
}

function validData(data: unknown): data is RefStoreData {
  return isRecord(data) && data.version === VERSION && isRecord(data.sessions) &&
    Object.entries(data.sessions).every(([sessionId, session]) => sessionId.length > 0 && validSession(session));
}

function validLegacyRef(refId: string, value: unknown): value is LegacyRefRecord {
  return isRecord(value) && value.refId === refId && validHttpUrl(value.url);
}

function validLegacySession(value: unknown): value is LegacySessionRecord {
  return isRecord(value) &&
    typeof value.routeFingerprint === "string" && value.routeFingerprint.length > 0 &&
    typeof value.updatedAt === "string" && !Number.isNaN(Date.parse(value.updatedAt)) &&
    isRecord(value.refs) && Object.entries(value.refs).every(([refId, ref]) => refId.length > 0 && validLegacyRef(refId, ref));
}

function validLegacyData(data: unknown): data is LegacyRefStoreData {
  return isRecord(data) && data.version === 1 && isRecord(data.sessions) &&
    Object.entries(data.sessions).every(([sessionId, session]) => sessionId.length > 0 && validLegacySession(session));
}

function legacyFingerprint(sessionId: string, routeFingerprint: string, ref: LegacyRefRecord): string {
  return createHash("sha256")
    .update(JSON.stringify([sessionId, routeFingerprint, ref.refId, ref.url ?? null]))
    .digest("hex");
}

function migrateLegacyData(data: unknown): RefStoreData | undefined {
  if (!validLegacyData(data)) return undefined;
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

function unavailable(refId: string): Error & { code: string } {
  return Object.assign(new Error(`Alpha reference is unavailable in this session and route: ${refId}`), {
    code: "LCX_ALPHA_REF_UNAVAILABLE",
  });
}

function collision(refId: string): Error & { code: string } {
  return Object.assign(new Error(`Alpha reference collision in this session and route: ${refId}`), {
    code: "LCX_ALPHA_REF_COLLISION",
  });
}

function sameObservation(left: AlphaRefRecord, right: AlphaRefRecord): boolean {
  return left.refId === right.refId && left.url === right.url &&
    left.provenance.action === right.provenance.action &&
    left.provenance.originKind === right.provenance.originKind &&
    left.provenance.originFingerprint === right.provenance.originFingerprint &&
    left.provenance.artifactFingerprint === right.provenance.artifactFingerprint;
}

export class AlphaRefStore {
  readonly store: JsonStore<RefStoreData>;

  constructor(file: string) {
    this.store = new JsonStore(file, () => ({ version: VERSION, sessions: {} }), validData, "LCX_ALPHA_REF_STORE_CORRUPT", migrateLegacyData);
  }

  record(sessionId: unknown, routeFingerprint: unknown, refs: unknown): void {
    if (typeof sessionId !== "string" || !sessionId || typeof routeFingerprint !== "string" || !routeFingerprint || !Array.isArray(refs)) {
      throw unavailable("invalid-record");
    }
    this.store.update((current) => {
      const previous = current.sessions[sessionId];
      const sameRoute = previous?.routeFingerprint === routeFingerprint;
      const nextRefs: Record<string, AlphaRefRecord> = { ...(sameRoute ? previous.refs : {}) };
      let changed = !sameRoute;
      for (const value of refs) {
        if (!isRecord(value) || typeof value.refId !== "string" || !value.refId) throw unavailable("invalid-record");
        const accepted = nextRefs[value.refId];
        if (!validHttpUrl(value.url) || !validProvenance(value.provenance)) {
          if (accepted) throw collision(value.refId);
          throw unavailable("invalid-record");
        }
        const observation: AlphaRefRecord = {
          refId: value.refId,
          ...(value.url ? { url: value.url } : {}),
          provenance: { ...value.provenance },
        };
        if (accepted) {
          if (!sameObservation(accepted, observation)) throw collision(observation.refId);
          continue;
        }
        nextRefs[observation.refId] = observation;
        changed = true;
      }
      if (!changed && previous) return current;
      const sessions: Record<string, SessionRecord> = {
        ...current.sessions,
        [sessionId]: { routeFingerprint, refs: nextRefs, updatedAt: new Date().toISOString() },
      };
      const ordered = Object.entries(sessions)
        .sort((left, right) => Date.parse(right[1].updatedAt) - Date.parse(left[1].updatedAt))
        .slice(0, 256);
      return { version: VERSION, sessions: Object.fromEntries(ordered) };
    });
  }

  assertUsable(sessionId: unknown, routeFingerprint: unknown, refId: unknown): AlphaRefRecord {
    this.store.refresh();
    if (typeof sessionId !== "string" || typeof refId !== "string") throw unavailable(String(refId));
    const session = this.store.data.sessions[sessionId];
    const ref = session?.routeFingerprint === routeFingerprint ? session.refs[refId] : undefined;
    if (!ref) throw unavailable(refId);
    return structuredClone(ref);
  }
}
