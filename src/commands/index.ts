import * as vscode from 'vscode';
import type { BridgeServerManager } from '../bridge/server';
import { checkHost, currentHostInfo } from '../core/availability';
import { maxInputTokens, readBridgeConfig } from '../core/config';
import { asBridgeError, formatErrorForUser } from '../core/errors';
import type { Logger } from '../core/logger';
import {
  detectOnboardingIssues,
  formatOnboardingMarkdown,
  resolveExecutableOnPath,
} from '../core/onboarding';
import { countTokensWithCli, estimateTokens } from '../core/tokens';

export function registerCommands(
  context: vscode.ExtensionContext,
  server: BridgeServerManager,
  outputChannel: vscode.LogOutputChannel,
  logger: Logger,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('appleFoundation.showStatus', async () => {
      const host = currentHostInfo();
      const availability = checkHost(host);
      const config = readBridgeConfig();
      if (!availability.available) {
        void vscode.window.showWarningMessage(availability.reason);
        return;
      }

      // Probe the bridge first: a user-started external server is fully
      // supported even when the CLI is not resolvable on the extension-host
      // PATH, so setup guidance only appears when the bridge is unreachable.
      try {
        const client = await server.ensureRunning();
        const sample = 'status probe';
        const [models, exact] = await Promise.all([
          client.listModels(),
          countTokensWithCli(sample, {
            executablePath: config.executablePath,
            timeoutMs: 3000,
          }),
        ]);
        const tokenNote =
          exact !== undefined
            ? `token-count(CLI)="${sample}"→${exact} (estimate=${estimateTokens(sample)})`
            : `token estimate only (CLI unavailable); "hi"≈${estimateTokens('hi')}`;
        const resolved = resolveExecutableOnPath(config.executablePath);

        void vscode.window.showInformationMessage(
          `Bridge healthy on 127.0.0.1:${config.port}. ` +
            `Models: ${models.join(', ') || 'none'}. ` +
            `Budget: ${maxInputTokens(config)} in / ${config.maxOutputTokens} out ` +
            `(context ${config.maxContextTokens}). ` +
            `CLI: ${resolved ?? config.executablePath}. ${tokenNote}`,
        );
      } catch (error) {
        const issues = detectOnboardingIssues({
          host,
          executablePath: config.executablePath,
        });
        const primary = issues[0];
        if (primary !== undefined) {
          const actionLabel = primary.actionLabel ?? 'Open settings';
          const choice = await vscode.window.showWarningMessage(
            `${primary.title}: ${primary.detail}`,
            actionLabel,
          );
          if (choice === actionLabel) {
            await vscode.commands.executeCommand(
              primary.actionCommand ?? 'workbench.action.openSettings',
              'appleFoundation',
            );
          }
          return;
        }
        const bridgeError = asBridgeError(error);
        void vscode.window.showErrorMessage(formatErrorForUser(bridgeError));
      }
    }),

    vscode.commands.registerCommand('appleFoundation.restartServer', async () => {
      try {
        await server.restart();
        void vscode.window.showInformationMessage('Bridge server restarted.');
      } catch (error) {
        const bridgeError = asBridgeError(error);
        void vscode.window.showErrorMessage(formatErrorForUser(bridgeError));
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

    vscode.commands.registerCommand('appleFoundation.runOnboarding', async () => {
      // Explicit invocation (palette / walkthrough) always responds, even when
      // the check passes or was previously dismissed.
      await runOnboarding(context, logger, { force: true });
    }),
  );
}

/**
 * First-run / guided setup. Surfaces host and bridge issues with actionable
 * buttons. Idempotent: safe to call from activate and from the command palette.
 */
export async function runOnboarding(
  context: vscode.ExtensionContext,
  logger: Logger,
  options?: { force?: boolean },
): Promise<void> {
  const config = readBridgeConfig();
  const issues = detectOnboardingIssues({
    host: currentHostInfo(),
    executablePath: config.executablePath,
  });

  // biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket access for index signatures
  if (process.env['VSCODE_TEST'] === 'true') {
    logger.info(
      `[Test] Skipping onboarding interactive dialog. Issues: ${issues.map((i) => i.code).join(', ')}`,
    );
    logger.info(formatOnboardingMarkdown(issues));
    return;
  }

  if (issues.length === 0) {
    if (options?.force === true) {
      void vscode.window.showInformationMessage(
        'Apple Foundation Models looks ready. Open chat and pick "Apple On-Device".',
      );
    }
    return;
  }

  const dismissed = context.globalState.get<boolean>('appleFoundation.onboarding.dismissed', false);
  if (dismissed && options?.force !== true) {
    logger.debug(`Onboarding issues present but dismissed: ${issues.map((i) => i.code).join(',')}`);
    return;
  }

  logger.info(`Onboarding: ${issues.map((i) => i.code).join(', ')}`);
  const primary = issues[0];
  if (primary === undefined) {
    return;
  }

  const buttons = [
    primary.actionLabel ?? 'Open settings',
    'Show logs',
    "Don't show again",
  ] as const;
  const choice = await vscode.window.showWarningMessage(
    `${primary.title}: ${primary.detail}`,
    ...buttons,
  );

  if (choice === 'Show logs') {
    await vscode.commands.executeCommand('appleFoundation.showLogs');
  } else if (choice === "Don't show again") {
    await context.globalState.update('appleFoundation.onboarding.dismissed', true);
  } else if (choice === (primary.actionLabel ?? 'Open settings')) {
    await vscode.commands.executeCommand(
      primary.actionCommand ?? 'workbench.action.openSettings',
      'appleFoundation',
    );
  }

  // Also dump a structured note into the log channel for supportability.
  logger.info(formatOnboardingMarkdown(issues));
}
