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
        if (!request.command && !turn.prompt.trim() && !turn.selection?.trim()) {
          return {
            errorDetails: { message: 'Enter a message or select code in an editor first.' },
          };
        }
        const history = request.command ? [] : historyFromChatContext(context);
        let docFenced = false;
        try {
          await client.generate(
            prependHistory(buildMessages(turn), history),
            readLimits(),
            token,
            (text) => {
              if (request.command === 'doc' && !docFenced) {
                docFenced = true;
                stream.markdown(`\`\`\`\`${turn.languageId ?? ''}\n`);
              }
              stream.markdown(text);
            },
            () => stream.progress('Trimmed earlier turns to fit this Mac’s context window.'),
          );
        } finally {
          if (docFenced) stream.markdown('\n````');
        }
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
