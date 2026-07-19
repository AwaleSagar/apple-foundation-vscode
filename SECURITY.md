# Security Policy

## Supported versions

Only the latest release receives security fixes.

| Version | Supported |
| --- | --- |
| latest 0.x / 1.x release | ✅ |
| anything older | ❌ |

## Reporting a vulnerability

**Do not open a public issue.** Please report privately via
[GitHub Security Advisories](https://github.com/AwaleSagar/apple-foundation-vscode/security/advisories/new).

You can expect an acknowledgement within 72 hours and a fix or mitigation plan within 14 days for
confirmed issues. Credit is given in the release notes unless you prefer otherwise.

## Security model

This extension's core promise is privacy, so its attack surface is deliberately tiny:

- **No network egress.** The extension communicates only with a bridge server on `127.0.0.1`.
  When this extension starts `fm serve`, it passes `--host 127.0.0.1` so the process binds
  loopback-only. There is no telemetry, no update pinging, no cloud inference. Any PR adding
  an outbound network call to the inference path is rejected on principle.
- **Offline-only mode.** `appleFoundation.offlineOnlyMode` makes the on-device guarantee
  machine-enforced: model resolution refuses anything except the on-device `system` model,
  even if a bridge advertises alternatives (such as Apple's Private Cloud Compute). Suitable
  for air-gapped or policy-restricted environments; the enforcement lives in one auditable
  function (`resolveWireModel`).
- **Process spawning.** The only spawned executable is the user-configured
  `appleFoundation.bridge.executablePath` (default: the system `fm` CLI), executed with an
  argument array and no shell, so settings cannot inject shell syntax. The setting (and the
  bridge port) is **machine-scoped**: a workspace or repository can never override which binary
  is spawned or where traffic goes — only the user's own settings can. Users should still treat
  it like their `PATH`: pointing it at a malicious binary is equivalent to running that binary.
- **Loopback server trust.** The bridge port is user-configurable; the extension assumes
  whatever answers on that loopback port is the user's chosen bridge. It never sends anything to
  it other than the chat content the user typed.
- **Dependencies.** Runtime dependency count is intentionally zero (everything is bundled dev
  tooling). Renovate raises weekly update PRs; security advisories are raised immediately;
  CodeQL scans every PR and a weekly schedule.
- **Supply chain.** `pnpm-lock.yaml` is committed, CI installs with `--frozen-lockfile`, and
  releases are built from CI, not laptops.

## Hardening recommendations for users

- On macOS 26, install the fallback `afm` bridge only from its official tap:
  `brew install scouzi1966/afm/afm`. On macOS 27+ no third-party bridge is needed.
- Keep macOS updated; the Foundation Models framework is patched through OS updates.
- Review the extension's settings if you share machine profiles across a team.
