# Documentation index

| Document | What it covers |
| --- | --- |
| [../README.md](../README.md) | Project overview, installation, usage, FAQ, troubleshooting |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | System design, module boundaries, key flows |
| [../DEVELOPMENT.md](../DEVELOPMENT.md) | Environment setup, debugging, quality gates |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Branching, commits, changesets, PR process |
| [../ROADMAP.md](../ROADMAP.md) | Planned phases and non-goals |
| [../apple-fm-vscode-extension-roadmap.md](../apple-fm-vscode-extension-roadmap.md) | Full research document: 2026 landscape, architecture options, M0–M8 plan, risks |
| [../SECURITY.md](../SECURITY.md) | Security model and vulnerability reporting |
| [coding-standards.md](coding-standards.md) | Code style, naming, folder organization, dependency policy |
| [testing-strategy.md](testing-strategy.md) | What we test where, and why |
| [release-process.md](release-process.md) | How a change becomes a release |
| [ai-collaboration.md](ai-collaboration.md) | Guidelines for AI-assisted contributions |
| [adr/](adr/) | Architecture Decision Records |

## Documentation guidelines

- **Docs live next to what they describe.** Behavior → README tables and setting descriptions;
  design rationale → ADRs; process → this directory. Don't duplicate — link.
- **Every architectural decision gets an ADR** when a real alternative was rejected. Use
  [adr/template.md](adr/template.md). ADRs are immutable once accepted; supersede, don't edit.
- **Update docs in the same PR as the change.** A behavior change with stale docs is an
  incomplete change; reviewers should block on it.
- **Write for the reader who just arrived.** Spell out acronyms once, link the first mention of
  a tool, prefer complete sentences over fragments.
- Screenshots go in [assets/](assets/) and are referenced with relative paths.
