# Changelog

All notable changes to `@ran-sh/dsh-vision` (Service) and
`dsh-plugin-image-mind` (Provider + Tool + UI) are recorded here. The project
is independent of DeepSeek and follows SemVer for its 0.x line.

## [Unreleased]

## [0.3.2] — dependency alignment

`dsh-plugin-image-mind` moves to `0.3.2` and depends on
`@ran-sh/dsh-vision@^0.3.1`: a fresh registry install now composes
`0.3.2` + `0.3.1` instead of reusing the cached `0.3.0` service
(`^0.3.0` let pnpm keep the older tarball). Verified with a pure
registry-only install on exact `0.1.2-rc.1` (official add, boot,
`/image-mind` routes 200).

## [0.3.1] — rc.1 browser lifecycle fixes

Both publishable packages move to `0.3.1` (image-mind depends on
`@ran-sh/dsh-vision@^0.3.0`). 0.3.0 shipped the rc.1 split-client
architecture; the real rc.1 browser journey then found two client bugs,
fixed here and verified in a real Chrome session against the exact
`0.1.2-rc.1` web:

- Settings card never appeared in 设置 → 插件 → 插件配置: the settings store
  treated the bound `SettingsScope` as a one-shot getter, so a `loading`
  first snapshot left the card unexposed forever. The store now binds once
  and subscribes to the scope mirror, following it into `ready` and through
  later document updates (the official rc.1 controller pattern).
- Card showed "本部署的设置为只读" with actions disabled: the credential
  transport spoke the pre-rc.1 wrapper shape (`{refs}` / `{ref,value}` /
  `result.ok`) while rc.1 `remote.credentials` is positional
  (`describe([ref])` / `set(ref, value)` / `response.ok`), so every
  credential describe failed inside `load()` and demoted the whole settings
  view to `unavailable/writable:false`. The transport now uses the rc.1
  positional contract; credential refresh is isolated from the settings view;
  `shell.available` tracks `ready` like the official CardForm.

Real-browser verification: the image-mind card renders with its full
provider UI, the add-provider catalog opens, adding Opencode Go and saving
persists to `settings.yaml`, and no readonly banner appears.

## [0.3.0] — single-track latest Harness 0.1.2-rc.1

Both publishable packages move to `0.3.0` (image-mind depends on
`@ran-sh/dsh-vision@^0.3.0`) and target ONLY the latest Harness
(`@deepseek-ai/dsh@0.1.2-rc.1`, the `next` tag) with cordis `4.0.2` and
react 18.2.0. Legacy `0.2.x` / `0.1.1-rc.2` lines are historical only.
`ctx.vision` is untouched (`packages/vision/src/**` unchanged).

- Host settings registration moves to the injected `settings` service
  lifecycle (`installSection`); legacy-key migration runs inside it.
- Browser settings move off `dsh-client-runtime` (no `0.1.2` release exists —
  the split replaces it) onto `settingsScope.bind` + `remote.credentials`,
  with store primitives from `dsh-client-store` and types from
  `dsh-client-ui-settings/client`; client inject roster uses the split
  packages (`api-remotes`, `api-session-controller`, `client-ui-settings`).
- `/image-mind` route ownership binds to the webServer disposer via a Cordis
  effect (WeakSet removed); unload/reload unregisters then re-registers.
- Client build bundles only `dsh-client-store`; other host client services
  stay external. Schema import moves to the `@deepseek-ai/schemastery` fork.
- Lifecycle CLI help header tracks the running package version (no stale
  hard-coded identity); boot smoke accepts the rc.1 token gate (401 = alive).

- Batch 022 prepares the `0.2.1` remediation candidate after the defective
  public `0.2.0` publication: both publishable packages move to `0.2.1`
  (image-mind depends on `@ran-sh/dsh-vision@^0.2.1`), and a content-hash
  prepack guard (`scripts/pack-guard.mjs`, wired via npm's `prepack`) now
  rebuilds or fails closed before `npm pack`/`npm publish` can emit a tarball,
  making metadata-only empty shells structurally impossible. Incident
  regression tests exercise the real packaging lifecycle (auto-build on
  missing outputs, hash-detected stale inputs, fail-closed broken build).
- Batch 019 adds a packaged lifecycle CLI to `dsh-plugin-image-mind` (npm bin
  `lib/cli.js`, so `npx dsh-plugin-image-mind install|update|status|uninstall`
  works after publication). It delegates every mutation to official
  `@deepseek-ai/dsh` plugin lifecycle commands, never hand-edits Harness-owned
  state, is idempotent for repeat installs/same-version updates/absent
  uninstalls, keeps a shared `@ran-sh/dsh-vision` service when other layers
  still reference it, redacts secret-shaped output, and offers a stable
  `status --json`. Packed-artifact acceptance against exact rc.2 — install →
  status → idempotent second install → same-version no-op update → older→current
  convergence, shared-service retention, composition dump and an HTTP boot
  smoke on a task-owned port — runs in dedicated Linux (Node 22/24), Windows
  and macOS CI lanes.
- Batch 017 aligns the 0.2.0 pre-publish evidence with exact
  `@deepseek-ai/dsh@0.1.1-rc.2`: peer ranges moved from the `^0.1.0-rc.7` line
  (which node-semver rejects for the rc.2 prerelease family) to `^0.1.1-rc.2`,
  the repository test host pins the official `@deepseek-ai/dsh@0.1.1-rc.2` CLI
  with its full peer family and react 19.2.x, and package tests lock the
  admission policy. An isolated task-owned rc.2 web acceptance (official
  add/boot/composition, `/image-mind` routes, keyless visual challenge,
  PNG/JPEG/WebP attachment journey, restart recovery, official
  remove/re-add/remove) passes with the local-packed 0.2.0 packages.
- Batch 016 closes documentation and final pre-publish evidence reconciliation.
- Route diagnostics expose provider, semantic-cache, reusable-evidence,
  explicit-route and bounded fallback sources without endpoint or credential
  data.
- Narrow cached follow-ups automatically request focused `cache: "no-store"`
  evidence instead of guessing; benchmark JSONL/scoring preserves and checks
  route/trace coverage.

## [0.2.0] — published DEFECTIVE on npm; do not use

`0.2.0` was published to npm by mistake from a checkout without build output:
both tarballs are metadata-only empty shells (no `lib/**`), so the registry
artifacts are non-functional even though the repository candidate itself was
fully validated. `latest` currently points at these broken tarballs; do not
install them. Batch 022 prepares `0.2.1` as the remediation candidate and adds
a prepack fail-safe so packaging without built artifacts fails closed.

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
