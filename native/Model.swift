import Foundation
import FoundationModels

struct InputError: LocalizedError {
    let errorDescription: String?
    init(_ text: String) { errorDescription = text }
}

func reason(_ model: SystemLanguageModel) -> String? {
    guard case let .unavailable(reason) = model.availability else { return nil }
    switch reason {
    case .deviceNotEligible: return "This Mac is ineligible for Apple Intelligence."
    case .appleIntelligenceNotEnabled: return "Enable Apple Intelligence in System Settings."
    case .modelNotReady: return "Apple Intelligence is preparing the on-device model. Try again after the download completes."
    @unknown default: return "Apple reports that the on-device model is unavailable (\(reason))."
    }
}

func contextSize(_ model: SystemLanguageModel) -> Int {
    #if SDK_27
    return model.contextSize
    #else
    if #available(macOS 26.4, *) { return model.contextSize }
    return 4096 // Original macOS 26 system model window.
    #endif
}

func errorMessage(_ error: Error) -> String {
    let overflow = "The model context window is full. Shorten the selection, diff, or message."
    #if SDK_27
    if #available(macOS 27, *), case LanguageModelError.contextSizeExceeded = error { return overflow }
    #endif
    if case LanguageModelSession.GenerationError.exceededContextWindowSize = error { return overflow }
    return error.localizedDescription
}

private let responseFramingOverhead = 96

@MainActor
func runModel(_ operation: Operation, emit: (Reply) -> Void) async throws -> Reply {
    let model = SystemLanguageModel.default
    let unavailable = reason(model)
    if case .status = operation {
        let exact: Bool
        if #available(macOS 26.4, *) { exact = true } else { exact = false }
        return .status(context: contextSize(model), exact: exact, reason: unavailable)
    }
    if let unavailable { throw InputError(unavailable) }
    switch operation {
    case let .count(text):
        if #available(macOS 26.4, *) { return .count(try await model.tokenCount(for: text)) }
        return .count(text.utf8.count)
    case let .generate(messages, context, output, trimmed):
        let window = min(contextSize(model), max(512, context))
        let reserved = min(max(16, output), window - 256)
        let headroom: Int
        if #available(macOS 26.4, *) { headroom = responseFramingOverhead } else { headroom = 0 }
        let inputBudget = max(128, window - reserved - headroom)
        let input = try await prepareInput(messages, model: model, budget: inputBudget)
        if trimmed || input.trimmed { emit(.trimmed) }
        try Task.checkCancellation()
        let session = LanguageModelSession(model: model, transcript: input.transcript)
        #if SDK_27
        let options = GenerationOptions(samplingMode: .greedy, maximumResponseTokens: reserved)
        #else
        let options = GenerationOptions(sampling: .greedy, maximumResponseTokens: reserved)
        #endif
        var previous = ""
        for try await snapshot in session.streamResponse(to: input.prompt, options: options) {
            try Task.checkCancellation()
            var current = snapshot.content
            let delta = try suffix(of: &current, after: &previous)
            if !delta.isEmpty { emit(.delta(delta)) }
            previous = current
        }
        return .done
    case .status, .cancel: throw WireError.invalidFrame
    }
}

// Snapshots are cumulative. Compare their contiguous bytes without walking Swift
// characters, including when a new scalar extends the last grapheme cluster.
private func suffix(of current: inout String, after previous: inout String) throws -> String {
    try previous.withUTF8 { old in
        try current.withUTF8 { new in
            if !old.isEmpty {
                guard new.count >= old.count, let lhs = old.baseAddress, let rhs = new.baseAddress,
                      memcmp(lhs, rhs, old.count) == 0 else {
                    throw InputError("The model revised streamed text. Please retry the response.")
                }
            }
            return String(decoding: new.dropFirst(old.count), as: UTF8.self)
        }
    }
}
