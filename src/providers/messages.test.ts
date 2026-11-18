import { describe, expect, it } from 'vitest';
import { LanguageModelChatMessageRole, LanguageModelTextPart } from 'vscode';
import { toMessages } from './messages';

function message(role: LanguageModelChatMessageRole, parts: unknown[]) {
  return { role, content: parts, name: undefined };
}

describe('toMessages', () => {
  it('maps roles to the native message format', () => {
    const result = toMessages([
      message(LanguageModelChatMessageRole.User, [new LanguageModelTextPart('hi')]),
      message(LanguageModelChatMessageRole.Assistant, [new LanguageModelTextPart('hello')]),
    ]);
    expect(result).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('concatenates multiple text parts', () => {
    const result = toMessages([
      message(LanguageModelChatMessageRole.User, [
        new LanguageModelTextPart('a'),
        new LanguageModelTextPart('b'),
      ]),
    ]);
    expect(result).toEqual([{ role: 'user', content: 'ab' }]);
  });

  it('drops non-text parts and empty messages', () => {
    const result = toMessages([
      message(LanguageModelChatMessageRole.User, [{ notText: true }]),
      message(LanguageModelChatMessageRole.User, [new LanguageModelTextPart('kept')]),
    ]);
    expect(result).toEqual([{ role: 'user', content: 'kept' }]);
  });
});
