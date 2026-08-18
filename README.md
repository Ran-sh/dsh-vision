# dsh-vision — 给 DeepSeek Harness 增加图像理解能力

> This is an **independent community plugin** for DeepSeek Harness and is **not an official DeepSeek package**.
> 本项目是独立第三方插件，与 DeepSeek 官方无隶属关系；架构设计参考 DeepSeek Harness 的 capability/provider 模式。

Vision for text-only DSH agents: the `understand_image` tool reads any image via an OpenAI-compatible vision endpoint.

给 DeepSeek Harness（DSH）Web UI 用的图像理解工具。纯文本模型（如 DeepSeek V4）天生看不懂图片，本插件注册一个 **`understand_image`** 工具：模型调用它时，插件在后台把图片（本地路径 / http(s) URL / 对话里的附件引用）发给一个 OpenAI 兼容的视觉模型（Qwen-VL、GLM-4V、GPT-4o、本地 Ollama……），**只把视觉模型返回的文字带回对话**——图片字节永远不会进入会话日志。

> **定位**：dsh-vision **不把视觉模型替换成主模型**，而是作为 DeepSeek 的视觉感知后端。视觉模型永远不会出现在主模型选择器里，`understand_image` 只是 DeepSeek 调用视觉端点的工具通道。

## 架构（Service + Provider Plugin，官方同构）

本仓库是一个 npm workspace，包含两个真正独立的包，严格遵循 DeepSeek Harness 官方「Service Definition / Provider Plugin」ownership 原则（与 `@deepseek-ai/dsh-llm` + `@deepseek-ai/dsh-llm-deepseek`、`@deepseek-ai/dsh-web` + `@deepseek-ai/dsh-web-search-exa` 完全同构）：

```
@ran-sh/dsh-vision          ← Service 包（packages/vision）
       │
       │ owns
       ▼
    ctx.vision               ← VisionRuntime 服务（唯一 owner）
       ▲
       │ inject ['vision']
       │
dsh-plugin-image-mind        ← Provider 插件（packages/image-mind）
       │
       ├── Provider          registerAdapter / registerConfigurableProviders（注册进 ctx.vision）
       ├── Adapter           OpenAICompatibleVisionAdapter（chat-completions / responses）
       ├── Credentials       凭证缝解析（provider 侧）
       └── understand_image  薄工具（只调 ctx.vision.call(request)）
```

官方类比：

```
@deepseek-ai/dsh-llm                 @ran-sh/dsh-vision
       ↑ owns ctx.llm                      ↑ owns ctx.vision
@deepseek-ai/dsh-llm-deepseek        dsh-plugin-image-mind
       └── inject ['llm']                 └── inject ['vision']

@deepseek-ai/dsh-web                  @ran-sh/dsh-vision
       ↑ owns ctx.web                      ↑ owns ctx.vision
@deepseek-ai/dsh-web-search-exa       dsh-plugin-image-mind
       └── inject ['web']                 └── inject ['vision']
```

调用链：

```
DeepSeek V4
      │
      │ tool call
      ▼
understand_image          ← 薄工具（只加载图片 + 调 ctx.vision.call({provider, model, prompt, images, signal})）
      │
      ▼
ctx.vision                ← @ran-sh/dsh-vision 拥有的服务
      │
      ├── Provider Registry    （image-mind 注册的路由，原子热替换，含 replace([])）
      ├── Default Provider     （image-mind 注册的 active 解析策略，单 owner + 完整生命周期，卸载自动撤销）
      └── Adapter 分发          （provider → adapter，只此一条 dispatch 依据）
      │
      ▼
Vision API                ← 真实视觉端点（Opencode Go / Command Code Goat / ...）
```

**ownership 边界**：

| 内容 | owner |
|---|---|
| `ctx.vision` / VisionRuntime / VisionAdapter / VisionError / 注册表 / 目录 / discoverModels / probe | `@ran-sh/dsh-vision`（provider-neutral，不知任何厂商） |
| Provider Catalog（23 个端点）/ OpenAICompatibleVisionAdapter / credentials / migrate / settings / last-good / media / cache / attachments / tools / client | `dsh-plugin-image-mind`（Provider 插件） |

**image-mind 不再自己创建 VisionRuntime**——它 `inject ['vision']`，通过 `ctx.vision.registerAdapter(...)` 与 `ctx.vision.registerConfigurableProviders(...)` 注册进注入的服务。Service 生命周期与 Provider 生命周期完全独立：卸载 image-mind 只撤销它的路由，`ctx.vision` 继续存活。

插件 id `image-mind`、工具名 `understand_image`、路由前缀 `/image-mind`，实现与文档均为自行编写。

## 功能

