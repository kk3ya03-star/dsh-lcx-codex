import type { Message, ToolSchema } from "@deepseek-ai/dsh-llm";
export declare const GROK_NATIVE_SERVER_TOOL_TYPES: Set<string>;
export type GrokNativeSearchState = {
    web: boolean;
    x: boolean;
};
export type GrokNativeReplayRoute = {
    provider: string;
    model: string;
    sessionId: string;
    baseURL: string;
    apiKeyEnv: string;
    headers?: Record<string, string>;
};
type WireTool = Record<string, unknown>;
type WireItem = Record<string, unknown> & {
    type: string;
};
type GrokNativeReplayEnvelope = {
    kind: "xai-responses-native-search";
    version: 3;
    provider: string;
    model: string;
    sourceSessionId: string;
    routeAuthorityFingerprint: string;
    output: WireItem[];
};
export declare function grokNativeReplayRouteFingerprint(route: GrokNativeReplayRoute): string;
export declare function grokNativeSearchEnabled(state: GrokNativeSearchState): boolean;
export declare function grokVisibleFunctionTools(tools: readonly ToolSchema[] | undefined, state?: GrokNativeSearchState): ToolSchema[] | undefined;
export declare function grokWireTools(tools: readonly unknown[] | undefined, state: GrokNativeSearchState): WireTool[];
export declare function createGrokNativeReplayEnvelope(output: readonly unknown[] | undefined, route: GrokNativeReplayRoute | undefined): GrokNativeReplayEnvelope | undefined;
export declare function restoreGrokNativeReplay(input: readonly unknown[], messages: readonly Message[], route: GrokNativeReplayRoute | undefined): unknown[];
export {};
