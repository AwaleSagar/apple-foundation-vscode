import { describe, expect, it } from 'vitest';
import type { ChatContext } from 'vscode';
import { historyFromChatContext } from './historyFromVscode';

/** Build a ChatContext-shaped object without calling private VS Code constructors. */
function ctx(
  history: Array<{ prompt: string } | { response: Array<{ value: { value: string } }> }>,
): ChatContext {
  return { history } as unknown as ChatContext;
}

describe('historyFromChatContext', () => {
  it('extracts user prompts and assistant markdown', () => {
    const history = historyFromChatContext(
      ctx([
        { prompt: 'what is this?' },
        { response: [{ value: { value: 'a function' } }] },
        { prompt: 'and that?' },
      ]),
    );
    expect(history).toEqual([
      { role: 'user', content: 'what is this?' },
      { role: 'assistant', content: 'a function' },
      { role: 'user', content: 'and that?' },
    ]);
  });

  it('caps to the most recent maxTurns and never opens on an assistant turn', () => {
    const history = historyFromChatContext(
      ctx([
        { prompt: '1' },
        { response: [{ value: { value: 'a' } }] },
        { prompt: '2' },
        { response: [{ value: { value: 'b' } }] },
        { prompt: '3' },
      ]),
      2,
    );
    // The 2-message window would open on assistant "b"; that leading assistant
    // turn is dropped so the wire order stays user-first.
    expect(history).toEqual([{ role: 'user', content: '3' }]);
  });

  it('keeps a full user-assistant window intact', () => {
    const history = historyFromChatContext(
      ctx([
        { prompt: '1' },
        { response: [{ value: { value: 'a' } }] },
        { prompt: '2' },
        { response: [{ value: { value: 'b' } }] },
      ]),
      2,
    );
    expect(history).toEqual([
      { role: 'user', content: '2' },
      { role: 'assistant', content: 'b' },
    ]);
  });

  it('skips empty prompts', () => {
    const history = historyFromChatContext(ctx([{ prompt: '   ' }, { prompt: 'real' }]));
    expect(history).toEqual([{ role: 'user', content: 'real' }]);
  });
});
