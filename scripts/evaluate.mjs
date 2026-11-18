// Node 24 strips the type-only imports from the same prompt builder the extension uses.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { buildMessages } from '../src/chat/prompts.ts';

const executable = resolve(process.argv[2] ?? 'dist/apple-local-helper');
const cases = [
  {
    command: 'explain',
    selection: '[1, 2, 3].filter { $0 > 1 }',
    checks: [/greater than (?:one|1)|>\s*1/i, /2,? (?:and )?3/],
  },
  {
    command: 'doc',
    selection: 'func doubled(_ value: Int) -> Int { value * 2 }',
    checks: [/\/\/\/|\/\*\*/, /doubl|twice|multipl/i, /^\/\/\/[^\n]+$/],
  },
  {
    command: 'commit',
    diff: '-const timeoutMs = 2000;\n+const timeoutMs = 5000;',
    checks: [
      /^(?:feat|fix|perf|chore|refactor)(?:\([^)]+\))?: [^\n]+$/,
      /increas|rais|extend|bump/i,
      /timeout/i,
      /(?:2000|2\s*s).*?(?:5000|5\s*s)/i,
    ],
  },
];
let failed = false;
for (const fixture of cases) {
  const start = performance.now();
  const child = spawn(executable, [], {
    env: { ...process.env, PATH: '/nonexistent' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const stream = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const timeout = setTimeout(() => child.kill(), 45000);
  try {
    for (const temperature of ['first', 'warm']) {
      const begin = temperature === 'first' ? start : performance.now();
      const id = fixture.command + temperature;
      child.stdin.write(
        JSON.stringify({
          id,
          op: 'generate',
          messages: buildMessages({ prompt: '', languageId: 'swift', ...fixture }),
        }) + '\n',
      );
      let first,
        text = '';
      for (;;) {
        const line = await stream.next();
        assert.ok(!line.done, 'Helper exited early');
        const event = JSON.parse(line.value);
        assert.equal(event.id, id);
        if (event.kind === 'done') break;
        assert.equal(event.kind, 'delta', event.text);
        first ??= performance.now();
        text += event.text;
      }
      const score = fixture.checks.filter((test) => test.test(text)).length;
      failed ||= score < fixture.checks.length;
      process.stdout.write(
        JSON.stringify({
          task: fixture.command,
          run: temperature,
          firstMs: Math.round(first - begin),
          totalMs: Math.round(performance.now() - begin),
          score,
          checks: fixture.checks.length,
          text,
        }) + '\n',
      );
    }
  } finally {
    clearTimeout(timeout);
    child.stdin.end();
  }
}
if (failed) process.exitCode = 1;
