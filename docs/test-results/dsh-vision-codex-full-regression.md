# dsh-vision Codex Full Regression Report

## 1. Test Identity

| Field | Value |
|---|---|
| Repository | `Ran-sh/dsh-vision` |
| Branch | `main` |
| Mode | `TEST_ONLY` |
| Tested Source Commit SHA | `591fa7790b3c3ee335f3bc2143b4030f6aa3db4f` |
| Report Commit SHA | `PENDING` (the final pushed commit is reported in chat because a commit cannot contain its own SHA) |
| Date | 2026-08-21 (Asia/Shanghai) |
| Previous targeted verdict | `TARGETED GREEN — READY FOR FULL REGRESSION` |
| Output | `docs/test-results/dsh-vision-codex-full-regression.md` |

The tested revision was the exact `HEAD` obtained by the required fast-forward pull. No revision switch occurred during testing.

## 2. Workspace Safety / Environment

Start-of-task checks, in required order:

| Check | Result |
|---|---|
| `git pull --ff-only origin main` | PASS — fast-forwarded from `4767dc243ef75b298e29cbfae1c36776943835c6` to `591fa7790b3c3ee335f3bc2143b4030f6aa3db4f` |
| `git rev-parse HEAD` | `591fa7790b3c3ee335f3bc2143b4030f6aa3db4f` |
| `git branch --show-current` | `main` |
| `git status --short` | Clean before testing |

Environment:

| Item | Value |
|---|---|
| OS | Windows 11 Pro x64, Windows_NT 10.0.22631 |
| Node | v24.18.1 |
| npm | 11.16.0 |
| Vitest | 2.1.9 |
| DSH | 0.1.0-rc.7 |
| Muse API credential | PRESENT (value never printed or recorded) |
| Real route | DSH → image-mind → OpenCode Go plan → Muse API → `mimo-v2.5` |
| Independent real gateways | 1 |
| Browser process | Dedicated localhost `web` process on port 43191; stopped after testing |

The repository remained clean throughout evidence collection. No source, existing test, fixture, configuration, package, lockfile, build script, README, CHANGELOG, or verification-debt file was modified. Temporary benchmark output and controlled images stayed outside the repository.

## 3. Full Static Lane

| Command | State | Exit | Duration | Result / warning summary |
|---|---|---:|---:|---|
| `npm ci` | PASS | 0 | 13.058 s | 238 packages installed; audit reported 5 dependency vulnerabilities (3 moderate, 1 high, 1 critical); allow-scripts warnings were non-fatal |
| `npm run typecheck` | PASS | 0 | 6.457 s | All workspaces typechecked |
| `npm test` | PASS | 0 | 20.838 s | 58 passing files, 2 skipped files; 367 PASS, 7 SKIP, 0 FAIL |
| `npm run build` | PASS | 0 | 2.697 s | Current source built successfully |
| `npm run test:package` | PASS | 0 | 4.436 s | 11/11 PASS |
| `npm run test:built` | PASS | 0 | 2.620 s | 5/5 PASS |

The repeated Vite/esbuild `Unrecognized target environment ES2024` messages were warnings only; collection, assertions, build, package verification, and built-artifact verification all completed successfully.

## 4. Full Automated Regression Summary

The required full `npm test` lane executed rather than substituting targeted tests:

| Workspace | Files | Assertions |
|---|---:|---:|
| `@ran-sh/dsh-vision` | 6 PASS | 63 PASS |
| `dsh-plugin-image-mind` | 45 PASS + 2 SKIP | 262 PASS + 7 SKIP |
| Root | 7 PASS | 42 PASS |
| Total | 58 PASS + 2 SKIP | 367 PASS + 7 SKIP |

Current equivalent suites passed for execution-gate FIFO and cancellation, provider cooldown/circuit/half-open recovery, fallback ordering and non-poisoning classes, orchestration trace telemetry, tool-thin structure, lifecycle secrecy, cache policy, attachment restart routing, and benchmark scorer/compare/runner collection.

Primary full-regression gate accounting (sub-assertions are not double-counted):

