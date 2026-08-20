# Changelog

All notable changes to dsh-vision are documented here. The project follows
[Semantic Versioning](https://semver.org/) (0.x: breaking changes bump the
minor version). Package names: `@ran-sh/dsh-vision` (Service) and
`dsh-plugin-image-mind` (Provider + Tool + UI).

## [Unreleased]

### Added

- Task-aware visual intent routing for OCR, UI review, code/terminal,
  documents, charts, screenshots, translation, photos, and multi-image
  compare/diff. One provider-neutral token/pixel policy is now the single
  source of truth for quality budgets.
- Reusable visual-evidence cache for stable evidence tasks, with bounded
  in-memory TTL/LRU storage, `use` / `refresh` / `no-store` semantics, and
  automatic invalidation after provider/settings changes. Ordinary
  photo/general questions and explicit provider/model calls stay
  question-specific and bypass this layer.
- Provider-neutral execution telemetry: provider calls, serialized payload
  bytes, cache hits, retries, model fallback, provider fallback, adaptive
  splits, and provider-reported input/output token usage.
- Metadata-only `VisionRuntime.subscribeLifecycle()` observers with correlated
  started/completed/failed events. Lifecycle payloads intentionally exclude
  prompts, image bytes/references/paths, provider response text, endpoint
  URLs, credentials, and error messages; observer failures are contained.
- Provider health scoring, circuit-breaker primitives, and a deterministic
  selector used by image-mind's reliability layer to rank bounded backup
  providers after endpoint-level failures.
- Offline visual benchmark scoring now measures routing/task quality,
  forbidden-answer hits, p50/p95 latency, trace/token telemetry coverage,
  provider work, token cost, and zero-provider reusable-evidence hits.
  `npm run benchmark:compare` adds a baseline-vs-candidate regression gate
  that refuses to trade quality for lower cost and only compares cost when
  telemetry coverage is trustworthy.
- Official OpenAI endpoint-only task-aware image `detail`: high-precision
  GPT-5.6 OCR/UI/code-style work uses `original`, older OpenAI vision models
  use `high`, photo work uses `low`, and general work uses `auto`. Generic
  OpenAI-compatible endpoints never receive this OpenAI-specific field.

### Changed

- Screenshot/document preprocessing is media-, aspect-, and pixel-budget
  aware: PNG remains lossless with a larger resolution budget and alpha
  preserved, while photographic JPEG/WebP use the bounded lossy path. Tall
  screenshots are no longer reduced solely by a 3072-long-edge rule.
- `understand_image` accepts up to 8 images while retaining the combined byte
  ceiling and bounded load concurrency. Task classification now flows from the
  core vision package into the planner, tool budget, selector, and cache
  policy instead of maintaining duplicate vocabularies.
- Multi-image HTTP 413 recovery recursively splits oversized batches while
  preserving original `Image N` identities through every child request and
  cache key; successful child usage is aggregated.
- Default provider recovery is now bounded and health-aware. Explicit
  provider/model intent remains sticky, and provider health is degraded only
  by endpoint/service failures rather than auth/config/model incompatibility.
- Semantic caching supports explicit refresh/no-store behavior, while the
  reusable-evidence layer may satisfy same-image/same-task follow-up questions
  with zero provider calls when broad evidence is already available.

### Fixed

- Preserve PNG screenshot/OCR fidelity instead of converting every large
  image to a 2048px JPEG with a white background.
- Fail closed when image-send rewriting cannot finish; never fall back to
  sending raw image blocks to the text-only main model, and retain drafts so
  the user can retry.
- Keep complete attachment metadata in a hidden conversation note so newly
  sent images can be re-read after host restart when the attachment backend
  still retains the bytes.
- Correct HTTP retry classification: deterministic 400/404 responses are no
  longer repeatedly retried; caller abort is not counted as retry/fallback,
  and Node timeout naming is normalized.
