/**
 * Connectivity self-test through the running server's /image-mind/test route:
 * reports whether the deployment connects exactly as an in-app call would,
 * including the host-context quirks the endpoint may apply. Requires the web
 * server to be up.
 */
const base = 'http://127.0.0.1:3080/image-mind/test'
const response = await fetch(base, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
})
const envelope = await response.json() as { ok?: boolean; value?: { text?: string }; error?: { message?: string } }
if (envelope.ok === true && typeof envelope.value?.text === 'string') {
  console.log(`TEST CONNECTION OK — 模型回复: ${envelope.value.text}`)
} else {
  console.log(`TEST CONNECTION FAIL — ${envelope.error?.message ?? `HTTP ${response.status}`}`)
  process.exit(1)
}
