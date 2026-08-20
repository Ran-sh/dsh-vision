# dsh-vision / image-mind — Codex 真实 DSH 测试计划

> **测试模式：TEST ONLY**  
> **当前真实 API 条件：仅 Opencode Go 套餐下的 Muse API 可用**  
> **目的：Codex 只负责验证，不修代码；测试结果写成固定 Markdown 报告并提交到 GitHub，供后续 ChatGPT 直接读取分析。**

---

## 1. 角色与最高优先级规则

你是 `Ran-sh/dsh-vision` 仓库的独立验证工程师。

你的任务只有一个：

> 在真实 DeepSeek Harness（DSH）环境中，对当前 `main` 做尽可能完整、可重复、可审计的测试，并生成结构化测试报告。

### 禁止事项

除最终报告文件外，严禁：

- 修改业务代码；
- 修改已有测试代码；
- 修改配置 schema；
- 修 bug；
- 重构；
- 放宽断言；
- 删除失败测试；
- 修改 GitHub Actions；
- 修改 package 版本；
- 发布 npm 包；
- 为了得到 PASS 改源码。

发现问题时：**只记录，不修复。**

如果某项因环境、额度、凭据、DSH 能力或第三方行为无法执行，必须标记为 `SKIP` / `BLOCKED`，说明真实原因，不允许伪造 `PASS`。

### 唯一允许的仓库写入

测试结束后，允许创建或更新：

```text
docs/test-results/dsh-vision-codex-test-report.md
```

该文件是唯一允许提交到 GitHub 的测试产物。

允许：

```text
git add docs/test-results/dsh-vision-codex-test-report.md
git commit -m "test: record real DSH validation results"
git push
```

禁止把任何源码、测试源码、配置、构建产物、benchmark 临时 JSONL 一并提交。

---

## 2. 测试前必须读取

开始前阅读：

```text
README.md
CHANGELOG.md
docs/verification-debt.md
benchmarks/vision/README.md
package.json
```

`docs/verification-debt.md` 是当前统一验证债务清单。测试结束时必须逐项映射，但**不要修改它**。

---

## 3. 当前真实 API 环境

当前只有：

```text
Opencode Go 套餐
  → Muse API
    → 多个可选模型
```

优先至少测试：

- Muse API 下实际可用的 **MiMo** 视觉模型；
- Muse API 下实际可用的 **Qwen / 千问** 视觉模型；
- 如果还有第三个稳定视觉模型，可增加 Model C。

### 模型选择规则

禁止凭空猜 model id。

必须优先通过：

1. image-mind / DSH 模型发现；
2. Muse API 实际模型列表；
3. 真实调用确认视觉能力。

报告必须记录完整实际 `model id`。

模型列表中存在不代表视觉调用已经验证通过。

---

## 4. 单网关结论边界

本轮只有 **1 个真实独立 API 网关：Opencode Go Muse API**。

因此可以真实验证：

- MiMo / Qwen 视觉质量；
- OCR；
- UI screenshot；
- code screenshot；
- document；
- chart；
- photo；
- multi-image；
- image preprocessing；
- task-aware planner；
- task-aware token budget；
- semantic cache；
- layered evidence cache；
- token usage；
- trace；
- lifecycle observer；
- model override；
- model fallback；
- timeout / retry / cancellation；
- DSH tool routing；
- Browser / DSH integration；
- attachment restart recovery；
- benchmark。

但不能声称完成：

> 两个真实独立供应商之间的 production cross-provider fallback。

如果配置：

```text
muse-mimo  -> Muse API + MiMo
muse-qwen  -> Muse API + Qwen
```

用来测 provider fallback / health / circuit，只能标记：

```text
SINGLE-GATEWAY SIMULATION
```

不能写：

```text
REAL CROSS-PROVIDER PASS
```

---

## 5. 工作区保护

测试前运行：

```bash
git rev-parse HEAD
git branch --show-current
git status --short
```

记录：

- commit SHA；
- branch；
- dirty 状态。

测试结束后再次运行：

```bash
git status --short
```

要求：Codex 不得主动造成源码修改。

允许本地生成：

- build 输出；
- test 输出；
- benchmark JSONL；
- 临时日志；
- 最终测试报告。

除最终报告外不要提交。

不要删除测试前已有的用户未提交文件。

