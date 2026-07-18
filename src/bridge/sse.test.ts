import { describe, expect, it } from 'vitest';
import { SseParser } from './sse';

describe('SseParser', () => {
  it('parses a single complete event', () => {
    const parser = new SseParser();
    expect(parser.push('data: {"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it('parses multiple events in one chunk', () => {
    const parser = new SseParser();
    expect(parser.push('data: one\n\ndata: two\n\n')).toEqual(['one', 'two']);
  });

  it('buffers events split across chunks', () => {
    const parser = new SseParser();
    expect(parser.push('data: par')).toEqual([]);
    expect(parser.push('tial\n')).toEqual([]);
    expect(parser.push('\n')).toEqual(['partial']);
  });

  it('handles CRLF line endings', () => {
    const parser = new SseParser();
    expect(parser.push('data: crlf\r\n\r\n')).toEqual(['crlf']);
  });

  it('ignores comments and non-data fields', () => {
    const parser = new SseParser();
    expect(parser.push(': keep-alive\n\nevent: ping\n\ndata: real\n\n')).toEqual(['real']);
  });

  it('joins multi-line data fields', () => {
    const parser = new SseParser();
    expect(parser.push('data: line1\ndata: line2\n\n')).toEqual(['line1\nline2']);
  });

  it('passes through the [DONE] sentinel', () => {
    const parser = new SseParser();
    expect(parser.push('data: [DONE]\n\n')).toEqual(['[DONE]']);
  });
});
