# ACTIVE Agent Task — DeepSeek Harness Template

Protocol: Agent Handoff Protocol v1  
Agent: DEEPSEEK_HARNESS  
Mode: TEST_ONLY  
Source Branch: main  
Source Commit: LATEST_MAIN  
Result Path: `docs/agent-results/deepseek-harness-<task>-report.md`  
Delete Active Task On Completion: YES

## Goal

Describe the exact behavior to verify or operation to perform inside the running DeepSeek Harness environment.

## Context

Include only the runtime/plugin/model/provider facts required for the task.

## Allowed Writes

- the configured result report
- explicitly listed runtime screenshots/log artifacts, if any
- deletion of `docs/agent-tasks/ACTIVE_DEEPSEEK_HARNESS_TASK.md`

If `Mode: IMPLEMENT` is explicitly selected instead, replace this section with a narrow `Allowed Changes` list. No source path is writable merely because the task runs in DeepSeek Harness.

## Forbidden Changes

- unrelated source
- existing tests/assertions unless explicitly permitted by an IMPLEMENT task
- package versions
- CI
- credentials/secrets
- another agent's ACTIVE task

## Required Work

1. Resolve/pull the requested repository revision if repository tooling is available.
2. Record the source commit SHA and environment.
3. Read `docs/agent-workflow.md` and this ACTIVE task in full.
4. Execute the requested real-Harness scenarios.
5. Distinguish observed runtime behavior from source-code inference.
6. Record `PASS`, `FAIL`, `PARTIAL`, `SKIP`, `BLOCKED`, or `NOT RUN` truthfully.
7. Do not repair failures unless this task explicitly uses `Mode: IMPLEMENT`.

## Typical DeepSeek Harness Checks

Use only those required by the specific task:

- main-model agent routing to `understand_image`
- image-only conversation
- image + text conversation
- multi-image comparison
- duplicate/missing tool calls
- attachment persistence across restart
- plugin/tool rendering
- settings/runtime integration
- active provider/model selection
- cache refresh / no-store behavior
- observable latency/error behavior

## Required Tests

List the exact DSH scenarios, prompts, model/provider setup, restart steps, and expected observable results here.

## Acceptance Criteria

- [ ] Every requested scenario has an explicit status.
- [ ] Runtime evidence is sufficient to reproduce important failures.
- [ ] No secret appears in the report.
- [ ] No other agent's ACTIVE task was consumed or modified.
- [ ] No source was modified unless `Mode: IMPLEMENT` explicitly authorized it.

## Result / Report Contract

Create the configured result report containing:

- source commit SHA
- DSH/runtime environment
- provider/model used when relevant
- exact scenarios executed
- observed tool calls / runtime behavior
- pass/fail/blocked matrix
- failures with evidence
- limitations
- result commit SHA when available

## Completion Commit Contract

If the environment supports repository writes and the task requires commit/push, the final commit may contain only:

- the configured result report and explicitly allowed artifacts;
- deletion of `docs/agent-tasks/ACTIVE_DEEPSEEK_HARNESS_TASK.md`.

If commit/push is unavailable, persist the report through the allowed repository/file mechanism if possible and mark commit/push `BLOCKED`. Never claim a push occurred when it did not.
