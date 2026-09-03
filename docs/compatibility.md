# Compatibility

Known-good and latest compatibility targets for `dsh-plugin-image-mind`.
DSH is under active development; this project tests against specific versions
and does not promise compatibility with every future DSH release.

| Plugin version | Vision version | DSH (CLI) | DSH runtime (@deepseek-ai/dsh-*) | Status | Date | Notes |
|---|---|---|---|---|---|---|
| 0.3.0-alpha.1 | 0.3.0-alpha.1 | 0.1.2-alpha.5 | exact `0.1.2-alpha.5` family / cordis 4.0.2 / react 18.2.0 | KNOWN_GOOD (isolated alpha lifecycle; ALPHA TRACK ONLY) | 2026-09-03 | Alpha-track adaptation only; does not replace the 0.2.1 / DSH 0.1.1-rc.2 KNOWN_GOOD line. Proven in a disposable DSH_HOME on exact 0.1.2-alpha.5: official `plugin --profile web add <tgz>` with a pnpm-workspace overrides seam for the unpublished service tarball, `--dump-config` composes `vision-runtime` + `image-mind`, web boots (GET / 401 token gate = alive), `/image-mind/catalog` 200 with real catalog JSON, `/image-mind/config` 200 with resolved defaults, `/image-mind/previews` 200, official `remove` prunes both layers from dump-config and reboot answers 404 on `/image-mind/catalog`. Migrates Host settings to `ctx.settings.installSection`, Client settings to `ctx.settingsScope` + `remote.credentials`, removes `dsh-client-runtime`, uses the split alpha client packages, and binds `/image-mind` route ownership to the webServer disposer. Registry install, hosted-provider quality and full alpha browser-journey acceptance remain PARTIAL (not implied). |
|---|---|---|---|---|---|---|
| 0.2.0 | 0.2.0 | 0.1.1-rc.2 | exact `^0.1.1-rc.2` peer family, react 19.2.8 host | KNOWN_GOOD (isolated lifecycle + browser) — REPOSITORY CANDIDATE ONLY; the npm-published 0.2.0 tarballs are DEFECTIVE empty shells (Batch 021) | 2026-08-23 | Batch 017 exact `@deepseek-ai/dsh@0.1.1-rc.2` isolated acceptance: official add (`dsh plugin --profile web add <tgz>` with a pnpm overrides seam in the task-owned profile), boot reaches HTTP 200 on a task-owned port, both bundle layers compose, `/image-mind` catalog/config/previews/raw/preview routes answer (the rc.1 route gap from Batch 008 does not reproduce), keyless visual challenge passes against a deterministic local OpenAI-compatible stub (`visualVerified: true`), model discovery reads the endpoint, PNG/JPEG/WebP attachment journey stores and serves byte-identical raws with preview batches/commit, restart recovery keeps the committed batch, and official remove/re-add/remove fully prunes the layers. The same exact rc.2 run also exercised the rendered plugin/settings UI, PNG/JPEG/WebP drop/paste/lightbox, the exact-eight/ninth-rejected browser gate, neutral markers, real `understand_image`鈫抳ision鈫抦ain routing, failed-send retry/draft retention, session switch/restart and cache/refocus. Real-provider quality and registry install remain outside this isolated gate (see docs/verification-debt.md). Batch 019 adds the packaged lifecycle CLI (`npx dsh-plugin-image-mind install/update/status/uninstall`, npm bin `lib/cli.js`) and proves it against exact rc.2 from packed artifacts in disposable DSH_HOME state: install → status → idempotent second install → same-version no-op update → older→current convergence → composition dump → HTTP boot smoke on a task-owned port → shared-service-retaining uninstall → absent status, all delegating to official `dsh plugin` operations; dedicated Linux/Windows/macOS CI lanes keep the roundtrip green. |
| 0.2.0 | 0.2.0 | 0.1.1-rc.1 | source-built/local-packed host path exercised | PARTIAL (pre-publish evidence; registry target unavailable) | 2026-08-22 | Batches 013鈥?15 used the exact rc.1 CLI, official add/boot/remove, local-packed 0.2.0 service/plugin artifacts, deterministic local stubs, built bundle and browser/settings seams. No registry install or hosted-provider quality is implied. Batch 016's repeat was not allowed to touch a pre-existing listener on port 3080, so this row remains partial rather than claiming a new isolated run. |
| 0.1.1 | 0.1.0 | 0.1.1-rc.1 | published 0.1.x line | KNOWN_GOOD (isolated lifecycle) | 2026-08-21 | exact rc.1 + published `dsh-plugin-image-mind@0.1.1` / `@ran-sh/dsh-vision@0.1.0`: official add PASS, both bundle layers compose, web reaches HTTP 200, `understand_image` registration is present in the loaded published bundle, official remove fully prunes the isolated install. Real provider image call remained PARTIAL because provider provenance could not be established without reading forbidden real Harness settings. |
| 0.2.0 | 0.2.0 | 0.1.0-rc.7 | 0.1.0-rc.7 / cordis 4.0.1 | PRE-PUBLISH SOURCE EVIDENCE (not registry KNOWN_GOOD) | 2026-08-21 | Batch 013鈥?15 deterministic/build/Windows/package/browser evidence and final CI are green; the 0.2.0 packages remain repository artifacts and are not published to npm. |
| 0.2.0 | 0.2.0 | 0.1.0-rc.8 | runtime not reached | HISTORICAL SIGNAL (environment-blocked) | 2026-08-21 | exact rc.7 and rc.8 metadata and tarballs both resolved in a few seconds, but clean dependency-only installs for both versions timed out at 180s on Node 24.18.1 / npm 11.16.0 / Windows; no rc.8-specific resolver regression was established. Later root-cause work attributed the transient `npx` stall to npm Arborist dependency-tree resolution before DSH starts. |
| 0.1.1 | 0.1.0 | 0.1.0-rc.7 | 0.1.0-rc.7 / cordis 4.0.1 | HISTORICAL | 2026-08-20 | clean registry install; baseline/add/boot/route+RPC/UI/remove/boot/reinstall roundtrip; no profile edit; real red-image challenge passed |
| 0.1.0 | 0.1.0 | 0.1.0-rc.7 | 0.1.0-rc.7 / cordis 4.0.1 | HISTORICAL | 2026-08-19 | baseline + add + boot + remove + boot verified; plugin manager pnpm 11.7.0 |
| 0.1.1 | 0.1.0 | 0.1.0-rc.8 | runtime not reached | HISTORICAL SIGNAL (non-blocking, incomplete) | 2026-08-20 | first npm 11.16.0 dependency-solver attempt did not complete within 10 minutes; later exact-pinned diagnostics showed the same clean-install timeout also affects rc.7 in this environment, so this is not evidence of an rc.8-specific product incompatibility |

