# Development guide

Everything you need to go from `git clone` to debugging the extension.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| macOS | 26 (Tahoe)+ | Required to actually run inference; the code builds anywhere |
| Node.js | 24 LTS | Pinned in [`.node-version`](.node-version); use fnm/mise/nvm |
| pnpm | 11 | `corepack enable` picks up the pinned `packageManager` |
| VS Code | ≥ 1.104 | Stable LM Chat Provider API |
| Bridge CLI | — | macOS 27+: preinstalled `fm`. macOS 26: `brew install scouzi1966/afm/afm` (only needed to run inference) |

> You can develop, lint, typecheck, unit-test, and build on any OS — only end-to-end inference
> needs Apple hardware.

## Setup

```sh
git clone https://github.com/AwaleSagar/apple-foundation-vscode.git
cd apple-foundation-vscode
corepack enable       # activates pnpm 11 from package.json's packageManager field
pnpm install          # also installs Git hooks via husky
pnpm run verify       # lint + typecheck + tests — should pass on a fresh clone
```

## Day-to-day workflow

1. Branch: `git switch -c feat/my-topic`
2. Run `pnpm run watch` (or just press **F5**, which starts it as the default build task).
3. **F5** opens the Extension Development Host with the extension loaded. Reload the window
   (`Cmd+R` in the dev host) after each rebuild.
4. Test in the dev host: open Chat, pick **Apple On-Device**, send a prompt.
5. `pnpm run verify` before pushing. The pre-commit hook runs Biome on staged files and
   commit-msg runs commitlint, so most CI failures are caught locally.

## Debugging

- Breakpoints work in `src/**` via source maps (`launch.json` is checked in).
- The **Apple Foundation Models** output channel logs extension events and the bridge's
  stdout/stderr. `Apple Foundation Models: Show Logs` opens it.
- To debug the bridge in isolation: `fm serve --port 9999`, then
  `curl 127.0.0.1:9999/health`, `curl 127.0.0.1:9999/v1/models`, and
  `curl -N 127.0.0.1:9999/v1/chat/completions -d '{"model":"system","stream":true,"messages":[{"role":"user","content":"hi"}]}'`.
  `fm available` reports whether the on-device model is usable at all.
- Simulate "unsupported host" paths by editing the values returned by `currentHostInfo` in a
  scratch branch, or unit-test them directly (`availability.test.ts`).

## Project layout

```
src/
  extension.ts        # composition root (activate/deactivate)
  core/               # leaf utilities: config, logger, availability
  bridge/             # bridge process + HTTP/SSE client (no vscode UI imports)
  providers/          # LanguageModelChatProvider implementation
  commands/           # command registrations
  test/mocks/         # `vscode` stub used by vitest
docs/                 # ADRs, standards, process docs
.github/              # CI, CodeQL, release, issue/PR templates
```

## Quality gates

| Gate | Local | CI |
| --- | --- | --- |
| Format + lint (Biome) | pre-commit hook, `pnpm run check` | `verify` job |
| Types (strict tsc) | `pnpm run typecheck` | `verify` job |
| Unit tests (Vitest) | `pnpm run test` | `verify` job with coverage |
| Commit format | commit-msg hook | `commitlint` job |
| Static security | — | CodeQL workflow |
| Packaging sanity | `pnpm run package` | VSIX built and uploaded as artifact |

## Packaging locally

```sh
pnpm run package      # produces apple-foundation-vscode-<version>.vsix (darwin-arm64)
code --install-extension apple-foundation-vscode-*.vsix
```

## Troubleshooting development issues

| Problem | Fix |
| --- | --- |
| `pnpm install` rejects Node version | Install Node 24 (`.node-version`); `engine-strict` is on |
| Hooks not running | `pnpm run prepare` re-installs husky hooks |
| F5 launches but extension missing | Check the watch task output for esbuild errors |
| Vitest can't resolve `vscode` | Import paths must stay within `src/`; the alias maps `vscode` to `src/test/mocks/vscode.ts` |
