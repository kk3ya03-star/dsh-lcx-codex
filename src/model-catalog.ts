import type { Model } from "@earendil-works/pi-ai";
import { getCatalogModels } from "./pi-responses-runtime.js";
import { wasPi086ResponsesModel } from "./pi086-responses-allowlist.js";

/**
 * What LCX knows about a route model when the provider profile does not say. DSH does not hand the resolved
 * Pi model (protocol, endpoint, compat) to plugins: `llm.resolveModelInfo` carries only identity, input
 * modalities, context window, reasoning efforts and the system-prompt / tool update modes. So the protocol
 * and the wire capabilities are re-derived the way `dsh-llm-pi-ai` derives them from the same Pi catalog,
 * in the same order, and anything DSH does declare (see `resolveRouteModelFacts`) is applied over it:
 *
 *   1. `catalog-model`            the provider's own catalog entry for this exact model id (any protocol);
 *   2. `catalog-provider-default` a model the catalog has not caught up with, which the profile declares in
 *                                 its `models` list (DSH serves no other unlisted model), takes the one
 *                                 protocol (and endpoint) every model the provider ships agrees on, exactly
 *                                 as `dsh-llm-pi-ai` does for a newer model of an installed catalog route;
 *   3. `frozen-pi086`             last fallback only: the frozen Pi 0.86 allowlist says the pair was a
 *                                 Responses model, which is all it can say (no endpoint, no capabilities).
 */
export type CatalogModelSource =
  | "catalog-model"
  | "catalog-provider-default"
  | "frozen-pi086"
  | "unknown";

export type CatalogModelFacts = {
  source: CatalogModelSource;
  /** The wire protocol DSH would resolve for this model when the profile names none. */
  api: string | undefined;
  /** The endpoint DSH would resolve for this model when the profile names none. */
  baseUrl: string | undefined;
  /** The exact catalog entry, only when it is an `openai-responses` model (descriptor, compat, reasoning map). */
  descriptor: Model<"openai-responses"> | undefined;
};

type ProviderDefaults = { api: string | undefined; baseUrl: string | undefined };

const providerDefaultsCache = new Map<string, ProviderDefaults>();

function sharedValue(values: readonly (string | undefined)[]): string | undefined {
  const distinct = new Set(values);
  const [only] = distinct;
  return distinct.size === 1 && typeof only === "string" && only.length > 0 ? only : undefined;
}

function providerDefaults(provider: string): ProviderDefaults {
  const cached = providerDefaultsCache.get(provider);
  if (cached !== undefined) return cached;
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
 * @param declaredByProfile the provider profile lists this model in `models`; only then does DSH serve a model
 *   its catalog does not describe, so only then may the provider-wide default apply.
 */
export function resolveCatalogModel(provider: unknown, modelId: unknown, declaredByProfile = false): CatalogModelFacts {
  const providerName = String(provider ?? "");
  const id = String(modelId ?? "");
  const exact = getCatalogModels(providerName).find((model) => model.id === id);
  if (exact !== undefined)
    return {
      source: "catalog-model",
      api: exact.api,
      baseUrl: exact.baseUrl,
      descriptor: exact.api === "openai-responses" ? (exact as Model<"openai-responses">) : undefined,
    };
  const defaults = providerDefaults(providerName);
  if (declaredByProfile && defaults.api !== undefined)
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
