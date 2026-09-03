# Release checklist

This checklist describes the `0.3.3` + `0.3.2` single-track candidate pair for the latest
Harness (`0.1.2-rc.1`, the `next` tag). Legacy `0.2.x` / `0.1.1-rc.2` lines are
historical only and are not maintained. The defective public `0.2.0` tarballs
(empty shells) must not be used or reinstalled. This is a pre-publication
gate: no npm publish, tag, GitHub release, OTP, token or real Harness profile
mutation is performed by the agent without explicit authorization.

## 1. Repository and package gates

Run from a clean checkout of the final candidate:

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run test:package
npm run test:built
git diff --check
```

Both package manifests and the lockfile must remain on the candidate pair
(`@ran-sh/dsh-vision@0.3.2`, `dsh-plugin-image-mind@0.3.3`); the plugin must
depend on `@ran-sh/dsh-vision@^0.3.2` (never `file:`, `link:` or `workspace:`).
The minimum of `^0.3.2` is a hard contract: image-mind calls the circuit-breaker
`admission()` API that only vision 0.3.2 ships — the published 0.3.1 service must
never satisfy the declared range. `packages/vision` and `packages/image-mind` must pass
`npm pack --dry-run` without `src/`, tests, credentials or private paths.
Every publishable package carries a prepack fail-safe
(`scripts/pack-guard.mjs`): packaging rebuilds `lib/**` from current sources
or fails closed — the defective-0.2.0 empty-shell incident cannot recur, and
publication MUST go through `npm pack`/`npm publish` so the guard runs.

## 2. Evidence and benchmark gates

Inventory the merged Result Contracts before changing docs. Separate
deterministic/local-mock evidence from real-provider evidence. Run the corpus,
deterministic benchmark, preprocess comparison, score and baseline comparison
without changing thresholds. Verify 100% route/trace truth where the corpus
claims it, no forbidden-answer leakage, automatic refocus for narrow cached
questions, ordered multi-image labels, and a controlled wrong-answer
comparison with a non-zero exit status.

## 3. Exact DSH isolated gate

Use only a task-owned temporary DSH state and official Harness lifecycle
commands. Build and pack both candidate packages locally because the registry
versions are not yet published. Against exact `@deepseek-ai/dsh@0.1.2-rc.1` (the
current single-track target; older rc.1/rc.2 evidence stays in history),
verify baseline boot, local-packed add, service/plugin composition,
web/runtime route and tool smoke, settings/RPC envelopes where available,
restart/reopen and official remove. `docs/compatibility.md` records the
current gate; re-run the gate when the target version changes. Browser
evidence must distinguish route/UI reachability from provider quality. No real
credentials are read; a missing provider is recorded as external debt rather
than a fake PASS.

The `dsh-plugin-image-mind` lifecycle CLI carries its own automated gate:
`RUN_CLI_LIFECYCLE=1 npx vitest run tests/cli-packed-lifecycle.test.ts`
packs both packages, installs the CLI from the packed tarball, and drives
install → status → idempotent second install → same-version no-op update →
composition dump → shared-service-retaining uninstall → absent status →
idempotent re-uninstall plus an older→current convergence and an HTTP boot
smoke (one lane; rc.1 gates GET / behind a token, so 401 counts as alive)
against exact rc.1 in disposable DSH_HOME state. Dedicated CI lanes must stay
green on Linux (Node 22/24), Windows and macOS.

## 4. Registry preflight and publication boundary

Read-only preflight:

```sh
npm view @ran-sh/dsh-vision@0.3.2 name version dist-tags
npm view dsh-plugin-image-mind@0.3.3 name version dist-tags
```

If either lookup is absent, record `EXPECTED_NOT_PUBLISHED`. If metadata is
present, record only public metadata and stop before any republish. After an
explicit maintainer authorization, publish the service first, then the plugin;
never paste an OTP or npm token into a chat. Only after both packages exist in
the registry may a fresh registry install be called compatibility evidence.

## 5. Current final-RC review gate

The final work must be one clean unmerged Draft PR based on the exact latest
`main` commit. Required CI includes Node 22/24, Windows, package/install,
built artifacts, benchmark, secret scan and the `cli-lifecycle` lanes
(Linux/Windows/macOS roundtrip; boot smoke on one lane). Keep the PR unmerged
until ChatGPT review is complete. If GitHub authentication prevents Draft PR creation, record
that external blocker in the Result Contract; do not fabricate a PR number.

## 6. Security and ownership

The plugin never writes a user profile. Browser messages contain only neutral
attachment markers. Logs and Result Contracts contain no API keys,
Authorization headers, cookies, signed URLs, credential files or personal
machine paths. Real-provider, real-Harness installation and publication remain
separate authorized operations.

## 7. Post-publication (maintainer only)

After publication and a clean registry install, a maintainer may tag `v0.3.3` (service `v0.3.2`)
and create the GitHub release. A separate authorized Harness run may then
install the published package, execute the real-provider/browser matrix and
remove it again. Those post-publication actions do not retroactively turn local
source-built evidence into registry evidence.
