import { expect, it } from 'vitest';
import {
  commentAt,
  completionLanguages,
  completionMessages,
  formatCompletion,
  readInstruction,
} from './completion';

const read = (language: string, ...lines: string[]) =>
  readInstruction(language, lines.length - 1, (i) => lines[i] ?? '');

it.each(completionLanguages)('reads standalone comments in %s', (language) => {
  const marker = ['python', 'ruby', 'shellscript'].includes(language) ? '#' : '//';
  expect(read(language, 'main()', `  ${marker} Read the input`, `  ${marker} and sort it`)).toEqual(
    { start: 1, text: 'Read the input\nand sort it', indent: '  ' },
  );
});

it('reads closed C-style blocks on one or several lines', () => {
  expect(read('swift', '\t/* Count rows */')).toEqual({
    start: 0,
    text: 'Count rows',
    indent: '\t',
  });
  expect(read('typescript', '  /**', '   * Count rows', '   * by key', '   */')?.text).toBe(
    'Count rows\nby key',
  );
  expect(read('rust', '/// Collect items')?.text).toBe('Collect items');
  expect(read('python', '#!/usr/bin/python', '# Count rows')?.start).toBe(1);
});

it('skips ordinary code, trailing, empty, oversized and unfinished comments', () => {
  for (const lines of [
    ['let a = 1 // sort'],
    ['let a = 1 /* sort */'],
    ['/* sort'],
    ['/**/'],
    ['/* old */', 'let a = 1;', '*/'],
    ['//'],
    ['// sort', ''],
    [`//${'x'.repeat(4096)}`],
    Array(65).fill('// sort'),
  ])
    expect(read('typescript', ...lines)).toBeUndefined();
  expect(read('shellscript', '#!/bin/sh')).toBeUndefined();
  expect(read('plaintext', '// sort')).toBeUndefined();
  expect(read('python', '// sort')).toBeUndefined();
});

it('fits the instruction and closest code from both sides within the input budget', () => {
  const messages = completionMessages(
    'python',
    'Sum costs',
    `${'📗'.repeat(1000)}costs = load()`,
    `report(costs)${'📗'.repeat(1000)}`,
    512,
  );
  expect(messages?.[1]?.content).toMatch(/costs = load\(\).*Sum costs.*report\(costs\)/s);
  expect(messages?.[1]?.content).not.toContain('\uFFFD');
  expect(
    Buffer.byteLength(messages?.map((m) => m.content).join('') ?? '') + 32,
  ).toBeLessThanOrEqual(512);
  expect(completionMessages('python', 'do '.repeat(300), '', '', 512)).toBeUndefined();
});

it('formats a single insertion with the document indent and line endings', () => {
  expect(
    formatCompletion(
      '\n```python\n  if rows:\n    return rows\n\n  return []\n```\n',
      '\t',
      '\r\n',
    ),
  ).toBe('\tif rows:\r\n\t  return rows\r\n\r\n\treturn []');
  expect(formatCompletion('return costs', '    ', '\n')).toBe('    return costs');
  for (const reply of ['', '  \n', '```go\nreturn x', 'Here you go:\n```js\nx\n```'])
    expect(formatCompletion(reply, '', '\n')).toBeUndefined();
});

it('targets a whole standalone instruction from any of its lines', () => {
  const lines = ['  /*', '   * Count rows', '   */', 'count();', '', '// Sort', '// in order'];
  const at = (index: number) => commentAt('typescript', index, lines.length, (i) => lines[i] ?? '');
  for (const i of [0, 1, 2]) {
    expect(at(i)).toEqual({ start: 0, end: 2, text: 'Count rows', indent: '  ' });
  }
  expect(at(3)).toBeUndefined();
  expect(at(4)).toBeUndefined();
  expect(at(5)).toEqual(at(6));
  expect(at(6)?.text).toBe('Sort\nin order');
  expect(commentAt('python', 0, 1, () => '#!/bin/python')).toBeUndefined();
});

it('keeps following code but excludes a later standalone instruction', () => {
  for (const [language, marker] of [
    ['python', '#'],
    ['typescript', '//'],
    ['swift', '/*'],
  ] as const) {
    const value = completionMessages(
      language,
      'Compute the total',
      '',
      `use(total)\n\n  ${marker} Delete all rows`,
      2048,
    );
    expect(value?.[1]?.content).toContain('use(total)');
    expect(value?.[1]?.content).not.toContain('Delete all rows');
  }
});

it('omits an earlier unimplemented comment and budgets for a complete reference', () => {
  const before = 'def helper(): pass\n\n# Implement something_else\n\n';
  const reference = { language: 'python', text: 'db.execute("SAVEPOINT example")' };
  const build = (budget: number) =>
    completionMessages('python', 'Implement this_task()', before, '', budget, { reference });
  const prompt = build(1024)
    ?.map((m) => m.content)
    .join('\n');
  expect(prompt).toContain(reference.text);
  expect(prompt).toContain('def helper()');
  expect(prompt).toContain('Implement this_task()');
  expect(prompt).not.toContain('something_else');
  expect(build(100)).toBeUndefined();
});
