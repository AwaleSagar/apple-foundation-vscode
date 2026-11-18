import Foundation

@main
struct Assistant {
    static func main() async {
        let server = Server()
        do {
            // Blocking stdin reads must leave the main actor free to stream and cancel.
            try await Task.detached {
                while let request = try readRequest() {
                    try await server.receive(request)
                }
            }.value
        } catch {
            exit(EXIT_FAILURE)
        }
        server.stop()
    }
}

@MainActor
final class Server {
    private var active: [UInt32: Task<Void, Never>] = [:]
    private var waiting: [Request] = []
    private var generating = false
    private var outstandingBytes = 0

    func receive(_ request: Request) throws {
        let id = request.id
        if case .cancel = request.operation {
            if let index = waiting.firstIndex(where: { $0.id == id }) {
                outstandingBytes -= waiting.remove(at: index).bytes
                Reply.cancelled.send(to: id)
            } else {
                active[id]?.cancel()
            }
            return
        }
        guard active[id] == nil, !waiting.contains(where: { $0.id == id })
        else { throw WireError.invalidFrame }
        guard active.count + waiting.count < 64, outstandingBytes + request.bytes <= 16 * 1024 * 1024 else {
            Reply.error("The local helper is busy. Retry when another request finishes.").send(to: id)
            return
        }
        outstandingBytes += request.bytes
        if case .generate = request.operation, generating {
            waiting.append(request)
        } else {
            start(request)
        }
    }

    private func start(_ request: Request) {
        let id = request.id
        if case .generate = request.operation { generating = true }
        active[id] = Task {
            do {
                try Task.checkCancellation()
                let terminal = try await runModel(request.operation) { $0.send(to: id) }
                try Task.checkCancellation()
                terminal.send(to: id)
            } catch {
                let terminal: Reply = Task.isCancelled ? .cancelled : .error(errorMessage(error))
                terminal.send(to: id)
            }
            active[id] = nil
            outstandingBytes -= request.bytes
            if case .generate = request.operation {
                generating = false
                if !waiting.isEmpty { start(waiting.removeFirst()) }
            }
        }
    }

    func stop() {
        waiting.removeAll()
        for task in active.values { task.cancel() }
    }
}
