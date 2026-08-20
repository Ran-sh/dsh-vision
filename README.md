# dsh-vision — 给 DeepSeek Harness 增加图像理解能力

> This is an **independent community plugin** for DeepSeek Harness and is **not an official DeepSeek package**.
> 本项目是独立第三方插件，与 DeepSeek 官方无隶属关系；架构设计参考 DeepSeek Harness 的 capability/provider 模式。

Vision for text-only DSH agents: `understand_image` lets the main model inspect images through an OpenAI-compatible visual-perception backend while keeping image bytes out of the conversation log.

给 DeepSeek Harness（DSH）Web UI 用的图像理解工具。纯文本主模型本身不直接接收图片；本插件把图片存进宿主 attachment store，只把安全引用放进对话，模型需要像素信息时调用 **`understand_image`**，视觉端点返回的文字证据再交回主模型继续推理。

> **定位**：视觉模型是 DeepSeek 的“感知后端”，不是主会话模型。它不会出现在主模型选择器里，也不会替换 `ctx.llm`。

## 架构（Service + Provider Plugin）

本仓库是一个 npm workspace，拆成两个真正独立的包：

```text
@ran-sh/dsh-vision          ← Service Definition，owns ctx.vision
       │
       ▼
    ctx.vision
       ▲
       │ inject ['vision']
       │
dsh-plugin-image-mind       ← Provider + Tool + UI
       │
       ├── Provider directory / active provider
       ├── OpenAICompatibleVisionAdapter
       ├── credentials / settings / attachments
       ├── task-aware vision planner
       └── understand_image（薄工具）
```

调用链：

```text
DeepSeek main model
      │
      │ understand_image
      ▼
media loader
      │
      ▼
ctx.vision.call({ provider, model, prompt, images, cache, signal })
      │
      ├── provider selection / adapter dispatch
      ▼
OpenAICompatibleVisionAdapter
      │
      ├── task-aware evidence prompt
      ├── semantic cache / refresh / no-store
      ├── global endpoint backpressure
      ├── transient retry
      ├── bounded model fallback
      └── HTTP 413 adaptive multi-image splitting
      ▼
Vision API
```

**ownership 边界**：

| 内容 | owner |
|---|---|
| `ctx.vision` / VisionRuntime / VisionAdapter / VisionError / provider registry / directory / discoverModels / probe / `VisionRequest` | `@ran-sh/dsh-vision`（provider-neutral） |
| Provider Catalog / OpenAI-compatible wire / credentials / settings / media / cache / planner / fallback / attachments / tool / client | `dsh-plugin-image-mind` |

`image-mind` 不创建 `VisionRuntime`；它 `inject ['vision']`，通过 `ctx.vision.registerAdapter(...)`、`registerConfigurableProviders(...)` 和 default-provider resolver 注册进 Service。卸载 Provider 只撤销自己的路由，Service 生命周期独立。

## 主要能力

