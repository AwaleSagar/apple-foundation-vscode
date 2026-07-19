import type * as vscode from 'vscode';
import { type HistoryTurn, takeRecentHistory } from '../core/history';

/**
 * Extract prior user/assistant turns from VS Code chat history for multi-turn
 * continuity. Ignores tool/result parts and empty responses.
 *
 * Duck-typed (not `instanceof`) so unit tests can pass plain objects and so we
 * stay resilient across VS Code API module instances.
 */
export function historyFromChatContext(
  chatContext: vscode.ChatContext,
  maxTurns = 12,
): HistoryTurn[] {
  const turns: HistoryTurn[] = [];
  for (const item of chatContext.history) {
    if (isRequestTurn(item)) {
      const prompt = item.prompt?.trim() ?? '';
      if (prompt !== '') {
        turns.push({ role: 'user', content: prompt });
      }
      continue;
    }
    if (isResponseTurn(item)) {
      const text = flattenResponseTurn(item);
      if (text !== '') {
        turns.push({ role: 'assistant', content: text });
      }
    }
  }
  let recent = takeRecentHistory(turns, maxTurns);
  // The cap slices raw messages, so the window can open on an assistant turn;
  // drop those so the wire order always starts user-first after the system
  // prompt (small models mishandle a leading assistant message).
  while (recent[0]?.role === 'assistant') {
    recent = recent.slice(1);
  }
  return recent;
}

function isRequestTurn(
  item: vscode.ChatRequestTurn | vscode.ChatResponseTurn,
): item is vscode.ChatRequestTurn {
  return 'prompt' in item && typeof (item as vscode.ChatRequestTurn).prompt === 'string';
}

function isResponseTurn(
  item: vscode.ChatRequestTurn | vscode.ChatResponseTurn,
): item is vscode.ChatResponseTurn {
  return 'response' in item && Array.isArray((item as vscode.ChatResponseTurn).response);
}

function flattenResponseTurn(turn: vscode.ChatResponseTurn): string {
  const parts: string[] = [];
  for (const part of turn.response) {
    // Markdown parts expose a MarkdownString on `.value`.
    if (isMarkdownPart(part)) {
      parts.push(part.value.value);
    }
  }
  return parts.join('').trim();
}

function isMarkdownPart(part: unknown): part is { value: { value: string } } {
  if (typeof part !== 'object' || part === null || !('value' in part)) {
    return false;
  }
  const value = (part as { value: unknown }).value;
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    typeof (value as { value: unknown }).value === 'string'
  );
}
