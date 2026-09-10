import { AsyncLocalStorage } from "node:async_hooks";

type MutableTarget = object;
type PolicyKey = "config" | "pruneSession";
type PolicyValues = Map<MutableTarget, Map<PolicyKey, unknown>>;
type AccessMode = "shared" | "exclusive";
type Release = () => void;

interface AccessWaiter {
  mode: AccessMode;
  resolve: (release: Release) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface ProjectionRecord {
  target: MutableTarget;
  key: PolicyKey;
  originalDescriptor: PropertyDescriptor | undefined;
  originalValue: unknown;
  baseValue: unknown;
  owners: Set<InvocationPolicyScope>;
  getter: () => unknown;
  setter: (value: unknown) => void;
}

const activePolicy = new AsyncLocalStorage<PolicyValues>();
const projections = new WeakMap<MutableTarget, Map<PolicyKey, ProjectionRecord>>();

function scopedValue(
  values: PolicyValues | undefined,
  target: MutableTarget,
  key: PolicyKey,
): { found: boolean; value: unknown } {
  const targetValues = values?.get(target);
  return targetValues?.has(key)
    ? { found: true, value: targetValues.get(key) }
    : { found: false, value: undefined };
}

function setScopedValue(
  values: PolicyValues,
  target: MutableTarget,
  key: PolicyKey,
  value: unknown,
): void {
  let targetValues = values.get(target);
  if (!targetValues) {
    targetValues = new Map();
    values.set(target, targetValues);
  }
  targetValues.set(key, value);
}

function inheritedDescriptor(
  target: MutableTarget,
  key: PolicyKey,
): PropertyDescriptor | undefined {
  for (
    let current = Object.getPrototypeOf(target);
    current;
    current = Object.getPrototypeOf(current)
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return descriptor;
  }
  return undefined;
}

function projectionShapeSupported(
  target: MutableTarget,
  key: PolicyKey,
  own: PropertyDescriptor | undefined,
): boolean {
  if (own)
    return own.configurable === true && "value" in own && own.writable === true;
  if (!Object.isExtensible(target)) return false;
  const inherited = inheritedDescriptor(target, key);
  if (!inherited) return true;
  return "value" in inherited
    ? inherited.writable === true
    : typeof inherited.set === "function";
}

function projectionStillInstalled(record: ProjectionRecord): boolean {
  const current = Object.getOwnPropertyDescriptor(record.target, record.key);
  return current?.get === record.getter && current.set === record.setter;
}

function installProjection(
  owner: InvocationPolicyScope,
  target: MutableTarget,
  key: PolicyKey,
): ProjectionRecord | undefined {
  let targetRecords = projections.get(target);
  const existing = targetRecords?.get(key);
  if (existing) {
    if (!projectionStillInstalled(existing)) return undefined;
    existing.owners.add(owner);
    return existing;
  }

  const originalDescriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!projectionShapeSupported(target, key, originalDescriptor)) return undefined;

  let originalValue: unknown;
  try {
    originalValue = Reflect.get(target, key, target);
  } catch {
    return undefined;
  }

  const record = {} as ProjectionRecord;
  record.target = target;
  record.key = key;
  record.originalDescriptor = originalDescriptor;
  record.originalValue = originalValue;
  record.baseValue = originalValue;
  record.owners = new Set([owner]);
  record.getter = () => {
    const scoped = scopedValue(activePolicy.getStore(), target, key);
    return scoped.found ? scoped.value : record.baseValue;
  };
  record.setter = (value) => {
    const values = activePolicy.getStore();
    if (values) setScopedValue(values, target, key, value);
    else record.baseValue = value;
  };

  try {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: originalDescriptor?.enumerable ?? false,
      get: record.getter,
      set: record.setter,
    });
  } catch {
    return undefined;
  }

  if (!targetRecords) {
    targetRecords = new Map();
    projections.set(target, targetRecords);
  }
  targetRecords.set(key, record);
  return record;
}

