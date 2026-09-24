/** Bridge legacy sections and 0.1.7 profile-backed, schema-derived settings. */
interface SettingsService {
    get?: (namespace: string) => unknown;
    describe?: () => Array<{
        ns: string;
        value: unknown;
    }>;
    configure?: (presentation: {
        auto: boolean;
    }, owner?: unknown) => void;
    installSection?: (...args: any[]) => unknown;
}
export declare function readSettingsCompat(service: SettingsService | undefined, namespace: string): unknown;
export declare function installSettingsCompat<T extends object>(ctx: {
    settings: SettingsService;
    fiber?: unknown;
    on: (...args: any[]) => unknown;
}, namespace: string, schema: unknown, defaults: T, hooks: {
    setSource: (source: () => T) => void;
    onChange: () => void;
}): void;
export {};
