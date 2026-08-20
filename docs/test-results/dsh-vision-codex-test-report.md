# dsh-vision Codex Real DSH Test Report

## 1. Test Identity

| Field | Value |
|---|---|
| Repository | `Ran-sh/dsh-vision` |
| Branch | `main` |
| Source Commit SHA | `87ce605d1ddfac27ab0cc916a7abda59b8b8b8c4` |
| Report Commit SHA | `PENDING` — the report commit is self-referential; the final chat records the pushed SHA |
| Dirty Before | Clean |
| Dirty After | Clean before report creation; only this report and ACTIVE prompt deletion are intended for the report commit |
| Date | 2026-08-21 (Asia/Shanghai) |
| OS | Windows 11 Pro x64, Windows_NT 10.0.22631 |
| Node | v24.18.1 |
| npm | 11.16.0 |
| DSH Version | 0.1.0-rc.7 |
| Package versions | `@ran-sh/dsh-vision` 0.1.0; `dsh-plugin-image-mind` 0.1.1 |
| DSH Profiles | `github-e2e` for isolated add/remove/reinstall; `web` temporarily installed for browser testing, then restored |
| Codex Environment | Windows Codex, workspace-write; in-app browser for localhost UI |
| Test Mode | **TEST ONLY / REPORT-ONLY COMMIT** |

No implementation, existing test, package version, or repository configuration was intentionally modified.

Count convention: the final summary counts distinct command/assertion/scenario checks and does not double-count the targeted reruns of assertions already included in `npm test`. Required but unavailable matrix items are counted as SKIP/BLOCKED.

## 2. Real API / Model Matrix

- Gateway: **Opencode Go package → Muse API**
- Real independent gateway count: **1**
- Base URL host: `opencode.ai`
- API style: `chat-completions`
- Credential: **PRESENT** (value never printed or recorded)
- Discovery: endpoint `/models`, HTTP 200, 27 IDs

Endpoint roster:

`minimax-m3`, `minimax-m2.7`, `minimax-m2.5`, `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k2.5`, `glm-5.2`, `glm-5.3`, `glm-5.1`, `glm-5`, `deepseek-v4-pro`, `deepseek-v4-flash`, `qwen3.7-max`, `qwen3.8-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.5-plus`, `mimo-v2-pro`, `mimo-v2-omni`, `mimo-v2.5-pro`, `mimo-v2.5`, `hy3`, `hy3-preview`, `gpt-5.6-luna`, `grok-4.5`, `muse-spark-1.2-contributor`.

| Provider entry | Host | apiStyle | Full model ID | Family | Discovery source | Visual status |
|---|---|---|---|---|---|---|
| `opencode-vision` / `muse-mimo` logical test entry | `opencode.ai` | chat-completions | `mimo-v2.5` | MiMo | Endpoint | **PASS**: red-pixel probe answered `Red`; 1 call, 11,184 ms, 421/199 input/output tokens |
| `muse-qwen` logical test entry | `opencode.ai` | chat-completions | `qwen3.8-max` | Qwen | Endpoint | **FAIL**: visual probe `PROVIDER_ERROR`, 1 call, 5,409 ms |
| `muse-qwen` logical test entry | `opencode.ai` | chat-completions | `qwen3.7-max` | Qwen | Endpoint | **FAIL**: visual probe `PROVIDER_ERROR`, 1 call, 4,746 ms |
| `muse-qwen` logical test entry | `opencode.ai` | chat-completions | `qwen3.7-plus` | Qwen | Endpoint | **FAIL**: visual probe `PROVIDER_ERROR`, 1 call, 3,050 ms |
| `muse-qwen` logical test entry | `opencode.ai` | chat-completions | `qwen3.6-plus` | Qwen | Endpoint | **FAIL**: visual probe `PROVIDER_ERROR`, 1 call, 3,987 ms |
| `muse-qwen` logical test entry | `opencode.ai` | chat-completions | `qwen3.5-plus` | Qwen | Endpoint | **FAIL**: visual probe `PROVIDER_ERROR`, 1 call, 4,744 ms |

The Qwen IDs are genuinely listed, but none passed visual input. They are not marked vision-capable merely because discovery returned them. All provider-fallback conclusions below are **SINGLE-GATEWAY SIMULATION**, never real cross-provider validation.

## 3. Static / Build Results

