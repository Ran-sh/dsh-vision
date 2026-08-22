# dsh-vision

> Independent community plugin for DeepSeek Harness (DSH); not an official
> DeepSeek package. 本项目与 DeepSeek 官方无隶属关系。

`dsh-plugin-image-mind` gives a text-only DSH agent an `understand_image` tool.
Images stay in the host attachment store; only a neutral attachment marker is
shown in the conversation. A provider returns visual evidence to the main
model, which remains the conversation model.

## Architecture

This npm workspace contains two packages:

```text
@ran-sh/dsh-vision       provider-neutral Service Definition (ctx.vision)
        ▲
        │ inject ['vision']
dsh-plugin-image-mind     Provider + Tool + UI + OpenAI-compatible adapter
        │
        ▼
     configured visual endpoint
```

The service owns `VisionRuntime`, adapters, provider-neutral requests/results,
directory metadata and lifecycle events. The plugin owns provider settings,
credentials, media/SSRF policy, cache, reliability, attachments, UI and the
thin `understand_image` tool. The service never knows endpoints, API keys,
wire protocols or vendor names; see [docs/architecture.md](docs/architecture.md).

## Current behavior

- Accepts local absolute paths, `http(s)` URLs and DSH attachment references.
- `images[]` accepts at most **8 images**, preserves order, loads with bounded
  concurrency and keeps the combined byte limit.
- PNG screenshots/documents use the aspect- and pixel-aware lossless path;
  JPEG/WebP photos use the bounded lossy path. The old 3072-long-edge rule is
  not the policy.
- `use`, `refresh` and `no-store` semantic cache modes are explicit. Stable
  OCR/UI/code/document/chart/compare evidence can be reused; a narrow follow-up
  automatically refocuses with a fresh `no-store` read instead of guessing.
- Retry is limited to network/timeout/429/5xx; deterministic 4xx and explicit
  provider/model choices are not silently rerouted. Model/provider fallback,
  FIFO backpressure, circuit probes and HTTP-413 recursive splitting are
  bounded and traced.
- User-visible messages never contain attachment IDs, hashes, raw URLs,
  bytes, credentials or routing instructions. Lifecycle/diagnostic telemetry
  is metadata-only and redacted.

## Security boundaries

Only `http(s)` URLs are accepted; redirects, embedded URL credentials and
private-network DNS/IP targets are rejected unless the explicit local-network
policy is enabled. This is SSRF filtering, not a DNS-rebinding guarantee.
Image magic bytes, size, output tokens and timeouts are bounded. Browser code
sees credential references, never key material. Image text is untrusted data
and is never executed as a command or tool instruction.

## Install and use

DSH owns installation and profile composition. This repository does not edit a
user profile. After an authorized npm publication, install through the
official plugin manager:

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-plugin-image-mind@0.2.0
npx @deepseek-ai/dsh plugin --profile web remove dsh-plugin-image-mind
```

The 0.2.0 packages are currently **not published**; the command is the future
registry install path, not evidence of current availability. For local
development, build/pack the workspace and use an isolated DSH profile. Do not
hand-edit `cordis.patch.yml` or install into a real profile.

In the web UI, configure a provider under 设置 → 插件 → 图像理解. API keys
are stored through the DSH credential seam. A green status means a recent
visual challenge passed; “configured” alone is not success.

## Compatibility

The current candidate is `dsh-plugin-image-mind@0.2.0` plus
`@ran-sh/dsh-vision@0.2.0`, with bounded DSH `0.1.x-rc.7` peers. Exact
`@deepseek-ai/dsh@0.1.1-rc.1` source-built/local-packed acceptance is tracked
separately from registry publication; see [docs/compatibility.md](docs/compatibility.md).

## Development

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run test:package
npm run test:built
npm run benchmark:deterministic
npm run benchmark:preprocess
```

The full benchmark commands are `benchmark:run`, `benchmark:score` and
`benchmark:compare`; thresholds must not be loosened. Real-provider and DSH
browser checks require explicit credentials/host authorization and must use an
isolated profile. See [docs/release-checklist.md](docs/release-checklist.md),
[docs/verification-debt.md](docs/verification-debt.md), and
[docs/provider-development.md](docs/provider-development.md).

## Scope and license

In scope: image attachments, visual providers, OCR/image understanding,
multi-image comparison, reliability and DSH tool integration. Out of scope:
replacing the main model, video/audio/PDF-native parsing and model training.

MIT License.
