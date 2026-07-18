# Building a macOS-Only VS Code Extension on Apple's On-Device Foundation Models

**A 2026 development roadmap: architecture, milestones, features, and MVP-to-production plan**

*Research date: July 2026 · Targets: macOS 26 (Tahoe) / macOS 27, Apple Silicon, VS Code 1.99+*

---

## 1. Executive Summary

As of WWDC 2026, Apple's on-device Foundation Model is no longer locked inside Swift apps. macOS 27 ships a pre-installed `fm` CLI (`fm respond`, `fm chat`, `fm schema`) and a Foundation Models SDK for Python, and the Foundation Models framework itself — including the new `LanguageModel` protocol abstraction layer — is going open source. Simultaneously, VS Code's AI extension surface matured into three complementary APIs: the **Language Model Chat Provider API** (contribute your own model to the native Chat view), the **Chat Participant API** (build `@participant` experiences), and the **MCP developer guide** (`contributes.mcpServerDefinitionProviders` for registering Model Context Protocol servers).

The intersection of these two 2026 developments is the opportunity: a VS Code extension that registers Apple's on-device Foundation Model as a first-class chat model in VS Code — **zero API keys, zero cloud cost, zero data leaving the machine, works on airplanes** — and layers on features that are only sane when inference is free and private.

The recommended architecture is a **TypeScript extension + persistent Swift "sidecar" helper binary** communicating over stdio JSON-RPC (LSP-style framing), the pattern validated by the open-source `apple-local-llm` project. The `fm` CLI and Python SDK are the prototyping and evaluation surface; the Swift sidecar is the production surface.

This document covers: the 2026 research landscape (§2), technology choices (§3), architecture with diagrams (§4), project structure (§5), a nine-milestone step-by-step plan (§6), on-device-only feature brainstorm (§7), prompt engineering for a small model (§8), streaming design (§9), security and sandboxing (§10), performance (§11), packaging/signing/publishing (§12), testing and evaluation (§13), risks (§14), and an MVP-to-production timeline (§15).

---

## 2. Research Digest: The 2026 Landscape

### 2.1 Apple Foundation Models — what changed at WWDC26

From Apple's WWDC26 session 241 ("What's new in the Foundation Models framework") and session 334 ("Build AI-powered scripts with the fm CLI and Python SDK"):

- **New on-device model**, rebuilt from the ground up: better logic and tool calling, with a context size inspectable at runtime (`model.contextSize`, e.g. 8192 tokens on current hardware) and a `tokenCount(for:)` API introduced in iOS 26.4 / macOS 26.4 for budgeting prompts against the window. Adapt to the hardware; never hardcode the context size.
- **Vision**: the on-device model now accepts image attachments (NSImage, CGImage, CoreVideo pixel buffers, file URLs) in any aspect ratio; larger images cost more tokens and latency.
- **Private Cloud Compute (PCC)**: `PrivateCloudComputeLanguageModel` exposes Apple's much larger server model with a 32K context window and configurable `reasoningLevel` — no account, no auth, no API keys, cryptographically verifiable privacy, but with daily usage limits (higher for iCloud+ subscribers; free for developers under 2M first-time downloads).
- **Model abstraction layer**: a new `LanguageModel` protocol lets any model back a `LanguageModelSession`. Apple is open-sourcing `CoreAILanguageModel` and `MLXLanguageModel` (run arbitrary local models on the Neural Engine / GPU), and Anthropic and Google are publishing Swift packages conforming to the same protocol.
- **System tools**: built-in `OCRTool` and `BarcodeReaderTool` (Vision-backed), plus a Spotlight-powered search tool for fully local RAG.
- **Dynamic Profiles**: a declarative primitive for agentic experiences — one session that swaps instructions, tools, model (on-device vs PCC), and reasoning level per mode while preserving the transcript.
- **Evaluations framework**: a new Swift framework (Xcode 27) for quantifying prompt/feature accuracy across iterations.
- **`fm` CLI** (pre-installed on macOS 27): `fm respond` (one-shot, stdout, with model/image/schema options), `fm chat` (interactive; `/model` switches to PCC, `/save` persists sessions), `fm schema object` (define structured output; model returns schema-conforming JSON).
- **Python SDK** (`apple_fm_sdk`): requires Python 3.10+, Xcode, Apple Silicon; installed via pip. Mirrors Swift — `LanguageModelSession`, `session.respond`, tool calling, guided generation via the `fm.generable` decorator. Its killer use case is evaluation pipelines in Jupyter (Pandas + matplotlib + LLM-as-judge), demonstrated by Apple with a three-prompt-variant grocery study whose failure modes (context overflow, over-generation, misses, hallucinations) only surfaced under measurement.
- **Guardrails**: Apple's safety layer can reject prompts/outputs; false positives were reduced in 26.4 and further in 27, but your code must handle guardrail errors gracefully.

### 2.2 VS Code AI extension APIs — the three integration surfaces

