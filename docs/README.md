# Project documentation

## Using the extension

- Install the VSIX and try the editor and Source Control actions. [Getting started](../README.md)
- Manage chat history, adjust token limits, troubleshoot the model, or upgrade from 0.1. [User guide](user-guide.md)
- Check the devices and VS Code versions tested for 0.2.0, with measured response times and prompt results. [Verification report](verification-2026-11-18.md)
- Read about local inference, data handling, and private vulnerability reporting. [Security policy](../SECURITY.md)

## Identity

Use the [Local Chat brand kit](brand/README.md) for artwork, listing copy, and naming.

## Building and contributing

| Task | Guide |
| --- | --- |
| Build, debug, or package the extension | [Development](../DEVELOPMENT.md) |
| Follow a request from VS Code to the Swift helper | [Architecture](../ARCHITECTURE.md) · [Native helper decision](adr/0006-native-local-assistant.md) |
| Run the extension-host tests and on-device evaluations | [Testing](testing-strategy.md) |
| Prepare a pull request | [Contributing](../CONTRIBUTING.md) · [Coding standards](coding-standards.md) · [AI-assisted contributions](ai-collaboration.md) |
| Cut a release | [Release process](release-process.md) · [Changelog](../CHANGELOG.md) |

## Design history

The July 2026 research and roadmap describe the earlier CLI-based design. The verification report above records what shipped in 0.2.0. [Original roadmap](../ROADMAP.md) · [Research notes](../apple-fm-vscode-extension-roadmap.md) · [Framework reference](apple-fm-reference.md)

Update the relevant guide alongside a behavior change. Keep accepted architecture decision records as a history of the project and add a superseding record when a decision changes. [Decision records](adr/) · [Decision template](adr/template.md)
