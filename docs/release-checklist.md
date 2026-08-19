# Release Checklist

Run everything before tagging a release. All commands from the repo root.

## 1. Quality gates

```sh
npm run typecheck      # 0 errors (host + client + vision)
npm test               # all unit + integration + boundary tests pass, fully offline
npm run build          # both packages bundle cleanly
npm run test:built     # built lib contains the visual fixtures + connection-test RPC
npm run test:package   # package/bundle metadata, dependency closure, npm pack content
git diff --check       # whitespace clean
```

## 2. Real E2E (requires credentials in ~/.dsh/.credentials.yaml)

```sh
RUN_VISION_E2E=1 npx vitest run --config packages/image-mind/vitest.config.ts tests/e2e-real.test.ts
```

Must prove: active-provider auto-call, explicit provider override, model override reaching the wire, real image recognition, Chinese prompt, OCR prompt, no key printed, cancellation.

If quota is exhausted or a key is missing, record `BLOCKED — PROVIDER QUOTA` or `SKIPPED — MISSING CREDENTIAL` in the release notes; never fake a PASS.

## 3. GitHub-only distribution (no npm account, no npm publish)

This project is distributed **exclusively through GitHub Releases**. There is no
npm account, no npm token, and no publication step to the npm registry —
`@ran-sh/dsh-vision` and `dsh-plugin-image-mind` are never published to npm.

Release flow:

1. Tag the release: `git tag v0.1.0 && git push origin v0.1.0`
2. `.github/workflows/release.yml` runs on the `v*` tag: typecheck → offline
   tests → build → test:built → test:package → `scripts/build-release.mjs`
   (which rewires the image-mind artifact's `@ran-sh/dsh-vision` dependency to
   the matching GitHub Release asset URL) → uploads both `.tgz` assets to the
   GitHub Release.
3. The release notes should list: version, tested DSH versions, artifact
   filenames, SHA-256 checksums, the one install command, the remove command,
   known limitations.

Per-release smoke (after assets are live) — use an isolated temporary DSH home:

```sh
DSH_HOME=$(mktemp -d) npx @deepseek-ai/dsh plugin --profile <test> add https://github.com/Ran-sh/dsh-vision/releases/download/v0.1.0/dsh-plugin-image-mind-0.1.0.tgz
# boot, verify plugin loads
DSH_HOME=$DSH_HOME npx @deepseek-ai/dsh plugin --profile <test> remove dsh-plugin-image-mind
# boot again — DSH must still start
```

## 4. Secret scan

- `git diff --check` clean.
- No `sk-` real key patterns, no `.credentials.yaml`, no `.env` in the repo.
- `packages/vision/src` contains zero provider vocabulary (seam audit test enforces).
- README/docs contain no personal machine paths.
- `dist-release/*.tgz` (if present) contains no tests/, no src/, no credentials,
  no `file:`/`workspace:`/absolute local references.

## 5. Windows smoke

- `npm install` from scratch (no DSH profile required) works.
- `npm run typecheck && npm run build && npm run test:package` pass on Windows.
- The GitHub Release asset installs through `dsh plugin ... add <URL>` and the
  settings card opens; test connection runs.

## 6. Docs

- README install/use sections match the release (one GitHub add command, one
  remove command; no npm account; no old installer).
- CHANGELOG.md updated.
- docs/architecture.md and docs/provider-development.md current.
