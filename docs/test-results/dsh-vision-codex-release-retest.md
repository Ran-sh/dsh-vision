# DSH Vision Release-Readiness Retest

## 1. Test Identity

- Mode: `TEST_ONLY`
- Tested source commit: `e57329150f15be2b51d7ea8c4cc09878405a16ca`
- Branch: `main`
- Test date: 2026-08-21 (Asia/Shanghai)
- Scope: directed retest of NEW-R1 sent/history previews and FR-001 compare output truncation only, plus the explicitly required clean release-safety lane.
- Source, tests, configuration, lockfiles, and generated build artifacts were not modified.

## 2. Workspace Safety / Environment

- Pulled `origin/main` by fast-forward before testing; the worktree was clean at the tested source commit.
- Installed dependencies with `npm ci` before both the targeted and release-safety lanes.
- Installed the local `packages/image-mind` plugin only into the disposable DSH `web` profile for real-host testing, then removed it after testing.
- Used two controlled synthetic PNG fixtures from the system temporary directory. No repository fixture or source file was created or changed.
- The real DSH host was bound to `127.0.0.1:43192`, stopped by verified PID, restarted on the same port/profile, and stopped again after the test.
- Final pre-report repository state remained clean.

## 3. Targeted Static Results

PASS.

- `npm ci`: exit 0, 15.487 s. Non-blocking dependency/audit output reported 5 vulnerabilities (3 moderate, 1 high, 1 critical) and allow-scripts warnings; these are inherited dependency signals outside this directed scope.
- `npm run typecheck`: exit 0, 7.780 s.
- Targeted Vitest command covering 10 specified files: exit 0, 5.245 s wall time; 10/10 files and 38/38 tests passed.
- Covered attachment reference indexing, restart preview/raw routes, history preview alignment, send-hook routing, session attachment routing, task-budget routing, default output cap, thin tool behavior, and vision orchestration integration.
- Repeated ES2024 warnings were non-fatal.

## 4. Clean Release-Safety Lane

PASS.

- Fresh `npm ci`: exit 0, 24.467 s.
- `npm run typecheck`: exit 0, 9.599 s.
- `npm run build`: exit 0, 4.079 s.
- `npm test`: exit 0, 23.433 s; 61 passed files, 2 skipped files, 376 passed tests, 7 skipped tests, 0 failed tests.
- `npm run test:package`: exit 0, 7.062 s; 11/11 passed.
- `npm run test:built`: exit 0, 4.629 s; 5/5 passed.
- Non-fatal ES2024, dependency audit, and root package deprecation warnings did not change the result.

## 5. NEW-R1 One-Image Sent/History Preview

FAIL.

- Before send, the composer displayed exactly one draft thumbnail.
- The user message was admitted once, the draft thumbnail cleared, and the model correctly read `RETEST-731`, `BLUE 42`, the red top bar, white bar text, and blue lower text.
- After completion, the historical user row contained 0 elements with `data-dsh-image-mind-history-preview`, 0 preview buttons, and 0 images. Therefore click-to-open and the lightbox could not be exercised.
- The model made two `understand_image` calls because it voluntarily rechecked a sparse first response. This did not duplicate the user message.

## 6. NEW-R1 Two-Image Sent/History Preview

FAIL.

- Before send, the composer displayed exactly two draft thumbnails in input order.
- The user message was admitted once and the model correctly distinguished image 1 (`RETEST-731`, `BLUE 42`, red/white/blue) from image 2 (`RETEST-732`, `GREEN 84`, green/white/purple) with one `understand_image` call.
- After completion, the historical user row contained 0 historical preview groups and 0 preview buttons instead of one ordered two-image group.
- Because no historical images existed, order-by-thumbnail, opaque preview URL structure, click-to-open, and the two lightbox views were not observable.

## 7. Session Switch

FAIL for NEW-R1 preview persistence; PASS for conversation isolation.

- Switching to the one-image session restored the correct conversation and model answer but showed 0 historical preview groups/buttons.
- Switching back to the two-image session restored the correct conversation and model answer but again showed 0 historical preview groups/buttons.
- No cross-session image text or answer leakage was observed.

## 8. Restart / Reopen / F003

- NEW-R1 historical previews: FAIL. After a verified stop and restart of the same DSH host/profile and a page reload, the two-image session reopened automatically but still had 0 historical preview groups/buttons.
- F003 durable old-image reuse: PASS. Without re-uploading either image, a fresh post-restart prompt caused a new `understand_image` call and correctly reread both old images, including their text and colors.
- The only browser warnings were three expected connection-loss/retry messages during the intentional host restart; no image-mind warning or error was logged.

## 9. F002 User-Message Secrecy

PASS.

