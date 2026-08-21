# Short Triggers

All compatible executors use the same task path and permissions.

## Canonical trigger

```text
Pull the latest target branch. Read `docs/agent-workflow.md`, then read and validate `docs/agent-tasks/ACTIVE_TASK.json`. Execute exactly that task and do not expand scope. Write the required Result Contract/report, remove `ACTIVE_TASK.json` and its `ACTIVE_TASK.md` companion if present only when the task is complete, and commit/push only paths authorized by the Task Contract. If the ACTIVE task is missing or invalid, stop instead of inferring work.
```

中文短触发词：

> 拉取最新目标分支，完整读取 `docs/agent-workflow.md`，再读取并验证 `docs/agent-tasks/ACTIVE_TASK.json`；只执行该任务，不扩大范围。完成后写入要求的 Result Contract，按契约删除 ACTIVE 文件并只提交允许的路径。ACTIVE 缺失或无效就停止，不要猜任务。

Codex、ZCode、Claude Code、DeepSeek Harness 以及未来兼容 Executor 都使用同一条触发词。
