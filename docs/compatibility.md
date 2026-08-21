# Compatibility

Known-good and latest compatibility targets for `dsh-plugin-image-mind`.
DSH is under active development; this project tests against specific versions
and does not promise compatibility with every future DSH release.

| Plugin version | Vision version | DSH (CLI) | DSH runtime (@deepseek-ai/dsh-*) | Status | Date | Notes |
|---|---|---|---|---|---|---|
| 0.2.0 | 0.2.0 | 0.1.0-rc.7 | 0.1.0-rc.7 / cordis 4.0.1 | KNOWN_GOOD (release-blocking) | 2026-08-21 | final real-DSH retest 10/10 PASS; NEW-R1 sent/history previews, session switch, restart/reopen, F002 secrecy, F003 reuse, FR-001 and release safety all green; CI Node 22/24 + Windows + package/built checks green |
| 0.2.0 | 0.2.0 | 0.1.0-rc.8 | runtime not reached | NEXT (non-blocking, environment-blocked) | 2026-08-21 | exact rc.7 and rc.8 metadata and tarballs both resolved in a few seconds, but clean dependency-only installs for both versions timed out at 180s on Node 24.18.1 / npm 11.16.0 / Windows; no rc.8-specific resolver regression was established and runtime/bundle/remove compatibility remains unverified |
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

For the 0.2.0 release, `dsh-plugin-image-mind@0.2.0` depends on
`@ran-sh/dsh-vision@^0.2.0`.

## If a future DSH update breaks image-mind

1. Remove image-mind with the official command:
   `npx @deepseek-ai/dsh plugin --profile web remove dsh-plugin-image-mind`
2. Confirm DSH boots without it.
3. Check this matrix and the latest plugin release.
4. Install a compatible image-mind release.

Do not hand-edit the profile. Escalate with the exact DSH version and composed
bundle evidence if an official add/remove roundtrip fails.
