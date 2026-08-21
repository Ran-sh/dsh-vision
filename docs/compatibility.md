# Compatibility

Known-good and latest compatibility targets for `dsh-plugin-image-mind`.
DSH is under active development; this project tests against specific versions
and does not promise compatibility with every future DSH release.

| Plugin version | Vision version | DSH (CLI) | DSH runtime (@deepseek-ai/dsh-*) | Status | Date | Notes |
|---|---|---|---|---|---|---|
| 0.2.0 | 0.2.0 | 0.1.1-rc.1 | runtime not reached for exact published target | TARGET BLOCKED (unpublished packages, not a compatibility failure) | 2026-08-21 | isolated exact-rc.1 validation attempted the official registry add for `dsh-plugin-image-mind@0.2.0`, but npm has no 0.2.0 release for either `dsh-plugin-image-mind` or `@ran-sh/dsh-vision`; the failure occurs at registry version resolution before DSH/plugin code runs. Publish/release remains a separate permission boundary. |
| 0.1.1 | 0.1.0 | 0.1.1-rc.1 | published 0.1.x line | KNOWN_GOOD (isolated lifecycle) | 2026-08-21 | exact rc.1 + published `dsh-plugin-image-mind@0.1.1` / `@ran-sh/dsh-vision@0.1.0`: official add PASS, both bundle layers compose, web reaches HTTP 200, `understand_image` registration is present in the loaded published bundle, official remove fully prunes the isolated install. Real provider image call remained PARTIAL because provider provenance could not be established without reading forbidden real Harness settings. |
| 0.2.0 | 0.2.0 | 0.1.0-rc.7 | 0.1.0-rc.7 / cordis 4.0.1 | KNOWN_GOOD (release-blocking source/release evidence) | 2026-08-21 | final real-DSH retest 10/10 PASS; NEW-R1 sent/history previews, session switch, restart/reopen, F002 secrecy, F003 reuse, FR-001 and release safety all green; CI Node 22/24 + Windows + package/built checks green. The 0.2.0 packages are currently repository versions and are not yet published to npm. |
| 0.2.0 | 0.2.0 | 0.1.0-rc.8 | runtime not reached | HISTORICAL SIGNAL (environment-blocked) | 2026-08-21 | exact rc.7 and rc.8 metadata and tarballs both resolved in a few seconds, but clean dependency-only installs for both versions timed out at 180s on Node 24.18.1 / npm 11.16.0 / Windows; no rc.8-specific resolver regression was established. Later root-cause work attributed the transient `npx` stall to npm Arborist dependency-tree resolution before DSH starts. |
| 0.1.1 | 0.1.0 | 0.1.0-rc.7 | 0.1.0-rc.7 / cordis 4.0.1 | HISTORICAL | 2026-08-20 | clean registry install; baseline/add/boot/route+RPC/UI/remove/boot/reinstall roundtrip; no profile edit; real red-image challenge passed |
| 0.1.0 | 0.1.0 | 0.1.0-rc.7 | 0.1.0-rc.7 / cordis 4.0.1 | HISTORICAL | 2026-08-19 | baseline + add + boot + remove + boot verified; plugin manager pnpm 11.7.0 |
| 0.1.1 | 0.1.0 | 0.1.0-rc.8 | runtime not reached | HISTORICAL SIGNAL (non-blocking, incomplete) | 2026-08-20 | first npm 11.16.0 dependency-solver attempt did not complete within 10 minutes; later exact-pinned diagnostics showed the same clean-install timeout also affects rc.7 in this environment, so this is not evidence of an rc.8-specific product incompatibility |

## Peer dependency policy

Host-owned DSH runtime packages are declared as **peerDependencies** with a
bounded range (`^0.1.0-rc.7` / `^4.0.1`), mirroring the official
`@deepseek-ai/dsh-web-search-exa` convention. image-mind never ships a private
nested copy of these host packages (the profile tree stays deduped). The
plugin-owned `@ran-sh/dsh-vision` service and the `schemastery` schema library
live in `dependencies`.

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
