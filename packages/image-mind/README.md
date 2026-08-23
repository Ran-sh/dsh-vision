# dsh-plugin-image-mind

Image-understanding provider plugin for the DeepSeek Harness (DSH).

```
user image
  鈫?
DeepSeek
  鈫?understand_image
vision model
  鈫?
DeepSeek answers
```

This package is the **plugin half** of the image-mind product: it injects
`['vision']` and registers the OpenAI-compatible vision adapter, the provider
directory, the settings section, and the `understand_image` tool into
`ctx.vision` (owned by the `@ran-sh/dsh-vision` service package).

## Install

> **Warning:** the published `0.2.0` on npm is a defective empty shell (no
> code). Use nothing older than the upcoming `0.2.1`.

After publication, the one-command path is this package's lifecycle CLI
(a convenience wrapper that delegates every mutation to official DeepSeek
Harness plugin lifecycle commands):

```sh
npx dsh-plugin-image-mind install      # default profile: web
npx dsh-plugin-image-mind status       # add --json for scripts
npx dsh-plugin-image-mind update
npx dsh-plugin-image-mind uninstall
```

`--profile <name>` targets another profile. The raw official Harness command
path below stays available as an advanced/fallback route.

Use the DeepSeek Harness official plugin mechanism. The release-tested web
profile command is:

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-plugin-image-mind@<version> # 0.2.1+ only
```

It installs this plugin through the profile's package manager, and its
`dsh.bundle` declaration joins the profile bundle stack automatically. The
`@ran-sh/dsh-vision` service dependency installs with it; users do not
install vision separately.

Remove it with:

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-plugin-image-mind
```

**Do not** hand-edit `cordis.patch.yml` in your profile while also using the
Harness-managed install 鈥?the two are the same layer and would duplicate the
plugin.

## Notes

- This is an independent community plugin, **not** an official DeepSeek
  package.
- The connection test sends one embedded 32x32 test image and requires the
  model to name its color 鈥?a text-only model fails the test.
- Built-in provider templates are configuration hints, not long-term
  compatibility guarantees.
- `0.2.0` adds durable host-side image reference recovery, neutral attachment
  markers, historical sent-image previews, task-aware routing/reliability,
  and the expanded multi-image/release-safety work documented in the root
  changelog.

Full documentation lives in the repository README.
