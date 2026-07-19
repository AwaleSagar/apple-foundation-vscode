/**
 * Preserve indentation style when applying SEARCH/REPLACE replacements.
 * Inspired by RooCode: if REPLACE systematically uses a different base indent
 * than SEARCH, re-base it to the matched SEARCH block's indent.
 */

/** Detect common indent unit (tabs or N spaces) from a text sample. */
export function detectIndentUnit(text: string): {
  readonly kind: 'tab' | 'space';
  readonly size: number;
} {
  const lines = text.split(/\r?\n/);
  let tabCount = 0;
  const spaceIndents: number[] = [];
  for (const line of lines) {
    if (line.length === 0 || line.trim() === '') {
      continue;
    }
    if (line.startsWith('\t')) {
      tabCount += 1;
      continue;
    }
    const match = /^( +)/.exec(line);
    if (match?.[1] !== undefined) {
      spaceIndents.push(match[1].length);
    }
  }
  if (tabCount > spaceIndents.length) {
    return { kind: 'tab', size: 1 };
  }
  if (spaceIndents.length === 0) {
    return { kind: 'space', size: 2 };
  }
  // GCD-ish of common 2/4
  const hasFour = spaceIndents.some((n) => n % 4 === 0 && n > 0);
  const hasTwo = spaceIndents.some((n) => n % 2 === 0 && n > 0);
  if (hasFour && !spaceIndents.some((n) => n === 2 || n === 6)) {
    return { kind: 'space', size: 4 };
  }
  if (hasTwo) {
    return { kind: 'space', size: 2 };
  }
  return { kind: 'space', size: spaceIndents[0] ?? 2 };
}

function leadingWs(line: string): string {
  const match = /^[ \t]*/.exec(line);
  return match?.[0] ?? '';
}

/**
 * If every non-empty line in `replace` shares a common extra indent relative
 * to `search`, strip that and re-apply the base indent from `search`.
 * Otherwise return `replace` unchanged.
 */
export function alignReplaceIndent(search: string, replace: string): string {
  if (replace === '' || search === '') {
    return replace;
  }

  const searchLines = search.split(/\r?\n/);
  const replaceLines = replace.split(/\r?\n/);

  const searchBase = minIndent(searchLines);
  const replaceBase = minIndent(replaceLines);

  if (searchBase === replaceBase) {
    return replace;
  }

  // Rebase: strip replaceBase from each line, apply searchBase
  const rebased = replaceLines.map((line) => {
    if (line.trim() === '') {
      return line;
    }
    const ws = leadingWs(line);
    const stripped =
      ws.length >= replaceBase.length && ws.startsWith(replaceBase)
        ? line.slice(replaceBase.length)
        : line.trimStart();
    return searchBase + stripped;
  });

  return rebased.join(search.includes('\r\n') ? '\r\n' : '\n');
}

function minIndent(lines: string[]): string {
  let min: string | undefined;
  for (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    const ws = leadingWs(line);
    if (min === undefined || ws.length < min.length) {
      min = ws;
    }
  }
  return min ?? '';
}
