# Local assistant architecture

The VS Code UI extension runs in the local extension host. The sidebar, editor actions, Source Control action, language model provider and chat participant all use a single client for the bundled arm64 helper. This design supersedes the CLI transport in ADR-0002.

The host starts the helper on first use. Each connection owns its child, request IDs, cancellation subscriptions and pending promises. The host retires the child after 60 seconds of inactivity. A pipe failure, malformed reply or two minutes without a reply while work is outstanding closes that connection and rejects its callers. The next request starts a fresh child. Cancellation rejects its caller immediately. The request continues to count toward the limit until its terminal reply arrives, with a ten-second grace period for an unresponsive helper.

## Private pipe protocol

The host and helper ship together in the VSIX. Each pipe frame starts with a little-endian 32-bit body length, a one-byte operation or event tag and a little-endian 32-bit request ID. Counts and limits are unsigned 32-bit integers. Message text and streamed suffixes use UTF-8. Text at the end of a frame uses the remaining frame length. Each role-tagged message in a generation request has its own byte length. Both directions validate frame boundaries. The host decodes complete replies directly from the incoming buffer and copies fragmented replies into one bounded buffer. The codecs live in [protocol.ts](src/native/protocol.ts) and [Wire.swift](native/Wire.swift).

Each frame body can contain up to 8 MiB. Both endpoints limit outstanding work to 64 requests and 16 MiB of request frames per connection. An oversized conversation can shed oldest complete exchanges before encoding. An oversized indivisible prompt or a saturated connection returns an actionable error. The Swift reader awaits admission before reading the next frame. The scheduler runs one generation at a time in arrival order. Status, token counts and cancellation can proceed during generation.

## Model execution

For each generation the helper reserves output capacity and uses UTF-8 size to select a starting range of recent exchanges. It expands or bisects that range to find the longest fitting suffix of complete user/assistant pairs. It builds transcript entries only for the ranges it probes and reuses the winning entries for generation. On macOS 26.4 and later, Apple’s tokenizer checks each candidate. Earlier systems use a conservative byte estimate. The helper reports trimming, creates a fresh session from the retained history and streams the final prompt. For each cumulative snapshot it checks the preceding UTF-8 bytes and forwards only the new suffix. [Apple session reference](https://developer.apple.com/documentation/foundationmodels/languagemodelsession)

The host keeps sidebar history in memory and sends completed exchanges as context. The host also holds the unsent draft in window memory. The webview restores both from a state snapshot when it opens. It formats conversational replies with a bundled Markdown renderer and displays document comments and commit subjects as literal text. Editor and Source Control actions capture their input before changing focus. A draft reads the Git extension’s staged diff once for the requested repository.
