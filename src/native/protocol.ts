// A frame is a little-endian body length, one tag byte, a UInt32 request ID,
// and operation-specific fields. Strings are UTF-8. See native/Wire.swift.
export const HELPER_BUSY = 'The local helper is busy. Retry when another request finishes.';
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_MESSAGES = 16_384;
const HEADER_BYTES = 9;
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export type Request =
  | { op: 'status' }
  | { op: 'cancel' }
  | { op: 'count'; text: string }
  | {
      op: 'generate';
      messages: readonly ChatMessage[];
      maxContextTokens: number;
      maxOutputTokens: number;
    };

export type Reply =
  | { kind: 'status'; context: number; exact: boolean; reason: string | undefined }
  | { kind: 'count'; value: number }
  | { kind: 'delta' | 'error'; text: string }
  | { kind: 'trimmed' | 'done' | 'cancelled' };

const operations = { status: 1, count: 2, generate: 3, cancel: 4 } as const;
const roles = { system: 1, user: 2, assistant: 3 } as const;

function allocateFrame(id: number, tag: number, size: number, availableBytes: number) {
  if (size > MAX_BODY_BYTES)
    throw new Error(
      'Request too large for the local helper. Shorten the text or start a new chat.',
    );
  if (4 + size > availableBytes) throw new Error(HELPER_BUSY);
  const frame = Buffer.allocUnsafe(4 + size);
  frame.writeUInt32LE(size);
  frame[4] = tag;
  frame.writeUInt32LE(id, 5);
  return frame;
}

const messageSize = (message: ChatMessage) => 5 + Buffer.byteLength(message.content);

function encodeGeneration(
  id: number,
  request: Extract<Request, { op: 'generate' }>,
  availableBytes: number,
) {
  let messages = request.messages;
  let size = 14;
  for (const message of messages) size += messageSize(message);

  // Even a conversation larger than a single frame or remaining budget can keep a recent suffix.
  const maxFrameBody = Math.min(MAX_BODY_BYTES, availableBytes - 4);
  const first = messages[0]?.role === 'system' ? 1 : 0;
  let start = first;
  while (size > maxFrameBody || messages.length - start + first > MAX_MESSAGES) {
    if (start + 1 >= messages.length) {
      if (size > MAX_BODY_BYTES || messages.length - start + first > MAX_MESSAGES)
        throw new Error(
          'Request too large for the local helper. Shorten the text or start a new chat.',
        );
      throw new Error(HELPER_BUSY);
    }
    const current = messages[start];
    const next = messages[start + 1];
    if (current?.role === 'user' && next?.role === 'assistant' && start + 2 < messages.length) {
      size -= messageSize(current) + messageSize(next);
      start += 2;
    } else if (current && (current.role !== 'user' || next?.role === 'user')) {
      size -= messageSize(current);
      start += 1;
    } else {
      if (size > MAX_BODY_BYTES || messages.length - start + first > MAX_MESSAGES)
        throw new Error(
          'Request too large for the local helper. Shorten the text or start a new chat.',
        );
      throw new Error(HELPER_BUSY);
    }
  }
  if (start > first) messages = [...messages.slice(0, first), ...messages.slice(start)];
  const frame = allocateFrame(id, operations.generate, size, availableBytes);
  // The uncapped setting is Number.MAX_SAFE_INTEGER on the host.
  frame.writeUInt32LE(Math.min(request.maxContextTokens, 0xffffffff), HEADER_BYTES);
  frame.writeUInt32LE(request.maxOutputTokens, HEADER_BYTES + 4);
  frame[HEADER_BYTES + 8] = Number(start > first);
  let offset = HEADER_BYTES + 9;
  for (const message of messages) {
    frame[offset] = roles[message.role];
    const length = frame.write(message.content, offset + 5);
    frame.writeUInt32LE(length, offset + 1);
    offset += 5 + length;
  }
  return frame;
}

export function encodeRequest(
  id: number,
  request: Request,
  availableBytes = MAX_BODY_BYTES + 4,
): Buffer {
  if (request.op === 'generate') return encodeGeneration(id, request, availableBytes);
  const size = request.op === 'count' ? 5 + Buffer.byteLength(request.text) : 5;
  const frame = allocateFrame(id, operations[request.op], size, availableBytes);
  if (request.op === 'count') frame.write(request.text, HEADER_BYTES);
  return frame;
}

// Complete frames in a pipe read are borrowed. Only a split body needs a copy.
export class FrameReader {
  private readonly header = Buffer.allocUnsafe(4);
  private headerBytes = 0;
  private partial?: Buffer | undefined;
  private received = 0;
  private size = 0;

  push(chunk: Buffer, receive: (body: Buffer) => void) {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.size === 0) {
        const n = chunk.copy(this.header, this.headerBytes, offset, offset + 4 - this.headerBytes);
        offset += n;
        this.headerBytes += n;
        if (this.headerBytes < 4) return;
        this.size = this.header.readUInt32LE();
        this.headerBytes = 0;
        if (this.size < 5 || this.size > MAX_BODY_BYTES) throw invalidResponse();
      }
      const n = Math.min(this.size - this.received, chunk.length - offset);
      if (!this.partial && n === this.size) {
        receive(chunk.subarray(offset, offset + n));
      } else {
        this.partial ??= Buffer.allocUnsafe(this.size);
        chunk.copy(this.partial, this.received, offset, offset + n);
        this.received += n;
        if (this.received < this.size) return;
        receive(this.partial);
        this.partial = undefined;
        this.received = 0;
      }
      this.size = 0;
      offset += n;
    }
  }
}

export function invalidResponse() {
  return new Error('The local helper returned an invalid response. Retry to restart it.');
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export function decodeReply(body: Buffer): Reply {
  switch (body[0]) {
    case 1: {
      if (body.length < 10 || (body[9] !== 0 && body[9] !== 1)) break;
      const context = body.readUInt32LE(5);
      if (context < 512) break;
      return {
        kind: 'status',
        context,
        exact: body[9] === 1,
        reason: utf8.decode(body.subarray(10)) || undefined,
      };
    }
    case 2:
      if (body.length === 9) return { kind: 'count', value: body.readUInt32LE(5) };
      break;
    case 3:
    case 7:
      return { kind: body[0] === 3 ? 'delta' : 'error', text: utf8.decode(body.subarray(5)) };
    case 4:
    case 5:
    case 6:
      if (body.length === 5)
        return { kind: body[0] === 4 ? 'trimmed' : body[0] === 5 ? 'done' : 'cancelled' };
  }
  throw invalidResponse();
}