| ID | Command | Result | Duration | Exit | Evidence |
|---|---|---|---:|---:|---|
| A1 | `npm ci` | PASS | 22.950 s | 0 | 238 packages installed; audit reported 5 dependency vulnerabilities (3 moderate, 1 high, 1 critical) |
| A2 | `npm run typecheck` | PASS | 10.842 s | 0 | Both workspaces typechecked |
| A3 | `npm test` | **FAIL** | 20.513 s | 1 | Vision 62/62 pass; image-mind 248 pass, 4 fail, 7 skip |
| A4 | `npm run build` | PASS | 5.354 s | 0 | Service, host, and client bundles built |
| A5 | `npm run test:package` | PASS after environment-permission rerun | 5.096 s | 0 | 11/11 pass. First sandboxed run failed only because npm cache was not writable |
| A6 | `npm run test:built` | PASS | 8.924 s | 0 | 4/4 pass |
| A7 | Root tests not reached by A3's `&&` | **FAIL** | 5.460 s | 1 | 24 assertions passed; 3 benchmark test files failed to transform with `SyntaxError: Invalid or unexpected token`; package assertions were separately proven by A5 |

A3 failures:

1. `tool-thin.test.ts`: structural rule matched `.maxOutputTokens` in `understand-image.ts`.
2. `vision-orchestration.integration.test.ts`: actual result includes `trace`, but expected deep-equality object does not.
3. `provider-reliability.test.ts`: cooldown did not re-allow provider `first` as expected.
4. `execution-gate.test.ts`: FIFO wake assertion expected `[1,2,3]`, received `[1,2]`.

Targeted LOCAL MOCK rerun: 76/77 image-mind assertions passed (same provider-reliability cooldown failure); 13/13 vision lifecycle/policy/selector assertions passed. Vitest later reported an environment-only EPERM while writing its result cache, after assertions completed.

## 4. DSH Integration

| ID | Scenario | Result | Evidence | Notes |
|---|---|---|---|---|
| B1 | Plugin install | PASS | Official `dsh plugin --profile github-e2e add <local package>` exit 0 | Isolated profile |
| B2 | DSH startup | PASS | `web` served HTTP 200 at localhost; DSH 0.1.0-rc.7 | Isolated base profile had no UI app and was not used for browser cases |
| B3 | `@ran-sh/dsh-vision` service load | PASS | Composed bundle contains `vision-runtime`; real agent registered and invoked tool | Runtime call later failed inside bundled tool |
| B4 | image-mind plugin load | PASS | Plugin config and `understand_image` visible after official web install | |
| B5 | Settings UI opens | PASS | “插件 → 图像理解” opened in real browser | |
| B6 | Provider configuration loads | PASS | `OpenCode Vision (mimo-v2.5)`, configured credential indicator, limits and preview setting visible | No secret exposed |
| B7 | Model discovery | PASS | UI changed loading textbox to model combobox; direct endpoint discovery returned 27 IDs | |
| B8 | Provider/model save workflow | PARTIAL | Existing provider loaded and editor/save state behaved correctly; deterministic settings integration tests passed 6/6 | No user model was changed merely to manufacture a save |
| B9 | Plugin remove | PASS | Official remove exit 0; package/lock bundle entries removed | |
| B10 | Reinstall | PASS | Official reinstall exit 0 | |
| B11 | No stale bundle layer | **FAIL** | After isolated remove, package/lock entries were absent but `node_modules/dsh-plugin-image-mind` junction still existed | Not manually repaired |
| B12 | DSH restart | PASS | Host restarted; root HTTP 200 | |
| B13 | Plugin remains usable after restart | **FAIL** | Settings remained present, but `understand_image` failed twice with dynamic `node:crypto` require error; old raw attachment returned 404 | Main image flow unusable |

The temporary `web` install was removed after testing; its package bundle/dependency entries were absent and the test server was stopped. The isolated `github-e2e` profile remains at the required reinstalled state.

## 5. MiMo Real Model Results

Model: `mimo-v2.5`; provider entry: `opencode-vision`; mode: TOOL-DIRECT; same fixed corpus and prompts; main raw scorer: 21 cases, assertion/task success 76.19%.

