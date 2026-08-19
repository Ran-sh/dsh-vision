# Changelog

All notable changes to dsh-vision are documented here. The project follows
[Semantic Versioning](https://semver.org/) (0.x: breaking changes bump the
minor version). Package names: `@ran-sh/dsh-vision` (Service) and
`dsh-plugin-image-mind` (Provider + Tool + UI).

## [Unreleased]

### Added

- **GitHub-only distribution**: the project is released exclusively through
  GitHub Releases — no npm account, no npm publish. `.github/workflows/release.yml`
  builds and uploads the prebuilt assets on `v*` tags, and
  `scripts/build-release.mjs` rewires the image-mind tarball's
  `@ran-sh/dsh-vision` dependency to the matching GitHub Release asset URL, so
  a user installs with ONE official DSH command and the vision service is
  pulled in automatically.
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

## [0.1.0] — 2026-08-18

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
