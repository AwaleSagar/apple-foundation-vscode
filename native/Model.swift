import Foundation
import FoundationModels

struct InputError: LocalizedError {
    let errorDescription: String?
    init(_ text: String) { errorDescription = text }
}

func reason(_ model: SystemLanguageModel) -> String? {
    if case let .unavailable(reason) = model.availability {
        switch reason {
        case .deviceNotEligible: return "This Mac is ineligible for Apple Intelligence."
        case .appleIntelligenceNotEnabled: return "Enable Apple Intelligence in System Settings."
        case .modelNotReady: return "Apple Intelligence is preparing the on-device model. Try again after the download completes."
        @unknown default: return "Apple reports that the on-device model is unavailable (\(reason))."
        }
    }
    if !model.supportsLocale(Locale.current) {
        return "Apple Intelligence does not support the current macOS language or region. Switch to a supported language in System Settings > General > Language & Region."
    }
    return nil
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
    let guardrail = "Apple's on-device safety guardrails blocked this request. Rephrase the prompt or remove sensitive content."
    let assetsUnavailable = "Apple Intelligence model assets are currently unavailable. Wait for macOS to finish downloading them in System Settings > Apple Intelligence & Siri, then retry."
    let unsupportedLocale = "Apple Intelligence does not support the language or locale of this request. Switch to a supported language or write the prompt in a supported language."
    let rateLimited = "Apple Intelligence is temporarily rate-limited. Wait a moment and retry."
    let concurrent = "Another Apple Intelligence request is already running. Wait for it to finish and retry."
    let refusal = "The on-device model refused this request. Rephrase the prompt and try again."

    #if SDK_27
    if #available(macOS 27, *) {
        if let modelError = error as? LanguageModelError {
            switch modelError {
            case .contextSizeExceeded: return overflow
            case .guardrailViolation: return guardrail
            case .unsupportedLanguageOrLocale: return unsupportedLocale
            case .rateLimited: return rateLimited
            case .refusal: return refusal
            case .timeout: return "The on-device model timed out. Retry or shorten the request."
            default: break
            }
        }
        if case SystemLanguageModel.Error.assetsUnavailable = error { return assetsUnavailable }
        if case LanguageModelSession.Error.concurrentRequests = error { return concurrent }
    }
    #endif
    if let generationError = error as? LanguageModelSession.GenerationError {
        switch generationError {
        case .exceededContextWindowSize: return overflow
        case .guardrailViolation: return guardrail
        case .assetsUnavailable: return assetsUnavailable
        case .unsupportedLanguageOrLocale: return unsupportedLocale
        case .rateLimited: return rateLimited
        case .concurrentRequests: return concurrent
        case .refusal: return refusal
        case .unsupportedGuide, .decodingFailure: break
        @unknown default: break
        }
    }
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
