# Architecture

dsh-vision follows the DeepSeek Harness capability pattern: a **Service Definition** package owns a context key, and a **Provider Plugin** package injects that key and registers into it. This is the same split as `@deepseek-ai/dsh-llm` + `@deepseek-ai/dsh-llm-deepseek` and `@deepseek-ai/dsh-web` + `@deepseek-ai/dsh-web-search-exa`.

```
              DeepSeek Harness
                     │
                     │ hosts
                     ▼

       @ran-sh/dsh-vision          (packages/vision)
       ──────────────────
        Vision Service             ctx.vision (VisionRuntime)
              ▲
              │ inject ['vision']
              │
       dsh-plugin-image-mind       (packages/image-mind)
       ─────────────────────
        Provider + Tool + UI       adapter / settings / credentials / tool / client
              │
              ▼
       Vision API Providers        OpenAI-compatible endpoints (any vendor)
```

## The seam: what `@ran-sh/dsh-vision` knows

`ctx.vision` is provider-neutral. The runtime knows only:

- **provider ids** — route keys registered by provider plugins;
- **adapters** — implementations of `VisionAdapter` that serve routes;
- **requests and results** — `VisionRequest` / `VisionResult`;
- **directory metadata** — `VisionProviderDescriptor { id, displayName, description? }`;
- **default-provider strategy** — a single-owner resolver registered by the plugin that owns the active setting;
- **lifecycle** — atomic `registerAdapter(providers, adapter)` with `replace([])`, directory registration, fiber-disposed registrations, `vision/adapters-updated` events;
- **errors** — `VisionError extends HarnessError` with stable provider-neutral codes.

It never knows: endpoints (`baseURL`), wire protocols (`chat-completions`, `responses`), credentials (`apiKey*`, `Authorization`, `Bearer`), HTTP, retry, model catalogs, image attachment routes, or any vendor name. Adding a brand-new adapter family (Gemini native, Anthropic, gRPC, local process) requires **zero changes** to `packages/vision` — the seam audit in `tests/boundary.test.ts` enforces this by scanning for forbidden vocabulary.

## Dispatch

```
ctx.vision.call(request)
    → resolveProviderId(request.provider | default | single live route)
    → route(provider)                     // registry lookup, PROVIDER_NOT_FOUND otherwise
    → adapter.call(provider, request)     // the adapter owns everything below
```

The adapter (`OpenAICompatibleVisionAdapter` in image-mind) resolves its own endpoint snapshot per call through constructor hooks (`resolveProviderOptions` + `resolveApiKey`), deep-freezes it, applies the request model override, serializes the wire request, retries transient failures, and parses the response. An in-flight request never observes a settings change; the next call re-resolves.

## Provider plugin ownership (image-mind)

| Concern | Owner |
|---|---|
| Provider config schema, last-good resolution | `src/config.ts` |
| Endpoint snapshot + wire protocol + retry | `src/adapters/openai-compatible/` |
| Credential resolution + legacy migration | `src/credentials/` |
| Image loading (path/URL/attachment + SSRF guard) | `src/media/` |
| Attachment routes, dedup (sha256), preview | `src/attachments/`, `src/client/` |
| Settings card (官方风格 UI) | `src/client/settings/` |
| Thin `understand_image` tool | `src/tools/understand-image.ts` |
| Host RPC (test connection / model list) | `src/runtime/vision-rpc.ts` |

## Lifecycle

- The vision service mounts first (its own Cordis row); image-mind injects `['vision']` and activates once the service is up.
- image-mind registers: adapter routes (`registerAdapter`), directory entries (`registerConfigurableProviders`), the default-provider strategy (`registerDefaultProviderResolver('image-mind', ...)`), the tool, the settings section, and the attachment routes.
- Unloading image-mind withdraws routes **and** the default-provider strategy (fiber teardown) — no stale resolver survives; `ctx.vision` itself stays alive.
- Reloading image-mind restores everything.

## Settings & credentials flow

```
UI (settings card)
  → connection.api.settings describe/mutate   (official wire; secrets redacted)
  → connection.api.credentials.set            (typed key → credential store)
Host (apply)
  → settings scope / last-good config
  → adapter.resolveProviderOptions + resolveApiKey
  → credential seam (seam owns the plane when mounted; env fallback otherwise)
```

`settings.yaml` never contains a key — only the credential reference (`apiKeyEnv`). The browser never receives a key value.

## Multi-image

`understand_image` accepts `image` (single) or `images` (array, ≤ 8). Both normalize to `LoadedImage[]`; the adapter serializes every image in one wire request, preserves original order, and enforces the combined byte bound. The semantic cache key hashes every ordered image. The ≤4 limit in the historical 0.1.0 changelog is superseded.

## Errors

`VisionError extends HarnessError` (the public base `LlmError`/`WebError` extend too). Registry/selection codes (`PROVIDER_NOT_FOUND`, `DUPLICATE_ADAPTER`, `REGISTRATION_DISPOSED`, `DUPLICATE_DEFAULT_PROVIDER`, …) are stable. Adapter wire failures (auth, rate limit, timeout, network, response shape) live inside image-mind (`ImageMindVisionError`) and cross the seam wrapped in the generic `PROVIDER_ERROR` with the transport detail chained as `cause` — the seam never leaks HTTP vocabulary.
