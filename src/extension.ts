import * as vscode from 'vscode';
import { BridgeServerManager } from './bridge/server';
import { registerChatParticipant } from './chat/participant';
import { registerCommands, runOnboarding } from './commands';
import { readBridgeConfig } from './core/config';
import { createOutputChannel } from './core/logger';
import { registerPreviewProvider } from './editing';
import { AppleFoundationChatProvider } from './providers/chatProvider';
import { registerStatusBar } from './ui/statusBar';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = createOutputChannel();
  context.subscriptions.push(outputChannel);

  const server = new BridgeServerManager(outputChannel, readBridgeConfig);
  context.subscriptions.push(server);

  const provider = new AppleFoundationChatProvider(server, outputChannel, readBridgeConfig);
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('apple-foundation', provider),
  );

  registerPreviewProvider(context);
  registerChatParticipant(context, server, outputChannel, readBridgeConfig);
  registerCommands(context, server, outputChannel, outputChannel);
  registerStatusBar(context, server);

  // Non-blocking setup check — never delay activation for PATH probes / UI.
  void runOnboarding(context, outputChannel).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.warn(`Onboarding check failed: ${message}`);
  });

  outputChannel.info('Apple Foundation Models extension activated');
}

export function deactivate(): void {
  // Cleanup is handled by context.subscriptions disposal.
}
