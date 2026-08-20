/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { buildVisionAwarePrompt, VISION_ROUTE_HINT } from '../src/client/send-hook.ts'

describe('image send routing hint', () => {
  it('preserves user text and image refs while adding the hidden tool hint', () => {
    const prompt = buildVisionAwarePrompt('what is wrong here?', [
      '![图片](/image-mind/raw/sha256:abc)',
      '![图片](/image-mind/raw/sha256:def)',
    ])
    expect(prompt).toContain('what is wrong here?')
    expect(prompt).toContain(VISION_ROUTE_HINT)
    expect(prompt).toContain('understand_image')
    expect(prompt).toContain('sha256:abc')
    expect(prompt).toContain('sha256:def')
  })

  it('still instructs inspection for an image-only message', () => {
    const prompt = buildVisionAwarePrompt('', ['![图片](/image-mind/raw/sha256:abc)'])
    expect(prompt.startsWith('<!-- image-mind:')).toBe(true)
    expect(prompt).toContain('For an image-only message')
  })
})