---

## 6. Credential / Secret 安全

报告中绝不允许出现：

- API key；
- Authorization；
- Bearer token；
- credential 文件全文；
- cookie；
- signed URL query；
- secret；
- 含 secret 的错误全文。

允许写：

```text
Muse API credential: PRESENT
Credential source: DSH credential store
```

不允许写真实 key。

所有敏感值统一写：

```text
[REDACTED]
```

---

# Phase A — Static / Build

依次执行：

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:package
npm run test:built
```

不要因为前一项失败就停止所有后续仍可执行项目。

记录：

| ID | Command | PASS/FAIL/SKIP | Duration | Exit Code | Evidence |
|---|---|---|---:|---:|---|
| A1 | npm ci | | | | |
| A2 | npm run typecheck | | | | |
| A3 | npm test | | | | |
| A4 | npm run build | | | | |
| A5 | npm run test:package | | | | |
| A6 | npm run test:built | | | | |

---

# Phase B — DSH 安装 / 生命周期

尽量使用隔离测试 profile，不污染用户主 profile。

验证：

- B1 plugin install；
- B2 DSH startup；
- B3 `VisionRuntime` service load；
- B4 `image-mind` load；
- B5 设置页可打开；
- B6 Provider 配置读取；
- B7 模型发现；
- B8 保存 provider/model；
- B9 plugin remove；
- B10 reinstall；
- B11 无 stale bundle layer；
- B12 DSH restart；
- B13 restart 后插件仍正常。

记录 DSH version、profile、git SHA、package version、PASS/FAIL 和脱敏错误。

---

# Phase C — Opencode Go Muse API 接入

确认并记录：

- Muse API base URL host；
- apiStyle；
- credential 是否存在；
- 模型发现是否成功；
- 可用视觉模型完整 model ids。

优先建立：

```text
muse-mimo
muse-qwen
```

如果已有等价配置，优先复用，不破坏现有设置。

报告每个模型：

```text
Provider Entry ID:
Gateway: Opencode Go Muse API
Base URL Host:
API Style:
Model ID:
Model Family: MiMo / Qwen / Other
Visual Capability:
Discovery Source:
Status:
```

---

# Phase D — MiMo / Qwen 基础视觉能力

所有模型使用**完全相同的图片和 prompt**。

## D1 Photo

```text
Describe only the important visible facts in this image.
Do not guess details that are not visible.
```

## D2 中文 OCR

```text
逐字识别图片中所有可见文字。
保留数字、标点、大小写与有意义的换行。
看不清的部分写 [无法辨认]，不要猜。
```

## D3 English OCR

```text
Transcribe all visible text exactly.
Preserve punctuation, casing, numbers and useful line breaks.
Mark illegible spans instead of guessing.
```

## D4 Code Screenshot

```text
Read the visible code, terminal output, filenames,
line numbers and error text exactly.
Do not silently correct the code.
```

## D5 UI Screenshot

```text
Inspect hierarchy, layout, alignment, spacing,
clipping, overflow, controls, labels and visible states.
Tie every issue to concrete visible evidence.
```

## D6 Chart

```text
Read the title, axes, units, legend, series,
visible values, extrema and trend.
Separate directly observed values from estimates.
```

## D7 Document

```text
Preserve headings, labels, fields, values, tables,
reading order and footnotes.
Do not invent missing fields.
```

每个 case 记录：

```text
Model:
Case ID:
Result:
Provider Entry:
Model ID:
Latency:
providerCalls:
payloadBytes:
cacheHits:
inputTokens:
outputTokens:
retries:
modelFallbacks:
providerFallbacks:
splits:
Quality Notes:
```

---

# Phase E — MiMo vs Qwen 同案例对比

比较：

- OCR exactness；
- 中文 OCR；
- 英文 OCR；
- code transcription；
- UI small-detail recall；
- chart number accuracy；
- document field recall；
- photo hallucination；
- multi-image identity；
- latency；
- token；
- providerCalls；
- failure rate。

禁止只写“MiMo 更好”或“Qwen 更好”。

必须提供 case evidence，例如：

```text
OCR-03
MiMo: 18/20 fields correct
Qwen: 20/20 fields correct
```

---

# Phase F — Multi-image / Stable Image N

测试：

- F1：2 images compare；
- F2：4 images；
- F3：8 images；
- F4：>8 images；
- F5：413 adaptive split。

2-image prompt：

```text
Compare Image 1 and Image 2.
Separate unchanged facts, additions, removals and modifications.
Always identify which Image N supports each statement.
```

验证：

- Image N 不混淆；
- order 稳定；
- 8 images 可处理；
- >8 应在 Provider request 前失败；
- >8 情况 `providerCalls = 0`；
- 真实 413 若可触发，检查 recursive split、original Image N、`splits/providerCalls/payloadBytes`。

若无法稳定触发真实 413：

```text
BLOCKED / NOT REPRODUCIBLE
```

不要伪造。

---

# Phase G — Semantic Cache

### G1 same image + same prompt

执行两次。

验证第二次：

- `providerCalls` 是否为 0；
- `cacheHits` 是否增加。

### G2 `cache=refresh`

必须重新访问像素 / 模型。

### G3 `cache=no-store`

连续两次不应通过 cache 命中。

记录 providerCalls、cacheHits、latency、answer equality。

---

# Phase H — Layered Evidence Cache

重点任务：

- OCR；
- document；
- UI；
- code；
- chart；
- screenshot；
- compare。

同图问多个不同问题，例如：

```text
Q1: OCR all visible text.
Q2: What is the title?
Q3: What value appears in the bottom-right cell?
```

如果命中 reusable evidence，后续问题可能 `providerCalls = 0`。

必须特别测试窄问题：

- tiny UI icon；
- 一个表格 cell；
- 一行代码；
- 一个很小的数字；
- tooltip；
- 小角落状态。

正确行为：缓存证据不足时重新看图。

错误行为：不重新看图却猜答案。

记录：

- zero-provider reuse count；
- stale answer count；
- narrow-detail failure count；
- hallucination under reuse。

---

# Phase I — Task-aware Token Budget

同一 Muse API、同一模型分别测试：

- OCR；
- Document；
- Code；
- UI；
- Chart；
- Photo；
- General。

验证：

```text
effectiveMax = min(taskBudget, providerConfiguredCap)
```

至少测：

- I1 provider cap > task budget；
- I2 provider cap < task budget。

如果真实 API 无法观测 wire 参数，可以用 local mock server，但报告必须标明：

```text
REAL MUSE API
LOCAL MOCK
```

---

# Phase J — OpenAI Image Detail 兼容性

Muse API 不等于官方 OpenAI endpoint。

除非 baseURL 真的是：

```text
https://api.openai.com/v1
```

否则不要把 Muse API 当官方 OpenAI。

本轮重点验证 Muse API 请求没有因为 OpenAI-only `detail` 字段产生兼容性 400。

若没有官方 OpenAI credential：

```text
Official OpenAI detail test = SKIP
```

---

# Phase K — Retry / HTTP Errors

不要大量消耗 Muse API 额度人为制造限流。

优先使用 local mock endpoint 测：

- K1 HTTP 400：no retry / no provider fallback；
- K2 HTTP 401：no retry / no automatic fallback；
- K3 HTTP 403：同上；
- K4 HTTP 404：同上；
- K5 HTTP 429 + Retry-After：retry 且 trace 增加；
- K6 HTTP 500：recoverable；
- K7 HTTP 503：recoverable；
- K8 timeout；
- K9 network error；
- K10 invalid response shape。

每项必须标：

```text
REAL MUSE
LOCAL MOCK
SINGLE-GATEWAY SIMULATION
```

---

# Phase L — Model Override / Model Fallback

Muse API 下有多个模型，本项是重点。

验证：

- L1 explicit model override；
- L2 explicit model 必须 sticky；
- L3 automatic model fallback；
- L4 `modelFallbacks` trace 是否正确。

区分：

```text
model fallback
provider fallback
```

---

# Phase M — Provider Fallback（同网关模拟）

配置：

```text
provider A = Muse API + MiMo
provider B = Muse API + Qwen
```

两者使用同一 Muse baseURL / credential。

报告必须标记：

```text
SINGLE-GATEWAY SIMULATION
```

测试：

- M1 default A failure → B；
- M2 explicit provider A → no auto B；
- M3 explicit model → no cross-provider substitution；
- M4 deterministic 400/404 → no fallback；
- M5 auth failure → no fallback；
- M6 timeout/429/5xx → eligible；
- M7 max automatic provider fallback bound。

结论只能写：

```text
provider fallback routing logic validated under single-gateway Muse simulation
```

---

# Phase N — Health / Circuit Breaker

使用 local mock 或 single-gateway simulation。

验证：

- N1 初始顺序保持配置优先级；
- N2 recoverable failure 增加 streak；
- N3 threshold 后 circuit open；
- N4 cooldown 内 provider 被排除；
- N5 cooldown 后 half-open；
- N6 success closes；
- N7 half-open failure reopens；
- N8 400/401/model incompatibility 不污染 health。

记录：

- selection order；
- failure streak；
- circuit state；
- cooldown behavior。

独立 Provider 网络隔离必须标：

```text
NOT FULLY VALIDATED
```

---

# Phase O — Cancellation

### O1 in-flight caller abort

预期：

- 尽快停止；
- 不继续 retry；
- 不继续 fallback；
- retry counter 不错误增加；
- provider health 不因 caller abort 降级。

### O2 retry sleep 时 abort

同样验证。

---

# Phase P — Runtime Lifecycle Observer

订阅：

```text
VisionRuntime.subscribeLifecycle()
```

成功：

```text
started
completed
```

失败：

```text
started
failed
```

检查：

### started

- requestId；
- provider；
- task；
- imageCount；
- cacheMode；
- maxOutputTokens；
- explicitProvider；
- explicitModel；
- startedAt。

### completed

- elapsedMs；
- resultProvider；
- model；
- usage；
- trace。

### failed

- elapsedMs；
- errorCode；
- aborted；
- trace。

### 安全审计

事件中绝不能出现：

- 原 prompt；
- image base64；
- image bytes；
- local file path；
- attachment id；
- baseURL；
- API key；
- Authorization；
- provider response text；
- raw error message / cause。

故意注册一个会 throw 的 observer，确认 observer failure 不影响 vision call。

---

# Phase Q — Browser / DSH UI

真实 DSH UI 测试：

- Q1 drag PNG；
- Q2 paste PNG；
- Q3 JPEG；
- Q4 WebP；
- Q5 multi-image；
- Q6 image-only message；
- Q7 image + text；
- Q8 failed send draft retention；
- Q9 retry；
- Q10 hidden routing hint 不显示；
- Q11 hidden attachment metadata 不显示；
- Q12 preview；
- Q13 restart DSH；
- Q14 restart 后询问旧图片；
- Q15 old attachment 可重新读取；
- Q16 cache refresh；
- Q17 no-store。

保留 screenshot / console / server evidence，所有敏感信息脱敏。

---

# Phase R — Long Screenshot

至少测试：

```text
R1 1440×10000 PNG
R2 1440×20000 或合理可生成的更长页面
```

内容尽量包含：

- 中文；
- 英文；
- 小字号；
- 表格；
- 数字；
- 多栏；
- 页面上下远距离信息。

验证：

- 横向文字可读性；
- OCR recall；
- 内容遗漏；
- 过度缩放；
- latency；
- browser memory；
- provider calls；
- token。

使用 `cache=refresh` 避免旧缓存影响。

---

# Phase S — Benchmark

仓库已有：

```bash
npm run benchmark:run
npm run benchmark:score
npm run benchmark:compare
```

先做约 20 case 的真实 smoke corpus，不要为了凑 100 case 制造低质量样本。

建议：

| Category | Count |
|---|---:|
| OCR | 3 |
| UI | 3 |
| Code | 3 |
| Document | 3 |
| Chart | 3 |
| Photo | 3 |
| Compare | 2 |

分别使用：

- Muse + MiMo；
- Muse + Qwen。

两者必须使用同一 corpus。

示例：

```bash
npm run benchmark:run -- \
  --cases <cases.jsonl> \
  --out <mimo-results.jsonl> \
  --provider muse-mimo