- The one-image user row contained only the user's prompt, the neutral `已附加图片。` marker, and host-rendered time text.
- The two-image user row contained only the user's prompt, the neutral `已附加 2 张图片。` marker, and host-rendered time text.
- The inspected user-row text contained no attachment ID, SHA-256 digest, `/image-mind/raw/` URL, raw image bytes, or `understand_image` routing instruction.

## 10. FR-001 Static Output-Budget Proof

PASS.

- The provider default output cap is 3000 tokens.
- Explicitly configured lower provider caps remain lower.
- The compare task request is 2200 tokens.
- The connection snapshot applies the lower of provider cap and task request, making the default-path effective compare cap 2200 tokens.
- Targeted/default-cap and complete release test lanes passed, including the routing and connection coverage required by the task.

## 11. FR-001 Real Two-Image Benchmark

PASS.

- Reused the exact frozen `compare-02` case and its original two PNG inputs; no easier replacement fixture or assertion was introduced.
- Native command path: `npm run benchmark:run -- --cases <single-frozen-case> --out <temp-result> --provider opencode-go --model mimo-v2.5 --timeout-ms 60000`.
- Benchmark test: exit 0; 1/1 file and 1/1 case passed; real provider call completed in 28.636 s.
- Scorer: 1 case, 0 missing, routing success 1.0, assertion pass 1.0, task success 1.0, forbidden hits 0, trace coverage 1.0, token-usage coverage 1.0.
- Observable provider result: 1 call, 0 retries, 0 model/provider fallbacks, 1072 input tokens, 1420 output tokens, 1244 answer characters.
- The 1420-token output directly exceeded the previous 1024-token truncation boundary and still satisfied all frozen assertions.

## 12. Core Real DSH Smoke

PASS for image admission, routing, model vision, restart durability, and conversation integrity.

- Single-image and two-image sends were each admitted once; no duplicate user messages were observed.
- The correct controlled image contents and color differences were returned.
- The initial two-image turn made one visual tool call; the post-restart old-image reread made one fresh visual tool call.
- Restart durability of the raw/session attachment path remained functional (F003 PASS).
- This smoke result does not override the NEW-R1 UI failure.

## 13. Failure Table

| ID | Severity | Status | Evidence | Impact |
|---|---|---|---|---|
| NEW-R1 | HIGH | FAIL | Single-image, two-image, session-switch, and restart observations all produced 0 historical preview groups/buttons. The live DSH user row appends time text after the neutral marker, while `previewMarkerCount()` accepts only a marker at the final line; therefore the committed batch is never aligned to the rendered row. | Users cannot see or open sent image thumbnails in conversation history, so the release-readiness target is not met. |

No BLOCKER or targeted MEDIUM failure was found.

## 14. Blocked / Skipped / Not Run

- Blocked: none.
- Per the directed task, the full 21-case real-provider corpus, Qwen rerun, forced upload/send/preview failures, decompression/EXIF/HEIC stress, and unrelated review scopes were NOT RUN.
- Inherited known MEDIUM limitations F-007 (extreme-long screenshot coverage) and F-008 (provider/model stability) were NOT RUN and remain inherited known limitations, not targeted failures.
- Inherited LOW F-012 uninstall hygiene was out of scope and NOT RUN.

## 15. Comparison With Prior Full Regression

- FR-001 changed from MEDIUM FAIL to PASS: the exact frozen compare case now passes and produced 1420 output tokens, beyond the old 1024 cap.
- F003 remains PASS: old session images can still be reread after host restart without re-upload.
- F002 remains PASS: conversation text stays neutral and secret-free.
- NEW-R1 remains HIGH FAIL. The implementation and static tests are present, but the real DSH row shape includes timestamp text after the neutral marker, preventing runtime alignment and rendering.
- F-007 and F-008 remain inherited known MEDIUM limitations and were not reclassified by this directed run.

## 16. Release Readiness

Primary gate accounting used for this report:

- PASS (6): targeted static lane; clean release-safety lane; F002 secrecy; FR-001 static proof; FR-001 exact real benchmark; core DSH/F003 smoke.
- FAIL (4): NEW-R1 one-image; NEW-R1 two-image; NEW-R1 session switch; NEW-R1 restart/reopen preview.
- PARTIAL-BLOCKED (0): none.

Severity counts:

- BLOCKER: 0
- HIGH: 1 targeted failure (NEW-R1)
- MEDIUM: 0 targeted failures; 2 inherited known limitations (F-007 and F-008, both NOT RUN)

Release readiness is not green because the task's HIGH sent/history preview requirement remains reproducibly broken in the real DSH host.

## 17. Final Verdict

**RELEASE RETEST NOT GREEN — FIX BEFORE RELEASE**
