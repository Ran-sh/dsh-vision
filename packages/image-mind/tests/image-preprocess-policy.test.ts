import { describe, expect, it } from 'vitest'
import {
  imagePreprocessPolicy,
  LOSSY_COMPRESS_MAX_EDGE,
  PNG_COMPRESS_MAX_EDGE,
} from '../src/client/attach.ts'

describe('image preprocessing policy', () => {
  it('keeps PNG screenshots lossless and at a higher resolution budget', () => {
    expect(imagePreprocessPolicy('image/png')).toEqual({
      maxEdge: PNG_COMPRESS_MAX_EDGE,
      outputType: 'image/png',
    })
    expect(PNG_COMPRESS_MAX_EDGE).toBeGreaterThan(LOSSY_COMPRESS_MAX_EDGE)
  })

  it.each(['image/jpeg', 'image/webp'])('uses the photographic lossy policy for %s', (mediaType) => {
    expect(imagePreprocessPolicy(mediaType)).toEqual({
      maxEdge: LOSSY_COMPRESS_MAX_EDGE,
      outputType: 'image/jpeg',
      quality: 0.85,
    })
  })

  it('does not preprocess GIF or unknown media types', () => {
    expect(imagePreprocessPolicy('image/gif')).toBeUndefined()
    expect(imagePreprocessPolicy('application/octet-stream')).toBeUndefined()
  })
})
