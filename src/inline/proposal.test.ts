import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { NativeClient } from '../native/client';

type CommandHandler = (...args: unknown[]) => unknown;
type TabChangeListener = (event: { closed: vscode.Tab[] }) => void;
type EditorChangeListener = (editor: vscode.TextEditor | undefined) => void;
type DocCloseListener = (document: vscode.TextDocument) => void;

const state = {
  commands: new Map<string, CommandHandler>(),
  contentProvider: undefined as vscode.TextDocumentContentProvider | undefined,
  tabChangeListeners: [] as TabChangeListener[],
  tabGroupChangeListeners: [] as (() => void)[],
  activeEditorListeners: [] as EditorChangeListener[],
  docCloseListeners: [] as DocCloseListener[],
  activeTab: undefined as vscode.Tab | undefined,
  allTabGroups: [] as { tabs: vscode.Tab[] }[],
  closedTabs: [] as vscode.Tab[][],
  warnings: [] as string[],
  contextKeys: new Map<string, unknown>(),
  activeTextEditor: undefined as vscode.TextEditor | undefined,
  showTextDocumentImpl: undefined as
    | ((doc: vscode.TextDocument) => Promise<vscode.TextEditor>)
    | undefined,
  createdThreads: [] as {
    uri: vscode.Uri;
    range: vscode.Range;
    comments: vscode.Comment[];
    canReply: boolean;
    label: string | undefined;
    collapsibleState: number;
    disposed: boolean;
    dispose: () => void;
  }[],
};

function resetMockState() {
  state.commands.clear();
  state.contentProvider = undefined;
  state.tabChangeListeners = [];
  state.tabGroupChangeListeners = [];
  state.activeEditorListeners = [];
  state.docCloseListeners = [];
  state.activeTab = undefined;
  state.allTabGroups = [];
  state.closedTabs = [];
  state.warnings = [];
  state.contextKeys.clear();
  state.activeTextEditor = undefined;
  state.showTextDocumentImpl = undefined;
  state.createdThreads = [];
}

