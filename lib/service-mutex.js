function abortReason(signal) {
  if (signal?.reason instanceof Error) return signal.reason
  return new DOMException('The operation was aborted', 'AbortError')
}

export class ServiceMutex {
  constructor() {
    this.locked = false
    this.closed = false
    this.closeReason = undefined
    this.queue = []
    this.idleWaiters = []
  }

  acquire(signal) {
    if (this.closed) return Promise.reject(this.closeReason ?? new Error('service mutex closed'))
    if (signal?.aborted) return Promise.reject(abortReason(signal))
    if (!this.locked) {
      this.locked = true
      return Promise.resolve(() => this.release())
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, onAbort: undefined }
      if (signal) {
        waiter.onAbort = () => {
          const index = this.queue.indexOf(waiter)
          if (index >= 0) this.queue.splice(index, 1)
          signal.removeEventListener('abort', waiter.onAbort)
          reject(abortReason(signal))
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      this.queue.push(waiter)
    })
  }

  release() {
    while (this.queue.length > 0) {
      const waiter = this.queue.shift()
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort)
      if (waiter.signal?.aborted) {
        waiter.reject(abortReason(waiter.signal))
        continue
      }
      waiter.resolve(() => this.release())
      return
    }
    this.locked = false
    const idle = this.idleWaiters.splice(0)
    for (const resolve of idle) resolve()
  }

  async run(signal, task) {
    const release = await this.acquire(signal)
    try { return await task() }
    finally { release() }
  }

  close(reason = new Error('service mutex closing')) {
    if (!this.closed) {
      this.closed = true
      this.closeReason = reason
      const queued = this.queue.splice(0)
      for (const waiter of queued) {
        if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort)
        waiter.reject(reason)
      }
    }
    if (!this.locked) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }
}