| Case | Result | ms | calls | bytes | hits | in/out tokens | retry/model/provider fallback/split | Quality evidence |
|---|---|---:|---:|---:|---:|---:|---|---|
| photo-01 PNG | FAIL | 15,252 | 1 | 13,347 | 0 | 951/672 | 0/0/0/0 | Assertion missed required visible terms despite a long description |
| photo-jpeg-01 | PASS | 7,456 | 1 | 25,332 | 0 | 951/286 | 0/0/0/0 | House, sun, scene text observed |
| ocr-zh-01 | PASS | 7,076 | 1 | 16,875 | 0 | 991/222 | 0/0/0/0 | Exact `BH-2026-08`, `37.5°C`, `42` |
| ocr-en-01 | PASS | 5,504 | 1 | 16,333 | 0 | 981/227 | 0/0/0/0 | Exact `VISION TEST`, SHA fragment, time and case ID |
| code-01 | PASS | 11,479 | 1 | 26,356 | 0 | 1,256/513 | 0/0/0/0 | Preserved error, filename/line, providerCalls value |
| ui-01 | FAIL | 19,963 | 1 | 23,897 | 0 | n/a | 0/0/0/0 | `PROVIDER_ERROR` |
| chart-01 | PASS | 11,407 | 1 | 23,701 | 0 | 1,273/612 | 0/0/0/0 | Title, units, 20→92 trend recovered |
| document-01 | PASS | 9,713 | 1 | 40,250 | 0 | 1,501/452 | 0/0/0/0 | Report ID, patient code, Gap, reviewer recovered |
| compare-02 | PASS | 8,394 | 1 | 18,639 | 0 | 1,072/488 | 0/0/0/0 | Stable Image 1/Image 2, Count 3→5 |
| multi-04 | PASS | 8,476 | 1 | 15,766 | 0 | 812/457 | 0/0/0/0 | Image N and values 11–44 stable |
| multi-08 | PASS | 8,253 | 1 | 30,694 | 0 | 1,188/400 | 0/0/0/0 | Eight images accepted, identities stable |
| multi-09-reject | PASS (expected rejection) | 0 | 0 | 0 | 0 | n/a | 0/0/0/0 | Rejected before provider traffic |
| cache-use-01 | PASS | 8,407 | 1 | 13,284 | 0 | 939/383 | 0/0/0/0 | First call |
| cache-use-02 | PASS | 5 | 0 | 0 | 1 | n/a | 0/0/0/0 | Exact semantic hit, answer consistent |
| cache-refresh | PASS | 10,732 | 1 | 13,284 | 0 | 939/522 | 0/0/0/0 | Forced new provider read |
| cache-no-store-01 | PASS | 9,522 | 1 | 13,284 | 0 | 939/599 | 0/0/0/0 | Provider reached |
| cache-no-store-02 | PASS | 9,085 | 1 | 13,284 | 0 | 939/284 | 0/0/0/0 | Provider reached again |
| layered-01 | PASS | 7,702 | 1 | 40,329 | 0 | 1,509/309 | 0/0/0/0 | Broad document OCR correct |
| layered-02 | PARTIAL | 4,843 | 1 | 40,142 | 0 | 1,472/93 | 0/0/0/0 | Narrow Gap answer correct, but no zero-provider evidence reuse |
| long-10000 | FAIL | 21,494 | 1 | 441,885 | 0 | n/a | 0/0/0/0 | `PROVIDER_ERROR` |
| long-20000 | FAIL | 21,997 | 1 | 729,465 | 0 | 8,533/1,024 | 0/0/0/0 | Top recovered; output ended before bottom token |

## 6. Qwen Real Model Results

All five actual Qwen IDs returned by discovery were tested with the same 1×1 red PNG and identical prompt/cache policy. Every case made exactly one provider call and returned `PROVIDER_ERROR`; no token usage was returned. Because the visual compatibility gate failed, a 21-case Qwen run would only spend quota repeating the same incompatibility and was blocked.

| Model | Cases | PASS | FAIL | Latency | Trace coverage | Usage coverage |
|---|---:|---:|---:|---:|---:|---:|
| `qwen3.8-max` | 1 | 0 | 1 | 5,409 ms | 100% | 0% |
| `qwen3.7-max` | 1 | 0 | 1 | 4,746 ms | 100% | 0% |
| `qwen3.7-plus` | 1 | 0 | 1 | 3,050 ms | 100% | 0% |
| `qwen3.6-plus` | 1 | 0 | 1 | 3,987 ms | 100% | 0% |
| `qwen3.5-plus` | 1 | 0 | 1 | 4,744 ms | 100% | 0% |

