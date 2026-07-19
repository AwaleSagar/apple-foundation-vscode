# Apple Foundation Models — engineering reference

Distilled from Apple's official FoundationModels documentation (crawled 2026-07-19 via
Firecrawl; raw scrapes live in the untracked `.firecrawl/` directory). This file records the
facts this extension's design depends on, so they survive doc churn and are reviewable in PRs.

## Model versions — prompts must be re-tested per OS

The on-device model changed behavior at each of these points; treat prompt quality as
version-dependent:

1. macOS/iOS **26.0–26.3** — initial release
2. **26.4** — improved instruction following + tool calling; improved guardrails (fewer false
   positives); `tokenCount(for:)` and `contextSize` APIs added
3. **27.0** — new on-device model, rebuilt; better instruction following; `fm` CLI + Python SDK
   ship with the OS

## Token & context rules (official)

- `contextSize` is the **total shared window** — prompts *plus* responses count against it.
- Xcode Playground cites ~**4096** tokens for the on-device model; never hardcode it forever —
  prefer runtime discovery when the bridge exposes it (our `maxContextTokens` setting is the
  interim knob).
- `tokenCount(for:)` (26.4+) is the exact counter — surfaced here via `fm token-count`.
- **KV-cache**: the framework caches the stable prompt prefix (instructions + tools). Keep
  system instructions byte-stable across a thread's turns; changing them invalidates the cache
  and adds latency ("Optimizing key-value caching in language model sessions").

## Error taxonomy → our `BridgeError` codes

Apple's cases (from `GenerationError`, migrating to `LanguageModelError` /
`SystemLanguageModel.Error` / `LanguageModelSession.Error` in the Xcode 27 era):

| Apple case | Our code | Client UX |
| --- | --- | --- |
| `exceededContextWindowSize` | `CONTEXT_OVERFLOW` | Trim history / lower output cap |
| `guardrailViolation`, `refusal` | `GUARDRAIL` | Rephrase; never retry-loop |
| `rateLimited`, `concurrentRequests` | `RATE_LIMITED` | Backoff; serialize per session |
| `assetsUnavailable` | `MODEL_NOT_READY` | Model still downloading — wait, `fm available` |
| `unsupportedLanguageOrLocale` | (generic) | Locale check — revisit with localization |
| `decodingFailure` | (n/a yet) | Guided-generation schema issue — Phase 2 |

Note: a second prompt on one session while the first streams throws `concurrentRequests` —
never multiplex streams on a single bridge session; queue, or use separate one-shot sessions.

## Guardrails

- `SystemLanguageModel.Guardrails`: `.default` blocks unsafe prompts *and* responses;
  `.permissiveContentTransformations` allows text→text transformation of risky content
  (relevant to a future Privacy Redactor feature).
- Benign dev content can still trip guardrails; phrase security-adjacent prompts neutrally and
  surface `GUARDRAIL` errors with rephrase guidance.

## Capability surface beyond Chat Completions

The OpenAI-compatible bridge (`fm serve`) covers text chat only. These require a Swift sidecar
or richer `fm` endpoints (tracked in ROADMAP Phase 2/3):

- **Guided generation** — `@Generable`, `GenerationSchema`, `DynamicGenerationSchema`
- **Tools** — `Tool` protocol, `GenerationOptions.ToolCallingMode`; system `OCRTool`,
  `BarcodeReaderTool`
- **Vision** — image attachments in prompts (27+)
- **DynamicProfile** — per-mode model/instructions/tools swaps preserving one transcript
- **PCC** — `PrivateCloudComputeLanguageModel` (27+ beta): entitlement required, larger
  context, `quotaUsage` API; strictly opt-in for this extension
- **Availability** — `SystemLanguageModel.Availability` reasons (`deviceNotEligible`,
  `modelNotReady`, …) are richer than our darwin/arm64 gate; map them when the bridge exposes
  them

## Canonical links

- Updates: <https://developer.apple.com/documentation/updates/foundationmodels>
- Framework: <https://developer.apple.com/documentation/FoundationModels>
- Session: <https://developer.apple.com/documentation/FoundationModels/LanguageModelSession>
- KV cache: <https://developer.apple.com/documentation/FoundationModels/optimizing-key-value-caching-in-language-model-sessions>
- PCC: <https://developer.apple.com/documentation/FoundationModels/PrivateCloudComputeLanguageModel>
- Python SDK: <https://github.com/apple/python-apple-fm-sdk>
- Open source: `apple/foundation-models-utilities`, `apple/coreai-models`,
  `ml-explore/mlx-swift-lm`
