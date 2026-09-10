type PolicyKey = "config" | "pruneSession";
type AccessMode = "shared" | "exclusive";
export declare class InvocationPolicyScope {
    private readonly records;
    private readonly queue;
    private readonly idleWaiters;
    private sharedActive;
    private exclusiveActive;
    private closed;
    private closeReason?;
    ensure(target: object | undefined, key: PolicyKey): boolean;
    private acquire;
    private release;
    private flushQueue;
    private resolveIdle;
    run<T>(signal: AbortSignal | undefined, mode: AccessMode, task: () => T | Promise<T>): Promise<T>;
    close(reason?: Error): Promise<void>;
    restore(): void;
}
export {};
