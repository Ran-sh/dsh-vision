# dsh-vision

DeepSeek Harness（DSH）的社区视觉插件，与 DeepSeek 官方无隶属关系。

安装后，文本模型可以通过 `understand_image` 工具分析截图、照片和多张图片。图片保存在 DSH 的附件系统中，凭据由 DSH 管理。

## 安装

需要已安装 `@deepseek-ai/dsh@0.1.2-rc.1`。`web` 是默认浏览器配置；使用其他 profile 时替换命令中的名称。

```sh
npx dsh-plugin-image-mind@latest install --profile web
```

安装完成后，在 Web UI 的 **设置 → 插件 → 图像理解** 中配置视觉服务商。

常用命令：

```sh
npx dsh-plugin-image-mind@latest status --profile web
npx dsh-plugin-image-mind@latest update --profile web
npx dsh-plugin-image-mind@latest uninstall --profile web
```

> 请使用 `dsh-plugin-image-mind@0.3.0` 或更高版本。

## 功能

- 支持本地图片、HTTP(S) 图片和 DSH 附件
- 一次最多分析 8 张图片
- 支持截图、照片、OCR 和多图比较
- 提供缓存、重试、超时与图片大小限制
- 默认阻止本地网络图片地址，降低 SSRF 风险

## 项目结构

- `@ran-sh/dsh-vision`：与服务商无关的视觉运行时
- `dsh-plugin-image-mind`：DSH 插件、工具、设置界面和服务商适配

## 开发

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run test:package
npm run test:built
```

更多信息：

- [架构](docs/architecture.md)
- [兼容性](docs/compatibility.md)
- [服务商开发](docs/provider-development.md)
- [发布检查](docs/release-checklist.md)

## License

MIT
