import type { ChatMessage } from '../native/protocol';

const slashLanguages = [
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
  'swift',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'csharp',
];
const hashLanguages = ['python', 'ruby', 'shellscript'];
export const completionLanguages = [...slashLanguages, ...hashLanguages];

interface Instruction {
  start: number;
  text: string;
  indent: string;
}

// Never scan an unbounded comment or send a partial instruction.
const MAX_COMMENT_LINES = 64;
const MAX_COMMENT_CHARS = 4096;

export function readInstruction(
  language: string,
  end: number,
  lineAt: (line: number) => string,
): Instruction | undefined {
  if (end < 0 || !completionLanguages.includes(language)) return;
  const slash = slashLanguages.includes(language);
  const marker = slash ? '//' : '#';
  const last = lineAt(end).trim();
  const block = slash && !last.startsWith(marker) && last.endsWith('*/');
  const parts: string[] = [];
  let size = 0;
  let start = end + 1;
  let open = block;
  for (let i = end; i >= 0; i--) {
    const raw = lineAt(i);
    const line = raw.trim();
    if (!block && (!line.startsWith(marker) || line.startsWith('#!'))) break;
    size += raw.length;
    if (size > MAX_COMMENT_CHARS || parts.length === MAX_COMMENT_LINES) return;
    start = i;
    if (block) {
      const content = i === end ? line.slice(0, -2) : line;
      open = !content.startsWith('/*');
      const body = open ? content : content.slice(2);
      // Reject intervening closers or an opener preceded by code on the same line.
      if (body.includes('*/') || (open && !body.startsWith('*') && body.includes('/*'))) return;
      parts.push(body.replace(/^\*+/, '').trim());
      if (!open) break;
    } else {
      parts.push(
        line
          .slice(marker.length)
          .replace(slash ? /^[/!]+/ : /^#+/, '')
          .trim(),
      );
    }
  }
  const text = parts.reverse().join('\n').trim();
  if (!open && text) return { start, text, indent: /^\s*/.exec(lineAt(start))?.[0] ?? '' };
}

function insideBlockComment(line: number, lineAt: (i: number) => string) {
  for (let i = line - 1; i >= 0 && line - i < MAX_COMMENT_LINES; i--) {
    const trimmed = lineAt(i).trim();
    if (trimmed.endsWith('*/')) return false;
    if (trimmed.startsWith('/*')) return true;
  }
  return false;
}

/** Resolve the whole instruction even when the cursor is on its first or middle line. */
export function commentAt(
  language: string,
  line: number,
  count: number,
  lineAt: (i: number) => string,
) {
  if (!completionLanguages.includes(language) || line < 0 || line >= count) return;
  const slash = slashLanguages.includes(language);
  const marker = slash ? '//' : '#';
  const current = lineAt(line).trimStart();
  let end = line;
  if (current.startsWith(marker) && (!slash || !insideBlockComment(line, lineAt))) {
    if (current.startsWith('#!')) return;
    while (end + 1 < count) {
      const next = lineAt(end + 1).trimStart();
      if (!next.startsWith(marker) || next.startsWith('#!')) break;
      if (++end - line >= MAX_COMMENT_LINES) return;
    }
  } else {
    if (!slash) return;
    while (!lineAt(end).trimEnd().endsWith('*/')) {
      if (++end >= count || end - line >= MAX_COMMENT_LINES) return;
    }
  }
  const instruction = readInstruction(language, end, lineAt);
  if (instruction && instruction.start <= line) return { ...instruction, end };
}

const rules =
  'Complete the code at the cursor in the given language. Implement the comment using the surrounding code. Initialize variables before use. Return only the missing code, without fences, commentary, or repeated context.';

export interface ReviewOptions {
  reference?: { language: string; text: string } | undefined;
}

/** Fit the closest source on each side, keeping UTF-8 characters intact. */
export function nearbyContext(before: string, after: string, remaining: number) {
  const left = Buffer.from(before);
  const right = Buffer.from(after);
  const rightSize = Math.min(
    right.length,
    Math.max(Math.floor(remaining / 3), remaining - left.length),
  );
  const leftSize = Math.min(left.length, remaining - rightSize);
  let start = left.length - leftSize;
  let end = rightSize;
  // Clip at character boundaries even when nearby identifiers contain Unicode.
  while (start < left.length && ((left[start] ?? 0) & 0xc0) === 0x80) start++;
  while (end > 0 && ((right[end] ?? 0) & 0xc0) === 0x80) end--;
  return { prefix: left.toString('utf8', start), suffix: right.toString('utf8', 0, end) };
}

function trimStandaloneTrailingTask(language: string, after: string): string {
  const slash = slashLanguages.includes(language);
  const lines = after.split(/\r?\n/);
  const starts: number[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    starts.push(offset);
    offset += (lines[i]?.length ?? 0) + (after[offset + (lines[i]?.length ?? 0)] === '\r' ? 2 : 1);
  }
  const isCommentStart = (trimmed: string) =>
    slash
      ? trimmed.startsWith('//') || trimmed.startsWith('/*')
      : trimmed.startsWith('#') && !trimmed.startsWith('#!');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? '').trimStart();
    if (!isCommentStart(trimmed)) continue;
    const block = commentAt(language, i, lines.length, (k) => lines[k] ?? '');
    if (!block) {
      // Unclosed block comment (e.g. a trailing /* stub): stop before it.
      if (slash && trimmed.startsWith('/*')) return after.slice(0, starts[i] ?? 0);
      continue;
    }
    const nextLine = lines[block.end + 1];
    // Stop before a standalone comment not immediately documenting following code.
    if (nextLine === undefined || !nextLine.trim() || isCommentStart(nextLine.trimStart())) {
      return after.slice(0, starts[i] ?? 0);
    }
    i = block.end;
  }
  return after;
}

