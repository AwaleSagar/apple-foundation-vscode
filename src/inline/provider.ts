import * as vscode from 'vscode';
import type { NativeClient } from '../native/client';
import { completionLanguages, readInstruction } from './completion';
import { generateBlock } from './generation';

function enabled(document: vscode.TextDocument) {
  return (
    vscode.workspace
      .getConfiguration('appleFoundation.inlineCompletions', document)
      .get<boolean>('enabled', true) &&
    vscode.workspace
      .getConfiguration('editor.inlineSuggest', document)
      .get<boolean>('enabled', true)
  );
}

async function debounce(token: vscode.CancellationToken) {
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      listener.dispose();
      resolve();
    };
    const timer = setTimeout(finish, 300);
    const listener = token.onCancellationRequested(finish);
  });
}

export class CommentCompletionProvider implements vscode.InlineCompletionItemProvider {
  private active?: vscode.CancellationTokenSource | undefined;

  constructor(private readonly client: Pick<NativeClient, 'status' | 'generate' | 'generating'>) {}

  dispose() {
    this.active?.cancel();
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    this.active?.cancel();
    if (token.isCancellationRequested || context.selectedCompletionInfo || !enabled(document))
      return [];
    const current = document.lineAt(position.line);
    if (!current.isEmptyOrWhitespace || position.line === 0) return [];
    const instruction = readInstruction(
      document.languageId,
      position.line - 1,
      (i) => document.lineAt(i).text,
    );
    if (!instruction) return [];

    const version = document.version;
    const source = new vscode.CancellationTokenSource();
    this.active = source;
    const listener = token.onCancellationRequested(() => source.cancel());
    const stale = () =>
      source.token.isCancellationRequested ||
      token.isCancellationRequested ||
      document.version !== version ||
      document.isClosed;
    try {
      if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic)
        await debounce(source.token);
      if (stale() || this.client.generating) return [];
      const status = await this.client.status(source.token);
      if (status.reason || stale() || this.client.generating) return [];

      const text = await generateBlock(
        this.client,
        document,
        instruction,
        current.rangeIncludingLineBreak.end,
        current.text || instruction.indent,
        status.context,
        source.token,
      );
      if (stale() || !enabled(document)) return [];
      return text ? [new vscode.InlineCompletionItem(text, current.range)] : [];
    } catch {
      // Background completions are best effort. The setup check explains model availability.
      return [];
    } finally {
      listener.dispose();
      source.dispose();
      if (this.active === source) this.active = undefined;
    }
  }
}

export function registerCommentCompletions(client: NativeClient) {
  const provider = new CommentCompletionProvider(client);
  return vscode.Disposable.from(
    vscode.languages.registerInlineCompletionItemProvider(completionLanguages, provider),
    provider,
  );
}
