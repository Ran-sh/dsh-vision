/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { buildVisionAwarePrompt, VISION_ROUTE_HINT } from '../src/client/send-hook.ts'

describe('image send routing hint', () => {
  it('preserves user text and adds only a user-safe tool marker', () => {
    const prompt = buildVisionAwarePrompt('what is wrong here?', 2)
    expect(prompt).toContain('what is wrong here?')
    expect(prompt).toContain('understand_image')
    expect(prompt).toContain('2 张图片')
  })

  it('never embeds attachment ids, metadata comments, or raw image-mind URLs', () => {
    const prompt = buildVisionAwarePrompt('read it', 1)
    expect(prompt).toContain(VISION_ROUTE_HINT)
    expect(prompt).not.toContain('<!--')
    expect(prompt).not.toContain('[image attachment')
    expect(prompt).not.toContain('sha256:')
    expect(prompt).not.toContain('/image-mind/raw/')
    expect(prompt).not.toContain('mediaType')
    expect(prompt).not.toContain('attachmentId')
  })

  it('still instructs inspection for an image-only message', () => {
    const prompt = buildVisionAwarePrompt('', 1)
    expect(prompt).toBe(VISION_ROUTE_HINT)
    expect(prompt).toContain('understand_image')
  })
})
