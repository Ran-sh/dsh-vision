/**
 * Process-wide backpressure for real vision endpoint calls.
 *
 * Tool invocations can fan out across conversations and retries. Without a
 * shared gate every invocation believes it is alone and can stampede the same
 * endpoint. This gate limits only active wire operations; retry/backoff sleeps
 * happen outside `run`, so waiting calls do not monopolize capacity.
 */

interface Waiter {
  resolve: (release: () => void) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

/** Small abort-aware FIFO semaphore. */
export class VisionExecutionGate {
  private active = 0
  private readonly queue: Waiter[] = []

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('image-mind: vision execution concurrency must be a positive safe integer')
    }
  }

  /** Current active wire-operation count (diagnostic/test surface). */
  get activeCount(): number { return this.active }
  /** Current queued operation count (diagnostic/test surface). */
  get queuedCount(): number { return this.queue.length }

  /** Acquire one slot and receive an idempotent release callback. */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted === true) throw this.abortError(signal)
    if (this.active < this.limit) {
      this.active += 1
      return this.releaseOnce()
    }

    return await new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal }
      if (signal !== undefined) {
        waiter.onAbort = () => {
          const index = this.queue.indexOf(waiter)
          if (index >= 0) this.queue.splice(index, 1)
          reject(this.abortError(signal))
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      this.queue.push(waiter)
    })
  }

  /** Run one wire operation under the gate, always releasing its slot. */
  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  /** Produce a single-use release callback and wake the oldest live waiter. */
  private releaseOnce(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.active -= 1
      this.pump()
    }
  }

  /** Fill free slots from the FIFO queue, skipping already-aborted waiters. */
  private pump(): void {
    while (this.active < this.limit && this.queue.length > 0) {
      const waiter = this.queue.shift()!
      if (waiter.onAbort !== undefined && waiter.signal !== undefined) {
        waiter.signal.removeEventListener('abort', waiter.onAbort)
      }
      if (waiter.signal?.aborted === true) {
        waiter.reject(this.abortError(waiter.signal))
        continue
      }
      this.active += 1
      waiter.resolve(this.releaseOnce())
    }
  }

  private abortError(signal: AbortSignal): Error {
    if (signal.reason instanceof Error) return signal.reason
    const error = new Error('image-mind: vision request aborted while waiting for endpoint capacity')
    error.name = 'AbortError'
    return error
  }
}

/** Conservative process-wide default; providers still enforce their own rate limits. */
export const globalVisionExecutionGate = new VisionExecutionGate(4)
