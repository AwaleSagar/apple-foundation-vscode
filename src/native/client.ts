import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type * as vscode from 'vscode';
import { checkHost, currentHostInfo } from '../core/availability';

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

interface Reply {
  id: string;
  kind: 'count' | 'status' | 'delta' | 'done' | 'trimmed' | 'cancelled' | 'error';
  text?: string;
  context?: number;
  exact?: boolean;
  value?: number;
}

interface Pending {
  receive(reply: Reply): void;
  fail(error: Error): void;
}

export class NativeClient {
  private child?: ChildProcessWithoutNullStreams | undefined;
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly executable: string) {}

  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const host = checkHost(currentHostInfo());
    if (!host.available) throw new Error(host.reason);
    const child = spawn(this.executable, [], { stdio: 'pipe' });
    this.child = child;
    child.stderr.resume();
    const failed = (error: Error) => {
      if (this.child !== child) return;
      this.dispose(error);
    };
    child.on('error', failed);
    child.stdin.on('error', failed);
    child.on('close', (code, signal) =>
      failed(new Error(`Local helper exited (${signal ?? code}). Retry to restart it.`)),
    );
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (this.child !== child) return;
      try {
        const event: Reply = JSON.parse(line);
        this.pending.get(event.id)?.receive(event);
      } catch {
        failed(new Error('The local helper returned an invalid response.'));
      }
    });
    return child;
  }

  private async request(
    data: object,
    token?: vscode.CancellationToken,
    delta?: (text: string) => void,
    trimmed?: () => void,
  ): Promise<Reply> {
    if (token?.isCancellationRequested) throw new Error('Cancelled.');
    const child = this.start();
    const id = randomUUID();
    let subscription: vscode.Disposable | undefined;
    try {
      return await new Promise<Reply>((resolve, reject) => {
        this.pending.set(id, {
          fail: reject,
          receive(reply) {
            switch (reply.kind) {
              case 'delta':
                delta?.(reply.text ?? '');
                break;
              case 'trimmed':
                trimmed?.();
                break;
              case 'cancelled':
                reject(new Error('Cancelled.'));
                break;
              case 'error':
                reject(new Error(reply.text ?? 'Local inference failed.'));
                break;
              default:
                resolve(reply);
            }
          },
        });
        child.stdin.write(JSON.stringify({ ...data, id }) + '\n');
        subscription = token?.onCancellationRequested(() => {
          if (this.child === child) child.stdin.write(JSON.stringify({ id, op: 'cancel' }) + '\n');
          this.pending.delete(id);
          reject(new Error('Cancelled.'));
        });
      });
    } finally {
      subscription?.dispose();
      this.pending.delete(id);
    }
  }

  async status(token?: vscode.CancellationToken) {
    const reply = await this.request({ op: 'status' }, token);
    if (!reply.context) throw new Error('Missing device context size.');
    return { context: reply.context, reason: reply.text, exact: reply.exact === true };
  }

  async count(text: string, token: vscode.CancellationToken) {
    const reply = await this.request({ op: 'count', text }, token);
    if (reply.value === undefined) throw new Error('Missing device token count.');
    return reply.value;
  }

  async generate(
    messages: readonly ChatMessage[],
    limits: { maxContextTokens: number; maxOutputTokens: number },
    token: vscode.CancellationToken,
    delta: (text: string) => void,
    trimmed?: () => void,
  ) {
    await this.request({ op: 'generate', messages, ...limits }, token, delta, trimmed);
  }

  dispose(error = new Error('Local helper restarted. Retry the request.')) {
    const child = this.child;
    this.child = undefined;
    child?.kill();
    for (const pending of this.pending.values()) pending.fail(error);
    this.pending.clear();
  }
}
