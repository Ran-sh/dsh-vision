# ACTIVE Codex Task — Targeted BLOCKER/HIGH Retest

Protocol: Agent Handoff Protocol v1  
Agent: CODEX  
Mode: TEST_ONLY  
Source Branch: main  
Source Commit: LATEST_MAIN  
Result Path: `docs/test-results/dsh-vision-codex-blocker-high-retest.md`  
Delete Active Task On Completion: YES

## Goal

Independently verify the post-report fixes for the previous real-DSH BLOCKER/HIGH failures F-001 through F-005, plus the deterministic static-contract regressions F-009/F-010, before any full 428-case rerun or expensive Muse quality benchmark.

## Context

Previous baseline report: `docs/test-results/dsh-vision-codex-test-report.md`.

Previous verdict: `NOT READY — FIX BLOCKERS FIRST` with F-001 BLOCKER and F-002..F-005 HIGH.

Implementation baseline before this task was queued: `e1c0a6f851f7af75a9504b8eb31951bb5fb8fd77` on `main`. The ACTIVE task commits themselves are instruction-only; record the exact pulled `main` SHA actually tested.

Real backend remains one gateway only: Opencode Go plan → Muse API. Use the currently working MiMo vision route for the minimum real-image checks. Do not spend quota on a full quality benchmark and do not retry the unavailable Qwen matrix in this targeted cycle.

Read `docs/test-instructions/ACTIVE_CODEX_TEST_PROMPT.txt` in full after this file. It is the detailed execution contract for this run and takes precedence for scenario details.

## Allowed Writes

Only:

- `docs/test-results/dsh-vision-codex-blocker-high-retest.md`
- deletion of `docs/agent-tasks/ACTIVE_CODEX_TASK.md`
- deletion of `docs/test-instructions/ACTIVE_CODEX_TEST_PROMPT.txt`

Local temporary logs/screenshots/test artifacts are allowed but must not be committed unless this task explicitly lists them above.

## Forbidden Changes

Do not modify or commit:

- `packages/**` source
- existing tests/assertions
- `scripts/**`
- root/workspace `package.json` or lockfiles
- tsconfig / Vitest config
- bundle manifests / Cordis patches
- README / CHANGELOG
- `docs/verification-debt.md`
- CI / GitHub Actions
- package versions
- the previous baseline report

A failure is evidence. Do not repair it.

## Required Work

1. Pull `main` with fast-forward only and record exact Source Commit SHA, branch, OS, Node, npm, DSH version, and `git status --short` before testing.
2. Read `docs/agent-workflow.md`, this ACTIVE task, the specialized TXT prompt, the prior report, and the targeted section at the top of `docs/verification-debt.md`.
3. Run the targeted repository tests and build/package checks specified in the TXT prompt.
4. Run the real DSH F-001/F-002/F-003 agent/browser/restart checks in an isolated profile when possible.
5. Run F-004/F-005 reliability checks and F-009/F-010 regression checks.
6. Explicitly test whether removing raw attachment metadata from user text accidentally regressed sent-image preview/history UX; report this separately as NEW-R1, not as a reason to reintroduce metadata.
7. Do not run the full 428-case quality matrix unless the task explicitly says so. Do not run a full Muse benchmark in this cycle.
8. Write the result report using only PASS / FAIL / PARTIAL / SKIP / BLOCKED / NOT RUN.
9. Before committing, verify staged paths are exactly the report plus deletion of the two ACTIVE files.
10. Commit and push the report-only completion commit to `main` if permitted by the environment.

## Acceptance Criteria

The targeted cycle is considered green only if all of the following are true:

- F-001 real DSH image flow executes `understand_image` without the `node:crypto` dynamic-require crash.
- F-002 user bubble exposes no internal routing/tool/attachment metadata, while the main model still receives hidden routing guidance and actually calls `understand_image` for image-dependent questions.
- F-003 old attachment bytes remain readable after DSH restart and the resumed session can inspect the old image without relying on metadata embedded in conversation text.
- F-004 execution-gate FIFO/cancellation tests pass on the original Windows Node 24-style environment.
- F-005 cooldown → exactly one half-open recovery probe → success-close / failure-reopen behavior passes.
- F-009 targeted unit/integration contract tests pass.
- F-010 the three root benchmark suites collect and execute successfully on Windows Node 24; if not, preserve the exact transform failure evidence.
- Full static lane (`npm ci`, typecheck, test, build, package, built) is green after targeted checks.
- No source files are changed by Codex.
- No secrets appear in logs/report.

NEW-R1 image preview/history UX may be PASS/FAIL/PARTIAL independently; if it fails, report severity and evidence. Do not restore raw attachment ids/URLs to conversation text as a workaround.

## Result / Report Contract

Create `docs/test-results/dsh-vision-codex-blocker-high-retest.md` with:

1. Test Identity
2. Environment / Source SHA / Dirty Before-After
3. Targeted Static Results
4. F-001 Real DSH Built-Bundle Retest
5. F-002 User-Visible Secrecy + Hidden Model Routing
6. F-003 Restart Attachment Recovery
7. F-004 Execution Gate
8. F-005 Circuit / Provider Reliability
9. F-009 Contract Tests
10. F-010 Windows Node 24 Benchmark Transform
11. NEW-R1 Conversation Preview / History UX
12. Full Static Lane
13. Failures / Reproductions / Severity
14. Blocked / Not Run
15. Final Targeted Verdict

Use verdict:

- `TARGETED GREEN — READY FOR FULL REGRESSION` only if all required blocker/high/static gates above pass.
- otherwise `TARGETED NOT GREEN — FIX BEFORE FULL REGRESSION`.

## Completion Commit Contract

The final staged set must contain only:

- `docs/test-results/dsh-vision-codex-blocker-high-retest.md`
- deletion of `docs/agent-tasks/ACTIVE_CODEX_TASK.md`
- deletion of `docs/test-instructions/ACTIVE_CODEX_TEST_PROMPT.txt`

Run `git diff --cached --name-only` before commit. If any source/test/config file appears, unstage it and do not modify it.

Suggested commit message: `test: record blocker-high DSH retest`

Final chat reply must be concise and contain only:

- Source Commit SHA
- Report Commit SHA
- Targeted checks PASS / FAIL / PARTIAL-BLOCKED counts
- BLOCKER count
- HIGH count
- Final Targeted Verdict
- Report Path
