import * as vscode from 'vscode';
import type { NativeClient } from '../native/client';
import { generateInlineEdit } from './editGeneration';
import { type EditTarget, type ProposalReview, proposalScheme } from './proposal';

const controllerId = 'appleFoundation.inlineEdit';
export function registerInlineEditor(
  client: Pick<NativeClient, 'generate' | 'count'>,
  review: ProposalReview,
) {
  const controller = vscode.comments.createCommentController(controllerId, 'Local Chat');
  const drafts = new Map<
    vscode.TextDocument,
    { target: EditTarget; thread: vscode.CommentThread }
  >();
  function close(document: vscode.TextDocument) {
    drafts.get(document)?.thread.dispose();
    drafts.delete(document);
  }
  async function start() {
    const editor = vscode.window.activeTextEditor;
    if (
      !editor ||
      editor.document.uri.scheme === proposalScheme ||
      vscode.workspace.fs.isWritableFileSystem(editor.document.uri.scheme) === false
    )
      return;
    if (editor.selections.length !== 1) {
      void vscode.window.showInformationMessage(
        'Use a single selection or cursor for an inline edit.',
      );
      return;
    }
    const { document, selection: range } = editor;
    const target = { document, range, version: document.version };
    if (!vscode.workspace.getConfiguration('comments').get('visible', true)) {
      const text = await vscode.window.showInputBox({
        title: 'Local Chat · Edit Inline',
        prompt: 'Describe the edit you want to make',
      });
      if (text?.trim()) return submit(target, text.trim());
      return;
    }
    close(document);
    // Editing mode places keyboard focus inside the widget as soon as it opens.
    const prompt: vscode.Comment = {
      body: '',
      mode: vscode.CommentMode.Editing,
      author: { name: 'Describe the edit' },
    };
    const thread = controller.createCommentThread(document.uri, range, [prompt]);
    thread.canReply = false;
    thread.label = range.isEmpty ? 'Local Chat · Insert at cursor' : 'Local Chat · Edit selection';
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    drafts.set(document, { target, thread });
  }
  function submit(target: EditTarget, text: string) {
    return review.generate(target, 'Proposed edit', (context, token) =>
      generateInlineEdit(client, target, text, context, token),
    );
  }
  return vscode.Disposable.from(
    controller,
    vscode.workspace.onDidCloseTextDocument(close),
    vscode.commands.registerCommand('appleFoundation.editInline', start),
    vscode.commands.registerCommand(
      'appleFoundation.previewInlineEdit',
      (prompt?: vscode.Comment) => {
        const draft = Array.from(drafts.values()).find(
          ({ thread }) => thread.comments[0] === prompt,
        );
        const rawBody = prompt?.body;
        const text = (typeof rawBody === 'string' ? rawBody : (rawBody?.value ?? '')).trim();
        if (!draft) return;
        if (
          draft.target.document.isClosed ||
          draft.target.document.version !== draft.target.version
        ) {
          void vscode.window.showWarningMessage(
            'The source changed. Copy your prompt or start a new inline edit.',
          );
          return;
        }
        close(draft.target.document);
        if (text) return submit(draft.target, text);
      },
    ),
    vscode.commands.registerCommand(
      'appleFoundation.cancelInlineEdit',
      (thread?: vscode.CommentThread) => {
        const draft = Array.from(drafts.values()).find((draft) => draft.thread === thread);
        if (draft) close(draft.target.document);
      },
    ),
    new vscode.Disposable(() => drafts.clear()),
  );
}
