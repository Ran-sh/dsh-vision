/**
 * Task-aware token/pixel budget policy. Provider-neutral: this only decides
 * a safe quality envelope; adapters decide how to encode wire parameters.
 */

import type { VisionTask } from './task-router.ts'

export interface VisionTokenBudget {
  maxPixels: number
  maxOutputTokens: number
  detail: 'low' | 'medium' | 'high'
  preferLossless: boolean
}

const DEFAULT: VisionTokenBudget = {
  maxPixels: 4_000_000,
  maxOutputTokens: 1200,
  detail: 'medium',
  preferLossless: false,
}

const POLICIES: Record<VisionTask, VisionTokenBudget> = {
  ocr: { maxPixels: 12_000_000, maxOutputTokens: 3000, detail: 'high', preferLossless: true },
  'ui-review': { maxPixels: 10_000_000, maxOutputTokens: 2500, detail: 'high', preferLossless: true },
  code: { maxPixels: 10_000_000, maxOutputTokens: 2600, detail: 'high', preferLossless: true },
  document: { maxPixels: 12_000_000, maxOutputTokens: 3000, detail: 'high', preferLossless: true },
  chart: { maxPixels: 8_000_000, maxOutputTokens: 2200, detail: 'medium', preferLossless: true },
  compare: { maxPixels: 8_000_000, maxOutputTokens: 2200, detail: 'medium', preferLossless: true },
  photo: { maxPixels: 3_000_000, maxOutputTokens: 1000, detail: 'low', preferLossless: false },
  screenshot: { maxPixels: 10_000_000, maxOutputTokens: 2200, detail: 'high', preferLossless: true },
  translate: { maxPixels: 10_000_000, maxOutputTokens: 2600, detail: 'high', preferLossless: true },
  general: DEFAULT,
}

export function createVisionTokenBudget(task: VisionTask): VisionTokenBudget {
  return { ...(POLICIES[task] ?? DEFAULT) }
}
