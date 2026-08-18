# Provider Development

This project's whole point: **adding a new vision adapter family must not touch `packages/vision`**. The seam audit (`tests/boundary.test.ts`) scans `packages/vision/src` for provider vocabulary (`chat-completions`, `responses`, `OpenAI`, `apiKey*`, `Authorization`, `Bearer`, `baseURL`) and fails the build on any hit.

## The contract

```ts
// packages/vision/src/adapter.ts (FROZEN — do not modify)
export abstract class VisionAdapter {
  abstract call(provider: string, request: VisionRequest): Promise<VisionResult>
  discoverModels?(provider: string, request?: VisionModelDiscoveryRequest): Promise<readonly VisionModel[]>
  probe?(provider: string, request: VisionRequest): Promise<VisionResult>
}
```

`VisionRequest` carries only what the caller wants: `provider?`, `model?`, `prompt`, `images: LoadedImage[]`, `maxOutputTokens?`, `signal?`. Everything else — endpoint, credential, wire format, timeout, retry — is your adapter's private concern.

## Steps to add `GeminiNativeVisionAdapter` (example)

1. **New package or new folder?** A separate package (`@ran-sh/dsh-vision-gemini`) is cleanest for a real family; a folder inside image-mind works while the adapter is experimental. Either way `packages/vision` is untouched.

2. **Implement the adapter** with constructor hooks, mirroring `OpenAICompatibleVisionAdapter`:

```ts
class GeminiNativeVisionAdapter extends VisionAdapter {
  constructor(private options: {
    resolveProviderOptions: (provider: string, request: VisionRequest) => GeminiNativeOptions
    resolveApiKey: (options: GeminiNativeOptions) => Promise<string>
  }) { super() }

  async call(provider: string, request: VisionRequest): Promise<VisionResult> {
    const options = deepFreeze(this.options.resolveProviderOptions(provider, request))
    const key = await this.options.resolveApiKey(options)
    // ... your wire logic: endpoint, protocol, retry, parse
    return { text, provider, model }
  }
}
```

3. **Register** into `ctx.vision` (inject `['vision']`), exactly like image-mind does:

```ts
export const inject = ['vision']
export function apply(ctx: Context, config: Config) {
  const adapter = new GeminiNativeVisionAdapter({ ... })
  ctx.vision.registerAdapter(providerIds, adapter)      // atomic, replace([]) legal
  ctx.vision.registerConfigurableProviders(descriptors) // display metadata only
  // active-provider strategy only if you own that setting:
  ctx.vision.registerDefaultProviderResolver(ownerId, () => resolvedActive())
}
```

4. **Own your vocabulary.** `GeminiNativeOptions` (endpoint, key ref, protocol, timeouts) lives in your package. Wire failures map to your own error type; wrap them in `VisionError('...', 'PROVIDER_ERROR', { cause })` when they cross the seam, or keep them internal if you never surface them.

5. **Prove it.** Add a seam-audit case (or rely on the existing one) and tests in your package: registration, dispatch by route, discovery, probe, lifecycle, and your wire serialization against a local HTTP mock server.

## What stays FROZEN

- `VisionRuntime` public API (registry, directory, default-provider lifecycle, events)
- `VisionAdapter` abstraction
- `VisionRequest` / `VisionResult` / `VisionModel` / `VisionProviderDescriptor`
- `VisionError` codes

If you believe one of these must change, the change is a **breaking seam change**: bump the vision package minor (0.x), update every provider plugin, and document it in `CHANGELOG.md`.

## Testing a new adapter

- Deterministic unit tests with a **real local HTTP server** (see `packages/image-mind/tests/http-server.test.ts`): URL join, headers, body, status mapping, abort.
- Multi-adapter dispatch test (see `packages/vision/tests/runtime.test.ts` "multi-adapter dispatch by provider route"): provider A → adapter A, provider B → adapter B, no guessing.
- Real E2E stays out of `npm test` (keyless, offline, deterministic); gate it behind an env flag like `RUN_VISION_E2E=1`.
