# Release process

Releases are automated with [Changesets](https://github.com/changesets/changesets) and GitHub
Actions. Rationale: [ADR-0005](adr/0005-release-automation.md).

## How a change becomes a release

```mermaid
flowchart LR
    PR[Feature PR\n+ changeset file] -->|squash merge| Main[main]
    Main -->|changesets action| VP[Version Packages PR\nversion bump + CHANGELOG]
    VP -->|maintainer merges| Tag[Git tag\napple-foundation-vscode@X.Y.Z]
    Tag --> VSIX[CI builds darwin-arm64 VSIX\nattached to GitHub Release]
    VSIX -.manual gate.-> MP[VS Code Marketplace]
```

1. **Contributor** adds a changeset (`pnpm changeset`) in the feature PR describing the semver
   impact (`patch`/`minor`/`major`) and user-facing notes.
2. On merge to `main`, the release workflow runs `pnpm run verify`, then the Changesets action
   creates or updates a **"Version Packages" PR** that accumulates pending changesets, bumps
   `package.json`, and rewrites `CHANGELOG.md`.
3. **A maintainer merges the Version Packages PR** — this is the release decision. The workflow
   tags `apple-foundation-vscode@X.Y.Z`, packages the VSIX, and uploads it to the GitHub Release.
4. **Marketplace publish** is currently a manual step (commented out in
   `.github/workflows/release.yml`) until the publisher account and `VSCE_PAT` secret are
   provisioned. To enable: create the publisher, add the secret, uncomment the step.

## Versioning policy

- Semver from the user's perspective: settings, commands, and visible behavior are the API.
- Pre-1.0, breaking changes bump minor (standard semver 0.x rules); we still write migration
  notes in the changeset.

## Hotfixes

Same pipeline — a `fix/` branch with a `patch` changeset, merged twice (feature PR, then Version
Packages PR). No separate hotfix track; keeping one path keeps it reliable.

## Signing and notarizing public VSIX releases (macOS)

Use `pnpm run package` for local testing. For a public release, select a Developer ID Application identity in your keychain and pass your stored notarization profile to the release command.

```sh
APPLE_DEVELOPER_ID="Developer ID Application: Your Name (TEAMID)" \
  pnpm run package:release --keychain-profile AC_NOTARY
```

The release command builds and signs during VSIX packaging, extracts the packaged helper, checks its bytes and Developer ID signature, and submits that executable for notarization. After Apple returns `Accepted`, the command places the verified VSIX in the project root. Upload that file to GitHub Releases or use `pnpm run publish:marketplace <path-to-verified.vsix>` for the Marketplace.

The GitHub release runner imports the signing certificate into a temporary keychain. Configure the repository variable `APPLE_DEVELOPER_ID` and the following Actions secrets before merging a Version Packages PR.

- `APPLE_CERTIFICATE_BASE64` and `APPLE_CERTIFICATE_PASSWORD` hold the base64-encoded Developer ID Application PKCS#12 export and its password.
- `APPLE_NOTARY_KEY_BASE64`, `APPLE_NOTARY_KEY_ID`, and `APPLE_NOTARY_ISSUER` hold the base64-encoded App Store Connect team API key (.p8), key ID, and issuer ID for notarization.

## Release checklist (maintainer)

- [ ] CI green on `main`
- [ ] Manual test checklist from [testing-strategy.md](testing-strategy.md) run on real hardware
- [ ] Version Packages PR changelog reads like something a user would want to read
- [ ] For public VSIX releases: `dist/apple-local-helper` signed with `APPLE_DEVELOPER_ID` and notarized via `xcrun notarytool`
- [ ] After merge: GitHub Release has the VSIX attached and installs cleanly
      (`code --install-extension`)
