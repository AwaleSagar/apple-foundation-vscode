import { describe, expect, it } from 'vitest';
import { buildMessages, fenceBlock, type TurnContext } from './prompts';

function base(overrides: Partial<TurnContext> = {}): TurnContext {
  return { command: undefined, prompt: '', ...overrides };
}

describe('fenceBlock', () => {
  it('wraps body in a labeled fenced block with language', () => {
    expect(fenceBlock('Code', 'const x = 1;', 'typescript')).toBe(
      'Code:\n```typescript\nconst x = 1;\n```',
    );
  });

  it('omits the language when none is given', () => {
    expect(fenceBlock('Diff', 'a', undefined)).toBe('Diff:\n```\na\n```');
  });
});

describe('buildMessages', () => {
  it('builds a plain chat turn with a system rule and the prompt', () => {
    const messages = buildMessages(base({ prompt: 'What is a monad?' }));
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toContain('What is a monad?');
  });

  it('includes the editor selection in a chat turn', () => {
    const messages = buildMessages(
      base({ prompt: 'refactor this', selection: 'let a = 2', languageId: 'js', fileName: 'a.js' }),
    );
    expect(messages[1]?.content).toContain('Selected code from a.js');
    expect(messages[1]?.content).toContain('```js\nlet a = 2\n```');
    expect(messages[1]?.content).toContain('refactor this');
  });

  it('explain falls back to a default instruction when the prompt is empty', () => {
    const messages = buildMessages(
      base({ command: 'explain', selection: 'x()', languageId: 'ts' }),
    );
    expect(messages[0]?.content).toContain('Explain');
    expect(messages[1]?.content).toContain('```ts\nx()\n```');
    expect(messages[1]?.content).toContain('Explain the selected code.');
  });

  it('doc instructs comment-only output and fences the code', () => {
    const messages = buildMessages(
      base({ command: 'doc', selection: 'fn foo() {}', languageId: 'rust' }),
    );
    expect(messages[0]?.content.toLowerCase()).toContain('documentation comment');
    expect(messages[1]?.content).toContain('```rust\nfn foo() {}\n```');
  });

  it('commit fences the diff and mentions Conventional Commit rules', () => {
    const messages = buildMessages(base({ command: 'commit', diff: '+added line' }));
    expect(messages[0]?.content).toContain('Conventional Commit');
    expect(messages[1]?.content).toContain('```diff\n+added line\n```');
  });

  it('commit tolerates a missing diff by fencing an empty block', () => {
    const messages = buildMessages(base({ command: 'commit' }));
    expect(messages[1]?.content).toContain('Staged diff:');
  });

  it('appends extra context to a commit turn when the user typed a prompt', () => {
    const messages = buildMessages(
      base({ command: 'commit', diff: 'd', prompt: 'part of auth work' }),
    );
    expect(messages[1]?.content).toContain('Additional context: part of auth work');
  });

  it('edit asks for JSON EditPlan and fences file content', () => {
    const messages = buildMessages(
      base({
        command: 'edit',
        prompt: 'add a null check',
        filePath: 'src/a.ts',
        fileContent: 'export const x = 1;',
        languageId: 'typescript',
      }),
    );
    expect(messages[0]?.content).toContain('SEARCH/REPLACE');
    expect(messages[0]?.content).toContain('"summary"');
    expect(messages[1]?.content).toContain('Current file: src/a.ts');
    expect(messages[1]?.content).toContain('export const x = 1;');
    expect(messages[1]?.content).toContain('add a null check');
  });
});
