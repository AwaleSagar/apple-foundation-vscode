# ADR-0004: pnpm + Biome + esbuild + Vitest toolchain

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

A 2026 greenfield TypeScript project has mature, fast alternatives to the traditional
npm + ESLint + Prettier + webpack + Jest stack. The toolchain should be fast, low-config, and
boring to maintain for a small contributor base.

## Decision

- **Node 24 LTS** (pinned in `.node-version`; supported until April 2028)
- **pnpm 11** (pinned via `packageManager` + Corepack; strict, fast, content-addressed store)
- **TypeScript 5.9, maximal strictness** (`strict` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, etc.)
- **Biome 2** for both linting and formatting (single tool, single config, ~10–25× faster than
  ESLint + Prettier; current community recommendation for new projects)
- **esbuild** for bundling the extension to a single CJS file (`dist/extension.js`), the pattern
  used by VS Code's own extension samples
- **Vitest 3** for unit tests with V8 coverage; the `vscode` module is aliased to a stub

## Alternatives considered

- **ESLint + Prettier** — rejected for a greenfield repo: two tools, four config files, slower;
  their ecosystem advantage (framework-specific plugin depth) doesn't apply to a small extension.
- **npm / yarn** — rejected: pnpm's strictness catches phantom dependencies, and `engine-strict`
  + lockfile give reproducibility; npm workspaces offer nothing extra here.
- **webpack** — rejected: slower, more config, no benefit for a Node-target single-entry bundle.
- **Jest** — rejected: Vitest is faster, ESM-native, and config-compatible with the bundler era.
- **Mocha + @vscode/test-electron only** — insufficient alone: integration tests are planned
  (roadmap) but unit tests need to run in milliseconds without an editor download.

## Consequences

- One-command verification (`pnpm run verify`) is fast enough to run pre-push.
- Biome cannot run type-aware lint rules the way typescript-eslint can; strict `tsc --noEmit` in
  the same gate covers that class of issue.
- Contributors need Corepack enabled once (`corepack enable`); after that versions self-pin.
