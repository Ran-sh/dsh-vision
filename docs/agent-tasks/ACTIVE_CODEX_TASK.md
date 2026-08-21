# ACTIVE Codex Task — Full Regression

Protocol: Agent Handoff Protocol v1  
Agent: CODEX  
Mode: TEST_ONLY  
Source Branch: main  
Source Commit: `4767dc243ef75b298e29cbfae1c36776943835c6`  
Result Path: `docs/test-results/dsh-vision-codex-full-regression.md`  
Delete Active Task On Completion: YES

## Goal

Run the broader/full regression now that the targeted BLOCKER/HIGH retest is green. This is an independent validation cycle only. Do not fix source code.

The current baseline verdict is:

- Previous targeted retest: **TARGETED GREEN — READY FOR FULL REGRESSION**
- Previous targeted result: 8 PASS / 1 FAIL / 0 PARTIAL-BLOCKED
- BLOCKER: 0
- HIGH: 1
- Known remaining HIGH: `NEW-R1` conversation sent-image preview/history UX regression

The purpose of this run is to determine whether the current baseline has any additional release-readiness regressions before implementation resumes.

## Required Read Order

1. `docs/agent-workflow.md`
2. this ACTIVE task
3. `docs/test-instructions/ACTIVE_CODEX_TEST_PROMPT.txt`
4. `docs/test-results/dsh-vision-codex-blocker-high-retest.md`
5. `docs/test-results/dsh-vision-codex-test-report.md`
6. `docs/verification-debt.md`
7. `CHANGELOG.md`
8. root/workspace `package.json` files relevant to the executed commands

Do not read or modify another Agent's ACTIVE task file.

## Absolute Rules

You are the independent validation engineer for this run. You are NOT the developer.

**TEST ONLY.**

Do not:

- fix source code;
- refactor;
- edit existing tests/assertions to make failures pass;
- loosen expectations;
- change package versions, lockfiles, tsconfig, Vitest config, build scripts, CI, README, CHANGELOG, or `docs/verification-debt.md`;
- hide, downgrade, or omit failures;
- spend quota on unsupported provider/model combinations that were previously ruled out unless explicitly required by the specialized prompt;
- expose credentials, bearer tokens, cookies, signed URLs, API keys, or secret-bearing error output.

A failure is evidence. Record it; do not repair it.

Use only these result states:

`PASS / FAIL / PARTIAL / SKIP / BLOCKED / NOT RUN`

## Allowed Repository Writes

Only:

1. `docs/test-results/dsh-vision-codex-full-regression.md`
2. deletion of `docs/agent-tasks/ACTIVE_CODEX_TASK.md` when complete
3. deletion of `docs/test-instructions/ACTIVE_CODEX_TEST_PROMPT.txt` when complete

Temporary local logs/screenshots/build outputs are allowed as evidence but must not be committed by default.

## Start-of-Task Safety

Before testing:

```bash
git pull --ff-only origin main
git rev-parse HEAD
git branch --show-current
git status --short
```

Record all four results in the report.

The intended implementation/report baseline for this cycle is commit:

`4767dc243ef75b298e29cbfae1c36776943835c6`

If `main` has advanced because this task/prompt was added, test the pulled latest `main` and record the exact SHA. Instruction-only commits are acceptable on top of the baseline; do not silently switch to an older revision.

If the worktree contains user changes, preserve them. Do not reset, clean, stash, overwrite, delete, or commit them.

## Required Work

1. Run the full static repository lane from a clean install as specified in the specialized prompt.
2. Run the repository's broader/full automated regression suites, including the previously established quality/benchmark matrix where supported and quota-safe.
3. Revalidate the real DSH end-to-end image path with the known working OpenCode Go → Muse API → MiMo route, using a minimal number of real-provider calls sufficient to detect integration regressions.
4. Recheck the known `NEW-R1` HIGH regression and keep it independent from secrecy/routing acceptance. Do **not** reintroduce raw attachment ids/URLs/metadata into user-visible conversation text as a workaround.
5. Preserve the prior distinction between deterministic local reliability evidence and independent real-provider failover. Independent failover remains NOT RUN/BLOCKED if only one real gateway exists.
6. Compare findings against the previous targeted report and identify every new BLOCKER/HIGH/MEDIUM regression with reproduction and evidence.
7. Produce one report only; do not patch any failures.
8. Before commit, verify staged paths contain only the report plus deletion of the two ACTIVE files.
9. Commit and push the report-only completion commit according to the Agent Handoff Protocol.

## Release-Readiness Interpretation

The full regression should be considered release-ready only when:

- no BLOCKER remains;
- no unresolved HIGH user-facing/core integration regression remains, including `NEW-R1`;
- the full static lane is green;
- the broader automated regression/quality matrix meets the repository's established acceptance thresholds;
- real DSH image execution through the shipped/built plugin works;
- secrecy + hidden routing + restart recovery remain green;
- no source changes were made by Codex during this TEST_ONLY cycle.

`NEW-R1` is already known and should remain a release blocker if it still fails, but it does not invalidate the usefulness of the broader regression run. The final verdict must distinguish **regression execution completed** from **release readiness**.

## Result / Report Contract

Create `docs/test-results/dsh-vision-codex-full-regression.md` containing at minimum:

1. Test Identity
2. Environment / exact tested SHA / dirty-before-after
3. Full Static Lane
4. Full Automated Regression Summary
5. Quality / Benchmark Matrix Summary
6. Real DSH End-to-End Revalidation
7. Secrecy / Hidden Routing / Restart Recovery Revalidation
8. `NEW-R1` Preview / History UX Recheck
9. Reliability / Provider-Fallback Evidence
10. Failures grouped by severity
11. Blocked / Skipped / Not Run with reasons
12. Comparison vs prior targeted retest
13. Release-Readiness Assessment
14. Final Verdict

For each failure, include:

- ID
- severity
- area
- exact or concise reproduction
- expected
- actual
- evidence
- likely layer
- whether it is NEW or KNOWN

## Final Verdict Vocabulary

Use one of:

- `FULL REGRESSION GREEN — RELEASE READY`
- `FULL REGRESSION COMPLETE — NOT RELEASE READY`
- `FULL REGRESSION NOT GREEN — FIX BEFORE RELEASE`
- `FULL REGRESSION BLOCKED`

Given the currently known `NEW-R1` HIGH, `FULL REGRESSION GREEN — RELEASE READY` is only valid if `NEW-R1` is no longer reproducible and no equivalent HIGH/BLOCKER remains.

## Completion Commit Contract

The final staged set must contain only:

- `docs/test-results/dsh-vision-codex-full-regression.md`
- deletion of `docs/agent-tasks/ACTIVE_CODEX_TASK.md`
- deletion of `docs/test-instructions/ACTIVE_CODEX_TEST_PROMPT.txt`

Run:

```bash
git diff --cached --name-only
```

before committing. If any source/test/config file appears, unstage it and do not modify it.

Suggested commit message:

`test: record full Codex regression`

Final chat reply must be concise and contain only:

- Tested Source Commit SHA
- Report Commit SHA
- PASS / FAIL / PARTIAL-BLOCKED counts for the primary full-regression gates
- BLOCKER count
- HIGH count
- MEDIUM count
- Final Verdict
- Report Path
