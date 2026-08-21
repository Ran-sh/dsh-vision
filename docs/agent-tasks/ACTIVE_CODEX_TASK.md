# ACTIVE Codex Task — Targeted Release Retest

Protocol: Agent Handoff Protocol v1  
Agent: CODEX  
Mode: TEST_ONLY  
Source Branch: main  
Source Commit: LATEST_MAIN  
Result Path: `docs/test-results/dsh-vision-codex-release-retest.md`  
Delete Active Task On Completion: YES

## Goal

Independently validate the release-readiness fixes merged after the full regression, with minimal real-provider spend.

Primary targets:

1. `NEW-R1` — HIGH — sent-message/history image preview UX.
2. `FR-001` — MEDIUM — two-image comparison answer was truncated by the historical 1024-token default provider cap.

This is a **TEST_ONLY** cycle. Do not repair failures.

## Context

Previous full-regression report:

`docs/test-results/dsh-vision-codex-full-regression.md`

Previous full-regression verdict:

`FULL REGRESSION COMPLETE — NOT RELEASE READY`

Previous unresolved severity totals:

- BLOCKER: 0
- HIGH: 1 (`NEW-R1`)
- MEDIUM: 3 (`F-007`, `F-008`, `FR-001`)
- LOW: 1 (`F-012`)

Implementation commit that this retest is intended to validate:

`5037407b37b23d7df2774918a2f36ec81f90907c`

That implementation does two things:

- adds a secrecy-safe committed preview-history ledger and opaque preview route so historical thumbnails can survive send/session-switch/restart without restoring raw attachment metadata to conversation text;
- raises the **default** provider `maxOutputTokens` hard cap from 1024 to 3000 so task-aware compare/OCR/document budgets can be honored, while an explicitly configured lower user cap remains authoritative.

Known real provider topology remains:

`DSH -> image-mind -> OpenCode Go plan -> Muse API -> mimo-v2.5`

Independent real gateway count remains 1 unless current evidence proves otherwise.

Known provider limitations `F-007` / `F-008` are not the target of this cycle. Do not rerun the full 21-case corpus merely to reconfirm them.

## Required Read Order

1. `docs/agent-workflow.md`
2. this ACTIVE task
3. `docs/test-instructions/ACTIVE_CODEX_TEST_PROMPT.txt`
4. `docs/test-results/dsh-vision-codex-full-regression.md`
5. `docs/test-results/dsh-vision-codex-blocker-high-retest.md`
6. relevant current source/tests for preview history and output budgets
7. root/workspace `package.json` files needed to execute commands

Do not read or modify another Agent's ACTIVE task.

## Allowed Changes

Only:

1. create/update `docs/test-results/dsh-vision-codex-release-retest.md`;
2. delete `docs/agent-tasks/ACTIVE_CODEX_TASK.md` when complete;
3. delete `docs/test-instructions/ACTIVE_CODEX_TEST_PROMPT.txt` when complete.

Temporary local screenshots/logs/test images/benchmark outputs are allowed for evidence but must not be committed by default.

## Forbidden Changes

Do not:

- modify source;
- modify existing tests/assertions/fixtures;
- loosen expectations;
- change package versions, lockfiles, config schemas, build scripts, CI, README, CHANGELOG, or verification-debt docs;
- repair any failure;
- reintroduce attachment ids, raw attachment routes, attachment JSON, routing comments, tool names, or secret metadata into user-visible conversation text;
- spend quota on the five-model Qwen matrix, full 21-case quality matrix, forced 413/429 generation, or unsupported provider combinations;
- expose API keys, cookies, bearer tokens, signed URLs, credential contents, or secret-bearing logs;
- reset/stash/clean/overwrite unrelated user work.

A failure is evidence. Record it; do not fix it.

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

Record all four results.

The task header intentionally uses `LATEST_MAIN` because this ACTIVE instruction commit may sit on top of implementation commit `5037407b37b23d7df2774918a2f36ec81f90907c`. Test the pulled latest `main` and record the exact SHA actually tested. Do not silently switch revisions.

## Required Work

1. Execute the targeted static tests specified by the specialized prompt.
2. Execute a clean release-safety lane with build before root package/built assertions.
3. Revalidate real DSH image send behavior using the current built/shipped plugin.
4. Verify `NEW-R1` in the browser for one image and two images, including click/open, session switch, and host restart/reopen.
5. Verify the preview fix does **not** regress F-002 secrecy or F-003 durable model-side recovery.
6. Verify `FR-001` with the known working MiMo route using a two-image comparison whose answer previously needed more than 1024 output tokens; use the repository/native benchmark path when the frozen `compare-02` fixture is available.
7. Confirm the effective default compare request is no longer capped to 1024 and that the required comparison evidence is completed.
8. Do not rerun the full 21-case real-provider matrix unless a targeted result is ambiguous and the extra run is strictly necessary to determine release readiness.
9. Produce one durable report; do not patch failures.
10. Commit/push only the permitted report + ACTIVE-file deletions.

