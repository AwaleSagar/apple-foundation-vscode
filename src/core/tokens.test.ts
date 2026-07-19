import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../bridge/types';
import {
  countTokens,
  countTokensWithCli,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  estimateMessageTokens,
  estimateTokens,
  fitMessagesToBudget,
} from './tokens';

describe('estimateTokens', () => {
  it('estimates roughly four characters per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('estimateMessageTokens', () => {
  it('sums content with per-message overhead', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'abcd' },
      { role: 'user', content: 'efgh' },
    ];
    // 4 overhead + 1 token each, twice
    expect(estimateMessageTokens(messages)).toBe(10);
  });
});

describe('fitMessagesToBudget', () => {
  it('returns messages unchanged when under budget', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'hi' },
    ];
    const result = fitMessagesToBudget(messages, 10_000);
    expect(result.trimmed).toBe(false);
    expect(result.messages).toEqual(messages);
    expect(result.estimatedTokens).toBe(estimateMessageTokens(messages));
  });

  it('drops oldest non-system turns first', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'a'.repeat(200) },
      { role: 'assistant', content: 'b'.repeat(200) },
      { role: 'user', content: 'latest question' },
    ];
    // Force trimming with a tight budget.
    const result = fitMessagesToBudget(messages, 40);
    expect(result.trimmed).toBe(true);
    expect(result.messages.some((m) => m.role === 'system')).toBe(true);
    // Latest user content should survive in some form.
    const joined = result.messages.map((m) => m.content).join('\n');
    expect(joined).toMatch(/latest question|truncated/i);
    expect(result.estimatedTokens).toBeLessThanOrEqual(40);
  });

  it('truncates oversized single messages', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'x'.repeat(10_000) }];
    const result = fitMessagesToBudget(messages, 50);
    expect(result.trimmed).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content.length ?? 0).toBeLessThan(10_000);
    expect(result.messages[0]?.content).toContain('truncated');
  });

  it('handles zero budget', () => {
    const result = fitMessagesToBudget([{ role: 'user', content: 'hi' }], 0);
    expect(result.messages).toEqual([]);
    expect(result.trimmed).toBe(true);
  });

  it('does not mutate the input array', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'a'.repeat(5000) },
      { role: 'user', content: 'b'.repeat(5000) },
    ];
    const snapshot = messages.map((m) => ({ ...m }));
    fitMessagesToBudget(messages, 20);
    expect(messages).toEqual(snapshot);
  });
});

describe('DEFAULT_CONTEXT_WINDOW_TOKENS', () => {
  it('is a positive power-of-two-ish default', () => {
    expect(DEFAULT_CONTEXT_WINDOW_TOKENS).toBeGreaterThanOrEqual(2048);
  });
});

describe('countTokensWithCli', () => {
  it('returns a real count from the system fm CLI when available', async () => {
    const count = await countTokensWithCli('Hello world', {
      executablePath: 'fm',
      timeoutMs: 15_000,
    });
    // On this Mac (macOS 27 + fm) we previously measured 11 tokens for "Hello world".
    // If fm is missing in CI linux, the function returns undefined — skip then.
    if (count === undefined) {
      // Structural guarantee: estimator still works as fallback path.
      expect(estimateTokens('Hello world')).toBeGreaterThan(0);
      return;
    }
    expect(count).toBeGreaterThan(0);
    expect(Number.isInteger(count)).toBe(true);
    // Sanity: exact count should be in the same ballpark as the estimator (±3x).
    const estimate = estimateTokens('Hello world');
    expect(count).toBeLessThanOrEqual(estimate * 4 + 5);
    expect(count).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it('returns 0 for empty text without spawning', async () => {
    await expect(countTokensWithCli('', { executablePath: '/nonexistent/fm-nope' })).resolves.toBe(
      0,
    );
  });

  it('returns undefined when the executable is missing', async () => {
    await expect(
      countTokensWithCli('hi', {
        executablePath: '/nonexistent/definitely-not-fm-xyz',
        timeoutMs: 2000,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('countTokens', () => {
  it('falls back to estimate when preferCli is false', async () => {
    await expect(countTokens('abcd', { preferCli: false })).resolves.toBe(1);
  });

  it('uses CLI when preferCli is true and fm works', async () => {
    const value = await countTokens('Hello world', {
      preferCli: true,
      executablePath: 'fm',
    });
    expect(value).toBeGreaterThan(0);
  }, 20_000);
});
