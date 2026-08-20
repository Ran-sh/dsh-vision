Protocol: Agent Handoff Protocol v1
Agent: DEEPSEEK_HARNESS
Mode: TEST_ONLY
Source Branch: main
Source Commit: LATEST
Result Path: docs/agent-results/deepseek-harness-<task>-report.md
Delete Active Task On Completion: YES

# Goal

Describe the runtime/application/agent-level scenario to verify inside DeepSeek Harness.

# Context

List required plugins, models/providers, fixtures, UI flows, profiles, environment constraints, and known quota/credential limits.

# Allowed Changes

- Runtime/test artifacts explicitly listed in this task.
- The result report.
- Deletion of `docs/agent-tasks/ACTIVE_DEEPSEEK_HARNESS_TASK.md`.

# Forbidden Changes

- Source code unless this task explicitly changes `Mode` to IMPLEMENT and lists allowed paths.
- Existing assertions/tests merely to make runtime validation pass.
- Unrelated DSH profiles or user data.

# Required Work

1. Resolve the requested source revision.
2. Record DSH/runtime environment.
3. Execute the requested interactive/runtime scenarios.
4. Capture concise observable evidence.
5. Mark every requested scenario PASS / FAIL / PARTIAL / SKIP / BLOCKED / NOT RUN.
6. Persist the report.

# Required Runtime Scenarios

- <scenario>
- <scenario>

# Acceptance Criteria

- Runtime evidence is tied to the requested source SHA.
- User/private data and secrets are redacted.
- Environment limitations are explicit.
- No source repair is performed in TEST_ONLY mode.

# Result / Report Contract

Include source SHA, DSH/application version, runtime configuration summary, scenarios executed, evidence, failures, blocked items, and overall verdict.

# Completion Commit Contract

If the current environment has Git write access and the task requests a commit, the final commit may contain only the requested report/artifacts and deletion of `docs/agent-tasks/ACTIVE_DEEPSEEK_HARNESS_TASK.md`.

If Git write access is unavailable, mark result persistence/push as `BLOCKED`; do not claim it succeeded.
