# Codex Handoff

## Release baseline

- Release source SHA: `856fc7d5cad12d4614c955226dab1ae075ec2521`
- npm: `@ran-sh/dsh-vision@0.1.0`
- npm: `dsh-plugin-image-mind@0.1.1`
- Known-good DSH CLI/runtime: `0.1.0-rc.7`
- Harness plugin manager: pnpm `11.7.0`
- Acceptance OS/runtime: Windows 11, Node `24.18.1`, npm `11.16.0`

The release source SHA is the tracked source used to build the npm artifact.
Acceptance documentation may live in later commits without changing the
published runtime files.

## Architecture

```text
@ran-sh/dsh-vision
  └─ owns ctx.vision

dsh-plugin-image-mind
  ├─ injects ['vision']
  ├─ registers provider/adapter/settings/tool/UI
  └─ depends one-way on @ran-sh/dsh-vision
```

`image-mind → vision` is the only dependency direction. The service and
provider lifecycles remain independent.

## Frozen principles

- Do not patch DSH source or DSH `node_modules`.
- Do not modify `ctx.llm` or the official Models UI.
- Do not add a profile-mutating installer.
- Harness owns bundle composition; users install only image-mind.
- Do not ask users to repair normal installs by editing profile patches.
- Change vision core only for a reproduced provider-neutral core defect.

## Maintenance rule

For every future report:

```text
reproduce → regression test → smallest compatible fix
→ deterministic gates → patch release
```

Do not redesign the architecture without evidence from a reproduced bug or a
DSH upstream compatibility break.

## Verified release commands

Install:

```powershell
npx @deepseek-ai/dsh plugin --profile web add dsh-plugin-image-mind@0.1.1
```

Start:

```powershell
npx @deepseek-ai/dsh web
```

Configure: Settings → Plugins → Plugin Configuration → Image Understanding.

Remove:

```powershell
npx @deepseek-ai/dsh plugin --profile web remove dsh-plugin-image-mind
```

The release acceptance used a disposable `DSH_HOME`, a separate port, and no
manual profile edits. It passed baseline boot, add/boot, Host route and RPC
envelope probes, Settings UI smoke, remove/boot, reinstall/boot, second
remove/boot, and a real fixed-red-image visual challenge.

## Deterministic test commands

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run test:built
npm run test:package
git diff --check
```

Optional real endpoint tests:

```powershell
$env:RUN_VISION_E2E = '1'
npm exec --workspace packages/image-mind -- vitest run tests/e2e-real.test.ts
```

Never print credentials or paste npm OTP/token values into an agent chat.

## Known limitations

- pnpm reports the DSH-owned peer packages as missing when inspecting the
  isolated profile alone. Harness supplies them from its runtime bundle; two
  complete add/boot/remove roundtrips passed despite this static warning.
- npm 11.16.0 can spend several minutes resolving the large DSH peer graph.
  The non-blocking DSH `0.1.0-rc.8` latest probe did not complete within ten
  minutes; release-blocking acceptance used known-good `0.1.0-rc.7`.
- The real Opencode Go red-image challenge passed. Command Code Goat tests were
  blocked because `COMMANDCODE_API_KEY` was not configured; no PASS is claimed
  for that provider.
- DSH is still a preview. Re-run the clean profile roundtrip for every future
  DSH release before updating the compatibility matrix.
