import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  imagePreprocessPolicy,
  prepareImageForDescribe,
  targetImageDimensions,
  LOSSY_COMPRESS_MAX_EDGE,
  PNG_COMPRESS_MAX_EDGE,
  PNG_LONG_COMPRESS_MAX_EDGE,
  PNG_MAX_PIXELS,
  LONG_SCREENSHOT_ASPECT_RATIO,
} from '../src/client/attach.ts'

afterEach(() => vi.unstubAllGlobals())

describe('image preprocessing policy', () => {
  it('keeps normal PNG screenshots lossless with a bounded pixel budget', () => {
    expect(imagePreprocessPolicy('image/png', 1600, 1200)).toEqual({
      maxEdge: PNG_COMPRESS_MAX_EDGE,
      maxPixels: PNG_MAX_PIXELS,
      outputType: 'image/png',
    })
    expect(PNG_COMPRESS_MAX_EDGE).toBeGreaterThan(LOSSY_COMPRESS_MAX_EDGE)
  })

  it('gives long PNG screenshots more edge resolution without removing the pixel cap', () => {
    expect(10000 / 1440).toBeGreaterThan(LONG_SCREENSHOT_ASPECT_RATIO)
    const policy = imagePreprocessPolicy('image/png', 1440, 10000)!
    expect(policy.maxEdge).toBe(PNG_LONG_COMPRESS_MAX_EDGE)
    expect(policy.maxPixels).toBe(PNG_MAX_PIXELS)

    const target = targetImageDimensions(1440, 10000, policy)
    expect(target.scaled).toBe(true)
    expect(target.height).toBe(PNG_LONG_COMPRESS_MAX_EDGE)
    // The old 3072-long-edge policy would leave roughly 442px of width;
    // retain substantially more horizontal text resolution.
    expect(target.width).toBeGreaterThan(1000)
    expect(target.width * target.height).toBeLessThanOrEqual(PNG_MAX_PIXELS)
  })

  it('keeps a substantially taller 1440x20000 page within the same bounded geometry', () => {
    const policy = imagePreprocessPolicy('image/png', 1440, 20000)!
    const target = targetImageDimensions(1440, 20000, policy)
    expect(target.scaled).toBe(true)
    expect(target.height).toBe(PNG_LONG_COMPRESS_MAX_EDGE)
    expect(target.width).toBeGreaterThan(500)
    expect(target.width * target.height).toBeLessThanOrEqual(PNG_MAX_PIXELS)
  })

  it('runs the browser preprocessing flow for a 1440x20000 PNG', async () => {
    let canvasSize: { width: number; height: number } | undefined
    const bitmap = { width: 1440, height: 20000, close: vi.fn() }
    vi.stubGlobal('FileReader', class {
      result: string | ArrayBuffer | null = null
      onload?: () => void
      onerror?: () => void
      readAsDataURL(blob: Blob): void {
        blob.arrayBuffer().then(bytes => {
          this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`
          this.onload?.()
        }).catch(() => this.onerror?.())
      }
    })
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }),
          toBlob: (callback: (blob: Blob | null) => void, type?: string) => {
            canvasSize = { width: canvas.width, height: canvas.height }
            callback(new Blob([new Uint8Array(1024)], { type }))
          },
        }
        return canvas
      },
    })

    const file = new File([
      readFileSync(resolve(import.meta.dirname, '../../../benchmarks/vision/fixtures/generated/long-1440x20000.png')),
    ], 'long.png', { type: 'image/png' })
    expect(file.size).toBeGreaterThan(80_000)
    const result = await prepareImageForDescribe(file)
    expect(result).toMatchObject({ ok: true, mediaType: 'image/png' })
    expect(createImageBitmap).toHaveBeenCalledWith(file)
    expect(canvasSize).toEqual({ width: 590, height: 8192 })
    expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it('uses the pixel cap when a moderately elongated PNG would otherwise exceed it', () => {
    const policy = imagePreprocessPolicy('image/png', 2500, 6250)!
    const target = targetImageDimensions(2500, 6250, policy)
    expect(target.scaled).toBe(true)
    expect(target.width * target.height).toBeLessThanOrEqual(PNG_MAX_PIXELS + Math.max(target.width, target.height))
    expect(target.height).toBeLessThan(PNG_LONG_COMPRESS_MAX_EDGE)
  })

  it.each(['image/jpeg', 'image/webp'])('uses the photographic lossy policy for %s', (mediaType) => {
    expect(imagePreprocessPolicy(mediaType, 6000, 4000)).toEqual({
      maxEdge: LOSSY_COMPRESS_MAX_EDGE,
      outputType: 'image/jpeg',
      quality: 0.85,
    })
    expect(targetImageDimensions(6000, 4000, imagePreprocessPolicy(mediaType, 6000, 4000)!)).toMatchObject({
      width: 2048,
      height: 1365,
      scaled: true,
    })
  })

  it('does not preprocess GIF or unknown media types', () => {
    expect(imagePreprocessPolicy('image/gif')).toBeUndefined()
    expect(imagePreprocessPolicy('application/octet-stream')).toBeUndefined()
  })
})
