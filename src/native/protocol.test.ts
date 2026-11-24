import { expect, it } from 'vitest';
import { decodeReply, encodeRequest, FrameReader, MAX_BODY_BYTES } from './protocol';

it('encodes exact UTF-8 lengths, message roles and uncapped settings', () => {
  const input = '\ufeff🍁e\u0301\n\0';
  const bytes = Buffer.from(input);
  const frame = encodeRequest(0x12345678, {
    op: 'generate',
    messages: [
      { role: 'system', content: '' },
      { role: 'user', content: input },
    ],
    maxContextTokens: Number.MAX_SAFE_INTEGER,
    maxOutputTokens: 512,
  });
  expect(frame.readUInt32LE()).toBe(frame.length - 4);
  expect(frame[4]).toBe(3);
  expect(frame.readUInt32LE(5)).toBe(0x12345678);
  expect(frame.readUInt32LE(9)).toBe(0xffffffff);
  expect(frame.readUInt32LE(13)).toBe(512);
  expect(frame.subarray(18, 24)).toEqual(Buffer.from([1, 0, 0, 0, 0, 2]));
  expect(frame.readUInt32LE(24)).toBe(bytes.length);
  expect(frame.subarray(28)).toEqual(bytes);
  expect(() => encodeRequest(1, { op: 'count', text: 'x'.repeat(MAX_BODY_BYTES) })).toThrow(
    'too large',
  );
});

it('decodes coalesced and fragmented frames including split UTF-8 code points', () => {
  const text = '\ufeff🍁e\u0301\n\0';
  const frame = encodeRequest(7, { op: 'count', text });
  frame[4] = 3;
  const pair = Buffer.concat([frame, frame]);
  for (let size = 1; size <= pair.length; size++) {
    const frames = new FrameReader();
    const received: string[] = [];
    for (let i = 0; i < pair.length; i += size) {
      frames.push(pair.subarray(i, i + size), (body) => {
        const event = decodeReply(body);
        expect(body.readUInt32LE(1)).toBe(7);
        if (event.kind === 'delta') received.push(event.text);
      });
    }
    expect(received).toEqual([text, text]);
  }
});

it('rejects invalid lengths before buffering, unknown tags, and damaged payloads', () => {
  for (const size of [0, 4, MAX_BODY_BYTES + 1]) {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(size);
    expect(() => new FrameReader().push(header, () => {})).toThrow('invalid response');
  }
  for (const invalid of [
    [42, 0, 0, 0, 0],
    [3, 0, 0, 0, 0, 0xff],
    [2, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0, 16, 0, 0, 2],
    [5, 0, 0, 0, 0, 0],
  ])
    expect(() => decodeReply(Buffer.from(invalid))).toThrow();
});

it('fits a very long conversation by dropping whole oldest pairs before encoding', () => {
  const prompt = { role: 'user', content: 'current prompt' } as const;
  const system = { role: 'system', content: 'rules' } as const;
  const limits = { maxContextTokens: 8192, maxOutputTokens: 128 };
  const frame = encodeRequest(1, {
    op: 'generate',
    ...limits,
    messages: [
      system,
      { role: 'user', content: 'x'.repeat(MAX_BODY_BYTES) },
      { role: 'assistant', content: 'old' },
      prompt,
    ],
  });
  const expected = encodeRequest(1, { op: 'generate', ...limits, messages: [system, prompt] });
  expect(expected[17]).toEqual(0);
  expected[17] = 1;
  expect(frame).toEqual(expected);
});

it('trims leading assistant messages and fits conversations into remaining availableBytes', () => {
  const prompt = { role: 'user', content: 'current prompt' } as const;
  const limits = { maxContextTokens: 8192, maxOutputTokens: 128 };
  const leadingAssistant = encodeRequest(1, {
    op: 'generate',
    ...limits,
    messages: [
      { role: 'assistant', content: 'welcome' },
      { role: 'user', content: 'x'.repeat(MAX_BODY_BYTES) },
      { role: 'assistant', content: 'old' },
      prompt,
    ],
  });
  expect(leadingAssistant[17]).toEqual(1);

  const shrunk = encodeRequest(
    1,
    {
      op: 'generate',
      ...limits,
      messages: [
        { role: 'user', content: 'x'.repeat(2048) },
        { role: 'assistant', content: 'old reply' },
        prompt,
      ],
    },
    256,
  );
  expect(shrunk.length).toBeLessThanOrEqual(256);
  expect(shrunk[17]).toEqual(1);
});