| 能力 | 说明 |
| --- | --- |
| 三种图片输入 | 本地绝对路径、http(s) URL（拒绝重定向）、或对话中 `![图片](/image-mind/raw/sha256:…)` 引用里的附件 id |
| 直接发图 | 在文本框里拖入/粘贴图片，发送时被改写成语义引用（`![图片](/image-mind/raw/sha256:…)`），模型通过工具分析它 |
| 自定义指令 | `prompt` 参数携带精确指示（OCR、读图表、找 UI 问题、翻译）；不传时用 `defaultPrompt` |
| 在线设置卡片 | 设置 → 插件 → 插件配置 → 图像理解：端点/模型/密钥引用/默认指令/上限都能改，立即生效不用重启 |
| 测试连接 | 卡片底部「测试连接」按钮：以当前填写的值（含未保存草稿）从宿主真的调一次视觉端点，立即反馈通不通与原因（密钥/端点/模型错误各带提示） |
| 两种协议 | `apiStyle: chat-completions`（默认，`/chat/completions`）或 `responses`（OpenAI Responses API），由 adapter 内部分发 |
| 图片预览 | 对话里的引用自动渲染成缩略图，点击看大图（可在设置卡片里关掉） |
| 瞬时错误自动重试 | 网络失败 / 超时 / HTTP 429 / 5xx 自动重试（指数退避 + 抖动）；认证与请求格式错误（4xx）不重试并附带修复提示 |
| 多图场景 | `images[]` 一次调用（最多 4 张），保持输入顺序；单图 `image` 兼容 |
| 密钥解析 | 凭证缝 `apiKeyEnv`（默认 `VISION_API_KEY`）存在时由它全权负责；无凭证缝时才用启动环境变量；本地端点 keyless。卡片以「已配置」形式显示，真实值永不出进程 |
| 安全 | 所有请求拒绝重定向；`maxBytes`/`maxOutputTokens`/`timeoutMs` 上限；魔数类型校验；私有网络 URL 默认拒绝（`allowPrivateNetwork` 可开）；错误摘录限 200 字符；密钥不落日志、不外传浏览器 |

## 架构

```
dsh-vision/                        ← npm workspace 根
├── package.json                   workspace 根（统一 typecheck/test/build 入口）
├── packages/
│   ├── vision/                    ← Service 包：@ran-sh/dsh-vision
│   │   ├── src/
│   │   │   ├── index.ts           barrel + default export VisionRuntime（Cordis service class）
│   │   │   ├── runtime.ts         VisionRuntime：registerAdapter(providers, adapter) / registerConfigurableProviders / registerDefaultProviderResolver(owner, resolver) / call(request) 单参 / discoverModels / probe / replace([]) / vision/adapters-updated
│   │   │   ├── adapter.ts         abstract VisionAdapter（call(provider, request) + discoverModels + probe，adapter 自持全部 provider 事实）
│   │   │   ├── types.ts           VisionRequest / VisionResult / VisionModel / VisionProviderDescriptor / LoadedImage
│   │   │   ├── errors.ts          VisionError extends HarnessError + 稳定错误码 + deepFreeze
│   │   │   └── tests/             provider-neutral 测试（注册/替换/dispose/目录/选择/默认策略生命周期/事件/多 adapter 分发）
│   │   └── tests/                 provider-neutral 测试（注册/替换/dispose/目录/选择/事件/冻结）
│   │
│   └── image-mind/                ← Provider 插件：dsh-plugin-image-mind
│       ├── src/
│   │   │   ├── index.ts           组合根：inject ['vision','tools']，ctx.vision.registerAdapter / registerConfigurableProviders / registerDefaultProviderResolver，装 settings / 注册工具 / 挂路由；last-good 配置
│       │   ├── config.ts          Config schema（schemastery）+ resolveVisionConfig()
│   │   │   ├── runtime/vision-rpc.ts   薄 Host RPC（测试连接 / 模型列表，draft 快照直接走 adapter，不进 Core）
│       │   ├── providers/         catalog.ts 内置提供方模板（纯数据，23 条）
│   │   │   ├── adapters/openai-compatible/  OpenAICompatibleVisionAdapter（自持 options/credential 解析 + chat-completions / responses / discovery / retry）
│       │   ├── credentials/       resolve.ts（凭证缝解析）+ migrate.ts（legacy inline key 迁移）
│       │   ├── media/             图片加载（路径/URL/附件引用 + 私有网络策略）+ 魔数校验
│       │   ├── cache/             短时语义缓存
│       │   ├── tools/             understand-image.ts 薄工具（只调 ctx.vision.call(request)）
│       │   ├── attachments/       /image-mind 路由（attach / raw / 薄 RPC）+ legacy-config 兼容层
│       │   └── client/            浏览器入口 + 设置卡片 + 发送改写钩子 / 缩略图 / 上传 / 文案
│       └── tests/                 config / last-good / credential / migration / adapter / discovery / retry / media / cache / attachments / settings / tool / integration / e2e
│
└── tests/
    ├── composition.test.ts        cross-package 集成（Loader 加载双包：A-E 生命周期场景）
    └── boundary.test.ts           包边界（依赖方向只能 image-mind → vision）
```

