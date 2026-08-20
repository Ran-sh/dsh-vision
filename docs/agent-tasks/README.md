# Agent task queue

This directory contains per-run task instructions for Agent Handoff Protocol v1.

Permanent rules live in `../agent-workflow.md`.

## Active task names

- `ACTIVE_ZCODE_TASK.md`
- `ACTIVE_CODEX_TASK.md`
- `ACTIVE_DEEPSEEK_HARNESS_TASK.md`

An ACTIVE file exists only while that agent has a task. The executing agent deletes it in the completion commit/result handoff.

If an expected ACTIVE file does not exist, the agent must stop. It must not infer a task from old reports, chat history, issues, or nearby repository changes.

An agent must not consume another agent's ACTIVE file unless that file explicitly declares `Agent: ANY` and the user directs that agent to execute it.

## Templates

- `TEMPLATE_IMPLEMENT.md` — implementation task, normally used for ZCode.
- `TEMPLATE_TEST_ONLY.md` — independent verification task, normally used for Codex.
- `TEMPLATE_DEEPSEEK_HARNESS.md` — runtime/operator task, normally used for real Harness interaction and agent-routing verification.

Templates are permanent and must not be deleted when a task completes.
