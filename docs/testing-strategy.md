# Testing strategy

## Philosophy

The architecture is deliberately split so that everything with interesting logic is a pure
function or a thin class with injected dependencies — and therefore unit-testable in
milliseconds — while the VS Code adapter layer stays too thin to hide bugs. Test effort follows
that split.

## Layers

| Layer | Tool | Runs | Covers |
| --- | --- | --- | --- |
| Unit | Vitest (`src/**/*.test.ts`) | every commit, CI | SSE parsing, availability gating, config normalization, message conversion — all pure logic |
| Integration | `@vscode/test-electron` (planned, roadmap Phase 0) | CI | activation, provider registration, command wiring inside a real Extension Host |
| End-to-end (manual) | Extension Development Host on real hardware | before release; for bridge/provider PRs | actual inference through `fm serve` (or `afm`) on Apple Silicon |

## Rules

- **Unit tests import no real `vscode`.** The Vitest alias maps `vscode` to
  `src/test/mocks/vscode.ts`. If a test needs more of the API than the stub offers, first ask
  whether the logic belongs in a purer module; extend the stub only as a last resort.
- **Test files sit next to the code** (`sse.ts` / `sse.test.ts`) so coverage gaps are visible in
  the file tree.
- **Test behavior, not implementation.** Assert on outputs and observable effects; don't assert
  call counts on internals.
- **The process manager and HTTP client are exercised at their seams.** `BridgeClient` against a
  stubbed `fetch`, `BridgeServerManager` in integration tests — we don't mock what we don't own
  beyond the standard `fetch` boundary.
- **Coverage is a signal, not a gate.** CI reports it; PRs that drop it noticeably should
  explain why. No arbitrary threshold that incentivizes assertion-free tests.

## What we deliberately don't test

- Apple's model output quality — non-deterministic and not our contract.
- The `afm` CLI itself — upstream's responsibility; we test our handling of its success, error,
  and absence modes.
- VS Code UI rendering — the Chat UI belongs to VS Code.

## Manual test checklist (release)

1. Fresh profile: model appears in picker on supported hardware; absent on unsupported.
2. Bridge executable missing/misconfigured → actionable error naming the fix.
3. Bridge auto-start, and reuse of an externally started `fm serve --port 9999`.
4. Streaming responds token-by-token; cancel stops promptly; logs stay clean.
5. Restart command recovers from a killed bridge.
