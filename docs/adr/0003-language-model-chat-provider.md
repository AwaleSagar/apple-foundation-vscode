# ADR-0003: Integrate via the Language Model Chat Provider API

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

VS Code offers several AI extension surfaces: a custom webview chat, a chat participant
(`@mention`), and the Language Model Chat Provider API (stable as of 2025), which contributes
models to the built-in chat's model picker.

## Decision

Implement `vscode.LanguageModelChatProvider` (vendor `apple-foundation`), contributed through
`contributes.languageModelChatProviders` with a management command. The on-device model appears
as "Apple On-Device" in the native model picker.

## Alternatives considered

- **Custom webview chat UI** — rejected: reinvents streaming UI, history, context attachment,
  and accessibility that the built-in chat already does better; highest maintenance cost.
- **Chat participant only (`@apple`)** — deferred, not rejected: participants complement a model
  provider (slash-commands with editor context) and are on the roadmap, but a participant alone
  would hide the model from normal chat.
- **Proposed/experimental APIs** — rejected: the project targets stable API only so it can ship
  to the Marketplace without insider builds.

## Consequences

- Users keep the chat UX they know; we write zero chat UI.
- The provider contract (model info, streaming parts, token counts) is the only VS Code surface
  to maintain; it is cleanly adapted in `src/providers/`.
- Capabilities we don't have (image input, tool calling) are declared `false` and gated by the
  API rather than failing at runtime.
