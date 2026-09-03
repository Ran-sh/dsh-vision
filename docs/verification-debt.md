# Verification debt

This is the durable boundary between evidence already earned and work that
needs an external provider, a published registry package or an authorized real
Harness run. Deterministic tests do not become real-provider evidence.

## Closed by merged Result Contracts

The following items are closed with durable evidence. The pointers are Result
Contracts, not claims about a hosted provider:

| Item | Result | Evidence |
|---|---|---|
| F-001 built Node `node:crypto` bridge | PASS | Batch 013 Result Contract; built-artifact and Windows lane |
| F-002 neutral user-message secrecy | PASS | Batch 013/015 Result Contracts; F002/release-safety assertions |
| F-003 attachment/session restart recovery | PASS | Batch 013 final host retest and attachment assertions |
| F-004 execution-gate FIFO/abort capacity | PASS | Batch 014 reliability tests and CI |
| F-005 circuit half-open probe/recovery | PASS | Batch 014 reliability tests and CI |
| F-009 trace/task-budget orchestration | PASS | Batch 014/015 integration and trace assertions |
| F-010 benchmark module collection on Windows Node 24 | PASS | Batch 013/015 package and benchmark CI evidence |
| package/version/source boundary | PASS | Batches 013–015 package, built and secret-scan evidence |
| deterministic routing/cache/privacy/fallback regressions | PASS | Batch 014/015 Result Contracts and final CI |

Batch 016 reruns the complete lane and records its own command evidence in the
Result Contract. If a rerun disagrees with an earlier contract, this file must
be corrected before completion.

## Browser and exact-host boundary

These remain external or partial unless the current isolated exact-`0.1.2-rc.1`
run proves them. Do not mark them green from a local mock:

- [ ] model-only routing in a real DSH conversation (image-only and vague
  prompts must call `understand_image`); the host prompt seam is separate from
  user-bubble secrecy.
- [ ] drag/paste PNG, JPEG and WebP, failed-send draft retention, retry,
  preview/lightbox, session switch and restart/reopen in the exact `0.1.2-rc.1`
  web UI.
- [ ] route/RPC/settings reachability and official add/remove with exact
  `@deepseek-ai/dsh@0.1.2-rc.1` beyond the isolated composition/routes gate
  already proven (see `docs/compatibility.md`).
- [ ] lifecycle observer records in a real host contain no prompt/path/key/
  response text, and an observer failure does not change the request result.
- [ ] long 1440px screenshots and browser memory/OCR quality at the intended
  pixel budget.

Historical note: exact `0.1.1-rc.1` (Batches 006–016) and exact `0.1.1-rc.2`
(Batch 017, incl. the full browser journey) evidence stays in history; the
Batch 008 `/image-mind/*` route gap observed on rc.1 does not reproduce on
later lines. Only the current `0.3.0` / `0.1.2-rc.1` gates are active.

## Lifecycle CLI boundary

Closed with automated evidence on the current single-track line
(`0.3.0` + exact `@deepseek-ai/dsh@0.1.2-rc.1`): the packed
`dsh-plugin-image-mind` CLI drives install → status → idempotent second
install → same-version no-op update → older→current convergence →
shared-service-retaining uninstall → absent status → idempotent re-uninstall
in disposable DSH_HOME state (dedicated Linux/Windows/macOS CI lanes).
Still open:

- [ ] registry-install CLI roundtrip: everything above runs on local-packed
  artifacts; the first valid registry evidence will come from publishing
  the guarded `0.3.0` candidate (service-first then plugin-second,
  maintainer-authorized) and re-running this verification.
- [ ] HTTP boot smoke currently runs on one CI lane (Linux Node 22); Windows/
  macOS lanes prove parsing/spawning plus the full lifecycle roundtrip but not
  a live boot.
- [ ] `npx dsh-plugin-image-mind@latest update` from a real older registry
  version cannot be exercised before a healthy publication exists.

