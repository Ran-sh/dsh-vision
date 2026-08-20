/**
 * Provider-neutral layered cache primitives for vision.
 *
 * The cache intentionally separates reusable visual understanding from
 * question-specific answers. Storage here is memory-only, bounded and
 * short-lived; durable persistence belongs to the host.
 * @module @ran-sh/dsh-vision/cache
 */

/** Stable visual facts extracted from an image or ordered image set. */
export interface VisionUnderstanding {
  /** Cache key returned by createVisionUnderstandingKey. */
  imageKey: string
  facts: string
  provider: string
  model: string
  createdAt: number
}

/** A cached answer built from visual facts and a user question. */
export interface VisionAnswerCacheEntry {
  understandingKey: string
  questionKey: string
  answer: string
  provider: string
  model: string
  createdAt: number
}

export type VisionCacheLayerMode = 'use' | 'refresh' | 'no-store'

export interface VisionCacheStore {
  getUnderstanding(key: string): VisionUnderstanding | undefined
  setUnderstanding(entry: VisionUnderstanding): void
  getAnswer(key: string): VisionAnswerCacheEntry | undefined
  setAnswer(entry: VisionAnswerCacheEntry): void
}

export interface MemoryVisionCacheOptions {
  /** Maximum entries retained independently in each layer. */
  maxEntries?: number
  /** Time-to-live for one entry. */
  ttlMs?: number
  /** Test seam for deterministic clocks. */
  now?: () => number
}

const DEFAULT_MAX_ENTRIES = 128
const DEFAULT_TTL_MS = 10 * 60_000

/** Normalize arbitrary text into a deterministic cache-safe key input. */
export function normalizeVisionCacheText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * Build a key for image understanding. `scope` must describe the reusable
 * evidence contract (normally a task id such as `ocr` or `ui-review`).
 * It intentionally excludes the user's specific question.
 */
export function createVisionUnderstandingKey(imageFingerprint: string, scope = 'general'): string {
  return `vision:understanding:${normalizeVisionCacheText(scope)}:${imageFingerprint}`
}

/** Build a key for an answer generated from known visual facts. */
export function createVisionAnswerKey(understandingKey: string, question: string): string {
  return `vision:answer:${understandingKey}:${normalizeVisionCacheText(question)}`
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

/** Memory-only bounded cache suitable for short-lived visual evidence reuse. */
export function createMemoryVisionCache(options: MemoryVisionCacheOptions = {}): VisionCacheStore {
  const maxEntries = positiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES)
  const ttlMs = positiveInteger(options.ttlMs, DEFAULT_TTL_MS)
  const now = options.now ?? Date.now
  const understandings = new Map<string, VisionUnderstanding>()
  const answers = new Map<string, VisionAnswerCacheEntry>()

  function fresh<T extends { createdAt: number }>(map: Map<string, T>, key: string): T | undefined {
    const value = map.get(key)
    if (value === undefined) return undefined
    if (now() - value.createdAt >= ttlMs) {
      map.delete(key)
      return undefined
    }
    // Map insertion order doubles as a tiny LRU queue.
    map.delete(key)
    map.set(key, value)
    return value
  }

  function boundedSet<T>(map: Map<string, T>, key: string, value: T): void {
    map.delete(key)
    map.set(key, value)
    while (map.size > maxEntries) {
      const oldest = map.keys().next().value as string | undefined
      if (oldest === undefined) break
      map.delete(oldest)
    }
  }

  return {
    getUnderstanding: key => fresh(understandings, key),
    setUnderstanding: entry => boundedSet(understandings, entry.imageKey, entry),
    getAnswer: key => fresh(answers, key),
    setAnswer: entry => boundedSet(answers, entry.questionKey, entry),
  }
}
