/**
 * Task-aware routing primitives. Kept provider-neutral: this layer chooses
 * quality intent, not vendors.
 * @module @ran-sh/dsh-vision/task-router
 */

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
 * Conservative task policy. Callers may override it after classification.
 * The values intentionally describe budgets rather than a concrete model.
 */
export function routeVisionTask(task: VisionTask): VisionTaskRoute {
  switch (task) {
    case 'ocr':
    case 'document':
      return { task, policy: { detail: 'high', preferLossless: true, maxPixels: 12000000, maxOutputTokens: 3000 } }
    case 'ui-review':
    case 'code':
    case 'compare':
      return { task, policy: { detail: 'high', preferLossless: true, maxPixels: 10000000, maxOutputTokens: 2500 } }
    case 'chart':
      return { task, policy: { detail: 'medium', preferLossless: true, maxPixels: 8000000, maxOutputTokens: 2200 } }
    case 'photo':
      return { task, policy: { detail: 'low', preferLossless: false, maxPixels: 4000000, maxOutputTokens: 1200 } }
    default:
      return { task, policy: { detail: 'medium', preferLossless: false, maxPixels: 6000000, maxOutputTokens: 1800 } }
  }
}
