# ACTIVE Codex Task — Full Regression

Protocol: Agent Handoff Protocol v1  
Agent: CODEX  
Mode: TEST_ONLY  
Source Branch: main  
Source Commit: LATEST_MAIN  
Result Path: `docs/test-results/dsh-vision-codex-full-regression.md`  
Delete Active Task On Completion: YES

## Goal

Run the broader/full regression now that the targeted BLOCKER/HIGH retest is green. This is an independent validation cycle only. Do not fix source code.

The purpose of this run is to determine whether the current baseline has any additional release-readiness regressions before implementation resumes.

## Context

Previous report baseline commit before this ACTIVE instruction cycle:

`4767dc243ef75b298e29cbfae1c36776943835c6`

Previous targeted verdict:

`TARGETED GREEN — READY FOR FULL REGRESSION`

Previous targeted result:

- 8 PASS / 1 FAIL / 0 PARTIAL-BLOCKED
- BLOCKER: 0
- HIGH: 1

Known remaining HIGH:

`NEW-R1` — conversation sent-image preview/history UX regression.

The previous targeted cycle confirmed the shipped real DSH image path, secrecy + hidden routing, restart recovery, execution-gate behavior, provider-reliability logic, contract tests, Windows Node 24 benchmark transform, and full static lane were green. It deliberately did not rerun the broader historical quality matrix.

Known working real route:

`DSH -> image-mind -> OpenCode Go plan -> Muse API -> mimo-v2.5`

Independent real gateway count remains 1 unless current environment evidence proves otherwise.

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

## Allowed Changes

Only:

1. create/update `docs/test-results/dsh-vision-codex-full-regression.md`;
2. delete `docs/agent-tasks/ACTIVE_CODEX_TASK.md` when complete;
3. delete `docs/test-instructions/ACTIVE_CODEX_TEST_PROMPT.txt` when complete.

Temporary local logs/screenshots/build outputs are allowed as evidence but must not be committed by default.

## Forbidden Changes

Do not:

- modify business/source code;
- refactor;
- edit existing tests/assertions to make failures pass;
- loosen expectations;
- change package versions, lockfiles, tsconfig, Vitest config, package/config schemas, build scripts, CI, README, CHANGELOG, or `docs/verification-debt.md`;
- hide, downgrade, or omit failures;
- spend quota on unsupported provider/model combinations that were previously ruled out unless explicitly required by the specialized prompt;
- expose credentials, bearer tokens, cookies, signed URLs, API keys, or secret-bearing error output;
- reset, clean, stash, overwrite, delete, or commit unrelated user work.

A failure is evidence. Record it; do not repair it.

Use only:

`PASS / FAIL / PARTIAL / SKIP / BLOCKED / NOT RUN`

## Start-of-Task Safety

Before testing:

```bash
git pull --ff-only origin main
git rev-parse HEAD
git branch --show-current
git status --short
```

Record all four results in the report.

Because this ACTIVE task and specialized prompt are instruction-only commits that may sit on top of the previous report baseline, the task header intentionally uses `Source Commit: LATEST_MAIN`. Test the pulled latest `main` and record the exact SHA actually tested. Do not silently switch revisions.

If the worktree contains user changes, preserve them exactly.

## Required Work

1. Run the full static repository lane from a clean install as specified in the specialized prompt.
2. Run the repository's broader/full automated regression suites, including the previously established quality/benchmark matrix where supported and quota-safe.
3. Revalidate the real DSH end-to-end image path with the known working OpenCode Go → Muse API → MiMo route, using the minimum real-provider calls needed for credible integration evidence.
4. Revalidate secrecy + hidden routing + restart recovery.
5. Recheck the known `NEW-R1` HIGH independently from secrecy/routing. Do not reintroduce raw attachment ids/URLs/metadata into user-visible conversation text as a workaround.
6. Revalidate the repaired deterministic areas: execution gating, provider reliability, orchestration/tool contracts, and Windows Node 24 benchmark transform.
7. Preserve the distinction between deterministic local reliability evidence and independent real-provider failover. If only one real gateway exists, independent failover is not validated.
8. Compare findings against the previous targeted report and identify every new BLOCKER/HIGH/MEDIUM/LOW regression with reproduction and evidence.
9. Produce one durable report only. Do not patch any failure.
10. Before commit, verify staged paths exactly match the completion contract.
11. Commit and push the report-only completion commit if the environment permits.

