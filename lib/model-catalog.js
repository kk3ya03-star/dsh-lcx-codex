import { getCatalogModels } from "./pi-responses-runtime.js";
import { wasPi086ResponsesModel } from "./pi086-responses-allowlist.js";
const providerDefaultsCache = new Map();
function sharedValue(values) {
    const distinct = new Set(values);
    const [only] = distinct;
    return distinct.size === 1 && typeof only === "string" && only.length > 0 ? only : undefined;
}
function providerDefaults(provider) {
    const cached = providerDefaultsCache.get(provider);
    if (cached !== undefined)
        return cached;
    const models = getCatalogModels(provider);
    const defaults = {
        api: sharedValue(models.map((model) => model.api)),
        baseUrl: sharedValue(models.map((model) => model.baseUrl)),
    };
    providerDefaultsCache.set(provider, defaults);
    return defaults;
}
/**
 * Resolve a route model's protocol, endpoint and catalog descriptor from the bundled Pi catalog.
 * @param dshServes DSH serves this model although the bundled catalog does not describe it: the provider profile
 *   lists it in `models`, or DSH's own catalog resolves it (`resolveModelInfo` succeeds). Only then may the
 *   provider-wide default apply.
 */
export function resolveCatalogModel(provider, modelId, dshServes = false) {
    const providerName = String(provider ?? "");
    const id = String(modelId ?? "");
    const exact = getCatalogModels(providerName).find((model) => model.id === id);
    if (exact !== undefined)
        return {
            source: "catalog-model",
            api: exact.api,
            baseUrl: exact.baseUrl,
            descriptor: exact.api === "openai-responses" ? exact : undefined,
        };
    const defaults = providerDefaults(providerName);
    if (dshServes && defaults.api !== undefined)
        return {
            source: "catalog-provider-default",
            api: defaults.api,
            baseUrl: defaults.baseUrl,
            descriptor: undefined,
        };
    if (wasPi086ResponsesModel(providerName, id))
        return { source: "frozen-pi086", api: "openai-responses", baseUrl: undefined, descriptor: undefined };
    return { source: "unknown", api: undefined, baseUrl: undefined, descriptor: undefined };
}