vi.mock('vscode', () => {
  class Disposable {
    constructor(private readonly fn: () => void) {}
    dispose() {
      this.fn();
    }
    static from(...items: { dispose: () => void }[]) {
      return new Disposable(() => {
        for (const item of items) item.dispose();
      });
    }
  }

  class Uri {
    constructor(
      readonly scheme: string,
      readonly path: string,
    ) {}
    toString() {
      return `${this.scheme}:${this.path}`;
    }
    static from(parts: { scheme: string; path: string }) {
      return new Uri(parts.scheme, parts.path);
    }
  }

  class Range {
    readonly start: { line: number; character: number };
    readonly end: { line: number; character: number };
    constructor(
      startOrLine: number | { line: number; character: number },
      endOrChar: number | { line: number; character: number },
      endLine?: number,
      endChar?: number,
    ) {
      if (typeof startOrLine === 'number' && typeof endOrChar === 'number') {
        this.start = { line: startOrLine, character: endOrChar };
        this.end = { line: endLine ?? startOrLine, character: endChar ?? endOrChar };
      } else {
        this.start = startOrLine as { line: number; character: number };
        this.end = endOrChar as { line: number; character: number };
      }
    }
    get isEmpty() {
      return this.start.line === this.end.line && this.start.character === this.end.character;
    }
  }

  class TabInputTextDiff {
    constructor(
      readonly original: Uri,
      readonly modified: Uri,
    ) {}
  }

  class TabInputText {
    constructor(readonly uri: Uri) {}
  }

  return {
    Disposable,
    Uri,
    Range,
    TabInputTextDiff,
    TabInputText,
    ProgressLocation: { Notification: 15 },
    CommentMode: { Editing: 0, Preview: 1 },
    CommentThreadCollapsibleState: { Collapsed: 0, Expanded: 1 },
    workspace: {
      registerTextDocumentContentProvider: (
        _scheme: string,
        provider: vscode.TextDocumentContentProvider,
      ) => {
        state.contentProvider = provider;
        return new Disposable(() => undefined);
      },
      openTextDocument: async (uri: Uri) => ({
        uri,
        languageId: 'typescript',
      }),
      getConfiguration: () => ({
        get: (_key: string, defaultValue?: unknown) => defaultValue,
      }),
      fs: {
        isWritableFileSystem: () => true,
      },
      onDidCloseTextDocument: (listener: DocCloseListener) => {
        state.docCloseListeners.push(listener);
        return new Disposable(() => undefined);
      },
    },
    languages: {
      setTextDocumentLanguage: async () => undefined,
    },
    commands: {
      registerCommand: (id: string, handler: CommandHandler) => {
        state.commands.set(id, handler);
        return new Disposable(() => {
          state.commands.delete(id);
        });
      },
      executeCommand: async (id: string, ...args: unknown[]) => {
        if (id === 'setContext') {
          state.contextKeys.set(String(args[0]), args[1]);
        }
        return undefined;
      },
    },
    window: {
      get activeTextEditor() {
        return state.activeTextEditor;
      },
      onDidChangeActiveTextEditor: (listener: EditorChangeListener) => {
        state.activeEditorListeners.push(listener);
        return new Disposable(() => undefined);
      },
      showInformationMessage: async () => undefined,
      showWarningMessage: async (message: string) => {
        state.warnings.push(message);
        return undefined;
      },
      showInputBox: async () => undefined,
      showTextDocument: async (doc: vscode.TextDocument) => {
        if (state.showTextDocumentImpl) return state.showTextDocumentImpl(doc);
        throw new Error('showTextDocument not configured');
      },
      withProgress: async (
        _options: unknown,
        task: (progress: unknown, token: vscode.CancellationToken) => Promise<unknown>,
      ) =>
        task(
          {},
          {
            isCancellationRequested: false,
            onCancellationRequested: () => new Disposable(() => {}),
          },
        ),
      tabGroups: {
        get activeTabGroup() {
          return { activeTab: state.activeTab };
        },
        get all() {
          return state.allTabGroups;
        },
        close: async (tabs: vscode.Tab | readonly vscode.Tab[]) => {
          const list = Array.isArray(tabs) ? [...tabs] : [tabs];
          state.closedTabs.push(list);
          for (const group of state.allTabGroups) {
            group.tabs = group.tabs.filter((t) => !list.includes(t));
          }
          if (state.activeTab && list.includes(state.activeTab)) {
            state.activeTab = undefined;
          }
          for (const listener of state.tabChangeListeners) listener({ closed: list });
          return true;
        },
        onDidChangeTabs: (listener: TabChangeListener) => {
          state.tabChangeListeners.push(listener);
          return new Disposable(() => undefined);
        },
        onDidChangeTabGroups: (listener: () => void) => {
          state.tabGroupChangeListeners.push(listener);
          return new Disposable(() => undefined);
        },
      },
    },
    comments: {
      createCommentController: () => ({
        createCommentThread: (uri: vscode.Uri, range: vscode.Range, comments: vscode.Comment[]) => {
          const thread = {
            uri,
            range,
            comments,
            canReply: true,
            label: undefined as string | undefined,
            collapsibleState: 0,
            disposed: false,
            dispose() {
              this.disposed = true;
            },
          };
          state.createdThreads.push(thread);
          return thread;
        },
        dispose: () => undefined,
      }),
    },
  };
});

import * as vscodeMock from 'vscode';
import { registerInlineEditor } from './edit';
import { EXPIRED_PROPOSAL_MESSAGE, ProposalReview, proposalScheme } from './proposal';

function createMockDocument(path: string, text = 'const a = 1;\n') {
  const doc = {
    uri: vscodeMock.Uri.from({ scheme: 'file', path }),
    fileName: path,
    languageId: 'typescript',
    version: 1,
    isClosed: false,
    getText: () => text,
    offsetAt: (pos: { line: number; character: number }) => pos.character,
  };
  return doc as unknown as vscode.TextDocument & { version: number; isClosed: boolean };
}

