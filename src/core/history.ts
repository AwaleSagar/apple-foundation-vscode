import type { ChatMessage } from '../native/client';

/**
 * Minimal history turn extracted from VS Code chat context. Kept free of the
 * `vscode` module so multi-turn assembly stays unit-testable.
 */
export interface HistoryTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/**
 * Merge prior turns into the wire messages for the current request.
 *
 * Keeps a single leading system message from `current`, then history, then the
 * current user message(s). Empty history is a no-op.
 */
export function prependHistory(
  current: readonly ChatMessage[],
  history: readonly HistoryTurn[],
): ChatMessage[] {
  if (history.length === 0) return [...current];
  const messages = current.filter((message) => message.role === 'system');
  for (const turn of history) {
    if (turn.content.trim() !== '') messages.push(turn);
  }
  for (const message of current) {
    if (message.role !== 'system') messages.push(message);
  }
  return messages;
}

/**
 * Cap history to the last `maxTurns` user/assistant pairs (counting each
 * message as one turn). Oldest turns are dropped first.
 */
export function takeRecentHistory(
  history: readonly HistoryTurn[],
  maxTurns: number,
): HistoryTurn[] {
  if (maxTurns <= 0) {
    return [];
  }
  if (history.length <= maxTurns) {
    return [...history];
  }
  return history.slice(history.length - maxTurns);
}
