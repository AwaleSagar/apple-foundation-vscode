import { type ChildProcess, spawn } from 'node:child_process';
import type { ChatMessage } from '../bridge/types';

/**
 * Default shared context window for Apple's on-device model when the bridge
 * does not report one. Prefer runtime config over this constant at call sites.
 */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 4096;

/**
 * Cheap token estimate (~4 characters per token). Used when `fm token-count`
 * is unavailable or too slow for hot paths (VS Code `provideTokenCount`).
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

/** Sum of estimated tokens across wire messages (roles count as negligible). */
export function estimateMessageTokens(messages: readonly ChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    // ~4 tokens of framing overhead per message (role + separators).
    total += 4 + estimateTokens(message.content);
  }
  return total;
}

export interface TokenCountCliOptions {
  /** Bridge / system CLI path (default `fm`). */
  readonly executablePath: string;
  /** Optional AbortSignal. */
  readonly signal?: AbortSignal | undefined;
  /** Kill the process after this many ms (default 5000). */
  readonly timeoutMs?: number | undefined;
}

/**
 * Ask the system CLI for an exact on-device token count.
 * Returns `undefined` when the CLI is missing, fails, or times out — callers
 * should fall back to {@link estimateTokens}.
 *
 * Spawns with an args array and no shell (see SECURITY.md).
 */
export async function countTokensWithCli(
  text: string,
  options: TokenCountCliOptions,
): Promise<number | undefined> {
  if (text === '') {
    return 0;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: number | undefined): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    let child: ChildProcess;
    try {
      // `--` stops option parsing so text starting with '-' (e.g. diffs
      // containing "--- a/file") is never mistaken for a CLI flag.
      child = spawn(options.executablePath, ['token-count', '-q', '--', text], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      finish(undefined);
      return;
    }

    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    const timeoutMs = options.timeoutMs ?? 5000;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(undefined);
    }, timeoutMs);

    const onAbort = (): void => {
      child.kill('SIGTERM');
      finish(undefined);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      finish(undefined);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (code !== 0) {
        finish(undefined);
        return;
      }
      const parsed = Number.parseInt(stdout.trim(), 10);
      finish(Number.isFinite(parsed) ? parsed : undefined);
    });
  });
}

/**
 * Count tokens for VS Code budgeting: try the CLI when `preferCli` is true,
 * otherwise use the fast estimator. Always returns a finite non-negative int.
 */
export async function countTokens(
  text: string,
  options?: { executablePath?: string; preferCli?: boolean; signal?: AbortSignal },
): Promise<number> {
  if (options?.preferCli === true && options.executablePath !== undefined) {
    const exact = await countTokensWithCli(text, {
      executablePath: options.executablePath,
      signal: options.signal,
    });
    if (exact !== undefined) {
      return exact;
    }
  }
  return estimateTokens(text);
}

export interface BudgetResult {
  /** Messages that fit within the input budget. */
  readonly messages: ChatMessage[];
  /** True when at least one message was dropped or truncated. */
  readonly trimmed: boolean;
  /** Estimated input tokens after budgeting. */
  readonly estimatedTokens: number;
}

/**
 * Fit a message list into `maxInputTokens`.
 *
 * Strategy (retrieve-few → summarize → answer is Phase 2; for MVP we drop
 * oldest non-system turns, then hard-truncate the largest remaining user
 * payload). Never mutates the input array or message objects.
 */
export function fitMessagesToBudget(
  messages: readonly ChatMessage[],
  maxInputTokens: number,
): BudgetResult {
  if (maxInputTokens < 1) {
    return { messages: [], trimmed: messages.length > 0, estimatedTokens: 0 };
  }

  let working: ChatMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
  let trimmed = false;

  // Drop oldest non-system messages until we fit (or only system + last user remain).
  while (estimateMessageTokens(working) > maxInputTokens && working.length > 1) {
    const dropIndex = working.findIndex((m, i) => m.role !== 'system' && i < working.length - 1);
    if (dropIndex === -1) {
      break;
    }
    working = working.filter((_, i) => i !== dropIndex);
    trimmed = true;
  }

  const TRUNCATION_MARK = '\n\n[…truncated for context window…]';

  // Still over budget: shrink the longest message. Always reduce raw content
  // length (suffix included) so the loop cannot grow the payload forever.
  let shrinkGuard = 0;
  while (estimateMessageTokens(working) > maxInputTokens && shrinkGuard < 32) {
    shrinkGuard += 1;
    let longest = -1;
    let longestLen = 0;
    for (let i = 0; i < working.length; i++) {
      const len = working[i]?.content.length ?? 0;
      if (len > longestLen) {
        longestLen = len;
        longest = i;
      }
    }
    if (longest === -1 || longestLen <= TRUNCATION_MARK.length + 8) {
      break;
    }
    const keepChars = Math.max(
      8,
      Math.min(Math.floor(longestLen * 0.5), longestLen - TRUNCATION_MARK.length - 1),
    );
    working = working.map((m, i) =>
      i === longest
        ? { role: m.role, content: `${m.content.slice(0, keepChars)}${TRUNCATION_MARK}` }
        : m,
    );
    trimmed = true;
  }

  // Last resort: keep only the system prompt and a truncated final user turn,
  // splitting the budget between them so instructions are trimmed
  // proportionally (never to an arbitrary fixed size) and the result is
  // guaranteed to fit.
  if (estimateMessageTokens(working) > maxInputTokens) {
    const system = working.find((m) => m.role === 'system');
    const lastUser = [...working].reverse().find((m) => m.role === 'user');
    working = [];
    let remainingTokens = maxInputTokens;

    if (system !== undefined) {
      // System keeps what it needs, capped at half the budget.
      const systemBudgetTokens = Math.min(
        estimateTokens(system.content),
        Math.max(1, Math.floor(maxInputTokens / 2) - 4),
      );
      const content = system.content.slice(0, systemBudgetTokens * 4);
      if (content !== '') {
        working.push({ role: 'system', content });
        remainingTokens -= 4 + estimateTokens(content);
      }
    }

    if (lastUser !== undefined) {
      const userChars = Math.max(8, (remainingTokens - 4) * 4 - TRUNCATION_MARK.length);
      const body = lastUser.content.slice(0, userChars);
      working.push({
        role: 'user',
        content: body.length < lastUser.content.length ? `${body}${TRUNCATION_MARK}` : body,
      });
    }
    trimmed = true;
  }

  return {
    messages: working,
    trimmed,
    estimatedTokens: estimateMessageTokens(working),
  };
}
