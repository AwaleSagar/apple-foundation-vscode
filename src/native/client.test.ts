import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, expect, it, vi } from 'vitest';
import { NativeClient } from './client';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../core/availability', () => ({
  currentHostInfo: () => ({}),
  checkHost: () => ({ available: true }),
}));

function child() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stdin: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
}
beforeEach(() => vi.clearAllMocks());

it('rejects all outstanding requests on exit and isolates late events from the old helper', async () => {
  const first = child(),
    next = child();
  const spawnMock = vi.mocked(spawn);
  spawnMock
    .mockReturnValueOnce(first as unknown as ReturnType<typeof spawn>)
    .mockReturnValueOnce(next as unknown as ReturnType<typeof spawn>);
  const client = new NativeClient('/bundled/helper');
  const failed = Promise.allSettled([client.status(), client.status()]);
  first.emit('close', 1, null);
  expect((await failed).map((value) => value.status)).toEqual(['rejected', 'rejected']);
  const status = client.status();
  first.emit('error', new Error('late'));
  const { id } = JSON.parse(next.stdin.read().toString());
  next.stdout.write(JSON.stringify({ id, kind: 'status', context: 8192, exact: true }) + '\n');
  await expect(status).resolves.toEqual({ context: 8192, exact: true, reason: undefined });
  client.dispose();
});

it('keeps the framework availability reason and forwards the failure to the request', async () => {
  const helper = child();
  vi.mocked(spawn).mockReturnValueOnce(helper as unknown as ReturnType<typeof spawn>);
  const client = new NativeClient('/bundled/helper');
  const status = client.status();
  const reason = 'Enable Apple Intelligence in System Settings.';
  const probe = JSON.parse(helper.stdin.read().toString());
  helper.stdout.write(
    `${JSON.stringify({ id: probe.id, kind: 'status', context: 4096, text: reason, exact: false })}\n`,
  );
  expect((await status).reason).toBe(reason);
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  };
  const count = client.count('hello', token);
  const request = JSON.parse(helper.stdin.read().toString());
  helper.stdout.write(`${JSON.stringify({ id: request.id, kind: 'error', text: reason })}\n`);
  await expect(count).rejects.toThrow(reason);
  client.dispose();
});
