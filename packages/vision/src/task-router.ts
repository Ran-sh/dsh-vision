/**
 * Task-aware routing primitives. Kept provider-neutral: this layer chooses
 * quality intent, not vendors.
 * @module @ran-sh/dsh-vision/task-router
 */

import { createVisionTokenBudget } from './token-budget.ts'

export type VisionTask =
  | 'ocr'
  | 'ui-review'
  | 'code'
  | 'document'
  | 'chart'
  | 'compare'
  | 'photo'
  | 'general'

export interface VisionQualityPolicy {
  detail: 'low' | 'medium' | 'high'
  preferLossless: boolean
  maxPixels: number
  maxOutputTokens: number
}

export interface VisionTaskRoute {
  task: VisionTask
  policy: VisionQualityPolicy
}

/**
 * Route one classified task to its provider-neutral quality envelope.
 *
 * `token-budget.ts` is deliberately the single source of truth for budget
 * numbers. Keeping a second policy table here previously allowed the two
 * modules to drift (for example `compare`, `code`, and `general` had different
 * values depending on which helper a caller used).
 */
export function routeVisionTask(task: VisionTask): VisionTaskRoute {
  return { task, policy: createVisionTokenBudget(task) }
}