### 分层职责

- **`understand_image` 是薄工具**：只负责加载图片（media 层）和把请求交给 `ctx.vision.call(request)`——一个参数，只表达「哪个 provider/model、对这个 prompt、这些图片」。它不 import `ResolvedProvider` / `ResolvedConfig`，不构造 `VisionConnection`，不接触 baseURL、API Key、协议、超时、模型发现或重试策略。
- **VisionRuntime 是独立服务（`ctx.vision`）**：不注册进 `ctx.llm`。视觉模型是 DeepSeek 的感知后端，不是主会话模型。每次调用由 Runtime 完成 provider selection → route lookup → adapter dispatch；连接快照（endpoint/credential/协议）由 Adapter 在调用时自行解析并深度冻结，Runtime 永远看不到。注册与路由替换是原子的（`registerAdapter` 返回 handle，`replace()` 含 `replace([])` 原子撤销；`REGISTRATION_DISPOSED` 后拒绝再 replace）。
- **Adapter 自持 provider 事实**：`registerAdapter(providers, adapter)` 只关联 provider 路由与 adapter 实例（官方 LlmRuntime 两参形状）。OpenAICompatibleVisionAdapter 在构造时接收 `resolveProviderOptions` / `resolveApiKey` 钩子，每次调用从 last-good 配置解析并**深度冻结**一个不可变端点快照（baseURL/model/apiStyle/maxOutputTokens/timeoutMs/apiKeyEnv 同一 generation）——在途请求不受设置修改影响，下次调用重新解析。Core 永远看不到这些字段。
- **last-good 配置**：静态启动配置错误 fail loud；运行期间新设置超出 schema 的进一步校验失败时，记录错误并保留上一个 good 快照，配置恢复正确后自动切换（官方 llm-deepseek 模式）。
- **Provider Catalog 与 Adapter 分离**：`providers/catalog.ts` 只描述厂商；目录注册（`registerConfigurableProviders`）与路由注册（`registerAdapter`）分开——目录回答「可以配置哪些」，注册表回答「当前哪些可调用」。每次提交发布 `vision/adapters-updated` 事件（listener 失败被包含，不 veto 提交）。
- **Credentials 走官方 seam**：卡片键入的 API Key 通过 `credentials.set` 存入 DSH 凭据存储，settings.yaml 只保存 `apiKeyEnv` 引用。解析顺序与官方一致：**凭证缝存在时由它全权负责**（miss 即 miss，不回退环境变量）；没有凭证缝时才用 launch environment。legacy inline `apiKey` 在启动时自动迁移到凭证存储并清空配置（失败则保留 host-only fallback，绝不丢配置）。
- **Settings 走官方 wire**：卡片通过 `connection.api.settings.describe/mutate` 读写 `image-mind` 命名空间（官方 settings seam 对第三方命名空间开放）；`/image-mind/config` 网关保留为**兼容层**，仅在没有官方通道的旧客户端下兜底。**TODO（移除条件）**：当最低支持的 DSH 版本全部具备官方 settings wire 后，可删除 legacy transport。


## 安装（独立第三方插件）

要求：DeepSeek Harness 已安装（检测 `%USERPROFILE%\.dsh`，可用 `DSH_HOME` 覆盖），Node.js 22+。

```sh
git clone <your-fork-or-release-url> dsh-vision
cd dsh-vision
npm install
npm run build              # 生成插件产物（install:dsh 会检查，缺失则提示）
npm run install:dsh        # 链接两个包 + 写入 profile 的 cordis.patch.yml（幂等）
```

然后重启 web profile（或触发其 HMR 刷新）。

`install:dsh` 做什么（可重复执行，不会重复插入）：

1. 在 `<DSH_HOME>/profiles/node_modules` 下链接本项目两个包（Windows 用 junction，免管理员权限；POSIX 用 symlink）；
2. 在 profile 的 `cordis.patch.yml` 里插入两行（`vision-runtime` + `image-mind`），插入前自动备份原文件；
3. 绝不触碰：你的 `settings.yaml`（提供方/密钥配置）、凭据存储、其他插件。

卸载：

```sh
npm run uninstall:dsh                     # 移除链接与补丁行，保留设置
npm run uninstall:dsh -- --purge-settings # 同时删除 settings.yaml 的 image-mind 节（先备份）
```

## URL 安全说明

图片 URL 抓取有 SSRF 防护，但**不是网络沙箱**：

