import { createHash } from "node:crypto";
import { ALPHA_PROBE_VERSION } from "./web-search-alpha.js";
import { JsonStore } from "./json-store.js";
const VERSION = 1;
const CLASSIFICATIONS = new Set(["native", "command-capable", "emulated-search-only", "unsupported", "unknown"]);
const ACTION_STATES = new Set(["supported", "unsupported", "unknown"]);
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isClassification(value) { return typeof value === "string" && CLASSIFICATIONS.has(value); }
function isActionState(value) { return typeof value === "string" && ACTION_STATES.has(value); }
function isProvenance(value) { return value === "trusted-native" || value === "unavailable"; }
function isPositiveSafeInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function validRecord(record) {
    if (!isRecord(record) || !isClassification(record.classification) || !isRecord(record.actions) ||
        !Object.values(record.actions).every(isActionState) || typeof record.probedAt !== "string" ||
        Number.isNaN(Date.parse(record.probedAt)) || typeof record.schemaFingerprint !== "string" || !record.schemaFingerprint ||
        (record.probeVersion !== undefined && !isPositiveSafeInteger(record.probeVersion)) ||
        (record.provenance !== undefined && !isProvenance(record.provenance)))
        return false;
    return record.classification !== "native" || record.provenance === "trusted-native";
}
function validData(data) {
    return isRecord(data) && data.version === VERSION && isRecord(data.capabilities) &&
        Object.entries(data.capabilities).every(([key, value]) => /^[a-f0-9]{64}$/u.test(key) && validRecord(value));
}
export function alphaCapabilityFingerprint(config) {
    const rawBaseURL = String(config.baseURL ?? "").replace(/\/+$/u, "");
    let baseURL = rawBaseURL;
    try {
        const url = new URL(rawBaseURL);
        url.hash = "";
        baseURL = url.toString().replace(/\/+$/u, "");
    }
    catch { }
    return createHash("sha256").update(JSON.stringify({
        baseURL,
        provider: String(config.provider ?? ""),
        model: String(config.model ?? ""),
        profile: String(config.profile ?? ""),
        group: String(config.group ?? ""),
        schemaFingerprint: String(config.schemaFingerprint ?? ""),
    }), "utf8").digest("hex");
}
export function alphaCapabilityUsable(record) {
    return validRecord(record) && record.probeVersion === ALPHA_PROBE_VERSION &&
        (record.classification === "native" || record.classification === "command-capable");
}
export class AlphaCapabilityStore {
    store;
    constructor(file) {
        this.store = new JsonStore(file, () => ({ version: VERSION, capabilities: {} }), validData, "LCX_ALPHA_CAPABILITY_STORE_CORRUPT");
    }
    get(fingerprint) {
        this.store.refresh();
        const value = this.store.data.capabilities[fingerprint];
        return value?.probeVersion === ALPHA_PROBE_VERSION ? structuredClone(value) : undefined;
    }
    put(fingerprint, record) {
        if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(fingerprint) || !validRecord(record) || record.probeVersion !== ALPHA_PROBE_VERSION) {
            throw Object.assign(new Error("Invalid Alpha capability record"), { code: "LCX_ALPHA_CAPABILITY_INVALID" });
        }
        this.store.update((current) => ({
            version: VERSION,
            capabilities: { ...current.capabilities, [fingerprint]: structuredClone(record) },
        }));
    }
}