| 能力 | 当前行为 |
| --- | --- |
| 图片输入 | 本地绝对路径、http(s) URL、完整 attachment JSON、或当前进程内 bare `sha256:` attachment id |
| 直接发图 | 拖入/粘贴图片后，发送钩子改写成安全引用；失败 **fail closed**，保留草稿图片供重试，不再退回已知会失败的 text-only raw-image send |
| 重启后旧图 | 新发送的图片会把完整 `[image attachment {...}]` metadata 放进 HTML 隐藏注释；UI 不显示，但后续模型可优先把完整 JSON 交给工具，避免只靠进程内 bare-id registry |
| 高保真预处理 | PNG 截图/文档保持无损 PNG，最长边上限 3072；JPEG/WebP 照片走 2048 + JPEG 0.85；小图/GIF 保持原样 |
| Task-aware perception | Adapter 在上游 wire 前自动识别 OCR / UI / code / chart / document / compare / translate 等任务，要求“观察事实优先、推断分离、保留文字数字、显式不确定性” |
| 图内 prompt-injection 防护 | 视觉模型明确把图片中的命令、提示词、策略、工具文本当作**不可信视觉内容**，可转录但不得执行 |
| 多图 | `images[]` 最多 **8 张**；顺序保持；加载并发固定 2；总字节仍受 `2 × maxBytes` 独立上限约束，因此放宽的是“小截图数量”，不是无限 payload |
| 413 自适应 | 多图请求若端点真实返回 HTTP 413，会递归二分并顺序分析，再把批次证据合并；单图 413 直接失败，不无限重试 |
| 视觉模型 fallback | 配置默认模型若明确报“模型不存在”或“不支持图片”，已知 Provider plan 最多尝试 2 个有序视觉备选；自定义未知端点不猜模型；显式 `model` override 从不被偷偷替换 |
| 瞬时错误重试 | 网络失败 / timeout / HTTP 429 / 5xx 才自动重试（指数退避 + 抖动 + capped Retry-After）；确定性的 4xx 不重试 |
| 全局 backpressure | 进程级 FIFO 并发门默认最多 4 个真正的视觉 wire operation；排队可取消，retry/backoff 睡眠不占槽位 |
| 语义缓存 | cache key 包含 provider / endpoint / model / protocol / ordered image digests / prompt；`use` 可复用，`refresh` 强制重新看像素并更新缓存，`no-store` 完全绕过读写 |
| 响应兼容 | Chat Completions 同时接受 `message.content` 字符串和 text-parts 数组；Responses 接受标准 message output 与兼容端点的 `output_text`；reasoning/tool parts 不混入视觉证据 |
| 模型发现 | Host 侧 `/models` discovery + 已知计划候选；浏览器不持有 Provider API Key |
| 两种协议 | `chat-completions` 与 OpenAI `responses` |
| 图片预览 | 对话引用可渲染缩略图并查看大图，可在设置里关闭 |

## 安全边界

- 图片 URL 只允许 http(s)，redirect 拒绝；URL 内嵌凭据拒绝。
- 私网 IP（IPv4 / IPv6 / mapped）和 DNS 解析到私网默认拒绝，`allowPrivateNetwork` 显式开启才放行；localhost 为本地视觉端点场景保留支持。
- 这是 SSRF 防护，不是网络沙箱：无法把真实连接 pin 到预解析 IP，因此不能宣称绝对抵御 DNS rebinding。
- `maxBytes` / combined image bytes / `maxOutputTokens` / `timeoutMs` 都有界。
- 图片 magic bytes 会重新 sniff；声明 MIME 与真实类型不一致会拒绝。
- Provider 错误摘录有长度上限并做 Authorization / Bearer / api_key / `sk-*` redaction。
- API Key 通过 DSH credential seam 保存；浏览器只知道“已配置”，拿不到明文。
- 图片字节不进入 conversation log；隐藏 attachment metadata 只含宿主引用元数据，不含图片内容。
- 图片内出现的提示词、命令或工具调用文字被 Vision Planner 明确视为不可信数据。

## 安装（Harness 官方插件机制）

本项目**不修改你的 DSH profile**。安装与启用交给 Harness 自己的 bundle/plugin 管理。

要求：DeepSeek Harness 已安装、Node.js 22+，profile 包管理器为 pnpm。

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-plugin-image-mind@0.1.1
```

`@ran-sh/dsh-vision` 是 `dsh-plugin-image-mind` 的 npm 依赖，会随插件自动安装，**无需单独安装**。安装后重启（或触发 HMR 刷新）对应 web profile。

不要把 Harness 官方安装和手工修改 profile `cordis.patch.yml` 混用，否则会重复加载相同 bundle 层。

只读诊断：

```sh
npm run diagnose:dsh
```

卸载：

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-plugin-image-mind
```

## 兼容性

| 插件版本 | vision 版本 | 已验证 DSH | 状态 |
|---|---|---|---|
| 0.1.1 | 0.1.0 | DSH CLI/runtime 0.1.0-rc.7 | KNOWN_GOOD（发布级） |
| 0.1.0 | 0.1.0 | DSH CLI/runtime 0.1.0-rc.7 | 历史发布 |
| `main` / Unreleased | Unreleased API additions | 以 CI + compatibility lane 为准 | 开发中 |

DSH 仍在开发预览；宿主 `@deepseek-ai/dsh-*` 以 bounded peerDependencies 提供。本插件不承诺未来所有 DSH 版本自动兼容。详见 `docs/compatibility.md`。

## 使用

在对话里：

