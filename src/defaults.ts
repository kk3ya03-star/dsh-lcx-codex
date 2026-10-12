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

export const DEFAULTS: Defaults = Object.freeze({
  requestTimeoutMs: 300_000,
  streamIdleTimeoutMs: 300_000,
  maxResponseBytes: 8 * 1024 * 1024,
  maxAttempts: 3,
  maxAttemptsCap: 6,
  alphaMaxOutputTokens: 2500,
  alphaMaxOutputTokensCap: 32_000,
  webMaxResults: 8,
  webSearchProvider: "lcx-responses",
  portableReplayMaxChars: 80_000,
  nativeRetentionTokenBudget: 64_000,
  assistantRetentionTokenReserve: 24_000,
  assistantRetentionPerMessageTokenCap: 3_000,
});
