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

These remain external or partial unless the current isolated exact-rc.1 run
proves them. Do not mark them green from a local mock:

- [ ] model-only routing in a real DSH conversation (image-only and vague
  prompts must call `understand_image`); the host prompt seam is separate from
  user-bubble secrecy.
- [ ] drag/paste PNG, JPEG and WebP, failed-send draft retention, retry,
  preview/lightbox, session switch and restart/reopen in the exact rc.1 web UI.
- [ ] route/RPC/settings reachability and official add/remove with exact
  `@deepseek-ai/dsh@0.1.1-rc.1`; Batch 016 may close this only with a
  task-owned profile and local-packed 0.2.0 packages.
  **Closed for exact rc.2 by Batch 017**: with a task-owned profile and
  local-packed 0.2.0 packages, official add/boot/remove, `/image-mind` route
  reachability, settings writes, the keyless visual challenge and restart
  recovery all pass against `@deepseek-ai/dsh@0.1.1-rc.2` (see
  `docs/compatibility.md`); the Batch 008 `/image-mind/*` route gap observed on
  rc.1 does not reproduce on rc.2. The exact rc.2 browser run also closed the
  rendered attachment/settings, PNG/JPEG/WebP drop/paste/lightbox,
  exact-eight/ninth-rejected fail-fast, neutral-marker, real
  `understand_image`→vision→main, failed-send retry/draft-retention,
  session-switch/restart and cache/refocus gates.
- [ ] lifecycle observer records in a real host contain no prompt/path/key/
  response text, and an observer failure does not change the request result.
- [ ] long 1440px screenshots and browser memory/OCR quality at the intended
  pixel budget.

The known exact-rc.1 registry add blocker is package availability, not a
plugin runtime failure: 0.2.0 is intentionally unpublished. Use local-packed
artifacts for this pre-publish gate and keep registry compatibility unverified.

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

- [ ] `npm view @ran-sh/dsh-vision@0.2.0 name version dist-tags` and the same
  lookup for `dsh-plugin-image-mind@0.2.0` remain `EXPECTED_NOT_PUBLISHED` until
  a maintainer authorizes publication.
- [ ] Fresh registry install with `npm ls` showing both 0.2.0 packages and no
  file/link/workspace dependency (post-publication only).
- [ ] Service-first then plugin-second npm publication, OTP/secret handling,
  tag/release and a clean post-publish Harness install/remove (maintainer-only).
- [ ] One unmerged Draft PR with required checks green. PR creation requires a
  GitHub-authenticated maintainer; the agent must record the blocker if absent.

## Exit rule

The 0.2.0 candidate is pre-publish ready only when the repository/package,
benchmark, focused regression, exact isolated rc.1 source-built/local-packed,
security and documentation checks pass; open provider, registry-publication
and authorization debt is listed here rather than silently converted to PASS.
