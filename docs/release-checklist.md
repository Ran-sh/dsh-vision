# Release Checklist

Run everything before tagging a release. All commands from the repo root.

## 1. Quality gates

```sh
npm run typecheck      # 0 errors (host + client + vision)
npm test               # all unit + integration + boundary tests pass, fully offline
npm run build          # both packages bundle cleanly
```

## 2. Real E2E (requires credentials in ~/.dsh/.credentials.yaml)

```sh
RUN_VISION_E2E=1 npx vitest run --config packages/image-mind/vitest.config.ts tests/e2e-real.test.ts
```

Must prove: active-provider auto-call, explicit provider override, model override reaching the wire, real image recognition, Chinese prompt, OCR prompt, no key printed, cancellation.

## 3. Install / uninstall round trip (temp DSH_HOME)

```sh
DSH_HOME=$(mktemp -d) npm run install:dsh    # links + patch rows, idempotent
DSH_HOME=$TMP npm run uninstall:dsh          # removes exactly ours
```

Covered automatically by `tests/install.test.ts` (5 tests). On Windows, also smoke-test a path with spaces and a Chinese path.

## 4. Secret scan

- `git diff --check` clean.
- No `sk-` real key patterns, no `.credentials.yaml`, no `.env` in the repo.
- `packages/vision/src` contains zero provider vocabulary (seam audit test enforces).
- README/docs contain no personal machine paths.

## 5. Windows smoke

- `npm install` from scratch (no DSH profile required) works.
- `npm run install:dsh` against a real or temp DSH_HOME creates junctions without admin rights.
- Settings card opens in the web profile; key entry shows masks; test connection runs.

## 6. Docs

- README install/use sections match the release.
- CHANGELOG.md updated (Unreleased → version).
- docs/architecture.md and docs/provider-development.md current.
