import * as vscode from 'vscode';
import { registerChatParticipant } from './chat/participant';
import { registerCommentCompletions } from './inline/provider';
import { registerCommentReviews } from './inline/review';
import { NativeClient } from './native/client';
import { AppleFoundationChatProvider } from './providers/chatProvider';
import { LocalChat } from './ui/localChat';

export function activate(context: vscode.ExtensionContext) {
  const client = new NativeClient(context.asAbsolutePath('dist/apple-local-helper'));
  const chat = new LocalChat(client, context.extensionUri);
  const logs = vscode.window.createOutputChannel('Local Chat', { log: true });
  const command = (id: string, handler: (...args: never[]) => unknown) =>
    vscode.commands.registerCommand('appleFoundation.' + id, handler);
  const status = async () => {
    const message = await chat.refresh();
    logs.info(message);
    void vscode.window.showInformationMessage(message);
    return message;
  };
  const bar = vscode.window.createStatusBarItem(
    'appleFoundation.status',
    vscode.StatusBarAlignment.Right,
    100,
  );
  bar.text = '$(comment-discussion) Local Chat';
  bar.command = 'appleFoundation.openChat';
  bar.tooltip = 'Open Local Chat';
  bar.name = 'Local Chat';
  bar.show();
  context.subscriptions.push(
    client,
    chat,
    logs,
    bar,
    vscode.window.registerWebviewViewProvider('appleFoundation.localChat', chat),
    command('openChat', async (prompt?: string) => {
      await chat.focus();
      if (prompt?.trim()) return chat.run(undefined, prompt.trim());
    }),
    command('stop', () => chat.stop()),
    command('newChat', () => chat.clear()),
    command('explainSelection', () => chat.run('explain')),
    command('documentSelection', () => chat.run('doc')),
    command('draftCommit', (source?: vscode.SourceControl) => chat.run('commit', '', source)),
    command('showStatus', status),
    command('runOnboarding', status),
    command('showLogs', () => logs.show()),
    command('restartServer', async () => {
      client.dispose();
      return status();
    }),
    command('manage', async () => {
      const choices = [
        { label: 'Open Local Chat', id: 'openChat' },
        { label: 'Check model status', id: 'showStatus' },
        { label: 'Restart local helper', id: 'restartServer' },
        { label: 'Show logs', id: 'showLogs' },
      ];
      const choice = await vscode.window.showQuickPick(choices);
      if (choice) await vscode.commands.executeCommand('appleFoundation.' + choice.id);
    }),
    vscode.lm.registerLanguageModelChatProvider(
      'apple-foundation',
      new AppleFoundationChatProvider(client),
    ),
    registerChatParticipant(client),
    registerCommentCompletions(client),
    registerCommentReviews(client),
  );
}