## 7. MiMo vs Qwen

| Metric | MiMo `mimo-v2.5` | Qwen roster | Better | Evidence |
|---|---:|---:|---|---|
| Visual compatibility | PASS | 0/5 PASS | MiMo | Identical red-image probe |
| Chinese OCR | PASS on fixed case | BLOCKED | MiMo by availability | Qwen visual gate failed |
| English OCR | PASS on fixed case | BLOCKED | MiMo by availability | Qwen visual gate failed |
| Code transcription | PASS | BLOCKED | MiMo by availability | |
| UI small-detail recall | Real provider error on one case | BLOCKED | Neither | No valid comparison |
| Document field recall | PASS | BLOCKED | MiMo by availability | 4/4 required fields |
| Chart numeric accuracy | PASS | BLOCKED | MiMo by availability | 20 and 92 recovered |
| Photo hallucination | 0 forbidden hits overall | BLOCKED | MiMo by availability | Synthetic scene |
| Multi-image identity | 2/2 (4 and 8 images) | BLOCKED | MiMo by availability | Stable Image N |
| Probe latency | 11,184 ms | 3,050–5,409 ms failures | n/a | Failed calls are not quality-comparable |
| Full-corpus p50/p95 | 8,400.5 / 11,425 ms | n/a | n/a | |
| Full-corpus input/output | 26,246 / 7,543 | n/a | n/a | |
| Failure rate | 4 FAIL + 1 PARTIAL of 21 semantic cases | 100% probe failure | MiMo | |

This is not a quality head-to-head because no Qwen model passed visual input.

## 8. Cache

- Semantic cache: **PASS** — second exact call was 5 ms, `providerCalls=0`, `cacheHits=1`.
- `refresh`: **PASS** — one new call, no hit.
- `no-store`: **PASS** — two consecutive calls both reached provider.
- Layered evidence: **PARTIAL** — broad and narrow answers were correct, but the narrow follow-up still made one provider call; no measurable reuse on that pair.
- Zero-provider reuse: 1/21 corpus cases (4.76%), from exact semantic cache.
- Stale answers: none observed in executed fixed cases.
- Narrow-detail failures: no wrong answer; expected provider reduction was not achieved.
- Hallucination under reuse: none observed; scorer `forbiddenHitCount=0`.
- LOCAL MOCK: layered cache, refresh/no-store, explicit-route bypass and ordinary-photo bypass assertions passed.

## 9. Fallback / Retry / Circuit

| Item | Label | Result | Evidence |
|---|---|---|---|
| 400/404 no retry | LOCAL MOCK | PASS | Dedicated retry classification passed |
| 401/403 no retry | LOCAL MOCK | PASS | Adapter tests passed |
| 429 + Retry-After | LOCAL MOCK | PASS | Retry and capped delay tests passed |
| 500/503 recoverable | LOCAL MOCK | PASS | Adapter retry tests passed |
| Network error | LOCAL MOCK | PASS | Retried as `NETWORK_ERROR` |
| Timeout | LOCAL MOCK | PASS/PARTIAL | Recoverable path covered; full real Muse timeout not induced |
| Invalid response shape | LOCAL MOCK | PASS | `INVALID_RESPONSE` without unsafe reroute |
| Caller abort | LOCAL MOCK | PASS | In-flight abort did not retry; retry-sleep cancellation not independently exercised |
| Explicit model override | LOCAL MOCK + REAL MUSE probe selection | PASS | Wire override assertions passed; explicit Qwen IDs reached endpoint |
| Model fallback | LOCAL MOCK | PASS | Known-plan bounded fallback, explicit model sticky |
| Provider fallback | SINGLE-GATEWAY SIMULATION | PASS (logic only) | Recoverable 5xx reroute and bounds passed; explicit/auth/4xx/model incompatibility did not reroute |
| Provider circuit | LOCAL MOCK | **FAIL** | Reliability tracker did not re-allow provider after cooldown |
| Provider-neutral circuit primitives | LOCAL MOCK | PASS | Open/half-open/close/reopen primitives 2/2 pass |
| Independent provider failover | SKIP | NOT VALIDATED | Only one real gateway |

Correct conclusion: **provider fallback routing logic validated under single-gateway simulation; independent provider failover remains unverified.**

## 10. Image Pipeline

