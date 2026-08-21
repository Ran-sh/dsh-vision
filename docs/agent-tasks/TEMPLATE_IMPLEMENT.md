# IMPLEMENT Human Authoring Guide

Machine authority: `ACTIVE_TASK.json`.

Required contract fields: `id`, `mode: IMPLEMENT`, `source_branch`, `source_commit`, `objective`, `context`, explicit `allowed_changes`, non-empty `forbidden_changes`, `validation`, `acceptance_criteria`, `result_contract`, `completion_commit_contract`, and `delete_active_task_on_completion: true`.

IMPLEMENT must explicitly enumerate writable paths. The result contract must be under `docs/agent-results/**` and included in both `allowed_changes` and `completion_commit_contract`. Completion must include deletion of `docs/agent-tasks/ACTIVE_TASK.json`.

Executor identity does not change permissions.
