Protocol: Agent Handoff Protocol v1
Agent: CODEX
Mode: REVIEW_ONLY
Source Branch: main
Source Commit: LATEST
Result Path: docs/agent-results/<agent>-<task>-review.md
Delete Active Task On Completion: YES

# Goal

Describe the exact review question: architecture, correctness, security, regression risk, PR/diff quality, or release readiness.

# Context

Provide the minimum relevant design and constraints.

# Allowed Changes

- The review report path explicitly listed above.
- Deletion of the executing agent's ACTIVE task.

# Forbidden Changes

- Source code.
- Existing tests.
- CI, package metadata, or release configuration.

# Required Review

1. Inspect the requested source/diff/tests.
2. Identify concrete defects, regressions, unsafe assumptions, and missing validation.
3. Rank findings by severity.
4. Cite file paths/symbols/observable evidence.
5. Do not implement fixes.

# Acceptance Criteria

- Findings are evidence-based and scoped to the task.
- No source files changed.
- False certainty is avoided; unknowns are labelled.

# Result / Report Contract

Include:

- source SHA;
- scope reviewed;
- findings ordered by severity;
- evidence;
- missing tests/unknowns;
- overall verdict;
- recommended next action without performing it.

# Completion Commit Contract

Only the requested review report and deletion of the corresponding ACTIVE task may be committed.
