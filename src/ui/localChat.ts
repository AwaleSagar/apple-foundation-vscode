import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { turnContext } from '../chat/context';
import { buildMessages } from '../chat/prompts';
import { readLimits } from '../core/config';
import { type HistoryTurn, prependHistory } from '../core/history';
import type { NativeClient } from '../native/client';

interface Exchange {
  user: string;
  assistant: string;
  notice: string;
}

export class LocalChat implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private turns: Exchange[] = [];
  private history: HistoryTurn[] = [];
  private active: vscode.CancellationTokenSource | undefined;
  private readiness = 'Checking Apple Intelligence…';
  private probe = 0;

  constructor(
    private readonly client: NativeClient,
    private readonly root: vscode.Uri,
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.root, 'media', 'chat');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = randomBytes(18).toString('base64');
    const resource = (file: string) => view.webview.asWebviewUri(vscode.Uri.joinPath(media, file));
    view.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'">
      <link rel="stylesheet" href="${resource('chat.css')}"><title>Local Chat</title></head>
      <body><header><span id="readiness" role="status"></span><button id="new">New Chat</button></header>
      <main id="turns" aria-label="Conversation" tabindex="0"></main>
      <form><label for="prompt">Message</label><textarea id="prompt" rows="3" placeholder="Ask a question…" required></textarea>
      <div class="actions"><span aria-live="polite" id="activity"></span><button type="button" id="stop" hidden>Stop</button><button id="send">Send</button></div></form>
      <script nonce="${nonce}" src="${resource('chat.js')}"></script></body></html>`;
    const listener = view.webview.onDidReceiveMessage(async (message) => {
      switch (message?.type) {
        case 'ready':
          this.sync();
          await this.refresh();
          break;
        case 'new':
          this.clear();
          break;
        case 'stop':
          this.stop();
          break;
        case 'send':
          if (typeof message.text === 'string' && message.text.trim() && !this.active)
            await this.run(undefined, message.text.trim());
          break;
      }
    });
    view.onDidDispose(() => {
      listener.dispose();
      if (this.view === view) this.view = undefined;
    });
  }

  private post(message: object) {
    void this.view?.webview.postMessage(message);
  }
  private sync() {
    this.post({ type: 'state', turns: this.turns, busy: !!this.active, readiness: this.readiness });
  }
  async refresh() {
    const probe = ++this.probe;
    let readiness: string;
    try {
      const status = await this.client.status();
      readiness = status.reason ?? `On device · ${status.context.toLocaleString()} tokens`;
    } catch (error) {
      readiness = error instanceof Error ? error.message : String(error);
    }
    if (this.probe === probe) {
      this.readiness = readiness;
      this.post({ type: 'readiness', text: readiness });
    }
    return readiness;
  }

  focus() {
    return vscode.commands.executeCommand('appleFoundation.localChat.focus');
  }
  stop() {
    this.active?.cancel();
  }
  clear() {
    this.stop();
    this.active = undefined;
    this.history = [];
    this.turns = [];
    this.sync();
  }

  async run(
    command: string | undefined,
    prompt = '',
    source?: { rootUri?: vscode.Uri | undefined },
  ) {
    if (this.active) {
      void vscode.window.showInformationMessage('Stop the current reply before starting another.');
      return;
    }
    const cancellation = new vscode.CancellationTokenSource();
    this.active = cancellation;
    const label =
      command === 'doc'
        ? 'Document selection'
        : command === 'explain'
          ? 'Explain selection'
          : 'Draft commit message';
    const turn = { user: command ? label : prompt, assistant: '', notice: '' };
    this.turns.push(turn);
    this.sync();
    try {
      // Capture the selection or repository before opening the sidebar.
      const ctx = command ? await turnContext(command, prompt, source) : { command, prompt };
      const current = buildMessages(ctx);
      if (command && !cancellation.token.isCancellationRequested) await this.focus();
      await this.client.generate(
        prependHistory(current, command ? [] : this.history),
        readLimits(),
        cancellation.token,
        (text) => {
          turn.assistant += text;
          this.post({ type: 'delta', text });
        },
        () => {
          turn.notice = 'Earlier turns were trimmed to fit the context window.';
          this.sync();
        },
      );
      const user = current.find((message) => message.role === 'user');
      if (user && this.active === cancellation)
        this.history.push(
          { role: 'user', content: user.content },
          { role: 'assistant', content: turn.assistant },
        );
      return turn.assistant;
    } catch (error) {
      turn.notice = cancellation.token.isCancellationRequested
        ? 'Stopped.'
        : error instanceof Error
          ? error.message
          : String(error);
      if (command && !cancellation.token.isCancellationRequested) await this.focus();
      return undefined;
    } finally {
      if (this.active === cancellation) {
        this.active = undefined;
        this.sync();
      }
      cancellation.dispose();
    }
  }

  dispose() {
    this.clear();
  }
}
