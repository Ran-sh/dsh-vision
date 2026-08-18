# dsh-vision — 图像理解插件（dsh 前缀）

> Vision for text-only DSH agents: the `understand_image` tool reads any image via an OpenAI-compatible vision endpoint.

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
      ├── Connection Resolver  （每调用解析不可变快照，baseURL/model/密钥引用/协议/超时同代）
      └── Adapter 分发          （image-mind 注册的 OpenAICompatibleVisionAdapter）
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
| 多图场景 | 工具按模型需要一次调用一张图；Runtime 请求结构已允许 `images[]`，未来可平滑支持多图 |
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
│   │   │   ├── runtime.ts         VisionRuntime：registerAdapter / registerConfigurableProviders / call(request) 单参 / discoverModels / probe / replace([]) / vision/adapters-updated
│   │   │   ├── adapter.ts         abstract VisionAdapter（call + discoverModels，connection 深度冻结）
│   │   │   ├── types.ts           VisionRequest / VisionResult / VisionConnection / VisionModel / LoadedImage / VisionApiStyle
│   │   │   ├── errors.ts          VisionError + 稳定错误码
│   │   │   └── deep-freeze.ts     运行时快照深度冻结
│   │   └── tests/                 provider-neutral 测试（注册/替换/dispose/目录/选择/事件/冻结）
│   │
│   └── image-mind/                ← Provider 插件：dsh-plugin-image-mind
│       ├── src/
│       │   ├── index.ts           组合根：inject ['vision','tools']，ctx.vision.registerAdapter / registerConfigurableProviders / setDefaultProviderResolver，装 settings / 注册工具 / 挂路由；last-good 配置
│       │   ├── config.ts          Config schema（schemastery）+ resolveVisionConfig()
│       │   ├── runtime/vision-rpc.ts   薄 Host RPC（测试连接 / 模型列表，走 ctx.vision.probe）
│       │   ├── providers/         catalog.ts 官方视觉端点目录（纯数据，23 条）
│       │   ├── adapters/openai-compatible/  OpenAICompatibleVisionAdapter（chat-completions / responses / discovery / retry）
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
- **VisionRuntime 是独立服务（`ctx.vision`）**：不注册进 `ctx.llm`。视觉模型是 DeepSeek 的感知后端，不是主会话模型。每次调用由 Runtime 完成：provider selection → route lookup → connection snapshot → adapter.call。注册与路由替换是原子的（`registerAdapter` 返回 handle，`replace()` 含 `replace([])` 原子撤销；`REGISTRATION_DISPOSED` 后拒绝再 replace）。
- **Connection Resolver 属于注册**：`registerAdapter(providers, adapter, resolveConnection)` 把「每个 provider 的连接事实」关联到路由——调用者不再传 connection。Resolver 每次调用从配置解析一个**深度冻结**的不可变快照（baseURL/model/apiStyle/maxOutputTokens/timeoutMs/apiKeyEnv 同一 generation），在途请求不受设置修改影响。
- **last-good 配置**：静态启动配置错误 fail loud；运行期间新设置超出 schema 的进一步校验失败时，记录错误并保留上一个 good 快照，配置恢复正确后自动切换（官方 llm-deepseek 模式）。
- **Provider Catalog 与 Adapter 分离**：`providers/catalog.ts` 只描述厂商；目录注册（`registerConfigurableProviders`）与路由注册（`registerAdapter`）分开——目录回答「可以配置哪些」，注册表回答「当前哪些可调用」。每次提交发布 `vision/adapters-updated` 事件（listener 失败被包含，不 veto 提交）。
- **Credentials 走官方 seam**：卡片键入的 API Key 通过 `credentials.set` 存入 DSH 凭据存储，settings.yaml 只保存 `apiKeyEnv` 引用。解析顺序与官方一致：**凭证缝存在时由它全权负责**（miss 即 miss，不回退环境变量）；没有凭证缝时才用 launch environment。legacy inline `apiKey` 在启动时自动迁移到凭证存储并清空配置（失败则保留 host-only fallback，绝不丢配置）。
- **Settings 走官方 wire**：卡片通过 `connection.api.settings.describe/mutate` 读写 `image-mind` 命名空间（官方 settings seam 对第三方命名空间开放）；`/image-mind/config` 网关保留为**兼容层**，仅在没有官方通道的旧客户端下兜底。**TODO（移除条件）**：当最低支持的 DSH 版本全部具备官方 settings wire 后，可删除 legacy transport。