```

然后：

```bash
npm run benchmark:score -- \
  <cases.jsonl> \
  <mimo-results.jsonl>
```

Qwen 同理。

如果有 baseline：

```bash
npm run benchmark:compare -- \
  <cases.jsonl> \
  <baseline-results.jsonl> \
  <candidate-results.jsonl>
```

记录：

- routingSuccessRate；
- assertionPassRate；
- taskSuccessRate；
- forbiddenHitCount；
- traceCoverage；
- tokenUsageCoverage；
- zeroProviderReuseRate；
- p50；
- p95；
- providerCalls；
- payloadBytes；
- inputTokens；
- outputTokens；
- cacheHits；
- retries；
- modelFallbacks；
- providerFallbacks；
- splits。

`benchmark:run` 是 **TOOL-DIRECT**，不等于主 Agent 自动调用工具。

---

# Phase T — Agent Routing

必须在真实 DSH 会话里单独测试。

目标：DeepSeek 主模型是否真的调用 `understand_image`，而不是不看图直接猜。

至少：

### T1 image only

```text
看看这张图。
```

### T2 OCR

```text
这张图里写了什么？
```

### T3 UI

```text
这个界面哪里有问题？
```

### T4 vague request

```text
帮我看看这个。
```

### T5 multi-image compare

```text
对比这两张图有什么变化。
```

记录：

- understand_image actually called；
- tool call count；
- 是否重复调用；
- final answer 是否由视觉证据支持；
- 是否出现“不看图就答”。

---

# Phase U — MiMo vs Qwen 最终对比

必须保持：

```text
同一 Muse API
同一 corpus
同一图片
同一 prompt
同一 cache policy
```

输出：

| Metric | MiMo | Qwen | Better | Evidence |
|---|---:|---:|---|---|
| OCR exactness | | | | |
| Chinese OCR | | | | |
| English OCR | | | | |
| UI recall | | | | |
| Code transcription | | | | |
| Document field recall | | | | |
| Chart accuracy | | | | |
| Photo hallucination | | | | |
| Compare accuracy | | | | |
| Latency p50 | | | | |
| Latency p95 | | | | |
| Input tokens | | | | |
| Output tokens | | | | |
| Provider calls | | | | |
| Failure rate | | | | |

---

# 7. 最终报告文件

测试结束后必须创建：

```text
docs/test-results/dsh-vision-codex-test-report.md
```

这份文件要提交并 push 到当前测试分支/`main`，方便后续 ChatGPT 直接通过 GitHub 读取。

除这份报告之外，不允许提交其他测试产生文件。

---

# 8. 最终报告固定格式

报告必须严格包含以下章节。

## SECTION 1 — TEST IDENTITY

```text
Repository:
Branch:
Commit SHA:
Dirty before:
Dirty after:
Date:
OS:
Node:
npm:
DSH version:
Codex environment:

Test mode:
TEST ONLY
NO SOURCE MODIFICATIONS
```

## SECTION 2 — REAL API / MODEL MATRIX

```text
Gateway: Opencode Go package → Muse API
Real independent gateway count: 1
Credential: PRESENT / MISSING
```

每个模型：

```text
Provider Entry ID:
Base URL Host:
API Style:
Model ID:
Model Family: MiMo / Qwen / Other
Visual Capability:
Discovery Source:
Status:
```

## SECTION 3 — STATIC / BUILD RESULTS

| ID | Command | PASS/FAIL/SKIP | Duration | Evidence |
|---|---|---|---:|---|

## SECTION 4 — DSH INTEGRATION

| ID | Scenario | PASS/FAIL/SKIP | Evidence | Notes |
|---|---|---|---|---|

## SECTION 5 — MIMO REAL MODEL RESULTS

记录完整 model id、case 数、成功/失败、平均 latency、p95、trace coverage、usage coverage，以及逐 case telemetry。

## SECTION 6 — QWEN REAL MODEL RESULTS

同上。

## SECTION 7 — MIMO VS QWEN

| Metric | MiMo | Qwen | Better | Evidence |
|---|---:|---:|---|---|

## SECTION 8 — CACHE

```text
Semantic cache:
Layered evidence:
refresh:
no-store:
zero-provider reuse:
stale answer:
narrow-detail failures:
hallucination under reuse:
```

## SECTION 9 — FALLBACK / RETRY / CIRCUIT

每项必须标：

```text
REAL MUSE
LOCAL MOCK
SINGLE-GATEWAY SIMULATION
SKIP
```

包含：model fallback、provider fallback、health、circuit、429、500、503、timeout、cancellation。

## SECTION 10 — IMAGE PIPELINE

```text
PNG:
JPEG:
WebP:
Long screenshot:
Multi-image:
8 images:
>8 rejection:
413:
Stable Image N:
```

## SECTION 11 — LIFECYCLE / TRACE / USAGE

```text
Lifecycle:
Secret-content audit:
Trace reconciliation:
Token reconciliation:
```

明确说明 lifecycle 是否出现 prompt/path/key/response text。

## SECTION 12 — BENCHMARK

```text
Corpus:
Mode: TOOL-DIRECT
MiMo score:
Qwen score:
routingSuccessRate:
assertionPassRate:
taskSuccessRate:
forbiddenHitCount:
traceCoverage:
tokenUsageCoverage:
zeroProviderReuseRate:
p50:
p95:
providerCalls:
payloadBytes:
inputTokens:
outputTokens:
cacheHits:
retries:
modelFallbacks:
providerFallbacks:
splits:
Regression Gate: PASS / FAIL / N/A
Failed Gates:
```

## SECTION 13 — AGENT ROUTING

与 tool-direct benchmark 分开。

逐 case：

```text
Case:
User Message:
Image Count:
understand_image Called:
Tool Call Count:
Final Answer Supported By Visual Evidence:
PASS/FAIL:
```

## SECTION 14 — FAILURES

只写真失败。

```text
ID:
Severity:
Area:
Reproduction:
Expected:
Actual:
Evidence:
Likely layer:
  DSH / vision-runtime / image-mind / adapter / cache / Muse API / model / browser / unknown