function restoreProjection(record: ProjectionRecord): void {
  if (!projectionStillInstalled(record)) return;
  try {
    if (record.originalDescriptor) {
      Object.defineProperty(record.target, record.key, {
        ...record.originalDescriptor,
        value: record.baseValue,
      });
    } else if (record.baseValue === record.originalValue) {
      delete (record.target as Record<PropertyKey, unknown>)[record.key];
    } else {
      Object.defineProperty(record.target, record.key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: record.baseValue,
      });
    }
  } catch {}
}

function operationError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("The operation was aborted", "AbortError");
}

export class InvocationPolicyScope {
  private readonly records = new Set<ProjectionRecord>();
  private readonly queue: AccessWaiter[] = [];
  private readonly idleWaiters: Array<() => void> = [];
  private sharedActive = 0;
  private exclusiveActive = false;
  private closed = false;
  private closeReason?: Error;

  ensure(target: object | undefined, key: PolicyKey): boolean {
    if (this.closed || !target) return false;
    const existing = projections.get(target)?.get(key);
    if (existing && this.records.has(existing))
      return projectionStillInstalled(existing);
    const record = installProjection(this, target, key);
    if (!record) return false;
    this.records.add(record);
    return true;
  }

  private acquire(mode: AccessMode, signal?: AbortSignal): Promise<Release> {
    if (this.closed)
      return Promise.reject(
        this.closeReason ?? new Error("invocation policy scope closed"),
      );
    if (signal?.aborted) return Promise.reject(operationError(signal));
    if (
      this.queue.length === 0 &&
      !this.exclusiveActive &&
      (mode === "shared" || this.sharedActive === 0)
    ) {
      if (mode === "shared") this.sharedActive += 1;
      else this.exclusiveActive = true;
      return Promise.resolve(() => this.release(mode));
    }
    return new Promise((resolve, reject) => {
      const waiter: AccessWaiter = { mode, resolve, reject, signal };
      if (signal) {
        const onAbort = () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          signal.removeEventListener("abort", onAbort);
          reject(operationError(signal));
          this.flushQueue();
        };
        waiter.onAbort = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.queue.push(waiter);
    });
  }

  private release(mode: AccessMode): void {
    if (mode === "shared") this.sharedActive -= 1;
    else this.exclusiveActive = false;
    this.flushQueue();
    this.resolveIdle();
  }

  private flushQueue(): void {
    if (this.exclusiveActive) return;
    while (this.queue.length > 0) {
      const waiter = this.queue[0];
      if (!waiter) return;
      if (waiter.signal?.aborted) {
        this.queue.shift();
        if (waiter.onAbort)
          waiter.signal.removeEventListener("abort", waiter.onAbort);
        waiter.reject(operationError(waiter.signal));
        continue;
      }
      if (waiter.mode === "exclusive") {
        if (this.sharedActive > 0) return;
        this.queue.shift();
        if (waiter.signal && waiter.onAbort)
          waiter.signal.removeEventListener("abort", waiter.onAbort);
        this.exclusiveActive = true;
        waiter.resolve(() => this.release("exclusive"));
        return;
      }
      this.queue.shift();
      if (waiter.signal && waiter.onAbort)
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      this.sharedActive += 1;
      waiter.resolve(() => this.release("shared"));
    }
  }

  private resolveIdle(): void {
    if (this.sharedActive > 0 || this.exclusiveActive) return;
    const idle = this.idleWaiters.splice(0);
    for (const resolve of idle) resolve();
  }

  async run<T>(
    signal: AbortSignal | undefined,
    mode: AccessMode,
    task: () => T | Promise<T>,
  ): Promise<T> {
    const release = await this.acquire(mode, signal);
    try {
      // Every invocation is a new root. Nested agent calls must see host policy,
      // not inherit another agent's projected config or pruner.
      return await activePolicy.run(new Map(), task);
    } finally {
      release();
    }
  }

  close(reason = new Error("invocation policy scope closing")): Promise<void> {
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
    if (this.sharedActive === 0 && !this.exclusiveActive)
      return Promise.resolve();
    return new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  restore(): void {
    for (const record of this.records) {
      record.owners.delete(this);
      if (record.owners.size > 0) continue;
      restoreProjection(record);
      const targetRecords = projections.get(record.target);
      if (targetRecords?.get(record.key) === record)
        targetRecords.delete(record.key);
    }
    this.records.clear();
  }
}
