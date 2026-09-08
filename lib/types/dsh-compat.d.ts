import { Session, type SessionStore } from "@deepseek-ai/dsh-session";
import type { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { ServiceMutex } from "./service-mutex.js";
type CompatMethod = (this: object, agent: unknown, trigger: string, signal: AbortSignal) => Promise<unknown>;
type PrunerMethod = (...args: unknown[]) => unknown;
type MutableService = Record<PropertyKey, unknown>;
interface CompactionService extends MutableService {
    compactIfNeeded: CompatMethod;
}
export interface CompactionPatchRecord {
    compaction: CompactionService;
    original: CompatMethod;
    wrapper: CompatMethod;
    mutex: ServiceMutex;
    lifecycle: AbortController;
}
export type CompactionPatchRecords = Map<object, CompactionPatchRecord>;
export type CompactionPatchBehavior = (agent: unknown, trigger: string, signal: AbortSignal, callOriginal: (signal: AbortSignal) => Promise<unknown>) => Promise<unknown>;
interface PrunerService extends MutableService {
    pruneSession: unknown;
}
export interface PrunerPatchRecord {
    pruner: PrunerService;
    original: unknown;
    replacement: PrunerMethod;
}
interface ConfigService extends MutableService {
    config: unknown;
}
export interface ConfigPatchRecord {
    service: ConfigService;
    original: unknown;
    installed: unknown;
}
export declare function agentSessionId(agent: unknown): string;
export declare function agentUsesSession(agent: unknown, session: Session): boolean;
export declare function sessionFromAgent(agent: unknown): Session | undefined;
export declare function readAgentRouteState(agent: unknown): {
    requestConfig: unknown;
    options: unknown;
    sessionId: string;
};
export declare function scopedToolRuntime(agent: unknown): (Pick<ToolRuntime, "register"> & Partial<Pick<ToolRuntime, "get">>) | undefined;
export declare function tokenMeterTotal(value: unknown, session: Session): number | undefined;
export declare function sessionsService(ctx: unknown): Pick<SessionStore, "get"> | undefined;
export declare function sessionFor(ctx: unknown, sessionId: string): Session | undefined;
export declare function readWebSearchProvider(ctx: unknown): unknown;
export declare function writeWebSearchProvider(ctx: unknown, providerId: unknown): boolean;
export declare function contextService(ctx: unknown, name: string): unknown;
export declare function resolveContextService(ctx: unknown, name: string): unknown;
export declare function resolveScopedService(agent: unknown, name: string): unknown;
export declare function resolveAgentService(ctx: unknown, agent: unknown, name: string): unknown;
export declare function concreteService(value: unknown): unknown;
export declare function compactionPatchCandidate(value: unknown, records: ReadonlyMap<object, CompactionPatchRecord>): Pick<CompactionPatchRecord, "compaction" | "original"> | undefined;
export declare function installCompactionPatch(records: CompactionPatchRecords, candidate: Pick<CompactionPatchRecord, "compaction" | "original">, mutex: ServiceMutex, lifecycle: AbortController, behavior: CompactionPatchBehavior): boolean;
export declare function restoreCompactionPatches(records: Map<object, CompactionPatchRecord>, entries?: Iterable<CompactionPatchRecord>): void;
export declare function toolResultPrunerState(value: unknown): {
    pruner: PrunerService | undefined;
    original: unknown;
};
export declare function patchToolResultPruner(state: {
    pruner: PrunerService | undefined;
    original: unknown;
}, replacement: PrunerMethod): PrunerPatchRecord | undefined;
export declare function restoreToolResultPruner(record: PrunerPatchRecord | undefined): void;
export declare function compactionConfigState(service: unknown): {
    service: ConfigService | undefined;
    original: unknown;
};
export declare function patchCompactionConfig(state: {
    service: ConfigService | undefined;
    original: unknown;
}, createConfig: (originalConfig: unknown) => unknown): ConfigPatchRecord | undefined;
export declare function restoreCompactionConfig(record: ConfigPatchRecord | undefined): void;
export declare function patchVisibleWebSearchTimeout(agent: unknown, getTimeoutMs: () => number | undefined, patchedDefinitions: Map<MutableService, unknown>): void;
export declare function refreshVisibleWebSearchTimeouts(patchedDefinitions: ReadonlyMap<MutableService, unknown>, timeoutMs: number | undefined): void;
export declare function restoreVisibleWebSearchTimeouts(patchedDefinitions: Map<MutableService, unknown>): void;
export {};
