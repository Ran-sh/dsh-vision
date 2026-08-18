# dsh-vision — 图像理解插件（dsh 前缀）

> Vision for text-only DSH agents: the `understand_image` tool reads any image via an OpenAI-compatible vision endpoint.

给 DeepSeek Harness（DSH）Web UI 用的图像理解工具。纯文本模型（如 DeepSeek V4）天生看不懂图片，本插件注册一个 **`understand_image`** 工具：模型调用它时，插件在后台把图片（本地路径 / http(s) URL / 对话里的附件引用）发给一个 OpenAI 兼容的视觉模型（Qwen-VL、GLM-4V、GPT-4o、本地 Ollama……），**只把视觉模型返回的文字带回对话**——图片字节永远不会进入会话日志。

参考 `zhu1090093659/dsh-web-ui` 全家桶里的 `dsh-tool-describe-image`（Apache-2.0）而做，但是自己独立的实现：插件 id `image-mind`、工具名 `understand_image`、路由前缀 `/image-mind`。

## 功能

| 能力 | 说明 |
| --- | --- |
| 三种图片输入 | 本地绝对路径、http(s) URL（拒绝重定向）、或对话中 `![图片](/image-mind/raw/sha256:…)` 引用里的附件 id |
| 直接发图 | 在文本框里拖入/粘贴图片，发送时被改写成语义引用（`![图片](/image-mind/raw/sha256:…)`），模型通过工具分析它 |
| 自定义指令 | `prompt` 参数携带精确指示（OCR、读图表、找 UI 问题、翻译）；不传时用 `defaultPrompt` |
| 在线设置卡片 | 设置 → 插件 → 插件配置 → 图像理解：端点/模型/密钥引用/默认指令/上限都能改，立即生效不用重启 |
| 测试连接 | 卡片底部「测试连接」按钮：以当前填写的值（含未保存草稿）从宿主真的调一次视觉端点，立即反馈通不通与原因（密钥/端点/模型错误各带提示） |
| 两种协议 | `apiStyle: chat-completions`（默认，`/chat/completions`）或 `responses`（OpenAI Responses API） |
| 图片预览 | 对话里的引用自动渲染成缩略图，点击看大图（可在设置卡片里关掉） |
| 瞬时错误自动重试 | 网络失败 / 超时 / HTTP 429 / 5xx 自动重试一次；认证与请求格式错误（4xx）不重试并附带修复提示 |
| 多图场景 | 工具会按模型需要一次调用一张图，向导场景（对比截图、批量读图）由模型各自调用后汇总 |
| 密钥三级解析 | 内联 `apiKey` → 凭证缝 `apiKeyEnv`（默认 `VISION_API_KEY`）→ 启动环境变量；卡片以**与密钥等长**的 `*` 显示已配置 |
| 安全 | 所有请求拒绝重定向；`maxBytes`/`maxOutputTokens`/`timeoutMs` 上限；魔数类型校验；错误摘录限 200 字符；密钥不落日志、不外传浏览器 |

## 已安装

- **项目**：`D:\Users\48376\Desktop\dsh\dsh-plugin-image-mind`
- **挂载**：junction `C:\Users\48376\.dsh\profiles\node_modules\dsh-plugin-image-mind` → 项目目录
- **配置**：`C:\Users\48376\.dsh\profiles\web\cordis.patch.yml` 里插入了 `/image-mind` 一行；`~/.dsh/settings.yaml` 里加了 `image-mind` 节（多视觉提供方：opencode-go / commandcode-goat，各自端点/模型/密钥缝）

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

密钥从 DSH 的凭据存储（`~/.dsh/.credentials.yaml`）解析，不在任何配置里明文保存。若你的环境解析不到，直接在 设置 → 插件配置 → 图像理解 里给对应提供方换成内联 `apiKey` 即可。

## 使用

在对话里：

- 直接拖一张图片到输入框发送 → 自动变成引用，模型会用 `understand_image` 分析；
- 或者直接说「分析 D:\xxx\截图.png 里的表格并转成 CSV」——模型自己会去调用工具；
- 或者粘贴一个图片 URL 让模型分析。

## 在界面里配置

设置 → 插件 → 插件配置 → **图像理解**卡片。卡片布局与内置「模型」页一致：顶部「+ 添加提供方」（从官方视觉端点目录选择，自动填端点/默认模型/密钥环境变量名）与「+ 添加自定义提供方」（空白卡片），下面是提供方行列表（名称 + 状态灯 + 编辑/删除/设为默认），点「编辑」一次打开一个提供方编辑器（端点/模型/密钥/协议/输出上限）。