## 已安装

- **项目**：`<PROJECT_DIR>`（本仓库克隆/解压位置，例如 `D:\path\to\dsh-vision`）
- **挂载**：junction `%USERPROFILE%\.dsh\profiles\node_modules\dsh-plugin-image-mind` → `<PROJECT_DIR>\packages\image-mind`；`%USERPROFILE%\.dsh\profiles\node_modules\@ran-sh\dsh-vision` → `<PROJECT_DIR>\packages\vision`
- **配置**：`%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml` 里插入了**两行**：`vision-runtime`（`@ran-sh/dsh-vision` 服务 entry）+ `image-mind`（`dsh-plugin-image-mind` provider entry）；`~/.dsh/settings.yaml` 里加了 `image-mind` 节（多视觉提供方：opencode-go / commandcode-goat，各自端点/模型/密钥缝）。两行的加载顺序由 `inject ['vision']` 自动保证，无需手工排序。

当前配置（settings.yaml）：

```yaml
image-mind:
  providers:
    opencode-go:
      baseURL: https://opencode.ai/zen/go/v1
      model: mimo-v2.5
      apiKeyEnv: OPENCODE_GO_API_KEY
      apiStyle: chat-completions
    commandcode-goat:
      baseURL: https://api.commandcode.ai/provider/v1
      model: xiaomi/mimo-v2.5
      apiKeyEnv: COMMANDCODE_API_KEY
      apiStyle: chat-completions
  active: opencode-go
  renderImagePreview: true
```

密钥从 DSH 的凭据存储（`~/.dsh/.credentials.yaml`）解析，不在任何配置里明文保存。

> **⚠️ legacy inline `apiKey`（已废弃，自动迁移）**：旧版文档可能写有 `providers.<id>.apiKey`。插件启动时会把这些值安全迁移到 DSH 凭据存储（目标引用为 `apiKeyEnv` 或由 provider id 派生的 `<ID>_API_KEY`），成功后自动从 settings 文档清除 inline 字段；迁移失败（如无凭证缝或只读层）则保留 inline 字段作为 **host-only fallback**——密钥只在宿主进程内解析，绝不发给浏览器，也绝不让你的配置丢失。UI 不再创建新的 inline key。手动迁移路径：在设置卡片里把密钥粘贴到「API Key」输入框（会写入凭据存储）并把「API Key 环境变量名」填为目标引用，保存后删除 `settings.yaml` 里的 `apiKey` 行。

## 使用

在对话里：

- 直接拖一张图片到输入框发送 → 自动变成引用，模型会用 `understand_image` 分析；
- 或者直接说「分析 `/path/to/截图.png` 里的表格并转成 CSV」——模型自己会去调用工具；
- 或者粘贴一个图片 URL 让模型分析。

## 在界面里配置

设置 → 插件 → 插件配置 → **图像理解**卡片。卡片布局与内置「模型」页一致：顶部「+ 添加提供方」（从官方视觉端点目录选择，自动填端点/默认模型/密钥环境变量名）与「+ 添加自定义提供方」（空白卡片），下面是提供方行列表（名称 + 状态灯 + 编辑/删除/设为默认），点「编辑」一次打开一个提供方编辑器（端点/模型/密钥/协议/输出上限）。

「+ 添加提供方」目录内置以下官方视觉端点：Opencode Go、Command Code Goat、阿里云百炼 DashScope、智谱 BigModel、Moonshot Kimi、火山方舟豆包、腾讯混元、Google Gemini、OpenAI、硅基流动 SiliconFlow、OpenRouter、Groq、Mistral AI、Together AI、Fireworks AI、NVIDIA NIM、DeepInfra、Hyperbolic、MiniMax、xAI Grok、百度千帆 ERNIE、本地 Ollama、本地 LM Studio。本地端点无需 API Key（自动按 keyless 处理）。

