# dsh-vision Codex Targeted BLOCKER/HIGH Retest

## 1. Test Identity

| Field | Value |
|---|---|
| Repository | `Ran-sh/dsh-vision` |
| Branch | `main` |
| Source Commit SHA | `13090a538345f2beea5bb7e0526caeefc1f96397` |
| Date/time | 2026-08-21 01:47 Asia/Shanghai |
| OS | Microsoft Windows 11 Pro 10.0.22631, x64 |
| Node | v24.18.1 |
| npm | 11.16.0 |
| Vitest | 2.1.9 |
| DSH | 0.1.0-rc.7 |
| DSH profile/process | `web`, dedicated localhost process on port 43190; plugin temporarily installed by the official DSH plugin command and removed after testing |
| Real vision route | Opencode Go plan -> Muse API -> `mimo-v2.5`; independent real gateway count: 1 |
| Test Mode | **TEST ONLY** |
| Muse API credential | **PRESENT** |

This was the targeted F-001 through F-005, F-009, F-010, and NEW-R1 cycle. It was not a rerun of the previous 428-case quality matrix. Count convention for the final summary is nine primary checks: F-001, F-002, F-003, F-004, F-005, F-009, F-010, NEW-R1, and the full static lane. The targeted result is **8 PASS, 1 FAIL, 0 PARTIAL/BLOCKED/NOT RUN**.

## 2. Workspace Safety

- Start-of-task `git pull --ff-only origin main`: PASS; fast-forwarded to the Source Commit above.
- Branch: `main`.
- Dirty Before: clean (`git status --short` had no entries).
- Dirty After before report creation: clean (`git status --short` and `git diff --name-only` had no entries).
- **NO SOURCE MODIFICATIONS.** No source, existing test, assertion, configuration, package, lockfile, build script, CI file, README, CHANGELOG, verification-debt file, or previous report was edited.
- Build products and temporary browser evidence were not staged for the completion commit.
- The temporary DSH `web` profile plugin dependency was removed with the official plugin command after the run; the profile package manifest no longer listed `dsh-plugin-image-mind`.

## 3. Targeted Static Results

| Test / command | Status | Duration | Evidence |
|---|---|---:|---|
| `npm ci` | PASS | 11.238 s | 238 packages installed; npm audit reported 5 dependency vulnerabilities (3 moderate, 1 high, 1 critical) |
| Nine targeted image-mind suites | PASS | 3.217 s | 9/9 files, 37/37 tests; includes routing, durable ref index, restart route, session routing, execution gate, reliability, orchestration, and tool-thin |
| Three root benchmark suites | PASS | 1.618 s | 3/3 files, 15/15 tests collected and executed |
| `npm run typecheck` | PASS | 6.977 s | Both workspaces typechecked |
| `npm run build` | PASS | 2.700 s | Vision service plus image-mind host/client bundles built |
| `npm run test:package` | PASS | 5.173 s | 11/11 tests |
| `npm run test:built` | PASS | 2.793 s | 5/5 tests |

The repeated Vite warning that ES2024 is an unrecognized target did not prevent collection, execution, build, or package validation.

## 4. F-001 Real DSH Built-Bundle Retest

**Status: PASS**

- Built the current Source Commit before DSH execution.
- Official DSH install into the UI-capable `web` profile exited successfully.
- The installed dependency was a link to the current workspace package, and the loaded `lib/index.js` SHA-256 matched the repository build exactly.
- DSH dump-config contained both `vision-runtime` and `image-mind`; the settings UI exposed the Image Understanding plugin and configured `OpenCode Vision (mimo-v2.5)` entry.
- Controlled PNG draft preview appeared, then image-only send caused the main agent to invoke `understand_image` exactly once.
- The tool returned real visual evidence identifying `RETEST-731` and `BLUE 42`; the final response used those facts.
- Additional one-image-with-text and two-image comparison scenarios each invoked `understand_image` once and returned correct OCR/comparison evidence.
- No tool row or host log contained `Dynamic require of "node:crypto" is not supported`; exact log match count across both host processes was zero.
- No duplicate calls attributable to the former bundle crash were observed.
- Host restart retained the same linked build; reinstall was not required. Official plugin removal after the run succeeded.