| Primary gate | State |
|---|---|
| Full clean-install static lane | PASS |
| Full automated regression | PASS |
| Established quality/benchmark acceptance comparison | PASS |
| Shipped/built real DSH image path | PASS |
| Secrecy and hidden routing | PASS |
| Restart attachment recovery | PASS |
| Execution gate | PASS |
| Provider reliability deterministic contracts | PASS |
| Orchestration/tool structural contracts | PASS |
| Windows Node 24 benchmark collection | PASS |
| NEW-R1 sent preview/history UX | FAIL |

Primary total: **10 PASS / 1 FAIL / 0 PARTIAL-BLOCKED**.

## 5. Quality / Benchmark Matrix Summary

### Entrypoint and matrix size

The current repository does not contain the historical 428-case corpus or an entrypoint that can recreate it. It contains a 3-case example corpus explicitly documented as an example, not the final corpus. The broader available real-provider lane was therefore the previously established frozen 21-case corpus recovered from the prior cycle's temporary evidence, executed through the repository's unmodified native benchmark runner.

Executed matrix:

- Full deterministic automated lane: 367 PASS + 7 SKIP.
- Real-provider quality corpus: 21 MiMo cases across photo, OCR, code, UI, chart, document, comparison, multi-image, cache, layered evidence, and long screenshots.
- Offline example scorer and self-comparison: 3/3 PASS.
- Real DSH live lane: 3 fresh send scenarios plus 1 post-restart reread tool invocation.

An initial native invocation used the UI provider label `opencode-vision`; the benchmark catalog rejected that unknown ID before any provider call. The matrix was immediately rerun with the repository catalog ID `opencode-go` and model `mimo-v2.5`. This zero-traffic preflight error is not counted as a product failure.

### Real 21-case result

| Metric | Candidate | Historical baseline | Acceptance |
|---|---:|---:|---|
| Cases / missing | 21 / 0 | 21 / 0 | PASS |
| Routing success | 100% | 100% | PASS |
| Assertion/task success | 76.19% | 76.19% | PASS |
| Forbidden hits | 0 | 0 | PASS |
| Trace coverage | 95.24% | 95.24% | PASS |
| Token-usage coverage | 76.19% | 80.95% | PASS within threshold; token-total comparison skipped below 80% comparability coverage |
| Zero-provider reuse | 4.76% | 4.76% | Stable |
| p50 / p95 | 7,798.5 / 14,433 ms | 8,400.5 / 11,425 ms | PASS; p95 limit 14,852.5 ms |
| Provider calls / payload | 19 / 1,556,147 bytes | 19 / 1,556,147 bytes | PASS |
| Input / output tokens | 17,717 / 7,968 | 26,246 / 7,543 | Totals not compared because coverage was below the comparable threshold |
| Retries / model fallback / provider fallback / splits | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | Informational |

The repository comparison command exited 0 and every enforced threshold passed. Raw scorer failures were `chart-01` (`PROVIDER_ERROR`), `compare-02` (answer reached the 1,024-token cap before satisfying the assertion), `long-10000`, `long-20000` (both `PROVIDER_ERROR`), plus `multi-09-reject`, which the raw scorer marks unsuccessful even though rejection before provider traffic is the intended behavior. Thus the aggregate acceptance gate passed, while the substantive quality limitations remain explicitly classified below.

## 6. Real DSH End-to-End Revalidation

The current source was built before integration. The plugin was installed into the `web` profile through the official DSH plugin command. The installed junction resolved to the repository package, and the built `lib/index.js` SHA-256 matched the repository build byte-for-byte.

| Scenario | State | Evidence |
|---|---|---|
| Official install | PASS | Exit 0; settings listed image-mind and configured OpenCode Vision (`mimo-v2.5`) |
| Dedicated DSH startup | PASS | Localhost root returned HTTP 200 |
| Draft preview | PASS | Controlled PNG rendered as one `clipboard.png` preview before send |
| Image-only send | PASS | Main model chose one `understand_image` path without user tool wording; correctly returned `RETEST-731` and `BLUE 42` with colors |
| Image + text | PASS | One successful tool path; exact OCR and red/white/blue evidence returned |
| Two-image comparison | PASS | One successful tool path; correctly distinguished `RETEST-731`/`BLUE 42` from `RETEST-732`/`GREEN 84` and their colors |
| Former bundle crash | PASS | No `Dynamic require of "node:crypto" is not supported`; browser error-log count for that signature was 0; no crash-induced duplicate call |
| Build correspondence | PASS | Loaded and repository built entrypoints had identical hashes |
| Official remove | PASS | Exit 0; profile manifest dependency removed |