export function completionMessages(
  language: string,
  instruction: string,
  before: string,
  after: string,
  byteBudget: number,
  review?: ReviewOptions,
): ChatMessage[] | undefined {
  const reference = review?.reference;
  const languageName = language.charAt(0).toUpperCase() + language.slice(1);
  let system = rules;
  if (review) {
    system = reference
      ? `Write a concise implementation in ${languageName}. Reuse existing helpers and their return values. Follow the API usage demonstrated in the example. Keep setup, successful completion, and cleanup consistent with the example. Output only code.`
      : 'Write only the requested implementation in the given language. Use existing helpers and match their signatures. Implement every requirement concisely. Omit explanatory comments, examples and Markdown.';
  }
  const prompt = (prefix: string, suffix: string) => {
    if (!review)
      return `Language: ${language}\nCode before:\n${prefix}\nComment: ${instruction}\n<cursor>\nCode after:\n${suffix}`;
    const source = suffix.trim() ? `${prefix}\n<cursor>\n${suffix}` : prefix;
    if (reference) {
      const label =
        reference.language === language
          ? 'Example from the project'
          : `Example from the project (${reference.language})`;
      return `Task:\n${instruction}\n\n${label}:\n${reference.text}\n\nFunctions available to the implementation:\n${source}`;
    }
    return `Language: ${language}\nExisting code:\n${source}\nCurrent task:\n${instruction}`;
  };
  // Reserve the entire task and any user-selected example before fitting nearby code.
  const messageOverhead = 48;
  const remaining = byteBudget - Buffer.byteLength(system + prompt('', 'x')) - messageOverhead;
  if (remaining < 0) return;
  // Skip preceding comment-only tasks for which there is no implementation yet.
  const lines = before.split(/\r?\n/);
  let boundary = lines.length;
  while (boundary > 0) {
    let last = boundary - 1;
    while (last >= 0 && !lines[last]?.trim()) last--;
    if (last < 0) break;
    const prior = readInstruction(language, last, (i) => lines[i] ?? '');
    if (!prior) break;
    boundary = prior.start;
  }
  const preceding = boundary === lines.length ? before : lines.slice(0, boundary).join('\n');
  // Keep following source and its attached comments, but stop before an unrelated standalone task.
  const { prefix, suffix } = nearbyContext(
    preceding,
    trimStandaloneTrailingTask(language, after),
    remaining,
  );
  return [
    { role: 'system', content: system },
    { role: 'user', content: prompt(prefix, suffix) },
  ];
}

export function formatCompletion(reply: string, indent: string, eol: string): string | undefined {
  // Strip only exterior blank lines. Leading spaces on the first code line matter.
  const trimLines = (text: string) => text.replace(/^(?:[^\S\n]*\n)+|(?:\n[^\S\n]*)+$/g, '');
  let content = trimLines(reply.replace(/\r\n?/g, '\n'));
  if (content.trimStart().startsWith('```')) {
    const fenced = /^[ \t]*```[\w#+.-]*[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/.exec(content);
    if (!fenced) return;
    content = trimLines(fenced[1] ?? '');
  }
  if (!content.trim()) return;
  const lines = content.split('\n');
  if (lines.some((line) => line.trimStart().startsWith('```'))) return;
  let common = /^\s*/.exec(lines[0] ?? '')?.[0] ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    while (!line.startsWith(common)) common = common.slice(0, -1);
  }
  return lines.map((line) => (line.trim() ? indent + line.slice(common.length) : '')).join(eol);
}