- PNG: TOOL-DIRECT accepted, but photo assertion differed from same-scene JPEG; browser paste succeeded.
- JPEG: TOOL-DIRECT PASS.
- WebP: SKIP — no valid controlled WebP fixture was available; deterministic preprocessing tests passed only.
- Long screenshot: **FAIL** — 1440×10000 returned provider error; 1440×20000 omitted the bottom token after reaching the 1,024 output-token cap.
- Multi-image: PASS for 2, 4, and 8 images.
- 8 images: PASS, 1 provider call, stable identities.
- >8 rejection: PASS, rejected before traffic (`providerCalls=0` by observed absence/trace context).
- 413: REAL MUSE NOT REPRODUCIBLE; LOCAL MOCK recursive split and original Image N preservation passed 3/3.
- Stable Image N: PASS for real 2/4/8-image cases and LOCAL MOCK recursive split.
- Browser paste PNG: PASS; pending preview appeared.
- Hidden routing/attachment notes: **FAIL**, visibly rendered as raw HTML comments and metadata.
- Attachment restart: **FAIL**, old raw route returned HTTP 404 after host restart.

## 11. Lifecycle / Trace / Usage

- Lifecycle: LOCAL MOCK PASS, 3/3 — `started→completed`, `started→failed`, stable request id, observer failure containment/unsubscribe.
- Secret-content audit: PASS in deterministic lifecycle assertions; no prompt/path/key/response text was present in lifecycle events. No API secret appeared in terminal output or report.
- Trace reconciliation: PARTIAL — corpus trace coverage 95.24%; expected pre-provider >8 rejection has no runtime trace. Provider dashboard reconciliation unavailable.
- Token reconciliation: PARTIAL — corpus usage coverage 80.95%; 26,246 input and 7,543 output tokens reported. No provider dashboard access, so external reconciliation is SKIP.
- Adaptive split usage sum: LOCAL MOCK PASS.
- Explicit statement: executed lifecycle metadata tests found **no prompt, image bytes/reference/path, endpoint URL, API key, Authorization, provider response text, raw error message, or cause leakage**.

## 12. Benchmark

- Corpus: 21-case synthetic smoke corpus in OS temp storage: photo 2, OCR 2, code 1, UI 1, chart 1, document 1, compare 1, multi-image 3, cache 7, long screenshot 2.
- Mode: **TOOL-DIRECT**.
- MiMo score: routing 100%; raw assertion/task success 76.19%.
- Qwen score: full corpus BLOCKED after 0/5 visual probes.
- `routingSuccessRate`: 1.0
- `assertionPassRate`: 0.7619047619
- `taskSuccessRate`: 0.7619047619
- `forbiddenHitCount`: 0
- `traceCoverage`: 0.9523809524
- `tokenUsageCoverage`: 0.8095238095
- `zeroProviderReuseRate`: 0.0476190476
- p50/p95: 8,400.5 / 11,425 ms
- `providerCalls`: 19
- `payloadBytes`: 1,556,147
- `inputTokens`: 26,246
- `outputTokens`: 7,543
- `cacheHits`: 1
- `retries`: 0
- `modelFallbacks`: 0
- `providerFallbacks`: 0
- `splits`: 0
- Offline example scorer: PASS, 3/3.
- Regression Gate: PASS for example baseline self-comparison; **N/A** for real MiMo vs Qwen because Qwen produced no valid result set and no public 0.1.1 baseline was available.
- Failed gates: real corpus quality below full pass; no comparable real regression gate.
- Root benchmark unit suites: FAIL to transform (3 files, syntax error), even though CLI scorer/compare executed.

## 13. Agent Routing

| Case | User message | Images | `understand_image` called | Calls | Final answer supported | Result |
|---|---|---:|---|---:|---|---|
| T1 | Image-only pasted PNG | 1 | Yes | 2 duplicate failed calls | No | **FAIL/BLOCKER** — both calls errored `Dynamic require of "node:crypto" is not supported`; agent then attempted unrelated glob fallback |
| T2 | “这张图里写了什么？” | 1 | Not run | — | — | SKIP after T1 proved tool bundle unusable |
| T3 | “这个界面哪里有问题？” | 1 | Not run | — | — | SKIP after T1 |
| T4 | “帮我看看这个。” | 1 | Not run | — | — | SKIP after T1 |
| T5 | “对比这两张图有什么变化。” | 2 | Not run | — | — | SKIP after T1 |

