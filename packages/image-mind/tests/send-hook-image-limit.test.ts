/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  commitImagePreviewBatch: vi.fn(),
  prepareImageForDescribe: vi.fn(),
  uploadImage: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../src/client/attach.ts', () => ({
  commitImagePreviewBatch: mocks.commitImagePreviewBatch,
  prepareImageForDescribe: mocks.prepareImageForDescribe,
  uploadImage: mocks.uploadImage,
}))

vi.mock('../src/client/toast.ts', () => ({ showToast: mocks.showToast }))

import { installSendHook } from '../src/client/send-hook.ts'
import { MAX_IMAGES_PER_REQUEST } from '../src/shared/image-limits.ts'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('image send count limit', () => {
  it('blocks more than the tool limit before reading drafts, uploading, sending, or releasing', async () => {
    const originalSendSession = vi.fn()
    const draftImages = vi.fn()
    const releaseDraftImage = vi.fn()
    const prompt = vi.fn()
    const conversation = {
      send: vi.fn(),
      sendSession: originalSendSession,
      draftImages,
      releaseDraftImage,
    }

    installSendHook(conversation)

    const ids = Array.from({ length: MAX_IMAGES_PER_REQUEST + 1 }, (_, index) => `image-${index}`)
    await conversation.sendSession(
      { sessionId: 'session-limit', prompt },
      'analyze these',
      ids,
      'chat',
      new AbortController().signal,
    )

    expect(MAX_IMAGES_PER_REQUEST).toBe(8)
    expect(originalSendSession).not.toHaveBeenCalled()
    expect(draftImages).not.toHaveBeenCalled()
    expect(mocks.prepareImageForDescribe).not.toHaveBeenCalled()
    expect(mocks.uploadImage).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(mocks.commitImagePreviewBatch).not.toHaveBeenCalled()
    expect(releaseDraftImage).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('最多 8 张'), 'error')
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('草稿图片已保留'), 'error')
  })
})
