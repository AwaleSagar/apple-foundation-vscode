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

The extension launches its bundled executable by absolute path and sends requests over inherited pipes. The helper selects Apple’s on-device system model. Workspace settings can cap the token budget. The extension stores conversation history in window memory and logs model status without prompts or replies.

The sidebar formats model replies with a local Markdown renderer. It escapes raw HTML and disables image and link parsing. Document comments and commit subjects render as literal text. Drafting a commit reads staged changes through the built-in Git extension. Users review and apply generated text themselves.
