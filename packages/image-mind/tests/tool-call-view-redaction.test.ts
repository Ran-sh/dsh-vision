/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { safeImageIdentity, understandImageCallView } from '../src/tools/understand-image.ts'

describe('understand_image call-view reference redaction', () => {
  it('removes signed URL paths and query secrets from rawInput', () => {
    const view = understandImageCallView({
      image: 'https://cdn.example.com/private/image.png?token=super-secret&signature=abc',
      prompt: 'describe the screenshot',
      cache: 'no-store',
    })

    expect(view.rawInput).toMatchObject({
      image: 'cdn.example.com/...',
      prompt: 'describe the screenshot',
      cache: 'no-store',
    })
    const raw = JSON.stringify(view.rawInput)
    expect(raw).not.toContain('super-secret')
    expect(raw).not.toContain('signature=')
    expect(raw).not.toContain('/private/image.png')
  })

  it('uses basenames in rawInput while preserving local locations for the host UI', () => {
    const path = '/Users/private-account/screenshots/secret-project.png'
    const view = understandImageCallView({ image: path, prompt: 'read text' })

    expect(view.rawInput).toMatchObject({ image: 'secret-project.png', prompt: 'read text' })
    expect(JSON.stringify(view.rawInput)).not.toContain('/Users/private-account/')
    expect(view.locations).toEqual([{ path }])
  })

  it('keeps attachment payloads opaque in call/result identities', () => {
    const attachmentJson = '{"attachmentId":"private-id","url":"https://host/raw?id=secret"}'
    const view = understandImageCallView({
      images: [attachmentJson, 'sha256:0123456789abcdef'],
      prompt: 'compare',
    })

    expect(view.rawInput).toMatchObject({ images: ['attachment', 'attachment'] })
    expect(safeImageIdentity(attachmentJson)).toBe('attachment')
    expect(safeImageIdentity('sha256:0123456789abcdef')).toBe('attachment')
    expect(JSON.stringify(view.rawInput)).not.toContain('private-id')
    expect(JSON.stringify(view.rawInput)).not.toContain('0123456789abcdef')
  })
})
