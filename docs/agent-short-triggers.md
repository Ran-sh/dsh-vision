# Short Triggers

All compatible executors use the same authoritative task:

`docs/agent-tasks/ACTIVE_TASK.json`

Executor choice never changes permissions, scope, validation, or mode semantics.

## Canonical trigger

```text
Execute ACTIVE_TASK.json according to Agent Workflow Protocol.
```

## 中文

```text
执行 ACTIVE_TASK.json，按 Agent Workflow Protocol 完成即可。
```

That is the complete normal trigger for Codex, ZCode, Claude Code, DeepSeek Harness, or another compatible executor. All task detail lives in GitHub.

## Completion signal back to ChatGPT

After the executor commits/pushes the result, the user only needs to say:

```text
Codex finished. Check GitHub.
```

or:

```text
Codex 做完了，检查 GitHub。
```

ChatGPT should read the Result Contract and repository state directly rather than asking the user to paste the report.
