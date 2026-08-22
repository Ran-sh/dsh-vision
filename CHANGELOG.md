# Changelog

All notable changes to `@ran-sh/dsh-vision` (Service) and
`dsh-plugin-image-mind` (Provider + Tool + UI) are recorded here. The project
is independent of DeepSeek and follows SemVer for its 0.x line.

## [Unreleased]

- Batch 016 closes documentation and final pre-publish evidence reconciliation.
- Route diagnostics expose provider, semantic-cache, reusable-evidence,
  explicit-route and bounded fallback sources without endpoint or credential
  data.
- Narrow cached follow-ups automatically request focused `cache: "no-store"`
  evidence instead of guessing; benchmark JSONL/scoring preserves and checks
  route/trace coverage.

## [0.2.0] — candidate, not published

`0.2.0` is the repository candidate for both packages. It is not a registry
release and must not be described as a published KNOWN_GOOD package.

### Added

- Task-aware OCR/UI/code/document/chart/photo/compare routing with one bounded
  token and pixel policy.
- Provider-neutral trace and metadata-only lifecycle events for calls, bytes,
  cache hits, retries, model/provider fallback, 413 splits and reported token
  usage. Lifecycle observers cannot leak prompts, paths, bytes, endpoints or
  credentials.
- Bounded semantic and reusable-evidence caches with explicit `use`, `refresh`
  and `no-store`; settings/provider changes invalidate reusable evidence.
- Host-side durable attachment references and session recovery without putting
  IDs, hashes, raw URLs or routing instructions in conversation messages.
- Health/circuit primitives, FIFO backpressure, bounded model/provider
  recovery and recursive 413 handling that preserves original `Image N` labels.
- Offline benchmark corpus/scoring/compare gates for route truth, forbidden
  answers, quality, latency and telemetry coverage.

### Changed

- `images[]` now accepts at most 8 ordered images with bounded loading and a
  combined byte ceiling (the historical 0.1.x limit of 4 is superseded).
- PNG screenshots/documents use aspect-/pixel-aware lossless preprocessing;
  JPEG/WebP photos use the bounded lossy path. The old 3072-long-edge-only
  policy is no longer authoritative.
- Automatic refocus is model-only guidance: a narrow question that lacks
  sufficient cached detail triggers a fresh pixel read; it never exposes tool
  routing in the user bubble.
- Official OpenAI `detail` is sent only to the official OpenAI endpoint; other
  OpenAI-compatible endpoints do not receive that field.
- All package manifests remain on 0.2.0 and the plugin depends on
  `@ran-sh/dsh-vision@^0.2.0`.

### Fixed

- Built ESM host code uses static `node:crypto` imports, preventing the prior
  dynamic-require failure in the shipped Node 24 bundle.
- Deterministic 4xx, explicit routing, caller abort and malformed responses no
  longer trigger unsafe retry/fallback; retry/backoff and health accounting are
  bounded.
- Attachment admission fails closed and retains drafts; history previews and
  restart recovery use host-side references only.
- Structured Chat Completions/Responses text parts are parsed without mixing
  reasoning/tool content into visual evidence.
- Benchmark modules are import-safe on Windows Node 24 and package/built tests
  run after build.

### Verification boundary

- Batches 013–015 provide deterministic, built, Windows, privacy, benchmark
  and host smoke evidence; their Result Contracts remain the durable source.
- Batch 016 adds exact `@deepseek-ai/dsh@0.1.1-rc.1` source-built/local-packed
  isolated evidence where executable. Registry install remains `EXPECTED_NOT_PUBLISHED`.
- No real provider, npm publication, tag/release or real Harness credentials
  are implied by this entry; those are explicit post-authorization debt.

## [0.1.1] — 2026-08-20

- Fixed late web-server route registration and JSON `ok/value` / `ok/error`
  envelopes for connection and model discovery RPCs.
- Added deterministic route, local-origin, RPC and error-envelope regression
  coverage. The service package remained at 0.1.0.

## [0.1.0] — 2026-08-20

- Introduced the two-package Service Definition / Provider Plugin split,
  bundle-native DSH installation, provider settings and credentials seam,
  `understand_image`, attachment handling, SSRF policy, semantic cache and
  Chat Completions/Responses adapters.
- Added package/built-artifact tests, deterministic mock-server coverage and
  generated public types. The historical multi-image limit was 4; 0.2.0
  supersedes it with an 8-image bound.
- Removed profile mutation and browser exposure of server-only dependencies,
  and hardened key storage, URL validation, error redaction and adapter abort
  handling.
