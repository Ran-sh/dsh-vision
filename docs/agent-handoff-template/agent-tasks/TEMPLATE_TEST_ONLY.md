Protocol: Agent Handoff Protocol v1
Agent: CODEX
Mode: TEST_ONLY
Source Branch: main
Source Commit: LATEST
Result Path: docs/agent-results/<agent>-<task>-report.md
Delete Active Task On Completion: YES

# Goal

Describe exactly what must be independently verified.

# Context

List relevant features, risk areas, environment constraints, credentials/quotas, and known untestable conditions.

# Allowed Changes

- Result/report paths explicitly listed in this task.
- Deletion of `docs/agent-tasks/ACTIVE_CODEX_TASK.md` on completion.

# Forbidden Changes

- Source code.
- Existing tests or assertions.
- Schemas, build scripts, package versions, CI, and release metadata.
- Any repair intended to make a failing test pass.

# Required Work

1. Record source SHA, branch, environment, and initial worktree status.
2. Execute the requested validation matrix.
3. Preserve observable evidence.
4. Classify every requested scenario as PASS / FAIL / PARTIAL / SKIP / BLOCKED / NOT RUN.
5. Generate the report.

# Required Tests

- `<command or scenario>`
- `<command or scenario>`

# Acceptance Criteria

- No source modification.
- Failures are reported, not repaired.
- Secrets are redacted.
- Every requested scenario has a truthful state and evidence/reason.

# Result / Report Contract

Report at minimum:

- source commit;
- environment;
- exact tests/scenarios;
- outcomes and evidence;
- failures with severity;
- blocked/skipped items and reasons;
- known limitations;
- result commit SHA when applicable.

# Completion Commit Contract

The final commit may contain only:

- the requested report/artifacts;
- deletion of `docs/agent-tasks/ACTIVE_CODEX_TASK.md`.

No source changes are allowed.
