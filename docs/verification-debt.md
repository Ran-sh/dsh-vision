# Verification debt — run as one unified validation pass

This file is the durable checklist for work that cannot be fully executed from the current GitHub-connector environment. Do not treat an unchecked item as verified merely because the corresponding code has deterministic unit tests.

## Local build / package matrix

- [ ] Linux + Node 22: `npm ci && npm run typecheck && npm test && npm run build && npm run test:package && npm run test:built`.
- [ ] Linux + Node 24: `npm ci && npm run typecheck && npm test && npm run build`.
- [ ] Windows + Node 22: `npm ci`, typecheck, tests, build, package integrity.
- [ ] Confirm generated `packages/vision/lib/types` includes the current `VisionRequest`, `VisionResult.trace`, `VisionTrace`, and traced `VisionError` contract, and that `dsh-plugin-image-mind` still installs against the published service dependency range.
- [ ] Run the official DSH plugin install/remove roundtrip in an isolated profile and confirm no stale bundle layer remains.
- [ ] Run `npm run benchmark:score -- benchmarks/vision/cases.example.jsonl benchmarks/vision/results.example.jsonl` and confirm the offline scorer is included in the normal repository test/build environment.

## Browser / DSH integration

- [ ] Drag and paste PNG/JPEG/WebP images in the DSH web UI; confirm send rewrite, preview, retry-on-failure, and draft retention.
- [ ] Confirm the hidden `image-mind` routing comment and hidden full attachment note do not render visibly in the conversation UI.
- [ ] Restart the DSH host after sending an image, then ask the model to inspect that old image again; verify the complete attachment reference survives in conversation text and the persisted attachment can still be read.
- [ ] Verify image-only sends reliably cause the main text model to call `understand_image` rather than answer without perception.
- [ ] Verify `cache=refresh` and `cache=no-store` are selected appropriately when the user asks to re-read / re-OCR an image.
- [ ] Verify long PNG screenshots (for example 1440×10000 and substantially taller web pages) keep legible horizontal text after browser canvas preprocessing and stay under the intended pixel/byte budget.
- [ ] Compare the new aspect/pixel-aware PNG preprocessing against the old 3072-long-edge behavior on OCR-heavy long pages; confirm quality improves without unacceptable upload latency/memory use.

## Real provider matrix

Run with real credentials only in a controlled environment; never record keys in logs or fixtures.

- [ ] Opencode Go: default model, known-plan model fallback, multi-image, OCR screenshot quality.
- [ ] Command Code Goat: vendor-prefixed model ids, fallback order, structured content response parsing.
- [ ] DashScope / Qwen-VL: OCR/document/chart cases and 8-image request.
- [ ] Gemini OpenAI-compatible endpoint: chat-completions compatibility and model discovery.
- [ ] OpenAI-compatible Responses endpoint: `output_text` and message-part parsing.
- [ ] Ollama / LM Studio keyless local endpoints with `allowPrivateNetwork` policy as intended.
- [ ] At least one endpoint that returns HTTP 413 for a multi-image payload: verify recursive split, merged evidence, stable original image numbering, and trace `splits/providerCalls/payloadBytes` against observed requests.
- [ ] At least one endpoint returning 429 + `Retry-After`: verify retry delay, global execution-gate interaction, and trace retry counters.
- [ ] At least one endpoint returning deterministic 400/404: verify no repeated wire request and no automatic cross-provider traffic.
- [ ] Cross-provider recovery: configure primary + two backups, force primary 5xx/timeout/429 exhaustion, and verify ordered bounded recovery. Confirm explicit `provider` or `model`, 401/403, deterministic 4xx, and response-shape errors do not reroute.
- [ ] Compare `VisionResult.trace`/traced `VisionError` counters with server/provider request logs for provider calls, serialized payload bytes, cache hits, retries, model fallback, provider fallback, and split events.
- [ ] Caller cancellation during an in-flight request and during retry delay: verify no extra retry/fallback request is sent and cancellation is not recorded as a retry.

## Visual quality benchmark

- [ ] Build/freeze a representative 100-task corpus: 20 UI screenshots, 20 IDE/terminal, 20 document/OCR, 15 charts, 15 photos, 10 multi-image compare/diff.
- [ ] Record per task: tool-routing success, OCR accuracy, visual-fact recall, hallucination/error rate, task completion, latency, provider/model, call count, payload bytes, token usage when disclosed, retries, model fallback, provider fallback, and 413 split count.
- [ ] Compare the current main branch against the last public 0.1.1 behavior using the same prompts/images/provider settings.
- [ ] Verify split multi-image benchmark answers continue to use original `Image N` labels (including recursive single-image children), rather than batch-local numbering.
- [ ] Add threshold gates only after the corpus is stable enough to avoid noisy CI.

## GitHub Actions visibility

- [ ] Confirm push-triggered Actions for the optimization commits are green. The current connector exposes empty legacy commit statuses and does not expose the direct-push check-runs, so this must be verified in GitHub Actions or a local checkout later.

## Exit criteria

A future release candidate is not considered fully verified until all build/package items are checked, the browser restart/attachment and long-screenshot scenarios pass, at least two hosted providers plus one local provider pass the real-provider matrix, trace counters match observed traffic, and the visual benchmark shows no regression versus 0.1.1 on routing success or hallucination rate.