The existing `github-e2e` profile did not contain the web application needed for the UI acceptance checks, so the run used a dedicated process/port with the `web` profile rather than manufacturing a new repository or DSH configuration.

## 5. F-002 User Secrecy / Hidden Routing

**Status: PASS**

### User-visible secrecy

| Scenario | Rendered user bubble | Result |
|---|---|---|
| Image only | `已附加图片。` | PASS |
| One image + `这张图里写了什么？` | User text + `已附加图片。` | PASS |
| Two images + comparison request | User text + `已附加 2 张图片。` | PASS |

Across the three rendered user messages, no tool name, routing instruction, HTML comment, attachment label/JSON, attachment id, raw URL, media type, dimensions, or byte metadata was visible.

### Hidden model routing

- Real DSH behavior: all three image-dependent messages caused the main model to call `understand_image` successfully without an `image` or `images` value supplied by the visible user message.
- The image-only case proves the route does not depend on user-authored tool wording.
- `system-prompt-routing.test.ts` passed 3/3 and verifies the model-only `tool:image-mind` section. DSH's visible context-injection panel did not expose that plugin-owned section verbatim, so the strongest real evidence is the successful hidden-session attachment resolution and actual tool choice.
- The secrecy redesign therefore did not make the main model blind.

## 6. F-003 Restart Attachment Recovery

**Status: PASS**

- Sent a controlled image whose expected OCR was known; its attachment id was retained only in local test state and is represented here as `<REDACTED_ATTACHMENT_ID>`.
- The original user bubble contained only the user text plus the neutral attachment marker; no id, raw URL, or metadata was embedded in conversation text.
- Before restart, `/image-mind/raw/<REDACTED_ATTACHMENT_ID>` returned HTTP 200, `image/png`, 4,382 bytes.
- The DSH host process was stopped and restarted normally on the same profile and port; root returned HTTP 200.
- After restart, the same raw route returned HTTP 200, `image/png`, 4,382 bytes.
- After reopening the same session, a follow-up explicitly requested a fresh reread without re-uploading. The main model called `understand_image` with `cache: refresh`, resolved the old session image, and again returned the exact `RETEST-731` and `BLUE 42` content.
- Recovery therefore succeeded without attachment metadata in conversation text.

## 7. F-004 Execution Gate

**Status: PASS**

`packages/image-mind/tests/execution-gate.test.ts`: 2/2 tests passed on Windows + Node v24.18.1.

Evidence covered:

- queued operation 3 did not start while capacity was occupied;
- it eventually started after a release and preserved FIFO order;
- the current test does not depend on an exact fixed count of `Promise.resolve()` microtasks;
- an aborted waiter did not consume or leak capacity;
- subsequent queued work proceeded.

## 8. F-005 Circuit / Provider Reliability

**Status: PASS**

`packages/image-mind/tests/provider-reliability.test.ts`: 5/5 deterministic local-mock tests passed.

Evidence covered stable healthy ordering; recoverable-failure accumulation; circuit opening; cooldown exclusion; exactly one admitted half-open recovery probe; probe insertion at the front of the bounded fallback candidate set even while healthy alternatives exist; exclusion of concurrent duplicate probes; success closing/restoring eligibility; and failure reopening. Reliability-adapter and provider-fallback suites in the full lane also passed, including non-poisoning behavior for non-recoverable classes.

This is **LOCAL MOCK / SINGLE-GATEWAY LOGIC** evidence only. It is not independent real-provider failover validation.

## 9. F-009 Contract Tests

**Status: PASS**

- `tool-thin.test.ts`: 14/14 passed. Provider-neutral task-aware `maxOutputTokens` no longer trips the thin-tool structural guard.
- `vision-orchestration.integration.test.ts`: 2/2 passed. Trace telemetry is explicitly part of the orchestration contract.

Trace contract evidence:

| Call | providerCalls | cacheHits | modelFallbacks |
|---|---:|---:|---:|
| First successful fallback call | 2 | 0 | 1 |
| Second call using successful fallback cache | 1 | 1 | 1 |

The second result's trace is expected to differ from the first even when text/provider/model agree; telemetry was retained.

## 10. F-010 Windows Node 24 Benchmark Transform

**Status: PASS**

Environment: Windows 11 x64, Node v24.18.1, Vitest 2.1.9.

