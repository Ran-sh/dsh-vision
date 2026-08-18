/**
 * End-to-end verification of the image-mind vision pipeline against the
 * user's real vision endpoint (opencode.ai, m=imo model as previously
 * configured for describe-image). Loads the built source through Node's
 * native type stripping, calls loadImage + callVision, and prints the model's
 * answer. The API key is read from the DSH credential store and never
 * printed.
 */
import { readFile } from 'node:fs/promises'
import { resolveConfig } from '../src/config.ts'
import { callVision, loadImage } from '../src/vision.ts'

const keyRaw = await readFile(process.env.HOME + '/.dsh/.credentials.yaml', 'utf8')
const keyMatch = /OPENCODE_GO_API_KEY:\s*(['"]?)(.+?)\1\s*$/.exec(keyRaw.trim())
if (keyMatch === null) {
  console.error('FAIL: OPENCODE_GO_API_KEY not found in credential store')
  process.exit(1)
}
const apiKey = keyMatch[2]

const config = resolveConfig({
  baseURL: 'https://opencode.ai/zen/go/v1',
  model: 'mimo-v2.5',
  apiKey,
  apiStyle: 'chat-completions',
  maxOutputTokens: 256,
  timeoutMs: 45_000,
})

const imagePath = process.env.TEMP + '/test-1x1.png'
const ctx = { get: () => undefined } as never

const image = await loadImage(ctx, imagePath, new AbortController().signal, config.maxBytes)
console.log(`loaded image: ${image.mimeType}, ${image.bytes.length} bytes`)

const answer = await callVision(config, apiKey, 'What color is this image? Answer with one word.', image, new AbortController().signal)
console.log(`VISION ANSWER: ${answer}`)
console.log('E2E OK')