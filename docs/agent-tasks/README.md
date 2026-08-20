# Agent task queue

This directory contains per-run task instructions for Agent Handoff Protocol v1.

Permanent rules live in `../agent-workflow.md`.

## Active task names

- `ACTIVE_ZCODE_TASK.md`
- `ACTIVE_CODEX_TASK.md`

An ACTIVE file exists only while that agent has a task. The executing agent deletes it in the completion commit.

If an expected ACTIVE file does not exist, the agent must stop. It must not infer a task from old reports, chat history, issues, or nearby repository changes.

## Templates

- `TEMPLATE_IMPLEMENT.md` — implementation task, normally used for ZCode.
- `TEMPLATE_TEST_ONLY.md` — independent verification task, normally used for Codex.

Templates are permanent and must not be deleted when a task completes.
