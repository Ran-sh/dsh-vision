# Verification debt — run as one unified validation pass

This file is the durable checklist for work that cannot be fully executed from the current GitHub-connector environment. Do not treat an unchecked item as verified merely because the corresponding code has deterministic unit tests.

## Targeted regression after the 2026-08-21 Codex real-DSH report

The source patches for the report's deterministic BLOCKER/HIGH failures and the static test-contract failures are now on `main`, but none of the items below is considered closed until rerun in the environment that originally exposed it.

- [ ] **F-001 / real DSH built bundle:** on Windows Node 24, run `npm run build && npm run test:built`, install the newly built package through the official DSH plugin mechanism, paste/send an image, and confirm `understand_image` completes without `Dynamic require of "node:crypto" is not supported`. This validates the ESM `createRequire(import.meta.url)` bridge against the shipped bundle rather than only source imports.
- [ ] **F-002 / user-visible routing secrecy:** in the real DSH web UI, send one and multiple images and confirm the user bubble contains only the user's text plus the neutral `已附加图片。` / `已附加 N 张图片。` marker. It must contain no `understand_image`, HTML routing comment, `sha256:` id, attachment JSON, MIME/dimension/byte metadata, or `/image-mind/raw/` URL.
- [ ] **F-002 / model-only routing availability:** inspect/trace one real DSH prompt assembly and confirm the `tool:image-mind` system-prompt section is present for the model even though the routing rule is absent from the user bubble. Verify image-only and vague image questions still cause the main model to call `understand_image` with omitted `image`/`images` for the current session batch.
- [ ] **F-003 / restart recovery:** send an image, record its raw id only in the test harness (not conversation text), restart the DSH host, verify `/image-mind/raw/<id>` returns HTTP 200, and ask the resumed session to inspect the image again. Confirm the host-side durable attachment index restores the complete `ImageAttachmentRef` and the model can read the persisted bytes.
- [ ] **F-004 / execution gate:** rerun the Windows Node 24 `execution-gate.test.ts` FIFO case and confirm the queued third operation starts after capacity is released without relying on a fixed microtask count. Also retain the aborted-waiter capacity assertion.
- [ ] **F-005 / circuit recovery:** rerun provider reliability tests and verify a provider is excluded during cooldown, exactly one half-open probe is admitted after cooldown, the probe actually enters the bounded fallback candidate set, success closes the circuit, and failure reopens it.
- [ ] **F-009 / trace contract:** rerun `tool-thin.test.ts` and `vision-orchestration.integration.test.ts`; confirm task budgeting no longer trips the provider-internals structural guard and orchestration explicitly reports the expected provider-call/cache/model-fallback trace on first and cached-fallback calls.
- [ ] **F-010 / Windows Node 24 benchmark transforms:** rerun the root benchmark test files that previously failed collection with `SyntaxError: Invalid or unexpected token`. The CLI modules no longer carry executable shebangs, but that is a targeted hypothesis until Vitest successfully collects and executes all three suites on the original Windows/Node 24 environment.
- [ ] Run the complete `npm ci && npm run typecheck && npm test && npm run build && npm run test:package && npm run test:built` lane after the targeted checks pass; do not treat piecemeal green reruns as a replacement for the full workspace pass.
- [ ] Only after the BLOCKER/HIGH targeted regression is green, rerun the browser Agent Routing cases T1–T5 and the broader real-DSH matrix. Do not spend Muse quota on a full quality benchmark while the integration path is still failing.

Items intentionally **not** patched merely to make the report green:

- Muse-listed Qwen models returned real `PROVIDER_ERROR` for all five visual probes; re-test when the gateway exposes a confirmed image-capable Qwen route rather than guessing a wire workaround.
- MiMo UI/long-screenshot provider errors and PNG/JPEG quality variance need controlled reproduction before changing preprocessing or adapter behavior.
- The 1440×20000 case reached the configured 1024-token provider cap. Re-test with an explicitly higher provider cap before changing the default or the hard-cap semantics; `effectiveMax = min(taskBudget, providerCap)` remains intentional.
- The stale `node_modules/dsh-plugin-image-mind` junction after official plugin removal appears to belong to DSH/pnpm plugin-manager cleanup and should not be "fixed" by image-mind deleting profile files itself.

## Local build / package matrix

