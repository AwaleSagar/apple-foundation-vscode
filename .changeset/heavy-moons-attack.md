---
"apple-foundation-vscode": minor
---

Production hardening: status bar bridge-health indicator with management quick-pick,
`appleFoundation.offlineOnlyMode` (machine-enforced on-device-only model resolution for
air-gapped environments), a Get Started walkthrough, localization scaffolding
(`package.nls.json`) for every contributed string, and an Extension Host integration test
suite (`pnpm run test:vscode`) running in CI against a real VS Code build. Also hardens the
bridge client with per-instance wire-model caching and a non-spawning health probe.
