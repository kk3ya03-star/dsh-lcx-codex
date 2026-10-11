import type { Model } from "@earendil-works/pi-ai";
/**
 * What LCX knows about a route model when the provider profile does not say. DSH does not hand the resolved
 * Pi model (protocol, endpoint, compat) to plugins: `llm.resolveModelInfo` carries only identity, input
 * modalities, context window, reasoning efforts and the system-prompt / tool update modes. So the protocol
 * and the wire capabilities are re-derived the way `dsh-llm-pi-ai` derives them from the same Pi catalog,
 * in the same order, and anything DSH does declare (see `resolveRouteModelFacts`) is applied over it:
 *
 *   1. `catalog-model`            the provider's own catalog entry for this exact model id (any protocol);
 *   2. `catalog-provider-default` a model the catalog has not caught up with, which DSH serves anyway
 *                                 (the profile lists it in `models`, or DSH's own newer catalog resolves it), takes the one
 *                                 protocol (and endpoint) every model the provider ships agrees on, exactly
 *                                 as `dsh-llm-pi-ai` does for a newer model of an installed catalog route;
 *   3. `frozen-pi086`             last fallback only: the frozen Pi 0.86 allowlist says the pair was a
 *                                 Responses model, which is all it can say (no endpoint, no capabilities).
 */
export type CatalogModelSource = "catalog-model" | "catalog-provider-default" | "frozen-pi086" | "unknown";
export type CatalogModelFacts = {
    source: CatalogModelSource;
    /** The wire protocol DSH would resolve for this model when the profile names none. */
    api: string | undefined;
    /** The endpoint DSH would resolve for this model when the profile names none. */
    baseUrl: string | undefined;
    /** The exact catalog entry, only when it is an `openai-responses` model (descriptor, compat, reasoning map). */
    descriptor: Model<"openai-responses"> | undefined;
};
/**
 * Resolve a route model's protocol, endpoint and catalog descriptor from the bundled Pi catalog.
 * @param dshServes DSH serves this model although the bundled catalog does not describe it: the provider profile
 *   lists it in `models`, or DSH's own catalog resolves it (`resolveModelInfo` succeeds). Only then may the
 *   provider-wide default apply.
 */
export declare function resolveCatalogModel(provider: unknown, modelId: unknown, dshServes?: boolean): CatalogModelFacts;
