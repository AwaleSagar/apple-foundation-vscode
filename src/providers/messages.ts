import * as vscode from 'vscode';
import type { ChatMessage } from '../bridge/types';

export { estimateTokens } from '../core/tokens';

/**
 * Convert VS Code chat request messages to the OpenAI-compatible wire format.
 *
 * Only text parts are forwarded: the on-device model accepts text-only input,
 * and tool-call parts are filtered out because the provider advertises no
 * tool-calling capability.
 */
export function toBridgeMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const message of messages) {
    const text = message.content
      .filter(
        (part): part is vscode.LanguageModelTextPart =>
          part instanceof vscode.LanguageModelTextPart,
      )
      .map((part) => part.value)
      .join('');
    if (text === '') {
      continue;
    }
    result.push({ role: toRole(message.role), content: text });
  }
  return result;
}

function toRole(role: vscode.LanguageModelChatMessageRole): ChatMessage['role'] {
  // The stable API defines only User and Assistant; system-style instructions
  // arrive as user messages and are forwarded as such.
  return role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
}

/**
 * Flatten a LanguageModelChatRequestMessage (or plain string) to text for
 * token counting. Pure helper shared by the provider.
 */
export function flattenForTokenCount(
  text: string | vscode.LanguageModelChatRequestMessage,
): string {
  if (typeof text === 'string') {
    return text;
  }
  return text.content
    .filter(
      (part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart,
    )
    .map((part) => part.value)
    .join('');
}
