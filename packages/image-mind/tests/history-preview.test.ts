/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { alignPreviewBatches, previewMarkerCount } from '../src/client/history-preview.ts'
import type { SessionPreviewBatch } from '../src/client/attach.ts'

function batch(batchId: string, count: number, updatedAt: number): SessionPreviewBatch {
  return { batchId, count, updatedAt }
}

describe('committed conversation image preview mapping', () => {
  it('recognizes only the final neutral image marker', () => {
    expect(previewMarkerCount('已附加图片。')).toBe(1)
    expect(previewMarkerCount('看看这个\n已附加 2 张图片。')).toBe(2)
    expect(previewMarkerCount('已附加 8 张图片。\n')).toBe(8)
    expect(previewMarkerCount('assistant mentions 已附加图片。 but keeps talking')).toBeUndefined()
    expect(previewMarkerCount('sha256:deadbeef')).toBeUndefined()
    expect(previewMarkerCount('/image-mind/raw/x')).toBeUndefined()
  })

  it('tail-aligns a paged render window with committed history', () => {
    const history = [
      batch('old-1', 1, 1),
      batch('old-2', 2, 2),
      batch('new-1', 1, 3),
    ]
    expect(alignPreviewBatches([2, 1], history).map(value => value?.batchId)).toEqual(['old-2', 'new-1'])
  })

  it('skips non-matching committed entries rather than exposing raw metadata', () => {
    const history = [batch('one', 1, 1), batch('three', 3, 2), batch('two', 2, 3)]
    expect(alignPreviewBatches([1, 2], history).map(value => value?.batchId)).toEqual(['one', 'two'])
  })
})
