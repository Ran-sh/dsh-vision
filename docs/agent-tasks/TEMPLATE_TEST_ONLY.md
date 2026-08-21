# TEST_ONLY Human Authoring Guide

Machine authority: `ACTIVE_TASK.json`.

`mode` is `TEST_ONLY`. No source, existing test, configuration, CI, package, or release modification is allowed. Writable paths are limited to `docs/agent-results/**`; completion may also delete `ACTIVE_TASK.json` and an explicitly listed `ACTIVE_TASK.md` companion.

Use only `PASS`, `FAIL`, `PARTIAL`, `SKIP`, `BLOCKED`, `NOT RUN` for validation states. Failure is evidence, not permission to repair the repository.

Executor identity does not change permissions.
