# Agent Results

Machine-readable Result Contracts live under this directory. Durable results should identify source commit, work performed, exact validations, PASS/FAIL/PARTIAL/SKIP/BLOCKED/NOT RUN states, observable evidence, limitations, changed files, blockers, result path, and result commit when available.

Validate JSON results with:

```sh
node .agent-workflow/validator/validate-contract.mjs result <result-json>
```

Do not include private chain-of-thought or secrets.
