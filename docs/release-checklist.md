# Release Checklist

Run everything before tagging a release. All commands from the repo root.

## 1. Quality gates

```sh
npm run typecheck      # 0 errors (host + client + vision)
npm test               # all unit + integration + boundary tests pass, fully offline
npm run build          # both packages bundle cleanly
npm run test:built     # built lib contains the visual fixtures + connection-test RPC
npm run test:package   # package/bundle metadata, dependency closure, npm pack content
```

## 2. Real E2E (requires credentials in ~/.dsh/.credentials.yaml)

```sh
RUN_VISION_E2E=1 npx vitest run --config packages/image-mind/vitest.config.ts tests/e2e-real.test.ts
```

Must prove: active-provider auto-call, explicit provider override, model override reaching the wire, real image recognition, Chinese prompt, OCR prompt, no key printed, cancellation.

If no credential document exists, record `SKIPPED — NO CREDENTIAL` in the release notes; never fake a PASS.

## 3. Publish order (bundle-native distribution)

The plugin installs through the DeepSeek Harness official mechanism
(`dsh plugin --profile <name> add <package>`), which resolves dependencies
from the npm registry. Publish in this order:

1. `npm publish --access public` in `packages/vision` (the
   `@ran-sh/dsh-vision` service);
2. flip `dsh-plugin-image-mind`'s `@ran-sh/dsh-vision` dependency from
   `file:../vision` to the registry version (`^0.1.0`);
3. `npm publish --access public` in `packages/image-mind`.

Host-owned DSH runtime packages stay as **peerDependencies** (never shipped
as private nested copies); `schemastery` and `@ran-sh/dsh-vision` are
plugin-owned `dependencies`. See `docs/compatibility.md` for the
KNOWN_GOOD / LATEST matrix. The plugin itself never writes the user profile:
Harness reconciles `dsh.profile.bundles` from the installed packages'
`dsh.bundle` declarations.

## 4. Secret scan

- `git diff --check` clean.
- No `sk-` real key patterns, no `.credentials.yaml`, no `.env` in the repo.
- `packages/vision/src` contains zero provider vocabulary (seam audit test enforces).
- README/docs contain no personal machine paths.
- `npm pack --dry-run` on both packages: no tests/, no src/, no credentials.

## 5. Windows smoke

- `npm install` from scratch (no DSH profile required) works.
- `npm run typecheck && npm run build && npm run test:package` pass on Windows
  (npm pack path behavior).
- Settings card opens in the web profile; key entry shows masks; test connection runs.

## 6. Docs

- README install/use sections match the release (Harness-managed install only).
- CHANGELOG.md updated (Unreleased → version).
- docs/architecture.md and docs/provider-development.md current.
