# Agent Handoff Protocol

Workflow source: `Ran-sh/chatgpt_workflow` v1.7.0 (`4d41242fc8fc89bb595681047e6e90f460d0d65d`).

## 1. Authority model

GitHub is the shared source of truth. The only authoritative active task is:

`docs/agent-tasks/ACTIVE_TASK.json`

Codex, ZCode, Claude Code, DeepSeek Harness, or another compatible executor may execute the same Task Contract. Executor identity never grants permissions.

If `ACTIVE_TASK.json` is missing or invalid, stop. Do not infer work from chat history, issues, old reports, source code, historical executor-specific ACTIVE files, or another executor.

`ACTIVE_TASK.md` may exist only as a non-authoritative human companion. JSON wins on conflict.

## 2. Modes

- `IMPLEMENT` — implementation changes only inside `allowed_changes`.
- `TEST_ONLY` — validation/reporting only; writable paths are limited to `docs/agent-results/**`.
- `REVIEW_ONLY` — inspection/reporting only; writable paths are limited to `docs/agent-results/**`.

The task, not the executor adapter, determines scope.

## 3. Start-of-task protocol

Resolve the equivalent of:

```sh
git pull --ff-only
git rev-parse HEAD
git branch --show-current
git status --short
```

Then validate the task with the installed validator when local Node is available:

```sh
node .agent-workflow/validator/validate-contract.mjs task docs/agent-tasks/ACTIVE_TASK.json
```

Confirm `source_branch` and `source_commit` before work. A symbolic source such as `LATEST_DEFAULT_BRANCH` must be explicitly present in the task and resolved to the actual commit used.

Never reset, clean, stash, overwrite, or discard unrelated user changes without explicit task authorization.

## 4. Scope and safety

- Modify only `allowed_changes`.
- Treat `forbidden_changes` as hard prohibitions.
- Everything else is read-only.
- `result_contract` must be under `docs/agent-results/**` and must itself appear in `allowed_changes`.
- Do not invent project commands.
- Never expose credentials, bearer tokens, cookies, API keys, signed URLs, credential-file contents, secret environment values, or private local paths.
- Separate defects discovered during execution belong in the result report, not in opportunistic fixes.

## 5. Validation states

Use exactly: `PASS`, `FAIL`, `PARTIAL`, `SKIP`, `BLOCKED`, `NOT RUN`.

Never convert a skipped, blocked, partial, or not-run check into PASS.

## 6. Execution lifecycle

1. Resolve the requested branch/revision and working-tree state.
2. Read this workflow.
3. Read and validate `ACTIVE_TASK.json`.
4. Execute only authorized work.
5. Run every required validation or record why it is `BLOCKED`, `SKIP`, or `NOT RUN`.
6. Write the Result Contract/report.
7. Verify `acceptance_criteria`.
8. When the task is actually complete and `delete_active_task_on_completion` is true, delete `ACTIVE_TASK.json`; delete `ACTIVE_TASK.md` too when the completion contract includes it.
9. Commit/push only paths in `completion_commit_contract` and follow repository branch/PR policy.

The completion contract must include the Result Contract and deletion of `docs/agent-tasks/ACTIVE_TASK.json`.

## 7. Result handoff

Validate machine-readable JSON results with:

```sh
node .agent-workflow/validator/validate-contract.mjs result <result-json>
```

A result must identify the task/source revision, overall status, changed files, validation outcomes, blockers, and result path. ChatGPT or another coordinator decides the next task; executors do not self-assign follow-up work.

## 8. dsh-vision project facts

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

## 9. Installation/removal

This repository was migrated from a pre-v1.7 workflow. `docs/.agent-workflow-install.json` records newly generated files separately from pre-existing workflow files that were modified/adopted. Automated uninstall may remove only `generated_files`; migrated/adopted files require explicit review before deletion.

Workflow infrastructure is development-only and is not a required product runtime dependency.
