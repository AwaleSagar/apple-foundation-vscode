import type { ChatMessage } from '../native/client';

/**
 * Slash commands the `@apple` participant understands. A missing command means
 * a free-form chat turn.
 */
export type ChatCommand = 'explain' | 'doc' | 'commit';

/** Editor / VCS context gathered before a turn, all optional. */
export interface TurnContext {
  /** The slash command, if any (`request.command`). */
  readonly command: string | undefined;
  /** The user's typed prompt. */
  readonly prompt: string;
  /** Selected text in the active editor, if any. */
  readonly selection?: string | undefined;
  /** Language id of the active document (e.g. "typescript"). */
  readonly languageId?: string | undefined;
  /** Base name of the active file. */
  readonly fileName?: string | undefined;
  /** Staged git diff, used by `/commit`. */
  readonly diff?: string | undefined;
}

const BASE_RULES =
  'You are Apple On-Device, a private assistant running locally on the developer\u2019s Mac. ' +
  'Be concise and technical. Never invent facts about code you were not shown.';

/** Fence a block of untrusted content so the model treats it as data, not instructions. */
export function fenceBlock(label: string, body: string, languageId?: string): string {
  const lang = languageId ?? '';
  return `${label}:\n\`\`\`${lang}\n${body}\n\`\`\``;
}

function explainMessages(ctx: TurnContext): ChatMessage[] {
  const system =
    `${BASE_RULES} Explain the code or concept clearly. ` +
    'Lead with a one-sentence summary, then the key details as short bullets.';
  const parts: string[] = [];
  if (ctx.selection !== undefined && ctx.selection.trim() !== '') {
    parts.push(fenceBlock('Selected code', ctx.selection, ctx.languageId));
  }
  parts.push(ctx.prompt.trim() === '' ? 'Explain the selected code.' : ctx.prompt.trim());
  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

function docMessages(ctx: TurnContext): ChatMessage[] {
  const system =
    ctx.languageId === 'swift'
      ? 'Summarize what the Swift function returns in a single documentation comment. Use the form "/// Returns …".'
      : 'Write a documentation comment in the language of the selected code. Return only the comment, ready to paste immediately above the declaration.';
  const parts: string[] = [];
  if (ctx.selection !== undefined && ctx.selection.trim() !== '') {
    parts.push(
      ctx.languageId === 'swift'
        ? ctx.selection
        : fenceBlock('Code to document', ctx.selection, ctx.languageId),
    );
  }
  if (ctx.prompt.trim() !== '') {
    parts.push(ctx.prompt.trim());
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

function commitMessages(ctx: TurnContext): ChatMessage[] {
  const system =
    `${BASE_RULES} Write one Conventional Commit subject based on the diff. ` +
    'Start with feat, fix, docs, refactor, test, perf, build, ci, style, or chore followed by a colon. ' +
    'Use an imperative verb. State the direction of the change and relevant values. ' +
    'Example: fix: increase retry limit from 1 to 3. Return only the subject without markdown.';
  const parts: string[] = [];
  const diff = ctx.diff ?? '';
  parts.push(fenceBlock('Staged diff', diff, 'diff'));
  if (ctx.prompt.trim() !== '') {
    parts.push(`Additional context: ${ctx.prompt.trim()}`);
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

function chatMessages(ctx: TurnContext): ChatMessage[] {
  const parts: string[] = [];
  if (ctx.selection !== undefined && ctx.selection.trim() !== '') {
    const label =
      ctx.fileName !== undefined ? `Selected code from ${ctx.fileName}` : 'Selected code';
    parts.push(fenceBlock(label, ctx.selection, ctx.languageId));
  }
  parts.push(ctx.prompt.trim());
  return [
    { role: 'system', content: BASE_RULES },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

/**
 * Build the wire messages for a participant turn. Pure and side-effect free so
 * it can be unit tested without VS Code or the bridge.
 */
export function buildMessages(ctx: TurnContext): ChatMessage[] {
  switch (ctx.command) {
    case 'explain':
      return explainMessages(ctx);
    case 'doc':
      return docMessages(ctx);
    case 'commit':
      return commitMessages(ctx);
    default:
      return chatMessages(ctx);
  }
}