- **Language Model Chat Provider API** (`vscode.lm.registerLanguageModelChatProvider` + `contributes.languageModelChatProviders`): contribute models to VS Code's native model picker. You implement `provideLanguageModelChatInformation` (declare id, name, family, `maxInputTokens`, `maxOutputTokens`, capabilities like `toolCalling`/`imageInput`), `provideLanguageModelChatResponse` (stream `LanguageModelTextPart` / `LanguageModelToolCallPart` via a `Progress` callback), and `provideTokenCount`. Microsoft ships a `chat-model-provider-sample` in vscode-extension-samples. This is *the* way to make Apple FM appear next to Copilot's models.
- **Chat Participant API**: register an `@apple` participant with slash commands; the chat API is streaming-based and composes with the Language Model API. Use `prompt-tsx` for token-budget-aware prompt construction.
- **Language Model API** (consumer side): your own extension features can call `vscode.lm.selectChatModels` and consume any registered model — including your own provider — for inline features.
- **Language Model Tools API + MCP**: extensions register MCP servers via `contributes.mcpServerDefinitionProviders` in `package.json` plus a runtime `vscode.lm.registerMcpServerDefinitionProvider` call; VS Code's MCP support now covers the full spec (tools, prompts, resources, sampling). Your extension can both *expose* an MCP server (Apple FM as a local sampling/inference resource for agent mode) and *consume* MCP tools.

### 2.3 Open-source prior art (validated architectures)

- **`parkerduff/apple-local-llm`** (npm, Jan 2026): exactly the sidecar pattern this roadmap recommends. A Swift `fm-proxy` binary speaks LSP-style Content-Length-framed JSON-RPC over stdio; the TypeScript client manages process lifecycle (spawn on first request, keep model warm, 5-minute idle shutdown, crash auto-restart with exponential backoff), streaming via async iterators + AbortSignal, request cancellation, protocol versioning, structured output via OpenAI-style `response_format`/JSON-schema, and an optional `--serve` HTTP/SSE mode with OpenAI-compatible chunks. Its error taxonomy is worth adopting wholesale: availability reason codes (`NOT_DARWIN`, `UNSUPPORTED_HARDWARE`, `AI_DISABLED`, `MODEL_NOT_READY`, `HELPER_NOT_FOUND`, `PROTOCOL_MISMATCH`) and request errors (`TIMEOUT`, `CANCELLED`, `RATE_LIMITED`, `GUARDRAIL`, `INTERNAL`).
- **`Arthur-Ficial/apfel`**: exposes the built-in model as a UNIX tool and a local OpenAI-compatible server, 100% on-device — precedent for the "OpenAI-compat shim" integration path.
- **`huggingface/AnyLanguageModel`**: drop-in replacement for the Foundation Models framework supporting custom providers — useful as a fallback layer for pre-macOS-26 machines.
- **MLX ecosystem**: OpenAI/Anthropic-compatible local servers over MLX models; relevant if you later add a "bring bigger local models" tier via `MLXLanguageModel`.

### 2.4 VS Code extension engineering best practices (2026)

- **Bundling**: esbuild is the standard; single-file `dist/extension.js`, `--external:vscode`, source maps in dev, minify in prod.
- **Platform-specific VSIX**: `vsce` supports `--target darwin-arm64` (and `darwin-x64`) so you ship the compiled Swift helper only in Mac VSIXs and the Marketplace serves the right binary per platform. For a Mac-only extension you publish only the darwin targets; declare `"os": ["darwin"]` constraints and check `process.platform === "darwin"` + `process.arch` at activation with a graceful "requires Apple Silicon + Apple Intelligence" message.
- **Activation**: lazy activation events (`onChatParticipant:…`, `onLanguageModelChatProvider:…`, specific commands) — never `*`.
- **Testing**: `@vscode/test-cli` + `@vscode/test-electron` for integration tests inside a real VS Code instance; unit tests with vitest/mocha; CI on `macos-14`/`macos-15` GitHub runners (Apple Silicon).

---

## 3. Technology Choices

| Concern | Choice | Rationale / alternatives rejected |
|---|---|---|
| Extension language | TypeScript (strict), Node 20+ | Required by VS Code; esbuild bundling |
| Inference bridge | **Persistent Swift sidecar binary** (FoundationModels framework) over stdio JSON-RPC | Full API access (streaming, tools, guided generation, vision, dynamic profiles, PCC), keeps model warm. Rejected: shelling out to `fm respond` per request (process-spawn latency, macOS 27-only, no persistent session state, awkward streaming); Python SDK in production (would require users to have Python + Xcode; SDK is for prototyping/evals); localhost HTTP server (open port = attack surface; stdio is private to the process pair) |
| Prototyping & evals | `fm` CLI + Python SDK (`apple_fm_sdk`) + Jupyter/Pandas/matplotlib; Swift Evaluations framework for the sidecar | Apple's own recommended loop: prototype prompts in Python/CLI, ship in Swift |
| VS Code integration | Language Model Chat Provider (primary) + Chat Participant `@apple` + Language Model Tools + MCP server definition provider | Covers model picker, chat UX, agent-mode tools |
| Prompt construction | `@vscode/prompt-tsx` | Token-budget-aware priority-based pruning — critical for an 8K window |
| IPC framing | LSP-style `Content-Length` JSON-RPC 2.0 | Battle-tested (validated by apple-local-llm); `vscode-jsonrpc` npm package handles framing |
| Structured output | Swift `@Generable` in the sidecar, exposed as JSON-schema `response_format` over the wire | Guided generation is constrained decoding — guarantees parseable JSON, no regex parsing |
| Packaging | esbuild + `vsce package --target darwin-arm64` | Platform-specific VSIX carries the signed helper binary |
| Signing | Developer ID Application cert + Hardened Runtime + notarization (`notarytool`) for the Swift helper | Gatekeeper will quarantine an unsigned binary extracted from a VSIX |
| CI | GitHub Actions `macos-15` (Apple Silicon) | Only runner class that can build & smoke-test FoundationModels code |