## Peer dependency policy

Host-owned DSH runtime packages are declared as **peerDependencies** with a
bounded range, mirroring the official `@deepseek-ai/dsh-web-search-exa`
convention. image-mind never ships a private nested copy of these host
packages (the profile tree stays deduped). The plugin-owned
`@ran-sh/dsh-vision` service and the schema library live in `dependencies`.

- **Stable 0.2.x line** (`0.2.1` + DSH `0.1.1-rc.2`): host peers use
  `^0.1.1-rc.2` / cordis `^4.0.1`, react 19.2.x, bare `schemastery`.
- **Alpha 0.3.x line** (`0.3.0-alpha.1` + DSH `0.1.2-alpha.5`): host peers
  are exact `0.1.2-alpha.5` (cordis `^4.0.2`), react 18.2.0, the
  `@deepseek-ai/schemastery` fork, plus the split alpha client packages
  (`dsh-api-remotes`, `dsh-api-session-controller`, `dsh-client-store`,
  `dsh-client-ui-settings`); `dsh-client-runtime` is gone. Exact peers keep
  one alpha candidate from silently claiming an unverified future alpha.

Batch 017 reproduced the prerelease-range mismatch before changing manifests:
`^0.1.0-rc.7` rejects the `0.1.1-rc.2` family under node-semver's
same-`[major, minor, patch]`-tuple prerelease rule, and the rc.2 host family
requires react 19.2.x, so the peer ranges and the repository test host were
raised to the exact rc.2 line (`^0.1.1-rc.2`, react 19.2.8) and locked with
package tests in `tests/package.test.ts`.

For the repository's 0.2.0 line, `dsh-plugin-image-mind@0.2.0` depends on
`@ran-sh/dsh-vision@^0.2.0`. These 0.2.0 packages are not yet published to npm,
so exact registry-install compatibility cannot be considered verified until a
future explicitly authorized release publishes them and the official isolated
add/boot/remove check is rerun.

## Harness ownership boundary

`dsh-vision` is only a plugin. The project and its executors must not directly
modify DeepSeek Harness-owned files or state. Read-only diagnostics and fully
isolated temporary Harness directories are allowed; fixes belong in this
repository. Real plugin installation/removal, when explicitly authorized, must
use the official Harness plugin manager.

During ongoing optimization, the user's real local Harness intentionally keeps
dsh-vision uninstalled. Intermediate development/test versions stay isolated;
a final selected version may be installed later only under a separate explicit
final-install authorization.

## If a future DSH update breaks image-mind

1. Do not hand-edit the Harness profile or DSH_HOME.
2. Reproduce with an isolated temporary DSH_HOME and exact DSH/plugin versions.
3. Confirm whether failure occurs in registry/package resolution, Harness startup, plugin composition, or runtime behavior.
4. Fix only dsh-vision-owned code when evidence attributes the fault to this plugin.
5. Update this matrix from a Result Contract after the isolated lifecycle is proven.
