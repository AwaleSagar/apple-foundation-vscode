// Private, little-endian stdio protocol shared with src/native/protocol.ts.
import Foundation

enum Role: UInt8 {
    case system = 1, user, assistant
}

struct Message {
    let role: Role
    var content: String
}

enum Operation {
    case status, cancel
    case count(String)
    case generate([Message], context: Int, output: Int, trimmed: Bool)
}

struct Request {
    let id: UInt32
    let operation: Operation
    let bytes: Int
}

enum WireError: Error { case invalidFrame }

private let maxBodyBytes = 8 * 1024 * 1024

private struct Cursor {
    let bytes: UnsafeRawBufferPointer
    var offset = 0
    var remaining: Int { bytes.count - offset }

    mutating func byte() throws -> UInt8 {
        guard remaining >= 1 else { throw WireError.invalidFrame }
        defer { offset += 1 }
        return bytes[offset]
    }

    mutating func integer() throws -> UInt32 {
        guard remaining >= 4 else { throw WireError.invalidFrame }
        defer { offset += 4 }
        return UInt32(littleEndian: bytes.loadUnaligned(fromByteOffset: offset, as: UInt32.self))
    }

    mutating func string(_ length: Int) throws -> String {
        guard length <= remaining,
              let text = String(bytes: bytes[offset ..< offset + length], encoding: .utf8)
        else { throw WireError.invalidFrame }
        offset += length
        return text
    }
}

// fread buffers pipe fragments and reads exactly the requested length or EOF.
// Only one frame is read ahead of the server's admission decision.
func readRequest() throws -> Request? {
    var length: UInt32 = 0
    let headerBytes = fread(&length, 1, 4, stdin)
    if headerBytes == 0 && feof(stdin) != 0 { return nil }
    let size = Int(UInt32(littleEndian: length))
    guard headerBytes == 4, (5 ... maxBodyBytes).contains(size) else { throw WireError.invalidFrame }
    return try withUnsafeTemporaryAllocation(byteCount: size, alignment: 4) { buffer in
        guard fread(buffer.baseAddress, 1, size, stdin) == size else { throw WireError.invalidFrame }
        var cursor = Cursor(bytes: UnsafeRawBufferPointer(buffer))
        let tag = try cursor.byte()
        let id = try cursor.integer()
        let operation: Operation
        switch tag {
        case 1: operation = .status
        case 2: operation = .count(try cursor.string(cursor.remaining))
        case 3:
            let context = Int(try cursor.integer())
            let output = Int(try cursor.integer())
            let trimmed = try cursor.byte()
            guard trimmed <= 1 else { throw WireError.invalidFrame }
            var messages: [Message] = []
            while cursor.remaining > 0 {
                guard messages.count < 16_384, let role = Role(rawValue: try cursor.byte())
                else { throw WireError.invalidFrame }
                let length = Int(try cursor.integer())
                messages.append(Message(role: role, content: try cursor.string(length)))
            }
            operation = .generate(messages, context: context, output: output, trimmed: trimmed == 1)
        case 4: operation = .cancel
        default: throw WireError.invalidFrame
        }
        guard cursor.remaining == 0 else { throw WireError.invalidFrame }
        return Request(id: id, operation: operation, bytes: size + 4)
    }
}

enum Reply {
    case status(context: Int, exact: Bool, reason: String?)
    case count(Int)
    case delta(String), trimmed, done, cancelled, error(String)

    @MainActor
    func send(to id: UInt32) {
        if case let .delta(text) = self, text.utf8.count > maxBodyBytes - 5 {
            let maxChunk = maxBodyBytes - 5
            let utf8 = text.utf8
            var start = utf8.startIndex
            while start < utf8.endIndex {
                let remaining = utf8.distance(from: start, to: utf8.endIndex)
                var end = remaining <= maxChunk ? utf8.endIndex : utf8.index(start, offsetBy: maxChunk)
                if end < utf8.endIndex {
                    while end > start, (utf8[end] & 0xC0) == 0x80 {
                        utf8.formIndex(before: &end)
                    }
                }
                Reply.delta(String(decoding: utf8[start ..< end], as: UTF8.self)).send(to: id)
                start = end
            }
            return
        }
        var frame = Data(count: 4)
        func append(_ tag: UInt8, value: Int? = nil) {
            frame.append(tag)
            frame.appendUInt32(id)
            if let value { frame.appendUInt32(UInt32(clamping: value)) }
        }
        switch self {
        case let .status(context, exact, reason):
            append(1, value: context)
            frame.append(exact ? 1 : 0)
            if let reason {
                appendTruncatedUTF8(reason, to: &frame, maxBytes: maxBodyBytes - (frame.count - 4))
            }
        case let .count(value): append(2, value: value)
        case let .delta(text):
            append(3)
            frame.append(contentsOf: text.utf8)
        case .trimmed: append(4)
        case .done: append(5)
        case .cancelled: append(6)
        case let .error(text):
            append(7)
            appendTruncatedUTF8(text, to: &frame, maxBytes: maxBodyBytes - (frame.count - 4))
        }
        var size = UInt32(clamping: frame.count - 4).littleEndian
        withUnsafeBytes(of: &size) { frame.replaceSubrange(0 ..< 4, with: $0) }
        do { try FileHandle.standardOutput.write(contentsOf: frame) }
        catch { exit(EXIT_FAILURE) }
    }
}

private func appendTruncatedUTF8(_ text: String, to frame: inout Data, maxBytes: Int) {
    let utf8 = text.utf8
    guard utf8.count > maxBytes else {
        frame.append(contentsOf: utf8)
        return
    }
    let limit = max(0, maxBytes - 3)
    var end = utf8.index(utf8.startIndex, offsetBy: limit)
    while end > utf8.startIndex, (utf8[end] & 0xC0) == 0x80 {
        utf8.formIndex(before: &end)
    }
    frame.append(contentsOf: utf8[..<end])
    if maxBytes >= 3 { frame.append(contentsOf: "...".utf8) }
}

private extension Data {
    mutating func appendUInt32(_ value: UInt32) {
        var word = value.littleEndian
        Swift.withUnsafeBytes(of: &word) { append(contentsOf: $0) }
    }
}