- [ ] Linux + Node 22: `npm ci && npm run typecheck && npm test && npm run build && npm run test:package && npm run test:built`.
- [ ] Linux + Node 24: `npm ci && npm run typecheck && npm test && npm run build`.
- [ ] Windows + Node 22: `npm ci`, typecheck, tests, build, package integrity.
- [ ] Confirm generated `packages/vision/lib/types` includes the current task-router/token-budget/cache/selector/health/circuit/lifecycle contracts, `VisionRequest`, `VisionResult.trace`, `VisionTrace`, and traced `VisionError`, and that `dsh-plugin-image-mind` still installs against the published service dependency range.
- [ ] Run the official DSH plugin install/remove roundtrip in an isolated profile and confirm no stale bundle layer remains.
- [ ] Run `npm run benchmark:score -- benchmarks/vision/cases.example.jsonl benchmarks/vision/results.example.jsonl` and confirm the offline scorer is included in the normal repository test/build environment.
- [ ] Run `npm run benchmark:compare -- <cases> <baseline-results> <candidate-results>` on a controlled sample and verify a failing regression returns a non-zero process exit code while a passing comparison returns zero.

## Browser / DSH integration

- [ ] Drag and paste PNG/JPEG/WebP images in the DSH web UI; confirm send rewrite, preview, retry-on-failure, and draft retention.
- [ ] Confirm image-mind routing instructions and complete attachment metadata remain out of the rendered conversation UI; only the neutral attachment marker may be user-visible, while routing guidance reaches the model through the DSH system-prompt seam.
- [ ] Restart the DSH host after sending an image, then ask the model to inspect that old image again; verify the host-side durable attachment index restores the complete reference and the persisted attachment can still be read without embedding the reference in conversation text.
- [ ] Verify image-only sends reliably cause the main text model to call `understand_image` rather than answer without perception.
- [ ] Verify `cache=refresh` and `cache=no-store` are selected appropriately when the user asks to re-read / re-OCR an image.
- [ ] Verify layered evidence reuse is invisible to the normal UI: the main model receives useful visual evidence, while a second same-image/same-task question does not produce confusing stale wording or expose cache internals.
- [ ] Change active provider/model/settings after a reusable-evidence hit and verify the tool-level evidence cache is invalidated immediately.
- [ ] Subscribe to `ctx.vision.subscribeLifecycle()` during real DSH use and verify every routed call emits `started` then exactly one `completed` or `failed` event with the same request id.
- [ ] Inspect persisted/debug lifecycle records and confirm they contain no prompt text, image bytes, image references/paths, provider response text, endpoint URLs, Authorization values, or credentials. Deliberately throw/reject from a lifecycle observer and verify the user request still succeeds/fails only according to the adapter outcome.
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
- [ ] Task-aware output budget: configure a provider cap above the task defaults and verify OCR/document/code requests receive their larger task budget while photo requests receive the lower cost budget. Then configure a lower provider cap and verify it remains the hard maximum (`min(taskBudget, providerCap)`).
- [ ] Official OpenAI endpoint: with GPT-5.6, verify OCR/UI/code high-detail tasks send `detail: original`; with an older vision model such as GPT-4o verify the same tasks send `detail: high`; verify ordinary photo tasks send `detail: low` and general tasks use `auto`. Compare OCR recall, image input tokens and latency against `auto`/no-detail baselines before keeping the policy.
- [ ] Non-OpenAI compatible endpoints (at minimum DashScope, Gemini-compatible, OpenRouter or a local endpoint): inspect received/mock request bodies and confirm OpenAI-specific `detail` is absent. A compatible endpoint must never start returning 400 solely because this optimization exists.
- [ ] At least one endpoint that returns HTTP 413 for a multi-image payload: verify recursive split, merged evidence, stable original image numbering, and trace `splits/providerCalls/payloadBytes` against observed requests.
- [ ] At least one endpoint returning 429 + `Retry-After`: verify retry delay, global execution-gate interaction, and trace retry counters.
- [ ] At least one endpoint returning deterministic 400/404: verify no repeated wire request and no automatic cross-provider traffic.
- [ ] Cross-provider recovery: configure primary + three backups, force the configured first backup to become slow/unhealthy, and verify health-aware fallback ordering prefers healthier candidates while preserving initial configuration order before observations.
- [ ] Circuit breaker: force one backup through three provider-level failures, verify it is excluded during the 30s cooldown, then verify exactly one half-open recovery attempt can re-enter selection and a success closes the circuit.
- [ ] Confirm explicit `provider` or `model`, 401/403, deterministic 4xx, model-incompatibility errors, and response-shape errors do not degrade provider health or trigger automatic rerouting.
- [ ] Compare `VisionResult.trace`/traced `VisionError` counters with server/provider request logs for provider calls, serialized payload bytes, cache hits, retries, model fallback, provider fallback, and split events.
- [ ] Compare completed/failed lifecycle event trace metadata with the corresponding `VisionResult.trace`/`VisionError.trace`; counters must agree and lifecycle observers must not introduce extra provider calls.
- [ ] Compare `VisionResult.usage.inputTokens/outputTokens` against provider dashboards/logs for both Chat Completions and Responses APIs. For a real 413 split, verify the returned usage equals the sum of successful child calls and never includes guessed values.
- [ ] Caller cancellation during an in-flight request and during retry delay: verify no extra retry/fallback request is sent and cancellation is not recorded as a retry or provider-health failure; the lifecycle failed event should report `aborted: true` without exposing the abort reason text.

