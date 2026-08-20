# Agent Handoff Protocol v1

This repository uses GitHub as the durable handoff layer between ChatGPT, ZCode, Codex, and the user.

The goal is simple: detailed instructions live in the repository; the user only needs to send a short trigger from a phone or remote terminal.

## Roles

- **ChatGPT**: architecture, diagnosis, task design, acceptance criteria, and next-iteration planning.
- **ZCode**: implementation-oriented agent. May modify source only when the ACTIVE task explicitly uses `Mode: IMPLEMENT`.
- **Codex**: independent verification/review agent by default. For `Mode: TEST_ONLY`, it must not modify source.
- **GitHub**: source of truth for task state, handoff instructions, reports, and commits.

Roles are defaults, not hard product restrictions. The ACTIVE task controls what an agent is permitted to do.

## Repository layout

```text
docs/
├─ agent-workflow.md                  # permanent protocol; never deleted per task
├─ agent-tasks/
│  ├─ ACTIVE_ZCODE_TASK.md            # exists only while a ZCode task is active
│  ├─ ACTIVE_CODEX_TASK.md            # exists only while a Codex task is active
│  ├─ TEMPLATE_IMPLEMENT.md
│  └─ TEMPLATE_TEST_ONLY.md
├─ agent-results/
│  └─ <agent>-<task>-report.md         # durable implementation/review reports when requested
├─ test-instructions/
│  └─ ACTIVE_CODEX_TEST_PROMPT.txt     # legacy/current specialized DSH test entry; task removes it when done
└─ test-results/
   └─ dsh-vision-codex-test-report.md  # durable real-DSH verification report
```

An `ACTIVE_*` file is a queue item, not permanent documentation. It should be deleted by the executing agent after the task is completed and its result has been persisted.

## Required task header

Every ACTIVE task must begin with:

```text
Protocol: Agent Handoff Protocol v1
Agent: ZCODE | CODEX | ANY
Mode: IMPLEMENT | TEST_ONLY | REVIEW_ONLY
Source Branch: main
Source Commit: <sha or LATEST_MAIN>
Result Path: <path or NONE>
Delete Active Task On Completion: YES
```

## Modes

### `IMPLEMENT`

The agent may modify only paths explicitly listed under `Allowed Changes`.

Required behavior:

1. Pull the latest requested source branch.
2. Record the source commit SHA and initial `git status --short`.
3. Read this protocol and the complete ACTIVE task before making changes.
4. Do not broaden scope merely because nearby code could also be improved.
5. Implement the requested change.
6. Run the required tests in the ACTIVE task.
7. Record tests that cannot run as `BLOCKED` or `NOT RUN`; never invent a pass.
8. Inspect the final diff before commit.
9. Commit only allowed source changes, task-requested report files, and deletion of the ACTIVE task.
10. Push the requested branch.
11. Return a concise summary with source SHA, result commit SHA, tests, and remaining blockers.

### `TEST_ONLY`

The agent is an independent verifier.

It must not modify source, existing tests, assertions, configuration schemas, package versions, build scripts, or CI merely to make tests pass.

Allowed writes are only the report/artifact paths explicitly listed by the ACTIVE task and deletion of the ACTIVE task itself.

A failure is evidence, not a request to repair the repository.

### `REVIEW_ONLY`

The agent may inspect source, diffs, tests, logs, and reports but must not modify source. It may create a review report only if the ACTIVE task explicitly specifies a result path.

## Start-of-task protocol

Before any work, run or resolve the equivalent of:

```sh
git pull --ff-only
git rev-parse HEAD
git branch --show-current
git status --short
```

If the worktree is already dirty, preserve the user's existing changes. Never erase, reset, clean, stash, or overwrite them without an explicit instruction in the ACTIVE task.

If an ACTIVE task requires a particular source SHA and the checkout does not match, stop and report the mismatch instead of silently testing or implementing another revision.

## Scope discipline

Every ACTIVE task should contain these sections:

- `Goal`
- `Context`
- `Allowed Changes`
- `Forbidden Changes`
- `Required Work`
- `Required Tests`
- `Acceptance Criteria`
- `Result / Report Contract`
- `Completion Commit Contract`

