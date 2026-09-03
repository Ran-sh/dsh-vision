/**
 * Send-hook lifecycle: install / dispose / reinstall must leave exactly one
 * interception, restore the exact original on dispose, and never clobber a
 * wrapper a later plugin installed on top of ours.
 * @vitest-environment node
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { installSendHook } from '../src/client/send-hook.ts'

const mocks = vi.hoisted(() => ({
  prepareImageForDescribe: vi.fn(),
  uploadImage: vi.fn(),
  commitImagePreviewBatch: vi.fn(),
  discardImageRoutingBatch: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../src/client/attach.ts', () => ({
  prepareImageForDescribe: mocks.prepareImageForDescribe,
  uploadImage: mocks.uploadImage,
  commitImagePreviewBatch: mocks.commitImagePreviewBatch,
  discardImageRoutingBatch: mocks.discardImageRoutingBatch,
}))
vi.mock('../src/client/toast.ts', () => ({ showToast: mocks.showToast }))

function makeConversation() {
  const originalSendSession = vi.fn().mockResolvedValue({ ok: true })
  const conversation = {
    send: vi.fn(),
    sendSession: originalSendSession,
    draftImages: vi.fn((ids: readonly string[]) => ids.map(id => ({ id, file: { name: `${id}.png` } }))),
    releaseDraftImage: vi.fn(),
  }
  return { conversation, originalSendSession }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepareImageForDescribe.mockResolvedValue({ ok: true, base64: 'AA==', mediaType: 'image/png' })
  mocks.uploadImage.mockResolvedValue({ ok: true, note: 'ok', markdown: 'ok' })
  mocks.commitImagePreviewBatch.mockResolvedValue({ ok: true })
  mocks.discardImageRoutingBatch.mockResolvedValue({ ok: true, discarded: true })
})

describe('send-hook lifecycle', () => {
  it('restores the exact original sendSession on dispose', () => {
    const { conversation, originalSendSession } = makeConversation()
    const dispose = installSendHook(conversation)
    expect(conversation.sendSession).not.toBe(originalSendSession)

    dispose()
    expect(conversation.sendSession).toBe(originalSendSession)
  })

  it('can install again after dispose (reload path)', async () => {
    const { conversation, originalSendSession } = makeConversation()
    const dispose1 = installSendHook(conversation)
    dispose1()
    expect(conversation.sendSession).toBe(originalSendSession)

    const dispose2 = installSendHook(conversation)
    expect(conversation.sendSession).not.toBe(originalSendSession)

    // The re-installed wrapper still intercepts an image send exactly once.
    await conversation.sendSession(
      { sessionId: 's-reload', prompt: vi.fn().mockResolvedValue({ ok: true }) },
      'look',
      ['img-1'],
      'chat',
      new AbortController().signal,
    )
    expect(mocks.uploadImage).toHaveBeenCalledOnce()
    expect(conversation.releaseDraftImage).toHaveBeenCalledWith('img-1')
    dispose2()
    expect(conversation.sendSession).toBe(originalSendSession)
  })

  it('installing twice is a no-op and disposing once restores the original', () => {
    const { conversation, originalSendSession } = makeConversation()
    const dispose1 = installSendHook(conversation)
    const first = conversation.sendSession
    const dispose2 = installSendHook(conversation)
    // Second install must not double-wrap.
    expect(conversation.sendSession).toBe(first)

    dispose1()
    expect(conversation.sendSession).toBe(originalSendSession)
    // The second (no-op) disposer is safe to call and changes nothing.
    dispose2()
    expect(conversation.sendSession).toBe(originalSendSession)
  })

  it('dispose does not clobber a wrapper installed later by another plugin', () => {
    const { conversation, originalSendSession } = makeConversation()
    const disposeMine = installSendHook(conversation)
    const myWrapper = conversation.sendSession

    // Another plugin chains its own wrapper on top.
    const otherWrapper = vi.fn(async (session: unknown, text: string) => {
      await myWrapper(session, text, [], 'chat')
    })
    conversation.sendSession = otherWrapper

    disposeMine()
    // We only remove our own wrapper when we are still the installed face;
    // since another plugin is on top, we must leave the chain untouched.
    expect(conversation.sendSession).toBe(otherWrapper)
    expect(originalSendSession).not.toHaveBeenCalled()
  })

  it('plugin unload means an image-less send goes straight through the original', async () => {
    const { conversation, originalSendSession } = makeConversation()
    const dispose = installSendHook(conversation)
    dispose()
    const prompt = vi.fn().mockResolvedValue({ ok: true })
    await conversation.sendSession({ sessionId: 's', prompt }, 'no images', [], 'chat')
    expect(originalSendSession).toHaveBeenCalledOnce()
    expect(mocks.uploadImage).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
  })

  it('reload leaves exactly one interception for one active install', async () => {
    const { conversation, originalSendSession } = makeConversation()
    // First load installs, then unloads.
    installSendHook(conversation)()
    expect(conversation.sendSession).toBe(originalSendSession)

    // Second load installs once more.
    installSendHook(conversation)
    const prompt = vi.fn().mockResolvedValue({ ok: true })
    await conversation.sendSession(
      { sessionId: 's', prompt },
      'look',
      ['a', 'b'],
      'chat',
      new AbortController().signal,
    )
    expect(mocks.uploadImage).toHaveBeenCalledTimes(2)
    expect(conversation.releaseDraftImage).toHaveBeenCalledTimes(2)
    expect(originalSendSession).not.toHaveBeenCalled()
  })
})
