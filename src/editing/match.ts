import type { MatchResult, MatchStrategyName } from './types';

const FUZZY_THRESHOLD = 0.72;
const NEAREST_SNIPPET_RADIUS = 120;

/** Normalize only line endings so CR/LF differences don't block matches. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Map an index in a normalized string back to the original by walking both.
 * Returns -1 if the mapping cannot be established.
 */
function mapNormalizedIndex(
  original: string,
  normalize: (s: string) => string,
  normalizedIndex: number,
): number {
  if (normalizedIndex <= 0) {
    return 0;
  }
  // For EOL-only normalization, indices differ only when \r\n is present.
  // Walk original, producing the same transform, until we hit the target.
  let oi = 0;
  let ni = 0;
  const target = normalizedIndex;
  while (oi < original.length && ni < target) {
    if (original[oi] === '\r' && original[oi + 1] === '\n') {
      // maps to single \n
      oi += 2;
      ni += 1;
    } else if (original[oi] === '\r') {
      oi += 1;
      ni += 1;
    } else {
      oi += 1;
      ni += 1;
    }
  }
  if (ni !== target) {
    // Fallback: if normalize is identity-ish, indices match
    const n = normalize(original);
    if (n === original) {
      return normalizedIndex;
    }
    return -1;
  }
  return oi;
}

function findExact(content: string, search: string): MatchResult {
  const idx = content.indexOf(search);
  if (idx === -1) {
    return { ok: false, reason: 'No exact match for SEARCH block' };
  }
  // Ambiguous: prefer first, but report if duplicates exist
  const second = content.indexOf(search, idx + 1);
  if (second !== -1) {
    // Still accept first match — callers can tighten SEARCH uniqueness.
    return { ok: true, start: idx, end: idx + search.length, strategy: 'exact' };
  }
  return { ok: true, start: idx, end: idx + search.length, strategy: 'exact' };
}

function findWithEolNormalize(content: string, search: string): MatchResult {
  const nContent = normalizeEol(content);
  const nSearch = normalizeEol(search);
  const idx = nContent.indexOf(nSearch);
  if (idx === -1) {
    return { ok: false, reason: 'No match after EOL normalization' };
  }
  const start = mapNormalizedIndex(content, normalizeEol, idx);
  const end = mapNormalizedIndex(content, normalizeEol, idx + nSearch.length);
  if (start < 0 || end < 0 || end < start) {
    // Safe fallback: if content was already LF, indices equal
    if (content === nContent) {
      return { ok: true, start: idx, end: idx + nSearch.length, strategy: 'eol' };
    }
    return { ok: false, reason: 'EOL match found but could not map indices' };
  }
  return { ok: true, start, end, strategy: 'eol' };
}

/**
 * Simple token-ish similarity for fuzzy matching short SEARCH blocks.
 * Not a full Levenshtein on whole files — too expensive and error-prone.
 */
function similarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  // Dice coefficient on bigrams
  const bigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) ?? 0) + 1);
    }
    return map;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  for (const [bg, count] of A) {
    const other = B.get(bg) ?? 0;
    overlap += Math.min(count, other);
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

function findFuzzy(content: string, search: string): MatchResult {
  const nContent = normalizeEol(content);
  const nSearch = normalizeEol(search);
  // Window size: search length ± 20%
  const window = nSearch.length;
  if (window === 0 || nContent.length < window) {
    return { ok: false, reason: 'SEARCH longer than file or empty' };
  }

  let bestScore = 0;
  let bestStart = -1;
  // Step by ~1/4 window for performance
  const step = Math.max(1, Math.floor(window / 4));
  for (let i = 0; i <= nContent.length - window; i += step) {
    const slice = nContent.slice(i, i + window);
    const score = similarity(slice, nSearch);
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
    }
  }
  // Also try exact length windows at line boundaries near best
  if (bestStart >= 0 && bestScore >= FUZZY_THRESHOLD) {
    // Refine: check nearby offsets for a better exact-length match
    const refineFrom = Math.max(0, bestStart - step);
    const refineTo = Math.min(nContent.length - window, bestStart + step);
    for (let i = refineFrom; i <= refineTo; i++) {
      const slice = nContent.slice(i, i + window);
      const score = similarity(slice, nSearch);
      if (score > bestScore) {
        bestScore = score;
        bestStart = i;
      }
    }
  }

  if (bestStart < 0 || bestScore < FUZZY_THRESHOLD) {
    return {
      ok: false,
      reason: `Fuzzy match score ${(bestScore * 100).toFixed(0)}% below threshold`,
      nearestSnippet: nearestSnippet(nContent, nSearch),
    };
  }

  if (nContent === content) {
    return {
      ok: true,
      start: bestStart,
      end: bestStart + window,
      strategy: 'fuzzy',
    };
  }
  // Map through EOL normalize
  const start = mapNormalizedIndex(content, normalizeEol, bestStart);
  const end = mapNormalizedIndex(content, normalizeEol, bestStart + window);
  if (start < 0 || end < 0) {
    return { ok: false, reason: 'Fuzzy match could not map indices' };
  }
  return { ok: true, start, end, strategy: 'fuzzy' };
}

