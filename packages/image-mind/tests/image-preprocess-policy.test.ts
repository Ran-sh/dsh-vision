import { describe, expect, it } from 'vitest'
import {
  imagePreprocessPolicy,
  targetImageDimensions,
  LOSSY_COMPRESS_MAX_EDGE,
  PNG_COMPRESS_MAX_EDGE,
  PNG_LONG_COMPRESS_MAX_EDGE,
  PNG_MAX_PIXELS,
  LONG_SCREENSHOT_ASPECT_RATIO,
} from '../src/client/attach.ts'

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
