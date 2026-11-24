import * as vscode from 'vscode';
import type { NativeClient } from '../native/client';
import { commentAt, completionLanguages } from './completion';
import { generateBlock } from './generation';
import { type ProposalReview, proposalScheme } from './proposal';
import { ImplementationReference } from './reference';

const implement = 'appleFoundation.implementComment';
const title = 'Implement This Comment';
const kind = vscode.CodeActionKind.RefactorRewrite.append('appleFoundation.implementComment');

function instructionAt(doc: vscode.TextDocument, range: vscode.Range) {
  if (doc.uri.scheme === proposalScheme) return;
  const block = commentAt(
    doc.languageId,
    range.start.line,
    doc.lineCount,
    (i) => doc.lineAt(i).text,
  );
  const last = !range.isEmpty && range.end.character === 0 ? range.end.line - 1 : range.end.line;
  if (block && last <= block.end) return block;
}

export function registerCommentReviews(
  client: Pick<NativeClient, 'generate' | 'count'>,
  review: ProposalReview,
) {
  const references = new ImplementationReference();

  async function propose(uri?: vscode.Uri, version?: number, line?: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const doc = editor.document;
    if (vscode.workspace.fs.isWritableFileSystem(doc.uri.scheme) === false) {
      void vscode.window.showInformationMessage(
        'Cannot implement comments in a read-only document.',
      );
      return;
    }
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
    const reference = references.peek();
    const last = doc.lineAt(instruction.end);
    const position = last.range.end;
    return review.generate(
      { document: doc, version: doc.version, range: new vscode.Range(position, position) },
      `Proposed implementation${reference ? ` (using ${reference.file})` : ''}`,
      async (context, token) => {
        const code = await generateBlock(
          client,
          doc,
          instruction,
          last.rangeIncludingLineBreak.end,
          instruction.indent,
          context,
          token,
          { reference },
          () => {
            if (reference && references.peek() === reference) references.take();
          },
        );
        if (!code)
          throw new Error('The model did not return a code block. Try a more specific comment.');
        return (doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n') + code;
      },
    );
  }

  return vscode.Disposable.from(
    references,
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
  );
}