The real DSH path is functional on the tested source SHA. Provider calls were minimized to the required evidence: three send scenarios and one post-restart reread.

## 7. Secrecy / Hidden Routing / Restart Recovery

| Acceptance | State | Evidence |
|---|---|---|
| Neutral user bubble | PASS | Image-only showed only `已附加图片。`; two-image showed user text plus `已附加 2 张图片。` |
| No attachment metadata leakage | PASS | User-visible message contained no attachment ID, `sha256:`, attachment JSON, dimensions/byte routing data, raw URL, or `/image-mind/raw/` |
| Hidden routing | PASS | Image-dependent messages selected `understand_image` with omitted image arguments; no internal routing comment/instruction appeared in the user message |
| Raw bytes before restart | PASS | Host raw route returned HTTP 200, 4,382 bytes, matching the controlled source hash; ID redacted |
| Raw bytes after restart | PASS | Same route returned HTTP 200 and identical bytes/hash after normal host restart |
| Same-session reread | PASS | Reopened original session, supplied no new image, and obtained a fresh tool call that again returned exact `RETEST-731` and `BLUE 42` |

Attachment identifier evidence is retained only as `<REDACTED_ATTACHMENT_ID>`. Model-side durable recovery remains independent from the failed user-facing history preview.

## 8. NEW-R1 Preview / History UX

**NEW-R1 = FAIL — HIGH — KNOWN**.

| Check | State | Evidence |
|---|---|---|
| One-image draft preview before send | PASS | One safe image element and removable preview present |
| Sent-message thumbnail/gallery | FAIL | Sent historical message contained 0 image elements and no `clipboard.png` preview control |
| Click/open full-size | FAIL | No historical thumbnail or product-approved viewer entry existed to open |
| Switch away and back | FAIL | Reopened historical session still contained 0 image elements |
| Restart and reopen | FAIL | Reopened same session after host restart still contained 0 image elements |
| Safe mechanism | PASS | No raw attachment ID, route, or routing metadata was exposed as a workaround |

The behavior is materially identical to the targeted report. Correct model-side reread does not downgrade the user-facing HIGH failure.

## 9. Reliability / Provider Fallback

Deterministic provider-reliability coverage passed for cooldown/circuit opening, exactly one half-open probe, close-on-success, reopen-on-failure, fallback ordering, bounded routing, and non-poisoning non-recoverable classes. Execution-gate FIFO and cancellation-without-capacity-leak also passed in the full suite.

The real topology contains only one independent gateway. The 21-case run recorded no retry or fallback, and one chart case plus both long screenshots returned provider errors. Therefore deterministic fallback logic is validated, but independent real-provider failover is **NOT RUN**, not PASS.

## 10. Windows Node 24 Regression

This run used the same relevant environment as the targeted reproduction: Windows 11 x64, Node v24.18.1, and Vitest 2.1.9.

The following suites collected and executed inside the passing root test lane:

- `tests/benchmark-score.test.ts`
- `tests/benchmark-compare.test.ts`
- `tests/benchmark-runner.test.ts`

State: **PASS**. The prior `SyntaxError: Invalid or unexpected token` did not recur.

## 11. Failure Table

| ID | Severity | State | New/Known | Area | Reproduction | Expected | Actual / evidence | Likely layer |
|---|---|---|---|---|---|---|---|---|
| NEW-R1 | HIGH | FAIL | KNOWN | Sent preview/history UX | Paste, send, switch session, restart/reopen | Safe thumbnail/gallery and full-size viewer persist | Draft preview passes; sent/switch/restart history has 0 images and no viewer entry | DSH conversation renderer / image-mind preview integration |
| F-007 | MEDIUM | FAIL | KNOWN | Long screenshots | Run frozen `long-10000` and `long-20000` through MiMo | Recover required top/bottom evidence | Both current cases return `PROVIDER_ERROR`, one call each | Provider capability / preprocessing limits |
| F-008 | MEDIUM | FAIL | KNOWN | Real-provider stability | Run frozen 21-case corpus | Supported ordinary visual cases return answers | One ordinary chart case returns `PROVIDER_ERROR`; the historical UI provider error moved to a different ordinary case | Provider/gateway stability |
| FR-001 | MEDIUM | FAIL | NEW | Two-image benchmark answer completeness | Run frozen `compare-02` | Return both images' required changes within output budget | Answer reaches 1,024 output tokens before satisfying the scorer assertion | Model verbosity / output-budget interaction |
| F-012 | LOW | FAIL | KNOWN | Plugin uninstall hygiene | Officially remove image-mind from `web` profile | Dependency and linked package layer both disappear | Manifest dependency is absent, but `node_modules/dsh-plugin-image-mind` junction remains | DSH/pnpm plugin removal |

