# REVIEW_ONLY Human Authoring Guide

Machine authority: `ACTIVE_TASK.json`.

`mode` is `REVIEW_ONLY`. Source, tests, configuration, CI, package, and release metadata are read-only. Writable paths are limited to `docs/agent-results/**`; completion may also delete the ACTIVE task files explicitly listed in the completion contract.

Report findings with severity and observable evidence. Do not modify code while reviewing.

Executor identity does not change permissions.
