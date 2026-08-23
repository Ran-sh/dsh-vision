# dsh-vision

Independent community plugin for DeepSeek Harness (DSH); not an official DeepSeek package.
本项目与 DeepSeek 官方无隶属关系。

`dsh-plugin-image-mind` gives a text-only DSH agent an `understand_image` tool.
Images stay in the host attachment store; only a neutral attachment marker appears
in the conversation, and a visual provider returns evidence to the main model.

## Architecture

Two npm packages:

- `@ran-sh/dsh-vision` — provider-neutral service (`ctx.vision`): runtime, adapters,
  request/results, cache and lifecycle. Knows no endpoints, keys or vendors.
- `dsh-plugin-image-mind` — provider + tool + UI built on the service: settings,
  credentials, media/SSRF policy, reliability, attachments and the `understand_image` tool.

See [docs/architecture.md](docs/architecture.md).

## Current behavior

- Accepts local absolute paths, `http(s)` URLs and DSH attachment references.
- `images[]` accepts at most **8 images**, preserves order, bounded concurrency and combined byte limit.
- PNG screenshots/documents: lossless aspect/pixel-aware path. JPEG/WebP photos: bounded lossy path.
- `use`/`refresh`/`no-store` semantic cache; a narrow follow-up automatically refocuses with a fresh read.
- Retries are limited to network/timeout/429/5xx; explicit 4xx, model and provider choices are not silently rerouted.
- User-visible messages never contain attachment IDs, hashes, raw URLs, credentials or routing details.
- Security: `http(s)` only, local-network targets rejected unless explicitly enabled (SSRF filtering,
  not a DNS-rebinding guarantee), magic-byte/size/token/timeout bounds. Browser code sees credential
  references, never key material.

## Install and use

DSH owns installation and profile composition. After an authorized npm publication,
install through the official plugin manager:

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-plugin-image-mind@0.2.0
npx @deepseek-ai/dsh plugin --profile web remove dsh-plugin-image-mind
```

The 0.2.0 packages are **not published yet**; the command is the future registry path,
not current availability. For local development, build/pack the workspace and use an
isolated DSH profile — never hand-edit `cordis.patch.yml` or install into a real profile.

In the web UI, configure a provider under 设置 → 插件 → 图像理解; API keys go through the
DSH credential seam. A green status means a recent visual challenge passed.

## Compatibility

Exact `@deepseek-ai/dsh@0.1.1-rc.2` isolated acceptance evidence and the full matrix live
in [docs/compatibility.md](docs/compatibility.md).

## Development

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run test:package
npm run test:built
npm run benchmark:deterministic
```

Benchmark/compare thresholds must not be loosened. Real-provider and DSH browser checks
require explicit credentials/host authorization with an isolated profile. See
[docs/release-checklist.md](docs/release-checklist.md), [docs/verification-debt.md](docs/verification-debt.md)
and [docs/provider-development.md](docs/provider-development.md).

## Scope and license

In scope: image attachments, visual providers, OCR/image understanding, multi-image
comparison, reliability and DSH tool integration. Out of scope: replacing the main
model, video/audio/PDF-native parsing and model training.

MIT License.