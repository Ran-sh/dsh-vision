# dsh-plugin-image-mind

Image-understanding provider plugin for the DeepSeek Harness (DSH).

```
user image
  ↓
DeepSeek
  ↓ understand_image
vision model
  ↓
DeepSeek answers
```

This package is the **plugin half** of the image-mind product: it injects
`['vision']` and registers the OpenAI-compatible vision adapter, the provider
directory, the settings section, and the `understand_image` tool into
`ctx.vision` (owned by the `@ran-sh/dsh-vision` service package).

## Install

Use the DeepSeek Harness official plugin mechanism. The release-tested web
profile command is:

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-plugin-image-mind@0.1.1
```

It installs this plugin through the profile's package manager, and its
`dsh.bundle` declaration joins the profile bundle stack automatically. The
`@ran-sh/dsh-vision@0.1.0` service dependency installs with it; users do not
install vision separately.

Remove it with:

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-plugin-image-mind
```

**Do not** hand-edit `cordis.patch.yml` in your profile while also using the
Harness-managed install — the two are the same layer and would duplicate the
plugin.

## Notes

- This is an independent community plugin, **not** an official DeepSeek
  package.
- The connection test sends one embedded 32x32 test image and requires the
  model to name its color — a text-only model fails the test.
- Built-in provider templates are configuration hints, not long-term
  compatibility guarantees.

Full documentation lives in the repository README.
