# Agent task queue

Permanent rules live in `../agent-workflow.md`.

Create an ACTIVE file only while that agent has work:

- `ACTIVE_ZCODE_TASK.md`
- `ACTIVE_CODEX_TASK.md`
- `ACTIVE_DEEPSEEK_HARNESS_TASK.md`

The executing agent deletes only its own ACTIVE file in the completion commit.

If the expected ACTIVE file is absent, stop. Do not infer work from another agent's task, old reports, issues, or chat history.

Templates:

- `TEMPLATE_IMPLEMENT.md`
- `TEMPLATE_TEST_ONLY.md`
- `TEMPLATE_REVIEW_ONLY.md`
- `TEMPLATE_DEEPSEEK_HARNESS.md`