---

## 4. Architecture

### 4.1 System overview

```
┌────────────────────────────── VS Code (Electron) ──────────────────────────────┐
│                                                                                │
│  Chat view ── model picker ──┐        @apple participant     Agent mode        │
│                              │              │                    │             │
│  ┌───────────────────────────▼──────────────▼────────────────────▼──────────┐  │
│  │                    Extension Host (Node, TypeScript)                     │  │
│  │                                                                          │  │
│  │  LanguageModelChatProvider   ChatParticipant   LM Tools   MCP defn       │  │
│  │        │                          │               │        provider      │  │
│  │  ┌─────▼──────────────────────────▼───────────────▼─────────────┐        │  │
│  │  │  FMClient (session mgr, request queue, cancellation,         │        │  │
│  │  │  availability cache, crash-restart w/ backoff, idle timer)   │        │  │
│  │  └──────────────────────────────┬───────────────────────────────┘        │  │
│  └─────────────────────────────────┼────────────────────────────────────────┘  │
└────────────────────────────────────┼───────────────────────────────────────────┘
                    stdio · JSON-RPC 2.0 · Content-Length framing
┌────────────────────────────────────▼───────────────────────────────────────────┐
│                fm-bridge  (Swift, signed + notarized universal/arm64 binary)   │
│                                                                                │
│   Router ── LanguageModelSession pool ── DynamicProfile per feature mode       │
│      │            │                            │                               │
│      │     SystemLanguageModel          PrivateCloudComputeLanguageModel       │
│      │     (on-device, ~8K ctx,         (opt-in, 32K ctx, reasoningLevel)      │
│      │      vision, tools,                                                     │
│      │      @Generable guided gen)                                             │
│      │                                                                         │
│   System tools: OCRTool · BarcodeReaderTool · Spotlight search (local RAG)     │
└────────────────────────────────────────────────────────────────────────────────┘
                     │ Apple Neural Engine / unified memory (on-device)
```

### 4.2 Request flow (streaming chat turn)

```
User prompt in Chat view
   → VS Code calls provideLanguageModelChatResponse(model, messages, options, progress, token)
   → prompt-tsx renders messages within maxInputTokens budget (verified via bridge tokenCount)
   → FMClient sends {"method":"respond","params":{sessionId, prompt, options, stream:true}}
   → fm-bridge: session.streamResponse(...) yields snapshot deltas
   → bridge emits {"method":"$/delta","params":{requestId, delta}} notifications
   → FMClient forwards each delta as progress.report(new LanguageModelTextPart(delta))
   → CancellationToken fires → FMClient sends $/cancel → bridge cancels the Swift Task
   → final {"result":{text, usage}} closes the request
```

### 4.3 MCP position

The extension registers an MCP server definition (stdio transport, pointing at the same `fm-bridge` binary in `--mcp` mode). This exposes tools such as `local_summarize`, `local_classify`, `local_extract_structured`, and `local_ocr` to *any* MCP-capable agent (VS Code agent mode, Claude Code, etc.), turning the Mac's free local model into shared infrastructure. Conversely, chat-participant features can consume workspace MCP tools through VS Code's Language Model Tools API.

---

## 5. Recommended Project Structure

```
apple-fm-vscode/
├── package.json                  # contributes: languageModelChatProviders, chatParticipants,
│                                 #   languageModelTools, mcpServerDefinitionProviders, commands,
│                                 #   configuration; engines.vscode; extensionKind: ["workspace"]
├── esbuild.mjs                   # bundle → dist/extension.js (--external:vscode)
├── src/
│   ├── extension.ts              # activate(): platform gate → register providers lazily
│   ├── platform/gate.ts          # darwin + arm64 + availability check, friendly error UX
│   ├── bridge/
│   │   ├── client.ts             # FMClient: spawn/respawn, JSON-RPC, idle shutdown, queue
│   │   ├── protocol.ts           # typed request/response/notification schema (versioned)
│   │   └── binaryLocator.ts      # resolve bundled fm-bridge path; verify signature/version
│   ├── providers/
│   │   ├── chatModelProvider.ts  # LanguageModelChatProvider impl (on-device + PCC entries)
│   │   └── tokenCounter.ts       # delegates to bridge tokenCount; cached heuristics fallback
│   ├── chat/
│   │   ├── participant.ts        # @apple participant, slash commands, followups
│   │   └── prompts/              # prompt-tsx components (SystemRules, FileContext, Diff…)
│   ├── features/                 # commit messages, inline rename, doc-gen, redactor, etc.
│   ├── mcp/serverDefinition.ts   # McpStdioServerDefinition → fm-bridge --mcp
│   └── telemetry.ts              # LOCAL-ONLY metrics (latency, guardrail rate); no network
├── bridge/                       # Swift package
│   ├── Package.swift
│   ├── Sources/FMBridge/
│   │   ├── main.swift            # stdio loop (Content-Length framing)
│   │   ├── Router.swift          # method dispatch, cancellation registry
│   │   ├── Sessions.swift        # LanguageModelSession pool, DynamicProfiles per mode
│   │   ├── Generables.swift      # @Generable structs (CommitMessage, Diagnosis, …)
│   │   ├── Tools.swift           # Tool implementations incl. OCR/Spotlight wrappers
│   │   └── McpMode.swift         # optional MCP stdio server mode
│   └── Tests/
├── evals/                        # Python SDK notebooks + datasets (apple_fm_sdk, pandas)
│   ├── datasets/*.jsonl
│   └── notebooks/*.ipynb
├── test/
│   ├── unit/                     # vitest: protocol, prompt builders, parsers (bridge mocked)
│   └── integration/              # @vscode/test-electron on macos-15 runner
├── scripts/
│   ├── build-bridge.sh           # swift build -c release; codesign --options runtime; notarize
│   └── package.sh                # vsce package --target darwin-arm64
└── .github/workflows/ci.yml
```

