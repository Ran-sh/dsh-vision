# Changelog

All notable changes to dsh-vision are documented here. The project follows
[Semantic Versioning](https://semver.org/) (0.x: breaking changes bump the
minor version). Package names: `@ran-sh/dsh-vision` (Service) and
`dsh-plugin-image-mind` (Provider + Tool + UI).

## [Unreleased]

### Added

- `npm run install:dsh` / `npm run uninstall:dsh`: one-command mount/unmount
  into a DSH profile (links + cordis patch rows, idempotent, backups,
  `--purge-settings` opt-in). `tests/install.test.ts` covers the round trip.
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

- **Client bundle no longer ships server-only packages**: the browser
  settings store imported `deriveKeyRef` from `credentials/migrate.ts`,
  which imports `@deepseek-ai/dsh-credentials`; esbuild bundled that
  server dependency into `lib/client.js` and the web shell refused the
  plugin, breaking DSH web startup. The identity helpers now live in
  `client/settings/identity.ts` with zero imports (both halves use it).
- **Installer YAML safety**: a profile template's bare top-level `[]`
  could not coexist with `- insert:` rows in one YAML document; the
  installer now strips it before appending (pure block-style array).
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
- **Installer polish**: `--dry-run`, `diagnose:dsh`, atomic patch writes
  preserving CRLF, empty-scope cleanup, ambiguity refusal, build
  artifact gate, uninstall dry-run.

### Changed

- SDK dependencies moved from profile junctions to pinned registry
  dependencies (cordis 4.0.1, dsh-* 0.1.0-rc.7 family): `npm install` is
  safe and self-contained, never touching the DSH profile SDK tree.
- Tool result shape: per-image `images[]` entries (image/mimeType/bytes)
  replace the single `image` field.
- `deriveKeyRef` now has one host-side owner re-exported by the browser
  store.

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
