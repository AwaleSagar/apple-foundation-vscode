# Local assistant architecture

The VS Code UI extension runs in the local extension host. The sidebar, editor actions, Source Control action, language model provider and chat participant all use a single client for the bundled arm64 helper. This design supersedes the CLI transport in ADR-0002.

A request carries an ID and an operation over newline-delimited JSON on private standard I/O pipes. Status returns framework availability and device capacity. Count returns a token count. Generation carries role-tagged text and the configured caps, and yields text deltas, a trimming notice when relevant, and a terminal event. Cancellation targets one request. Process failure rejects outstanding requests. A subsequent request launches a new helper.

For each generation the helper builds a Foundation Models transcript from instructions and prior turns, reserves output capacity, and checks the entire input including the new prompt. It drops complete user/assistant pairs as needed, then creates a fresh session from the retained prefix. Only the final prompt is passed to the streaming call. Apple streams cumulative snapshots. The helper forwards the new UTF-8 suffix for each update. [Apple session reference](https://developer.apple.com/documentation/foundationmodels/languagemodelsession)

The host keeps sidebar history in memory and sends completed exchanges as context. The webview renders text through DOM text nodes, and receives a fresh state snapshot whenever it opens. Editor and Source Control actions capture their input before changing focus. A draft reads the Git extension’s staged diff once for the requested repository.
