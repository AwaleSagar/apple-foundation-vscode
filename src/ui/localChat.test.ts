import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryTurn } from '../core/history';

const infoMessages: string[] = [];

vi.mock('vscode', () => {
  class CancellationTokenSource {
    private cancelled = false;
    private readonly listeners: (() => void)[] = [];
    readonly token = {
      get isCancellationRequested() {
        return false;
      },
      onCancellationRequested: (listener: () => void) => {
        this.listeners.push(listener);
        return { dispose: () => undefined };
      },
    };
    constructor() {
      Object.defineProperty(this.token, 'isCancellationRequested', {
        get: () => this.cancelled,
      });
    }
    cancel() {
      this.cancelled = true;
      for (const listener of this.listeners) listener();
    }
    dispose() {}
  }

  return {
    CancellationTokenSource,
    Disposable: {
      from: (...disposables: { dispose: () => void }[]) => ({
        dispose: () => {
          for (const d of disposables) d.dispose();
        },
      }),
    },
    Uri: {
      joinPath: (base: { path: string }, ...segments: string[]) => ({
        path: [base.path, ...segments].join('/'),
      }),
    },
    workspace: {
      getConfiguration: () => ({ get: () => undefined }),
      onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    },
    window: {
      activeTextEditor: undefined,
      showInformationMessage: (message: string) => {
        infoMessages.push(message);
        return Promise.resolve(undefined);
      },
      onDidChangeActiveTextEditor: () => ({ dispose: () => undefined }),
      onDidChangeTextEditorSelection: () => ({ dispose: () => undefined }),
    },
    commands: {
      executeCommand: () => Promise.resolve(undefined),
    },
  };
});

import type * as vscode from 'vscode';
import type { ChatMessage, NativeClient } from '../native/client';
import { boundHistory, LocalChat, MAX_HISTORY_CHARS, MAX_HISTORY_TURNS } from './localChat';

function makeExchanges(count: number, contentSize = 10): HistoryTurn[] {
  const turns: HistoryTurn[] = [];
  for (let i = 0; i < count; i++) {
    turns.push(
      { role: 'user', content: `u${i}:${'x'.repeat(contentSize)}` },
      { role: 'assistant', content: `a${i}:${'y'.repeat(contentSize)}` },
    );
  }
  return turns;
}

