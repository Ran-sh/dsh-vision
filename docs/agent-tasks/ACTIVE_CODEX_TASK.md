# ACTIVE Codex Task — Final NEW-R1 Real DSH Retest

Protocol: Agent Handoff Protocol v1  
Agent: CODEX  
Mode: TEST_ONLY  
Source Branch: fix/new-r1-history-preview-runtime  
Source Commit: 2021551bff392be3c890c01eb6dfcb191185218e  
Result Path: `docs/test-results/dsh-vision-codex-new-r1-final-retest.md`  
Delete Active Task On Completion: YES

## Goal

Validate the completed NEW-R1 runtime history preview fix in real DSH.

## Forbidden Changes

- Do not modify source code.
- Do not modify tests, assertions, configuration, CI, dependencies, or build scripts.
- Do not fix failures.

## Required Validation

- NEW-R1 one-image history preview.
- NEW-R1 two-image ordered history preview.
- Session switch isolation.
- Restart/reopen history preview persistence.
- Thumbnail open/lightbox behavior.
- F002 secrecy.
- F003 old-image reuse after restart.
- No duplicate user messages.
- FR-001 regression status.
- Release safety checks.

## Result Contract

Return Source Commit SHA, Report Commit SHA, test summary, PASS/FAIL/PARTIAL-BLOCKED counts, severity counts, and result path.
