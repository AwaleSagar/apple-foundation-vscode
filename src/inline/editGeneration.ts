import * as vscode from 'vscode';
import { deviceBudget, readLimits } from '../core/config';
import type { NativeClient } from '../native/client';
import { MAX_BODY_BYTES } from '../native/protocol';
import { nearbyContext } from './completion';
import type { DeviceContext } from './generation';
import type { EditTarget } from './proposal';

const TOKEN_HEADROOM = 96;

function pickTags(text: string) {
  let suffix = '';
  for (let i = 1; i <= 100; i++) {
    const sel = `selection${suffix}`;
    const edit = `edit${suffix}`;
    if (
      !text.includes(`<${sel}>`) &&
      !text.includes(`</${sel}>`) &&
      !text.includes(`<${edit}>`) &&
      !text.includes(`</${edit}>`)
    ) {
      return { sel, edit };
    }
    suffix = `_${i}`;
  }
  return { sel: 'selection_span', edit: 'edit_span' };
}

function stripOuterFence(text: string): string {
  const fenced = /^[ \t]*```[\w#+.-]*[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/.exec(text);
  return fenced?.[1] !== undefined ? fenced[1].trim() : text;
}

export async function generateInlineEdit(
  client: Pick<NativeClient, 'generate'> & Partial<Pick<NativeClient, 'count'>>,
  { document, range }: EditTarget,
  instruction: string,
  deviceContext: number | DeviceContext,
  token: vscode.CancellationToken,
) {
  const context = typeof deviceContext === 'number' ? deviceContext : deviceContext.context;
  const exact = typeof deviceContext === 'number' ? false : deviceContext.exact;
  const limits = readLimits();
  const { maxInputTokens, maxOutputTokens } = deviceBudget(context, limits);
  const start = document.offsetAt(range.start);
  const end = document.offsetAt(range.end);
  const selected = document.getText(range);
  if (Buffer.byteLength(selected) + Buffer.byteLength(instruction) > MAX_BODY_BYTES)
    throw new Error(
      'The edit is too large for the local helper. Shorten the selection or instruction.',
    );

  const targetTokens = exact ? Math.max(128, maxInputTokens - TOKEN_HEADROOM) : maxInputTokens;
  const byteBudget = exact ? targetTokens * 3 : maxInputTokens;
  const rawBefore = document.getText(
    new vscode.Range(document.positionAt(Math.max(0, start - byteBudget)), range.start),
  );
  const rawAfter = document.getText(
    new vscode.Range(range.end, document.positionAt(end + byteBudget)),
  );
  const { sel, edit } = pickTags(`${rawBefore}\n${selected}\n${rawAfter}\n${instruction}`);
  const rules =
    `Replace the entire <${sel}>...</${sel}> span. ` +
    `Reply using exactly <${edit}>replacement</${edit}> containing the complete replacement for that span. ` +
    `Everything outside <${sel}>...</${sel}> is already in the document. Do not repeat surrounding code. ` +
    `For deletion reply <${edit}></${edit}> with nothing inside.`;
  const prompt = (before: string, after: string) =>
    `Language: ${document.languageId}\nSurrounding source:\n${before}<${sel}>${selected}</${sel}>${after}\nTask: ${instruction}\nWrite only the replacement wrapped in <${edit}> and </${edit}>.`;

  // Trim optional context only. The helper counts the complete task against the device budget.
  const fixedBytes = Buffer.byteLength(rules + prompt('', '')) + 48;
  let remaining = Math.max(0, byteBudget - fixedBytes);
  let { prefix, suffix } = nearbyContext(rawBefore, rawAfter, remaining);
  let userPrompt = prompt(prefix, suffix);

  if (exact && client.count && remaining > 0) {
    const combined = `${rules}\n${userPrompt}`;
    if (Buffer.byteLength(combined) > targetTokens) {
      const actualTokens = await client.count(combined, token);
      if (actualTokens > targetTokens) {
        const shrunkBudget = Math.floor(byteBudget * (targetTokens / actualTokens) * 0.9);
        remaining = Math.max(0, shrunkBudget - fixedBytes);
        ({ prefix, suffix } = nearbyContext(rawBefore, rawAfter, remaining));
        userPrompt = prompt(prefix, suffix);
      }
    }
  }

  let reply = '';
  await client.generate(
    [
      { role: 'system', content: rules },
      { role: 'user', content: userPrompt },
    ],
    { ...limits, maxOutputTokens },
    token,
    (delta) => {
      reply += delta;
    },
  );
  // Require a complete response even when the model hits its output limit.
  const cleaned = stripOuterFence(reply.trim());
  const match = new RegExp(`^<${edit}>([\\s\\S]*)<\\/${edit}>$`).exec(cleaned);
  if (match?.[1] === undefined)
    throw new Error(
      'The model returned an incomplete edit. Try a smaller edit or increase the output limit.',
    );
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const text = match[1].replace(/\r\n?|\n/g, eol);
  // Whole-line selections include the separator before the next untouched line.
  if (
    text &&
    range.start.character === 0 &&
    range.end.character === 0 &&
    !range.isEmpty &&
    !text.endsWith(eol)
  )
    return text + eol;
  return text;
}
