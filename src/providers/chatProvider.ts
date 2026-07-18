import * as vscode from 'vscode';
import type { BridgeServerManager } from '../bridge/server';
import { checkHost, currentHostInfo } from '../core/availability';
import type { BridgeConfig } from '../core/config';
import type { Logger } from '../core/logger';
import { estimateTokens, toBridgeMessages } from './messages';

/**
 * Apple's on-device model has a 4096-token context window shared between
 * input and output.
 */
const CONTEXT_WINDOW_TOKENS = 4096;

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
    return [
      {
        id: APPLE_MODEL_ID,
        name: 'Apple On-Device',
        family: 'apple-foundation',
        version: '1.0.0',
        maxInputTokens: CONTEXT_WINDOW_TOKENS - config.maxOutputTokens,
        maxOutputTokens: config.maxOutputTokens,
        tooltip: 'Apple Foundation Models — private, on-device inference',
        detail: 'On-device · offline · private',
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
    const client = await this.server.ensureRunning();
    const config = this.getConfig();

    // The wire model id differs per bridge ("system" for fm serve); ask the
    // server rather than hardcoding, falling back to the fm default.
    const wireModel = await client
      .listModels()
      .then((models) => (models.includes('system') ? 'system' : (models[0] ?? 'system')))
      .catch(() => 'system');

    const abort = new AbortController();
    const cancellation = token.onCancellationRequested(() => abort.abort());

    try {
      const stream = client.streamChat(
        {
          model: wireModel,
          messages: toBridgeMessages(messages),
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
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Chat request failed: ${message}`);
        throw error;
      }
    } finally {
      cancellation.dispose();
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    if (typeof text === 'string') {
      return estimateTokens(text);
    }
    const flattened = text.content
      .filter(
        (part): part is vscode.LanguageModelTextPart =>
          part instanceof vscode.LanguageModelTextPart,
      )
      .map((part) => part.value)
      .join('');
    return estimateTokens(flattened);
  }
}
