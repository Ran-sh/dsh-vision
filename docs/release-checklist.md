# Release Checklist

Release checklist for `dsh-plugin-image-mind@0.2.0` and
`@ran-sh/dsh-vision@0.2.0`. Run all commands from the repository root unless a
different directory is stated.

## 1. Quality gates

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run test:package
npm run test:built
git diff --check
```

Release-branch CI must be green on Node 22, Node 24, Windows, install/package
roundtrip, built-artifact verification, and secret scan.

For 0.2.0, PR #5 / CI run 221 passed all of those gates before merge.

## 2. Real DSH release gate

The final real-host gate must cover the shipped image workflow, not only static
unit tests. For 0.2.0, the authoritative report is:

`docs/test-results/dsh-vision-codex-new-r1-final-retest.md`

Required outcomes:

- NEW-R1 one-image sent/history preview PASS
- NEW-R1 two-image ordered sent/history preview PASS
- session switch isolation PASS
- restart/reopen persistence PASS
- thumbnail/lightbox PASS
- F002 secrecy PASS
- F003 old-image reuse after restart PASS
- no duplicate user-message admission
- FR-001 PASS
- release-safety lane PASS
- BLOCKER / HIGH / MEDIUM = 0 / 0 / 0

0.2.0 final result: 10 PASS / 0 FAIL / 0 PARTIAL-BLOCKED.

## 3. Registry and package precheck

The plugin installs through the DeepSeek Harness official mechanism
(`dsh plugin --profile <name> add <package>`), which resolves dependencies
from the npm registry. Do not republish an existing version.

1. `npm view @ran-sh/dsh-vision@0.2.0 name version dist-tags`
   → must be absent before first publish; if present, stop and inspect it.
2. `npm view dsh-plugin-image-mind@0.2.0 name version dependencies`
   → must be absent before first publish; if present, stop and inspect it.
3. `cd packages/vision && npm pack --dry-run`
   → only package metadata, `lib/**`, README and declared type output.
4. `cd packages/image-mind && npm pack --dry-run`
   → only package metadata, `lib/**`, `cordis.patch.yml`, and README.
5. The plugin manifest must show `@ran-sh/dsh-vision: ^0.2.0` with no
   `file:`, `link:`, or `workspace:` registry dependency.
6. After both packages are published, install the plugin tarball or registry
   package in a fresh directory and run
   `npm ls dsh-plugin-image-mind @ran-sh/dsh-vision`; it must show 0.2.0 +
   0.2.0 with no UNMET, `file:`, `link:`, or `workspace:` dependency.

## 4. Maintainer-managed publish

Publishing is intentionally maintainer-managed. Never paste an OTP or npm
token into an agent chat.

Publish the service package first:

```powershell
cd "<repo>\packages\vision"
npm pkg get name version
npm pack --dry-run
npm publish --access public
```

Then publish the plugin:

```powershell
cd "<repo>\packages\image-mind"
npm pkg get name version
npm pack --dry-run
npm publish --access public
```

After publication, verify both 0.2.0 packages from the real registry and
install `dsh-plugin-image-mind@0.2.0` in a brand-new temporary directory.

Host-owned DSH runtime packages stay as **peerDependencies** (never shipped as
private nested copies); `schemastery` and `@ran-sh/dsh-vision` are plugin-owned
`dependencies`. See `docs/compatibility.md` for the KNOWN_GOOD / LATEST matrix.
The plugin itself never writes the user profile: Harness reconciles
`dsh.profile.bundles` from installed packages' `dsh.bundle` declarations.

## 5. Clean Harness acceptance

Use a disposable profile first. Verify the exact CLI syntax, then run this
roundtrip with registry `dsh-plugin-image-mind@0.2.0` only:

1. baseline DSH boot
2. one-command add (vision 0.2.0 installs automatically)
3. boot; verify `/image-mind/*` JSON routes, RPC envelopes, `ctx.vision`,
   `understand_image`, Settings UI and conversation preview behavior
4. one-command remove; boot
5. add → boot → route/envelope/preview smoke → remove → boot again

No manual profile edit counts as a pass. A provider credential is optional;
record `SKIPPED — MISSING CREDENTIAL` or `BLOCKED — PROVIDER QUOTA` honestly.

## 6. Secret scan

- `git diff --check` clean.
- No `sk-` real key patterns, no `.credentials.yaml`, no `.env` in the repo.
- `packages/vision/src` contains zero provider vocabulary (seam audit test enforces).
- README/docs contain no personal machine paths.
- `npm pack --dry-run` on image-mind ships no tests/, no src/, no credentials.
- User-visible conversation rows contain no attachment IDs, SHA-256 digests,
  raw URLs, bytes, or `understand_image` routing instructions.

## 7. Windows smoke

- `npm ci` from scratch works.
- `npm run typecheck && npm run build && npm test && npm run test:package`
  pass on Windows.
- Settings card opens in the web profile; key entry shows masks; test
  connection runs.

## 8. Docs and version closure

- Root workspace version is 0.2.0.
- `@ran-sh/dsh-vision` version is 0.2.0.
- `dsh-plugin-image-mind` version is 0.2.0 and depends on
  `@ran-sh/dsh-vision@^0.2.0`.
- README install/use sections reference 0.2.0.
- CHANGELOG.md contains the 0.2.0 release entry.
- `docs/compatibility.md` records plugin 0.2.0 + vision 0.2.0 + exact DSH.
- `.github/workflows/dsh-compat.yml` targets the published 0.2.0 plugin.
- Final real-DSH result remains archived under `docs/test-results/`.

## 9. Git tag and GitHub release

After registry publication and clean-Harness acceptance, create tag `v0.2.0`
from the final 0.2.0 main commit and publish GitHub Release `v0.2.0` using the
0.2.0 changelog summary. Do not tag a commit whose package manifests are not
all 0.2.0.
