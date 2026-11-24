import * as vscode from 'vscode';
import { getStagedDiff } from './git';
import type { TurnContext } from './prompts';

export async function turnContext(
  command: string | undefined,
  prompt: string,
  source?: { rootUri?: vscode.Uri | undefined },
): Promise<TurnContext> {
  if (command === 'commit') return { command, prompt, diff: await getStagedDiff(source) };
  const editor = vscode.window.activeTextEditor;
  const selection =
    editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : undefined;
  if (!editor || selection === undefined || selection.trim() === '') {
    if ((command === 'explain' || command === 'doc') && !prompt.trim())
      throw new Error('Select code in an editor first.');
    return { command, prompt };
  }
  return {
    command,
    prompt,
    selection,
    languageId: editor.document.languageId,
    fileName: editor.document.uri.path.split('/').pop(),
  };
}
