# ACTIVE Codex Task — Fix NEW-R1 Runtime History Preview Alignment

Protocol: Agent Handoff Protocol v1  
Agent: CODEX  
Mode: IMPLEMENT  
Source Branch: main  
Source Commit: LATEST_MAIN  
Result Path: `docs/agent-results/codex-new-r1-history-preview-fix.md`  
Delete Active Task On Completion: YES

## Goal

Fix the HIGH-severity NEW-R1 release failure where sent image thumbnails do not render in real DSH conversation history.

## Context

The release retest found:

- NEW-R1 FAIL
- FR-001 PASS
- BLOCKER 0
- HIGH 1

Root cause evidence:

- draft previews render before send;
- image understanding and restart reuse work;
- historical preview groups/buttons remain zero;
- real DSH user rows append host timestamp text after the neutral attachment marker;
- current alignment logic incorrectly requires the marker to be the final text of the whole row.

## Allowed Changes

- Fix the runtime history preview alignment implementation.
- Add or adjust targeted tests required to prove the fix.
- Add the result report.

## Forbidden Changes

- Do not weaken F002 secrecy.
- Do not add raw attachment identifiers or raw image URLs into conversation text.
- Do not change unrelated features.

## Required Tests

- targeted history preview tests
- typecheck
- relevant release regression checks

## Acceptance Criteria

- [ ] NEW-R1 one-image history preview works.
- [ ] NEW-R1 two-image ordered preview works.
- [ ] Session switch and restart preserve preview behavior.
- [ ] F002/F003 behavior remains intact.

## Result Contract

Return source SHA, result SHA, tests, blockers, and result path.