describe('ProposalReview', () => {
  beforeEach(() => {
    resetMockState();
  });

  it('returns a clear fallback message for expired proposal URIs and closes orphaned tabs on startup', () => {
    const expiredUri = vscodeMock.Uri.from({ scheme: proposalScheme, path: '/old-id/app.ts' });
    const sourceUri = vscodeMock.Uri.from({ scheme: 'file', path: '/workspace/app.ts' });
    const orphanDiffTab = {
      input: new vscodeMock.TabInputTextDiff(sourceUri, expiredUri),
    } as unknown as vscode.Tab;
    const orphanTextTab = {
      input: new vscodeMock.TabInputText(
        vscodeMock.Uri.from({ scheme: proposalScheme, path: '/old-id-2/app.ts' }),
      ),
    } as unknown as vscode.Tab;
    const normalTab = {
      input: new vscodeMock.TabInputText(sourceUri),
    } as unknown as vscode.Tab;

    state.allTabGroups = [{ tabs: [orphanDiffTab, orphanTextTab, normalTab] }];
    state.activeTab = orphanDiffTab;

    const review = new ProposalReview({
      status: async () => ({ context: 4096, exact: true, reason: undefined }),
    });

    const content = state.contentProvider?.provideTextDocumentContent(
      expiredUri,
      {} as vscode.CancellationToken,
    );
    expect(content).toBe(EXPIRED_PROPOSAL_MESSAGE);
    expect(state.closedTabs).toEqual([[orphanDiffTab, orphanTextTab]]);
    expect(state.allTabGroups[0]?.tabs).toEqual([normalTab]);
    expect(state.contextKeys.get('appleFoundation.proposalDiffActive')).toBe(false);

    review.dispose();
  });

  it('guards apply() against re-entrancy so rapid double invocations do not emit a false warning', async () => {
    const doc = createMockDocument('/workspace/demo.ts', 'const x = 1;');
    const review = new ProposalReview({
      status: async () => ({ context: 4096, exact: true, reason: undefined }),
    });

    const range = new vscodeMock.Range(0, 10, 0, 11);
    const uri = await review.generate(
      { document: doc, version: doc.version, range },
      'Proposed edit',
      async () => '2',
    );
    expect(uri).toBeDefined();
    if (!uri) throw new Error('Expected proposal URI');

    const diffTab = {
      input: new vscodeMock.TabInputTextDiff(doc.uri, uri),
    } as unknown as vscode.Tab;
    state.allTabGroups = [{ tabs: [diffTab] }];
    state.activeTab = diffTab;

    let releaseShow!: () => void;
    const showPending = new Promise<void>((resolve) => {
      releaseShow = resolve;
    });
    const editSpy = vi.fn(async () => {
      doc.version += 1;
      return true;
    });
    state.showTextDocumentImpl = async () => {
      await showPending;
      return { edit: editSpy } as unknown as vscode.TextEditor;
    };

    const applyCmd = state.commands.get('appleFoundation.applyImplementation');
    expect(applyCmd).toBeDefined();

    const first = applyCmd?.() as Promise<boolean | undefined>;
    const second = applyCmd?.() as Promise<boolean | undefined>;

    // Second concurrent call should bail out immediately without warning.
    expect(await second).toBeUndefined();

    releaseShow();
    expect(await first).toBe(true);
    expect(editSpy).toHaveBeenCalledTimes(1);
    expect(state.warnings).toEqual([]);
    expect(state.closedTabs).toEqual([[diffTab]]);

    review.dispose();
  });

  it('still warns and returns false when the source document changed before apply()', async () => {
    const doc = createMockDocument('/workspace/demo.ts', 'const x = 1;');
    const review = new ProposalReview({
      status: async () => ({ context: 4096, exact: true, reason: undefined }),
    });

    const range = new vscodeMock.Range(0, 10, 0, 11);
    const uri = await review.generate(
      { document: doc, version: doc.version, range },
      'Proposed edit',
      async () => '2',
    );
    if (!uri) throw new Error('Expected proposal URI');

    const diffTab = {
      input: new vscodeMock.TabInputTextDiff(doc.uri, uri),
    } as unknown as vscode.Tab;
    state.allTabGroups = [{ tabs: [diffTab] }];
    state.activeTab = diffTab;

    doc.version += 1;
    const applyCmd = state.commands.get('appleFoundation.applyImplementation');
    expect(await applyCmd?.()).toBe(false);
    expect(state.warnings).toHaveLength(1);

    review.dispose();
  });
});

