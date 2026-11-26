import MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';
import { readLimits } from '../core/config';
import { prependHistory } from '../core/history';
import type { NativeClient } from '../native/client';
import { turnContext } from './context';
import { historyFromChatContext } from './historyFromVscode';
import { buildMessages } from './prompts';

interface FenceState {
  readonly char: '`' | '~';
  readonly len: number;
}

export interface MarkdownSanitizer {
  push(chunk: string): void;
  flush(): void;
}

const ASCII_PUNCTUATION = /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/;
const URI_AUTOLINK = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/;
const EMAIL_AUTOLINK =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function isAsciiPunctuation(ch: string | undefined): boolean {
  return ch !== undefined && ASCII_PUNCTUATION.test(ch);
}

function isBlankLine(line: string): boolean {
  return /^[ \t]*\r?\n?$/.test(line);
}

function matchOpeningFence(line: string): FenceState | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r?\n$/, ''));
  if (!match) return null;
  const marker = match[1];
  const info = match[2] ?? '';
  if (!marker) return null;
  const char = marker[0] as '`' | '~';
  // CommonMark: backtick fence info strings may not contain backticks.
  if (char === '`' && info.includes('`')) return null;
  return { char, len: marker.length };
}

function isClosingFence(line: string, fence: FenceState): boolean {
  const stripped = line.replace(/\r?\n$/, '');
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(stripped);
  if (!match) return false;
  const marker = match[1];
  return marker !== undefined && marker[0] === fence.char && marker.length >= fence.len;
}

function wrapInlineCode(text: string): string {
  let maxRun = 0;
  for (const match of text.matchAll(/`+/g)) {
    if (match[0].length > maxRun) maxRun = match[0].length;
  }
  const ticks = '`'.repeat(maxRun + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

function findCodeSpanEnd(text: string, start: number, tickCount: number): number {
  let i = start;
  while (i < text.length) {
    if (text[i] === '\n' && text[i + 1] === '\n') return -1;
    if (text[i] === '\r' && text[i + 1] === '\n' && text[i + 2] === '\r' && text[i + 3] === '\n') {
      return -1;
    }
    if (text[i] === '`') {
      let run = 0;
      while (i + run < text.length && text[i + run] === '`') run++;
      if (run === tickCount) return i;
      i += run;
      continue;
    }
    i++;
  }
  return -1;
}

function findMatchingBracket(text: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n' && text[i + 1] === '\n') return -1;
    if (ch === '\r' && text[i + 1] === '\n' && text[i + 2] === '\r' && text[i + 3] === '\n') {
      return -1;
    }
    if (ch === '\\' && isAsciiPunctuation(text[i + 1])) {
      i += 2;
      continue;
    }
    if (ch === '`') {
      let run = 0;
      while (i + run < text.length && text[i + run] === '`') run++;
      const close = findCodeSpanEnd(text, i + run, run);
      if (close !== -1) {
        i = close + run;
        continue;
      }
      i += run;
      continue;
    }
    if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function skipHorizontalSpace(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return i;
}

function skipOptionalWhitespaceWithSingleNewline(text: string, pos: number): number {
  let i = skipHorizontalSpace(text, pos);
  if (text[i] === '\r' && text[i + 1] === '\n') {
    i = skipHorizontalSpace(text, i + 2);
  } else if (text[i] === '\n') {
    i = skipHorizontalSpace(text, i + 1);
  }
  return i;
}

function parseLinkDestination(text: string, pos: number): number {
  if (pos >= text.length) return -1;
  if (text[pos] === '<') {
    let i = pos + 1;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\n' || ch === '\r' || ch === '<') return -1;
      if (ch === '\\' && isAsciiPunctuation(text[i + 1])) {
        i += 2;
        continue;
      }
      if (ch === '>') return i + 1;
      i++;
    }
    return -1;
  }
  let i = pos;
  let parenDepth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === undefined) break;
    const code = ch.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) break;
    if (ch === '\\' && isAsciiPunctuation(text[i + 1])) {
      i += 2;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
    } else if (ch === ')') {
      if (parenDepth === 0) break;
      parenDepth--;
    }
    i++;
  }
  return parenDepth === 0 && i > pos ? i : -1;
}

function parseLinkTitle(text: string, pos: number): number {
  const open = text[pos];
  if (open !== '"' && open !== "'" && open !== '(') return -1;
  const close = open === '(' ? ')' : open;
  let i = pos + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n' && text[i + 1] === '\n') return -1;
    if (ch === '\r' && text[i + 1] === '\n' && text[i + 2] === '\r' && text[i + 3] === '\n') {
      return -1;
    }
    if (ch === '\\' && isAsciiPunctuation(text[i + 1])) {
      i += 2;
      continue;
    }
    if (open === '(' && ch === '(') return -1;
    if (ch === close) return i + 1;
    i++;
  }
  return -1;
}