- 直接拖/粘贴图片发送；图片内容相关回答会被提示先调用 `understand_image`。
- 说「分析 `/path/to/截图.png` 里的表格并转成 CSV」或提供图片 URL。
- 多图比较可一次传入最多 8 张；如果 Provider 的真实 payload 限制更小，413 会自动拆批。
- 要求「重新看」「重新 OCR」「不要用刚才结果」时，工具可使用 `cache: "refresh"` 强制重新分析像素。
- 对隐私/一次性场景可使用 `cache: "no-store"`，绕过短时语义缓存读写。

## 在界面里配置

设置 → 插件 → 插件配置 → **图像理解**。

提供方编辑器支持：目录模板 / 自定义端点、API Key credential ref、模型发现、active provider、协议与输出上限等高级设置。

内置模板包括：Opencode Go、Command Code Goat、阿里云百炼 DashScope、智谱 BigModel、Moonshot Kimi、火山方舟豆包、腾讯混元、Google Gemini、OpenAI、SiliconFlow、OpenRouter、Groq、Mistral、Together、Fireworks、NVIDIA NIM、DeepInfra、Hyperbolic、MiniMax、xAI Grok、百度千帆、本地 Ollama、本地 LM Studio。

模板只是配置起点，不是永久兼容保证；自定义 OpenAI-compatible 端点始终可以配置。

**状态灯是真实视觉验证**：绿色只表示当前 connection fingerprint 最近一次视觉 challenge 真正通过，不是“有 Key 就绿”。测试连接会发送内置小图并验证模型确实看到了颜色。

**密钥安全**：API Key 通过官方 `credentials.set` 保存；settings 只保存引用名。legacy inline key 启动时会尽力迁移，失败则保留 host-only fallback，不丢配置。

## 代码结构

```text
packages/vision/
  src/runtime.ts              VisionRuntime / registry / provider selection
  src/adapter.ts              provider-neutral VisionAdapter
  src/types.ts                VisionRequest / cache mode / result / model metadata

packages/image-mind/
  src/index.ts                composition root / settings / registration
  src/tools/understand-image.ts
  src/runtime/vision-planner.ts
  src/runtime/execution-gate.ts
  src/adapters/openai-compatible/
    adapter.ts                retry / cache / fallback / 413 split / gate
    parse.ts                  wire builder + tolerant response parsing
    discovery.ts              endpoint discovery + known-plan candidates
  src/media/                  load / validation / network policy
  src/cache/                  short-lived semantic cache
  src/attachments/            attach/raw/RPC routes + process registry
  src/client/                 settings UI / send hook / preview / upload

tests/                       cross-package composition / package boundaries
```

### 分层职责

- `understand_image` 保持薄：只加载 media、验证参数、调用 `ctx.vision.call(request)`；不读取 baseURL/API Key/protocol/retry 等 Provider 事实。
- `VisionRuntime` 只做 provider selection 与 adapter dispatch，不知道任何厂商、endpoint、credential 或 OpenAI wire。
- Adapter 每次调用解析并 deep-freeze 当前 provider snapshot；在途请求不观察设置变化，下次调用重新解析。
- Planner / retry / cache / fallback / payload adaptation / parsing 全属于 Provider Adapter 一侧，不污染 Core seam。
- settings 采用 last-good：运行时坏配置不会把现有可用连接瞬间打坏，修复后自动切回新快照。

## 开发

```sh
npm install
npm run typecheck
npm test
npm run build
npm run test:package
npm run test:built
```

默认测试离线、无密钥、确定性。真实视觉端点验证：

```sh
RUN_VISION_E2E=1 npm exec --workspace packages/image-mind -- vitest run tests/e2e-real.test.ts
```

DSH profile 联调辅助：

```sh
node packages/image-mind/scripts/devhelpers/link-sdk.mjs
node packages/image-mind/scripts/devhelpers/link-sdk.mjs --remove
```

## 项目范围

**IN SCOPE**：图片附件、图片 URL/路径、视觉提供方、OCR/图像理解、DeepSeek 工具集成、多图比较、视觉调用可靠性与质量编排。

**OUT OF SCOPE**：替换主模型、视频、音频、PDF 原生解析、训练视觉模型。

## 许可

MIT License。本插件与 DeepSeek 官方无隶属关系；架构设计参考 DeepSeek Harness 的 capability/provider 模式。
