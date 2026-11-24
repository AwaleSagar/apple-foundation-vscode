import { basename } from 'node:path';
import * as vscode from 'vscode';

export class ImplementationReference {
  private selection?: { language: string; text: string; file: string } | undefined;
  private readonly status = vscode.window.createStatusBarItem(
    'appleFoundation.reference',
    vscode.StatusBarAlignment.Right,
    99,
  );
  private readonly registrations: vscode.Disposable;

  constructor() {
    this.status.name = 'Implementation reference';
    this.status.command = 'appleFoundation.clearReference';
    this.registrations = vscode.Disposable.from(
      this.status,
      vscode.commands.registerCommand('appleFoundation.clearReference', () => {
        this.take();
      }),
      vscode.commands.registerCommand('appleFoundation.useReference', () => this.capture()),
    );
  }

  private capture() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showInformationMessage('Select a code example in an editor first.');
      return;
    }
    const { document, selection } = editor;
    if (document.offsetAt(selection.end) - document.offsetAt(selection.start) > 4096)
      return this.tooLarge();
    const text = document.getText(selection);
    if (Buffer.byteLength(text) > 4096) return this.tooLarge();
    if (!text.trim()) {
      void vscode.window.showInformationMessage('Select a code example containing text.');
      return;
    }
    const file = basename(document.fileName);
    this.selection = { language: document.languageId, text, file };
    this.status.text = `$(references) Reference: ${file}`;
    this.status.tooltip = 'Example for the next Implement This Comment request. Click to clear.';
    this.status.show();
  }

  private tooLarge() {
    void vscode.window.showInformationMessage('Select a shorter code example (up to 4 KiB).');
  }

  peek() {
    return this.selection;
  }

  take() {
    const result = this.selection;
    this.selection = undefined;
    this.status.hide();
    return result;
  }

  dispose() {
    this.selection = undefined;
    this.registrations.dispose();
  }
}
