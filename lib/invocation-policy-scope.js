import { AsyncLocalStorage } from "node:async_hooks";
const activePolicy = new AsyncLocalStorage();
const projections = new WeakMap();
function scopedValue(values, target, key) {
    const targetValues = values?.get(target);
    return targetValues?.has(key)
        ? { found: true, value: targetValues.get(key) }
        : { found: false, value: undefined };
}
function setScopedValue(values, target, key, value) {
    let targetValues = values.get(target);
    if (!targetValues) {
        targetValues = new Map();
        values.set(target, targetValues);
    }
    targetValues.set(key, value);
}
function inheritedDescriptor(target, key) {
    for (let current = Object.getPrototypeOf(target); current; current = Object.getPrototypeOf(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor)
            return descriptor;
    }
    return undefined;
}
function projectionShapeSupported(target, key, own) {
    if (own)
        return own.configurable === true && "value" in own && own.writable === true;
    if (!Object.isExtensible(target))
        return false;
    const inherited = inheritedDescriptor(target, key);
    if (!inherited)
        return true;
    return "value" in inherited
        ? inherited.writable === true
        : typeof inherited.set === "function";
}
function projectionStillInstalled(record) {
    const current = Object.getOwnPropertyDescriptor(record.target, record.key);
    return current?.get === record.getter && current.set === record.setter;
}
function installProjection(owner, target, key) {
    let targetRecords = projections.get(target);
    const existing = targetRecords?.get(key);
    if (existing) {
        if (!projectionStillInstalled(existing))
            return undefined;
        existing.owners.add(owner);
        return existing;
    }
    const originalDescriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!projectionShapeSupported(target, key, originalDescriptor))
        return undefined;
    let originalValue;
    try {
        originalValue = Reflect.get(target, key, target);
    }
    catch {
        return undefined;
    }
    const record = {};
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
        if (values)
            setScopedValue(values, target, key, value);
        else
            record.baseValue = value;
    };
    try {
        Object.defineProperty(target, key, {
            configurable: true,
            enumerable: originalDescriptor?.enumerable ?? false,
            get: record.getter,
            set: record.setter,
        });
    }
    catch {
        return undefined;
    }
    if (!targetRecords) {
        targetRecords = new Map();
        projections.set(target, targetRecords);
    }
    targetRecords.set(key, record);
    return record;
}
function restoreProjection(record) {
    if (!projectionStillInstalled(record))
        return;
    try {
        if (record.originalDescriptor) {
            Object.defineProperty(record.target, record.key, {
                ...record.originalDescriptor,
                value: record.baseValue,
            });
        }
        else if (record.baseValue === record.originalValue) {
            delete record.target[record.key];
        }
        else {
            Object.defineProperty(record.target, record.key, {
                configurable: true,
                enumerable: true,
                writable: true,
                value: record.baseValue,
            });
        }
    }
    catch { }
}
function operationError(signal) {
    if (signal?.reason instanceof Error)
        return signal.reason;
    return new DOMException("The operation was aborted", "AbortError");
}
export class InvocationPolicyScope {
    records = new Set();
    queue = [];
    idleWaiters = [];
    sharedActive = 0;
    exclusiveActive = false;
    closed = false;
    closeReason;
    ensure(target, key) {
        if (this.closed || !target)
            return false;
        const existing = projections.get(target)?.get(key);
        if (existing && this.records.has(existing))
            return projectionStillInstalled(existing);
        const record = installProjection(this, target, key);
        if (!record)
            return false;
        this.records.add(record);
        return true;
    }
    acquire(mode, signal) {
        if (this.closed)
            return Promise.reject(this.closeReason ?? new Error("invocation policy scope closed"));
        if (signal?.aborted)
            return Promise.reject(operationError(signal));
        if (this.queue.length === 0 &&
            !this.exclusiveActive &&
            (mode === "shared" || this.sharedActive === 0)) {
            if (mode === "shared")
                this.sharedActive += 1;
            else
                this.exclusiveActive = true;
            return Promise.resolve(() => this.release(mode));
        }
        return new Promise((resolve, reject) => {
            const waiter = { mode, resolve, reject, signal };
            if (signal) {
                const onAbort = () => {
                    const index = this.queue.indexOf(waiter);
                    if (index >= 0)
                        this.queue.splice(index, 1);
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
    release(mode) {
        if (mode === "shared")
            this.sharedActive -= 1;
        else
            this.exclusiveActive = false;
        this.flushQueue();
        this.resolveIdle();
    }
    flushQueue() {
        if (this.exclusiveActive)
            return;
        while (this.queue.length > 0) {
            const waiter = this.queue[0];
            if (!waiter)
                return;
            if (waiter.signal?.aborted) {
                this.queue.shift();
                if (waiter.onAbort)
                    waiter.signal.removeEventListener("abort", waiter.onAbort);
                waiter.reject(operationError(waiter.signal));
                continue;
            }
            if (waiter.mode === "exclusive") {
                if (this.sharedActive > 0)
                    return;
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
    resolveIdle() {
        if (this.sharedActive > 0 || this.exclusiveActive)
            return;
        const idle = this.idleWaiters.splice(0);
        for (const resolve of idle)
            resolve();
    }
    async run(signal, mode, task) {
        const release = await this.acquire(mode, signal);
        try {
            // Every invocation is a new root. Nested agent calls must see host policy,
            // not inherit another agent's projected config or pruner.
            return await activePolicy.run(new Map(), task);
        }
        finally {
            release();
        }
    }
    close(reason = new Error("invocation policy scope closing")) {
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
        return new Promise((resolve) => this.idleWaiters.push(resolve));
    }
    restore() {
        for (const record of this.records) {
            record.owners.delete(this);
            if (record.owners.size > 0)
                continue;
            restoreProjection(record);
            const targetRecords = projections.get(record.target);
            if (targetRecords?.get(record.key) === record)
                targetRecords.delete(record.key);
        }
        this.records.clear();
    }
}
