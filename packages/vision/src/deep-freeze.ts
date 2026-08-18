/**
 * Deep-freeze for runtime snapshots. The TypeScript `Readonly<>` / `interface`
 * modifiers are compile-time only; a connection snapshot an adapter receives
 * must also resist accidental mutation at runtime, so the runtime freezes the
 * whole object graph before handing it to the adapter.
 *
 * Iterative (a WeakSet + explicit pending stack) rather than recursive so a
 * deep graph cannot overflow the call stack; cycles are safe; `AbortSignal`
 * instances are left mutable (freezing a signal breaks later abort).
 * @module @ran-sh/dsh-vision/deep-freeze
 */

/** Freeze one value and every reachable object in its graph, in place. */
export function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>()
  const pending: Array<{ kind: 'visit'; node: unknown } | { kind: 'property'; source: Record<string, unknown>; key: string }> = [
    { kind: 'visit', node: value },
  ]
  while (pending.length > 0) {
    const task = pending.pop()
    if (task === undefined) continue
    if (task.kind === 'property') {
      pending.push({ kind: 'visit', node: task.source[task.key] })
      continue
    }
    const node = task.node
    if (node === null || typeof node !== 'object') continue
    // A live signal must stay mutable so cancellation still works.
    if (node instanceof AbortSignal) continue
    if (seen.has(node)) continue
    seen.add(node)
    Object.freeze(node)
    for (const key of Object.keys(node)) {
      pending.push({ kind: 'property', source: node as Record<string, unknown>, key })
    }
  }
  return value
}