function parseInlineLinkEnd(text: string, openParen: number): number {
  if (text[openParen] !== '(') return -1;
  const i = skipOptionalWhitespaceWithSingleNewline(text, openParen + 1);
  if (text[i] === ')') return i;
  const destEnd = parseLinkDestination(text, i);
  if (destEnd === -1) return -1;
  const afterDest = skipOptionalWhitespaceWithSingleNewline(text, destEnd);
  if (text[afterDest] === ')') return afterDest;
  if (afterDest === destEnd) return -1;
  const titleEnd = parseLinkTitle(text, afterDest);
  if (titleEnd === -1) return -1;
  const afterTitle = skipOptionalWhitespaceWithSingleNewline(text, titleEnd);
  return text[afterTitle] === ')' ? afterTitle : -1;
}

function parseAutolinkEnd(text: string, openAngle: number): number {
  let i = openAngle + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === undefined || ch === '<' || ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') {
      return -1;
    }
    if (ch === '>') {
      const inner = text.slice(openAngle + 1, i);
      return URI_AUTOLINK.test(inner) || EMAIL_AUTOLINK.test(inner) ? i : -1;
    }
    i++;
  }
  return -1;
}

function sanitizeInline(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === undefined) break;

    if (ch === '\\' && isAsciiPunctuation(text[i + 1])) {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }

    if (ch === '`') {
      let run = 0;
      while (i + run < text.length && text[i + run] === '`') run++;
      const close = findCodeSpanEnd(text, i + run, run);
      if (close !== -1) {
        out += text.slice(i, close + run);
        i = close + run;
      } else {
        out += text.slice(i, i + run);
        i += run;
      }
      continue;
    }

    if (ch === '!' && text[i + 1] === '[') {
      const closeBracket = findMatchingBracket(text, i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = parseInlineLinkEnd(text, closeBracket + 1);
        if (closeParen !== -1) {
          out += sanitizeInline(text.slice(i + 2, closeBracket));
          i = closeParen + 1;
          continue;
        }
      }
      out += ch;
      i++;
      continue;
    }

    if (ch === '[') {
      const closeBracket = findMatchingBracket(text, i);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = parseInlineLinkEnd(text, closeBracket + 1);
        if (closeParen !== -1) {
          out += sanitizeInline(text.slice(i + 1, closeBracket));
          i = closeParen + 1;
          continue;
        }
      }
      out += ch;
      i++;
      continue;
    }

    if (ch === '<') {
      const closeAngle = parseAutolinkEnd(text, i);
      if (closeAngle !== -1) {
        out += wrapInlineCode(text.slice(i + 1, closeAngle));
        i = closeAngle + 1;
        continue;
      }
    }

    out += ch;
    i++;
  }
  return out;
}

function stripBlockquotePrefix(line: string): string {
  return line.replace(/^(?: {0,3}>)+/, '');
}

/**
 * If `lines[startIndex..]` begins with a CommonMark link reference definition
 * (`[id]: destination "optional title"`), returns the index immediately after
 * the definition; otherwise returns `-1`.
 */
