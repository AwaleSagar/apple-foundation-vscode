import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import * as vscode from 'vscode';
import { turnContext } from '../chat/context';
import { buildMessages } from '../chat/prompts';
import { readLimits } from '../core/config';
import { type HistoryTurn, prependHistory, takeRecentHistory } from '../core/history';
import type { NativeClient } from '../native/client';
import { chatView } from './chatView';

export const MAX_HISTORY_TURNS = 40;
export const MAX_HISTORY_CHARS = 128_000;

export function boundHistory(
  history: readonly HistoryTurn[],
  maxTurns = MAX_HISTORY_TURNS,
  maxChars = MAX_HISTORY_CHARS,
): HistoryTurn[] {
  let recent = takeRecentHistory(history, maxTurns);
  while (recent[0]?.role === 'assistant') {
    recent = recent.slice(1);
  }
  if (maxChars <= 0) return [];
  let totalChars = recent.reduce((sum, turn) => sum + turn.content.length, 0);
  let start = 0;
  while (start < recent.length && totalChars > maxChars) {
    const first = recent[start];
    const next = recent[start + 1];
    if (!first) break;
    if (first.role === 'user' && next?.role === 'assistant') {
      totalChars -= first.content.length + next.content.length;
      start += 2;
    } else {
      totalChars -= first.content.length;
      start += 1;
    }
  }
  return start === 0 ? recent : recent.slice(start);
}

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
  private readonly configListener: vscode.Disposable;

  constructor(
    private readonly client: NativeClient,
    private readonly root: vscode.Uri,
  ) {
    this.configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('appleFoundation.model')) {
        void this.refresh();
      }
    });
  }

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
          if (['explain', 'doc', 'commit'].includes(message.action)) {
            if (this.active) {
              this.sync();
            } else {
              await this.run(message.action);
            }
          }
          break;
        case 'stop':
          this.stop();
          break;
        case 'send':
          if (typeof message.text === 'string' && message.text.trim()) {
            if (this.active) {
              this.draft = message.text;
              this.sync();
              this.post({
                type: 'restoreDraft',
                conversationId: this.conversationId,
                text: message.text,
              });
              void vscode.window.showInformationMessage(
                'Stop the current reply before starting another.',
              );
            } else {
              this.draft = '';
              await this.run(undefined, message.text.trim());
            }
          } else {
            this.sync();
          }
          break;
      }
    });
    let selection = this.selectedFile();
    const updateSelection = (force = false) => {
      const file = this.selectedFile();
      if (!force && file === selection) return;
      selection = file;
      if (view.visible && !this.turns.length) this.post({ type: 'selection', file });
    };
    const selectionListeners = vscode.Disposable.from(
      vscode.window.onDidChangeActiveTextEditor(() => updateSelection()),
      vscode.window.onDidChangeTextEditorSelection(() => updateSelection()),
      view.onDidChangeVisibility(() => {
        if (view.visible) updateSelection(true);
      }),
    );
    view.onDidDispose(() => {
      listener.dispose();
      selectionListeners.dispose();
      if (this.view === view) this.view = undefined;
    });
  }

  private selectedFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) return undefined;
    if (!editor.document.getText(editor.selection).trim()) return undefined;
    return basename(editor.document.fileName);
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
      const effective = Math.min(status.context, Math.max(512, readLimits().maxContextTokens));
      readiness =
        status.reason ??
        (effective < status.context
          ? `On device · ${effective.toLocaleString()} / ${status.context.toLocaleString()} tokens`
          : `On device · ${status.context.toLocaleString()} tokens`);
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
    let turn: Exchange | undefined;
    try {
      // Capture the selection or repository before opening the sidebar or appending a turn.
      const ctx = await turnContext(command, prompt, source);
      if (cancellation.token.isCancellationRequested) return undefined;
      const current = buildMessages(ctx);
      const label =
        command === 'doc'
          ? 'Document selection'
          : command === 'explain'
            ? 'Explain selection'
            : 'Draft commit message';
      turn = {
        user: command ? label : prompt,
        assistant: '',
        notice: '',
        format: command === 'doc' ? 'code' : command === 'commit' ? 'text' : 'markdown',
      };
      this.turns.push(turn);
      this.sync();
      if (command && !cancellation.token.isCancellationRequested) await this.focus();
      const activeTurn = turn;
      await this.client.generate(
        prependHistory(current, command ? [] : this.history),
        readLimits(),
        cancellation.token,
        (text) => {
          if (this.active !== cancellation) return;
          activeTurn.assistant += text;
          this.post({ type: 'delta', text });
        },
        () => {
          if (this.active !== cancellation) return;
          activeTurn.notice = 'Earlier turns were trimmed to fit the context window.';
          this.sync();
        },
      );
      const user = current.find((message) => message.role === 'user');
      if (user && activeTurn.assistant.trim() && this.active === cancellation) {
        this.history = boundHistory([
          ...this.history,
          { role: 'user', content: user.content },
          { role: 'assistant', content: activeTurn.assistant },
        ]);
      }
      return activeTurn.assistant;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (turn) {
        turn.notice = cancellation.token.isCancellationRequested ? 'Stopped.' : message;
        if (command && !cancellation.token.isCancellationRequested) await this.focus();
      } else if (
        !cancellation.token.isCancellationRequested &&
        message !== 'Repository selection cancelled.'
      ) {
        void vscode.window.showInformationMessage(message);
      }
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
    this.configListener.dispose();
    this.clear();
  }
}
