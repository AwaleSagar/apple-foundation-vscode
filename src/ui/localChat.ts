import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import * as vscode from 'vscode';
import { turnContext } from '../chat/context';
import { buildMessages } from '../chat/prompts';
import { readLimits } from '../core/config';
import { type HistoryTurn, prependHistory } from '../core/history';
import type { NativeClient } from '../native/client';
import { chatView } from './chatView';

interface Exchange {
  format: 'markdown' | 'code' | 'text';
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
  private conversationId = randomUUID();
  private draft = '';
  private focusOnReady = false;

  constructor(
    private readonly client: NativeClient,
    private readonly root: vscode.Uri,
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.html = chatView(view.webview, this.root);
    const listener = view.webview.onDidReceiveMessage(async (message) => {
      if (!message || (message.type !== 'ready' && message.conversationId !== this.conversationId))
        return;
      switch (message.type) {
        case 'ready':
          this.sync();
          if (this.focusOnReady) {
            this.focusOnReady = false;
            this.post({ type: 'focus' });
          }
          await this.refresh();
          break;
        case 'draft':
          if (typeof message.text === 'string') this.draft = message.text;
          break;
        case 'action':
          if (['explain', 'doc', 'commit'].includes(message.action) && !this.active)
            await this.run(message.action);
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
    let selection = this.selectedFile();
    const updateSelection = () => {
      const file = this.selectedFile();
      if (file === selection) return;
      selection = file;
      if (view.visible && !this.turns.length) this.post({ type: 'selection', file });
    };
    const selectionListeners = vscode.Disposable.from(
      vscode.window.onDidChangeActiveTextEditor(updateSelection),
      vscode.window.onDidChangeTextEditorSelection(updateSelection),
    );
    view.onDidDispose(() => {
      listener.dispose();
      selectionListeners.dispose();
      if (this.view === view) this.view = undefined;
    });
  }

  private selectedFile() {
    const editor = vscode.window.activeTextEditor;
    return editor && !editor.selection.isEmpty ? basename(editor.document.fileName) : undefined;
  }

  private post(message: object) {
    void this.view?.webview.postMessage(message);
  }
  private sync() {
    this.post({
      type: 'state',
      conversationId: this.conversationId,
      draft: this.draft,
      selectedFile: this.selectedFile(),
      turns: this.turns,
      busy: !!this.active,
      readiness: this.readiness,
    });
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

  async focus() {
    this.focusOnReady = !this.view?.visible;
    await vscode.commands.executeCommand('appleFoundation.localChat.focus');
    this.post({ type: 'focus' });
  }
  stop() {
    this.active?.cancel();
  }
  clear() {
    this.stop();
    this.active = undefined;
    this.conversationId = randomUUID();
    this.draft = '';
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
    const turn: Exchange = {
      user: command ? label : prompt,
      assistant: '',
      notice: '',
      format: command === 'doc' ? 'code' : command === 'commit' ? 'text' : 'markdown',
    };
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
          if (this.active !== cancellation) return;
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
