# Roadmap

Direction, not a contract. Items move as we learn; the ordering within each phase is rough
priority. Proposals welcome via feature-request issues.

## Guiding constraints

Everything on this roadmap must preserve the core promise: **inference stays on-device**. Features
that require cloud calls are out of scope permanently, not just deferred.

## Phase 0 — Foundation (current, v0.x)

- [x] Language Model Chat Provider registering "Apple On-Device"
- [x] `afm` bridge lifecycle management (spawn, health check, reuse external server)
- [x] Streaming responses with cancellation
- [x] Status / restart / logs / manage commands
- [x] Full engineering scaffold (CI, CodeQL, Changesets, Renovate)
- [ ] Extension icon and Marketplace listing assets
- [ ] Real screenshots in README
- [ ] Integration test suite in the Extension Development Host (`@vscode/test-electron`)

## Phase 1 — v1.0 (Marketplace release)

- [ ] Publish to the VS Code Marketplace (`darwin-arm64` target) and Open VSX
- [ ] Status bar item with bridge health and quick actions
- [ ] Graceful onboarding: detect missing `afm` and offer guided install
- [ ] Context-window management: warn and truncate transparently near the 4096-token limit
- [ ] Setting for system prompt / instructions customization

## Phase 2 — Deeper editor integration

- [ ] Inline completion provider experiment (latency-gated; on-device makes this plausible)
- [x] Chat participant (`@apple`) with editor-context commands (`/explain`, `/doc`, `/commit`)
- [ ] Structured outputs using the framework's guided generation via the bridge
- [ ] Tool calling, when the bridge exposes it

## Phase 3 — Deeper framework access & polish

- [ ] Opt-in Private Cloud Compute model (`fm serve` exposes `pcc`: Apple's larger server model,
      32K context, cryptographically private — off by default because it leaves the device)
- [ ] Optional embedded Swift sidecar (stdio JSON-RPC) for capabilities the Chat Completions
      protocol can't express — persistent sessions, guided generation, vision input
      (revisits [ADR-0002](docs/adr/0002-bridge-cli.md))
- [ ] Real token counting via `fm token-count` instead of the character heuristic
- [ ] Model options surface (temperature, adapters if Apple exposes them)
- [ ] Localization of user-facing strings

## Non-goals

- Windows/Linux support — impossible without abandoning the on-device model
- Cloud model fallback — breaks the privacy promise; other extensions do this well already
- Telemetry of any kind
