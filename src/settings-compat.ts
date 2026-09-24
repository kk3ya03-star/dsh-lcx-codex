/** Bridge legacy sections and 0.1.7 profile-backed, schema-derived settings. */
interface SettingsService {
  get?: (namespace: string) => unknown;
  describe?: () => Array<{ ns: string; value: unknown }>;
  configure?: (presentation: { auto: boolean }, owner?: unknown) => void;
  installSection?: (...args: any[]) => unknown;
}
export function readSettingsCompat(service: SettingsService | undefined, namespace: string): unknown {
  if (typeof service?.get === "function") return service.get(namespace);
  return service?.describe?.().find(row => row.ns === namespace)?.value;
}
export function installSettingsCompat<T extends object>(
  ctx: { settings: SettingsService; fiber?: unknown; on: (...args: any[]) => unknown },
  namespace: string,
  schema: unknown,
  defaults: T,
  hooks: { setSource: (source: () => T) => void; onChange: () => void },
): void {
  if (typeof ctx.settings.installSection === "function") {
    ctx.settings.installSection(ctx, namespace, schema, defaults, hooks);
    return;
  }
  if (typeof ctx.settings.describe !== "function" || typeof ctx.settings.configure !== "function") {
    throw new Error("LCX requires legacy settings sections or profile-backed settings forms");
  }
  ctx.settings.configure({ auto: false }, ctx.fiber);
  hooks.setSource(() => {
    const value = readSettingsCompat(ctx.settings, namespace);
    return value !== null && typeof value === "object" ? { ...defaults, ...value } : defaults;
  });
  ctx.on("settings/document-updated", (changed: string) => {
    if (changed === namespace) hooks.onChange();
  });
  hooks.onChange();
}
