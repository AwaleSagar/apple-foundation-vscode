# Coding standards

The enforceable rules live in `biome.json` and `tsconfig.json`; if a rule matters, it is
automated. This document covers the judgment calls tools can't check.

## Language & style

- TypeScript only, strict mode with all extra safety flags on. No `any` (Biome errors), no
  non-null assertions — model the uncertainty instead.
- `verbatimModuleSyntax` is on: use `import type` for types.
- No `console.*` in `src/` (Biome errors) — log through the `Logger` interface so output lands
  in the user-visible channel at the right level.
- Formatting is Biome's job. Never hand-format; never discuss formatting in review.

## Naming conventions

| Thing | Convention | Example |
| --- | --- | --- |
| Files | camelCase, suffix by role | `afmClient.ts`, `chatProvider.ts`, `sse.test.ts` |
| Classes | PascalCase noun | `AfmServerManager` |
| Functions | camelCase verb phrase | `readBridgeConfig`, `toBridgeMessages` |
| Constants | SCREAMING_SNAKE for module constants | `STARTUP_TIMEOUT_MS` |
| VS Code contributions | `appleFoundation.` prefix | `appleFoundation.showStatus` |
| Settings | `appleFoundation.<area>.<name>` | `appleFoundation.bridge.port` |

Units go in names: `timeoutMs`, `maxOutputTokens`, never bare `timeout`.

## Folder organization

`core` → `bridge` → `providers`/`commands` → `extension.ts`, dependencies point strictly left.
New code goes in the leftmost layer that can host it: logic that doesn't need VS Code APIs is a
pure function in `core`/`bridge` (unit-testable); VS Code adaptation stays thin in
`providers`/`commands`. If a module needs both, split it (see `messages.ts` vs `chatProvider.ts`).

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
