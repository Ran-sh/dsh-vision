# Agent Handoff Protocol v1 — Reusable Template

This directory is a project-agnostic reference template for GitHub-driven AI agent handoffs.

Copy the contents into another repository and customize only project-specific paths, test commands, branch policy, and result contracts.

## Suggested project layout

```text
docs/
├─ agent-workflow.md
├─ agent-tasks/
│  ├─ README.md
│  ├─ TEMPLATE_IMPLEMENT.md
│  ├─ TEMPLATE_TEST_ONLY.md
│  ├─ TEMPLATE_REVIEW_ONLY.md
│  ├─ TEMPLATE_DEEPSEEK_HARNESS.md
│  ├─ ACTIVE_ZCODE_TASK.md
│  ├─ ACTIVE_CODEX_TASK.md
│  └─ ACTIVE_DEEPSEEK_HARNESS_TASK.md
└─ agent-results/
   └─ README.md
```

Only create an `ACTIVE_*` file when that agent actually has work. The executing agent deletes its own ACTIVE file in the completion commit.

## Default role split

- **ChatGPT** — architecture, diagnosis, task authoring, acceptance criteria, result analysis.
- **ZCode** — implementation-oriented executor when the ACTIVE task says `Mode: IMPLEMENT`.
- **Codex** — independent test/review executor by default.
- **DeepSeek Harness** — runtime/integration executor for application-level or agent-level scenarios; permissions still come from the ACTIVE task.
- **GitHub** — durable task queue, evidence store, result history, and handoff boundary.

## Stable mobile workflow

1. ChatGPT creates an ACTIVE task on GitHub.
2. User sends one short trigger to the target agent.
3. Agent pulls latest branch and reads `docs/agent-workflow.md` plus its own ACTIVE task.
4. Agent executes only that task.
5. Agent writes the required report/result.
6. Agent deletes its own ACTIVE task.
7. Agent commits/pushes only allowed changes.
8. User tells ChatGPT the agent finished.
9. ChatGPT reads GitHub directly and plans the next iteration.

## Install into another repository

Copy:

- `agent-workflow.md` → `docs/agent-workflow.md`
- `agent-tasks/*` → `docs/agent-tasks/`
- `agent-results/README.md` → `docs/agent-results/README.md`

Then edit the project-specific policy section in `docs/agent-workflow.md`.

The permanent protocol should stay generic. Put task-specific details in ACTIVE files.
