# Using Local Chat

## Chat in the sidebar

Open **Local Chat** in the Activity Bar, or run **Local Chat: Open Local Chat** from the Command Palette. Press **Enter** to send and **Shift+Enter** to add a line break. Choose **Stop reply** or press **Escape** in the sidebar to interrupt a reply.

An empty chat offers **Explain selection**, **Document selection**, and **Draft commit message**. Selecting code enables the first two actions and shows the source filename in the sidebar. Stage changes in Source Control to draft a commit message. The composer shows the model status and its context capacity.

The sidebar keeps conversation history in memory for the current window. Choose **New Local Chat** (**+**) in the view toolbar to clear the conversation and draft. Reloading the window also clears them. The toolbar’s **…** menu includes **Show Status** and **Show Logs**.

## Complete code from a comment

Inside a function such as `def unique_names(names):`, write an indented comment like `# Return the unique names in their original order` and press **Enter**. Pause on the blank line to see a suggestion. **Tab** accepts it and **Escape** dismisses it. To request it again, run **Trigger Inline Suggestion** on that line.

The editor’s language mode determines the comment syntax and the language of the generated block. JavaScript, TypeScript (including JSX and TSX), Swift, Go, Rust, Java, C, C++, and C# support standalone `//` comments and closed `/* … */` blocks. Python, Ruby, and shell scripts support `#` comments. Consecutive comment lines form one instruction. The model sees the instruction and nearby code from the current document.

Suggestions are enabled by default. Turn off `appleFoundation.inlineCompletions.enabled` to disable them globally or for an individual language. VS Code’s `editor.inlineSuggest.enabled` setting also applies.

## Review an implementation before inserting it

Put the cursor anywhere inside a standalone comment block and choose **Implement This Comment** from the editor lightbulb or run **Local Chat: Implement This Comment** from the Command Palette. This action also works when automatic inline suggestions are disabled. Separate tasks with a blank line so you can generate and review them individually.

The diff shows the proposed insertion beneath the chosen comment. **Apply Implementation** (check mark) inserts it as a single undoable edit. **Discard Implementation** (close icon) closes the proposal. Editing the source after generation invalidates the proposal. Run the action again against the updated text.

To give the model an example, select a snippet in any text editor and choose **Local Chat: Use Selection as Implementation Reference**. Its filename appears in the status bar. The next **Implement This Comment** request takes that snapshot, up to 4 KiB, as a local example. Click the status item to clear it, or select another example to replace it. The reference stays in window memory and is consumed when generation starts, including requests you cancel. Inline suggestions and sidebar chats use their usual context.

## Use VS Code Chat

In compatible VS Code Chat clients, choose **Apple On-Device** for text conversations or mention `@apple`. The participant accepts `/explain` and `/doc` for selected code and `/commit` for staged changes. Agent-mode pickers require tool calling and can hide text-only models. You can always open the dedicated sidebar, including when VS Code’s built-in AI features are disabled. [VS Code model guide](https://code.visualstudio.com/docs/agent-customization/language-models)

## Adjust the token budget

The model’s context window is shared by your instructions, conversation, and reply. The available size depends on the Mac and model. **Local Chat: Run Setup Check** shows the size reported by your device when the model is ready.

| VS Code setting | Default | Effect |
| --- | ---: | --- |
| `appleFoundation.model.maxContextTokens` | `0` | Use the device’s context window. Set a positive cap to use a smaller window. |
| `appleFoundation.model.maxOutputTokens` | `1024` | Reserve up to this many tokens for a reply. The helper leaves at least 256 tokens for input. |

The helper starts on demand and exits after one idle minute. Concurrent replies run in arrival order. When a conversation fills the window, the helper drops the oldest complete exchanges first. On macOS 26.4 and later it counts the assembled input with Apple’s tokenizer. On earlier releases it estimates conservatively. [Apple’s context-window guidance](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| The model is unavailable | Run **Local Chat: Run Setup Check** for the reason. If Apple Intelligence is preparing the model, let the download finish and try again. |
| The current request exceeds the input budget | Shorten the selection, prompt, or staged diff. Lowering the output limit also leaves more room for input. |
| The helper exits during a reply | Retry the request or run **Local Chat: Restart Local Helper**. **Show Logs** opens the output channel with recorded status checks. |
| Draft Commit Message reports no staged changes | Stage the changes you want summarized in the relevant repository, then run the action again. |

## Upgrading from 0.1

Version 0.2 bundles the Swift helper. You can remove `appleFoundation.bridge.*` and `appleFoundation.offlineOnlyMode` from your settings. Inference uses the on-device model on every request. Explicit token caps still apply.

**Restart Local Helper** retains the command ID of **Restart Bridge Server**, so existing keyboard shortcuts continue to work.
