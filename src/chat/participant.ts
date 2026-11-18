import * as vscode from 'vscode';
import { readLimits } from '../core/config';
import { prependHistory } from '../core/history';
import type { NativeClient } from '../native/client';
import { turnContext } from './context';
import { historyFromChatContext } from './historyFromVscode';
import { buildMessages } from './prompts';

export function registerChatParticipant(client: NativeClient) {
  const participant = vscode.chat.createChatParticipant(
    'apple-foundation.chat',
    async (request, context, stream, token) => {
      try {
        const turn = await turnContext(request.command, request.prompt);
        const history = request.command ? [] : historyFromChatContext(context);
        await client.generate(
          prependHistory(buildMessages(turn), history),
          readLimits(),
          token,
          (text) => stream.markdown(text),
          () => stream.progress('Trimmed earlier turns to fit this Mac’s context window.'),
        );
        return { metadata: { command: request.command } };
      } catch (error) {
        if (token.isCancellationRequested) return {};
        return {
          errorDetails: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
  );
  participant.iconPath = new vscode.ThemeIcon('sparkle');
  participant.followupProvider = {
    provideFollowups(result) {
      if (result.errorDetails) return [];
      return result.metadata?.['command'] === 'commit'
        ? [{ prompt: '', command: 'commit', label: 'Regenerate commit message' }]
        : [
            { prompt: '', command: 'explain', label: 'Explain the selection' },
            { prompt: '', command: 'doc', label: 'Document the selection' },
          ];
    },
  };
  return participant;
}
