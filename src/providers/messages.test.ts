import { describe, expect, it } from 'vitest';
import { LanguageModelChatMessageRole, LanguageModelTextPart } from 'vscode';
import { estimateTokens, toBridgeMessages } from './messages';

function message(role: LanguageModelChatMessageRole, parts: unknown[]) {
  return { role, content: parts, name: undefined };
}

describe('toBridgeMessages', () => {
  it('maps roles to the OpenAI wire format', () => {
    const result = toBridgeMessages([
      message(LanguageModelChatMessageRole.User, [new LanguageModelTextPart('hi')]),
      message(LanguageModelChatMessageRole.Assistant, [new LanguageModelTextPart('hello')]),
    ]);
    expect(result).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('concatenates multiple text parts', () => {
    const result = toBridgeMessages([
      message(LanguageModelChatMessageRole.User, [
        new LanguageModelTextPart('a'),
        new LanguageModelTextPart('b'),
      ]),
    ]);
    expect(result).toEqual([{ role: 'user', content: 'ab' }]);
  });

  it('drops non-text parts and empty messages', () => {
    const result = toBridgeMessages([
      message(LanguageModelChatMessageRole.User, [{ notText: true }]),
      message(LanguageModelChatMessageRole.User, [new LanguageModelTextPart('kept')]),
    ]);
    expect(result).toEqual([{ role: 'user', content: 'kept' }]);
  });
});

describe('estimateTokens', () => {
  it('estimates roughly four characters per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});