function matchReferenceDefinition(lines: readonly string[], startIndex: number): number {
  const firstLine = lines[startIndex];
  if (firstLine === undefined) return -1;
  const firstUnquoted = stripBlockquotePrefix(firstLine);
  const lead = /^ {0,3}/.exec(firstUnquoted);
  const startOffset = lead ? lead[0].length : 0;
  if (firstUnquoted[startOffset] !== '[') return -1;

  // Gather candidate lines until a blank line (at most 5 lines for multi-line label/dest/title).
  let combined = '';
  const lineEndOffsets: number[] = [];
  const maxLines = Math.min(lines.length, startIndex + 6);
  for (let idx = startIndex; idx < maxLines; idx++) {
    const line = lines[idx];
    if (line === undefined) break;
    const unquoted = stripBlockquotePrefix(line);
    if (idx > startIndex && isBlankLine(unquoted)) break;
    combined += unquoted;
    lineEndOffsets.push(combined.length);
  }

  // Parse `[label]:`
  let i = startOffset + 1;
  let hasNonSpace = false;
  let labelEnd = -1;
  while (i < combined.length && i - startOffset <= 1000) {
    const ch = combined[i];
    if (ch === undefined) break;
    if (ch === '\\' && isAsciiPunctuation(combined[i + 1])) {
      hasNonSpace = true;
      i += 2;
      continue;
    }
    if (ch === '[') return -1;
    if (ch === ']') {
      labelEnd = i;
      break;
    }
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') hasNonSpace = true;
    i++;
  }
  if (labelEnd === -1 || !hasNonSpace || combined[labelEnd + 1] !== ':') return -1;

  const afterColon = skipOptionalWhitespaceWithSingleNewline(combined, labelEnd + 2);
  const destEnd = parseLinkDestination(combined, afterColon);
  if (destEnd === -1) return -1;

  const toLineIndex = (offset: number): number => {
    for (let k = 0; k < lineEndOffsets.length; k++) {
      const end = lineEndOffsets[k];
      if (end !== undefined && offset <= end) return startIndex + k + 1;
    }
    return startIndex + lineEndOffsets.length;
  };

  const afterDestSpace = skipHorizontalSpace(combined, destEnd);
  const destAtEol =
    afterDestSpace >= combined.length ||
    combined[afterDestSpace] === '\n' ||
    (combined[afterDestSpace] === '\r' && combined[afterDestSpace + 1] === '\n');

  if (destAtEol) {
    const destLineEnd = toLineIndex(afterDestSpace);
    const nextPos = skipOptionalWhitespaceWithSingleNewline(combined, afterDestSpace);
    if (nextPos > afterDestSpace && nextPos < combined.length) {
      const titleEnd = parseLinkTitle(combined, nextPos);
      if (titleEnd !== -1) {
        const afterTitleSpace = skipHorizontalSpace(combined, titleEnd);
        const titleAtEol =
          afterTitleSpace >= combined.length ||
          combined[afterTitleSpace] === '\n' ||
          (combined[afterTitleSpace] === '\r' && combined[afterTitleSpace + 1] === '\n');
        if (titleAtEol) return toLineIndex(afterTitleSpace);
      }
    }
    return destLineEnd;
  }

  // Same-line title must be separated by whitespace and reach end of line.
  if (afterDestSpace === destEnd) return -1;
  const titleEnd = parseLinkTitle(combined, afterDestSpace);
  if (titleEnd === -1) return -1;
  const afterTitleSpace = skipHorizontalSpace(combined, titleEnd);
  const titleAtEol =
    afterTitleSpace >= combined.length ||
    combined[afterTitleSpace] === '\n' ||
    (combined[afterTitleSpace] === '\r' && combined[afterTitleSpace + 1] === '\n');
  return titleAtEol ? toLineIndex(afterTitleSpace) : -1;
}

function splitLinesPreservingEndings(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

function stripReferenceDefinitions(text: string): string {
  const lines = splitLinesPreservingEndings(text);
  const kept: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const nextIdx = matchReferenceDefinition(lines, i);
    if (nextIdx !== -1) {
      i = nextIdx;
      continue;
    }
    const line = lines[i];
    if (line !== undefined) kept.push(line);
    i++;
  }
  return kept.join('');
}

// Block classification needs the preceding list and paragraph context. Only
// prose is rewritten. Code tokens retain their original spelling and spacing.
const blockParser = new MarkdownIt('commonmark', { html: false }).disable('inline');

function sanitizeBlock(text: string, precedingText: string, firstLine: number): string {
  const lines = splitLinesPreservingEndings(text);
  const prose = (start: number, end: number) =>
    sanitizeInline(stripReferenceDefinitions(lines.slice(start, end).join('')));
  let cursor = 0;
  let result = '';
  for (const token of blockParser.parse(precedingText + text, {})) {
    if (!token.map || (token.type !== 'code_block' && token.type !== 'fence')) continue;
    const start = Math.max(0, token.map[0] - firstLine);
    const end = Math.min(lines.length, token.map[1] - firstLine);
    if (end <= start) continue;
    result += prose(cursor, start) + lines.slice(start, end).join('');
    cursor = end;
  }
  return result + prose(cursor, lines.length);
}

export function sanitizeParticipantMarkdown(markdown: string): string {
  return sanitizeBlock(markdown.replace(/\r(?!\n)/g, '\n'), '', 0);
}

/**
 * Incremental sanitizer for streamed LLM deltas. Streams fenced code blocks
 * line-by-line and flushes prose at paragraph boundaries so multi-token
 * Markdown links, images, autolinks, and reference definitions cannot slip
 * across chunk boundaries.
 */
