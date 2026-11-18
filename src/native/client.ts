import type * as vscode from 'vscode';
import { checkHost, currentHostInfo } from '../core/availability';
import { Connection } from './connection';
import { type ChatMessage, invalidResponse } from './protocol';

export type { ChatMessage } from './protocol';

export class NativeClient {
  private connection?: Connection | undefined;
  constructor(private readonly executable: string) {}

  private connect(token?: vscode.CancellationToken) {
    if (token?.isCancellationRequested) throw new Error('Cancelled.');
    if (!this.connection) {
      const host = checkHost(currentHostInfo());
      if (!host.available) throw new Error(host.reason);
      this.connection = new Connection(this.executable, () => {
        this.connection = undefined;
      });
    }
    return this.connection;
  }

  async status(token?: vscode.CancellationToken) {
    const reply = await this.connect(token).request({ op: 'status' }, token);
    if (reply.kind !== 'status') throw invalidResponse();
    return { context: reply.context, exact: reply.exact, reason: reply.reason };
  }

  async count(text: string, token: vscode.CancellationToken) {
    const reply = await this.connect(token).request({ op: 'count', text }, token);
    if (reply.kind !== 'count') throw invalidResponse();
    return reply.value;
  }

  async generate(
    messages: readonly ChatMessage[],
    limits: { maxContextTokens: number; maxOutputTokens: number },
    token: vscode.CancellationToken,
    delta: (text: string) => void,
    trimmed?: () => void,
  ) {
    await this.connect(token).request(
      { op: 'generate', messages, ...limits },
      token,
      delta,
      trimmed,
    );
  }

  dispose() {
    this.connection?.close();
  }
}
