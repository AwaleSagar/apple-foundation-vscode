import Foundation
import FoundationModels

struct Message: Decodable {
    let role: String
    var content: String

    var entry: Transcript.Entry {
        let segments: [Transcript.Segment] = [.text(.init(content: content))]
        switch role {
        case "system": return .instructions(.init(segments: segments, toolDefinitions: []))
        case "assistant": return .response(.init(assetIDs: [], segments: segments))
        default: return .prompt(.init(segments: segments))
        }
    }
}

struct Request: Decodable {
    let id: String
    let op: String
    let text: String?
    let messages: [Message]?
    let maxContextTokens: Int?
    let maxOutputTokens: Int?
}

struct Event: Encodable {
    let id: String
    var kind: String
    var text: String?
    var value: Int?
    var context: Int?
    var exact: Bool?
}

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

func tokenCount(_ messages: [Message], model: SystemLanguageModel) async throws -> Int {
    if #available(macOS 26.4, *) {
        return try await model.tokenCount(for: messages.map(\.entry))
    }
    // UTF-8 bytes plus framing deliberately overestimates ordinary source text.
    return messages.reduce(8) { $0 + $1.content.utf8.count + 12 }
}

func errorMessage(_ error: Error) -> String {
    let overflow = "The model context window is full. Shorten the selection, diff, or message."
    #if SDK_27
    if #available(macOS 27, *), case LanguageModelError.contextSizeExceeded = error { return overflow }
    #endif
    if case LanguageModelSession.GenerationError.exceededContextWindowSize = error { return overflow }
    return error.localizedDescription
}

@MainActor
final class Server {
    var running: [String: Task<Void, Never>] = [:]

    func send(_ event: Event) {
        guard var data = try? JSONEncoder().encode(event) else { return }
        data.append(10)
        FileHandle.standardOutput.write(data)
    }

    func receive(_ request: Request) {
        let id = request.id
        if request.op == "cancel" {
            running[id]?.cancel()
            return
        }
        running[id] = Task {
            defer { running[id] = nil }
            do {
                let model = SystemLanguageModel.default
                let unavailable = reason(model)
                if request.op == "status" {
                    let exact: Bool
                    if #available(macOS 26.4, *) { exact = true } else { exact = false }
                    send(Event(id: id, kind: "status", text: unavailable, context: contextSize(model), exact: exact))
                    return
                }
                if let unavailable { throw InputError(unavailable) }
                switch request.op {
                case "count":
                    let text = request.text ?? ""
                    let count: Int
                    if #available(macOS 26.4, *) { count = try await model.tokenCount(for: text) }
                    else { count = text.utf8.count }
                    send(Event(id: id, kind: "count", value: count))
                case "generate":
                    try await generate(request, model: model)
                    try Task.checkCancellation()
                    send(Event(id: id, kind: "done"))
                default: throw InputError("Unknown helper operation.")
                }
            } catch {
                send(Event(id: id, kind: Task.isCancelled ? "cancelled" : "error", text: errorMessage(error)))
            }
        }
    }

    func generate(_ request: Request, model: SystemLanguageModel) async throws {
        var messages: [Message] = []
        for message in request.messages ?? [] where !message.content.isEmpty {
            if messages.last?.role == message.role {
                messages[messages.count - 1].content += "\n\n" + message.content
            } else {
                messages.append(message)
            }
        }
        guard let prompt = messages.last, prompt.role == "user" else {
            throw InputError("A user message is required.")
        }
        let context = min(contextSize(model), max(512, request.maxContextTokens ?? contextSize(model)))
        let output = min(max(16, request.maxOutputTokens ?? 1024), context - 256)
        let firstTurn = messages.first?.role == "system" ? 1 : 0
        var trimmed = false
        while try await tokenCount(messages, model: model) > context - output {
            try Task.checkCancellation()
            guard firstTurn + 2 < messages.count, messages[firstTurn].role == "user",
                  messages[firstTurn + 1].role == "assistant" else {
                throw InputError("This request exceeds the input budget. Shorten the selection, diff, or message.")
            }
            messages.removeSubrange(firstTurn ... firstTurn + 1)
            trimmed = true
        }
        if trimmed { send(Event(id: request.id, kind: "trimmed")) }
        try Task.checkCancellation()
        let transcript = Transcript(entries: messages.dropLast().map(\.entry))
        let session = LanguageModelSession(model: model, transcript: transcript)
        #if SDK_27
        let options = GenerationOptions(samplingMode: .greedy, maximumResponseTokens: output)
        #else
        let options = GenerationOptions(sampling: .greedy, maximumResponseTokens: output)
        #endif
        var previous = ""
        for try await snapshot in session.streamResponse(to: prompt.content, options: options) {
            try Task.checkCancellation()
            guard snapshot.content.utf8.starts(with: previous.utf8) else {
                throw InputError("The model revised streamed text. Please retry the response.")
            }
            let delta = String(decoding: snapshot.content.utf8.dropFirst(previous.utf8.count), as: UTF8.self)
            if !delta.isEmpty { send(Event(id: request.id, kind: "delta", text: delta)) }
            previous = snapshot.content
        }
    }
}

@main
struct Assistant {
    static func main() async {
        let server = Server()
        let lines = AsyncStream<String> { continuation in
            Task.detached {
                while let line = readLine() { continuation.yield(line) }
                continuation.finish()
            }
        }
        for await line in lines {
            guard let request = try? JSONDecoder().decode(Request.self, from: Data(line.utf8)) else { continue }
            server.receive(request)
        }
        for task in server.running.values { task.cancel() }
    }
}