export function createMarkdownSanitizer(emit: (text: string) => void): MarkdownSanitizer {
  let pendingLine = '';
  let blockLines: string[] = [];
  let fence: FenceState | null = null;

  let precedingText = '';
  let firstLine = 0;
  let emittedPrefix = 0;

  const flushBlock = () => {
    if (!blockLines.length) return;
    const text = blockLines.join('');
    const sanitized = sanitizeBlock(text, precedingText, firstLine).slice(emittedPrefix);
    precedingText += text;
    firstLine += blockLines.length;
    emittedPrefix = 0;
    blockLines = [];
    if (sanitized) emit(sanitized);
  };

  const processLine = (line: string) => {
    if (fence !== null) {
      emit(line);
      if (isClosingFence(line, fence)) fence = null;
      return;
    }
    // A fence at column zero cannot be a list continuation. Parse nested
    // blocks with the surrounding text before emitting their contents.
    const opened = /^[`~]/.test(line) ? matchOpeningFence(line) : null;
    if (
      opened &&
      blockParser
        .parse(precedingText + blockLines.join('') + line, {})
        .some(
          (token) =>
            token.type === 'fence' &&
            token.level === 0 &&
            token.map?.[0] === firstLine + blockLines.length,
        )
    ) {
      flushBlock();
      fence = opened;
      // A top-level fence terminates the preceding container.
      precedingText = '';
      firstLine = 0;
      emit(line);
      return;
    }
    blockLines.push(line);
    if (isBlankLine(line)) flushBlock();
  };

  return {
    push(chunk: string) {
      // Keep a trailing CR until the next chunk distinguishes CRLF from CR.
      pendingLine = (pendingLine + chunk).replace(/\r(?!\n|$)/g, '\n');
      let nl = pendingLine.indexOf('\n');
      while (nl !== -1) {
        const line = pendingLine.slice(0, nl + 1);
        pendingLine = pendingLine.slice(nl + 1);
        processLine(line);
        nl = pendingLine.indexOf('\n');
      }
      // A paragraph beginning with a word cannot become a reference
      // definition. Stream its literal prefix while Markdown syntax is pending.
      if (!fence && !blockLines.length && /^[\p{L}\p{N}]/u.test(pendingLine)) {
        const plain = /^[\p{L}\p{N} ,.;:'"?()-]+/u.exec(pendingLine.slice(emittedPrefix));
        if (plain) {
          emit(plain[0]);
          emittedPrefix += plain[0].length;
        }
      }
    },
    flush() {
      if (pendingLine) {
        const tail = pendingLine.replace(/\r$/, '\n');
        pendingLine = '';
        processLine(tail);
      }
      flushBlock();
    },
  };
}

/**
 * Wraps a `/doc` reply in a backtick fence strictly longer than the longest
 * backtick run in `body` (at least 3), matching `fenceBlock` in `prompts.ts`.
 */
export function fenceCodeReply(body: string, languageId?: string): string {
  const lang = (languageId ?? '').replace(/[`\r\n]/g, '');
  let maxRun = 0;
  for (const match of body.matchAll(/`+/g)) {
    if (match[0].length > maxRun) maxRun = match[0].length;
  }
  const fence = '`'.repeat(Math.max(3, maxRun + 1));
  return `${fence}${lang}\n${body}\n${fence}`;
}

export function registerChatParticipant(client: NativeClient) {
  const participant = vscode.chat.createChatParticipant(
    'apple-foundation.chat',
    async (request, context, stream, token) => {
      try {
        const turn = await turnContext(request.command, request.prompt);
        if (!request.command && !turn.prompt.trim() && !turn.selection?.trim()) {
          return {
            errorDetails: { message: 'Enter a message or select code in an editor first.' },
          };
        }
        const history = request.command ? [] : historyFromChatContext(context);
        let doc = '';
        const sanitizer = createMarkdownSanitizer((text) => stream.markdown(text));
        const isDoc = request.command === 'doc';
        try {
          await client.generate(
            prependHistory(buildMessages(turn), history),
            readLimits(),
            token,
            (text) => {
              if (isDoc) doc += text;
              else sanitizer.push(text);
            },
            () => stream.progress('Trimmed earlier turns to fit this Mac’s context window.'),
          );
        } finally {
          if (isDoc && doc) stream.markdown(fenceCodeReply(doc, turn.languageId));
          else sanitizer.flush();
        }
        return { metadata: { command: request.command } };
      } catch (error) {
        if (token.isCancellationRequested) return {};
        return {
          errorDetails: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
  );
  participant.iconPath = new vscode.ThemeIcon('sparkle');
  participant.followupProvider = {
    provideFollowups(result) {
      if (result.errorDetails) return [];
      return result.metadata?.['command'] === 'commit'
        ? [{ prompt: '', command: 'commit', label: 'Regenerate commit message' }]
        : [
            { prompt: '', command: 'explain', label: 'Explain the selection' },
            { prompt: '', command: 'doc', label: 'Document the selection' },
          ];
    },
  };
  return participant;
}