Key `package.json` contributions sketch:

```jsonc
{
  "engines": { "vscode": "^1.99.0" },
  "os": ["darwin"],
  "activationEvents": [],           // implicit via contributions below
  "contributes": {
    "languageModelChatProviders": [
      { "vendor": "apple-fm", "displayName": "Apple On-Device",
        "managementCommand": "appleFm.manage" }
    ],
    "chatParticipants": [
      { "id": "apple-fm.chat", "name": "apple", "fullName": "Apple On-Device Model",
        "description": "Private, offline, free — runs on your Neural Engine",
        "commands": [ { "name": "commit" }, { "name": "explain" }, { "name": "redact" },
                      { "name": "schema" }, { "name": "cloud" } ] }
    ],
    "mcpServerDefinitionProviders": [
      { "id": "apple-fm.mcp", "label": "Apple Foundation Model (local)" }
    ],
    "configuration": { "properties": {
      "appleFm.allowPrivateCloudCompute": { "type": "boolean", "default": false },
      "appleFm.idleShutdownMinutes":      { "type": "number",  "default": 5 },
      "appleFm.offlineOnlyMode":          { "type": "boolean", "default": false }
    }}
  }
}
```

---

## 6. Step-by-Step Development Roadmap (Milestones M0–M8)

### M0 — Environment, spikes, and de-risking (Week 1)

1. Hardware/OS baseline: Apple Silicon Mac on macOS 26.4+ (or 27 beta for `fm`/Python SDK), Apple Intelligence enabled, Xcode 26/27, Node 20+, VS Code stable + Insiders.
2. **Spike A — model feel**: use `fm chat` to probe the on-device model on your intended tasks (commit messages, code explanation, log triage). Use `/model` to compare against PCC. Record where the 3B-class model is adequate vs. where it isn't; this calibrates the whole feature list.
3. **Spike B — structured output**: `fm schema object` + `fm respond --schema` on a real task (e.g., classify diffs into `{type, scope, summary}`); confirm the prompt→schema→JSON→act contract.
4. **Spike C — Swift minimalism**: a 40-line Swift CLI that creates a `LanguageModelSession`, streams a response to stdout, and prints `model.contextSize` and `tokenCount(for:)`. Verify availability states (Apple Intelligence off, model downloading).
5. **Spike D — VS Code sample**: run Microsoft's `chat-model-provider-sample` unmodified; then hard-wire it to shell out to `fm respond` as a throwaway proof that Apple FM text can land in the Chat view.
6. Exit criteria: a one-page "capability map" of what the on-device model can/can't do, plus the four spikes running.

### M1 — The Swift bridge (Weeks 2–3)

