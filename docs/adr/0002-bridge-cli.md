# ADR-0002: Bridge via the system `fm` CLI (with `afm` fallback)

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

VS Code extensions execute in Node.js. Apple's `FoundationModels` framework is callable only from
Swift/Objective-C (plus the new Python SDK), so a native bridge process is unavoidable. The
bridge choice shapes packaging, maintenance, and the wire protocol.

Since WWDC26, macOS 27 ships a preinstalled `fm` CLI (`/usr/bin/fm`) whose `fm serve` subcommand
exposes the on-device model (and Private Cloud Compute) through an OpenAI-compatible Chat
Completions server (`/health`, `/v1/models`, `/v1/chat/completions`, TCP or Unix socket). On
macOS 26, no system CLI exists, but the community
[`afm` CLI](https://github.com/scouzi1966/maclocal-api) provides the same protocol
(`brew install scouzi1966/afm/afm`, server on port 9999 via `afm -p <port>`).

## Decision

Spawn a loopback OpenAI-compatible bridge server and speak `/v1/chat/completions` SSE to it:

- **Primary: `fm serve --port <port>`** — zero installation on macOS 27+, first-party, Apple-maintained.
- **Fallback: `afm -p <port>`** — for macOS 26 users, selected simply by pointing
  `appleFoundation.bridge.executablePath` at `afm`; the spawn arguments are derived from the
  executable name (`serverArgsFor`).

The extension resolves the wire model id from `/v1/models` at request time (preferring
`system`), so both bridges work unmodified.

## Alternatives considered

- **Ship our own Swift sidecar binary in the VSIX (stdio JSON-RPC)** — the strongest
  long-term option (persistent sessions, guided generation, tool calling, no external process
  contract), but it adds an Xcode toolchain, signing/notarization, and a native build to every
  release. Deferred until features exceed what the Chat Completions protocol expresses
  (tracked in ROADMAP Phase 3).
- **Node native module (N-API)** — rejected: fragile against Electron/Node ABI churn in VS Code
  updates, and native crashes take the whole extension host down.
- **Single-shot `fm respond` per request** — rejected: process-per-request latency, no
  streaming session reuse, and fragile stdout parsing versus a well-defined HTTP protocol.
- **`fm serve --socket` (Unix socket)** — cleaner isolation than TCP, but `fetch` lacks portable
  Unix-socket support in the extension host; revisit if the port-conflict story ever hurts.

## Consequences

- On macOS 27+ the extension works out of the box with zero third-party installs.
- Repository stays 100% TypeScript; contributions don't require Xcode.
- The OpenAI-compatible protocol keeps the client boring, and a future Swift sidecar can keep
  the same wire format during migration.
- Trust boundary: whatever listens on the configured loopback port is treated as the user's
  bridge (documented in SECURITY.md).
