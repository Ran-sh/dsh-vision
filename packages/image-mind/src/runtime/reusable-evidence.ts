/**
 * Reusable visual-evidence contracts for the layered cache.
 *
 * A cached entry must be broader than one user question. Only task classes
 * with a reasonably stable evidence representation participate; open-ended
 * photo/general requests remain question-specific and bypass this layer.
 */

import { createHash } from 'node:crypto'
import { createVisionUnderstandingKey } from '@ran-sh/dsh-vision'
import type { LoadedImage, VisionTask } from '@ran-sh/dsh-vision'

const REUSABLE = new Set<VisionTask>([
  'ocr', 'document', 'ui-review', 'code', 'chart', 'screenshot', 'translate', 'compare',
])

export function isReusableEvidenceTask(task: VisionTask): boolean {
  return REUSABLE.has(task)
}

/** Fingerprint an ordered image set without retaining bytes in the key. */
export function imageSetFingerprint(images: readonly LoadedImage[]): string {
  const hash = createHash('sha256')
  hash.update(`count:${images.length}\n`)
  for (const image of images) {
    hash.update(image.mimeType)
    hash.update('\0')
    hash.update(createHash('sha256').update(image.bytes).digest())
  }
  return hash.digest('hex')
}

export function reusableEvidenceKey(images: readonly LoadedImage[], task: VisionTask): string {
  return createVisionUnderstandingKey(imageSetFingerprint(images), task)
}

/**
 * Canonical prompts intentionally exclude the caller's specific question.
 * DeepSeek receives the returned evidence and performs the final reasoning.
 */
export function reusableEvidencePrompt(task: VisionTask, imageCount: number): string {
  switch (task) {
    case 'ocr':
      return 'OCR evidence extraction: transcribe all visible text faithfully. Preserve reading order, punctuation, numbers, labels, and meaningful line breaks. Mark illegible spans instead of guessing.'
    case 'document':
      return 'Document evidence extraction: capture headings, fields, labels, values, tables, footnotes, reading order, and all task-relevant visible text. Separate absent fields from unclear ones.'
    case 'ui-review':
      return 'UI review evidence extraction: capture visible text, controls, hierarchy, alignment, spacing, clipping, overflow, contrast, selected/disabled/error states, and notable layout relationships. Report observations, not design speculation.'
    case 'code':
      return 'Code and terminal evidence extraction: transcribe visible code, commands, errors, logs, filenames, line numbers, stack traces, status indicators, and relevant IDE/terminal context exactly where legible.'
    case 'chart':
      return 'Chart evidence extraction: capture title, axes, units, legend, series, labels, visible values, extrema, annotations, and trends. Mark geometric estimates as estimates.'
    case 'screenshot':
      return 'Screenshot evidence extraction: capture visible application state, text, controls, notifications, dialogs, errors, and spatial relationships comprehensively enough for later questions.'
    case 'translate':
      return 'Translation evidence extraction: transcribe the source text faithfully, identify the visible source language when possible, and preserve names, numbers, labels, structure, and reading order. Do not omit text that may matter to a later translation.'
    case 'compare':
      return `Compare evidence extraction for ${imageCount} images: record important facts per image and exhaustively identify additions, removals, modifications, and unchanged elements. Preserve the supplied Image N identities.`
    default:
      return 'Visual evidence extraction: capture the visible facts needed for later reasoning without inventing hidden context.'
  }
}
