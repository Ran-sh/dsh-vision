# Verification debt — run as one unified validation pass

This file is the durable checklist for work that cannot be fully executed from the current GitHub-connector environment. Do not treat an unchecked item as verified merely because the corresponding code has deterministic unit tests.

## Local build / package matrix

- [ ] Linux + Node 22: `npm ci && npm run typecheck && npm test && npm run build && npm run test:package && npm run test:built`.
- [ ] Linux + Node 24: `npm ci && npm run typecheck && npm test && npm run build`.
- [ ] Windows + Node 22: `npm ci`, typecheck, tests, build, package integrity.
- [ ] Confirm generated `packages/vision/lib/types` includes the current `VisionRequest` contract and that `dsh-plugin-image-mind` still installs against the published service dependency range.
- [ ] Run the official DSH plugin install/remove roundtrip in an isolated profile and confirm no stale bundle layer remains.

## Browser / DSH integration

- [ ] Drag and paste PNG/JPEG/WebP images in the DSH web UI; confirm send rewrite, preview, retry-on-failure, and draft retention.
- [ ] Confirm the hidden `image-mind` routing comment and hidden full attachment note do not render visibly in the conversation UI.
- [ ] Restart the DSH host after sending an image, then ask the model to inspect that old image again; verify the complete attachment reference survives in conversation text and the persisted attachment can still be read.
- [ ] Verify image-only sends reliably cause the main text model to call `understand_image` rather than answer without perception.
- [ ] Verify `cache=refresh` and `cache=no-store` are selected appropriately when the user asks to re-read / re-OCR an image.

## Real provider matrix

Run with real credentials only in a controlled environment; never record keys in logs or fixtures.

- [ ] Opencode Go: default model, known-plan model fallback, multi-image, OCR screenshot quality.
- [ ] Command Code Goat: vendor-prefixed model ids, fallback order, structured content response parsing.
- [ ] DashScope / Qwen-VL: OCR/document/chart cases and 8-image request.
- [ ] Gemini OpenAI-compatible endpoint: chat-completions compatibility and model discovery.
- [ ] OpenAI-compatible Responses endpoint: `output_text` and message-part parsing.
- [ ] Ollama / LM Studio keyless local endpoints with `allowPrivateNetwork` policy as intended.
- [ ] At least one endpoint that returns HTTP 413 for a multi-image payload: verify recursive split, merged evidence, and stable original image numbering.
- [ ] At least one endpoint returning 429 + `Retry-After`: verify retry delay and global execution-gate interaction.
- [ ] At least one endpoint returning deterministic 400/404: verify no repeated wire request.

## Visual quality benchmark

- [ ] Build/freeze a representative 100-task corpus: 20 UI screenshots, 20 IDE/terminal, 20 document/OCR, 15 charts, 15 photos, 10 multi-image compare/diff.
- [ ] Record per task: tool-routing success, OCR accuracy, visual-fact recall, hallucination/error rate, task completion, latency, provider/model, call count, payload bytes, retries, model fallback, provider fallback, and 413 split count.
- [ ] Compare the current main branch against the last public 0.1.1 behavior using the same prompts/images/provider settings.
- [ ] Add threshold gates only after the corpus is stable enough to avoid noisy CI.

## GitHub Actions visibility

- [ ] Confirm push-triggered Actions for the optimization commits are green. The current connector exposes empty legacy commit statuses and does not expose the direct-push check-runs, so this must be verified in GitHub Actions or a local checkout later.

## Exit criteria

A future release candidate is not considered fully verified until all build/package items are checked, the browser restart/attachment scenario passes, at least two hosted providers plus one local provider pass the real-provider matrix, and the visual benchmark shows no regression versus 0.1.1 on routing success or hallucination rate.
