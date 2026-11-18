# Development

Use Node 24 and pnpm 11. Building the Swift helper requires Xcode with the macOS 26.4 SDK or later. The resulting executable targets Apple Silicon and macOS 26.0. Live inference tests need a Mac with Apple Intelligence enabled and the model downloaded.

## Build the VSIX

Run these commands from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm run verify
pnpm run package
```

The package command writes `apple-foundation-vscode-darwin-arm64-<version>.vsix` to the repository root. It includes the JavaScript extension and the ad-hoc-signed Swift helper. In VS Code, run **Extensions: Install from VSIX…** and select that file.

## Debug and test

Press **F5** in VS Code to open the Extension Development Host. The watch task builds the native helper once, then watches the TypeScript sources. Restart the task after editing Swift.

`pnpm run verify` runs Biome, the TypeScript compiler, and unit tests. Use `pnpm run test:vscode` for the extension-host suite. For tests against an installed VSIX and prompt evaluations on real hardware, see the [testing guide](docs/testing-strategy.md).
