import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import type * as vscode from 'vscode';
import {
  decodeReply,
  encodeRequest,
  FrameReader,
  HELPER_BUSY,
  invalidResponse,
  type Reply,
  type Request,
} from './protocol';

const MAX_PENDING = 64;
const MAX_PENDING_BYTES = 16 * 1024 * 1024;
const IDLE_MS = 60_000;
const STALL_MS = 120_000;
const CANCEL_GRACE_MS = 10_000;
const FORCE_KILL_MS = 2_000;

export interface HelperLogger {
  warn(message: string): void;
  error(message: string): void;
}

const GATEKEEPER_HINT =
  'Reinstall Local Chat from the Marketplace, or if installed from a downloaded VSIX, clear quarantine with `xattr -dr com.apple.quarantine` on the extension folder.';

function formatSpawnError(error: Error): Error {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'EACCES') {
    return new Error(
      'The bundled local helper could not be started (binary missing or not executable). Reinstall Local Chat for macOS (Apple Silicon).',
    );
  }
  if (code === 'EPERM') {
    return new Error(
      `macOS blocked the bundled local helper (EPERM, likely Gatekeeper or quarantine). ${GATEKEEPER_HINT}`,
    );
  }
  return error;
}

function formatExitError(
  code: number | null,
  signal: NodeJS.Signals | null,
  receivedOutput: boolean,
): Error {
  if (signal === 'SIGKILL' && !receivedOutput) {
    return new Error(
      `macOS terminated the bundled local helper on launch (SIGKILL, likely Gatekeeper or quarantine). ${GATEKEEPER_HINT}`,
    );
  }
  return new Error(`Local helper exited (${signal ?? code}). Retry to restart it.`);
}

interface Pending {
  bytes: number;
  expected: 'status' | 'count' | 'done';
  resolve(reply: Reply): void;
  reject(error: Error): void;
  delta: ((text: string) => void) | undefined;
  trimmed: (() => void) | undefined;
  subscription?: vscode.Disposable | undefined;
  cancelTimeout?: NodeJS.Timeout;
}

export class Connection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, Pending>();
  private pendingBytes = 0;
  private nextId = 0;
  private idle?: NodeJS.Timeout | undefined;
  private watchdog?: NodeJS.Timeout | undefined;
  private outputEndTimer?: NodeJS.Timeout;
  private closed = false;

  constructor(
    executable: string,
    private readonly onClose: () => void,
    private readonly logger?: HelperLogger,
  ) {
    const child = spawn(executable, [], { stdio: 'pipe' });
    this.child = child;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (text) this.logger?.warn(`helper stderr: ${text.slice(0, 1024)}`);
    });
    const failed = (error: Error, log = true) => {
      if (log && !this.closed) this.logger?.error(error.message);
      this.close(error);
    };
    let receivedOutput = false;
    child.on('error', (error) => failed(formatSpawnError(error)));
    child.stdin.on('error', (error) => failed(error));
    child.stderr.on('error', (error) => failed(error));
    child.stdout.on('error', (error) => failed(error));
    // 'close' includes the exit reason and follows the last stdout data. EOF
    // can arrive first when macOS terminates the helper during launch.
    child.on('close', (code, signal) =>
      failed(formatExitError(code, signal, receivedOutput), code !== 0 || signal !== null),
    );
    child.stdout.once('end', () => {
      if (this.closed) return;
      this.outputEndTimer = setTimeout(
        () => failed(new Error('The local helper closed its output. Retry the request.')),
        1_000,
      ).unref();
    });
    const frames = new FrameReader();
    const receive = (body: Buffer) => this.receive(body.readUInt32LE(1), decodeReply(body));
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.closed) return;
      receivedOutput = true;
      try {
        frames.push(chunk, receive);
      } catch {
        failed(invalidResponse());
      }
    });
    this.scheduleIdle();
  }

  get generating() {
    for (const request of this.pending.values()) {
      if (request.expected === 'done') return true;
    }
    return false;
  }

  request(
    request: Exclude<Request, { op: 'cancel' }>,
    token?: vscode.CancellationToken,
    delta?: (text: string) => void,
    trimmed?: () => void,
  ): Promise<Reply> {
    if (this.pending.size >= MAX_PENDING) throw new Error(HELPER_BUSY);
    do {
      this.nextId = (this.nextId + 1) >>> 0;
    } while (this.pending.has(this.nextId));
    const id = this.nextId;
    const frame = encodeRequest(id, request, MAX_PENDING_BYTES - this.pendingBytes);

    clearTimeout(this.idle);
    this.watchdog ??= setTimeout(() => {
      const error = new Error('The local helper stopped responding. Retry the request.');
      this.logger?.error(error.message);
      this.close(error);
    }, STALL_MS).unref();
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        bytes: frame.length,
        expected: request.op === 'generate' ? 'done' : request.op,
        resolve,
        reject,
        delta,
        trimmed,
      };
      this.pending.set(id, pending);
      this.pendingBytes += pending.bytes;
      try {
        this.child.stdin.write(frame);
        const cancel = () => this.cancel(id, pending, new Error('Cancelled.'));
        pending.subscription = token?.onCancellationRequested(cancel);
        if (token?.isCancellationRequested) cancel();
      } catch (error) {
        this.close(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private cancel(id: number, pending: Pending, error: Error) {
    if (pending.cancelTimeout || !this.pending.has(id)) return;
    pending.reject(error);
    // Keep admission credit until native work actually terminates.
    pending.cancelTimeout = setTimeout(() => {
      const cancelError = new Error(
        'The local helper stopped responding to cancellation. Retry the request.',
      );
      this.logger?.error(cancelError.message);
      this.close(cancelError);
    }, CANCEL_GRACE_MS).unref();
    this.child.stdin.write(encodeRequest(id, { op: 'cancel' }));
  }

  private receive(id: number, reply: Reply) {
    const pending = this.pending.get(id);
    if (!pending) throw invalidResponse();
    this.watchdog?.refresh();
    if (reply.kind === 'delta' || reply.kind === 'trimmed') {
      if (pending.expected !== 'done') throw invalidResponse();
      if (pending.cancelTimeout) return;
      try {
        if (reply.kind === 'delta') pending.delta?.(reply.text);
        else pending.trimmed?.();
      } catch (error) {
        this.cancel(id, pending, error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    if (reply.kind === 'error') pending.reject(new Error(reply.text));
    else if (reply.kind === 'cancelled') pending.reject(new Error('Cancelled.'));
    else if (reply.kind === pending.expected) pending.resolve(reply);
    else throw invalidResponse();

    pending.subscription?.dispose();
    clearTimeout(pending.cancelTimeout);
    this.pending.delete(id);
    this.pendingBytes -= pending.bytes;
    if (!this.pending.size) {
      clearTimeout(this.watchdog);
      this.watchdog = undefined;
      this.scheduleIdle();
    }
  }

  private scheduleIdle() {
    this.idle = setTimeout(() => this.close(), IDLE_MS).unref();
  }

  close(error = new Error('Local helper restarted. Retry the request.')) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.outputEndTimer);
    clearTimeout(this.idle);
    clearTimeout(this.watchdog);
    this.onClose();
    if (this.child.pid !== undefined) {
      this.child.kill();
      if (this.child.exitCode === null && this.child.signalCode === null) {
        setTimeout(() => {
          if (this.child.exitCode === null && this.child.signalCode === null) {
            this.child.kill('SIGKILL');
          }
        }, FORCE_KILL_MS).unref();
      }
    }
    for (const pending of this.pending.values()) {
      pending.subscription?.dispose();
      clearTimeout(pending.cancelTimeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