Together, `tests/benchmark-score.test.ts`, `tests/benchmark-compare.test.ts`, and `tests/benchmark-runner.test.ts` collected and executed successfully: 3/3 suites and 15/15 tests passed. No `SyntaxError: Invalid or unexpected token` occurred, and the imported `.mjs` benchmark modules were usable from Vitest.

## 11. NEW-R1 Conversation Preview / History UX

**Status: FAIL — HIGH**

| Subresult | Status | Evidence |
|---|---|---|
| Draft preview before send | PASS | One and two pasted PNGs appeared in the pending-image group before send |
| Sent-message historical thumbnail/gallery | FAIL | After send, the user message rendered only user text plus the neutral marker; no image element or gallery was present |
| Click/open full-size behavior | FAIL | No sent-message image/thumbnail control existed to click |
| Switch away/back | FAIL | After session switching, the bubble remained but visible image count was zero |
| Restart/reopen session | FAIL | After host restart and session reopen, old bytes were readable by the tool but visible image count remained zero |

This confirms attachment secrecy and durable model-side recovery, but the sent-image preview/history UX regressed. Raw attachment ids or raw-route URLs must not be restored to user-visible conversation text as a workaround. This HIGH issue should not block the requested broader full regression, because the former BLOCKER/HIGH integration path is now functional, but it should block release-readiness until the product decision and UX repair are validated.

## 12. Full Static Lane

Executed after the targeted real-DSH checks.

| Command | Status | Exit | Duration | Evidence |
|---|---|---:|---:|---|
| `npm ci` | PASS | 0 | 9.477 s | 238 packages; same audit advisory count |
| `npm run typecheck` | PASS | 0 | 7.081 s | Both workspaces |
| `npm test` | PASS | 0 | 25.012 s | 367 passed, 7 skipped; 58 test files passed, 2 skipped |
| `npm run build` | PASS | 0 | 3.303 s | All service/host/client bundles |
| `npm run test:package` | PASS | 0 | 4.835 s | 11/11 |
| `npm run test:built` | PASS | 0 | 2.434 s | 5/5 |

The complete lane is green; piecemeal targeted results were not substituted for it.

## 13. Failure Table

| ID | Severity | Area | Reproduction | Expected | Actual | Evidence | Likely layer |
|---|---|---|---|---|---|---|---|
| NEW-R1 | HIGH | Conversation image preview/history UX | Paste PNG, observe draft, send, inspect historical user message, switch sessions, restart and reopen | Sent historical message retains a safe clickable thumbnail/gallery without exposing raw metadata | Draft preview passes, but sent/switch/restart states have no image element or full-size entry; tool-side old attachment remains readable | Browser DOM/image counts and successful post-restart tool reread | image-mind client preview enhancer / host conversation rendering contract |

No code patch was proposed or implemented.

## 14. Blocked / Not Run

- Full 428-case real-provider quality regression: **NOT RUN**, explicitly outside this targeted cycle.
- Five-model Qwen matrix: **NOT RUN**, explicitly prohibited for this cycle based on prior incompatibility evidence.
- Full Muse quality benchmark: **NOT RUN**, explicitly prohibited for quota discipline.
- Forced real 413/429: **NOT RUN**, explicitly prohibited.
- Independent provider failover: **NOT RUN**; only one real gateway exists. Local logic passed and is labeled accordingly.
- No required targeted core check was BLOCKED.

These out-of-scope NOT RUN items are not counted in the nine primary targeted-check totals.

## 15. Final Targeted Verdict

| Primary check | Result |
|---|---|
| F-001 real DSH built bundle | PASS |
| F-002 user secrecy + hidden routing | PASS |
| F-003 restart recovery | PASS |
| F-004 execution gate | PASS |
| F-005 provider reliability | PASS |
| F-009 contracts | PASS |
| F-010 benchmark transform | PASS |
| NEW-R1 preview/history UX | **FAIL — HIGH** |
| Full static lane | PASS |

- Targeted PASS: **8**
- Targeted FAIL: **1**
- Targeted PARTIAL/BLOCKED/NOT RUN: **0**
- BLOCKER: **0**
- HIGH: **1**

**TARGETED GREEN — READY FOR FULL REGRESSION**

The original core BLOCKER/HIGH/static gates are green, so the broader regression may proceed. NEW-R1 is a newly confirmed HIGH user-facing regression and remains a release-readiness issue.
