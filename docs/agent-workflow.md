# Agent Handoff Protocol

Workflow source: `Ran-sh/chatgpt_workflow` v1.7.0 (`c38d94c48ebb1c48cff2eeba685dea69667f9998`).

## 1. Operating model

GitHub is the durable source of truth. ChatGPT is the orchestrator; Codex, ZCode, Claude Code, DeepSeek Harness, and other compatible agents are remote execution platforms.

The intended loop is:

```text
User request
  -> ChatGPT inspects/changes GitHub directly
  -> local or real-environment work remains
  -> ChatGPT commits ACTIVE_TASK.json
  -> user sends one short executor trigger
  -> executor performs the task and commits a Result Contract
  -> ChatGPT reads GitHub and continues
```

ChatGPT should not create executor work for repository operations it can already complete safely through GitHub.

## 2. Task authority

The only authoritative active task is:

`docs/agent-tasks/ACTIVE_TASK.json`

Codex, ZCode, Claude Code, DeepSeek Harness, or another compatible executor may execute the same Task Contract. Executor identity never grants permissions.

If `ACTIVE_TASK.json` is missing or invalid, stop. Do not infer work from chat history, issues, old reports, source code, historical executor-specific ACTIVE files, or another executor.

`ACTIVE_TASK.md` may exist only as a non-authoritative human companion. JSON wins on conflict.

The normal user-facing trigger is intentionally minimal:

```text
Execute ACTIVE_TASK.json according to Agent Workflow Protocol.
```

All project requirements belong in the Task Contract, not in the trigger.

## 3. Modes

- `IMPLEMENT` — implementation changes only inside `allowed_changes`.
- `TEST_ONLY` — validation/reporting only; writable paths are limited to `docs/agent-results/**`.
- `REVIEW_ONLY` — inspection/reporting only; writable paths are limited to `docs/agent-results/**`.

The task, not the executor, determines scope.

## 4. Start-of-task protocol

Resolve the equivalent of:

```sh
git pull --ff-only
git rev-parse HEAD
git branch --show-current
git status --short
```

Then validate the task when local Node is available:

```sh
node .agent-workflow/validator/validate-contract.mjs task docs/agent-tasks/ACTIVE_TASK.json
```

Confirm `source_branch` and `source_commit` before work.

`source_commit: LATEST` means: after fetching/pulling according to repository policy, resolve and execute the current tip of `source_branch`, and record the exact SHA actually used in the Result Contract. This is the normal value for a task committed to the same branch because the task commit itself moves the branch tip.

Use an explicit SHA only when ChatGPT intentionally pins execution to an immutable revision. Never silently substitute another revision for an explicit SHA.

Never reset, clean, stash, overwrite, or discard unrelated user changes without explicit task authorization.

## 5. Scope and safety

- Modify only `allowed_changes`.
- Treat `forbidden_changes` as hard prohibitions.
- Everything else is read-only.
- `result_contract` must be under `docs/agent-results/**` and must itself appear in `allowed_changes`.
- Do not invent project commands.
- Never expose credentials, bearer tokens, cookies, API keys, signed URLs, credential-file contents, secret environment values, or private local paths.
- Separate defects discovered during execution belong in the result report, not in opportunistic fixes.

## 6. Validation states

Use exactly: `PASS`, `FAIL`, `PARTIAL`, `SKIP`, `BLOCKED`, `NOT RUN`.

Never convert a skipped, blocked, partial, or not-run check into PASS.

## 7. Execution lifecycle

New execution results use **Result Contract v2** (`schema_version: 2`). Historical Result Contracts without `schema_version` are legacy v1 and remain valid; do not rewrite old reports only to upgrade their format.

1. Read this workflow.
2. Read and validate `ACTIVE_TASK.json`.
3. Confirm source revision and worktree safety.
4. Start a Result Contract v2 draft and record `timeline.started_at` at second precision with timezone when real task execution begins.
5. Execute only authorized work in the real environment.
6. Run every required validation or record why it is `BLOCKED`, `SKIP`, or `NOT RUN`.
7. Finish writing the Result Contract and record `timeline.completed_at` at second precision with timezone.
8. Run the installed Result validator with `--stamp` so the validator itself writes `result_validation` evidence:

   ```sh
   node .agent-workflow/validator/validate-contract.mjs result <result-json> --stamp
   ```

