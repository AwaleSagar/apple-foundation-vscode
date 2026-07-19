import { describe, expect, it } from 'vitest';
import { prependHistory, takeRecentHistory } from './history';

describe('prependHistory', () => {
  it('is a no-op when history is empty', () => {
    const current = [
      { role: 'system' as const, content: 'rules' },
      { role: 'user' as const, content: 'hi' },
    ];
    expect(prependHistory(current, [])).toEqual(current);
  });

  it('places history between system and the current turn', () => {
    const current = [
      { role: 'system' as const, content: 'rules' },
      { role: 'user' as const, content: 'follow up' },
    ];
    const history = [
      { role: 'user' as const, content: 'first' },
      { role: 'assistant' as const, content: 'answer' },
    ];
    expect(prependHistory(current, history)).toEqual([
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'follow up' },
    ]);
  });

  it('skips empty history turns', () => {
    const result = prependHistory(
      [{ role: 'user', content: 'now' }],
      [
        { role: 'user', content: '   ' },
        { role: 'assistant', content: 'ok' },
      ],
    );
    expect(result).toEqual([
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'now' },
    ]);
  });
});

describe('takeRecentHistory', () => {
  it('keeps the most recent turns', () => {
    const history = [
      { role: 'user' as const, content: '1' },
      { role: 'assistant' as const, content: '2' },
      { role: 'user' as const, content: '3' },
    ];
    expect(takeRecentHistory(history, 2)).toEqual([
      { role: 'assistant', content: '2' },
      { role: 'user', content: '3' },
    ]);
  });

  it('returns empty for non-positive max', () => {
    expect(takeRecentHistory([{ role: 'user', content: 'x' }], 0)).toEqual([]);
  });
});