- Add bounded model fallback for explicit model-compatibility failures and
  bounded cross-provider recovery for retry-exhausted timeout/network/429/5xx
  and terminal 413 failures, while refusing unsafe rerouting for auth,
  deterministic 4xx, invalid responses, or explicit routing.
- Accept common OpenAI-compatible structured response content in both Chat
  Completions and Responses APIs instead of rejecting text-part arrays as
  malformed responses.
- Prevent 413 split children from renumbering their original images or sharing
  incompatible cache entries with unrelated smaller requests.
- Distinguish missing benchmark telemetry from genuine zero-cost telemetry;
  JSON `null` fields no longer count as reported zero token/trace usage.

## [0.1.1] — 2026-08-20

### Fixed

- Register the `/image-mind/*` Host route after a late `webServer` service
  attachment, so supported plugin requests no longer fall through to the DSH
  HTML shell or return the old 405.
- Return the browser contract's `ok/value` and `ok/error` envelopes from the
  connection-test and model-discovery Host routes, preserving the actual
  payload instead of producing an empty/undefined client result.
- Add deterministic regression coverage for late route registration, JSON
  content type, intentional unsupported-method handling, local-origin gates,
  successful RPC payloads, and error envelopes.

`@ran-sh/dsh-vision` remains at 0.1.0; this patch does not change the
VisionRuntime API or `packages/vision/src`.

## [0.1.0] — 2026-08-20

### Added

- **Bundle-native distribution**: install is now the DeepSeek Harness
  official mechanism (`dsh plugin --profile <name> add <package>`); the
  package's `dsh.bundle` declaration joins the profile bundle stack and the
  harness owns the profile composition. `cordis.patch.yml` ships with the
  package and mounts both the `vision-runtime` service row and the
  `image-mind` provider row from one install unit.
- `npm run test:package` and `npm run test:built`: package/bundle metadata,
  dependency closure, real `npm pack --dry-run` content checks for both
  packages, and built-artifact verification (embedded visual fixtures, RPC
  exports) against `packages/image-mind/lib`.
- Visual-challenge fixtures embedded as base64 in a provider-side module
  (`runtime/visual-fixtures.ts`) — the probe no longer reads `tests/`.
- `@ran-sh/dsh-vision` now emits `lib/types/*.d.ts` declarations on build
  (the published package carries types).
- Keyless catalog facts (Ollama / LM Studio) flow through to the draft;
  catalog default models refreshed against provider docs (Moonshot
  `kimi-k2.6`, Gemini `gemini-2.5-flash`, LM Studio discovery-filled).
- `understand_image` multi-image: `images[]` (≤ 4) alongside the legacy
  single `image`; both serialize into one wire request; cache key hashes
  every image.
- Real-HTTP mock-server test layer; settings-seam integration tests
  (add/active/model/remove flow); credential integration tests
  (set → resolve → missing, secrets never in settings/browser replies).
- Docs: architecture.md, provider-development.md, release-checklist.md.
- Provider list ordering (active first) and an advanced-settings disclosure
  in the settings card.

### Fixed

