# ADR-0001: macOS-only, on-device-only scope

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

AI chat extensions typically maximize reach: every OS, every model provider, cloud fallbacks.
Apple's `FoundationModels` framework exists only on Apple platforms (macOS 26+, Apple Silicon)
and runs entirely on-device. We had to decide whether to treat that as a limitation to work
around or as the product.

## Decision

The extension is macOS-only and on-device-only, permanently. No cloud fallback, no cross-platform
shims, no telemetry. The VSIX is published solely for the `darwin-arm64` target, and unsupported
hosts see no model in the picker rather than a broken experience.

## Alternatives considered

- **Cloud fallback for unsupported machines** — rejected: it silently breaks the privacy promise
  the extension exists to make, and the "which model am I talking to?" ambiguity is worse than a
  clear requirement.
- **Cross-platform with local models via Ollama/MLX** — rejected: well-served by existing
  extensions; supporting them would dilute the native integration (Neural Engine, zero setup
  beyond one brew install) that differentiates this project.

## Consequences

- Dramatically smaller support/test matrix; availability gating is a few pure functions.
- The Marketplace audience is smaller, and CI must run on macOS runners for packaging fidelity.
- If Apple ships the framework on more platforms, only `checkHost` and the publish targets change.
