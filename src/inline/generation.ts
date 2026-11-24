import * as vscode from 'vscode';
import { deviceBudget, readLimits } from '../core/config';
import type { NativeClient } from '../native/client';
import { completionMessages, formatCompletion, type ReviewOptions } from './completion';

export interface DeviceContext {
  readonly context: number;
  readonly exact: boolean;
}

const TOKEN_HEADROOM = 96;

export async function generateBlock(
  client: Pick<NativeClient, 'generate'> & Partial<Pick<NativeClient, 'count'>>,
  document: vscode.TextDocument,
  instruction: { start: number; text: string },
  suffixStart: vscode.Position,
  indent: string,
  deviceContext: number | DeviceContext,
  token: vscode.CancellationToken,
  review?: ReviewOptions,
  onStart?: () => void,
) {
  const context = typeof deviceContext === 'number' ? deviceContext : deviceContext.context;
  const exact = typeof deviceContext === 'number' ? false : deviceContext.exact;
  const limits = readLimits();
  const budget = deviceBudget(context, limits);
  const contextTokens = budget.maxInputTokens + budget.maxOutputTokens;
  const maxOutputTokens = !review
    ? Math.min(384, budget.maxOutputTokens, Math.floor(contextTokens / 3))
    : Math.min(budget.maxOutputTokens, Math.floor(contextTokens / 2));
  const inputTokens = contextTokens - maxOutputTokens;
  const targetTokens = exact ? Math.max(128, inputTokens - TOKEN_HEADROOM) : inputTokens;
  let byteBudget = exact ? targetTokens * 3 : inputTokens;
  const windowChars = Math.max(4096, byteBudget);
  const start = document.lineAt(instruction.start).range.start;
  const prefix = document.getText(
    new vscode.Range(
      document.positionAt(Math.max(0, document.offsetAt(start) - windowChars)),
      start,
    ),
  );
  const suffix = document.getText(
    new vscode.Range(
      suffixStart,
      document.positionAt(document.offsetAt(suffixStart) + windowChars),
    ),
  );
  let messages = completionMessages(
    document.languageId,
    instruction.text,
    prefix,
    suffix,
    byteBudget,
    review,
  );
  if (messages && exact && client.count) {
    const combined = messages.map((m) => m.content).join('\n');
    if (Buffer.byteLength(combined) > targetTokens) {
      const actualTokens = await client.count(combined, token);
      if (actualTokens > targetTokens) {
        byteBudget = Math.floor(byteBudget * (targetTokens / actualTokens) * 0.9);
        messages = completionMessages(
          document.languageId,
          instruction.text,
          prefix,
          suffix,
          byteBudget,
          review,
        );
      }
    }
  }
  if (!messages)
    throw new Error(
      'The task exceeds the model context budget. Shorten the comment or reference selection, or increase the context limit.',
    );
  onStart?.();
  let reply = '';
  await client.generate(messages, { ...limits, maxOutputTokens }, token, (delta) => {
    reply += delta;
  });
  return formatCompletion(reply, indent, document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
}
