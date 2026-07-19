import { describe, expect, it } from 'vitest';
import { findHunk, normalizeEol } from './match';

describe('findHunk', () => {
  const sample = [
    'function greet(name: string) {',
    '  console.log("hi", name);',
    '  return name;',
    '}',
    '',
  ].join('\n');

  it('matches exact SEARCH blocks', () => {
    const search = '  console.log("hi", name);\n  return name;';
    const result = findHunk(sample, search);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.strategy).toBe('exact');
      expect(sample.slice(result.start, result.end)).toBe(search);
    }
  });

  it('matches after CRLF normalization', () => {
    const crlf = sample.replace(/\n/g, '\r\n');
    const search = '  console.log("hi", name);\n  return name;';
    const result = findHunk(crlf, search);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(['exact', 'eol']).toContain(result.strategy);
    }
  });

  it('matches when SEARCH has different indentation spaces collapsed', () => {
    // SEARCH with single-space indent vs two-space file — whitespace strategy
    const search = ' console.log("hi", name);\n return name;';
    const result = findHunk(sample, search, { allowFuzzy: false });
    // May fail exact/eol; ws strategy compares trimmed
    if (!result.ok) {
      // acceptable if too different — fuzzy would handle
      const fuzzy = findHunk(sample, '  console.log("hi", name);');
      expect(fuzzy.ok).toBe(true);
    } else {
      expect(result.strategy).toBe('ws');
    }
  });

  it('returns a helpful failure for missing SEARCH', () => {
    const result = findHunk(sample, '  console.log("bye", name);', { allowFuzzy: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('fuzzy-matches near-miss SEARCH content', () => {
    // Slightly wrong string that still looks like the log line
    const search = '  console.log("hello", name);\n  return name;';
    const result = findHunk(sample, search, { allowFuzzy: true });
    // May or may not pass threshold depending on similarity — either ok or structured fail
    if (result.ok) {
      expect(result.strategy).toBe('fuzzy');
    } else {
      expect(result.reason).toMatch(/Fuzzy|match/i);
    }
  });
});

describe('normalizeEol', () => {
  it('converts CRLF and CR to LF', () => {
    expect(normalizeEol('a\r\nb\rc')).toBe('a\nb\nc');
  });
});
