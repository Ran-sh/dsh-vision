import { describe, expect, it } from 'vitest'
import { inferVisionTask, routeVisionTask } from '../src/index.ts'

describe('vision task routing', () => {
  it.each([
    ['transcribe all text verbatim', 'ocr'],
    ['检查这个按钮的布局和间距', 'ui-review'],
    ['read this terminal traceback', 'code'],
    ['extract fields from this invoice', 'document'],
    ['explain the chart trend and legend', 'chart'],
    ['比较这两张截图的差异', 'compare'],
    ['translate the visible text into Chinese', 'translate'],
    ['inspect this screenshot', 'screenshot'],
    ['describe this photo', 'photo'],
    ['what is visible here?', 'general'],
  ] as const)('classifies %s as %s', (prompt, task) => {
    expect(inferVisionTask(prompt, task === 'compare' ? 2 : 1)).toBe(task)
  })

  it('uses image count as a conservative compare signal', () => {
    expect(inferVisionTask('which one changed?', 2)).toBe('compare')
    expect(inferVisionTask('which one changed?', 1)).toBe('general')
  })

  it('allocates more detail to OCR than ordinary photos', () => {
    const ocr = routeVisionTask('ocr').policy
    const photo = routeVisionTask('photo').policy
    expect(ocr.detail).toBe('high')
    expect(ocr.preferLossless).toBe(true)
    expect(ocr.maxPixels).toBeGreaterThan(photo.maxPixels)
    expect(ocr.maxOutputTokens).toBeGreaterThan(photo.maxOutputTokens)
    expect(photo.detail).toBe('low')
  })
})
