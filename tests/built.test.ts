/**
 * Built-artifact verification (`npm run test:built`): after `npm run build`,
 * import the REAL `packages/image-mind/lib/index.js` bundle and prove the
 * visual-challenge machinery ships with it — the embedded PNG fixtures decode
 * to valid 32x32 images, the challenge matcher answers, and the connection-test
 * RPC is present. This closes the source-vs-artifact gap: the published
 * package has no tests/ directory, so fixtures must live inside the bundle.
 * @vitest-environment node
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const LIB_PATH = resolve(import.meta.dirname, '../packages/image-mind/lib/index.js')

interface BuiltLib {
  runConnectionTest?: unknown
  listEndpointModels?: unknown
  answerMatches?: (reply: string, color: string) => boolean
  VISUAL_FIXTURES?: ReadonlyArray<{ color: string; bytes: Uint8Array }>
}

/** Parse the PNG IHDR width/height (bytes 16-23 of a PNG, big-endian). */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24) return undefined
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic[i]) return undefined
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('built artifact (packages/image-mind/lib/index.js)', () => {
  let lib: BuiltLib | undefined

  beforeAll(async () => {
    if (!existsSync(LIB_PATH)) return
    try {
      lib = await import(LIB_PATH)
    } catch {
      lib = undefined
    }
  })

  it('exists (run npm run build first)', () => {
    expect(lib, 'lib/index.js missing — run npm run build').toBeDefined()
  })

  it('exports the connection-test RPC', () => {
    expect(typeof lib?.runConnectionTest).toBe('function')
    expect(typeof lib?.listEndpointModels).toBe('function')
  })

  it('ships the embedded visual-challenge fixtures as valid 32x32 PNGs', () => {
    const fixtures = lib?.VISUAL_FIXTURES
    expect(Array.isArray(fixtures)).toBe(true)
    expect(fixtures?.length).toBeGreaterThanOrEqual(3)
    const colors = fixtures?.map(fixture => fixture.color) ?? []
    expect(colors).toContain('red')
    expect(colors).toContain('blue')
    expect(colors).toContain('green')
    for (const fixture of fixtures ?? []) {
      expect(pngDimensions(fixture.bytes), `${fixture.color} fixture must be a valid 32x32 PNG`).toEqual({ width: 32, height: 32 })
    }
  })

  it('challenge matcher answers in the built artifact', () => {
    expect(lib?.answerMatches?.('blue', 'blue')).toBe(true)
    expect(lib?.answerMatches?.('Blue sky!', 'blue')).toBe(true)
    expect(lib?.answerMatches?.('a cat', 'red')).toBe(false)
  })
})