describe('boundHistory', () => {
  it('caps retained turns to MAX_HISTORY_TURNS keeping the newest exchanges', () => {
    const turns = makeExchanges(30);
    const bounded = boundHistory(turns);
    expect(bounded).toHaveLength(MAX_HISTORY_TURNS);
    expect(bounded[0]?.role).toBe('user');
    expect(bounded[0]?.content.startsWith('u10:')).toBe(true);
    expect(bounded.at(-1)?.content.startsWith('a29:')).toBe(true);
  });

  it('drops an orphan leading assistant turn when maxTurns is odd', () => {
    const turns = makeExchanges(3);
    const bounded = boundHistory(turns, 3, 10_000);
    expect(bounded).toHaveLength(2);
    expect(bounded[0]?.role).toBe('user');
    expect(bounded[0]?.content.startsWith('u2:')).toBe(true);
  });

  it('drops oldest user+assistant exchanges to stay within maxChars', () => {
    const turns = makeExchanges(5, 100);
    // Each exchange is ~206 chars; 450 chars fits 2 newest exchanges (4 turns).
    const bounded = boundHistory(turns, MAX_HISTORY_TURNS, 450);
    expect(bounded).toHaveLength(4);
    expect(bounded[0]?.role).toBe('user');
    expect(bounded[0]?.content.startsWith('u3:')).toBe(true);
    expect(bounded.at(-1)?.content.startsWith('a4:')).toBe(true);
    const totalChars = bounded.reduce((sum, turn) => sum + turn.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(450);
  });

  it('returns empty history when even the latest exchange exceeds MAX_HISTORY_CHARS', () => {
    const turns: HistoryTurn[] = [
      { role: 'user', content: 'u'.repeat(MAX_HISTORY_CHARS) },
      { role: 'assistant', content: 'a'.repeat(100) },
    ];
    expect(boundHistory(turns)).toEqual([]);
  });
});

describe('LocalChat send-race and bounded history', () => {
  beforeEach(() => {
    infoMessages.length = 0;
  });

  it('restores draft via restoreDraft and keeps host draft when send races an active turn', async () => {
    let releaseFirst!: () => void;
    const firstTurn = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sentMessages: Record<string, unknown>[] = [];
    let receiveMessage!: (message: Record<string, unknown>) => Promise<void>;

    const client = {
      status: vi.fn().mockResolvedValue({ context: 4096 }),
      generate: vi.fn().mockImplementation(async (_messages, _limits, _token, onDelta) => {
        onDelta('first answer');
        await firstTurn;
      }),
    } as unknown as NativeClient;

    const view = {
      visible: true,
      webview: {
        cspSource: 'vscode-webview://test',
        options: {},
        html: '',
        asWebviewUri: (uri: { path: string }) => uri,
        postMessage: (message: Record<string, unknown>) => {
          sentMessages.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (handler: (message: Record<string, unknown>) => Promise<void>) => {
          receiveMessage = handler;
          return { dispose: () => undefined };
        },
      },
      onDidChangeVisibility: () => ({ dispose: () => undefined }),
      onDidDispose: () => ({ dispose: () => undefined }),
    } as unknown as vscode.WebviewView;

    const chat = new LocalChat(client, { path: '/ext' } as unknown as vscode.Uri);
    chat.resolveWebviewView(view);

    await receiveMessage({ type: 'ready' });
    const initialState = sentMessages.find((m) => m['type'] === 'state');
    const conversationId = initialState?.['conversationId'] as string;
    expect(conversationId).toBeTruthy();

    // Start first turn (stays active until releaseFirst is called).
    const firstRun = receiveMessage({ type: 'send', conversationId, text: 'first prompt' });
    await Promise.resolve();
    await Promise.resolve();

    // Simulate a racing send arriving while the first turn is still active.
    sentMessages.length = 0;
    await receiveMessage({ type: 'send', conversationId, text: 'second draft text' });

    const stateAfterReject = sentMessages.find((m) => m['type'] === 'state');
    const restore = sentMessages.find((m) => m['type'] === 'restoreDraft');
    expect(stateAfterReject?.['draft']).toBe('second draft text');
    expect(stateAfterReject?.['busy']).toBe(true);
    expect(restore).toEqual({
      type: 'restoreDraft',
      conversationId,
      text: 'second draft text',
    });
    expect(infoMessages).toContain('Stop the current reply before starting another.');

    // If webview reloads via 'ready', draft is still preserved on the host.
    sentMessages.length = 0;
    await receiveMessage({ type: 'ready' });
    expect(sentMessages.find((m) => m['type'] === 'state')?.['draft']).toBe('second draft text');

    // Racing action while busy also syncs state back so starter buttons unlock.
    sentMessages.length = 0;
    await receiveMessage({ type: 'action', conversationId, action: 'commit' });
    expect(sentMessages.some((m) => m['type'] === 'state')).toBe(true);

    releaseFirst();
    await firstRun;
    chat.dispose();
  });

  it('bounds history sent to client.generate across many turns', async () => {
    const observedLengths: number[] = [];
    const client = {
      status: vi.fn().mockResolvedValue({ context: 4096 }),
      generate: vi
        .fn()
        .mockImplementation(async (messages: ChatMessage[], _limits, _token, onDelta) => {
          observedLengths.push(messages.length);
          onDelta('ok');
        }),
    } as unknown as NativeClient;

    const chat = new LocalChat(client, { path: '/ext' } as unknown as vscode.Uri);
    for (let i = 0; i < 25; i++) {
      await chat.run(undefined, `prompt ${i}`);
    }
    // Each call gets 1 system message + up to MAX_HISTORY_TURNS history messages + 1 current user message.
    const maxObserved = Math.max(...observedLengths);
    expect(maxObserved).toBeLessThanOrEqual(MAX_HISTORY_TURNS + 2);
    expect(observedLengths.at(-1)).toBe(MAX_HISTORY_TURNS + 2);
    chat.dispose();
  });
});