Possible Cause:
```

禁止在这里修代码。

## SECTION 15 — SKIPPED / BLOCKED

```text
ID:
Reason:
Required Later:
```

特别标明：

- 无独立第二 Provider；
- 官方 OpenAI 不可用；
- 无法稳定触发 413；
- 某模型 Muse 限额；
- Browser 环境缺失；
- Credential 缺失。

## SECTION 16 — VERIFICATION-DEBT MAPPING

逐项读取 `docs/verification-debt.md`：

```text
Debt Item:
Result: PASS / FAIL / PARTIAL / SKIP
Evidence:
```

不要修改 `verification-debt.md`。

## SECTION 17 — FINAL VERDICT

```text
Static/build:
DSH integration:
Muse MiMo:
Muse Qwen:
Cache:
Model fallback:
Provider fallback simulation:
Circuit:
Trace:
Usage:
Lifecycle:
Long screenshot:
Agent routing:
Benchmark:

Overall:
READY FOR NEXT DEVELOPMENT ITERATION
或
NOT READY — FIX BLOCKERS FIRST

Blocker:
High:
Medium:
Low:
Skipped:
```

---

# 9. Severity 标准

### BLOCKER

- npm/build 完全不可用；
- DSH 无法启动；
- plugin 无法加载；
- 图片主流程完全不可用；
- secret 泄露；
- 主流程 crash。

### HIGH

- OCR 大面积失败；
- stale cache 导致错误答案；
- explicit model/provider 被忽略；
- retry/fallback 错误；
- caller abort 后继续请求；
- attachment 重启后丢失；
- Image N 错乱。

### MEDIUM

- trace 不准确；
- usage 不准确；
- 单模型兼容问题；
- 长截图质量回退；
- latency 回退。

### LOW

- 文案；
- 非核心 UI；
- 非关键日志问题。

---

# 10. Codex 最终回复格式

最终聊天回复保持简洁，只写：

```text
Current Commit SHA:
Total Tests:
PASS:
FAIL:
SKIP/BLOCKED:
BLOCKER:
HIGH:
Overall Verdict:
Report Commit SHA:
Report Path: docs/test-results/dsh-vision-codex-test-report.md
```

真正详细内容全部放在 GitHub 报告文件中。

---

# 11. 最终原则

本轮目标不是“证明项目很好”，而是准确测出当前 `main` 在：

```text
真实 DeepSeek Harness
+ Opencode Go 套餐
+ Muse API
+ Muse 下 MiMo / Qwen 等视觉模型
```

环境中的真实状态。

允许：

```text
FAIL
SKIP
UNKNOWN
PARTIAL
```

不允许伪造 PASS。

再次强调：

> **只测试。发现 bug 不修。唯一允许提交的是最终测试报告 Markdown。**