- **Profile mutation removed**: `install:dsh` / `uninstall:dsh` (which
  wrote the profile's `cordis.patch.yml`) and `test:install` are deleted —
  the plugin no longer modifies any user profile, per the RC hardening
  spec. `diagnose:dsh` stays, strictly read-only.
- **Client bundle no longer ships server-only packages**: the browser
  settings store imported `deriveKeyRef` from `credentials/migrate.ts`,
  which imports `@deepseek-ai/dsh-credentials`; esbuild bundled that
  server dependency into `lib/client.js` and the web shell refused the
  plugin, breaking DSH web startup. The identity helpers now live in
  `client/settings/identity.ts` with zero imports (both halves use it).
- **Keyless is a strict boolean end to end**: a typed
  `setProviderKeyless(id, value: boolean)` replaces the string-typed
  `editProvider('keyless', …)` path (a `'false'` string was truthy and
  saved as `keyless: true`).
- **displayName / keyless persistence for existing providers**: `planOps`
  now emits `displayName` and `keyless` set/unset ops for providers that
  already exist — previously those edits made the card dirty but saved
  nothing (dirty-but-no-op invariant restored; covered by 5 new store
  tests).
- **Provider settings workflow**: React hooks moved out of a conditional
  into a real `ProviderEditor` component; catalog providers keep their
  stable `entry.id` (display names never generate route ids); custom ids
  are validated up front; keyless local providers work without a key;
  status lamps only turn green after a real visual test on the current
  connection fingerprint; typed keys debounce before discovery and stale
  discovery responses are suppressed.
- **Visual test connection**: the probe now sends a random 32x32
  solid-color fixture and requires the model to name the color — a
  text-only model fails with `visualFailed` instead of passing on HTTP
  200. The probe overlays the saved record of the named provider only.
- **Secret-bearing RPC fence**: /test, /models, and the legacy config
  POST require a loopback socket + loopback Host + same-origin markers;
  cross-origin or remote requests are refused 403. RPC errors are
  redacted (keys, Authorization, api_key).
- **Multi-image hardening**: `image` + `images` together fail loudly;
  empty strings rejected; combined byte bound enforced before any
  provider request; bounded-concurrency loading preserves order; the
  result carries safe identities (basename / host) — never full paths or
  URL queries.
- **URL/SSRF hardening**: node:net-based IP classification (IPv4/IPv6/
  IPv4-mapped private ranges), DNS pre-resolution rejecting private
  A/AAAA, embedded URL credentials refused, error excerpts strip query
  strings.
- **Adapter hardening**: cache keys are fixed-length SHA-256 digests
  (no image bytes in the map); caller abort is distinguished from
  timeout; provider error excerpts are redacted.

### Changed

- Exports and `files` no longer publish `./src/*` or the `src/` tree —
  the runtime never imports source from an installed package.
- SDK dependencies moved from profile junctions to pinned registry
  dependencies (cordis 4.0.1, dsh-* 0.1.0-rc.7 family): `npm install` is
  safe and self-contained, never touching the DSH profile SDK tree.
- Tool result shape: per-image `images[]` entries (image/mimeType/bytes)
  replace the single `image` field.
- `deriveKeyRef` now has one host-side owner re-exported by the browser
  store.
- README install section rewritten around the Harness-managed install;
  the old profile-mutating installer path is documented as removed.

### Added

- Two-package workspace: `@ran-sh/dsh-vision` (Service Definition owning
  `ctx.vision`) + `dsh-plugin-image-mind` (Provider Plugin injecting
  `['vision']`), mirroring `dsh-llm` / `llm-deepseek`.
- `VisionRuntime`: adapter registry (atomic `registerAdapter` +
  `replace([])`), provider directory, single-owner default-provider
  lifecycle, `vision/adapters-updated` events, deep-freeze snapshots.
- Provider-neutral seam: `packages/vision` knows no vendor, protocol,
  credential, or endpoint vocabulary (seam-audit test enforces zero hits).
- `OpenAICompatibleVisionAdapter` owning its own endpoint/credential/wire
  resolution; chat-completions and responses protocols; retry with backoff;
  `/models` discovery with known-plan fallback.
- Settings card in 设置 → 插件 → 图像理解: provider list with truthful
  status lamps, add from directory / custom, one-at-a-time editor, real
  connection test (tiny embedded image), model autofill, credential store
  integration (keys never in settings.yaml).
- Attachment flow: upload → sha256 dedup → `[image attachment …]` note +
  markdown reference; raw route; preview; SSRF guard with
  `allowPrivateNetwork` opt-in.
- `understand_image` tool; last-good configuration; legacy inline-key
  migration; semantic cache.

### Fixed

- Garbled error strings and stale architecture comments cleaned up.
