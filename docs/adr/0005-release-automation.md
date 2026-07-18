# ADR-0005: Changesets-driven release automation

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

Releases need predictable versioning, a human-readable changelog, and zero laptop-built
artifacts. The two mainstream options are semantic-release (fully commit-message-driven) and
Changesets (explicit intent files reviewed in PRs).

## Decision

Use **Changesets**: contributors add a changeset file describing the semver impact; the
`changesets/action` workflow on `main` maintains a rolling "Version Packages" PR; merging it
bumps the version, rewrites CHANGELOG.md, tags, and the workflow packages the `darwin-arm64`
VSIX and attaches it to the GitHub Release. Marketplace publishing stays a commented-out manual
gate until the publisher account exists.

## Alternatives considered

- **semantic-release** — rejected: version bumps become an invisible side effect of commit
  phrasing; squash merges make intent reconstruction fragile; no natural place to write
  user-facing release notes distinct from commit subjects.
- **Manual releases** — rejected: error-prone, laptop-dependent, and the changelog rots.

## Consequences

- Semver impact is reviewable in the PR diff, and internal changes cleanly produce no release.
- Contributors must remember changesets; the PR template checklist and CONTRIBUTING.md teach it.
- Conventional Commits remain purely a readability/history convention (enforced by commitlint)
  and are decoupled from versioning — the two systems can't fight each other.
