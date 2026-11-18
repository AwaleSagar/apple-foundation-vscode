# Apple Local Chat 0.2.0 verification

November 18, 2026. The delivered artifact is `apple-foundation-vscode-darwin-arm64-0.2.0.vsix`, 69,633 bytes. Its SHA-256 is `baf574bba5fbb6dd50fc47ef06980e25d9e96b0c2b1c883c578919382cdcbfad`.

## Device and compatibility

| Check | Result |
| --- | --- |
| Hardware and tools | Apple M5, 16 GiB memory, macOS 27.2.1 build 26B131, Xcode 27.2 build 27B52 |
| Packaged executable | Mach-O arm64, ad-hoc signature verified, SDK 27.2, minimum macOS 26.0 confirmed in its load command |
| Runtime model | Apple reported available, 8,192-token context. Native count of the string `maple` was 3 tokens. |
| VS Code 1.104.0 | Seven extension-host tests passed against the installed VSIX in a fresh profile. |
| VS Code 1.146.0 | The same seven tests passed against the installed VSIX in a separate fresh profile. |
| macOS 26.x | Deployment target compiled. Runtime execution on 26.x remains unverified, including the 26.0–26.3 estimator. |
| Distribution | Local VSIX installation tested. Developer ID notarization, Marketplace distribution, and hosted CI execution were outside this run. |

Apple’s Swift interface marks sessions and streaming available from macOS 26.0. The 27.2 SDK back-deploys device context size to 26.0. Exact transcript counts require 26.4. The build also accepts the 26.4+ SDK family, with a 4,096-token compatibility fallback on early 26.x. The delivered binary was built with the 27.2 SDK. [Apple’s context-size reference](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/contextsize) · [Framework updates](https://developer.apple.com/documentation/updates/foundationmodels) · [Apple’s context-window guidance](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)

## Live behavior

- Both installations used isolated extension and user-data directories, with built-in AI features disabled and no sign-in. Tests invoked the installed extension’s commands, checked single-answer rendering at the command boundary, recalled the prior turn, cancelled a long generation, sent another prompt, restarted the helper, and generated again.
- Both hosts opened a real editor selection for each code action and a disposable Git repository for commit drafting. The empty index yielded no draft. After staging a timeout change, the command returned a conventional subject describing the increase. Git still reported the change as staged afterwards.
- A separate rendered-sidebar test on VS Code 1.146 sent a message with Enter, observed one complete “maple” reply in the conversation, sent another with the Send button, clicked Stop, observed the stopped notice, and cleared both turns with New Chat.
- The extracted helper ran with PATH pointing to a nonexistent directory. A 512-token cap triggered a trimming event for an oversized historical exchange, followed by the requested answer. An oversized current prompt produced an actionable error. Cancellation after the first streamed delta produced a terminal cancellation event, and the same process answered the next request.
- All 33 unit tests, strict TypeScript checks and the Biome check passed. Unit tests simulated unsupported hosts, helper exit with multiple outstanding requests, a late event from the old process, and Apple Intelligence being disabled. The two signed-out host runs checked registration for the native VS Code chat participant and provider. Interactive testing exercised the independent sidebar. [VS Code provider contract](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider) · [VS Code model-picker requirements](https://code.visualstudio.com/docs/agent-customization/language-models)

## Prompt quality and timing

The evaluation used the extension’s actual prompt builder and the executable extracted from the VSIX. Each fixture ran twice with greedy sampling. The first run includes helper startup, and the warm run reuses that process with a fresh session. macOS controls model caching, so the first measurement can include a system model already resident in memory. These single observations describe this Mac.

| Fixed task | First run, first text / complete | Warm run, first text / complete | Quality checks per run |
| --- | ---: | ---: | --- |
| Explain a Swift array filter | 1,241 / 2,019 ms | 787 / 1,548 ms | 2/2. Named the greater-than-one predicate and gave the result `[2, 3]`. |
| Document an integer doubling function | 460 / 461 ms | 425 / 425 ms | 3/3. Produced a Swift doc comment, described doubling, and emitted a single comment line. |
| Draft the staged timeout change | 457 / 458 ms | 428 / 428 ms | 4/4. Used conventional subject syntax, identified the timeout, its increase, and the old and new values. |

The final comment was `/// Returns the value doubled by multiplying it by 2.` The final commit subject was `fix: increase timeoutMs from 2000 to 5000`.

The initial commit experiment produced “Update timeoutMs values”. An earlier documentation prompt repeated the entire function, and a subsequent prompt emitted two redundant comment lines. The final fixtures retain checks for direction, values and comment-only output. Three fixtures give narrow regression coverage. Broader languages, repositories and macOS model revisions need separate evaluation. [Apple’s prompt evaluation guide](https://developer.apple.com/documentation/foundationmodels/evaluating-prompts-to-measure-performance-and-improve-model-responses)

[Reproduction commands](testing-strategy.md)
