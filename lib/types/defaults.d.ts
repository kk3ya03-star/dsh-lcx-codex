/**
 * The numeric defaults of the plugin settings and transports, defined once. The settings schema, its
 * normalization, the transports and the checkpoint retention all read these values.
 */
export interface Defaults {
    readonly requestTimeoutMs: number;
    readonly streamIdleTimeoutMs: number;
    readonly maxResponseBytes: number;
    readonly maxAttempts: number;
    readonly maxAttemptsCap: number;
    readonly alphaMaxOutputTokens: number;
    readonly alphaMaxOutputTokensCap: number;
    readonly webMaxResults: number;
    readonly webSearchProvider: string;
    readonly portableReplayMaxChars: number;
    readonly nativeRetentionTokenBudget: number;
    readonly assistantRetentionTokenReserve: number;
    readonly assistantRetentionPerMessageTokenCap: number;
}
export declare const DEFAULTS: Defaults;
