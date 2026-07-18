import * as vscode from 'vscode';
import type { BridgeServerManager } from '../bridge/server';
import { checkHost, currentHostInfo } from '../core/availability';
import { readBridgeConfig } from '../core/config';
import type { Logger } from '../core/logger';

export function registerCommands(
  context: vscode.ExtensionContext,
  server: BridgeServerManager,
  outputChannel: vscode.LogOutputChannel,
  logger: Logger,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('appleFoundation.showStatus', async () => {
      const availability = checkHost(currentHostInfo());
      const config = readBridgeConfig();
      if (!availability.available) {
        void vscode.window.showWarningMessage(availability.reason);
        return;
      }
      try {
        const client = await server.ensureRunning();
        const models = await client.listModels();
        void vscode.window.showInformationMessage(
          `Bridge healthy on 127.0.0.1:${config.port}. Models: ${models.join(', ') || 'none'}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Bridge unavailable: ${message}`);
      }
    }),

    vscode.commands.registerCommand('appleFoundation.restartServer', async () => {
      try {
        await server.restart();
        void vscode.window.showInformationMessage('Bridge server restarted.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Restart failed: ${message}`);
      }
    }),

    vscode.commands.registerCommand('appleFoundation.showLogs', () => {
      outputChannel.show();
    }),

    vscode.commands.registerCommand('appleFoundation.manage', async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: 'Show status', command: 'appleFoundation.showStatus' },
          { label: 'Restart bridge server', command: 'appleFoundation.restartServer' },
          { label: 'Show logs', command: 'appleFoundation.showLogs' },
          { label: 'Open settings', command: 'workbench.action.openSettings' },
        ],
        { placeHolder: 'Apple Foundation Models' },
      );
      if (choice === undefined) {
        return;
      }
      logger.debug(`Management action: ${choice.label}`);
      if (choice.command === 'workbench.action.openSettings') {
        await vscode.commands.executeCommand(choice.command, 'appleFoundation');
      } else {
        await vscode.commands.executeCommand(choice.command);
      }
    }),
  );
}
