# Compatibility

Known-good and latest compatibility targets for `dsh-plugin-image-mind`.
DSH is under active development; this project tests against specific versions
and does not promise compatibility with every future DSH release.

| Plugin version | Vision version | DSH (CLI) | DSH runtime (@deepseek-ai/dsh-\*) | Status | Date | Notes |
|---|---|---|---|---|---|---|
| 0.1.0 | 0.1.0 | 11.7.0 | 0.1.0-rc.7 / cordis 4.0.1 | KNOWN_GOOD (release-blocking) | 2026-08-19 | baseline + add + boot + remove + boot verified |
| 0.1.0 | 0.1.0 | latest available | latest resolved | LATEST (upstream detector, non-blocking) | 2026-08-19 | re-check before each release |

## Peer dependency policy

Host-owned DSH runtime packages are declared as **peerDependencies** with a
bounded range (`^0.1.0-rc.7` / `^4.0.1`), mirroring the official
`@deepseek-ai/dsh-web-search-exa` convention. image-mind never ships a private
nested copy of these host packages (the profile tree stays deduped). The
plugin-owned `@ran-sh/dsh-vision` service and the `schemastery` schema library
live in `dependencies`.

## If a future DSH update breaks image-mind

1. Remove image-mind with the official command:
   `npx @deepseek-ai/dsh plugin --profile web remove dsh-plugin-image-mind`
2. Confirm DSH boots without it.
3. Check this matrix and the latest plugin release.
4. Install a compatible image-mind release.

Do not hand-edit the profile unless absolutely necessary.