function nearestSnippet(content: string, search: string): string | undefined {
  // Use first non-empty line of search as a needle
  const line = normalizeEol(search)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (line === undefined) {
    return undefined;
  }
  const idx = content.indexOf(line);
  if (idx === -1) {
    return undefined;
  }
  const from = Math.max(0, idx - 40);
  const to = Math.min(content.length, idx + line.length + NEAREST_SNIPPET_RADIUS);
  return content.slice(from, to);
}

/**
 * Locate `search` inside `content` using layered strategies:
 * exact → EOL-normalized → whitespace-normalized (via line-level) → fuzzy.
 */
export function findHunk(
  content: string,
  search: string,
  options?: { readonly allowFuzzy?: boolean },
): MatchResult {
  if (search === '') {
    return { ok: false, reason: 'SEARCH block is empty' };
  }

  const exact = findExact(content, search);
  if (exact.ok) {
    return exact;
  }

  const eol = findWithEolNormalize(content, search);
  if (eol.ok) {
    return eol;
  }

  // Whitespace-tolerant: try matching line-by-line with trimmed comparison
  const ws = findWhitespaceTolerant(content, search);
  if (ws.ok) {
    return ws;
  }

  if (options?.allowFuzzy === false) {
    return {
      ok: false,
      reason: 'No match (exact / EOL / whitespace)',
      nearestSnippet: nearestSnippet(normalizeEol(content), search),
    };
  }

  return findFuzzy(content, search);
}

function findWhitespaceTolerant(content: string, search: string): MatchResult {
  const contentLines = normalizeEol(content).split('\n');
  const searchLines = normalizeEol(search).split('\n');
  // Drop trailing empty line from split artifacts
  while (searchLines.length > 0 && searchLines[searchLines.length - 1] === '') {
    searchLines.pop();
  }
  if (searchLines.length === 0) {
    return { ok: false, reason: 'Empty SEARCH after whitespace normalize' };
  }

  const norm = (line: string) => line.replace(/[ \t]+/g, ' ').trimEnd();
  const target = searchLines.map(norm);

  for (let i = 0; i <= contentLines.length - target.length; i++) {
    let ok = true;
    for (let j = 0; j < target.length; j++) {
      if (norm(contentLines[i + j] ?? '') !== target[j]) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      continue;
    }
    // Map line range back to character offsets in original content (LF-normalized path)
    const nContent = normalizeEol(content);
    let start = 0;
    for (let k = 0; k < i; k++) {
      start += (contentLines[k]?.length ?? 0) + 1; // +1 for \n
    }
    let end = start;
    for (let k = 0; k < target.length; k++) {
      end += contentLines[i + k]?.length ?? 0;
      if (k < target.length - 1) {
        end += 1;
      }
    }
    // Include trailing newline if search had one and content has it
    if (normalizeEol(search).endsWith('\n') && nContent[end] === '\n') {
      end += 1;
    }

    if (nContent === content) {
      return { ok: true, start, end, strategy: 'ws' };
    }
    const mappedStart = mapNormalizedIndex(content, normalizeEol, start);
    const mappedEnd = mapNormalizedIndex(content, normalizeEol, end);
    if (mappedStart < 0 || mappedEnd < 0) {
      return { ok: false, reason: 'Whitespace match could not map indices' };
    }
    return { ok: true, start: mappedStart, end: mappedEnd, strategy: 'ws' };
  }

  return { ok: false, reason: 'No whitespace-tolerant match' };
}

export function describeMatchStrategy(strategy: MatchStrategyName): string {
  switch (strategy) {
    case 'exact':
      return 'exact';
    case 'eol':
      return 'EOL-normalized';
    case 'ws':
      return 'whitespace-tolerant';
    case 'fuzzy':
      return 'fuzzy';
  }
}
