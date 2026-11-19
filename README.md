# Local Chat by AwaleLabs

**A second look at your code.**

Use Apple’s on-device model in VS Code to explain selected code, draft a doc comment, or suggest a commit subject from staged changes. The sidebar runs on your Mac, works offline once the model is downloaded, and requires no account.

## Get started

You’ll need VS Code 1.104 or later and an Apple Intelligence–eligible Mac running macOS 26.0 or later.

1. Enable **Apple Intelligence** in System Settings and let the model finish downloading.
2. Install the [extension from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=sagarawale.apple-foundation-vscode), or [build the VSIX from source](DEVELOPMENT.md).
3. Open **Local Chat** in the Activity Bar. Type a question and press **Enter**, or select code in the editor and choose **Explain selection** in the sidebar.

## Work with code

- **Complete a block from a comment** — Inside a Python function, write `# Return the unique names in their original order` and press **Enter**. Review the inline suggestion and press **Tab** to accept or **Escape** to dismiss.
- **Implement This Comment** — Put the cursor in a standalone comment and choose this action from the editor lightbulb. Compare the proposed code in a diff, then apply or discard it. To show the model a project-specific API pattern, first select an example and choose **Use Selection as Implementation Reference**.
- **Explain Selection** — Select code, right-click, and ask for an explanation in the sidebar.
- **Document Selection** — Right-click a selected function to draft a comment you can review and copy into the editor.
- **Draft Commit Message** — Stage your changes, then choose this action in Source Control to review a suggested commit subject.

[Settings and troubleshooting](docs/user-guide.md) · [Compatibility and test results](docs/verification-2026-11-18.md) · [Project documentation](docs/README.md) · [MIT license](LICENSE)
