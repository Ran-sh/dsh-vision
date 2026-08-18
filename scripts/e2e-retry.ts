/**
 * Deterministic verification of the callVision retry policy using a mocked
 * global fetch: (1) HTTP 500 then success retries once, (2) HTTP 401 never
 * retries, (3) a network error retries once, (4) a first-try success does one
 * call. Runs against the source modules via Node's native type stripping.
 */
import { callVision } from '../src/vision.ts'
import type { ResolvedConfig } from '../src/config.ts'

const spec: ResolvedConfig = {
  baseURL: 'https://mock.example/v1', model: 'mock-vl', apiKey: 'k', apiKeyEnv: undefined,
  defaultPrompt: '', maxBytes: 1_000_000, maxOutputTokens: 64, timeoutMs: 5000,
  apiStyle: 'chat-completions', renderImagePreview: true,
}
const image = { bytes: Buffer.from('not-a-real-image'), mimeType: 'image/png' as const }
const signal = new AbortController().signal

const ok = (text: string): Response => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200, headers: { 'content-type': 'application/json' } })

let calls = 0
let fail = 0

async function check(name: string, world: () => Promise<Response>, expectedCalls: number, expectThrow: boolean): Promise<void> {
  calls = 0
  globalThis.fetch = async () => { calls += 1; return world() }
  try {
    const text = await callVision(spec, 'k', `p-${++fail}`, image, signal)
    const ok = !expectThrow && calls === expectedCalls && text.length > 0
    console.log(`${name}: calls=${calls} (期望 ${expectedCalls}) ${ok ? 'PASS' : 'FAIL'}`)
  } catch (error) {
    const ok = expectThrow && calls === expectedCalls
    console.log(`${name}: calls=${calls} (期望 ${expectedCalls}) threw -> ${(error as Error).message.slice(0, 70)} ${ok ? 'PASS' : 'FAIL'}`)
  }
}

await check('500-echo (重试一次后成功)', async () => (calls === 1 ? new Response('boom', { status: 500 }) : ok('retried-ok')), 2, false)
await check('401 (不重试)', async () => new Response('nope', { status: 401 }), 1, true)
await check('网络错误 (重试一次)', async () => { if (calls === 1) throw new TypeError('fetch failed (mock)'); return ok('network-ok') }, 2, false)
await check('一次成功 (单次调用)', async () => ok('first-ok'), 1, false)