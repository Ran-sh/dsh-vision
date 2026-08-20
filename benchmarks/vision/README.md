# Vision quality benchmark

This directory defines the durable corpus/result contract for comparing dsh-vision revisions. The benchmark runner that calls real providers belongs in a controlled DSH environment; the repository scorer is deliberately offline and deterministic.

## Files

- `cases.example.jsonl` — schema examples only; **not** the final quality corpus.
- `results.example.jsonl` — example execution records matching those cases.
- `../../scripts/vision-benchmark-score.mjs` — deterministic scorer.
- `../../docs/verification-debt.md` — items that still require the unified real-environment validation pass.

## Case JSONL

One JSON object per line:

```json
{
  "id": "ocr-terminal-001",
  "category": "ide-terminal",
  "prompt": "Transcribe the visible error exactly.",
  "images": ["fixtures/ocr-terminal-001.png"],
  "weight": 1,
  "assertion": {
    "containsAll": ["ENOENT", "package.json"],
    "containsAny": ["line 42", "42:"],
    "excludes": ["segmentation fault"],
    "expectedText": "optional exact substring for OCR-focused cases"
  }
}
```

`prompt` and `images` are execution metadata for the future real-provider runner. The current offline scorer uses `id`, `category`, `weight`, and `assertion`.

Assertion semantics:

- `containsAll`: every normalized term must appear.
- `containsAny`: at least one normalized term must appear.
- `excludes`: none may appear; hits contribute to the hallucination/error proxy.
- `expectedText`: normalized exact substring that must appear; useful for OCR snippets.

Assertions are intentionally simple and inspectable. Do not hide evaluation policy inside another LLM judge until a stable deterministic baseline exists.

## Result JSONL

The real runner should write one result per case:

```json
{
  "id": "ocr-terminal-001",
  "answer": "...",
  "toolCalled": true,
  "latencyMs": 814,
  "provider": "opencode-go",
  "model": "mimo-v2.5",
  "calls": 1,
  "payloadBytes": 185420,
  "retries": 0,
  "modelFallbacks": 0,
  "providerFallbacks": 0,
  "splits": 0,
  "error": null
}
```

If execution fails, preserve the same metadata and put a redacted error string in `error`. Never write API keys, Authorization headers, signed URL query strings, or full local secret-bearing paths into benchmark results.

## Scoring

```sh
node scripts/vision-benchmark-score.mjs benchmarks/vision/cases.jsonl out/results.jsonl
```

The JSON report contains:

- weighted routing success rate;
- weighted assertion pass rate;
- weighted end-to-end task success rate (`toolCalled && assertions && no error`);
- forbidden-term hit count;
- successful-task latency p50 / p95;
- total provider calls and payload bytes;
- retry / model-fallback / provider-fallback / split counts;
- per-category pass rates and missing-result counts;
- per-case rows for diffing regressions.

## Target corpus

The first stable corpus should contain 100 tasks:

| Category | Count |
|---|---:|
| UI screenshots | 20 |
| IDE / terminal | 20 |
| Documents / OCR | 20 |
| Charts | 15 |
| Photos | 15 |
| Multi-image compare / diff | 10 |

Use exactly the same frozen files, prompts, provider settings, and scorer when comparing 0.1.1 with the current candidate. Do not tune assertions after seeing only the candidate answer; changes to benchmark cases must be reviewed like product code.

## Minimum comparison output

For every baseline/candidate run keep:

- git SHA / package version;
- DSH version;
- provider + model configuration;
- case/result files;
- scorer JSON report;
- date and environment (Node/OS);
- whether calls used cache, retry, model fallback, provider fallback, or adaptive split.

The benchmark is a decision aid, not a substitute for the browser/install/provider matrix in `docs/verification-debt.md`.
