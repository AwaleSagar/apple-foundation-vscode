import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import * as vscode from 'vscode';
import type { NativeClient } from '../native/client';
import { commentAt, completionLanguages } from './completion';
import { generateBlock } from './generation';
import { ImplementationReference } from './reference';

const scheme = 'apple-foundation-proposal';
const implement = 'appleFoundation.implementComment';
const title = 'Implement This Comment';
const kind = vscode.CodeActionKind.RefactorRewrite.append('appleFoundation.implementComment');

function instructionAt(doc: vscode.TextDocument, range: vscode.Range) {
  if (doc.uri.scheme === scheme) return;
  const block = commentAt(
    doc.languageId,
    range.start.line,
    doc.lineCount,
    (i) => doc.lineAt(i).text,
  );
  const last = !range.isEmpty && range.end.character === 0 ? range.end.line - 1 : range.end.line;
  if (block && last <= block.end) return block;
}

function proposalUri(tab: vscode.Tab | undefined) {
  const input = tab?.input;
  if (input instanceof vscode.TabInputTextDiff && input.modified.scheme === scheme)
    return input.modified;
}

interface Proposal {
  document: vscode.TextDocument;
  version: number;
  position: vscode.Position;
  insertion: string;
  preview: string;
}

export function registerCommentReviews(client: Pick<NativeClient, 'generate' | 'status'>) {
  const references = new ImplementationReference();
  const proposals = new Map<string, Proposal>();
  const currentTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;

  async function close(uri: vscode.Uri) {
    const tabs = vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs.filter((tab) => proposalUri(tab)?.toString() === uri.toString()),
    );
    if (tabs.length) await vscode.window.tabGroups.close(tabs);
  }

  async function propose(uri?: vscode.Uri, version?: number, line?: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const doc = editor.document;
    if (uri && (uri.toString() !== doc.uri.toString() || version !== doc.version)) {
      void vscode.window.showWarningMessage(
        'The source changed. Invoke Implement This Comment again.',
      );
      return;
    }
    const range = line === undefined ? editor.selection : doc.lineAt(line).range;
    const instruction = instructionAt(doc, range);
    if (!instruction) {
      void vscode.window.showInformationMessage(
        'Place the cursor in a standalone comment to implement it.',
      );
      return;
    }
    const reference = references.take();
    const sourceVersion = doc.version;
    const last = doc.lineAt(instruction.end);
    try {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Generating a comment implementation on your Mac…',
          cancellable: true,
        },
        async (_progress, token) => {
          const status = await client.status(token);
          if (token.isCancellationRequested) return;
          if (status.reason) throw new Error(status.reason);
          const changed = () => doc.isClosed || doc.version !== sourceVersion;
          if (changed()) throw new Error('The source changed. Generate a new proposal.');
          const code = await generateBlock(
            client,
            doc,
            instruction,
            last.rangeIncludingLineBreak.end,
            instruction.indent,
            status.context,
            token,
            { reference },
          );
          if (token.isCancellationRequested) return;
          if (changed()) throw new Error('The source changed. Generate a new proposal.');
          if (!code)
            throw new Error('The model did not return a code block. Try a more specific comment.');
          const position = last.range.end;
          const insertion = (doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n') + code;
          const offset = doc.offsetAt(position);
          const original = doc.getText();
          const name = basename(doc.fileName);
          const preview = vscode.Uri.from({ scheme, path: `/${randomUUID()}/${name}` });
          proposals.set(preview.toString(), {
            document: doc,
            version: sourceVersion,
            position,
            insertion,
            preview: original.slice(0, offset) + insertion + original.slice(offset),
          });
          try {
            const content = await vscode.workspace.openTextDocument(preview);
            if (content.languageId !== doc.languageId)
              await vscode.languages.setTextDocumentLanguage(content, doc.languageId);
            await vscode.commands.executeCommand(
              'vscode.diff',
              doc.uri,
              preview,
              `${name} · Proposed implementation${reference ? ` (using ${reference.file})` : ''}`,
              { preview: false, selection: new vscode.Range(position, position) },
            );
            return preview;
          } catch (error) {
            proposals.delete(preview.toString());
            throw error;
          }
        },
      );
    } catch (error) {
      if (!(error instanceof Error && error.message === 'Cancelled.'))
        void vscode.window.showWarningMessage(
          error instanceof Error ? error.message : String(error),
        );
    }
  }

  async function apply() {
    const uri = proposalUri(currentTab());
    const proposal = uri && proposals.get(uri.toString());
    if (!uri || !proposal) return;
    const { document, version, position, insertion } = proposal;
    if (!document.isClosed && document.version === version) {
      const editor = await vscode.window.showTextDocument(document);
      if (
        document.version === version &&
        (await editor.edit((edit) => edit.insert(position, insertion)))
      ) {
        await close(uri);
        return true;
      }
    }
    void vscode.window.showWarningMessage(
      'The source changed. Discard this proposal and generate it again.',
    );
    return false;
  }

  return vscode.Disposable.from(
    references,
    vscode.workspace.registerTextDocumentContentProvider(scheme, {
      provideTextDocumentContent: (uri) => proposals.get(uri.toString())?.preview,
    }),
    vscode.languages.registerCodeActionsProvider(
      completionLanguages,
      {
        provideCodeActions(doc, range) {
          const block = instructionAt(doc, range);
          if (!block) return [];
          const action = new vscode.CodeAction(title, kind);
          action.command = {
            command: implement,
            title,
            arguments: [doc.uri, doc.version, block.start],
          };
          return [action];
        },
      },
      { providedCodeActionKinds: [kind] },
    ),
    vscode.commands.registerCommand(implement, propose),
    vscode.commands.registerCommand('appleFoundation.applyImplementation', apply),
    vscode.commands.registerCommand('appleFoundation.discardImplementation', () => {
      const uri = proposalUri(currentTab());
      if (uri) return close(uri);
    }),
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      for (const tab of event.closed) {
        const uri = proposalUri(tab);
        if (
          uri &&
          !vscode.window.tabGroups.all.some((g) =>
            g.tabs.some((t) => proposalUri(t)?.toString() === uri.toString()),
          )
        )
          proposals.delete(uri.toString());
      }
    }),
    new vscode.Disposable(() => proposals.clear()),
  );
}