## Required Tests

At minimum run:

```bash
npm ci
npm run typecheck
npm run build
npm test
npm run test:package
npm run test:built
```

The order intentionally builds before root `npm test` because the current root suite contains built/package assertions. Do not modify CI in this TEST_ONLY task; merely report any CI-ordering observation separately if relevant.

Also run targeted tests covering at least:

- committed preview ledger persistence;
- preview route restart behavior;
- neutral-marker history mapping;
- send-hook secrecy/routing;
- attachment restart recovery;
- task-budget routing;
- default output cap;
- tool-thin/orchestration contracts if the output-budget change affects them.

Exact current file names should be discovered from the repository rather than invented if they differ.

## NEW-R1 Acceptance Criteria

For one-image and two-image sends through real DSH:

- draft preview exists before send;
- send succeeds once without duplicate user messages/tool calls caused by preview logic;
- sent historical user message displays the correct thumbnail/gallery;
- thumbnail/gallery is clickable and opens a usable full-size/large preview;
- switch to another session and back: historical preview is still present and correct;
- restart the DSH host, reopen the same session: historical preview is still present and correct;
- the old image remains model-readable after restart without re-upload;
- the rendered user bubble contains only the user's own text plus neutral marker (`已附加图片。` / `已附加 N 张图片。`);
- user-visible conversation text contains no `attachmentId`, `sha256:`, `/image-mind/raw/`, raw attachment JSON, dimensions/bytes metadata, tool-routing comments, or `understand_image` instruction;
- a safe browser preview URL may be used internally, but it must not contain the raw attachment id and must not restore `/image-mind/raw/` into conversation text.

Any failure of sent/history/switch/restart preview is still `NEW-R1 FAIL — HIGH` even if model-side reread succeeds.

## FR-001 Acceptance Criteria

Using the default provider output-cap behavior (do not manually increase it just for the test):

- static config resolves the default hard cap to 3000;
- an explicitly configured lower cap still remains lower (regression guard);
- the compare task policy still requests its intended task-aware budget;
- the effective real two-image comparison request is not silently flattened to 1024;
- the previous `compare-02` style comparison can finish the required evidence/assertion without truncating solely because of a 1024-token cap;
- no new routing/provider/model fallback regression is introduced.

If the provider itself rejects a >1024 cap or independently truncates despite the client requesting the intended budget, record the exact distinction rather than attributing it to the fixed config layer.

## Release-Readiness Interpretation

Use `RELEASE RETEST GREEN — READY TO RELEASE` only when all are true:

- NEW-R1 = PASS;
- FR-001 = PASS;
- full targeted static/release-safety lane = PASS;
- F-002 secrecy = PASS;
- F-003 restart recovery = PASS;
- shipped/built real DSH path = PASS;
- no new BLOCKER or HIGH regression is found;
- Codex made no source changes.

Known provider limitations `F-007` / `F-008` may remain documented MEDIUM limitations if unchanged; do not relabel them PASS without rerunning them, and do not let them obscure whether the two implemented release targets are fixed.

Use one final verdict:

- `RELEASE RETEST GREEN — READY TO RELEASE`
- `RELEASE RETEST NOT GREEN — FIX BEFORE RELEASE`
- `RELEASE RETEST BLOCKED`

## Result / Report Contract

Create `docs/test-results/dsh-vision-codex-release-retest.md` with at minimum:

1. Test Identity
2. Environment / exact tested SHA / clean-state evidence
3. Targeted Static Results
4. Clean Release-Safety Lane
5. NEW-R1 Real DSH Preview/History Retest
6. F-002 Secrecy Regression Check
7. F-003 Restart Recovery Regression Check
8. FR-001 Output-Budget / Two-Image Retest
9. Failures with severity and NEW/KNOWN classification
10. Blocked / Skipped / Not Run
11. Comparison vs full-regression report
12. Release-Readiness Assessment
13. Final Verdict

For every failure include:

- ID
- severity
- status
- NEW/KNOWN
- reproduction
- expected
- actual
- evidence
- likely layer

## Completion Commit Contract

Final staged set must contain only:

- `docs/test-results/dsh-vision-codex-release-retest.md`
- deletion of `docs/agent-tasks/ACTIVE_CODEX_TASK.md`
- deletion of `docs/test-instructions/ACTIVE_CODEX_TEST_PROMPT.txt`

Before commit:

```bash
git status --short
git diff --cached --name-only
```

If any source/test/config/CI/unrelated file appears, unstage it and do not include it.

Suggested completion commit:

`test: record release-readiness retest`

Final chat reply must contain only:

- Tested Source Commit SHA
- Report Commit SHA
- NEW-R1 status
- FR-001 status
- Targeted/static PASS / FAIL / PARTIAL-BLOCKED counts
- BLOCKER count
- HIGH count
- MEDIUM count (including known provider limitations, clearly labeled)
- Final Verdict
- Report Path