describe('registerInlineEditor', () => {
  beforeEach(() => {
    resetMockState();
  });

  it('closes the active editor draft when cancelInlineEdit is called with no thread argument', async () => {
    const docA = createMockDocument('/workspace/a.ts');
    const docB = createMockDocument('/workspace/b.ts');
    const range = new vscodeMock.Range(0, 0, 0, 5);

    const review = new ProposalReview({
      status: async () => ({ context: 4096, exact: true, reason: undefined }),
    });
    const client = {
      generate: vi.fn(),
      count: vi.fn(),
    } as unknown as Pick<NativeClient, 'generate' | 'count'>;
    const disposable = registerInlineEditor(client, review);

    const editInline = state.commands.get('appleFoundation.editInline');
    const cancelInline = state.commands.get('appleFoundation.cancelInlineEdit');

    state.activeTextEditor = {
      document: docA,
      selection: range,
      selections: [range],
    } as unknown as vscode.TextEditor;
    await editInline?.();

    state.activeTextEditor = {
      document: docB,
      selection: range,
      selections: [range],
    } as unknown as vscode.TextEditor;
    await editInline?.();

    expect(state.createdThreads).toHaveLength(2);

    // Invoking cancel with no args while docB is active cancels only docB's draft.
    cancelInline?.();
    expect(state.createdThreads[1]?.disposed).toBe(true);
    expect(state.createdThreads[0]?.disposed).toBe(false);

    // Invoking cancel with an explicit thread argument cancels that thread.
    cancelInline?.(state.createdThreads[0]);
    expect(state.createdThreads[0]?.disposed).toBe(true);

    disposable.dispose();
    review.dispose();
  });

  it('closes all open empty draft threads when cancelInlineEdit has no thread and focus is in the comment editor', async () => {
    const docA = createMockDocument('/workspace/a.ts');
    const docB = createMockDocument('/workspace/b.ts');
    const range = new vscodeMock.Range(0, 0, 0, 5);

    const review = new ProposalReview({
      status: async () => ({ context: 4096, exact: true, reason: undefined }),
    });
    const client = {
      generate: vi.fn(),
      count: vi.fn(),
    } as unknown as Pick<NativeClient, 'generate' | 'count'>;
    const disposable = registerInlineEditor(client, review);

    const editInline = state.commands.get('appleFoundation.editInline');
    const cancelInline = state.commands.get('appleFoundation.cancelInlineEdit');

    state.activeTextEditor = {
      document: docA,
      selection: range,
      selections: [range],
    } as unknown as vscode.TextEditor;
    await editInline?.();

    state.activeTextEditor = {
      document: docB,
      selection: range,
      selections: [range],
    } as unknown as vscode.TextEditor;
    await editInline?.();

    // Simulate focus inside VS Code's comment input editor (scheme: 'comment').
    state.activeTextEditor = {
      document: { uri: vscodeMock.Uri.from({ scheme: 'comment', path: '/comment-1' }) },
    } as unknown as vscode.TextEditor;

    cancelInline?.();
    expect(state.createdThreads[0]?.disposed).toBe(true);
    expect(state.createdThreads[1]?.disposed).toBe(true);

    disposable.dispose();
    review.dispose();
  });

  it('cleans up drafts for closed or stale documents on active editor change without breaking comment focus', async () => {
    const docA = createMockDocument('/workspace/a.ts');
    const docB = createMockDocument('/workspace/b.ts');
    const range = new vscodeMock.Range(0, 0, 0, 5);

    const review = new ProposalReview({
      status: async () => ({ context: 4096, exact: true, reason: undefined }),
    });
    const client = {
      generate: vi.fn(),
      count: vi.fn(),
    } as unknown as Pick<NativeClient, 'generate' | 'count'>;
    const disposable = registerInlineEditor(client, review);

    const editInline = state.commands.get('appleFoundation.editInline');

    state.activeTextEditor = {
      document: docA,
      selection: range,
      selections: [range],
    } as unknown as vscode.TextEditor;
    await editInline?.();

    // Moving focus to the comment widget editor must NOT dispose the active draft.
    const commentEditor = {
      document: { uri: vscodeMock.Uri.from({ scheme: 'comment', path: '/comment-1' }) },
    } as unknown as vscode.TextEditor;
    for (const listener of state.activeEditorListeners) listener(commentEditor);
    expect(state.createdThreads[0]?.disposed).toBe(false);

    // Closing docA and switching active editor cleans up its orphaned draft.
    docA.isClosed = true;
    const editorB = { document: docB } as unknown as vscode.TextEditor;
    for (const listener of state.activeEditorListeners) listener(editorB);
    expect(state.createdThreads[0]?.disposed).toBe(true);

    disposable.dispose();
    review.dispose();
  });
});
