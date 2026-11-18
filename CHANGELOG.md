# Changelog

## 0.2.2

### Patch Changes

- [`53bbda6`](https://github.com/AwaleSagar/apple-foundation-vscode/commit/53bbda67cd9b28e54aa027b225fc022dcd2efdb4) Thanks [@AwaleSagar](https://github.com/AwaleSagar)! - Redesign the Local Chat sidebar with selection and commit actions, formatted replies, and a keyboard-accessible composer that remembers unsent drafts in the current window.

- [`53bbda6`](https://github.com/AwaleSagar/apple-foundation-vscode/commit/53bbda67cd9b28e54aa027b225fc022dcd2efdb4) Thanks [@AwaleSagar](https://github.com/AwaleSagar)! - Speed up long-chat history trimming and streaming. Bound concurrent native work, release the helper after an idle minute, and recover stalled requests.

## 0.2.1

### Patch Changes

- [`9974f78`](https://github.com/AwaleSagar/apple-foundation-vscode/commit/9974f7857c6e04af27a4fd8b4d0caddca4305fec) Thanks [@AwaleSagar](https://github.com/AwaleSagar)! - Introduce Local Chat by AwaleLabs across the sidebar, extension listing, icon, and setup guide.

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
