# ACTIVE Agent Task — IMPLEMENT Template

Protocol: Agent Handoff Protocol v1  
Agent: ZCODE  
Mode: IMPLEMENT  
Source Branch: main  
Source Commit: LATEST_MAIN  
Result Path: `docs/agent-results/<agent>-<task>-report.md`  
Delete Active Task On Completion: YES

## Goal

Describe the concrete implementation outcome.

## Context

Summarize only the architecture and prior decisions required to execute correctly.

## Allowed Changes

- `<explicit path>`
- `<explicit path>`

## Forbidden Changes

- unrelated source
- package versions unless explicitly required
- CI unless explicitly required
- existing user changes

## Required Work

1. ...
2. ...
3. ...

## Required Tests

- `npm run typecheck`
- targeted tests
- other task-specific verification

Any test that cannot run must be reported as `BLOCKED` or `NOT RUN` with a reason.

## Acceptance Criteria

- [ ] ...
- [ ] ...

## Result / Report Contract

Create the configured result report with:

- source commit SHA
- files changed
- implementation summary
- tests executed and exact results
- blockers / deferred verification
- result commit SHA when known

## Completion Commit Contract

The final commit may contain only:

- paths listed in `Allowed Changes`;
- the configured result report, if requested;
- deletion of `docs/agent-tasks/ACTIVE_ZCODE_TASK.md`.

Before commit, verify `git diff --cached --name-only` contains no unrelated files.
