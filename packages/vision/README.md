# @ran-sh/dsh-vision

Provider-neutral vision service interface for the DeepSeek Harness.

This package **owns `ctx.vision`**: the vision runtime, the adapter contract,
and the provider registration/directory/discovery primitives. It contains no
provider vocabulary (no OpenAI, no baseURL, no API keys) — provider plugins
such as `dsh-plugin-image-mind` inject `['vision']` and register into it,
mirroring the `@deepseek-ai/dsh-llm` service split.

## Install

Installed automatically as a dependency of `dsh-plugin-image-mind`; no direct
install step needed. See the repository README for the plugin install flow.

## Notes

- Independent community package, **not** an official DeepSeek package.
- The full architecture documentation lives in the repository README and
  `docs/architecture.md`.
