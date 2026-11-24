import * as vscode from 'vscode';
import { deviceBudget, readLimits } from '../core/config';
import type { NativeClient } from '../native/client';
import { flattenForTokenCount, toMessages } from './messages';

export class AppleFoundationChatProvider
  implements vscode.LanguageModelChatProvider, vscode.Disposable
{
  private readonly infoChanged = new vscode.EventEmitter<void>();
  private readonly configListener: vscode.Disposable;
  readonly onDidChangeLanguageModelChatInformation = this.infoChanged.event;

  constructor(private readonly client: NativeClient) {
    this.configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('appleFoundation.model')) {
        this.infoChanged.fire();
      }
    });
  }

  dispose() {
    this.configListener.dispose();
    this.infoChanged.dispose();
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken,
  ) {
    try {
      const status = await this.client.status(token);
      if (status.reason) throw new Error(status.reason);
      return [
        {
          id: 'apple-on-device',
          name: 'Apple On-Device',
          family: 'apple-foundation',
          version: '1.0.0',
          ...deviceBudget(status.context),
          detail: 'Apple Foundation Models · On device',
          capabilities: { imageInput: false, toolCalling: false },
        },
      ];
    } catch (error) {
      if (!options.silent && !token.isCancellationRequested)
        void vscode.window.showWarningMessage(
          error instanceof Error ? error.message : String(error),
        );
      return [];
    }
  }

  provideLanguageModelChatResponse(
    _model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    _options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ) {
    return this.client.generate(toMessages(messages), readLimits(), token, (text) =>
      progress.report(new vscode.LanguageModelTextPart(text)),
    );
  }

  provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken,
  ) {
    return this.client.count(flattenForTokenCount(text), token);
  }
}
