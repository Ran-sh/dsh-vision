# ACTIVE ZCode Task — Fix NEW-R1 Runtime History Preview Alignment

Protocol: Agent Handoff Protocol v1  
Agent: ZCODE  
Mode: IMPLEMENT  
Source Branch: main  
Source Commit: LATEST_MAIN  
Result Path: `docs/agent-results/zcode-new-r1-history-preview-runtime-alignment-fix.md`  
Delete Active Task On Completion: YES

## Goal

Fix the reproducible HIGH-severity NEW-R1 release-gate failure where sent image thumbnails are not rendered in real DSH conversation history because host-rendered timestamp text is included after the neutral attachment marker.

The fix must restore one-image and multi-image historical previews without weakening F002 secrecy or causing ordinary user text that merely mentions the marker to be misclassified as an attachment row.

## Context

The release-readiness retest at report commit `ab420c4545214b5d85df3f5b88bf4482dc504ea9` tested source commit `e57329150f15be2b51d7ea8c4cc09878405a16ca` and produced:

- NEW-R1: HIGH / FAIL
- FR-001: PASS
- BLOCKER: 0
- Release verdict: `RELEASE RETEST NOT GREEN — FIX BEFORE RELEASE`

Durable evidence is in:

- `docs/test-results/dsh-vision-codex-release-retest.md`

Observed real-host behavior:

- draft thumbnails render correctly before send;
- the user message is admitted exactly once;
- visual understanding and old-image restart reuse work;
- the durable batch ledger exists and F003 passes;
- after send, session switch, and restart, historical user rows render 0 image preview groups/buttons;
- the real DSH row appends host-rendered time text after the neutral marker;
- current `previewMarkerCount()` only accepts a neutral marker at the final line of the entire row text, so runtime alignment never happens.

Relevant implementation:

- `packages/image-mind/src/client/history-preview.ts`
- `packages/image-mind/tests/history-preview.test.ts`

Current code already locates the message surface with `[data-time-hover-root]` and its first child via `stackForUserRow()`. Prefer fixing marker extraction at the correct message-content boundary rather than broadly accepting arbitrary trailing text after the marker.

## Allowed Changes

- `packages/image-mind/src/client/history-preview.ts`
- `packages/image-mind/tests/history-preview.test.ts`
- `docs/agent-results/zcode-new-r1-history-preview-runtime-alignment-fix.md`
- deletion of `docs/agent-tasks/ACTIVE_ZCODE_TASK.md`

## Forbidden Changes

- any other source or test files
- `packages/image-mind/src/client/attach.ts`
- `packages/image-mind/src/client/send-hook.ts`
- provider/token-budget code (FR-001 is already PASS)
- package versions, lockfiles, dependency changes
- build scripts, CI, configuration schemas
- weakening/removing F002 secrecy behavior
- embedding attachment IDs, SHA-256 values, raw URLs, preview URLs, routing instructions, or raw image bytes into conversation text
- changing durable attachment storage semantics or session isolation
- unrelated cleanup/refactors
- existing user changes

## Required Work

1. Pull/resolve latest `main`, record source SHA, branch, and initial status per `docs/agent-workflow.md`.
2. Read the full release retest report and inspect the current `history-preview.ts` and its tests before editing.
3. Fix NEW-R1 marker detection/alignment narrowly:
   - do not depend on `row.textContent` ending with the neutral marker when the row also contains host UI text such as a timestamp;
   - prefer extracting marker text from the actual user-message content stack/container already used for preview insertion, if that DOM boundary excludes host timestamp text;
   - if the real DOM shape requires another minimal approach, keep it confined to `history-preview.ts` and preserve strict marker recognition so arbitrary trailing user prose does not become a false positive;
   - preserve support for `已附加图片。` and counted markers `已附加 N 张图片。` for valid counts already supported by the code;
   - preserve suffix/tail alignment behavior for paged history.
4. Add/adjust focused tests that reproduce the release failure shape and prove the false-positive boundary:
   - valid single-image marker with host timestamp text outside/after the message content must still map;
   - valid counted marker with host timestamp text must still map;
   - ordinary text such as `已附加图片。 but keeps talking` must remain non-marker;
   - secrecy-sensitive raw metadata strings must remain non-marker;
   - existing tail-alignment tests must continue to pass.
5. Do not modify assertions merely to accommodate broken behavior. The tests must encode the intended real-host contract.
6. Run required tests below. If local DOM/unit coverage cannot fully prove the real-host integration, state that explicitly and leave the final real DSH confirmation to the next TEST_ONLY retest.
7. Inspect final diff and staged paths before commit. Commit only allowed paths plus task deletion/result report.
8. Push the completion commit to `main` as required by the repository workflow.

## Required Tests

At minimum run:

- `npm run typecheck`
- targeted Vitest for `packages/image-mind/tests/history-preview.test.ts`
- any directly adjacent image-mind test needed to confirm no regression in history preview mapping, if it can be run without changing additional files

If practical within the environment, also run the package-level image-mind test lane used by the repository.

Do **not** claim real DSH NEW-R1 PASS unless it was actually exercised in the real host. If not exercised, report it as deferred to independent Codex TEST_ONLY retest.

Any required test that cannot run must be recorded as `BLOCKED` or `NOT RUN` with the concrete reason.

## Acceptance Criteria

- [ ] Marker extraction no longer fails merely because real DSH appends timestamp/host UI text outside the message content.
- [ ] The implementation uses the narrowest reliable DOM/text boundary and does not broadly accept arbitrary prose after the neutral marker.
- [ ] Single-image and counted multi-image markers remain recognized.
- [ ] Non-marker prose containing the same Chinese phrase remains rejected.
- [ ] No attachment ID, digest, raw/preview URL, routing instruction, or raw bytes are introduced into conversation text.
- [ ] Existing session/history tail alignment semantics remain intact.
- [ ] `npm run typecheck` passes.
- [ ] Targeted history-preview tests pass, including a regression case for host timestamp contamination.
- [ ] No files outside `Allowed Changes` are modified by the completion commit.
- [ ] Result report clearly states that independent real-host release retest is still required unless actually executed.

## Result / Report Contract

Create `docs/agent-results/zcode-new-r1-history-preview-runtime-alignment-fix.md` containing:

- source commit SHA
- result commit SHA when known
- exact files changed
- concise root cause
- implementation summary
- why the fix avoids false-positive marker matching
- tests executed with exact PASS / FAIL / BLOCKED / NOT RUN results
- whether real DSH NEW-R1 was exercised
- remaining blockers / deferred verification
- recommended next action: independent Codex TEST_ONLY release retest focused on NEW-R1 if implementation tests are green

Do not include private chain-of-thought.

## Completion Commit Contract

The final commit may contain only:

- `packages/image-mind/src/client/history-preview.ts`
- `packages/image-mind/tests/history-preview.test.ts`
- `docs/agent-results/zcode-new-r1-history-preview-runtime-alignment-fix.md`
- deletion of `docs/agent-tasks/ACTIVE_ZCODE_TASK.md`

Before commit, verify `git diff --cached --name-only` contains no unrelated files.
