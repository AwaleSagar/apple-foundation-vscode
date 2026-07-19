import * as vscode from 'vscode';
import { resolveWireModel } from '../bridge/client';
import type { BridgeServerManager } from '../bridge/server';
import { checkHost, currentHostInfo } from '../core/availability';
import { type BridgeConfig, maxInputTokens } from '../core/config';
import { asBridgeError, formatErrorForUser } from '../core/errors';
import type { Logger } from '../core/logger';
import { fitMessagesToBudget } from '../core/tokens';
import { estimateTokens, flattenForTokenCount, toBridgeMessages } from './messages';

export const APPLE_MODEL_ID = 'apple-on-device';

/**
 * Contributes Apple's on-device Foundation Model to VS Code's model picker
 * via the Language Model Chat Provider API.
 */
export class AppleFoundationChatProvider implements vscode.LanguageModelChatProvider {
  constructor(
    private readonly server: BridgeServerManager,
    private readonly logger: Logger,
    private readonly getConfig: () => BridgeConfig,
  ) {}

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const availability = checkHost(currentHostInfo());
    if (!availability.available) {
      this.logger.debug(`Host unavailable: ${availability.reason}`);
      if (!options.silent) {
        void vscode.window.showWarningMessage(availability.reason);
      }
      return [];
    }

    const config = this.getConfig();
    const contextWindow = config.maxContextTokens;
    return [
      {
        id: APPLE_MODEL_ID,
        name: 'Apple On-Device',
        family: 'apple-foundation',
        version: '1.0.0',
        maxInputTokens: maxInputTokens(config),
        maxOutputTokens: config.maxOutputTokens,
        tooltip: 'Apple Foundation Models — private, on-device inference',
        detail: `On-device · offline · private · ${contextWindow} context`,
        capabilities: {
          imageInput: false,
          toolCalling: false,
        },
      },
    ];
  }

  async provideLanguageModelChatResponse(
    _model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    _options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const config = this.getConfig();
    let client: Awaited<ReturnType<BridgeServerManager['ensureRunning']>>;
    try {
      client = await this.server.ensureRunning();
    } catch (error) {
      const bridgeError = asBridgeError(error);
      this.logger.error(`Bridge unavailable: ${bridgeError.message}`);
      throw new Error(formatErrorForUser(bridgeError));
    }

    const wireModel = await resolveWireModel(client);
    const budgeted = fitMessagesToBudget(toBridgeMessages(messages), maxInputTokens(config));
    if (budgeted.trimmed) {
      this.logger.info(
        `Trimmed chat messages to fit context budget (~${budgeted.estimatedTokens} input tokens).`,
      );
    }

    // Hold the idle timer open for the whole stream, not just request start.
    const release = this.server.beginRequest();
    const abort = new AbortController();
    const cancellation = token.onCancellationRequested(() => abort.abort());

    try {
      const stream = client.streamChat(
        {
          model: wireModel,
          messages: budgeted.messages,
          stream: true,
          max_tokens: config.maxOutputTokens,
        },
        abort.signal,
      );
      for await (const delta of stream) {
        progress.report(new vscode.LanguageModelTextPart(delta));
      }
    } catch (error) {
      if (!token.isCancellationRequested) {
        const bridgeError = asBridgeError(error);
        this.logger.error(`Chat request failed [${bridgeError.code}]: ${bridgeError.message}`);
        throw new Error(formatErrorForUser(bridgeError));
      }
    } finally {
      release();
      cancellation.dispose();
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    // Fast estimator only — provideTokenCount is hot; exact CLI counts are
    // surfaced via the status command instead.
    return estimateTokens(flattenForTokenCount(text));
  }
}
