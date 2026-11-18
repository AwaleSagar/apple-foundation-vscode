# Using Apple Local Chat

## Chat in the sidebar

Open **Apple Local Chat** in the Activity Bar, or run **Apple Foundation Models: Open Apple Local Chat** from the Command Palette. Press **Enter** to send and **Shift+Enter** to add a line break. Choose **Stop** to interrupt a reply.

The sidebar keeps conversation history in memory for the current window. **New Chat** clears it, as does reloading the window.

## Use VS Code Chat

In compatible VS Code Chat clients, choose **Apple On-Device** for text conversations or mention `@apple`. The participant accepts `/explain` and `/doc` for selected code and `/commit` for staged changes. Agent-mode pickers require tool calling and can hide text-only models. You can always open the dedicated sidebar, including when VS Code’s built-in AI features are disabled. [VS Code model guide](https://code.visualstudio.com/docs/agent-customization/language-models)

## Adjust the token budget

The model’s context window is shared by your instructions, conversation, and reply. The available size depends on the Mac and model. **Apple Foundation Models: Run Setup Check** shows the size reported by your device when the model is ready.

| VS Code setting | Default | Effect |
| --- | ---: | --- |
| `appleFoundation.model.maxContextTokens` | `0` | Use the device’s context window. Set a positive cap to use a smaller window. |
| `appleFoundation.model.maxOutputTokens` | `1024` | Reserve up to this many tokens for a reply. The helper leaves at least 256 tokens for input. |

When a conversation fills the window, the helper drops the oldest complete exchanges first. On macOS 26.4 and later it counts the assembled input with Apple’s tokenizer. On earlier releases it estimates conservatively. [Apple’s context-window guidance](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| The model is unavailable | Run **Apple Foundation Models: Run Setup Check** for the reason. If Apple Intelligence is preparing the model, let the download finish and try again. |
| The current request exceeds the input budget | Shorten the selection, prompt, or staged diff. Lowering the output limit also leaves more room for input. |
| The helper exits during a reply | Retry the request or run **Apple Foundation Models: Restart Local Helper**. **Show Logs** opens the output channel with recorded status checks. |
| Draft Commit Message reports no staged changes | Stage the changes you want summarized in the relevant repository, then run the action again. |

## Upgrading from 0.1

Version 0.2 bundles the Swift helper. You can remove `appleFoundation.bridge.*` and `appleFoundation.offlineOnlyMode` from your settings. Inference uses the on-device model on every request. Explicit token caps still apply.

**Restart Local Helper** retains the command ID of **Restart Bridge Server**, so existing keyboard shortcuts continue to work.
