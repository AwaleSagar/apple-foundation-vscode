import * as vscode from 'vscode';
import type { ChatMessage } from '../bridge/types';

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
 * Cheap token estimate (~4 characters per token). The bridge exposes no
 * tokenizer endpoint, and VS Code only needs an approximation for budgeting.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
