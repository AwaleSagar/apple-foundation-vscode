import FoundationModels

private extension Message {
    var entry: Transcript.Entry {
        let segments: [Transcript.Segment] = [.text(.init(content: content))]
        switch role {
        case .system: return .instructions(.init(segments: segments, toolDefinitions: []))
        case .assistant: return .response(.init(assetIDs: [], segments: segments))
        case .user: return .prompt(.init(segments: segments))
        }
    }
}

struct ModelInput {
    let transcript: Transcript
    let prompt: String
    let trimmed: Bool
}

func prepareInput(_ input: [Message], model: SystemLanguageModel, budget: Int) async throws -> ModelInput {
    var messages: [Message] = []
    for message in input where !message.content.isEmpty {
        if messages.last?.role == message.role {
            messages[messages.count - 1].content += "\n\n"
            messages[messages.count - 1].content += message.content
        } else {
            messages.append(message)
        }
    }
    guard let prompt = messages.last, prompt.role == .user else {
        throw InputError("A user message is required.")
    }
    let first = messages.first?.role == .system ? 1 : 0
    var end = first
    while end + 2 < messages.count, messages[end].role == .user, messages[end + 1].role == .assistant {
        end += 2
    }
    let pairs = (end - first) / 2
    let instructions = first == 1 ? messages[0].entry : nil
    func entries(start: Int) -> [Transcript.Entry] {
        var result: [Transcript.Entry] = []
        result.reserveCapacity(first + messages.count - start)
        if let instructions { result.append(instructions) }
        for message in messages[start...] { result.append(message.entry) }
        return result
    }

    // Bytes only choose the first probe. Apple's count decides every boundary.
    // Starting near the recent end avoids materializing a huge discarded prefix.
    func cost(_ message: Message) -> Int { message.content.utf8.count + 12 }
    let framing = 8 + (first == 1 ? cost(messages[0]) : 0)
    var bytes = messages[end...].reduce(framing) { $0 + cost($1) }
    var start = end
    while start > first {
        bytes += cost(messages[start - 2]) + cost(messages[start - 1])
        if bytes > budget * 4 { break }
        start -= 2
    }

    var best: [Transcript.Entry] = []
    func fits(keeping count: Int) async throws -> Bool {
        try Task.checkCancellation()
        let start = end - 2 * count
        if #available(macOS 26.4, *) {
            let candidate = entries(start: start)
            guard try await model.tokenCount(for: candidate) <= budget else { return false }
            best = candidate
        } else {
            var estimate = framing
            for message in messages[start...] {
                estimate += cost(message)
                if estimate > budget { return false }
            }
        }
        return true
    }

    // Grow a fitting suffix exponentially, then bisect the first failing interval.
    var fitting = -1
    var tooLarge = pairs + 1
    var probe = (end - start) / 2
    while tooLarge - fitting > 1 {
        if try await fits(keeping: probe) {
            fitting = probe
            if tooLarge == pairs + 1 {
                probe = min(pairs, max(1, probe * 2))
                continue
            }
        } else {
            tooLarge = probe
        }
        probe = (fitting + tooLarge) / 2
    }
    guard fitting >= 0 else {
        throw InputError("This request exceeds the input budget. Shorten the selection, diff, or message.")
    }
    if best.isEmpty { best = entries(start: end - 2 * fitting) }
    return ModelInput(transcript: Transcript(entries: best.dropLast()), prompt: prompt.content, trimmed: fitting < pairs)
}