The model correctly chose the tool for image-only input, but the shipped DSH execution path could not run it. TOOL-DIRECT benchmark success does not override this failure.

## 14. Failures

### F-001

- Severity: **BLOCKER**
- Area: DSH / image-mind bundled tool
- Reproduction: Install current local plugin into DSH web profile, paste PNG, send image-only message.
- Expected: `understand_image` reads attachment and returns visual evidence.
- Actual: two calls fail with `Dynamic require of "node:crypto" is not supported`; no visual answer.
- Evidence: Real DSH conversation tool rows and visible browser state.
- Likely layer: image-mind build/runtime compatibility.

### F-002

- Severity: **HIGH**
- Area: browser / send hook
- Reproduction: Send pasted PNG.
- Expected: routing hint and full attachment note hidden.
- Actual: raw HTML comments, attachment id, media metadata and markdown URL visibly render in the user bubble.
- Likely layer: image-mind client / DSH renderer compatibility.

### F-003

- Severity: **HIGH**
- Area: attachment restart recovery
- Reproduction: Paste/send PNG, restart DSH host, GET the prior `/image-mind/raw/<sha256>` URL.
- Expected: HTTP 200 image and rereadable old attachment.
- Actual: HTTP 404.
- Likely layer: attachment persistence / image-mind route.

### F-004

- Severity: **HIGH**
- Area: execution gate
- Reproduction: `npm test`, `execution-gate.test.ts` FIFO case.
- Expected: queued third job starts after releases.
- Actual: expected `[1,2,3]`, received `[1,2]`.
- Likely layer: image-mind execution gate.

### F-005

- Severity: **HIGH**
- Area: provider health/circuit
- Reproduction: provider reliability cooldown test.
- Expected: `first` re-enters fallback list in half-open after cooldown.
- Actual: list remained `second`, `third`.
- Likely layer: provider reliability tracker.

### F-006

- Severity: MEDIUM
- Area: Qwen compatibility
- Reproduction: identical red PNG through each of five discovered Qwen IDs.
- Expected: at least one available Qwen vision model.
- Actual: five `PROVIDER_ERROR` results.
- Likely layer: Muse model capability/gateway mapping.

### F-007

- Severity: MEDIUM
- Area: long screenshot
- Reproduction: 1440×10000 and 1440×20000 PNG with top/bottom tokens, `cache=refresh`.
- Expected: both tokens retained.
- Actual: 10000 case provider error; 20000 case truncated before bottom.
- Likely layer: Muse/model/output budget/image pipeline.

### F-008

- Severity: MEDIUM
- Area: real UI case quality
- Reproduction: fixed 1200×700 settings UI screenshot through MiMo.
- Expected: concrete hierarchy/label evidence.
- Actual: `PROVIDER_ERROR` after one call.
- Likely layer: Muse/model.

### F-009

- Severity: MEDIUM
- Area: unit/integration contracts
- Reproduction: A3.
- Expected: tool thinness and orchestration expectations pass.
- Actual: structural `.maxOutputTokens` match and extra `trace` deep-equality mismatch.
- Likely layer: tests/contracts vs implementation.

### F-010

- Severity: MEDIUM
- Area: benchmark test infrastructure
- Reproduction: direct root Vitest run of three benchmark test files.
- Expected: suites collect.
- Actual: `SyntaxError: Invalid or unexpected token`, zero tests collected.
- Likely layer: root test transform/configuration on Windows Node 24.

### F-011

- Severity: MEDIUM
- Area: PNG/JPEG consistency
- Reproduction: identical synthetic scene encoded as PNG/JPEG with same prompt.
- Expected: comparable important fact recall.
- Actual: PNG failed deterministic assertion while JPEG passed.
- Likely layer: preprocessing/model variability.

### F-012

- Severity: LOW
- Area: plugin removal hygiene
- Reproduction: official remove in isolated profile.
- Expected: no stale package layer.
- Actual: package and lock entries gone, but junction remained in node_modules.
- Likely layer: pnpm/DSH plugin manager.

No fixes were implemented.

## 15. Skipped / Blocked