## Required Tests

At minimum execute the commands/scenarios required by `docs/test-instructions/ACTIVE_CODEX_TEST_PROMPT.txt`, including:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:package
npm run test:built
```

Also execute the repository's intended broader/full regression and quality/benchmark entrypoints discovered from current repository scripts/docs, without modifying them.

Real-environment scenarios must include:

- image-only real DSH send;
- image + text real DSH request;
- two-image comparison;
- shipped bundle crash regression check;
- user-visible secrecy + hidden routing;
- same-session restart attachment recovery;
- `NEW-R1` draft/sent/history/switch/restart preview behavior.

Where Windows Node 24 evidence is available, explicitly re-run the benchmark transform/collection regression described in the specialized prompt.

## Acceptance Criteria

- [ ] Every requested scenario has an explicit truthful status.
- [ ] Full static lane is executed rather than inferred from targeted tests.
- [ ] Broader/full regression matrix size actually executed is recorded.
- [ ] Real DSH shipped/built plugin path is exercised with real visual evidence.
- [ ] User-visible secrecy remains green and hidden routing still works.
- [ ] Restart recovery remains green without conversation-text metadata dependency.
- [ ] `NEW-R1` is independently rechecked and not downgraded because model-side recovery works.
- [ ] Every failure includes severity, reproduction, expected/actual, evidence, likely layer, and NEW/KNOWN classification.
- [ ] Blocked/Skipped/Not Run items state concrete reasons.
- [ ] No source/test/config changes are introduced by Codex.
- [ ] No secrets are present in report/log excerpts.
- [ ] Final release-readiness verdict distinguishes completed regression from release readiness.

Release-ready additionally requires:

- BLOCKER = 0;
- unresolved HIGH = 0, including `NEW-R1`;
- full static lane green;
- broader automated regression/quality matrix meets established acceptance criteria;
- real DSH image execution through the shipped/built plugin works;
- secrecy + hidden routing + restart recovery remain green.

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
10. Windows Node 24 Regression
11. Failures grouped by severity
12. Blocked / Skipped / Not Run with reasons
13. Comparison vs prior targeted retest
14. Release-Readiness Assessment
15. Final Verdict

For each failure include:

- ID
- severity
- status
- NEW or KNOWN
- area
- reproduction
- expected
- actual
- evidence
- likely layer

Use exactly one final verdict:

- `FULL REGRESSION GREEN — RELEASE READY`
- `FULL REGRESSION COMPLETE — NOT RELEASE READY`
- `FULL REGRESSION NOT GREEN — FIX BEFORE RELEASE`
- `FULL REGRESSION BLOCKED`

Given the currently known `NEW-R1` HIGH, `FULL REGRESSION GREEN — RELEASE READY` is valid only if `NEW-R1` is no longer reproducible and no equivalent HIGH/BLOCKER remains.

## Completion Commit Contract

The final staged set must contain only:

- `docs/test-results/dsh-vision-codex-full-regression.md`
- deletion of `docs/agent-tasks/ACTIVE_CODEX_TASK.md`
- deletion of `docs/test-instructions/ACTIVE_CODEX_TEST_PROMPT.txt`

Before commit run:

```bash
git status --short
git diff --cached --name-only
```

If any source/test/config/unrelated file appears, unstage it and do not include it.

Suggested completion commit message:

`test: record full Codex regression`

Final chat reply must be concise and contain only:

- Tested Source Commit SHA
- Report Commit SHA
- PASS / FAIL / PARTIAL-BLOCKED counts for the primary full-regression gates
- BLOCKER count
- HIGH count
- MEDIUM count
- LOW count
- Executed Matrix Size
- Final Verdict
- Report Path
