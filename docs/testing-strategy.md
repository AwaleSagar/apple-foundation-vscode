# Testing

`pnpm run verify` runs Biome, strict TypeScript checks and Vitest. Unit cases cover host eligibility, explicit context caps, prompt construction, message conversion, history, and helper failure recovery. `pnpm run test:vscode` builds the helper and runs extension-host integration checks. These registration and configuration checks also run on hosts where Apple Intelligence is unavailable.

On an eligible Mac, build an installable package and test the installation using the commands below. The runner creates a fresh profile, an empty extension development driver, and a temporary Git repository. The extension under test is installed from the VSIX. The runner disables built-in AI features and exercises local chat, history, Stop, restart, editor actions, empty and staged diffs. All Git writes are confined to the fixture.

```sh
pnpm run package
node esbuild.mjs --tests
node scripts/test-package.mjs apple-foundation-vscode-darwin-arm64-0.2.0.vsix "/Applications/Visual Studio Code.app/Contents/MacOS/Code"
node scripts/evaluate.mjs dist/apple-local-helper
```

Pass a downloaded 1.104.0 Electron executable as the second argument to repeat the installed-package checks against the minimum VS Code version. The evaluation accepts an extracted helper path and runs the extension’s actual prompts with an empty executable search path. It prints first-text and completion timings for fresh and reused helper processes and exits unsuccessfully when a fixture fails its quality criteria.

[Verification results](verification-2026-11-18.md)
