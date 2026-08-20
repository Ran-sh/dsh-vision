/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { VisionExecutionGate } from '../src/runtime/execution-gate.ts'

describe('VisionExecutionGate', () => {
  it('limits active work and wakes queued calls FIFO', async () => {
    const gate = new VisionExecutionGate(2)
    const started: number[] = []
    const releases: Array<() => void> = []
    let resolveThirdStarted!: () => void
    const thirdStarted = new Promise<void>(resolve => { resolveThirdStarted = resolve })

    const task = (id: number) => gate.run(async () => {
      started.push(id)
      if (id === 3) resolveThirdStarted()
      await new Promise<void>(resolve => releases.push(resolve))
      return id
    })

    const a = task(1)
    const b = task(2)
    const c = task(3)
    await Promise.resolve()
    await Promise.resolve()

    expect(started).toEqual([1, 2])
    expect(gate.activeCount).toBe(2)
    expect(gate.queuedCount).toBe(1)

    releases.shift()!()
    // Do not assert a particular number of Promise microtasks between the
    // released operation, run()'s finally, pump(), acquire() continuation and
    // the queued operation body. Node/V8 scheduling depth is not the gate's
    // contract; FIFO start order and bounded concurrency are.
    await thirdStarted
    expect(started).toEqual([1, 2, 3])
    expect(gate.activeCount).toBe(2)
    expect(gate.queuedCount).toBe(0)

    releases.shift()!()
    releases.shift()!()
    await expect(Promise.all([a, b, c])).resolves.toEqual([1, 2, 3])
    expect(gate.activeCount).toBe(0)
    expect(gate.queuedCount).toBe(0)
  })

  it('removes an aborted waiter without consuming capacity', async () => {
    const gate = new VisionExecutionGate(1)
    const release = await gate.acquire()
    const controller = new AbortController()
    const queued = gate.acquire(controller.signal)
    expect(gate.queuedCount).toBe(1)

    controller.abort(new Error('cancelled'))
    await expect(queued).rejects.toThrow('cancelled')
    expect(gate.queuedCount).toBe(0)
    expect(gate.activeCount).toBe(1)

    release()
    expect(gate.activeCount).toBe(0)
  })
})
