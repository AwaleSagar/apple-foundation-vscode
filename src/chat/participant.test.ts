import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { NativeClient } from '../native/client';

let registeredHandler: vscode.ChatRequestHandler | undefined;
let mockActiveTextEditor: vscode.TextEditor | undefined;

vi.mock('vscode', () => {
  class ThemeIcon {
    constructor(readonly id: string) {}
  }
  class MarkdownString {
    constructor(public value: string) {}
  }
  class ChatRequestTurn {
    constructor(readonly prompt: string) {}
  }
  class ChatResponseMarkdownPart {
    constructor(readonly value: MarkdownString) {}
  }
  class ChatResponseTurn {
    constructor(readonly response: readonly ChatResponseMarkdownPart[]) {}
  }
  return {
    ThemeIcon,
    MarkdownString,
    ChatRequestTurn,
    ChatResponseMarkdownPart,
    ChatResponseTurn,
    window: {
      get activeTextEditor() {
        return mockActiveTextEditor;
      },
    },
    workspace: {
      getConfiguration: () => ({
        get: () => undefined,
      }),
    },
    extensions: {
      getExtension: () => undefined,
    },
    chat: {
      createChatParticipant: (_id: string, handler: vscode.ChatRequestHandler) => {
        registeredHandler = handler;
        return {
          iconPath: undefined,
          followupProvider: undefined,
          dispose: () => undefined,
        };
      },
    },
  };
});

import {
  createMarkdownSanitizer,
  fenceCodeReply,
  registerChatParticipant,
  sanitizeParticipantMarkdown,
} from './participant';

describe('sanitizeParticipantMarkdown', () => {
  it('strips markdown images while preserving readable alt text', () => {
    expect(sanitizeParticipantMarkdown('See ![diagram](https://evil.example/pixel.png) now.')).toBe(
      'See diagram now.',
    );
    expect(sanitizeParticipantMarkdown('Track ![](https://evil.example/t.gif)!')).toBe('Track !');
    expect(sanitizeParticipantMarkdown('![logo](https://evil.example/a.png "Logo Title")')).toBe(
      'logo',
    );
  });

  it('strips inline links while preserving label text, nested formatting, and parenthesized URLs', () => {
    expect(sanitizeParticipantMarkdown('Click [here](https://evil.example/phish).')).toBe(
      'Click here.',
    );
    expect(
      sanitizeParticipantMarkdown(
        'Read [C language](https://en.wikipedia.org/wiki/C_(programming_language)) docs.',
      ),
    ).toBe('Read C language docs.');
    expect(
      sanitizeParticipantMarkdown('Run [dangerous](command:workbench.action.terminal.new) now.'),
    ).toBe('Run dangerous now.');
    expect(
      sanitizeParticipantMarkdown('Open [docs](<https://evil.example/path with spaces> "Read me")'),
    ).toBe('Open docs');
    expect(sanitizeParticipantMarkdown('See [the `run()` helper](https://evil.example).')).toBe(
      'See the `run()` helper.',
    );
    expect(
      sanitizeParticipantMarkdown(
        '[![Click me](https://evil.example/i.png)](https://evil.example)',
      ),
    ).toBe('Click me');
    expect(sanitizeParticipantMarkdown('[multi\nline](https://evil.example)')).toBe('multi\nline');
  });

  it('neutralizes URI and email autolinks without mangling generic type parameters', () => {
    expect(sanitizeParticipantMarkdown('Visit <https://evil.example/login> now.')).toBe(
      'Visit `https://evil.example/login` now.',
    );
    expect(sanitizeParticipantMarkdown('Mail <phish@evil.example> or <mailto:a@b.com>.')).toBe(
      'Mail `phish@evil.example` or `mailto:a@b.com`.',
    );
    expect(sanitizeParticipantMarkdown('Exec <command:foo.bar>')).toBe('Exec `command:foo.bar`');
    expect(sanitizeParticipantMarkdown('Use `Array<string>` or Map<K, V> when a < b.')).toBe(
      'Use `Array<string>` or Map<K, V> when a < b.',
    );
  });

  it('strips single-line, multi-line, and blockquoted reference link definitions', () => {
    const input = [
      'Click [here][1] or [there][2].',
      '',
      '[1]: https://evil.example/phish "Click"',
      '  [2]:',
      '    <https://evil.example/2>',
      '    (Title)',
      '> [3]: https://evil.example/quoted',
      '',
      '[Note]: This is a normal prose note and stays intact.',
    ].join('\n');
    expect(sanitizeParticipantMarkdown(input)).toBe(
      'Click [here][1] or [there][2].\n\n\n[Note]: This is a normal prose note and stays intact.',
    );
  });

  it('preserves fenced code blocks and inline code spans verbatim', () => {
    const input = [
      'Use `[a](https://example.com)` and `![img](https://example.com/a.png)` in Markdown.',
      '',
      '```markdown',
      '![img](https://example.com/a.png)',
      '[link](https://example.com)',
      '<https://example.com>',
      '[ref]: https://example.com',
      '```',
      '',
      '~~~md',
      '[tilde](https://example.com)',
      '~~~',
      '',
      'Outside [phish](https://evil.example).',
    ].join('\n');

    expect(sanitizeParticipantMarkdown(input)).toBe(
      [
        'Use `[a](https://example.com)` and `![img](https://example.com/a.png)` in Markdown.',
        '',
        '```markdown',
        '![img](https://example.com/a.png)',
        '[link](https://example.com)',
        '<https://example.com>',
        '[ref]: https://example.com',
        '```',
        '',
        '~~~md',
        '[tilde](https://example.com)',
        '~~~',
        '',
        'Outside phish.',
      ].join('\n'),
    );
  });

  it('does not treat unclosed backticks or invalid fence info strings as code blocks', () => {
    expect(sanitizeParticipantMarkdown('Lone ` backtick then [phish](https://evil.example)')).toBe(
      'Lone ` backtick then phish',
    );
    const fakeFence = '```js `not-a-fence\n[phish](https://evil.example)\n```';
    expect(sanitizeParticipantMarkdown(fakeFence)).not.toContain('https://evil.example');
  });

  it('preserves normal bracket indexing in prose', () => {
    expect(sanitizeParticipantMarkdown('Access items[0] and matrix[row][col].')).toBe(
      'Access items[0] and matrix[row][col].',
    );
  });
});

