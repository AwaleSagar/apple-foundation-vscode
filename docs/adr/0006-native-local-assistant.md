# ADR-0006 — Bundle the on-device Swift helper

Accepted November 18, 2026. Supersedes ADR-0002.

Use the local Foundation Models framework through a bundled arm64 executable. The system CLI on the test Mac required a machine-wide license decision while the framework served requests directly. The framework also exposes session transcript counts and the runtime context window. The extension owns the helper and its standard I/O pipes.

Keep the language model provider for compatible clients and provide an independent sidebar. Microsoft requires tool calling for agent-picker visibility. The dedicated view allows a signed-out installation to use the text model and editor actions. [VS Code model guide](https://code.visualstudio.com/docs/agent-customization/language-models)

[Runtime evidence and supported versions](../verification-2026-11-18.md)