**填 Key 即出模型**：从目录添加提供方后，编辑器会打开；在「API Key」里粘贴密钥（或端点本身 keyless）后，模型列表会自动从该端点的 `/models` 拉取并填进下拉——大多数情况下你只需要填 API Key，然后从列表里挑一个视觉模型即可。模型发现由 Host 完成（`ctx.vision.discoverModels`），浏览器不直接拿 Key 请求 Provider。

**状态灯是真实的**：绿 = 配置完整且密钥确实可解析（凭据存储或环境变量）；红 = 未配置密钥或配置不完整；黄闪 = 测试连接中；测试失败转红并显示原因。没有密钥的提供方永远不会显示「已连接」。默认使用的提供方由 `active` 决定；`understand_image` 也可用 `provider` 参数临时指定某一提供方。

**设置存储**：卡片通过官方设置通道读写 `image-mind` 命名空间（`settings.describe` / `settings.mutate`，机密字段在传输层自动脱敏），键入的 API Key 通过 `credentials.set` 存入凭据存储。旧的自有 `/image-mind/config` 网关保留为兼容层。

## 开发

```sh
cd <PROJECT_DIR>
npm install          # workspace：esbuild/typescript/react/vitest；SDK 类型来自 node_modules/@deepseek-ai junction（DSH profile 树）
npm run typecheck    # workspace 统一：两个包的 tsc 检查（vision host + image-mind host/client）
npm test             # workspace 统一：vision 单测 + image-mind 单测 + cross-package composition/boundary（无需网络）
npm run build        # workspace 统一：vision lib/index.js + image-mind lib/index.js + lib/client.js
cd packages/image-mind
RUN_VISION_E2E=1 npx vitest run tests/e2e-real.test.ts   # 真实视觉端点 e2e（读 ~/.dsh/.credentials.yaml，不打印 key）
```

> **⚠️ npm 安全注意事项**：本插件运行时要在项目 `node_modules` 里有一个指向 DSH profile SDK 树的 junction（`node_modules/@deepseek-ai`）。在改动依赖前**先执行 `npm run unlink-sdk`**（在 `packages/image-mind` 下），装完再 `npm run link-sdk`——否则 `npm install` 的 prune 会顺着 junction 把 DSH 的 SDK 树清空（这是此前的真实事故，恢复方法见下）。
>
> SDK 类型解析走项目内 `node_modules/@deepseek-ai` junction；本仓库不含任何机器特定绝对路径（tsconfig / vitest 均相对解析）。

### 若 SDK 树被清空（恢复）

DSH 的 `profiles\node_modules` 本来就是由 CLI 启动时自动修复的符号链接层（指向 npx 缓存里的应用闭包）。恢复步骤：

```sh
# 1. 删除非链接的残留
rm -rf "$HOME/.dsh/profiles/node_modules/@deepseek-ai"
# 2. 让 dsh CLI 重新生成所有 junction
npx --yes @deepseek-ai/dsh --profile web --dump-config > /dev/null
# 3. 补回不在应用闭包里的运行时依赖（如 schemastery，来自项目真实安装）
mkdir -p "$HOME/.dsh/profiles/node_modules/schemastery"
cp -r <项目>/node_modules/schemastery/. "$HOME/.dsh/profiles/node_modules/schemastery/"
```

## 卸载

```sh
# 1. 从 profile patch 里删掉 image-mind 段与 vision-runtime 段（两行 insert）
# 2. 删两个 junction
rmdir %USERPROFILE%\.dsh\profiles\node_modules\dsh-plugin-image-mind
rmdir %USERPROFILE%\.dsh\profiles\node_modules\@ran-sh\dsh-vision
# 3. 重启 DSH web
```

## 源代码结构和许可

架构见上文「架构」一节。代码全部为自行编写，两个包均按 MIT 许可开源。
