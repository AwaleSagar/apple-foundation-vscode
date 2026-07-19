import { describe, expect, it } from 'vitest';
import { applyResolvedHunksToText, resolveEditPlan } from './resolve';
import type { EditPlan } from './types';

describe('resolveEditPlan', () => {
  const files = new Map<string, string>([
    [
      'src/a.ts',
      ['export function add(a: number, b: number) {', '  return a + b;', '}', ''].join('\n'),
    ],
  ]);

  const source = {
    read: (path: string) => files.get(path),
    exists: (path: string) => files.has(path),
  };

  it('resolves a simple update hunk', () => {
    const plan: EditPlan = {
      summary: 'rename',
      changes: [
        {
          path: 'src/a.ts',
          action: 'update',
          hunks: [
            {
              search: '  return a + b;',
              replace: '  return a + b; // sum',
            },
          ],
        },
      ],
    };
    const { allOk, outcomes } = resolveEditPlan(plan, source);
    expect(allOk).toBe(true);
    const resolved = outcomes[0]?.resolved;
    expect(resolved).toHaveLength(1);
    if (resolved?.[0] !== undefined) {
      const next = applyResolvedHunksToText(files.get('src/a.ts') ?? '', resolved);
      expect(next).toContain('// sum');
      expect(next).toContain('export function add');
    }
  });

  it('fails when SEARCH is missing', () => {
    const plan: EditPlan = {
      summary: 'bad',
      changes: [
        {
          path: 'src/a.ts',
          action: 'update',
          hunks: [{ search: '  return a - b;', replace: 'x' }],
        },
      ],
    };
    const { allOk, outcomes } = resolveEditPlan(plan, source, { allowFuzzy: false });
    expect(allOk).toBe(false);
    expect(outcomes[0]?.ok).toBe(false);
  });

  it('applies multiple hunks from end to start without clobbering', () => {
    const original = 'AAAA\nBBBB\nCCCC\n';
    const hunks = [
      {
        search: 'AAAA',
        replace: 'A1',
        start: 0,
        end: 4,
        strategy: 'exact' as const,
      },
      {
        search: 'CCCC',
        replace: 'C3',
        start: 10,
        end: 14,
        strategy: 'exact' as const,
      },
    ];
    expect(applyResolvedHunksToText(original, hunks)).toBe('A1\nBBBB\nC3\n');
  });
});
