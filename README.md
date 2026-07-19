# Apple Foundation Models for VS Code

Puts Apple's on-device Foundation Model into VS Code Chat. Inference runs on your Mac; the extension does not call a cloud API for completions.

[![CI](https://github.com/AwaleSagar/apple-foundation-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/AwaleSagar/apple-foundation-vscode/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS%2026%2B%20(Apple%20Silicon)-black?logo=apple)](#requirements)

## Install

You need macOS 26 or later, Apple Silicon, Apple Intelligence enabled, and VS Code 1.104+.

**Bridge CLI**

- **macOS 27+** — use the system `fm` CLI (no extra install).
- **macOS 26** — install the community bridge and point the extension at it:

  ```sh
  brew install scouzi1966/afm/afm
  ```

  Set `appleFoundation.bridge.executablePath` to `afm`.

**Extension**

- Marketplace (when published): search for “Apple Foundation Models”.
- Or install a [release VSIX](https://github.com/AwaleSagar/apple-foundation-vscode/releases):

  ```sh
  code --install-extension apple-foundation-vscode-*.vsix
  ```

Open Chat, open the model picker, choose **Apple On-Device**. There is also a short Get Started walkthrough under VS Code’s Welcome view.

## Use

| What | How |
| --- | --- |
| Chat with the model | Pick **Apple On-Device** in the Chat model menu |
| Explain / document / commit | `@apple` in Chat, then `/explain`, `/doc`, or `/commit` |
| Commit from staged changes | `@apple /commit` (uses the Git extension’s staged diff) |
| Free-form multi-turn | `@apple` without a slash command; prior turns in the thread are included |
| Check health | Command Palette → **Apple Foundation Models: Show Status** |
| Logs | **Apple Foundation Models: Show Logs** |
| Setup again | **Apple Foundation Models: Run Setup Check** |

`/commit` needs a local git repo with staged changes. The status bar item shows bridge state when the host is supported; click it for manage actions.

## Requirements

| Requirement | Why |
| --- | --- |
| macOS 26 (Tahoe) or later | `FoundationModels` ships with macOS 26 |
| Apple Silicon | On-device model runs on the Neural Engine |
| Apple Intelligence enabled | System Settings → Apple Intelligence & Siri |
| VS Code ≥ 1.104 | Stable Language Model Chat Provider API |
| Bridge CLI | `fm` on macOS 27+; [`afm`](https://github.com/scouzi1966/maclocal-api) on macOS 26 |

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| `appleFoundation.bridge.executablePath` | `fm` | Machine-scoped. Use `afm` on macOS 26 |
| `appleFoundation.bridge.port` | `9999` | Loopback only (`127.0.0.1`) |
| `appleFoundation.bridge.autoStart` | `true` | Spawn the bridge when Chat needs it |
| `appleFoundation.bridge.idleTimeoutMinutes` | `5` | Stop a process this extension started; `0` keeps it warm. Never kills a bridge you started yourself |
| `appleFoundation.model.maxOutputTokens` | `1024` | Cap on generated tokens |
| `appleFoundation.model.maxContextTokens` | `4096` | Shared input+output budget used for trimming |
| `appleFoundation.offlineOnlyMode` | `false` | Refuse any wire model other than on-device `system` |

## How it works

VS Code loads this extension as a [Language Model Chat Provider](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider). Chat requests go to a local OpenAI-compatible server on `127.0.0.1` (`fm serve` or `afm`). That process talks to Apple’s `FoundationModels` framework. The extension starts the bridge when needed, reuses one already listening on the configured port, and can stop a process it owns after idle time.

```mermaid
flowchart LR
  Chat[VS Code Chat] --> Ext[Extension]
  Ext -->|HTTP SSE on 127.0.0.1| Bridge["fm serve / afm"]
  Bridge --> FM[FoundationModels]
```

Longer write-up: [ARCHITECTURE.md](https://github.com/AwaleSagar/apple-foundation-vscode/blob/main/ARCHITECTURE.md). Design choices live under [docs/adr/](https://github.com/AwaleSagar/apple-foundation-vscode/tree/main/docs/adr).

## Limits

This is Apple’s small on-device model, not a frontier cloud model. Expect a shared context window on the order of a few thousand tokens (default budget here is 4096; the real window depends on OS/model version). Good fit for explain, short docs, and commit messages. Weak fit for large refactors or long-agent runs.

The extension trims oversized history and selections before sending. Safety guardrails can still reject a prompt or answer; the UI surfaces that instead of spinning forever.

If you need a hard “on-device only” policy, turn on `appleFoundation.offlineOnlyMode`.

## Troubleshooting

| Symptom | What to try |
| --- | --- |
| Model missing from the picker | macOS 26+, arm64, Apple Intelligence on |
| Bridge executable not found | macOS 27: `which fm`. macOS 26: install `afm` and set `executablePath` |
| Bridge won’t start | `lsof -i :9999`, change the port, or run `fm available` |
| Empty or failed replies | `fm respond "hello"` in a terminal; then **Show Logs** |
| Still stuck | [Open an issue](https://github.com/AwaleSagar/apple-foundation-vscode/issues) with log output |

## Develop

```sh
git clone https://github.com/AwaleSagar/apple-foundation-vscode.git
cd apple-foundation-vscode
corepack enable
pnpm install
pnpm run verify
```

Press **F5** for an Extension Development Host. Day-to-day details: [DEVELOPMENT.md](https://github.com/AwaleSagar/apple-foundation-vscode/blob/main/DEVELOPMENT.md).

Tests: unit suite (`pnpm test`), optional live `fm serve` checks when the CLI is present, and Extension Host tests (`pnpm run test:vscode`). See [docs/testing-strategy.md](https://github.com/AwaleSagar/apple-foundation-vscode/blob/main/docs/testing-strategy.md).

Releases are changeset-driven; packaging is `darwin-arm64` only. Process notes: [docs/release-process.md](https://github.com/AwaleSagar/apple-foundation-vscode/blob/main/docs/release-process.md).

## FAQ

**Why only macOS?** The framework only exists on Apple platforms. Forcing Windows/Linux would mean dropping the on-device model. [ADR-0001](https://github.com/AwaleSagar/apple-foundation-vscode/blob/main/docs/adr/0001-macos-only-on-device-scope.md).

**Does code leave the machine for inference?** No. Traffic stays on loopback to the local bridge. Details: [SECURITY.md](https://github.com/AwaleSagar/apple-foundation-vscode/blob/main/SECURITY.md).

**Why is there a bridge process?** Extensions run in Node; Apple’s API is Swift-side. `fm serve` (or `afm`) is the HTTP front end. [ADR-0002](https://github.com/AwaleSagar/apple-foundation-vscode/blob/main/docs/adr/0002-bridge-cli.md).

**Does this work next to Copilot Chat?** Yes. The model shows up in the normal Chat model picker.

## What’s next

Tracked in [ROADMAP.md](https://github.com/AwaleSagar/apple-foundation-vscode/blob/main/ROADMAP.md). Near-term interest is tools, local RAG, and optional Private Cloud Compute as a separate, opt-in model.

## Contributing

See [CONTRIBUTING.md](https://github.com/AwaleSagar/apple-foundation-vscode/blob/main/CONTRIBUTING.md). AI-assisted patches are fine if they follow the same bar: [docs/ai-collaboration.md](https://github.com/AwaleSagar/apple-foundation-vscode/blob/main/docs/ai-collaboration.md).

## License

[MIT](LICENSE) © Sagar Awale

Credits: Apple’s [Foundation Models](https://developer.apple.com/documentation/foundationmodels) and `fm` CLI; [scouzi1966/maclocal-api](https://github.com/scouzi1966/maclocal-api) for the macOS 26 `afm` bridge; VS Code’s Language Model Chat Provider API.
