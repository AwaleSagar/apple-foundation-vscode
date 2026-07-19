# Roadmap

Direction, not a contract. This roadmap follows the milestone plan in the full research
document, [apple-fm-vscode-extension-roadmap.md](apple-fm-vscode-extension-roadmap.md)
(§6 and §15) — read that for the deep rationale, feature brainstorm, and risk register.
Items move as we learn; proposals welcome via feature-request issues.

## Guiding constraints

Everything here must preserve the core promise: **inference stays on-device by default**.
The only sanctioned exception is Apple's Private Cloud Compute (PCC) — cryptographically
private, no API keys — and it stays strictly opt-in, clearly labeled, and hard-disabled by a
future `offlineOnlyMode` setting.

## Phase 0 — Discover & scaffold (M0) ✅

- [x] Capability spikes: `fm` CLI probed (`fm available`, `fm serve` endpoints, streaming verified
      end-to-end against the on-device `system` model)
- [x] Full engineering scaffold (pnpm 11, Biome 2, strict TS, esbuild, Vitest, Husky,
      Commitlint, Changesets, Renovate, CodeQL, CI/release workflows)
- [x] Platform gate: darwin + arm64 + Darwin ≥ 25 availability check with actionable messaging
- [ ] Capability map: catalog what the ~3B on-device model handles well vs. poorly
      (commit messages, explanation, log triage) using `fm chat`

## Phase 1 — MVP (M1–M3) ✅ current

- [x] Language Model Chat Provider: "Apple On-Device" in the native model picker
- [x] Bridge lifecycle: spawn `fm serve` (or `afm`) lazily, health checks, reuse external
      servers, streaming SSE with first-class cancellation, idle shutdown for owned processes
- [x] `@apple` chat participant with `/explain`, `/doc`, `/commit` (staged-diff aware) and
      followups
- [x] Token budgeting: `fitMessagesToBudget` input trimming + `fm token-count` via status
      diagnostics; configurable `maxContextTokens` (never a single hardcoded window at call sites)
- [x] Session reuse per chat thread: free-form `@apple` turns prepend VS Code chat history
- [x] Guardrail UX: typed `BridgeError` codes (`GUARDRAIL`, `CONTEXT_OVERFLOW`, …) with
      actionable copy
- [x] Onboarding: first-run PATH/host check + `Apple Foundation Models: Run Setup Check`
- [x] Marketplace release assets: icon + listing copy (demo GIF still tracked for publish day)
- [x] Live bridge integration tests (`src/bridge/client.integration.test.ts` against `fm serve`
      when available)
- [x] Extension Host integration suite (`pnpm run test:vscode`, @vscode/test-cli) in CI
- [x] Status bar bridge-health indicator with management quick-pick
- [x] Get Started walkthrough + localization scaffolding (`package.nls.json`)
- [x] `offlineOnlyMode`: machine-enforced on-device-only model resolution

**MVP ship criteria** (per the research doc §15): install one VSIX, see "Apple On-Device" in
the picker, chat offline with streaming, and generate a conventional commit from staged
changes — no account, key, or setup beyond Apple Intelligence being on.

## Phase 2 — Beta: tools, RAG, MCP (M4–M6)

- [ ] Language Model Tools: `readFile`, `searchWorkspace`, `getDiagnostics` with strict schemas
      and confirmation for anything mutating
- [ ] Embedding-free workspace RAG: ripgrep candidates → on-device rerank/answer
- [ ] Structured outputs via guided generation (`fm schema` / JSON-schema `response_format`)
- [ ] MCP server definition provider: expose `local_summarize`, `local_classify`,
      `local_extract`, `local_redact` to any MCP-capable agent
- [ ] Differentiator features (pick 3–4, each with an eval dataset): Privacy Redactor,
      Always-On Commit Intelligence, Offline Log Triage, Semantic File Organizer
- [ ] Inline completion experiment (latency-gated; free on-device tokens make it plausible)

## Phase 3 — Harden & launch (M7–M8)

- [ ] Opt-in PCC model entry (32K context, `reasoningLevel`) — `offlineOnlyMode` already ships
      and will hard-disable it
- [ ] Optional embedded Swift sidecar (stdio JSON-RPC, signed + notarized) for capabilities the
      Chat Completions protocol can't express — persistent sessions, vision, dynamic profiles
      (revisits [ADR-0002](docs/adr/0002-bridge-cli.md))
- [ ] Performance budgets measured in CI: warm first-token < 800 ms, commit message < 3 s
- [ ] Python-SDK eval suites (JSONL datasets, LLM-as-judge rubrics) gating quality regressions
- [ ] Marketplace stable + Open VSX, pre-release channel tracking macOS betas
- [ ] Localization of user-facing strings

## Non-goals

- Windows/Linux support — impossible without abandoning the on-device model
- Third-party cloud model fallback — breaks the privacy promise; PCC opt-in is the only ladder
- Telemetry of any kind — any metrics stay local and user-visible
