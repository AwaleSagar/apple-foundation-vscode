# Changelog

## 0.2.0

### Minor Changes

- [`adcec6d`](https://github.com/AwaleSagar/apple-foundation-vscode/commit/adcec6d2ab789cebba01262b84617705457efcfd) Thanks [@AwaleSagar](https://github.com/AwaleSagar)! - Production hardening: status bar bridge-health indicator with management quick-pick,
  `appleFoundation.offlineOnlyMode` (machine-enforced on-device-only model resolution for
  air-gapped environments), a Get Started walkthrough, localization scaffolding
  (`package.nls.json`) for every contributed string, and an Extension Host integration test
  suite (`pnpm run test:vscode`) running in CI against a real VS Code build. Also hardens the
  bridge client with per-instance wire-model caching and a non-spawning health probe.

All notable changes to this project are documented in this file.

This changelog is generated automatically by [Changesets](https://github.com/changesets/changesets)
from the changeset entries merged into `main`. Do not edit released sections by hand — add a
changeset with `pnpm changeset` instead.

## Unreleased

### Features

- Context budgeting: `fitMessagesToBudget` trims long threads/selections to the on-device window
  (`appleFoundation.model.maxContextTokens`).
- Multi-turn `@apple` free-form chat reuses VS Code chat history.
- Typed bridge errors (`GUARDRAIL`, `CONTEXT_OVERFLOW`, `BRIDGE_TIMEOUT`, …) with actionable UX.
- Guided setup on first activation + **Run Setup Check** command.
- Bridge idle shutdown for processes the extension owns
  (`appleFoundation.bridge.idleTimeoutMinutes`, default 5).
- Status diagnostics surface `fm token-count` when available.
- Live `fm serve` integration tests + expanded unit coverage (91 tests).

### Security

- `fm serve` is spawned with `--host 127.0.0.1` so the bridge binds to loopback only.

## 0.1.0

### Minor changes

- Initial scaffold: Language Model Chat Provider contributing Apple's on-device Foundation Model
  to the VS Code chat model picker, `afm` bridge process management with health checks and
  streaming (SSE) responses, status/restart/logs/manage commands, and full project tooling
  (pnpm, Biome, strict TypeScript, esbuild, Vitest, Husky, Commitlint, Changesets, Renovate,
  CodeQL, CI/release workflows).