describe('createMarkdownSanitizer', () => {
  it('produces identical sanitized output even when streamed one character at a time', () => {
    const input = [
      'Intro with ![tracker](https://evil.example/p.gif) and [phish](https://evil.example).',
      '',
      '```ts',
      '// [keep](https://example.com)',
      '',
      'const x = 1;',
      '```',
      '',
      'Check <https://evil.example/auto> and [ref][1].',
      '',
      '[1]: https://evil.example/ref',
    ].join('\n');

    const chunks: string[] = [];
    const sanitizer = createMarkdownSanitizer((text) => chunks.push(text));
    for (const ch of input) sanitizer.push(ch);
    sanitizer.flush();

    expect(chunks.join('')).toBe(sanitizeParticipantMarkdown(input));
  });

  it('streams completed paragraphs and fenced code lines before flush', () => {
    const chunks: string[] = [];
    const sanitizer = createMarkdownSanitizer((text) => chunks.push(text));

    sanitizer.push('First [link](https://evil.example)\n\n');
    expect(chunks).toEqual(['First link\n\n']);

    sanitizer.push('```ts\nconst a = "[ok](https://example.com)";\n');
    expect(chunks).toEqual([
      'First link\n\n',
      '```ts\n',
      'const a = "[ok](https://example.com)";\n',
    ]);

    sanitizer.push('```\nTail');
    sanitizer.flush();
    expect(chunks.join('')).toBe(
      'First link\n\n```ts\nconst a = "[ok](https://example.com)";\n```\nTail',
    );
  });
});

describe('fenceCodeReply', () => {
  it('uses a 3-backtick fence when the body has no backticks', () => {
    expect(fenceCodeReply('/// Sums two numbers.', 'swift')).toBe(
      '```swift\n/// Sums two numbers.\n```',
    );
  });

  it('uses a fence longer than 4 backticks when the reply contains 4+ backticks', () => {
    const body = '/** Example:\n ````md\n code\n ````\n */';
    expect(fenceCodeReply(body, 'typescript')).toBe(`\`\`\`\`\`typescript\n${body}\n\`\`\`\`\``);
  });

  it('omits language id cleanly when undefined', () => {
    expect(fenceCodeReply('/* comment */')).toBe('```\n/* comment */\n```');
  });
});

describe('registerChatParticipant', () => {
  it('sanitizes streamed chat replies before passing them to stream.markdown', async () => {
    const client = {
      generate: vi.fn(async (_messages, _limits, _token, onDelta) => {
        onDelta('See ![px](https://evil.example/p.png) and [click');
        onDelta(' here](https://evil.example/phish) or <https://evil.example/a>.\n\n');
        onDelta('[1]: https://evil.example/ref\n');
      }),
    } as unknown as NativeClient;

    registerChatParticipant(client);
    expect(registeredHandler).toBeDefined();

    const emitted: string[] = [];
    const stream = {
      markdown: (value: string) => emitted.push(value),
      progress: vi.fn(),
    } as unknown as vscode.ChatResponseStream;
    const token = { isCancellationRequested: false } as vscode.CancellationToken;

    const result = await registeredHandler?.(
      { command: undefined, prompt: 'Explain this' } as vscode.ChatRequest,
      { history: [] } as unknown as vscode.ChatContext,
      stream,
      token,
    );

    expect(result).toEqual({ metadata: { command: undefined } });
    expect(emitted.join('')).toBe('See px and click here or `https://evil.example/a`.\n\n');
  });

  it('buffers /doc replies and picks a fence longer than embedded 4-backtick runs', async () => {
    mockActiveTextEditor = {
      selection: { isEmpty: false },
      document: {
        uri: { path: '/workspace/App.swift' },
        fileName: '/workspace/App.swift',
        languageId: 'swift',
        getText: () => 'func greet() {}',
      },
    } as unknown as vscode.TextEditor;
    try {
      const client = {
        generate: vi.fn(async (_messages, _limits, _token, onDelta) => {
          onDelta('/// Uses ````fence```` inside doc');
          onDelta(' comment.');
        }),
      } as unknown as NativeClient;

      registerChatParticipant(client);
      const emitted: string[] = [];
      const stream = {
        markdown: (value: string) => emitted.push(value),
        progress: vi.fn(),
      } as unknown as vscode.ChatResponseStream;
      const token = { isCancellationRequested: false } as vscode.CancellationToken;

      const result = await registeredHandler?.(
        { command: 'doc', prompt: '' } as vscode.ChatRequest,
        { history: [] } as unknown as vscode.ChatContext,
        stream,
        token,
      );

      expect(result).toEqual({ metadata: { command: 'doc' } });
      expect(emitted).toEqual(['`````swift\n/// Uses ````fence```` inside doc comment.\n`````']);
    } finally {
      mockActiveTextEditor = undefined;
    }
  });
});
