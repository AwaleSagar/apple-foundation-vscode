import * as vscode from 'vscode';
import type { ChatMessage } from '../native/client';

/**
 * Convert VS Code chat request messages to the native message format.
 *
 * Only text parts are forwarded: the on-device model accepts text-only input,
 * and tool-call parts are filtered out because the provider advertises no
 * tool-calling capability.
 */
export function toMessages(
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
  // VS Code's stable LM API has no System role, so multi-turn callers send
  // system instructions as a leading User message before the first User turn.
  if (
    result[0]?.role === 'user' &&
    result[1]?.role === 'user' &&
    result.some((message) => message.role === 'assistant')
  ) {
    result[0] = { role: 'system', content: result[0].content };
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
