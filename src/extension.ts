import * as vscode from 'vscode';
import { BridgeServerManager } from './bridge/server';
import { registerChatParticipant } from './chat/participant';
import { registerCommands } from './commands';
import { readBridgeConfig } from './core/config';
import { createOutputChannel } from './core/logger';
import { AppleFoundationChatProvider } from './providers/chatProvider';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = createOutputChannel();
  context.subscriptions.push(outputChannel);

  const server = new BridgeServerManager(outputChannel, readBridgeConfig);
  context.subscriptions.push(server);

  const provider = new AppleFoundationChatProvider(server, outputChannel, readBridgeConfig);
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('apple-foundation', provider),
  );

  registerChatParticipant(context, server, outputChannel, readBridgeConfig);

  registerCommands(context, server, outputChannel, outputChannel);

  outputChannel.info('Apple Foundation Models extension activated');
}

export function deactivate(): void {
  // Cleanup is handled by context.subscriptions disposal.
}
