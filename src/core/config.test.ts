import { expect, it } from 'vitest';
import { deviceBudget } from './config';

it('honors the device limit and reserves room for the current prompt', () => {
  expect(deviceBudget(8192, { maxContextTokens: 4096, maxOutputTokens: 1024 })).toEqual({
    maxInputTokens: 3072,
    maxOutputTokens: 1024,
  });
  expect(deviceBudget(4096, { maxContextTokens: 32768, maxOutputTokens: 8192 })).toEqual({
    maxInputTokens: 256,
    maxOutputTokens: 3840,
  });
});
