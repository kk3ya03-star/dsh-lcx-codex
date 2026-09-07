type Release = () => void;
export declare class ServiceMutex {
    private locked;
    private closed;
    private closeReason?;
    private readonly queue;
    private readonly idleWaiters;
    constructor();
    acquire(signal?: AbortSignal): Promise<Release>;
    release(): void;
    run<T>(signal: AbortSignal | undefined, task: () => T | Promise<T>): Promise<T>;
    close(reason?: Error): Promise<void>;
}
export {};