Unresolved severity totals: **BLOCKER 0 / HIGH 1 / MEDIUM 3 / LOW 1**.

## 12. Blocked / Skipped / Not Run

| Item | State | Reason |
|---|---|---|
| Historical 428-case matrix | BLOCKED | Current repository contains neither that corpus nor an executable entrypoint for it; no harness was invented |
| Independent real-provider failover | NOT RUN | Only one independent gateway exists |
| Five-model Qwen visual matrix | NOT RUN | Explicitly excluded by quota/capability discipline after prior 0/5 visual compatibility result |
| Forced real 413/429/error induction | NOT RUN | Would consume quota solely to manufacture failures; deterministic coverage passed |
| External provider-dashboard trace/token reconciliation | NOT RUN | No dashboard access; local trace/token coverage is reported exactly |
| Real WebP case | NOT RUN | No current controlled real-provider fixture in the established corpus; deterministic preprocessing coverage passed |
| Seven automated skipped assertions | SKIP | Suite-declared skips; not counted as PASS |

The above did not prevent meaningful full-regression completion. They are not represented as successful validation.

## 13. Comparison vs Targeted Retest

| Area | Previous targeted result | Current result | Regression? |
|---|---|---|---|
| F-001 shipped real DSH path | PASS | PASS | No |
| F-002 secrecy + hidden routing | PASS | PASS | No |
| F-003 restart recovery | PASS | PASS | No |
| F-004 execution gate | PASS | PASS | No |
| F-005 provider reliability | PASS | PASS | No |
| F-009 contracts | PASS | PASS | No |
| F-010 Windows benchmark transform | PASS | PASS | No |
| NEW-R1 preview/history UX | FAIL / HIGH | FAIL / HIGH / KNOWN | No change; unresolved |
| Full static lane | PASS | PASS | No |
| Broader benchmark comparison | Not run in targeted cycle | PASS, 21 real cases | New coverage |

No previous targeted PASS regressed to FAIL, PARTIAL, or BLOCKED. FR-001 is a newly observed MEDIUM per-case answer-completeness failure, while the established aggregate quality acceptance comparison remains PASS.

## 14. Release-Readiness Assessment

**A. Was the full regression meaningfully completed?** Yes. The clean static lane, all supported full automated suites, native 21-case real-provider matrix with historical comparison, real built-plugin DSH scenarios, secrecy, restart recovery, execution gating, reliability, contracts, and Windows Node 24 regression were executed. The unavailable historical 428-case artifact and single-gateway limitations are explicitly disclosed.

**B. Is the product release-ready?** No. NEW-R1 remains an unresolved HIGH user-facing regression. The release-ready requirement of zero unresolved HIGH issues is not met. The raw provider matrix also retains known MEDIUM limitations and one new MEDIUM answer-completeness issue, although its established aggregate comparison gate passed.

No source modifications were made by Codex.

## 15. Final Verdict

| Summary | Result |
|---|---|
| Tested Source Commit SHA | `591fa7790b3c3ee335f3bc2143b4030f6aa3db4f` |
| Primary PASS / FAIL / PARTIAL-BLOCKED | **10 / 1 / 0** |
| BLOCKER / HIGH / MEDIUM / LOW | **0 / 1 / 3 / 1** |
| Executed Matrix Size | **367 automated PASS + 7 SKIP; 21 real MiMo cases; 3 offline examples; 4 real DSH tool invocations** |
| Verdict | **FULL REGRESSION COMPLETE — NOT RELEASE READY** |
