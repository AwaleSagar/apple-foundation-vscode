# AI collaboration guidelines

This project welcomes AI-assisted development — it would be odd not to, for an extension whose
whole purpose is AI-assisted development. These guidelines keep it healthy.

## For human contributors using AI tools

1. **You are the author.** Whatever produced the first draft, you submit it, you understand it,
   and you can defend every line in review. "The model wrote it" is never an explanation.
2. **Verify, don't trust.** AI-generated code must pass `pnpm run verify` and, for anything on
   the bridge/provider path, be exercised in the Extension Development Host. AI-generated *facts*
   (API shapes, version numbers, macOS behavior) must be checked against primary docs — models
   confidently invent VS Code APIs.
3. **Disclose substantial assistance** in the PR description (a sentence is enough). This isn't
   gatekeeping — it tells reviewers where to look harder (hallucinated APIs, subtly wrong error
   handling, plausible-but-stale idioms).
4. **Keep diffs reviewable.** AI makes it cheap to generate large changes; review capacity is
   still the bottleneck. One concern per PR, same as always.
5. **Never paste secrets or private code** into cloud AI tools. On-device tools (like this
   extension!) are exempt from that concern by construction.

## For AI agents working in this repository

- Read [ARCHITECTURE.md](../ARCHITECTURE.md) and [coding-standards.md](coding-standards.md)
  before editing; respect the layer direction (`core` ← `bridge` ← `providers`/`commands`).
- Run `pnpm run verify` before declaring work done; report failures honestly.
- Do not add runtime dependencies, network calls on the inference path, or telemetry — these are
  hard project constraints, not style preferences.
- Match the existing code's comment density and naming; don't annotate changes with
  meta-commentary about the change itself.
- Update docs in the same change when behavior shifts; add an ADR when rejecting a real
  architectural alternative.

## Review posture for AI-assisted PRs

Reviewers treat AI-assisted PRs identically to human ones, with extra attention to:

- APIs that don't exist or are proposed-only (check against `@types/vscode`)
- Error paths that swallow context, and tests that assert implementation rather than behavior
- Subtle license contamination (large verbatim blocks from other projects)
