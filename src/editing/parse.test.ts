import { describe, expect, it } from 'vitest';
import { extractJsonObject, parseEditPlan } from './parse';
import { validateEditPlan } from './schema';

describe('validateEditPlan', () => {
  it('accepts a minimal valid plan', () => {
    const result = validateEditPlan({
      summary: 'Add logging',
      changes: [
        {
          path: 'src/a.ts',
          action: 'update',
          hunks: [{ search: 'x', replace: 'y' }],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects empty changes', () => {
    const result = validateEditPlan({ summary: 'x', changes: [] });
    expect(result.ok).toBe(false);
  });

  it('rejects update without hunks or wholeFile', () => {
    const result = validateEditPlan({
      summary: 'x',
      changes: [{ path: 'a.ts', action: 'update' }],
    });
    expect(result.ok).toBe(false);
  });
});

describe('parseEditPlan JSON', () => {
  it('parses fenced JSON', () => {
    const text = `Here is the plan:
\`\`\`json
{
  "summary": "Rename",
  "changes": [{
    "path": "app.ts",
    "action": "update",
    "hunks": [{ "search": "foo", "replace": "bar" }]
  }]
}
\`\`\`
`;
    const result = parseEditPlan(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.format).toBe('json');
      expect(result.plan.changes[0]?.path).toBe('app.ts');
    }
  });

  it('parses raw JSON object in prose', () => {
    const text =
      'Sure. {"summary":"fix","changes":[{"path":"a.ts","action":"update","hunks":[{"search":"a","replace":"b"}]}]}';
    const result = parseEditPlan(text);
    expect(result.ok).toBe(true);
  });
});

describe('parseEditPlan SEARCH/REPLACE', () => {
  it('parses fenced aider-style blocks', () => {
    const text = `
mathweb/app.py
\`\`\`
<<<<<<< SEARCH
from flask import Flask
=======
import math
from flask import Flask
>>>>>>> REPLACE
\`\`\`
`;
    const result = parseEditPlan(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.format).toBe('search-replace');
      expect(result.plan.changes).toHaveLength(1);
      expect(result.plan.changes[0]?.path).toBe('mathweb/app.py');
      expect(result.plan.changes[0]?.hunks?.[0]?.search).toContain('from flask');
      expect(result.plan.changes[0]?.hunks?.[0]?.replace).toContain('import math');
    }
  });

  it('uses defaultPath when path omitted', () => {
    const text = `
\`\`\`
<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE
\`\`\`
`;
    const result = parseEditPlan(text, { defaultPath: 'src/main.ts' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.changes[0]?.path).toBe('src/main.ts');
    }
  });

  it('parses unfenced SEARCH/REPLACE', () => {
    const text = `src/x.ts
<<<<<<< SEARCH
const a = 1;
=======
const a = 2;
>>>>>>> REPLACE
`;
    const result = parseEditPlan(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.changes[0]?.hunks?.[0]?.replace).toBe('const a = 2;');
    }
  });
});

describe('extractJsonObject', () => {
  it('returns undefined when no object present', () => {
    expect(extractJsonObject('no json here')).toBeUndefined();
  });
});
