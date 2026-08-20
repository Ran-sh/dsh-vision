/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { buildVisionAwarePrompt, VISION_ATTACHMENT_MARKER } from '../src/client/send-hook.ts'

describe('image send user-visible marker', () => {
  it('preserves user text and adds only a neutral attachment marker', () => {
    const prompt = buildVisionAwarePrompt('what is wrong here?', 2)
    expect(prompt).toContain('what is wrong here?')
    expect(prompt).toContain('2 张图片')
    expect(prompt).not.toContain('understand_image')
    expect(prompt).not.toMatch(/调用|tool|routing/i)
  })

  it('never embeds attachment ids, metadata comments, raw image-mind URLs, or tool-routing instructions', () => {
    const prompt = buildVisionAwarePrompt('read it', 1)
    expect(prompt).toContain(VISION_ATTACHMENT_MARKER)
    expect(prompt).not.toContain('<!--')
    expect(prompt).not.toContain('[image attachment')
    expect(prompt).not.toContain('sha256:')
    expect(prompt).not.toContain('/image-mind/raw/')
    expect(prompt).not.toContain('mediaType')
    expect(prompt).not.toContain('attachmentId')
    expect(prompt).not.toContain('understand_image')
  })

  it('uses only the neutral marker for an image-only message', () => {
    const prompt = buildVisionAwarePrompt('', 1)
    expect(prompt).toBe(VISION_ATTACHMENT_MARKER)
    expect(prompt).not.toContain('understand_image')
  })
})
