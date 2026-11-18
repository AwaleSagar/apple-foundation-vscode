# Changelog

All notable changes to this project are documented in this file.

This changelog is generated automatically by [Changesets](https://github.com/changesets/changesets)
from the changeset entries merged into `main`. Do not edit released sections by hand — add a
changeset with `pnpm changeset` instead.

## 0.2.0

- Added Apple Local Chat, editor selection actions and a staged commit subject action.
- Bundled a native on-device helper for macOS 26+. Model status, streaming, cancellation and token budgeting now use the Foundation Models framework.
- Removed CLI, port, idle-timeout and offline-mode settings. Explicit token caps, provider IDs, participant commands, and restart shortcuts carry forward.

## 0.1.0

### Minor changes

- Initial scaffold: Language Model Chat Provider contributing Apple's on-device Foundation Model
  to the VS Code chat model picker, `afm` bridge process management with health checks and
  streaming (SSE) responses, status/restart/logs/manage commands, and full project tooling
  (pnpm, Biome, strict TypeScript, esbuild, Vitest, Husky, Commitlint, Changesets, Renovate,
  CodeQL, CI/release workflows).
