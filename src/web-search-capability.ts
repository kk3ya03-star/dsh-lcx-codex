import { createHash } from "node:crypto";
import { ALPHA_ACTIONS, ALPHA_PROBE_VERSION, ALPHA_SEARCH_PARAMETERS } from "./web-search-alpha.js";
import { JsonStore } from "./json-store.js";

const VERSION = 1;
const CLASSIFICATIONS = new Set(["native", "command-capable", "emulated-search-only", "unsupported", "unknown"] as const);
const ACTION_STATES = new Set(["supported", "unsupported", "unknown"] as const);
type Classification = "native" | "command-capable" | "emulated-search-only" | "unsupported" | "unknown";
type ActionState = "supported" | "unsupported" | "unknown";
type Provenance = "trusted-native" | "unavailable";
type RecordValue = Record<string, unknown>;

export interface AlphaCapabilityRecord {
  classification: Classification;
  actions: Record<string, ActionState>;
  probedAt: string;
  schemaFingerprint: string;
  probeVersion?: number;
  provenance?: Provenance;
}
interface CapabilityData { version: typeof VERSION; capabilities: Record<string, AlphaCapabilityRecord> }

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isClassification(value: unknown): value is Classification { return typeof value === "string" && CLASSIFICATIONS.has(value as Classification); }
function isActionState(value: unknown): value is ActionState { return typeof value === "string" && ACTION_STATES.has(value as ActionState); }
function isProvenance(value: unknown): value is Provenance { return value === "trusted-native" || value === "unavailable"; }
function isPositiveSafeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }

function validRecord(record: unknown): record is AlphaCapabilityRecord {
  if (!isRecord(record) || !isClassification(record.classification) || !isRecord(record.actions) ||
    !Object.values(record.actions).every(isActionState) || typeof record.probedAt !== "string" ||
    Number.isNaN(Date.parse(record.probedAt)) || typeof record.schemaFingerprint !== "string" || !record.schemaFingerprint ||
    (record.probeVersion !== undefined && !isPositiveSafeInteger(record.probeVersion)) ||
    (record.provenance !== undefined && !isProvenance(record.provenance))) return false;
  return record.classification !== "native" || record.provenance === "trusted-native";
}

function validData(data: unknown): data is CapabilityData {
  return isRecord(data) && data.version === VERSION && isRecord(data.capabilities) &&
    Object.entries(data.capabilities).every(([key, value]) => /^[a-f0-9]{64}$/u.test(key) && validRecord(value));
}

export function alphaCapabilityFingerprint(config: Record<string, unknown>): string {
  const rawBaseURL = String(config.baseURL ?? "").replace(/\/+$/u, "");
  let baseURL = rawBaseURL;
  try { const url = new URL(rawBaseURL); url.hash = ""; baseURL = url.toString().replace(/\/+$/u, ""); } catch {}
  return createHash("sha256").update(JSON.stringify({
    baseURL,
    provider: String(config.provider ?? ""),
    model: String(config.model ?? ""),
    profile: String(config.profile ?? ""),
    group: String(config.group ?? ""),
    schemaFingerprint: String(config.schemaFingerprint ?? ""),
  }), "utf8").digest("hex");
}

export function alphaCapabilityUsable(record: unknown): boolean {
  return validRecord(record) && record.probeVersion === ALPHA_PROBE_VERSION &&
    (record.classification === "native" || record.classification === "command-capable");
}

export function alphaActionState(record: unknown, action: unknown): ActionState | undefined {
  if (!validRecord(record) || typeof action !== "string" || !action) return undefined;
  const state = record.actions[action];
  return isActionState(state) ? state : undefined;
}

export function assertAlphaActionAllowed(record: unknown, action: unknown): void {
  if (alphaActionState(record, action) === "unsupported") {
    throw Object.assign(
      new Error(`Alpha action is unsupported for this verified route: ${String(action)}`),
      { code: "LCX_ALPHA_ACTION_UNSUPPORTED" },
    );
  }
}

export function alphaAdvertisedActions(record: unknown): string[] {
  if (!validRecord(record)) return [...ALPHA_ACTIONS];
  return ALPHA_ACTIONS.filter((action) => record.actions[action] !== "unsupported");
}

export function alphaSearchParametersFor(record: unknown) {
  return {
    ...ALPHA_SEARCH_PARAMETERS,
    properties: {
      ...ALPHA_SEARCH_PARAMETERS.properties,
      action: { type: "string" as const, enum: alphaAdvertisedActions(record) },
    },
  };
}

export class AlphaCapabilityStore {
  readonly store: JsonStore<CapabilityData>;

  constructor(file: string) {
    this.store = new JsonStore(file, () => ({ version: VERSION, capabilities: {} }), validData, "LCX_ALPHA_CAPABILITY_STORE_CORRUPT");
  }

  get(fingerprint: string): AlphaCapabilityRecord | undefined {
    this.store.refresh();
    const value = this.store.data.capabilities[fingerprint];
    return value?.probeVersion === ALPHA_PROBE_VERSION ? structuredClone(value) : undefined;
  }

  put(fingerprint: unknown, record: unknown): void {
    if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(fingerprint) || !validRecord(record) || record.probeVersion !== ALPHA_PROBE_VERSION) {
      throw Object.assign(new Error("Invalid Alpha capability record"), { code: "LCX_ALPHA_CAPABILITY_INVALID" });
    }
    this.store.update((current) => ({
      version: VERSION,
      capabilities: { ...current.capabilities, [fingerprint]: structuredClone(record) },
    }));
  }
}