1. Scaffold `bridge/` as a Swift package; implement the stdio loop with Content-Length framing and JSON-RPC 2.0 (mirror apple-local-llm's protocol design, including protocol version handshake in `initialize`).
2. Methods (v1): `initialize`, `availability` (return typed reason codes: `AI_DISABLED`, `MODEL_NOT_READY`, `UNSUPPORTED_HARDWARE`…), `capabilities` (contextSize, vision, PCC entitlement state), `tokenCount`, `respond` (blocking), `respondStream` (delta notifications `$/delta`, terminal result with usage), `cancel`, `sessionCreate`/`sessionDestroy` (multi-turn transcripts), `shutdown`.
3. Error taxonomy: map Swift `LanguageModelSession` errors to wire codes — `GUARDRAIL` (safety rejection), `CONTEXT_OVERFLOW` (max window exceeded), `RATE_LIMITED` (PCC), `TIMEOUT`, `CANCELLED`, `INTERNAL`. Every code gets a user-facing remediation string.
4. Implement cancellation as a registry of Swift `Task`s keyed by request id; `cancel` calls `task.cancel()`.
5. Structured output: accept a JSON-schema `response_format`, translate to a `DynamicGenerationSchema` (or pre-registered `@Generable` types for first-party features) so decoding is constrained, not parsed.
6. Unit-test the framing/dispatch with golden transcripts; smoke-test on hardware.
7. Exit criteria: `printf` a framed request into the binary and get streamed deltas back; kill -9 mid-stream leaves no zombie state.

### M2 — Extension host client + Chat Provider (Weeks 3–4)

1. Build `FMClient` in TypeScript over `vscode-jsonrpc`: spawn the bridge lazily on first request; keep-warm; idle shutdown (default 5 min); auto-restart on crash up to 3 times with exponential backoff; per-request timeout (60 s default); `AbortSignal`→`cancel` plumbing.
2. Implement `LanguageModelChatProvider`:
   - `provideLanguageModelChatInformation`: return two entries when available — `apple-on-device` (maxInputTokens = bridge-reported contextSize minus output reserve; `capabilities: { imageInput: true, toolCalling: true }`) and, if the user enabled it in settings, `apple-pcc` (32K window, tool calling, tooltip noting usage limits). In `silent` mode never prompt; return `[]` if unavailable.
   - `provideLanguageModelChatResponse`: convert `LanguageModelChatRequestMessage[]` (text parts, tool calls, tool results) into the bridge's transcript format; stream deltas via `progress.report(new LanguageModelTextPart(...))`; surface tool-call parts when the model requests a tool.
   - `provideTokenCount`: delegate to the bridge's real tokenizer; cache per-string; fall back to `len/4` heuristic if the bridge is cold.
3. Platform gate at activation: `process.platform === "darwin"` && `process.arch === "arm64"` && bridge `availability` OK; otherwise register nothing and show a single, actionable notification ("Enable Apple Intelligence in System Settings → Apple Intelligence & Siri").
4. Exit criteria: "Apple On-Device" appears in the VS Code model picker; a chat turn streams token-by-token; cancel works; pulling Wi-Fi changes nothing.

### M3 — Chat participant and first-party features (Weeks 5–6)

1. Register `@apple` with slash commands (`/commit`, `/explain`, `/redact`, `/schema`, `/cloud`), streaming markdown responses, file/selection context ingestion, and followup suggestions.
2. Build prompts with `prompt-tsx`: priority-ranked components (system rules > user query > selection > surrounding file > project metadata) so pruning under the 8K budget degrades gracefully instead of erroring.
3. First inline features (each a command + optional CodeLens):
   - **Commit message generation** from staged diff (guided generation → conventional-commit `@Generable`).
   - **Explain selection / error** with hover or editor action.
   - **Inline doc-comment generation** for the symbol under cursor.
4. Wire `session` reuse: one bridge session per chat thread to preserve multi-turn transcript; new session per one-shot command.
5. Exit criteria: the three features work offline end-to-end with structured, deterministic output handling.

### M4 — Tool calling, system tools, and local RAG (Weeks 7–8)

1. Expose VS Code-side tools to the model (Language Model Tools API): `readFile`, `searchWorkspace`, `getDiagnostics`, `runTestsDryRun` — each with strict schemas and user-visible confirmation for anything mutating.
2. In the bridge, register Apple's system tools where useful: `OCRTool` (screenshots of errors → text), Spotlight search tool for fully local RAG over user documents/notes when the user opts in.
3. Implement a lightweight **workspace retrieval** path: ripgrep candidate chunks → on-device model reranks/answers (embedding-free RAG that respects the small window: retrieve few, summarize, then answer).
4. Dynamic Profiles in the bridge: an "answer" profile (on-device, terse) vs. an "agent" profile (tools attached) vs. an opt-in "deep" profile (PCC + `reasoningLevel(.deep)`) — one session, mode switches preserve the transcript.
5. Exit criteria: `@apple find where retries are configured and explain` performs retrieve→rerank→answer with zero network.

### M5 — MCP integration (Week 9)

1. Add `contributes.mcpServerDefinitionProviders` + `vscode.lm.registerMcpServerDefinitionProvider` returning a `McpStdioServerDefinition` that launches `fm-bridge --mcp`.
2. In `--mcp` mode the bridge speaks MCP stdio and exposes tools: `local_generate`, `local_summarize`, `local_classify(schema)`, `local_extract(schema)`, `local_ocr(imagePath)`, `local_redact(text)` — plus an MCP *sampling* endpoint so external agents can use Apple FM as their LLM.
3. Document usage from VS Code agent mode and from external MCP clients (Claude Code/Desktop) — the Mac's free model becomes shared local infrastructure.
4. Exit criteria: agent mode lists and successfully invokes `local_classify`; an external MCP client can sample the on-device model.

### M6 — On-device-only differentiator features (Weeks 10–12)

Pick 3–4 from the §7 brainstorm and productionize them; recommended MVP+ set: Privacy Redactor, Always-On Commit Intelligence, Offline Log Triage, Semantic File Organizer. Each must include: prompt component, `@Generable` schema, eval dataset (≥50 cases), and latency budget.

### M7 — Hardening: performance, security, packaging (Weeks 13–14)

Work through §10–§12: idle lifecycle tuning, request coalescing/debouncing for keystroke-adjacent features, guardrail UX, code signing + notarization pipeline, `vsce package --target darwin-arm64`, Marketplace listing (badges: "100% on-device", "works offline"), pre-release channel.

### M8 — Testing, evals, publish (Weeks 15–16)

Full test matrix (§13), Python-SDK eval suite gating CI on quality regressions, docs (README with a 20-second GIF of it working in airplane mode — that's the marketing), publish pre-release → stable.

---

## 7. Out-of-the-Box Features Only Possible with On-Device Inference

The design lens: cloud LLMs are metered, high-latency, and privacy-radioactive, so extensions ration them. On-device inference is **free per call, ~always available, and private by construction**, so you can invert the usage pattern — run the model *constantly, speculatively, and on data you'd never upload*.

**Continuous / speculative (free tokens change the economics)**

1. **Always-On Commit Intelligence** — regenerate a draft commit message and changelog entry on every save/stage event, silently, so it's always ready. No one does this with a metered API.
2. **Ambient TODO/FIXME triage** — background pass that classifies and prioritizes TODOs across the repo nightly, entirely locally.
3. **Speculative refactor whispers** — as you rename a symbol, pre-generate candidate names/doc updates before you even ask.
4. **Per-keystroke semantic lint** — debounce 1–2 s after typing a comment or string and check it for contradiction with the code beneath it.
5. **Zero-cost "explain on hover"** for regexes, cron strings, chmod octals, SQL — cached, instant, no quota anxiety.

**Privacy-radioactive data (content that must never leave the machine)**

6. **Privacy Redactor** — paste production logs / customer emails / stack traces; the local model detects and masks PII/secrets *before* anything is sent to a cloud model or pasted into a ticket. The redaction step itself is only trustworthy because it's local.
7. **Offline Log & Crash Triage** — summarize and cluster gigabytes of local logs, .env-adjacent configs, or proprietary code that policy forbids uploading. Sell this to regulated-industry devs (health, finance, defense).
8. **Secrets-aware code review** — pre-push local review pass that flags hardcoded credentials and risky diffs; the reviewer seeing your secrets is your own Neural Engine.
9. **Local RAG over personal knowledge** — Spotlight-tool-powered Q&A across your own notes, mail exports, and design docs without indexing them to any service.

**Offline / edge (no network dependency)**

10. **Airplane-mode pair programmer** — the headline demo: full chat, commit generation, and doc lookup with Wi-Fi off.
11. **Field/air-gapped mode** — an `offlineOnlyMode` setting that hard-disables PCC and any network path, auditable for air-gapped environments.

**OS-native multimodal (Vision + system tools)**

12. **Screenshot → issue**: drag a screenshot of a UI bug into chat; on-device vision + OCRTool extracts the error text and drafts a reproducible bug report.
13. **Whiteboard → scaffold**: photo of a whiteboard architecture sketch → guided-generation JSON of components → generated folder scaffold.
14. **Semantic File Organizer** — the WWDC file-sorting demo, productized: classify downloads/assets/fixtures by *meaning* into structured moves the user approves.

**Structured-output-native (guided generation as a contract)**

15. **`/schema` workflows** — user defines a schema in chat; every subsequent extraction over selected text returns guaranteed-valid JSON (constrained decoding, not parsing).
16. **Deterministic pipelines** — because output is schema-constrained and free, you can chain many small model calls (classify → extract → verify) like ordinary functions.

**Escalation ladder (unique to Apple's stack)**

17. **On-device → PCC escalation** — model answers locally; if self-assessed confidence is low or context exceeds 8K, offer one-click escalation to the 32K PCC model with `reasoningLevel` — still no API key, still Apple-grade privacy. Dynamic Profiles make this a declarative mode switch that preserves the transcript.

---

## 8. Prompt Engineering for a Small On-Device Model (~3B-class, ~8K window)

1. **Budget explicitly.** Query `contextSize` and `tokenCount` from the bridge at startup; reserve output headroom (e.g., 1.5K); let prompt-tsx prune by priority. Apple's own eval story showed the *detailed* prompt variant failing via context overflow — verbosity is a real failure mode, not just a style issue.
2. **One task per call.** Small models degrade on multi-objective prompts. Decompose: classify → then extract → then draft. Calls are free; chain them.
3. **Schema over prose.** Prefer guided generation for anything a program consumes. Constrained decoding eliminates the "parse the model's markdown" failure class entirely and reduces hallucinated fields.
4. **Few-shot beats instruction-heavy.** 2–3 compact exemplars outperform long rule lists at this scale — and cost fewer tokens.
5. **Ground everything.** Never ask the on-device model open-world factual questions; feed it the diff, the file, the log excerpt. It's a reasoning-over-context engine, not an encyclopedia.
6. **Instructions vs. prompt separation.** Put stable behavior in session `instructions` (cached across turns), volatile content in the prompt.
7. **Measure, don't taste.** Every first-party prompt gets a JSONL dataset and a Python-SDK notebook: generate eval data (optionally with a server model), run variants, judge with rubric functions, chart in matplotlib, and gate CI on the metrics — Apple's recommended loop, verbatim.
8. **Guardrail-aware phrasing.** Avoid prompt framings that trip safety guardrails on benign dev content (e.g., security topics); catch `GUARDRAIL` errors and rephrase or surface a clear message rather than a generic failure.

---

## 9. Streaming Response Design

- Bridge uses `session.streamResponse`; forwards deltas as `$/delta` notifications tagged with request id; final message carries full text + usage (input/cached/output/reasoning token counts — surface these in a status-bar tooltip for transparency).
- Extension maps deltas 1:1 to `progress.report(new LanguageModelTextPart(delta))` (provider path) or `stream.markdown(delta)` (participant path). VS Code's chat renderer handles partial-markdown smoothing.
- **Cancellation is first-class**: `CancellationToken.onCancellationRequested` → JSON-RPC `cancel` → Swift `Task.cancel()`. Test it; abandoned generations on a shared session otherwise poison the transcript.
- Structured output and streaming: stream for chat; for schema-constrained calls prefer non-streaming (apple-local-llm's precedent: `response_format` unsupported with streaming) or stream Apple's *snapshot* partials (progressively-filled `@Generable` fields) for live UI like a filling-in commit form.
- Backpressure: bridge writes are line-buffered and small; coalesce deltas to ≥16 ms cadence to avoid flooding the extension host.

---

## 10. Security & Sandboxing

1. **No network by design.** The extension makes zero network calls in on-device mode; PCC is Apple-managed, opt-in via setting, and clearly labeled. Ship an `offlineOnlyMode` that refuses to construct the PCC model at all. This is auditable and should be stated in the README.
2. **stdio, not localhost.** No open ports; the model surface is private to the parent/child process pair. If you ever add the OpenAI-compat HTTP mode (apfel-style) for interop, bind 127.0.0.1, require a bearer token, and make it off by default.
3. **Binary integrity.** Sign the bridge with Developer ID + Hardened Runtime and notarize; at spawn, verify expected path inside the extension dir and check `codesign --verify` / version handshake to detect tampering or a stale binary after update.
4. **Injection defense.** Treat file/workspace content as untrusted data: delimit it in prompts, and require explicit user confirmation for any tool call that mutates state (file writes, moves, git actions). MCP tools follow least-privilege schemas.
5. **VS Code trust model.** Respect Workspace Trust (no tool execution in untrusted workspaces); declare `extensionKind: ["workspace"]` so the sidecar runs where the workspace runs; degrade cleanly in Remote/SSH sessions (bridge only exists on the local Mac — detect and explain).
6. **Secrets hygiene.** No API keys exist in this architecture — advertise that. Anything you do store (feature flags, session names) goes through `ExtensionContext.secrets`/`globalState`, never files.
7. **Guardrails as a feature.** Apple's safety layer runs on all outputs; surface rejections with actionable copy instead of retrying blindly (retry loops on guardrail errors look like abuse).
8. **Local-only telemetry.** If you measure anything (latency, error rates), store locally and show the user; a privacy-positioned extension with phone-home analytics is self-defeating.

---

## 11. Performance Optimization

- **Keep-warm lifecycle**: spawn on first request, hold the session (model stays resident), idle-shutdown after N minutes (default 5, configurable) to release unified memory; restart transparently.
- **Cold-start masking**: pre-warm the bridge when a chat view opens or a `/commit` context appears likely (staged changes detected), not at VS Code startup.
- **Prompt caching**: stable `instructions` per session are cached by the framework (visible via `usage.input.cachedTokenCount`); design prompts so the invariant prefix is maximal.
- **Coalesce + debounce** speculative features (300 ms–2 s depending on feature); cancel superseded requests instead of queueing.
- **Right-size context**: retrieval features should pass a few *summarized* chunks, not raw files; use `tokenCount` before sending, and split-summarize-merge for oversized inputs (per Apple's context-window technote pattern).
- **Concurrency**: serialize per-session; allow a small parallel pool (2–3) of one-shot sessions for background features so a long chat turn doesn't block commit-message generation.
- **Escalate deliberately**: PCC for genuinely hard/long tasks only — it adds network latency and consumes a capped budget.
- **Measure**: wrap every bridge call with latency histograms; budget (suggested): hover explains < 1.5 s, commit message < 3 s, chat first-token < 800 ms warm.

---

## 12. Packaging, Signing, and Publishing

1. **Build the bridge**: `swift build -c release --arch arm64` (add `x86_64` only if you choose to support Intel via a slower path — recommended: arm64-only, matching Apple Intelligence requirements).
2. **Sign & notarize** in CI: `codesign --force --options runtime --sign "Developer ID Application: …" fm-bridge`, zip, `xcrun notarytool submit --wait`, staple where applicable. Unsigned binaries extracted from a VSIX will be blocked or scare-prompted by Gatekeeper.
3. **Bundle**: esbuild the extension to `dist/extension.js`; place the binary at `bin/fm-bridge`; `.vscodeignore` everything else (Swift sources, evals, tests).
4. **Platform-specific VSIX**: `vsce package --target darwin-arm64` (vsce ≥ 1.99 supports `--target`). Publish only darwin targets; users on other platforms won't be offered the extension build, and your activation gate covers side-loads.
5. **Preserve the executable bit** — a classic VSIX pitfall; verify post-install and `chmod +x` defensively in `binaryLocator.ts`.
6. **Marketplace listing**: category "AI" + "Chat"; badges and README above-the-fold: *No API key · No cloud · Works offline · Your code never leaves your Mac*. Include the airplane-mode GIF and a requirements callout (Apple Silicon, macOS 26+, Apple Intelligence enabled).
7. **Channels**: pre-release (`vsce publish --pre-release`) tracking macOS beta churn (the FoundationModels API surface moved between 26.0 → 26.4 → 27); stable pinned to released macOS APIs. Also publish to Open VSX for VS Code-derivative users (note: model-picker APIs may differ in forks — document that the chat participant works everywhere the API exists).
8. **CI pipeline** (GitHub Actions, `macos-15`): lint/typecheck → unit tests → swift test → build+sign bridge (cert via encrypted secrets) → integration tests via `@vscode/test-electron` → eval smoke suite → package → upload VSIX artifact → tagged publish.

---

## 13. Testing & Evaluation Strategy

| Layer | Tooling | What it proves |
|---|---|---|
| Protocol unit tests | vitest + golden framed transcripts | Framing, cancellation, error mapping — bridge mocked |
| Swift bridge tests | `swift test` + a `MockLanguageModel` conforming to the open-source `LanguageModel` protocol | Router, schema translation, tool dispatch without real inference |
| Integration | `@vscode/test-cli` / `test-electron` on macos-15 | Provider registration, model picker presence, streaming into real Chat view, availability-gate UX |
| Hardware matrix | Manual/CI on macOS 26.4 and 27 beta; Apple Intelligence off; model-downloading state; Intel Mac (expect graceful refusal) | Every availability reason code has correct UX |
| Quality evals | Python SDK (`apple_fm_sdk`) notebooks; JSONL datasets per feature; LLM-as-judge rubrics; matplotlib dashboards; Swift Evaluations framework for in-repo regression gates | Prompt changes don't regress accuracy; per-variant failure modes (overflow, over-generation, misses, hallucination) tracked release-over-release |
| Chaos | Kill the bridge mid-stream; SIGSTOP it; corrupt a frame; fill the context deliberately | Crash-restart, timeout, `CONTEXT_OVERFLOW` paths |
| Performance | Latency histograms in integration runs; assert budgets | No cold-start or flooding regressions |

Non-determinism policy: integration tests assert *structure* (valid schema, non-empty stream, cancellation honored), never exact strings; quality lives in the eval suite with statistical thresholds, not unit asserts.

---

## 14. Potential Challenges & Mitigations

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **API churn across macOS betas** (26 → 26.4 → 27 moved context/token APIs, guardrails, added vision/PCC) | High | Version handshake in the bridge; `#available` guards; pre-release channel; capability flags over version sniffing |
| 2 | **Small-model quality ceiling** — 3B-class model underwhelms on complex codegen | High | Scope features to classification/summarization/extraction/short-drafting; PCC escalation ladder; honest capability map from M0 |
| 3 | **8K context vs. real codebases** | High | Retrieval-then-summarize, prompt-tsx pruning, `tokenCount` pre-flight, `CONTEXT_OVERFLOW` recovery (auto-condense transcript) |
| 4 | **Guardrail false positives** on dev content | Medium | Detect `GUARDRAIL`, rephrase once, then surface clearly; report patterns; keep prompts neutral |
| 5 | **Gatekeeper / signing friction** for the bundled binary | Medium | Notarization in CI from day one; post-install verify + chmod; troubleshooting doc |
| 6 | **Availability fragmentation** (Apple Intelligence off, model not downloaded, region restrictions, managed devices) | Medium | Rich reason-code UX with deep links to System Settings; never a silent failure |
| 7 | **Extension host constraints** (no native modules mismatch, remote workspaces where the Mac is the client) | Medium | Sidecar avoids native Node modules entirely; detect remote and explain local-only requirement; consider UI-extensionKind fallback later |
| 8 | **VS Code fork divergence** (model-provider API availability in derivatives) | Low-Med | Participant + MCP paths as portable fallbacks |
| 9 | **PCC quota surprises** | Low | Off by default; usage display; downgrade-to-on-device on `RATE_LIMITED` |
| 10 | **Memory pressure on 8/16 GB Macs** | Medium | Idle shutdown; single warm session; document footprint; setting to disable background features |

---

## 15. MVP → Production Timeline

```
Phase 0  DISCOVER   Wk 1        M0 spikes, capability map
Phase 1  MVP        Wks 2–6     M1–M3: bridge + chat provider + @apple + 3 features
                                 ▸ Ship criteria: model in picker, streaming chat,
                                   /commit + /explain offline, availability UX
Phase 2  BETA       Wks 7–12    M4–M6: tools, local RAG, MCP server, 3–4 killer
                                 on-device features, eval suites per feature
                                 ▸ Pre-release channel on Marketplace
Phase 3  HARDEN     Wks 13–14   M7: perf budgets met, signing/notarization CI,
                                 security review, offlineOnlyMode
Phase 4  LAUNCH     Wks 15–16   M8: full test matrix green, docs + demo GIF,
                                 stable publish, Open VSX
Phase 5  PRODUCTION ongoing     macOS 27 GA adoption (fm CLI doc integration,
                                 dynamic-profile agent modes, PCC reasoning tiers),
                                 MLXLanguageModel "bring a bigger local model" tier,
                                 community MCP tool catalog
```

MVP definition (end of Phase 1): a Mac developer installs one VSIX, sees "Apple On-Device" in the model picker, chats offline with streaming, and generates a schema-valid conventional commit from staged changes — with no account, key, or setup beyond having Apple Intelligence on.

---

## 16. Key Sources

- Blake Crosley, *Foundation Models from Python: the fm CLI* — https://blakecrosley.com/blog/foundation-models-python-fm-cli (analysis of WWDC26 session 334)
- Apple, WWDC26 session 241 *What's new in the Foundation Models framework* — https://developer.apple.com/videos/play/wwdc2026/241/
- Apple, WWDC26 session 334 *Build AI-powered scripts with the fm CLI and Python SDK* — https://developer.apple.com/videos/play/wwdc2026/334/
- Apple, Foundation Models framework docs — https://developer.apple.com/documentation/foundationmodels ; context-window technote TN3193
- VS Code, Language Model Chat Provider API — https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider (+ microsoft/vscode-extension-samples `chat-model-provider-sample`)
- VS Code, Chat Participant API — https://code.visualstudio.com/api/extension-guides/ai/chat ; Language Model API — /ai/language-model
- VS Code, MCP developer guide — https://code.visualstudio.com/api/extension-guides/ai/mcp
- VS Code, Publishing Extensions (platform-specific `--target`) — https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- parkerduff/apple-local-llm (Swift stdio sidecar precedent) — https://github.com/parkerduff/apple-local-llm
- Arthur-Ficial/apfel (OpenAI-compatible local server precedent) — https://github.com/Arthur-Ficial/apfel
- huggingface/AnyLanguageModel (provider-abstraction fallback) — https://github.com/huggingface/AnyLanguageModel
- Ken Muse, *Beyond MCP: AI Extension APIs in VS Code* and *Adding an MCP Server to a VS Code Extension* — kenmuse.com