The known pre-publish registry add blocker is package availability, not a
plugin runtime failure: `0.3.0` is intentionally unpublished. Use local-packed
artifacts for this pre-publish gate and keep registry compatibility unverified.
(Historical note: the defective public `0.2.0` empty-shell incident stays in
history; do not reinstall it.)

## Real-provider debt (requires explicit credentials and quota)

The following are intentionally open. Existing local mocks and deterministic
stubs must not be described as these providers passing:

- [ ] Opencode Go/Muse MiMo and Qwen visual probes and quality comparison.
- [ ] Command Code Goat, DashScope/Qwen-VL, Gemini-compatible, Responses,
  Ollama/LM Studio and another independent hosted provider.
- [ ] Official OpenAI `detail` policy with the specified models; compatible
  endpoints must be checked for absence of the OpenAI-only field.
- [ ] A real 413 endpoint, 429 + Retry-After, timeout/network recovery and
  observed provider-call/token trace reconciliation.
- [ ] Cross-provider health/circuit ordering against independent gateways;
  deterministic single-gateway simulations remain only simulation evidence.
- [ ] Caller cancellation verified against provider logs and lifecycle trace.
- [ ] Layered evidence quality/cost comparison against a forced refresh for
  every task family and a frozen 100-task provider corpus.

Each item requires a controlled environment, redacted evidence, and a new
Result Contract. Do not spend provider quota during this pre-publish task.

## Release and registry debt

- [ ] `npm view @ran-sh/dsh-vision@0.3.0 name version dist-tags` and the same
  lookup for `dsh-plugin-image-mind@0.3.0` remain `EXPECTED_NOT_PUBLISHED` until
  a maintainer authorizes publication.
- [ ] Fresh registry install with `npm ls` showing both 0.3.0 packages and no
  file/link/workspace dependency (post-publication only).
- [ ] Service-first then plugin-second npm publication, OTP/secret handling,
  tag/release and a clean post-publish Harness install/remove (maintainer-only).
- [ ] One clean PR with required checks green for the next gate (PRs #68–#73
  merged for the 0.3.0/0.3.1 single-track adaptation; open a new PR only when
  the next change lands).

## Single-track 0.3.2 + 0.3.1 / DSH 0.1.2-rc.1 boundary (2026-09-03)

Closed on exact `0.1.2-rc.1`: `@ran-sh/dsh-vision@0.3.1` and
`dsh-plugin-image-mind@0.3.2` published to npm (service first, then plugin;
plugin depends on `@ran-sh/dsh-vision@^0.3.1`), a pure registry-only install
(no tgz/workspace/overrides) proven in a disposable DSH_HOME composing
0.3.2 + 0.3.1 (official add, dump-config composition, web boot,
`/image-mind` routes 200, official remove clean), and a real Chrome session
proving the settings card renders in 设置 → 插件 → 插件配置 with a working
add-provider flow that persists to `settings.yaml`. Still open — do not
convert to PASS without new Result Contracts:

- [ ] remaining browser journey items: drag/paste PNG/JPEG/WebP,
  lightbox, exact-eight/ninth-rejected gate, failed-send retry/draft
  retention, session switch/restart and client reload, committed-preview
  survival — in the real `0.1.2-rc.1` web UI (Batch 017 proved these on the
  historical rc.2 line only).
- [ ] real `understand_image` → vision → main-conversation routing through
  the rc.1 web UI with the published 0.3.1 packages and a hosted provider.
- [ ] hosted-provider quality, quota/413/429 behavior and token-trace
  reconciliation against real endpoints.

## Exit rule

The 0.3.0 candidate is pre-publish ready only when the repository/package,
benchmark, focused regression, exact isolated `0.1.2-rc.1` local-packed,
security and documentation checks pass; open provider, registry-publication
and authorization debt is listed here rather than silently converted to PASS.
