# Agent Handoff Protocol v1

GitHub is the durable handoff layer between the user, ChatGPT, ZCode, Codex, DeepSeek Harness, and any future execution agent.

Detailed instructions live in the repository. The user should only need to send a short trigger from a phone, remote terminal, or chat UI.

## Roles

- **ChatGPT**: architecture, diagnosis, task design, acceptance criteria, and result analysis.
- **ZCode**: implementation-oriented executor when the ACTIVE task explicitly permits source changes.
- **Codex**: verification/review executor by default.
- **DeepSeek Harness**: runtime/application/agent-level executor; permissions still come from the ACTIVE task.
- **GitHub**: source of truth for task state, reports, evidence, and commits.

The ACTIVE task, not the agent name, determines permissions.

## Active task files

Use exactly one file per agent:

- `docs/agent-tasks/ACTIVE_ZCODE_TASK.md`
- `docs/agent-tasks/ACTIVE_CODEX_TASK.md`
- `docs/agent-tasks/ACTIVE_DEEPSEEK_HARNESS_TASK.md`

If the expected ACTIVE file does not exist, stop. Do not infer a task from old reports, chat history, issues, or another agent's ACTIVE file.

## Required task header

Every ACTIVE task must start with:

```text
Protocol: Agent Handoff Protocol v1
Agent: ZCODE | CODEX | DEEPSEEK_HARNESS | ANY
Mode: IMPLEMENT | TEST_ONLY | REVIEW_ONLY
Source Branch: <branch>
Source Commit: <sha or LATEST>
Result Path: <path or NONE>
Delete Active Task On Completion: YES
```

## Modes

### IMPLEMENT

Source changes are allowed only inside `Allowed Changes`.

The agent must:

1. Pull the requested branch.
2. Record source SHA and initial worktree status.
3. Read this protocol and the full ACTIVE task.
4. Modify only explicitly allowed paths.
5. Run required tests.
6. Record blocked/not-run validation truthfully.
7. Inspect the final diff.
8. Commit only allowed changes, requested reports, and deletion of its ACTIVE task.
9. Push the requested branch if the environment supports it and the task requires it.

### TEST_ONLY

No source modification is allowed.

Do not modify implementation, existing tests, assertions, schemas, package versions, scripts, or CI to make failures disappear.

Allowed writes are limited to report/artifact paths explicitly listed by the ACTIVE task and deletion of the ACTIVE task itself.

### REVIEW_ONLY

Read-only review of source, diffs, logs, tests, and reports. A review report may be created only when the ACTIVE task explicitly permits it.

## Start-of-task protocol

Run or resolve the equivalent of:

```sh
git pull --ff-only
git rev-parse HEAD
git branch --show-current
git status --short
```

If the worktree is already dirty, preserve the user's existing changes. Never reset, clean, stash, overwrite, or delete them unless the ACTIVE task explicitly authorizes that action.

If a required source SHA does not match, stop and report the mismatch instead of silently working on another revision.

## Scope discipline

Every ACTIVE task should contain:

- Goal
- Context
- Allowed Changes
- Forbidden Changes
- Required Work
- Required Tests
- Acceptance Criteria
- Result / Report Contract
- Completion Commit Contract

Anything outside `Allowed Changes` is read-only.

Separate defects discovered during the task should be reported, not opportunistically fixed.

## Testing states

Use only:

- `PASS` — executed and met expectation.
- `FAIL` — executed and did not meet expectation.
- `PARTIAL` — only part could be verified.
- `SKIP` — intentionally not applicable.
- `BLOCKED` — required but impossible because of a concrete environment/platform/quota/credential/dependency blocker.
- `NOT RUN` — not executed; reason required.

Never turn SKIP, BLOCKED, PARTIAL, or NOT RUN into PASS.

## Secrets

Never commit or report:

- API keys or bearer tokens
- Authorization headers
- cookies
- credential-file contents
- signed URL queries
- secret-bearing paths
- raw third-party errors containing secrets

Use `[REDACTED]` when needed. Recording `credential: PRESENT` is acceptable.

## Commit contract

Before committing:

```sh
git status --short
git diff --cached --name-only
```

The staged paths must exactly match the ACTIVE task's completion contract.

Do not commit unrelated user changes.

A completion commit normally contains:

- requested implementation and/or report files;
- deletion of that agent's ACTIVE task;
- nothing unrelated.

## ACTIVE lifecycle

1. ChatGPT or the user creates an ACTIVE task.
2. User sends a short trigger to the target agent.
3. Agent pulls and reads the permanent protocol plus its own ACTIVE file.
4. Agent executes only that task.
5. Agent persists any required result/report.
6. Agent deletes its own ACTIVE file.
7. Agent commits/pushes allowed changes.
8. User tells ChatGPT the agent is finished.
9. ChatGPT reads GitHub directly and determines the next task.

## Stable short trigger — ZCode

> 拉取仓库最新目标分支，完整读取 `docs/agent-workflow.md`，再读取并严格执行 `docs/agent-tasks/ACTIVE_ZCODE_TASK.md`。不要扩大任务范围，也不要读取其他 Agent 的 ACTIVE 文件。完成后按协议提交允许的结果、删除自己的 ACTIVE 任务并推送；最后只回复 Source Commit SHA、Result Commit SHA、测试摘要、阻塞项和结果路径。若 ACTIVE 文件不存在则停止，不要自行猜任务。

## Stable short trigger — Codex

> 拉取仓库最新目标分支，完整读取 `docs/agent-workflow.md`，再读取并严格执行 `docs/agent-tasks/ACTIVE_CODEX_TASK.md`。不要扩大任务范围，也不要读取其他 Agent 的 ACTIVE 文件。完成后按协议提交允许的结果、删除自己的 ACTIVE 任务并推送；最后只回复 Source Commit SHA、Result Commit SHA、测试/审查摘要、阻塞项和结果路径。若 ACTIVE 文件不存在则停止，不要自行猜任务。

## Stable short trigger — DeepSeek Harness

> 获取仓库最新目标分支，完整读取 `docs/agent-workflow.md`，再读取并严格执行 `docs/agent-tasks/ACTIVE_DEEPSEEK_HARNESS_TASK.md`。不要扩大任务范围，也不要读取其他 Agent 的 ACTIVE 文件。完成后按协议持久化允许的结果、删除自己的 ACTIVE 任务；若当前环境支持且任务要求，再提交并推送。最后只回复 Source Commit SHA、Result Commit SHA（若有）、执行/测试摘要、阻塞项和结果路径。若 ACTIVE 文件不存在则停止，不要自行猜任务。

## Reporting contract

Durable reports should include:

- source commit;
- environment when relevant;
- work actually performed;
- exact tests executed;
- pass/fail/blocked states;
- important evidence;
- known limitations;
- files changed;
- result commit SHA when applicable;
- recommended next action without performing out-of-scope work.

Do not include private chain-of-thought. Observable evidence and concise technical rationale are enough.

## Project-specific policy

Customize this section in each repository:

```text
Default branch: <main/master/...>
Protected paths: <...>
Required implementation tests: <...>
Required release/build tests: <...>
Result/report directory: <...>
Branch/PR policy: <...>
Environment-specific safety constraints: <...>
```

Per-task details belong in ACTIVE task files, not this permanent protocol.