| ID | Reason | Required later |
|---|---|---|
| S1 | No independent second real gateway | Two hosted providers plus one local provider |
| S2 | Official OpenAI credential/endpoint unavailable | GPT-5.6 original/high/low/auto detail measurement |
| S3 | Real 413 not reproducible without quota-wasting payload inflation | Controlled real endpoint returning 413 |
| S4 | Real 429/Retry-After not intentionally induced | Provider sandbox/controlled quota environment |
| S5 | Qwen full corpus blocked after all five discovered IDs failed visual probe | A Muse Qwen ID that accepts image input |
| S6 | WebP browser fixture unavailable | Valid controlled WebP file |
| S7 | Drag gesture, JPEG/WebP UI, multi-image UI, draft-retention/retry/preview/cache-mode UI cases not continued after blocker | Fixed DSH bundle, then full browser matrix |
| S8 | T2–T5 agent routing stopped after T1 blocker | Fixed `understand_image` runtime |
| S9 | Public 0.1.1 real benchmark baseline unavailable | Same frozen corpus and provider settings |
| S10 | Provider dashboard/log access unavailable | External trace/token reconciliation |
| S11 | Linux Node 22/24 and Windows Node 22 unavailable | CI/machine matrix |
| S12 | 100-case frozen corpus absent | Curated reviewed corpus, not synthetic padding |
| S13 | Command Code, DashScope, Gemini, Responses, Ollama/LM Studio real matrix out of available-gateway scope | Credentials/endpoints and controlled environment |

## 16. Verification Debt Mapping

### Local build / package matrix

| Debt item | Result | Evidence |
|---|---|---|
| Linux + Node 22 full lane | SKIP | Windows Node 24 host only |
| Linux + Node 24 build lane | SKIP | Windows host only |
| Windows + Node 22 full lane | SKIP | Node v24.18.1 installed |
| Generated service declarations and published dependency-range install | PARTIAL | Build/built/package tests pass; current local link installed, not registry publication |
| Official DSH install/remove roundtrip and no stale layer | **FAIL** | Commands pass, but junction remained after remove |
| Example benchmark scorer | PASS | 3/3, full telemetry coverage |
| Benchmark compare pass/fail exit behavior | PARTIAL | CLI pass path proven; root compare unit suite failed to transform; controlled failing CLI path not separately generated |

### Browser / DSH integration

| Debt item | Result | Evidence |
|---|---|---|
| Drag/paste PNG/JPEG/WebP; preview/retry/draft | PARTIAL | Paste PNG and pending preview pass; remaining matrix blocked |
| Hidden routing and attachment notes | **FAIL** | Both visibly rendered |
| Restart and inspect old image | **FAIL** | Old raw attachment HTTP 404 |
| Image-only routes to `understand_image` | **FAIL** | Tool chosen, but two runtime failures and no perception |
| Agent selects refresh/no-store appropriately | SKIP | Main flow blocker |
| Layered reuse invisible/useful | PARTIAL | TOOL-DIRECT answers useful; no zero-call reuse on different question |
| Provider/settings change invalidates evidence | PASS (LOCAL MOCK) | Layered cache tests |
| Lifecycle sequence in real DSH | PARTIAL | LOCAL MOCK 3/3; real tool failed before useful lifecycle audit |
| Lifecycle content safety and throwing observer | PASS (LOCAL MOCK) | Metadata-only assertions and observer containment |
| Long PNG readability/budget | **FAIL** | 10000 provider error; 20000 bottom omitted |
| New vs old long-page preprocessing quality | SKIP | No old-version controlled baseline |

### Real provider matrix

| Debt item | Result | Evidence |
|---|---|---|
| Opencode Go default/fallback/multi-image/OCR | PARTIAL | Default MiMo, OCR, 2/4/8 image pass; real automatic fallback not forced |
| Command Code Goat | SKIP | Outside single available gateway |
| DashScope/Qwen-VL | SKIP | No DashScope credential; Muse Qwen IDs failed vision |
| Gemini compatible | SKIP | Endpoint unavailable |
| Responses endpoint parsing | PASS (LOCAL MOCK) | Adapter/usage response tests |
| Ollama/LM Studio | SKIP | Not configured |
| Task-aware output budget and provider cap | PARTIAL | LOCAL MOCK task budgets pass; real wire cap not directly observed |
| Official OpenAI detail policy | SKIP | Official endpoint unavailable |
| Non-OpenAI endpoint omits detail | PASS (LOCAL MOCK + REAL MUSE compatibility) | Policy test passed; Muse requests did not fail systematically from detail |
| Real HTTP 413 split | SKIP | Not reproducible; LOCAL MOCK 3/3 |
| Real 429 + Retry-After | SKIP | Not intentionally induced; LOCAL MOCK pass |
| Real deterministic 400/404 no retry | SKIP | LOCAL MOCK pass |
| Cross-provider health-aware recovery | PARTIAL | SINGLE-GATEWAY/LOCAL MOCK logic pass; independent routing unavailable |
| Circuit breaker cooldown/half-open | **FAIL** | Reliability tracker cooldown failure |
| Explicit/auth/4xx/model/shape does not poison/reroute | PASS (LOCAL MOCK) | Targeted assertions pass |
| Trace counters vs server logs | PARTIAL | Internal trace coverage 95.24%; no external logs |
| Lifecycle trace vs result/error | PASS (LOCAL MOCK) | Lifecycle and trace suites pass |
| Usage vs provider dashboard and 413 sum | PARTIAL | Local split sum pass; dashboard unavailable |
| Cancellation in-flight/retry-delay | PARTIAL | In-flight no-retry pass; retry-delay cancellation not independently run |