9. Verify `acceptance_criteria`. A new Result Contract v2 without stamped validator evidence is incomplete.
10. When the task is actually complete and `delete_active_task_on_completion` is true, delete `ACTIVE_TASK.json`; delete `ACTIVE_TASK.md` too when the completion contract includes it.
11. Commit/push only paths in `completion_commit_contract` and follow repository branch/PR policy.
12. Stop. Do not self-assign follow-up work.

The completion contract must include the Result Contract and deletion of `docs/agent-tasks/ACTIVE_TASK.json`.

## 8. Result handoff

New Result Contracts must include `schema_version: 2` and the auditable timeline:

```text
timeline.started_at
  -> local execution and required checks
  -> timeline.completed_at
  -> validator --stamp
  -> result_validation.validated_at
```

All three timestamps use ISO 8601 with year, month, day, hour, minute, second, and timezone, for example `2026-08-21T15:12:04+08:00`. Milliseconds are not used.

`result_validation` is validator-owned evidence. Executors must not manually claim validator success. The validator writes `status: PASS`, the canonical command, the validation timestamp, and success evidence only after the v2 draft passes validation; the stamped final document is validated again before it is written.

Historical v1 Result Contracts, identified by the absence of `schema_version`, remain valid without the v2 timeline/stamp fields.

After execution, the user may simply tell ChatGPT that the executor finished. ChatGPT should inspect GitHub directly, evaluate the Result Contract and commit/PR, then continue the next GitHub-side action or create the next Task Contract.

Executors do not self-assign follow-up work.

## 9. When ChatGPT hands off

Create an ACTIVE Task only when meaningful work cannot actually be completed through GitHub or requires the user's real environment, such as:

- local build/test/benchmark/runtime execution;
- real DSH/plugin/browser/device/GPU/platform behavior;
- local-only files or workspace state;
- credentials, accounts, registries, signing keys, release or publishing tooling;
- runtime truth that repository contents alone cannot establish.

If ChatGPT can safely make and verify the repository change through GitHub, it should do so directly instead of delegating by default.

## 10. dsh-vision project facts

```text
Repository: Ran-sh/dsh-vision
Default branch: main
Package manager: npm (package-lock.json is authoritative)
Runtime: Node 22 / 24 in CI
Language: TypeScript / JavaScript ESM workspace
Source: packages/vision and packages/image-mind
Typecheck: npm run typecheck
Build: npm run build
Primary tests: npm test
E2E entry: npm run test:e2e
Package integrity: npm run test:package
Built-artifact verification: npm run test:built
CI: .github/workflows/ci.yml
DSH compatibility CI: .github/workflows/dsh-compat.yml
Result contracts: docs/agent-results/
```

Do not invent a lint command: the root package currently defines no dedicated lint script.

### Protected areas

Unless an `IMPLEMENT` task explicitly allows them, keep these read-only:

- `.github/workflows/**`
- `package.json`, workspace package manifests, `package-lock.json`, and version/release metadata
- credentials, provider secrets, `.env`, `.credentials.yml/.yaml`, signed URLs, local DSH credential/config stores
- release/install behavior and unrelated product documentation

Real DSH/provider checks must distinguish observable runtime behavior from source-only conclusions and must never persist credentials.

### Branch / PR policy

Do not push implementation changes directly to `main` unless the task explicitly authorizes it. Prefer a feature/fix branch and PR. Never force-push, reset, or rewrite unrelated history.

### Default implementation validation

Unless the task intentionally narrows the matrix, implementation work should consider:

```sh
npm run typecheck
npm run build
npm test
```

For package/release changes, also consider the configured package/built checks and GitHub Actions matrix. Platform-specific behavior must be validated on the relevant platform.

## 11. Installation/removal

This repository was migrated from a pre-v1.7 workflow. `docs/.agent-workflow-install.json` records newly generated files separately from pre-existing workflow files that were modified/adopted. Automated uninstall may remove only `generated_files`; migrated/adopted files require explicit review before deletion.

Workflow infrastructure is development-only and is not a required product runtime dependency.
