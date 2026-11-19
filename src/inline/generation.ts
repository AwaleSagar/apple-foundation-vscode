import * as vscode from 'vscode';
import { deviceBudget, readLimits } from '../core/config';
import type { NativeClient } from '../native/client';
import { completionMessages, formatCompletion, type ReviewOptions } from './completion';

export async function generateBlock(
  client: Pick<NativeClient, 'generate'>,
  document: vscode.TextDocument,
  instruction: { start: number; text: string },
  suffixStart: vscode.Position,
  indent: string,
  deviceContext: number,
  token: vscode.CancellationToken,
  review?: ReviewOptions,
) {
  const limits = readLimits();
  const budget = deviceBudget(deviceContext, limits);
  const contextTokens = budget.maxInputTokens + budget.maxOutputTokens;
  const maxOutputTokens = !review
    ? Math.min(384, budget.maxOutputTokens, Math.floor(contextTokens / 3))
    : Math.min(budget.maxOutputTokens, Math.floor(contextTokens / 2));
  const start = document.lineAt(instruction.start).range.start;
  const prefix = document.getText(
    new vscode.Range(document.positionAt(Math.max(0, document.offsetAt(start) - 4096)), start),
  );
  const suffix = document.getText(
    new vscode.Range(suffixStart, document.positionAt(document.offsetAt(suffixStart) + 4096)),
  );
  const messages = completionMessages(
    document.languageId,
    instruction.text,
    prefix,
    suffix,
    contextTokens - maxOutputTokens,
    review,
  );
  if (!messages)
    throw new Error(
      'The task exceeds the model context budget. Shorten the comment or reference selection, or increase the context limit.',
    );
  let reply = '';
  await client.generate(messages, { ...limits, maxOutputTokens }, token, (delta) => {
    reply += delta;
  });
  return formatCompletion(reply, indent, document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
}
