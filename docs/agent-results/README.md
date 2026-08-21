# Agent Results

New Result Contracts use **schema_version 2**.

Historical Result Contracts without `schema_version` are legacy v1 and remain valid. Do not rewrite old reports only to upgrade their format.

Result Contract v2 must contain:

- source commit and overall status
- exact validation commands and evidence
- changed files and blockers
- `timeline.started_at` and `timeline.completed_at`
- validator-owned `result_validation`

Use second-precision ISO 8601 timestamps with timezone, for example:

```text
2026-08-21T15:12:04+08:00
```

After all execution evidence is final, run:

```sh
node .agent-workflow/validator/validate-contract.mjs result <result-json> --stamp
```

`--stamp` writes the Result Contract v2 validation evidence itself:

- `status: PASS`
- validator command
- `validated_at` to the second with timezone
- validator success evidence

Timeline:

```text
timeline.started_at
  -> local work / required checks
  -> timeline.completed_at
  -> validator --stamp
  -> result_validation.validated_at
```

A new Result Contract v2 without stamped validator evidence is incomplete. Historical v1 results remain valid without the v2 fields.

Do not include private chain-of-thought, credentials, secrets, sensitive environment values, or private local paths.
