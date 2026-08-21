# Agent Task Contracts

Task Contracts define work; executors only execute it.

Canonical active task:

`docs/agent-tasks/ACTIVE_TASK.json`

`ACTIVE_TASK.md` is optional and non-authoritative. Never create an ACTIVE task as part of workflow installation/migration.

Modes:

- `IMPLEMENT` — may write only explicitly allowed paths.
- `TEST_ONLY` — result/report writes only under `docs/agent-results/**`.
- `REVIEW_ONLY` — result/report writes only under `docs/agent-results/**`.

Any compatible executor may execute any mode. If the active task is missing/invalid, stop rather than infer work.

## Generate a task

From a machine with Node 20+:

```sh
npm exec --yes --package=github:Ran-sh/chatgpt_workflow -- agent-workflow task create --target . \
  --mode TEST_ONLY \
  --objective "Run the requested verification" \
  --validate "npm test" \
  --accept "All required checks are reported" \
  --companion
```

For `IMPLEMENT`, add one or more explicit `--allow <path>` entries. The generator refuses to overwrite an existing ACTIVE task and validates before activation.

Manual authors may start from `TEMPLATE_TASK.json`, replace every placeholder with project facts, then validate it with `.agent-workflow/validator/validate-contract.mjs`.
