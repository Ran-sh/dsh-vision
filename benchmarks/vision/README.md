# Vision quality benchmark

This directory defines the durable corpus/result contract for comparing dsh-vision revisions. The benchmark runner that calls real providers belongs in a controlled DSH environment; repository scoring and regression comparison are deliberately offline and deterministic.

## Files

- `cases.example.jsonl` — schema examples only; **not** the final quality corpus.
- `results.example.jsonl` — example execution records matching those cases.
- `../../scripts/vision-benchmark-score.mjs` — deterministic scorer.
- `../../scripts/vision-benchmark-compare.mjs` — baseline-vs-candidate regression gate.
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

The real runner should write one result per case. Prefer the names below so the scorer can consume `understand_image.route`, `VisionResult.trace`, and `usage` directly:

```json
{
  "id": "ocr-terminal-001",
  "answer": "...",
  "toolCalled": true,
  "latencyMs": 814,
  "provider": "opencode-go",
  "model": "mimo-v2.5",
  "route": {
    "source": "provider",
    "requestedProvider": "primary",
    "requestedModel": "vision-a",
    "selectedProvider": "opencode-go",
    "selectedModel": "mimo-v2.5",
    "modelFallback": true,
    "providerFallback": true
  },
  "providerCalls": 1,
  "payloadBytes": 185420,
  "cacheHits": 0,
  "inputTokens": 2180,
  "outputTokens": 164,
  "retries": 0,
  "modelFallbacks": 1,
  "providerFallbacks": 1,
  "splits": 0,
  "error": null
}
```

`route.source` is one of `provider`, `semantic-cache`, or `evidence-cache`. `requestedProvider` / `requestedModel` are optional and are present only when the caller explicitly requested them; `selectedProvider` / `selectedModel` record the route actually used. The scorer reports route coverage, route-source counts, and whether route fallback booleans agree with trace fallback counters.

`calls` remains accepted as a backward-compatible alias for `providerCalls`. A reusable-evidence hit should normally report `providerCalls: 0`, `cacheHits >= 1`, and `route.source: "evidence-cache"`; the scorer exposes zero-provider reuse separately from semantic-cache and evidence-cache route counts.

If execution fails, preserve the same metadata that is safely available and put a redacted error string in `error`. Never write API keys, Authorization headers, signed URL query strings, prompt text copied from secrets, or full local secret-bearing paths into benchmark results.

## Scoring

```sh
npm run benchmark:score -- benchmarks/vision/cases.jsonl out/results.jsonl
```

The JSON report contains:

- weighted routing success rate;
- weighted assertion pass rate;
- weighted end-to-end task success rate (`toolCalled && assertions && no error`);
- forbidden-term hit count;
- successful-task latency p50 / p95;
- total provider calls and payload bytes;
- semantic/layered cache hits and zero-provider-reuse rate;
- route telemetry coverage plus provider / semantic-cache / evidence-cache source counts;
- per-route-source quality/cost buckets (`cases`, weighted task success, provider calls, cache hits) so cache savings can be judged against answer quality instead of aggregate success alone;
- route-vs-trace fallback consistency when both telemetry layers are present;
- provider-reported input/output token totals plus token-usage coverage;
- retry / model-fallback / provider-fallback / split counts;
- per-category pass rates and missing-result counts;
- per-case rows with requested/selected route identities for diffing regressions.

## Regression gate

Compare the same frozen corpus against a baseline and a candidate:

```sh
npm run benchmark:compare -- \
  benchmarks/vision/cases.jsonl \
  out/baseline-results.jsonl \
  out/candidate-results.jsonl
```

The command exits non-zero when the default gate fails. The default policy intentionally prioritizes quality over savings:

- routing success may regress by at most 1 percentage point;
- task success may regress by at most 2 percentage points;
- forbidden/hallucination proxy hits may not increase;
- route telemetry coverage may not drop by more than 10 percentage points;
- token reporting coverage may not drop by more than 10 percentage points;
- p95 latency gets at most 30% relative headroom or 250 ms absolute headroom;
- provider calls may grow at most 15%;
- payload bytes and provider-reported input/output tokens may grow at most 20% when those metrics are available.

The comparison summary also preserves baseline/candidate route-source outcome buckets. This makes an evidence-cache rollout inspectable even when its aggregate task-success rate looks healthy: provider-path and cache-path quality can be compared separately before adding stricter source-specific gates. The gate also reports zero-provider-reuse rate, provider calls, and input tokens so layered evidence reuse can be judged on measurable savings rather than anecdotes. Do not loosen quality thresholds merely to make a cost optimization pass.

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
- compare JSON report and exit status;
- date and environment (Node/OS);
- whether each answer came from provider, semantic cache, or evidence cache;
- per-source success/call/cache-hit outcome buckets;
- requested/selected provider/model when applicable;
- whether calls used cache, retry, model fallback, provider fallback, or adaptive split.

The benchmark is a decision aid, not a substitute for the browser/install/provider matrix in `docs/verification-debt.md`.
