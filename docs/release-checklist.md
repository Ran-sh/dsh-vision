# Release Checklist

Release checklist for `dsh-plugin-image-mind@0.1.1`. The service package
`@ran-sh/dsh-vision@0.1.0` is already published and remains unchanged. Run all
commands from the repository root unless a different directory is stated.

## 1. Quality gates

```sh
npm run typecheck      # 0 errors (host + client + vision)
npm test               # all unit + integration + boundary tests pass, fully offline
npm run build          # both packages bundle cleanly
npm run test:built     # built lib contains the visual fixtures + connection-test RPC
npm run test:package   # package/bundle metadata, dependency closure, npm pack content
git diff --check
```

## 2. Real E2E (requires credentials in ~/.dsh/.credentials.yaml)

```sh
RUN_VISION_E2E=1 npx vitest run --config packages/image-mind/vitest.config.ts tests/e2e-real.test.ts
```

Must prove: active-provider auto-call, explicit provider override, model override reaching the wire, real image recognition, Chinese prompt, OCR prompt, no key printed, cancellation.

If no credential document exists, record `SKIPPED — NO CREDENTIAL` in the release notes; never fake a PASS.

## 3. Registry and package precheck

The plugin installs through the DeepSeek Harness official mechanism
(`dsh plugin --profile <name> add <package>`), which resolves dependencies
from the npm registry. Do not republish an existing version.

1. `npm view @ran-sh/dsh-vision@0.1.0 name version dist-tags`
2. `npm view dsh-plugin-image-mind@0.1.0 name version dependencies`
   → must show `@ran-sh/dsh-vision: ^0.1.0` (no `file:`/`link:`/`workspace:`)
3. `npm view dsh-plugin-image-mind@0.1.1 name version dependencies`
   → must be absent before the first publish; if present, stop and inspect it
4. `cd packages/image-mind && npm pack --dry-run`
   → only package metadata, `lib/**`, `cordis.patch.yml`, and README
5. `npm pack`, then install the tarball in a fresh directory outside the repo
   → `npm ls dsh-plugin-image-mind @ran-sh/dsh-vision` shows 0.1.1 + 0.1.0,
   with no UNMET, `file:`, `link:`, or `workspace:` dependency

## 4. Maintainer-managed publish

The maintainer publishes from `packages/image-mind`; never paste an OTP or npm
token into an agent chat.

```powershell
cd "<repo>\packages\image-mind"
npm pkg get name version
npm pack --dry-run
npm publish --access public
```

After publication, verify `dsh-plugin-image-mind@0.1.1` from the real registry
and install it in a brand-new temporary directory.

Host-owned DSH runtime packages stay as **peerDependencies** (never shipped
as private nested copies); `schemastery` and `@ran-sh/dsh-vision` are
plugin-owned `dependencies`. See `docs/compatibility.md` for the
KNOWN_GOOD / LATEST matrix. The plugin itself never writes the user profile:
Harness reconciles `dsh.profile.bundles` from the installed packages'
`dsh.bundle` declarations.

## 5. Clean Harness acceptance

Use a disposable profile first. Verify the exact CLI syntax, then run this
roundtrip with registry `dsh-plugin-image-mind@0.1.1` only:

1. baseline DSH boot
2. one-command add (vision installs automatically)
3. boot; verify `/image-mind/*` JSON routes, RPC envelopes, `ctx.vision`,
   `understand_image`, and the Settings card
4. one-command remove; boot
5. add → boot → route/envelope smoke → remove → boot again

No manual profile edit counts as a pass. A provider credential is optional;
record `SKIPPED — MISSING CREDENTIAL` or `BLOCKED — PROVIDER QUOTA` honestly.

## 6. Secret scan

- `git diff --check` clean.
- No `sk-` real key patterns, no `.credentials.yaml`, no `.env` in the repo.
- `packages/vision/src` contains zero provider vocabulary (seam audit test enforces).
- README/docs contain no personal machine paths.
- `npm pack --dry-run` on image-mind: no tests/, no src/, no credentials.

## 7. Windows smoke

- `npm install` from scratch (no DSH profile required) works.
- `npm run typecheck && npm run build && npm run test:package` pass on Windows
  (npm pack path behavior).
- Settings card opens in the web profile; key entry shows masks; test connection runs.

## 8. Docs

- README install/use sections match the release (Harness-managed install only).
- CHANGELOG.md contains the 0.1.1 route/envelope patch entry.
- README install/remove commands match the registry roundtrip that passed.
- `docs/compatibility.md` records plugin 0.1.1 + vision 0.1.0 + exact DSH.
- `docs/codex-handoff.md` is created only after public acceptance passes.
- docs/architecture.md and docs/provider-development.md current.