「+ 添加提供方」目录内置以下官方视觉端点：Opencode Go、Command Code Goat、阿里云百炼 DashScope、智谱 BigModel、Moonshot Kimi、火山方舟豆包、腾讯混元、Google Gemini、OpenAI、硅基流动 SiliconFlow、OpenRouter、Groq、Mistral AI、Together AI、Fireworks AI、NVIDIA NIM、DeepInfra、Hyperbolic、MiniMax、xAI Grok、百度千帆 ERNIE、本地 Ollama、本地 LM Studio。本地端点无需 API Key（自动按 keyless 处理）。

**填 Key 即出模型**：从目录添加提供方后，编辑器会打开；在「API Key」里粘贴密钥（或端点本身 keyless）后，模型列表会自动从该端点的 `/models` 拉取并填进下拉——大多数情况下你只需要填 API Key，然后从列表里挑一个视觉模型即可。列表获取只依赖端点地址 + 密钥，不需要先手动填模型。

**状态灯是真实的**：绿 = 配置完整且密钥确实可解析（内联或凭证缝）；红 = 未配置密钥或配置不完整；黄闪 = 测试连接中；测试失败转红并显示原因。没有密钥的提供方永远不会显示「已连接」。默认使用的提供方由 `active` 决定；`understand_image` 也可用 `provider` 参数临时指定某一提供方。

说明：官方设置通道有一个**硬编码的命名空间白名单**（apiproxy 只放行官方产品命名空间），第三方插件的配置节无法通过它读写，所以本插件的卡片改走**自有的 `/image-mind/config` 网关**——由宿主进程内的 settings provider 直接读写同一个配置节，界面改完效果与改 `settings.yaml` 完全一致，且立即生效。机密字段（API Key）只以「是否已配置」的形式返回浏览器，真实值永不出进程。

## 开发

```sh
cd D:\Users\48376\Desktop\dsh\dsh-plugin-image-mind
npm install          # esbuild/typescript/react；SDK 类型来自 tsconfig paths（DSH profile 树）
npm run typecheck    # tsc 检查 host + client 两侧
npm run build        # esbuild 产出 lib/index.js（node 侧）+ lib/client.js（浏览器侧）
npm run dev:verify   # 真实视觉端点端到端测试（读 ~/.dsh/.credentials.yaml 的密钥）
npm run dev:retry    # 重试策略确定性自测（mock fetch，跑四组场景）
```

> **⚠️ npm 安全注意事项**：本插件运行时要在项目 `node_modules` 里有一个指向 DSH profile SDK 树的 junction（`node_modules/@deepseek-ai`）。在改动依赖前**先执行 `npm run unlink-sdk`**，装完再 `npm run link-sdk`——否则 `npm install` 的 prune 会顺着 junction 把 DSH 的 SDK 树清空（这是此前的真实事故，恢复方法见下）。
>
> SDK 类型解析走 tsconfig `paths`（指向 `C:\Users\48376\.dsh\profiles\node_modules\@deepseek-ai`），所以类型检查不需要 junction；junction 只服务于 dev:verify 和服务器运行时。

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
# 1. 从 profile patch 里删掉 image-mind 段（或整行 insert）
# 2. 删 junction
rmdir C:\Users\48376\.dsh\profiles\node_modules\dsh-plugin-image-mind
# 3. 重启 DSH web
```

## 源代码结构和许可

- `src/index.ts` — 插件入口：`understand_image` 工具 + 设置节 + 路由注册
- `src/config.ts` — 配置 schema（schemastery）+ 校验 + 密钥解析
- `src/media.ts` — 图片类型魔数校验、严格 base64、字节上限
- `src/vision.ts` — 图片加载 + OpenAI 兼容请求构造 + 响应解析 + 短时缓存
- `src/attach.ts` — `/image-mind/attach`（上传）、`/image-mind/raw/<id>`（回显）与 `/image-mind/config`（设置网关）
- `src/client/` — 浏览器侧：发送改写钩子、上传客户端、对话内缩略图、设置卡片（表单 + 卡片 UI + 配置客户端）
- `scripts/e2e-vision.ts` — 真实端点端到端自检

插件按 Apache-2.0 许可；参考实现 `dsh-tool-describe-image`（Apache-2.0，作者 linxin666 / deepseek-ai / whitelonng），本仓库的实现与文档为自行编写。