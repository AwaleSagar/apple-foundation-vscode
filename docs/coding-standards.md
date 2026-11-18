# Coding standards

The enforceable rules live in `biome.json` and `tsconfig.json`; if a rule matters, it is
automated. This document covers the judgment calls tools can't check.

## Language & style

- Use strict TypeScript in the extension host and Swift in the native helper. No `any` (Biome errors), no
  non-null assertions — model the uncertainty instead.
- `verbatimModuleSyntax` is on: use `import type` for types.
- No `console.*` in `src/` (Biome errors) — use the extension’s log output channel for user-visible diagnostics.
- Formatting is Biome's job. Never hand-format; never discuss formatting in review.

## Naming conventions

| Thing | Convention | Example |
| --- | --- | --- |
| Files | camelCase, suffix by role | `chatProvider.ts`, `client.test.ts` |
| Classes | PascalCase noun | `NativeClient` |
| Functions | camelCase verb phrase | `readLimits`, `toMessages` |
| Constants | SCREAMING_SNAKE for module constants | `MIN_DARWIN_MAJOR` |
| VS Code contributions | `appleFoundation.` prefix | `appleFoundation.showStatus` |
| Settings | `appleFoundation.<area>.<name>` | `appleFoundation.model.maxOutputTokens` |

Units go in names: `timeoutMs`, `maxOutputTokens`, never bare `timeout`.

## Folder organization

The Swift helper in `native/` owns model sessions and token budgeting. Its TypeScript client in
`src/native/` manages the process and request protocol. Keep VS Code UI concerns in the sidebar,
chat participant, and provider. Put shared settings and history handling in `src/core/`.

## Error handling

- Errors a user can fix must say how (install command, setting name, System Settings path).
- Use `Error` subtypes only when a caller branches on them; otherwise a clear message suffices.
- Cancellation is a normal outcome, not an error — never surface it as a failure.
- Catch narrowly: `catch` at the boundary that can add context or present UI, not in every helper.

## Comments & docs

- Comments state constraints and non-obvious *why* ("only kills processes it spawned"), never
  narrate the code.
- Public settings/commands get user-grade descriptions in `package.json` — they render in the UI.
- Behavior change ⇒ same-PR doc update (README tables, docs/, setting descriptions).

## Dependency management

- **Runtime dependencies: zero is the target.** Every proposed runtime dep needs a reason the
  platform (Node 22+ globals, VS Code API) can't do it. `fetch`, `AbortSignal.timeout`,
  `node:child_process` cover a lot.
- Dev dependencies are fair game but consolidated (Biome over five lint plugins).
- Renovate keeps everything current in weekly batches; security bumps land immediately.
- `@types/vscode` tracks the **minimum** supported engine, not latest (pinned in Renovate config).