### Layered evidence cache quality / cost

| Debt item | Result | Evidence |
|---|---|---|
| Different questions across evidence tasks | PARTIAL | Document pair correct but second call still reached provider; LOCAL MOCK reuse pass |
| Recall vs forced refresh baseline | SKIP | No sufficiently broad frozen paired set |
| Narrow follow-up recovery | PARTIAL | Gap value correct through fresh call; no hallucination |
| Photo/general stays question-specific | PASS | LOCAL MOCK and real no-store/use behavior |
| Explicit provider/model bypasses reuse | PASS (LOCAL MOCK) | Targeted assertion |
| no-store/refresh bypass/replace | PASS | Real and LOCAL MOCK |
| Cost/quality delta vs exact cache | PARTIAL | Exact hit measured; layered reduction not achieved on real pair |

### Visual quality benchmark

| Debt item | Result | Evidence |
|---|---|---|
| Freeze 100-task corpus | SKIP | 21-case smoke only |
| Per-task quality/telemetry record | PASS for smoke | 21 scorer-compatible records |
| Separate trace/token coverage | PASS | 95.24% / 80.95% |
| Compare main vs public 0.1.1 | SKIP | Baseline absent |
| Regression gate on frozen corpus | SKIP/PARTIAL | Example self-compare pass only |
| Split answers retain original Image N | PASS (LOCAL MOCK) | Recursive split tests |
| Direct vs reusable-evidence reasoning quality | PARTIAL | One real pair, no real reuse reduction |
| Add CI threshold only when stable | SKIP | Corpus/provider not stable |

### GitHub Actions visibility

| Debt item | Result | Evidence |
|---|---|---|
| Confirm push-triggered Actions green | SKIP | This run tests and pushes a report only; no source change and no exposed direct-push checks |

Exit criteria are not met: the real DSH main flow is blocked, restart attachment recovery fails, long screenshots fail, Qwen vision is unavailable, circuit recovery has a failing assertion, and the required multi-provider/local-provider matrix is incomplete.

## 17. Final Verdict

| Area | Verdict |
|---|---|
| Static/build | FAIL — build/type/package pass, but unit/root suites fail |
| DSH integration | **BLOCKER** — tool cannot execute in real DSH |
| Muse MiMo | PARTIAL — strong OCR/document/multi-image; UI/long-page and consistency failures |
| Muse Qwen | FAIL — 0/5 discovered IDs accepted visual probe |
| Cache | PASS semantic / PARTIAL layered |
| Model fallback | PASS LOCAL MOCK; real fallback not forced |
| Provider fallback simulation | PASS logic under **SINGLE-GATEWAY SIMULATION** only |
| Circuit | FAIL |
| Trace | PARTIAL |
| Usage | PARTIAL |
| Lifecycle | PASS LOCAL MOCK / PARTIAL real |
| Long screenshot | FAIL |
| Agent routing | FAIL — correct selection, unusable execution |
| Benchmark | FAIL quality gate for release readiness; raw task success 76.19% |

Overall: **NOT READY — FIX BLOCKERS FIRST**

Summary counts (defined in §1):

- Total Tests: **428**
- PASS: **368**
- FAIL: **20**
- SKIP/BLOCKED/PARTIAL: **40**
- Blocker issues: **1**
- High issues: **4**
- Medium issues: **6**
- Low issues: **1**
