# Contributing

To set up a development environment or understand the on-device inference path, start with the
[development guide](DEVELOPMENT.md) and [architecture overview](ARCHITECTURE.md).

## Ground rules

- Be kind. We follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- **The inference path stays on-device.** PRs that add network calls to the chat/completion path
  will not be merged, regardless of how useful the feature is. This is the project's core promise.
- Discuss significant changes in an issue before writing code. Small fixes can go straight to a PR.
- AI-assisted contributions are welcome and must follow
  [docs/ai-collaboration.md](docs/ai-collaboration.md) — in short: you are the author, you must
  understand and have tested everything you submit.

## Branching strategy

Trunk-based development:

- `main` is the only long-lived branch and must always be releasable (CI enforces this).
- Work happens on short-lived topic branches: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`,
  `chore/<topic>`.
- PRs merge into `main` via **squash merge**. The squash commit message must follow
  Conventional Commits (usually the PR title).
- No release branches; releases are cut from `main` by the Changesets workflow.

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint in a
Git hook and in CI:

```
feat(chat): add local conversation history
fix(provider): report cancellation without surfacing an error
docs: clarify Apple Intelligence requirement
chore(ci): pin macos runner image
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`, `revert`.

## Changesets

Any user-visible change needs a changeset (it drives versioning and the changelog):

```sh
pnpm changeset
```

- `patch` — bug fixes, doc-visible tweaks
- `minor` — new features, new settings
- `major` — breaking changes (settings removed/renamed, behavior changes)

Internal-only changes (CI, refactors, tests) do not need a changeset.

## Pull request checklist

1. `pnpm run verify` passes (Biome + typecheck + Vitest).
2. Commits follow Conventional Commits.
3. Changeset added if user-visible.
4. Docs updated where behavior changed (README tables, setting descriptions, docs/).
5. For changes to the native helper or model provider, exercise the affected workflow in the
   Extension Development Host on an eligible Mac. Record the result or any test limitation in the PR.

Every PR needs one approving review. Maintainers may push small fixups to your branch to get a
PR over the line.

## Reporting bugs & requesting features

Use the issue templates — the environment details they ask for (macOS version, model status,
Apple Intelligence status) are usually the whole diagnosis. Security issues go through
[SECURITY.md](SECURITY.md), never public issues.

## Project standards

- Coding standards & naming conventions: [docs/coding-standards.md](docs/coding-standards.md)
- Testing strategy: [docs/testing-strategy.md](docs/testing-strategy.md)
- Release process: [docs/release-process.md](docs/release-process.md)
- Architectural decisions: [docs/adr/](docs/adr/)
