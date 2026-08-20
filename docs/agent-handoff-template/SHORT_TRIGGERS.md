# Stable short triggers

These messages are intentionally short. Detailed instructions live in GitHub.

## ZCode

> 拉取仓库最新目标分支，完整读取 `docs/agent-workflow.md`，再读取并严格执行 `docs/agent-tasks/ACTIVE_ZCODE_TASK.md`。不要扩大任务范围，也不要读取其他 Agent 的 ACTIVE 文件。完成后按协议提交允许的结果、删除自己的 ACTIVE 任务并推送；最后只回复 Source Commit SHA、Result Commit SHA、测试摘要、阻塞项和结果路径。若 ACTIVE 文件不存在则停止，不要自行猜任务。

## Codex

> 拉取仓库最新目标分支，完整读取 `docs/agent-workflow.md`，再读取并严格执行 `docs/agent-tasks/ACTIVE_CODEX_TASK.md`。不要扩大任务范围，也不要读取其他 Agent 的 ACTIVE 文件。完成后按协议提交允许的结果、删除自己的 ACTIVE 任务并推送；最后只回复 Source Commit SHA、Result Commit SHA、测试/审查摘要、阻塞项和结果路径。若 ACTIVE 文件不存在则停止，不要自行猜任务。

## DeepSeek Harness

> 获取仓库最新目标分支，完整读取 `docs/agent-workflow.md`，再读取并严格执行 `docs/agent-tasks/ACTIVE_DEEPSEEK_HARNESS_TASK.md`。不要扩大任务范围，也不要读取其他 Agent 的 ACTIVE 文件。完成后按协议持久化允许的结果、删除自己的 ACTIVE 任务；若当前环境支持且任务要求，再提交并推送。最后只回复 Source Commit SHA、Result Commit SHA（若有）、执行/测试摘要、阻塞项和结果路径。若 ACTIVE 文件不存在则停止，不要自行猜任务。

## User → ChatGPT completion signal

After an agent finishes, the user can simply tell ChatGPT one of:

- `ZCode 做完了，检查 GitHub。`
- `Codex 测完了，检查 GitHub。`
- `DeepSeek Harness 跑完了，检查 GitHub。`

ChatGPT should read the repository result directly instead of asking the user to paste the full report again.
