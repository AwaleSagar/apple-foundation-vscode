import * as vscode from 'vscode';
import { resolveWireModel } from '../bridge/client';
import type { BridgeServerManager } from '../bridge/server';
import { checkHost, currentHostInfo } from '../core/availability';
import type { BridgeConfig } from '../core/config';
import type { Logger } from '../core/logger';
import { getStagedDiff } from './git';
import { buildMessages, type TurnContext } from './prompts';

export const PARTICIPANT_ID = 'apple-foundation.chat';

/** Gather editor selection context from the active text editor, if any. */
function activeEditorContext(): Pick<TurnContext, 'selection' | 'languageId' | 'fileName'> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    return {};
  }
  const { document, selection } = editor;
  const selected = selection.isEmpty ? undefined : document.getText(selection);
  return {
    selection: selected,
    languageId: document.languageId,
    fileName: document.uri.path.split('/').pop(),
  };
}

async function buildTurnContext(request: vscode.ChatRequest): Promise<TurnContext> {
  const editor = activeEditorContext();
  const base: TurnContext = {
    command: request.command,
    prompt: request.prompt,
    selection: editor.selection,
    languageId: editor.languageId,
    fileName: editor.fileName,
  };
  if (request.command === 'commit') {
    return { ...base, diff: await getStagedDiff() };
  }
  return base;
}

interface AppleChatResult extends vscode.ChatResult {
  readonly metadata?: { readonly command?: string | undefined };
}

function suggestFollowups(command: string | undefined): vscode.ChatFollowup[] {
  if (command === 'commit') {
    return [{ prompt: '', command: 'commit', label: 'Regenerate commit message' }];
  }
  return [
    { prompt: '', command: 'explain', label: 'Explain the selection' },
    { prompt: '', command: 'doc', label: 'Document the selection' },
  ];
}

/**
 * Register the `@apple` chat participant: streaming markdown responses backed
 * by the on-device model, with `/explain`, `/doc`, and `/commit` commands.
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  server: BridgeServerManager,
  logger: Logger,
  getConfig: () => BridgeConfig,
): void {
  const handler: vscode.ChatRequestHandler = async (
    request,
    _chatContext,
    stream,
    token,
  ): Promise<AppleChatResult> => {
    const meta = { command: request.command };
    const availability = checkHost(currentHostInfo());
    if (!availability.available) {
      stream.markdown(availability.reason);
      return { metadata: meta };
    }

    if (request.command === 'commit') {
      const staged = await getStagedDiff();
      if (staged === undefined) {
        stream.markdown(
          'No staged changes found. Stage the changes you want summarized (`git add`) and try again.',
        );
        return { metadata: meta };
      }
    }

    const turn = await buildTurnContext(request);
    const messages = buildMessages(turn);
    const config = getConfig();

    let client: Awaited<ReturnType<BridgeServerManager['ensureRunning']>>;
    try {
      client = await server.ensureRunning();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Bridge unavailable for participant: ${message}`);
      stream.markdown(`Could not reach the Apple Foundation Models bridge.\n\n${message}`);
      return { errorDetails: { message }, metadata: meta };
    }

    const wireModel = await resolveWireModel(client);
    const abort = new AbortController();
    const cancellation = token.onCancellationRequested(() => abort.abort());

    try {
      const deltas = client.streamChat(
        { model: wireModel, messages, stream: true, max_tokens: config.maxOutputTokens },
        abort.signal,
      );
      for await (const delta of deltas) {
        stream.markdown(delta);
      }
    } catch (error) {
      if (!token.isCancellationRequested) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Participant request failed: ${message}`);
        stream.markdown(`\n\nRequest failed: ${message}`);
        return { errorDetails: { message }, metadata: meta };
      }
    } finally {
      cancellation.dispose();
    }

    return { metadata: meta };
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = new vscode.ThemeIcon('sparkle');
  participant.followupProvider = {
    provideFollowups: (result: AppleChatResult, _chatContext, _token) =>
      result.errorDetails === undefined ? suggestFollowups(result.metadata?.command) : [],
  };
  context.subscriptions.push(participant);
}
