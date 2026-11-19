import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NativeClient } from './client';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../core/availability', () => ({
  currentHostInfo: () => ({}),
  checkHost: () => ({ available: true }),
}));

function child() {
  const process = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stdin: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValueOnce(process as unknown as ReturnType<typeof spawn>);
  return process;
}

function token() {
  const events = new EventEmitter();
  return {
    isCancellationRequested: false,
    onCancellationRequested(callback: (event: unknown) => void) {
      events.on('cancel', callback);
      return { dispose: () => events.off('cancel', callback) };
    },
    cancel() {
      this.isCancellationRequested = true;
      events.emit('cancel');
    },
  };
}

function frame(id: number, tag: number, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(9);
  header.writeUInt32LE(5 + payload.length);
  header[4] = tag;
  header.writeUInt32LE(id, 5);
  return Buffer.concat([header, payload]);
}

const options = { maxContextTokens: 4096, maxOutputTokens: 256 };
let client: NativeClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new NativeClient('/bundled/helper');
});
afterEach(() => {
  client.dispose();
  vi.useRealTimers();
});

it('rejects outstanding requests on exit and isolates late events from the old process', async () => {
  const first = child();
  const next = child();
  const failed = Promise.allSettled([client.status(), client.status()]);
  first.emit('close', 1, null);
  expect((await failed).map((value) => value.status)).toEqual(['rejected', 'rejected']);
  const status = client.status();
  first.emit('error', new Error('late'));
  const id = next.stdin.read().readUInt32LE(5);
  next.stdout.write(frame(id, 1, Buffer.from([0, 32, 0, 0, 1])));
  await expect(status).resolves.toEqual({ context: 8192, exact: true, reason: undefined });
});

it('propagates availability and framework errors to their respective callers', async () => {
  const helper = child();
  const reason = 'Enable Apple Intelligence in System Settings.';
  const status = client.status();
  const probe = helper.stdin.read().readUInt32LE(5);
  const count = client.count('hello', token());
  const request = helper.stdin.read().readUInt32LE(5);
  helper.stdout.write(
    Buffer.concat([
      frame(request, 7, Buffer.from(reason)),
      frame(probe, 1, Buffer.concat([Buffer.from([0, 16, 0, 0, 0]), Buffer.from(reason)])),
    ]),
  );
  expect((await status).reason).toBe(reason);
  await expect(count).rejects.toThrow(reason);
});

it('cancels only the addressed stream and ignores its in-flight output', async () => {
  const helper = child();
  const stop = token();
  const delta = vi.fn();
  const trimmed = vi.fn();
  const generation = client.generate([], options, stop, delta, trimmed);
  expect(client.generating).toBe(true);
  const id = helper.stdin.read().readUInt32LE(5);
  helper.stdout.write(frame(id, 4));
  helper.stdout.write(frame(id, 3, Buffer.from('🌿')));
  stop.cancel();
  expect(client.generating).toBe(false);
  expect(helper.stdin.read()).toEqual(frame(id, 4));
  const count = client.count('🌿', token());
  const countId = helper.stdin.read().readUInt32LE(5);
  helper.stdout.write(
    Buffer.concat([
      frame(id, 3, Buffer.from('late')),
      frame(countId, 2, Buffer.from([3, 0, 0, 0])),
      frame(id, 5),
    ]),
  );
  await expect(generation).rejects.toThrow('Cancelled');
  await expect(count).resolves.toBe(3);
  expect(trimmed).toHaveBeenCalledOnce();
  expect(delta.mock.calls).toEqual([['🌿']]);
});

it('rejects malformed or mismatched responses and releases pending callers', async () => {
  const helper = child();
  const status = client.status();
  const id = helper.stdin.read().readUInt32LE(5);
  helper.stdout.write(frame(id, 5));
  await expect(status).rejects.toThrow('invalid response');
  expect(helper.kill).toHaveBeenCalledOnce();
});

it('bounds outstanding requests even during a cancellation burst', async () => {
  const helper = child();
  const stop = token();
  const cancelled = client.count('discard', stop);
  const id = helper.stdin.read().readUInt32LE(5);
  stop.cancel();
  await expect(cancelled).rejects.toThrow('Cancelled');
  const pending = Promise.allSettled(Array.from({ length: 63 }, () => client.status()));
  await expect(client.status()).rejects.toThrow('busy');
  helper.stdout.write(frame(id, 6));
  const next = client.status();
  client.dispose();
  await expect(next).rejects.toThrow('restarted');
  await pending;
});

it('reaps a stuck cancellation and retires an idle helper without interrupting active work', async () => {
  vi.useFakeTimers();
  const stuck = child();
  const stop = token();
  const count = client.count('maple', stop);
  vi.advanceTimersByTime(65_000);
  expect(stuck.kill).not.toHaveBeenCalled();
  stop.cancel();
  await expect(count).rejects.toThrow('Cancelled');
  vi.advanceTimersByTime(10_000);
  expect(stuck.kill).toHaveBeenCalledOnce();

  const next = child();
  const status = client.status();
  next.stdout.write(frame(next.stdin.read().readUInt32LE(5), 1, Buffer.from([0, 16, 0, 0, 0])));
  await status;
  vi.advanceTimersByTime(60_000);
  expect(next.kill).toHaveBeenCalledOnce();
});

it('terminates a silent connection and allows a fresh probe', async () => {
  vi.useFakeTimers();
  const silent = child();
  const stalled = client.status();
  vi.advanceTimersByTime(120_000);
  await expect(stalled).rejects.toThrow('stopped responding');
  expect(silent.kill).toHaveBeenCalledOnce();
  const fresh = child();
  const recovered = client.status();
  fresh.stdout.write(frame(fresh.stdin.read().readUInt32LE(5), 1, Buffer.from([0, 16, 0, 0, 1])));
  await expect(recovered).resolves.toHaveProperty('context', 4096);
});

it('releases the byte budget only when a large request finishes', async () => {
  const helper = child();
  const text = 'x'.repeat(8 * 1024 * 1024 - 5);
  const count = client.count(text, token());
  const id = helper.stdin.read().readUInt32LE(5);
  await expect(client.count(text, token())).rejects.toThrow('busy');
  helper.stdout.write(frame(id, 2, Buffer.from([20, 0, 0, 0])));
  await expect(count).resolves.toBe(20);
  const next = client.count(text, token());
  helper.stdout.write(frame(helper.stdin.read().readUInt32LE(5), 2, Buffer.from([20, 0, 0, 0])));
  await expect(next).resolves.toBe(20);
});
