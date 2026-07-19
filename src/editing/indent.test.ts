import { describe, expect, it } from 'vitest';
import { alignReplaceIndent, detectIndentUnit } from './indent';

describe('detectIndentUnit', () => {
  it('detects 2-space indent', () => {
    const text = 'function f() {\n  return 1;\n}\n';
    expect(detectIndentUnit(text)).toEqual({ kind: 'space', size: 2 });
  });

  it('detects tabs', () => {
    const text = 'function f() {\n\treturn 1;\n}\n';
    expect(detectIndentUnit(text).kind).toBe('tab');
  });
});

describe('alignReplaceIndent', () => {
  it('rebases replace indent to search base', () => {
    const search = '  if (x) {\n    return 1;\n  }';
    // Model returned 0-base indent
    const replace = 'if (x) {\n  return 2;\n}';
    const aligned = alignReplaceIndent(search, replace);
    expect(aligned.startsWith('  if')).toBe(true);
    expect(aligned).toContain('    return 2;');
  });

  it('leaves replace alone when bases match', () => {
    const search = '  a';
    const replace = '  b';
    expect(alignReplaceIndent(search, replace)).toBe(replace);
  });
});
