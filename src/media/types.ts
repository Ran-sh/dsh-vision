/**
 * Image media facts for image-mind: the accepted media types, the magic-byte
 * gate, the strict base64 decoder, and the byte bound both the tool and the
 * attach route enforce. Self-contained so the attach route can import it
 * without a cycle through the plugin entry.
 * @module dsh-plugin-image-mind/media/types
 */

/** Image media types the magic-byte gate accepts. */
export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

/** The accepted image media types, in stable order. */
export const IMAGE_MEDIA_TYPES: readonly ImageMimeType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** Upper bound on image bytes (local files and downloaded URLs alike). */
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

/** One loaded image: its bytes and the sniffed media type. */
export interface LoadedImage {
  bytes: Buffer
  mimeType: ImageMimeType
}

/** Whether the declared media type is one the plugin accepts. */
export function isImageMimeType(value: unknown): value is ImageMimeType {
  return typeof value === 'string' && (IMAGE_MEDIA_TYPES as readonly string[]).includes(value)
}
