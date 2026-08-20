/**
 * Provider-neutral layered cache primitives for vision.
 *
 * The cache intentionally separates visual understanding from question
 * answering. A single image may produce stable visual facts that can answer
 * many later questions without paying the image understanding cost again.
 *
 * This module contains only deterministic key/value primitives. Storage,
 * eviction and persistence belong to the host runtime.
 * @module @ran-sh/dsh-vision/cache
 */

/** Stable visual facts extracted from an image. */
export interface VisionUnderstanding {
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

/** Runtime cache mode shared with VisionRequest semantics. */
export type VisionCacheLayerMode = 'use' | 'refresh' | 'no-store'

/** A small provider-neutral cache interface. */
export interface VisionCacheStore {
  getUnderstanding(key: string): VisionUnderstanding | undefined
  setUnderstanding(entry: VisionUnderstanding): void
  getAnswer(key: string): VisionAnswerCacheEntry | undefined
  setAnswer(entry: VisionAnswerCacheEntry): void
}

/** Normalize arbitrary text into a deterministic cache-safe key input. */
export function normalizeVisionCacheText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * Build a key for image understanding. This intentionally excludes the user
 * question: visual facts are reusable across questions.
 */
export function createVisionUnderstandingKey(imageFingerprint: string): string {
  return `vision:understanding:${imageFingerprint}`
}

/** Build a key for an answer generated from known visual facts. */
export function createVisionAnswerKey(understandingKey: string, question: string): string {
  return `vision:answer:${understandingKey}:${normalizeVisionCacheText(question)}`
}

/** Memory-only implementation useful for tests and small hosts. */
export function createMemoryVisionCache(): VisionCacheStore {
  const understandings = new Map<string, VisionUnderstanding>()
  const answers = new Map<string, VisionAnswerCacheEntry>()
  return {
    getUnderstanding: (key) => understandings.get(key),
    setUnderstanding: (entry) => understandings.set(entry.imageKey, entry),
    getAnswer: (key) => answers.get(key),
    setAnswer: (entry) => answers.set(entry.questionKey, entry),
  }
}
