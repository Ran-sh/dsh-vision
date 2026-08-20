# ACTIVE Agent Task — TEST_ONLY Template

Protocol: Agent Handoff Protocol v1  
Agent: CODEX  
Mode: TEST_ONLY  
Source Branch: main  
Source Commit: LATEST_MAIN  
Result Path: `docs/agent-results/<agent>-<task>-report.md`  
Delete Active Task On Completion: YES

## Goal

Describe the exact verification objective.

## Context

Summarize the relevant architecture, environment, provider limits, and known verification debt.

## Allowed Writes

- the configured result report
- explicitly listed benchmark/log artifacts, if any
- deletion of `docs/agent-tasks/ACTIVE_CODEX_TASK.md`

## Forbidden Changes

- all business source
- all existing tests and assertions
- package/config schemas
- package versions
- CI
- README / CHANGELOG unless explicitly listed as report output
- any fix for a discovered defect

## Required Work

1. Record source SHA, branch, environment, and initial worktree state.
2. Execute the requested verification matrix.
3. Record `PASS`, `FAIL`, `PARTIAL`, `SKIP`, `BLOCKED`, or `NOT RUN` truthfully.
4. Preserve exact useful evidence without exposing secrets.
5. Do not repair failures.

## Required Tests

List exact commands and real-environment scenarios here.

## Acceptance Criteria

- [ ] Every requested scenario has an explicit status.
- [ ] Failures contain reproduction evidence.
- [ ] Blocked items state what is required later.
- [ ] No source changes were introduced by the agent.
- [ ] No secrets are present in the report.

## Result / Report Contract

The report must include:

- source commit SHA
- environment
- tests/scenarios executed
- pass/fail/blocked matrix
- failures with severity and evidence
- skipped/blocked items
- verification-debt mapping when requested
- final readiness verdict

## Completion Commit Contract

The final commit may contain only:

- the configured result report and explicitly permitted test artifacts;
- deletion of `docs/agent-tasks/ACTIVE_CODEX_TASK.md`.

Before commit, run `git diff --cached --name-only`. If any source file appears, remove it from staging and do not commit it.
