/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  commitImagePreviewBatch: vi.fn(),
  discardImageRoutingBatch: vi.fn(),
  prepareImageForDescribe: vi.fn(),
  uploadImage: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../src/client/attach.ts', () => ({
  commitImagePreviewBatch: mocks.commitImagePreviewBatch,
  discardImageRoutingBatch: mocks.discardImageRoutingBatch,
  prepareImageForDescribe: mocks.prepareImageForDescribe,
  uploadImage: mocks.uploadImage,
}))

vi.mock('../src/client/toast.ts', () => ({ showToast: mocks.showToast }))

import { installSendHook } from '../src/client/send-hook.ts'

function conversationWith(prompt: ReturnType<typeof vi.fn>) {
  const releaseDraftImage = vi.fn()
  const conversation = {
    send: vi.fn(),
    sendSession: vi.fn(),
    draftImages: vi.fn((ids: readonly string[]) => ids.map(id => ({ id, file: { name: `${id}.png` } }))),
    releaseDraftImage,
  }
  installSendHook(conversation)
  return { conversation, releaseDraftImage, prompt }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepareImageForDescribe.mockResolvedValue({ ok: true, base64: 'AA==', mediaType: 'image/png' })
  mocks.uploadImage.mockResolvedValue({ ok: true, note: 'ok', markdown: 'ok' })
  mocks.commitImagePreviewBatch.mockResolvedValue({ ok: true })
  mocks.discardImageRoutingBatch.mockResolvedValue({ ok: true, discarded: true })
})

describe('send-hook routing rollback', () => {
  it('discards a fully uploaded batch when session.prompt returns failure and preserves drafts', async () => {
    const prompt = vi.fn().mockResolvedValue({ ok: false, error: { code: 'failed', message: 'nope' } })
    const { conversation, releaseDraftImage } = conversationWith(prompt)

    await conversation.sendSession(
      { sessionId: 'session-failed', prompt },
      'analyze',
      ['a'],
      'chat',
      new AbortController().signal,
    )

    expect(mocks.uploadImage).toHaveBeenCalledOnce()
    expect(prompt).toHaveBeenCalledOnce()
    expect(mocks.discardImageRoutingBatch).toHaveBeenCalledOnce()
    expect(mocks.discardImageRoutingBatch).toHaveBeenCalledWith('session-failed', expect.any(String))
    expect(mocks.commitImagePreviewBatch).not.toHaveBeenCalled()
    expect(releaseDraftImage).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('草稿图片已保留'), 'error')
  })

  it('discards a partially uploaded batch before returning the upload failure', async () => {
    mocks.uploadImage
      .mockResolvedValueOnce({ ok: true, note: 'ok', markdown: 'ok' })
      .mockResolvedValueOnce({ ok: false, message: 'network-failed' })
    const prompt = vi.fn()
    const { conversation, releaseDraftImage } = conversationWith(prompt)

    await conversation.sendSession(
      { sessionId: 'session-partial', prompt },
      'analyze',
      ['a', 'b'],
      'chat',
      new AbortController().signal,
    )

    expect(mocks.uploadImage).toHaveBeenCalledTimes(2)
    expect(mocks.discardImageRoutingBatch).toHaveBeenCalledOnce()
    expect(mocks.discardImageRoutingBatch).toHaveBeenCalledWith('session-partial', expect.any(String))
    expect(prompt).not.toHaveBeenCalled()
    expect(mocks.commitImagePreviewBatch).not.toHaveBeenCalled()
    expect(releaseDraftImage).not.toHaveBeenCalled()
  })

  it('discards before rethrowing a session.prompt exception', async () => {
    const failure = new Error('prompt exploded')
    const prompt = vi.fn().mockRejectedValue(failure)
    const { conversation, releaseDraftImage } = conversationWith(prompt)

    await expect(conversation.sendSession(
      { sessionId: 'session-throw', prompt },
      'analyze',
      ['a'],
      'chat',
      new AbortController().signal,
    )).rejects.toBe(failure)

    expect(mocks.discardImageRoutingBatch).toHaveBeenCalledOnce()
    expect(mocks.discardImageRoutingBatch).toHaveBeenCalledWith('session-throw', expect.any(String))
    expect(mocks.commitImagePreviewBatch).not.toHaveBeenCalled()
    expect(releaseDraftImage).not.toHaveBeenCalled()
  })

  it('does not discard a successful send', async () => {
    const prompt = vi.fn().mockResolvedValue({ ok: true })
    const { conversation, releaseDraftImage } = conversationWith(prompt)

    await conversation.sendSession(
      { sessionId: 'session-ok', prompt },
      'analyze',
      ['a'],
      'chat',
      new AbortController().signal,
    )

    expect(mocks.discardImageRoutingBatch).not.toHaveBeenCalled()
    expect(mocks.commitImagePreviewBatch).toHaveBeenCalledOnce()
    expect(releaseDraftImage).toHaveBeenCalledWith('a')
  })
})
