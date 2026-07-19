import type { ChatMessage } from '../bridge/types';

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
  if (history.length === 0) {
    return current.map((m) => ({ role: m.role, content: m.content }));
  }

  const system = current.filter((m) => m.role === 'system');
  const nonSystem = current.filter((m) => m.role !== 'system');
  const historyMessages: ChatMessage[] = history
    .filter((t) => t.content.trim() !== '')
    .map((t) => ({ role: t.role, content: t.content }));

  return [...system, ...historyMessages, ...nonSystem];
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
