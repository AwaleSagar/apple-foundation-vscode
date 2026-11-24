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

## Comment completion checks

Run `APPLE_LOCAL_INLINE_TEST=1 pnpm run test:vscode` on a Mac with the model ready to exercise the editor workflow. The test opens untitled Python and TypeScript editors, types a newline after each comment, accepts the automatic suggestion, undoes it, checks dismissal, and disables the feature. The default extension-host suite uses a fake model for provider checks and requires no live inference.

On November 19, 2026, VS Code 1.147 accepted the Python order-preserving deduplication suggestion 2.63 seconds after Enter. The following TypeScript suggestion took 1.13 seconds and inserted an initialized accumulator, a loop over the existing `costs` parameter, and a return statement. Timings include the editor and a 100 ms polling interval. In separate helper-only runs, fresh/reused helper processes completed the same Python prompt in 779/510 ms and the TypeScript prompt in 650/611 ms.

The same live suite opens a comment implementation diff, checks the one-use reference, accepts and undoes an edit, discards a second proposal, and tries to apply a proposal after the source changed. It also types an instruction into the inline editor, previews a replacement inside a TypeScript expression, applies it, and verifies that one undo restores the source.

On November 19, 2026, two VS Code 1.146 runs used the same comments-only Python outline and accepted the first proposal for each of three tasks. Both passed all three email-normalization checks and all five single-row SQLite insert checks. The batch importer passed one of six checks unaided. With a nine-line local example of a SQLite savepoint around a generic operation, it passed all six, including failure rollback and preservation of the caller’s uncommitted transaction. These results describe one fixture on one Mac.

## Backend comparison on Apple Silicon

On November 19, 2026, the same M5 Mac ran the previous helper and the rebuilt helper with the history fixture above. Each process served 100 status probes and one eight-exchange warm-up before five 64-exchange generations. Both returned “maple” and one trimming notice on every generation. The model and sampling settings were identical.

| Measurement | Previous helper | Rebuilt helper |
| --- | ---: | ---: |
| Median completion, 64 exchanges | 2,514 ms | 482 ms |
| Median status round trip | 11.99 ms | 11.89 ms |
| Peak helper resident memory across the run | 22.2 MiB | 20.9 MiB |

Memory is the child process peak reported by macOS `wait4`. VS Code and the system model service have separate memory footprints. The idle check observed the child exit after 60 seconds and a subsequent status request start a new process.
