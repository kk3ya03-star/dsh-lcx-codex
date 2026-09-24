export function readSettingsCompat(service, namespace) {
    if (typeof service?.get === "function")
        return service.get(namespace);
    return service?.describe?.().find(row => row.ns === namespace)?.value;
}
export function installSettingsCompat(ctx, namespace, schema, defaults, hooks) {
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
    ctx.on("settings/document-updated", (changed) => {
        if (changed === namespace)
            hooks.onChange();
    });
    hooks.onChange();
}