Anything outside `Allowed Changes` is read-only unless the task explicitly says otherwise.

When the agent discovers a separate defect, record it in the result report instead of opportunistically fixing it.

## Testing truthfulness

Use only these result states:

- `PASS` — actually executed and met the stated expectation.
- `FAIL` — executed and did not meet the expectation.
- `PARTIAL` — only part of the requested scenario could be verified.
- `SKIP` — intentionally not applicable in the current environment.
- `BLOCKED` — required but impossible because of environment, credential, quota, platform, dependency, or other concrete blocker.
- `NOT RUN` — not executed; reason required.

Never convert `SKIP`, `BLOCKED`, or `NOT RUN` into `PASS`.

## Secrets and private data

Never commit or report:

- API keys or bearer tokens
- Authorization headers
- cookies
- credential-file contents
- signed URL query strings
- secret-bearing local paths
- raw third-party error text containing credentials

Use `[REDACTED]` when necessary. It is acceptable to record `credential: PRESENT`.

## Commit contract

Before committing, inspect:

```sh
git status --short
git diff --cached --name-only
```

The staged files must exactly match the ACTIVE task's completion contract.

Do not commit unrelated user changes.

The final task commit should normally contain:

- requested implementation or report files;
- deletion of the corresponding `ACTIVE_*` task file;
- no unrelated paths.

If the staged set is broader than allowed, stop and fix the staging set before commit.

## ACTIVE file lifecycle

1. ChatGPT (or the user) creates an ACTIVE task in GitHub.
2. The user sends a short trigger to the target agent.
3. The agent pulls the latest branch and reads this protocol plus the ACTIVE task.
4. The agent executes the task.
5. The agent writes any required durable result/report.
6. The agent deletes the ACTIVE task.
7. The agent commits and pushes only the task-approved changes.
8. The user tells ChatGPT the agent is finished.
9. ChatGPT reads GitHub directly and creates the next task if needed.

If the ACTIVE task is absent, the agent must not invent a task.

## Stable short trigger — ZCode

The user can send ZCode this message for every repository-driven task:

> 拉取仓库最新目标分支，先完整读取 `docs/agent-workflow.md`，再读取并严格执行 `docs/agent-tasks/ACTIVE_ZCODE_TASK.md`。不要扩大任务范围。完成后按协议提交允许的结果、删除 ACTIVE 任务文件并推送；最后只回复 Source Commit SHA、Result Commit SHA、测试摘要、阻塞项和结果路径。若 ACTIVE 文件不存在则停止，不要自行猜任务。

## Stable short trigger — Codex

The user can send Codex this message for every repository-driven task:

> 拉取仓库最新目标分支，先完整读取 `docs/agent-workflow.md`，再读取并严格执行 `docs/agent-tasks/ACTIVE_CODEX_TASK.md`。不要扩大任务范围。完成后按协议提交允许的结果、删除 ACTIVE 任务文件并推送；最后只回复 Source Commit SHA、Result Commit SHA、测试/审查摘要、阻塞项和结果路径。若 ACTIVE 文件不存在则停止，不要自行猜任务。

For the current specialized DSH verification cycle, `docs/test-instructions/ACTIVE_CODEX_TEST_PROMPT.txt` remains the active entry until that cycle finishes. Its instructions take precedence for that test run.

## Reporting contract

A durable agent result should be decision-oriented, not a transcript. It should include:

- source commit tested/modified;
- environment when relevant;
- work actually performed;
- exact tests executed;
- pass/fail/blocked results;
- important evidence;
- known limitations;
- files changed;
- result commit SHA;
- recommended next action, without silently performing out-of-scope work.

Do not include private chain-of-thought. Concise technical rationale and observable evidence are sufficient.

## Conflict resolution

Instruction precedence inside this workflow is:

1. repository/security constraints and explicit user instruction;
2. the current ACTIVE task;
3. this permanent protocol;
4. agent defaults.

If two repository instructions conflict materially, stop the conflicting operation and report the conflict rather than guessing.

## Versioning

This document is **Agent Handoff Protocol v1**. Permanent workflow changes should update this file explicitly. Per-task details belong in ACTIVE task files, not here.