- 显式私网地址（IPv4/IPv6/IPv4-mapped）默认拒绝，`allowPrivateNetwork` 显式开启才放行；
- 主机名会做 DNS 预解析，任一 A/AAAA 落在私网即拒绝；
- redirect 始终拒绝；URL 内嵌凭据拒绝；错误信息剥离 query 参数，避免 token 泄露；
- 无法 pin 连接到预解析地址，因此对 DNS rebinding 只能做到预解析层防御，不能提供沙箱级绝对保证。

## 使用

在对话里：

- 直接拖一张图片到输入框发送 → 自动变成引用，模型会用 `understand_image` 分析；
- 或者直接说「分析 `/path/to/截图.png` 里的表格并转成 CSV」——模型自己会去调用工具；
- 或者粘贴一个图片 URL 让模型分析；
- 多图比较（改前改后、两张截图）：把多张图一起发给模型，一次 `images` 数组调用（最多 4 张）。

## 在界面里配置

设置 → 插件 → 插件配置 → **图像理解**卡片。卡片布局与内置「模型」页一致：顶部「+ 添加提供方」（从内置提供方模板选择，自动填端点/默认模型/密钥环境变量名）与「+ 添加自定义提供方」（空白卡片），下面是提供方行列表（名称 + 状态灯 + 编辑/删除/设为默认），点「编辑」一次打开一个提供方编辑器。

「+ 添加提供方」目录内置以下提供方模板：Opencode Go、Command Code Goat、阿里云百炼 DashScope、智谱 BigModel、Moonshot Kimi、火山方舟豆包、腾讯混元、Google Gemini、OpenAI、硅基流动 SiliconFlow、OpenRouter、Groq、Mistral AI、Together AI、Fireworks AI、NVIDIA NIM、DeepInfra、Hyperbolic、MiniMax、xAI Grok、百度千帆 ERNIE、本地 Ollama、本地 LM Studio。本地端点无需 API Key（自动按 keyless 处理）。这些只是配置模板，不是保证兼容清单；自定义端点始终可用。

**填 Key 即出模型**：从目录添加提供方后，编辑器会打开；在「API Key」里粘贴密钥（或端点本身 keyless）后，模型列表会自动从该端点的 `/models` 拉取并填进下拉。模型发现由 Host 完成，浏览器不直接拿 Key 请求 Provider。默认只显示 API Key 与模型两个字段；端点、协议、输出上限等折叠在「高级设置」里。

**状态灯是真实的**：灰 = 未配置；中性 = 已配置未测试；绿 = 最近一次视觉测试通过（同一连接指纹）；红 = 测试失败或密钥缺失。密钥存在只证明「已配置」，不证明「已连接」——只有真正通过视觉测试（发送内置纯色图片并验证模型答对颜色）才显示绿色。「测试连接」不是只查 `/models`。默认提供方由 `active` 决定；`understand_image` 也可用 `provider` 参数临时指定。

**密钥安全**：键入的 API Key 通过官方 `credentials.set` 存入 DSH 凭据存储，`settings.yaml` 只保存引用名；界面始终以掩码显示，浏览器永远拿不到明文。旧版文档里的 legacy inline `apiKey` 会在启动时自动迁移到凭据存储（失败则保留 host-only fallback，绝不丢配置）。

## 开发

```sh
npm install
npm run typecheck
npm test
npm run build
```

全部离线、无密钥、确定性。真实端点验证单独跑：

```sh
RUN_VISION_E2E=1 npx vitest run --config packages/image-mind/vitest.config.ts tests/e2e-real.test.ts
```

需要 DSH 运行时联调时（在真实 profile 里跑）：

```sh
node packages/image-mind/scripts/devhelpers/link-sdk.mjs     # 补齐 profile-only SDK 包
node packages/image-mind/scripts/devhelpers/link-sdk.mjs --remove
```

SDK 依赖是普通 registry 依赖（与 DSH profile 版本精确对齐），`npm install` 不会触碰 DSH 的 SDK 树。

## 项目范围

**IN SCOPE**：图片附件、图片 URL/路径、视觉提供方、OCR/图像理解、DeepSeek 工具集成、多图比较。

**OUT OF SCOPE**：替换主模型、视频、音频、PDF 原生解析、训练视觉模型。

## 源代码结构与许可

```
packages/vision       @ran-sh/dsh-vision        Service Definition（ctx.vision）
packages/image-mind   dsh-plugin-image-mind     Provider + Tool + UI
scripts/              install:dsh / uninstall:dsh
docs/                 architecture.md、provider-development.md、release-checklist.md
```

MIT License。本插件与 DeepSeek 官方无隶属关系；架构设计参考 DeepSeek Harness 的 capability/provider 模式。
