type Release = () => void;

interface Waiter {
  resolve: (release: Release) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

function abortReason(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("The operation was aborted", "AbortError");
}

export class ServiceMutex {
  private locked = false;
  private closed = false;
  private closeReason?: Error;
  private readonly queue: Waiter[] = [];
  private readonly idleWaiters: Array<() => void> = [];

  constructor() {}

  acquire(signal?: AbortSignal): Promise<Release> {
    if (this.closed)
      return Promise.reject(
        this.closeReason ?? new Error("service mutex closed"),
      );
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(() => this.release());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      if (signal) {
        const onAbort = () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          signal.removeEventListener("abort", onAbort);
          reject(abortReason(signal));
        };
        waiter.onAbort = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.queue.push(waiter);
    });
  }

  release(): void {
    while (this.queue.length > 0) {
      const waiter = this.queue.shift();
      if (!waiter) continue;
      if (waiter.signal && waiter.onAbort)
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      if (waiter.signal?.aborted) {
        waiter.reject(abortReason(waiter.signal));
        continue;
      }
      waiter.resolve(() => this.release());
      return;
    }
    this.locked = false;
    const idle = this.idleWaiters.splice(0);
    for (const resolve of idle) resolve();
  }

  async run<T>(
    signal: AbortSignal | undefined,
    task: () => T | Promise<T>,
  ): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await task();
    } finally {
      release();
    }
  }

  close(reason = new Error("service mutex closing")): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.closeReason = reason;
      const queued = this.queue.splice(0);
      for (const waiter of queued) {
        if (waiter.signal && waiter.onAbort)
          waiter.signal.removeEventListener("abort", waiter.onAbort);
        waiter.reject(reason);
      }
    }
    if (!this.locked) return Promise.resolve();
    return new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }
}
