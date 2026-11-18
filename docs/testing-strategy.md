# Testing

`pnpm run verify` runs Biome, strict TypeScript checks and Vitest. Unit cases cover host eligibility, explicit context caps, prompt construction, message conversion, history, fragmented binary frames, cancellation, request limits, idle shutdown and helper failure recovery. `pnpm run test:vscode` builds the helper and runs extension-host integration checks. These registration and configuration checks also run on hosts where Apple Intelligence is unavailable.

On an eligible Mac, build an installable package and test the installation using the commands below. The runner creates a fresh profile, an empty extension development driver, and a temporary Git repository. The extension under test is installed from the VSIX. The runner disables built-in AI features and exercises local chat, history, Stop, restart, token counting alongside a generation, queued cancellation, editor actions, empty and staged diffs. All Git writes are confined to the fixture.

```sh
pnpm run package
node esbuild.mjs --tests
node scripts/test-package.mjs "apple-foundation-vscode-darwin-arm64-$(node -p 'require("./package.json").version').vsix" "/Applications/Visual Studio Code.app/Contents/MacOS/Code"
node scripts/evaluate.mjs dist/apple-local-helper
```

Pass a downloaded 1.104.0 Electron executable as the second argument to repeat the installed-package checks against the minimum VS Code version. The evaluation accepts an extracted helper path and runs the extension’s actual prompts with an empty executable search path. It prints first-text and completion timings for fresh and reused helper processes and exits unsuccessfully when a fixture fails its quality criteria. The history fixture sends 64 completed exchanges with a 512-token context cap and checks that the helper reports trimming once and answers the current prompt.

[Verification results](verification-2026-11-18.md)

## Backend comparison on Apple Silicon

On November 19, 2026, the same M5 Mac ran the previous helper and the rebuilt helper with the history fixture above. Each process served 100 status probes and one eight-exchange warm-up before five 64-exchange generations. Both returned “maple” and one trimming notice on every generation. The model and sampling settings were identical.

| Measurement | Previous helper | Rebuilt helper |
| --- | ---: | ---: |
| Median completion, 64 exchanges | 2,514 ms | 482 ms |
| Median status round trip | 11.99 ms | 11.89 ms |
| Peak helper resident memory across the run | 22.2 MiB | 20.9 MiB |

Memory is the child process peak reported by macOS `wait4`. VS Code and the system model service have separate memory footprints. The idle check observed the child exit after 60 seconds and a subsequent status request start a new process.
