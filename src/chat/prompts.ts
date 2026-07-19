import type { ChatMessage } from '../bridge/types';

/**
 * Slash commands the `@apple` participant understands. A missing command means
 * a free-form chat turn.
 */
export type ChatCommand = 'explain' | 'doc' | 'commit' | 'edit';

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
  /**
   * Workspace-relative path of the active file (preferred for edit plans).
   * Falls back to fileName when the workspace root is unknown.
   */
  readonly filePath?: string | undefined;
  /** Full text of the active document (budgeted by caller for /edit). */
  readonly fileContent?: string | undefined;
  /** Staged git diff, used by `/commit`. */
  readonly diff?: string | undefined;
}

/**
 * The on-device model has a small (~4K) context window, so every instruction
 * is kept terse and a single task is asked per turn.
 *
 * Keep this string byte-stable across turns of a thread: Apple's framework
 * KV-caches the stable prompt prefix (instructions + tools), and any change to
 * it invalidates the cache and adds latency to every subsequent turn
 * (docs/apple-fm-reference.md, "Token & context rules").
 */
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
    `${BASE_RULES} Write a documentation comment for the given code using the ` +
    'idiomatic style for its language (JSDoc/TSDoc, docstring, etc.). ' +
    'Output only the comment inside a single code block \u2014 no prose, no restated code.';
  const parts: string[] = [];
  if (ctx.selection !== undefined && ctx.selection.trim() !== '') {
    parts.push(fenceBlock('Code to document', ctx.selection, ctx.languageId));
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
    `${BASE_RULES} Write one Conventional Commit message from the staged diff. ` +
    'Format: `type(scope): summary` (\u226472 chars, imperative mood), then a blank line, ' +
    'then a short body only if it adds information. ' +
    'Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore. ' +
    'Output only the commit message inside a single code block.';
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
 * Edit system prompt — keep byte-stable across turns for KV-cache.
 * Instructs the small on-device model to emit a structured EditPlan JSON only.
 */
const EDIT_SYSTEM =
  `${BASE_RULES} You propose precise code edits for the developer\u2019s workspace. ` +
  'Never invent file contents you were not shown. Prefer small SEARCH/REPLACE hunks over rewriting whole files. ' +
  'Respond with a single JSON object only (no prose outside JSON) with this shape:\n' +
  '{"summary":"short reason","changes":[{"path":"relative/path.ts","action":"update","hunks":[{"search":"exact old text","replace":"new text"}]}]}\n' +
  'Rules: search must match the file exactly (copy from the provided source); include enough context lines to be unique; ' +
  'action is update|create|delete; for create use wholeFile instead of hunks; path must be workspace-relative; ' +
  'do not escape into markdown fences if you can avoid it — raw JSON is fine.';

function editMessages(ctx: TurnContext): ChatMessage[] {
  const parts: string[] = [];
  const pathLabel = ctx.filePath ?? ctx.fileName ?? 'active file';
  if (ctx.fileContent !== undefined && ctx.fileContent.trim() !== '') {
    parts.push(fenceBlock(`Current file: ${pathLabel}`, ctx.fileContent, ctx.languageId));
  }
  if (ctx.selection !== undefined && ctx.selection.trim() !== '') {
    parts.push(fenceBlock('Focus selection (prefer editing here)', ctx.selection, ctx.languageId));
  }
  const instruction =
    ctx.prompt.trim() === ''
      ? 'Propose a minimal edit plan for the focused selection or file.'
      : ctx.prompt.trim();
  parts.push(instruction);
  parts.push(`Target path for updates: ${pathLabel}`);
  return [
    { role: 'system', content: EDIT_SYSTEM },
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
    case 'edit':
      return editMessages(ctx);
    default:
      return chatMessages(ctx);
  }
}