## Layered evidence cache quality / cost validation

- [ ] For OCR, document, UI, code, chart, screenshot, translation and compare tasks: ask two materially different questions about the same image(s) inside the 5-minute window. Confirm the second call uses zero provider calls when the first reusable evidence is sufficient.
- [ ] Measure visual-fact recall on second questions versus a forced `cache=refresh` baseline. Reuse must not materially increase omission/hallucination rate.
- [ ] Include deliberately narrow follow-up questions (tiny UI icon, one table cell, one code line). If cached broad evidence is insufficient, confirm the main model can recover by issuing a fresh/refocused call rather than fabricating an answer.
- [ ] Confirm ordinary photo/general questions stay question-specific and do not use the layered evidence cache.
- [ ] Confirm explicit provider/model requests bypass layered evidence reuse and reach the selected backend.
- [ ] Confirm `cache=no-store` bypasses both tool-level reusable evidence and adapter semantic cache, while `cache=refresh` replaces reusable evidence with a fresh pixel analysis.
- [ ] Record provider-call reduction, token reduction, latency change and answer-quality delta versus exact semantic cache only.

## Visual quality benchmark

- [ ] Build/freeze a representative 100-task corpus: 20 UI screenshots, 20 IDE/terminal, 20 document/OCR, 15 charts, 15 photos, 10 multi-image compare/diff.
- [ ] Record per task: tool-routing success, OCR accuracy, visual-fact recall, hallucination/error rate, task completion, latency, provider/model, provider calls, payload bytes, cache hits, token usage when disclosed, retries, model fallback, provider fallback, 413 split count, and layered-evidence hit/miss behavior.
- [ ] Require trace coverage and token-usage coverage to be reported separately from totals. Missing telemetry must never be interpreted as zero cost; cost ratios are comparable only once both baseline and candidate meet the scorer's coverage threshold.
- [ ] Compare the current main branch against the last public 0.1.1 behavior using the same prompts/images/provider settings.
- [ ] Run the new `benchmark:compare` regression gate on the frozen corpus and keep its JSON report/exit status with the release evidence. Do not loosen task-success or forbidden-hit thresholds merely to make a cost optimization pass.
- [ ] Verify split multi-image benchmark answers continue to use original `Image N` labels (including recursive single-image children), rather than batch-local numbering.
- [ ] Compare direct question-specific VLM answers with the new reusable-evidence → DeepSeek reasoning path on the same cases; retain the cache only if quality stays within the agreed regression threshold while reducing provider work.
- [ ] Add CI threshold enforcement only after the corpus and provider environment are stable enough to avoid noisy failures.

## GitHub Actions visibility

- [ ] Confirm push-triggered Actions for the optimization commits are green. The current connector exposes empty legacy commit statuses and does not expose the direct-push check-runs, so this must be verified in GitHub Actions or a local checkout later.

## Exit criteria

A future release candidate is not considered fully verified until all build/package items are checked, the browser restart/attachment and long-screenshot scenarios pass, at least two hosted providers plus one local provider pass the real-provider matrix, lifecycle metadata is verified content-safe, health/circuit behavior matches observed provider traffic, token usage matches provider-reported counters, task budgets obey provider caps, official-OpenAI detail policy shows a measured quality/cost benefit without breaking compatible endpoints, layered evidence reuse demonstrates a measurable provider-call reduction without a material quality regression, trace counters match observed traffic, and the frozen benchmark comparison gate passes versus the chosen baseline.
