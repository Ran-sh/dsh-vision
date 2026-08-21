# DSH Vision NEW-R1 Final Real-DSH Retest

## Test identity

- Mode: `TEST_ONLY`
- Source branch: `fix/new-r1-history-preview-runtime`
- Tested source commit: `2021551bff392be3c890c01eb6dfcb191185218e`
- Test date: 2026-08-21 (Asia/Shanghai)
- Result branch: `main`
- Source, tests, assertions, configuration, CI, dependencies, and implementation files were not modified.

## Environment and safety

- The target branch head exactly matched the required source commit.
- The feature worktree was clean before and after testing.
- The local image-mind plugin was installed only into the disposable DSH `web` profile for the real-host run and removed afterward.
- The test host ran on `127.0.0.1:43193`; both host processes were stopped by verified PID.
- Two controlled synthetic PNGs outside the repository were reused: image 1 contains `RETEST-731` / `BLUE 42`; image 2 contains `RETEST-732` / `GREEN 84`.

## Static and release-safety checks

All checks PASS.

| Check | Result | Evidence |
|---|---|---|
| `npm ci` | PASS | Exit 0; 238 packages installed. Inherited output reported 5 audit findings (3 moderate, 1 high, 1 critical) and allow-scripts warnings. |
| `npm run typecheck` | PASS | Both workspaces completed with exit 0. |
| Targeted history/F002/F003/FR-001 tests | PASS | 10/10 files, 38/38 tests, 0 failures. |
| `npm run build` | PASS | Both workspace bundles built with exit 0. |
| `npm test` | PASS | Vision 63/63; image-mind 271 passed and 7 skipped; root 42/42. Total: 376 passed, 7 skipped, 0 failed. |
| `npm run test:package` | PASS | 11/11 passed. |
| `npm run test:built` | PASS | 5/5 passed after build. |

Repeated ES2024 and child-process deprecation warnings were non-fatal and did not change any test result.

## NEW-R1 one-image history preview

PASS.

- Composer showed exactly one draft image before send.
- After the user message was admitted, the historical row contained one preview group, one `查看已附加图片` button, and one image.
- The preview used an opaque `/image-mind/preview/<opaque-batch>/0` route; no raw attachment identifier was exposed in conversation text.
- Clicking the thumbnail opened one `图片预览` dialog containing the expected image; clicking outside closed it.
- The model ultimately read `RETEST-731`, `BLUE 42`, and the expected red/white/blue colors.
- One model-generated `read_image` attempt used an invalid sentinel path, then recovered through `understand_image`; the final user-visible result and NEW-R1 UI behavior remained correct.

## NEW-R1 two-image ordered history preview

PASS.

- Composer showed exactly two draft images before send.
- After send, the historical row contained one preview group and exactly two buttons in order: `已附加图片 1`, then `已附加图片 2`.
- Routes were the same opaque batch with ordinal suffixes `/0` and `/1`.
- Each button independently opened a `图片预览` dialog with the matching ordered alt text, and each dialog closed successfully.
- The model correctly distinguished image 1 (`RETEST-731`, `BLUE 42`, red bar/blue lower text) from image 2 (`RETEST-732`, `GREEN 84`, green bar/purple lower text).

## Session switch isolation

PASS.

- Switching to the one-image session restored exactly one group/one button.
- Switching back to the two-image session restored exactly one group/two ordered buttons.
- No cross-session preview count, text, or answer leakage was observed.

## Restart/reopen persistence and F003

PASS.

- The DSH host was stopped and restarted on the same port and profile.
- The two-image conversation reopened with one historical preview group and two ordered buttons.
- A post-restart thumbnail still opened the lightbox successfully.
- Without re-uploading either image, a new request triggered a fresh `understand_image` call and correctly reread all four expected text tokens and their colors.
- The preview group remained present after the second turn.
- Browser warnings were limited to expected connection-loss/retry messages during the intentional restart.

## F002 secrecy and duplicate-message check

PASS.

- The original two-image user message appeared exactly once.
- Its visible text contained only the user's prompt, the neutral `已附加 2 张图片。` marker, and host time chrome.
- It contained no attachment ID, SHA-256 digest, `/image-mind/raw/` route, raw bytes, or `understand_image` instruction.
- The follow-up F003 prompt created one additional user row as expected; no original-message duplication occurred.

## FR-001 regression status

PASS.

- Static default-cap and task-budget regression tests passed in the targeted and full suites.
- The exact frozen real `compare-02` case was rerun unchanged with provider `opencode-go` and model `mimo-v2.5`.
- Native result: 1/1 case passed, one provider call, 0 retries, 0 fallbacks, 1072 input tokens, 613 output tokens, 1121 answer characters.
- Scorer: routing success 1.0, assertion pass 1.0, task success 1.0, forbidden hits 0, trace coverage 1.0, token-usage coverage 1.0.

## Result accounting

The ten requested validation gates are counted once each:

- PASS (10): one-image preview; two-image ordered preview; session switch; restart/reopen; thumbnail/lightbox; F002; F003; no duplicate messages; FR-001; release safety.
- FAIL (0): none.
- PARTIAL-BLOCKED (0): none.

Severity counts:

- BLOCKER: 0
- HIGH: 0
- MEDIUM: 0

## Files changed by this test task

- Added `docs/test-results/dsh-vision-codex-new-r1-final-retest.md`.
- Deleted `docs/agent-tasks/ACTIVE_CODEX_TASK.md` as required.
- No other repository path was changed.

## Final verdict

**PASS — NEW-R1 FINAL REAL-DSH RETEST GREEN**
